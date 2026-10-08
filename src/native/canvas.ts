import { gpu } from './index.js';
import type { AffineTransform } from './scene.js';

/** Synchronous drawing at a canvas's place in paint order. Return any raw draw count. */
export type CanvasPaint = (frame: CanvasFrame) => number | undefined;

/** A prepared, reusable pipeline. Additional bind group layouts belong to the caller. */
export class CanvasPipeline {
  readonly vertexCount: number;
  readonly #owner: object;
  readonly #pipeline: gpu.GpuPipeline;
  readonly #resources: { destroy(): void }[];
  readonly #release: () => void;
  #disposed = false;

  /** @internal Use SceneRenderer.createCanvasPipeline. */
  constructor(
    owner: object,
    pipeline: gpu.GpuPipeline,
    vertexCount: number,
    resources: { destroy(): void }[],
    release: () => void,
  ) {
    this.#owner = owner;
    this.#pipeline = pipeline;
    this.vertexCount = vertexCount;
    this.#resources = resources;
    this.#release = release;
  }
  /** @internal */
  resolve(owner: object): gpu.GpuPipeline {
    if (this.#disposed) {
      throw new Error('Canvas pipeline disposed');
    }
    if (owner !== this.#owner) {
      throw new Error('Canvas pipeline belongs to another renderer');
    }
    return this.#pipeline;
  }
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#release();
    this.#disposed = true;
    for (const resource of this.#resources.reverse()) {
      resource.destroy();
    }
    this.#resources.length = 0;
  }
}

/** @internal Mutable storage reused between synchronous canvas callbacks. */
export interface CanvasState {
  encoder: gpu.GpuEncoder | undefined;
  target: gpu.GpuTextureView | undefined;
  record: number;
  width: number;
  height: number;
  transform: [number, number, number, number, number, number];
  scale: number;
  pixelRatio: number;
  scissor: [number, number, number, number];
  drawCalls: number;
}
/** @internal */
export interface CanvasHost {
  device: gpu.GpuDevice;
  state: CanvasState;
  bind(pipeline: CanvasPipeline): void;
  resume(): void;
}
/** Borrowed for one callback. A scissor is set; use canvasClip in shaders for exact clipping. */
export class CanvasFrame {
  readonly #host: CanvasHost;
  #active = false;
  /** @internal */
  constructor(host: CanvasHost) {
    this.#host = host;
  }
  /** @internal */
  activate(): void {
    this.#active = true;
  }
  /** @internal */
  deactivate(): void {
    this.#active = false;
  }
  #state(): CanvasState {
    if (!this.#active) {
      throw new Error('Canvas frame is only valid during its paint callback');
    }
    return this.#host.state;
  }
  get device(): gpu.GpuDevice {
    this.#state();
    return this.#host.device;
  }
  get encoder(): gpu.GpuEncoder {
    return this.#state().encoder!;
  }
  get format(): gpu.TextureFormat {
    this.#state();
    return gpu.TextureFormat.Rgba8unorm;
  }
  get record(): number {
    return this.#state().record;
  }
  /** The content box in local layout units. */
  get width(): number {
    return this.#state().width;
  }
  get height(): number {
    return this.#state().height;
  }
  /** Local content coordinates to frame layout coordinates; copy if retaining. */
  get transform(): AffineTransform {
    return this.#state().transform;
  }
  /** Target pixels per local unit, using the affine determinant. */
  get scale(): number {
    return this.#state().scale;
  }
  get pixelRatio(): number {
    return this.#state().pixelRatio;
  }
  /** Clipped [x, y, width, height] in target pixels; copy if retaining. */
  get scissor(): readonly [number, number, number, number] {
    return this.#state().scissor;
  }

  /** Bind a prepared pipeline and the shared frame/texture groups. Extra groups start at 2. */
  bind(pipeline: CanvasPipeline): void {
    this.#state();
    this.#host.bind(pipeline);
  }
  /** Draw once with the canvas's record as firstInstance, preserving exact shader clipping. */
  draw(pipeline: CanvasPipeline, vertices = pipeline.vertexCount, firstVertex = 0): void {
    const state = this.#state();
    if (
      !Number.isSafeInteger(vertices) ||
      vertices < 0 ||
      vertices > 0xffffffff ||
      !Number.isSafeInteger(firstVertex) ||
      firstVertex < 0 ||
      firstVertex > 0xffffffff
    ) {
      throw new RangeError('Invalid canvas draw range');
    }
    this.bind(pipeline);
    state.encoder!.renderDrawRange(vertices, 1, firstVertex, state.record);
    state.drawCalls++;
  }
  /** End this pass for auxiliary passes; resume the same layer and scissor afterward. */
  suspend(passes: (encoder: gpu.GpuEncoder) => number | undefined): void {
    const state = this.#state();
    this.#active = false;
    state.encoder!.renderEnd();
    try {
      state.drawCalls += canvasDrawCount(passes(state.encoder!));
    } finally {
      this.#host.resume();
      this.#active = true;
    }
  }
}
/** @internal Also rejects promises from callbacks accidentally declared async. */
export function canvasDrawCount(value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(
      'Canvas callbacks must be synchronous and return a draw count or undefined',
    );
  }
  return value;
}
