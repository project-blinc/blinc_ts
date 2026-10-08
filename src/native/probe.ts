import { probeShader } from '../renderer/shaders.js';
import { gpu, type NativeBindings, type window } from './index.js';

/** Native rendering probe. Owns windows/GPU resources across accepted HMR. */
export class NativeProbeHost {
  readonly ready: Promise<void>;
  readonly window: window.Window;
  readonly instance: gpu.GpuInstance;
  adapter: gpu.GpuAdapter | undefined;
  device: gpu.GpuDevice | undefined;
  queue: gpu.GpuQueue | undefined;
  surface: gpu.GpuSurface | undefined;
  shader: gpu.GpuShader | undefined;
  builder: gpu.GpuPipelineBuilder | undefined;
  pipeline: gpu.GpuPipeline | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  #listeners = new Set<(event: window.Event) => void>();
  #disposed = false;
  #dirty = true;
  #width = 0;
  #height = 0;
  #format: gpu.TextureFormat | undefined;

  constructor(bindings: NativeBindings, options: window.WindowAttributes = {}) {
    this.window = bindings.window.Window.open({
      title: 'Blinc — TypeGPU',
      width: 640,
      height: 420,
      ...options,
    });
    try {
      this.instance = bindings.gpu.GpuInstance.new();
    } catch (error) {
      this.window.close();
      throw error;
    }
    this.ready = this.#initialize().catch((error) => {
      this.dispose();
      throw error;
    });
    this.#timer = setInterval(() => this.#tick(), 16);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  onEvent(listener: (event: window.Event) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  requestFrame(): void {
    this.#dirty = true;
  }

  async #initialize(): Promise<void> {
    const adapter = await this.instance.requestAdapter(gpu.Power.LowPower);
    if (!adapter?.valid()) {
      throw new Error('No native GPU adapter');
    }
    if (this.#disposed) {
      adapter.destroy();
      return;
    }
    this.adapter = adapter;
    const device = await adapter.requestDevice();
    if (!device?.valid()) {
      throw new Error('No native GPU device');
    }
    if (this.#disposed) {
      device.destroy();
      return;
    }
    this.device = device;
    this.queue = device.queue();
    this.surface = this.instance.surface(
      this.window.platform(),
      this.window.raw(0),
      this.window.raw(1),
      this.window.raw(2),
      this.window.raw(3),
    );
    this.#format = this.surface.preferredFormat(adapter);
    this.shader = device.createShader(probeShader.code);
    this.builder = device.pipeline();
    this.builder.shader(this.shader, probeShader.vertexEntryPoint, probeShader.fragmentEntryPoint);
    this.builder.target(this.#format, gpu.ColorWrite.ALL);
    this.pipeline = this.builder.build();
    this.render();
  }

  #tick(): void {
    if (this.#disposed) {
      return;
    }
    try {
      for (let i = 0; i < 64; i++) {
        const event = this.window.poll();
        if (event.kind === 'None') {
          break;
        }
        if (event.kind === 'Closed' || event.kind === 'Destroyed') {
          this.dispose();
          return;
        }
        if (
          event.kind === 'Resized' ||
          event.kind === 'ScaleFactorChanged' ||
          event.kind === 'RedrawRequested'
        ) {
          this.#dirty = true;
        }
        for (const listener of this.#listeners) {
          listener(event);
        }
        if (this.#disposed) {
          return;
        }
      }
      if (this.#dirty) {
        this.render();
      }
    } catch (error) {
      this.dispose();
      console.error(error);
    }
  }

  render(): void {
    if (
      this.#disposed ||
      !this.device ||
      !this.pipeline ||
      !this.surface ||
      !this.queue ||
      this.#format === undefined
    ) {
      return;
    }
    const width = this.window.width(),
      height = this.window.height();
    if (width <= 0 || height <= 0) {
      return;
    }
    if (width !== this.#width || height !== this.#height) {
      this.device.configureSurface(this.surface, width, height, this.#format);
      this.#width = width;
      this.#height = height;
    }
    const view = this.surface.acquire();
    const encoder = this.device.encoder();
    try {
      encoder.passColour(view, 0, 0, 0, 1);
      encoder.passBegin();
      encoder.renderSetPipeline(this.pipeline);
      encoder.renderDraw(probeShader.vertexCount, 1);
      encoder.renderEnd();
      encoder.submit(this.queue);
      this.window.prePresentNotify();
      this.queue.presentSurface(this.surface);
      const error = this.device.takeError();
      if (error !== null) {
        throw new Error(error);
      }
      this.#dirty = false;
    } finally {
      encoder.destroy();
      view.destroy();
    }
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
    }
    this.#listeners.clear();
    // A surface must be released before its window.
    for (const resource of [
      this.pipeline,
      this.builder,
      this.shader,
      this.surface,
      this.device,
      this.adapter,
      this.instance,
    ]) {
      resource?.destroy();
    }
    this.window.close();
  }
}
