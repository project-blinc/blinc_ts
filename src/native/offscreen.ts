import { performance } from 'node:perf_hooks';
import { gpu, type NativeBindings } from './index.js';

export interface Shader {
  readonly code: string;
  readonly vertexEntryPoint: string;
  readonly fragmentEntryPoint: string;
  readonly vertexCount: number;
  /** Blend straight-alpha color output over the render target. */
  readonly alphaBlend?: boolean;
}
export interface CaptureStats {
  width: number;
  height: number;
  rowStride: number;
  drawCalls: number;
  cpuEncodeMs: number;
  readbackMs: number;
}

/** Offscreen GPU target shared by snapshots and deterministic motion capture. */
export class OffscreenRenderer {
  readonly width: number;
  readonly height: number;
  readonly rowStride: number;
  readonly instance: gpu.GpuInstance;
  readonly adapter: gpu.GpuAdapter;
  readonly device: gpu.GpuDevice;
  readonly queue: gpu.GpuQueue;
  readonly pipeline: gpu.GpuPipeline;
  readonly texture: gpu.GpuTexture;
  readonly view: gpu.GpuTextureView;
  readonly #readback: gpu.GpuBuffer;
  readonly #shader: gpu.GpuShader;
  readonly #builder: gpu.GpuPipelineBuilder;
  readonly #padded: Uint8Array;
  #disposed = false;
  #capturing = false;

  private constructor(
    width: number,
    height: number,
    resources: {
      instance: gpu.GpuInstance;
      adapter: gpu.GpuAdapter;
      device: gpu.GpuDevice;
      shader: gpu.GpuShader;
      builder: gpu.GpuPipelineBuilder;
      pipeline: gpu.GpuPipeline;
      texture: gpu.GpuTexture;
      view: gpu.GpuTextureView;
      readback: gpu.GpuBuffer;
    },
  ) {
    this.width = width;
    this.height = height;
    this.rowStride = Math.ceil((width * 4) / 256) * 256;
    this.instance = resources.instance;
    this.adapter = resources.adapter;
    this.device = resources.device;
    this.queue = this.device.queue();
    this.pipeline = resources.pipeline;
    this.texture = resources.texture;
    this.view = resources.view;
    this.#shader = resources.shader;
    this.#builder = resources.builder;
    this.#readback = resources.readback;
    this.#padded = new Uint8Array(this.rowStride * height);
  }

  static async create(
    bindings: NativeBindings,
    width: number,
    height: number,
    shader: Shader,
  ): Promise<OffscreenRenderer> {
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 8192 ||
      height > 8192
    ) {
      throw new RangeError('Invalid capture dimensions');
    }
    const cleanup: { destroy(): void }[] = [];
    const retain = <T extends { destroy(): void }>(value: T): T => {
      cleanup.push(value);
      return value;
    };
    try {
      const instance = retain(bindings.gpu.GpuInstance.new());
      const adapter = await instance.requestAdapter(gpu.Power.LowPower);
      if (!adapter?.valid()) {
        throw new Error('No native GPU adapter');
      }
      retain(adapter);
      const device = await adapter.requestDevice();
      if (!device?.valid()) {
        throw new Error('No native GPU device');
      }
      retain(device);
      const module = retain(device.createShader(shader.code));
      const builder = retain(device.pipeline());
      builder.shader(module, shader.vertexEntryPoint, shader.fragmentEntryPoint);
      builder.target(gpu.TextureFormat.Rgba8unorm, gpu.ColorWrite.ALL);
      if (shader.alphaBlend) {
        builder.blend(
          gpu.BlendFactor.SrcAlpha,
          gpu.BlendFactor.OneMinusSrcAlpha,
          gpu.BlendOperation.Add,
          gpu.BlendFactor.One,
          gpu.BlendFactor.OneMinusSrcAlpha,
          gpu.BlendOperation.Add,
        );
      }
      const pipeline = retain(builder.build());
      const texture = retain(
        device.texture({
          size: { width, height, depthOrArrayLayers: 1 },
          format: gpu.TextureFormat.Rgba8unorm,
          usage: gpu.TextureUsage.RENDER_ATTACHMENT | gpu.TextureUsage.COPY_SRC,
        }),
      );
      const view = retain(texture.createView({}));
      const readback = retain(
        device.createBuffer({
          size: BigInt(Math.ceil((width * 4) / 256) * 256 * height),
          usage: gpu.BufferUsage.MAP_READ | gpu.BufferUsage.COPY_DST,
        }),
      );
      const error = device.takeError();
      if (error !== null) {
        throw new Error(error);
      }
      return new OffscreenRenderer(width, height, {
        instance,
        adapter,
        device,
        shader: module,
        builder,
        pipeline,
        texture,
        view,
        readback,
      });
    } catch (error) {
      for (const resource of cleanup.reverse()) {
        resource.destroy();
      }
      throw error;
    }
  }

  /** The caller owns the reusable, tightly packed RGBA destination. */
  async captureInto(
    target: Uint8Array,
    vertexCount: number,
    groups: readonly gpu.GpuBindGroup[] = [],
    instanceCount = 1,
  ): Promise<CaptureStats> {
    if (!Number.isSafeInteger(vertexCount) || vertexCount < 1) {
      throw new RangeError('Invalid vertex count');
    }
    if (!Number.isSafeInteger(instanceCount) || instanceCount < 1) {
      throw new RangeError('Invalid instance count');
    }
    return this.captureCommandsInto(target, (encoder) => {
      encoder.passColour(this.view, 0, 0, 0, 1);
      encoder.passBegin();
      encoder.renderSetPipeline(this.pipeline);
      for (let i = 0; i < groups.length; i++) {
        encoder.renderSetBindGroup(i, groups[i]!);
      }
      encoder.renderDraw(vertexCount, instanceCount);
      encoder.renderEnd();
      return 1;
    });
  }

  /** Record passes into this target; the callback returns its draw count. */
  async captureCommandsInto(
    target: Uint8Array,
    encode: (encoder: gpu.GpuEncoder, view: gpu.GpuTextureView) => number,
  ): Promise<CaptureStats> {
    if (this.#disposed) {
      throw new Error('Offscreen renderer disposed');
    }
    if (this.#capturing) {
      throw new Error('An offscreen capture is already pending');
    }
    if (target.length !== this.width * this.height * 4) {
      throw new RangeError('Wrong RGBA target size');
    }
    const encoder = this.device.encoder();
    this.#capturing = true;
    const start = performance.now();
    let mapped = false;
    try {
      const drawCalls = encode(encoder, this.view);
      encoder.copyTextureToBuffer(
        this.texture,
        this.#readback,
        this.width,
        this.height,
        this.rowStride,
      );
      encoder.submit(this.queue);
      const encoded = performance.now();
      await this.device.mapBuffer(this.#readback, 0n, BigInt(this.#padded.length));
      mapped = true;
      if (!this.#readback.copyOut(0n, this.#padded, this.#padded.length)) {
        throw new Error('GPU readback failed');
      }
      for (let row = 0; row < this.height; row++) {
        target.set(
          this.#padded.subarray(row * this.rowStride, row * this.rowStride + this.width * 4),
          row * this.width * 4,
        );
      }
      const error = this.device.takeError();
      if (error !== null) {
        throw new Error(error);
      }
      return {
        width: this.width,
        height: this.height,
        rowStride: this.rowStride,
        drawCalls,
        cpuEncodeMs: encoded - start,
        readbackMs: performance.now() - encoded,
      };
    } finally {
      try {
        if (mapped) {
          this.#readback.unmap();
        }
      } finally {
        try {
          encoder.destroy();
        } finally {
          this.#capturing = false;
        }
      }
    }
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    if (this.#capturing) {
      throw new Error('Wait for the pending capture before disposing');
    }
    this.#disposed = true;
    for (const resource of [
      this.#readback,
      this.view,
      this.texture,
      this.pipeline,
      this.#builder,
      this.#shader,
      this.device,
      this.adapter,
      this.instance,
    ]) {
      resource.destroy();
    }
  }
}
