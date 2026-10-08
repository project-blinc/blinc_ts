import type { Scope } from '../hmr.js';
import { gpu, LayoutNode, type Layout, type NativeBindings, type window } from './index.js';
import { SceneRenderer, type RenderOptions, type SceneRenderStats } from './renderer.js';

/** Scene presentation options; the window supplies dimensions and display scale. */
export type WindowSceneOptions = Omit<RenderOptions, 'width' | 'height' | 'scale'>;
type Paint = (
  encoder: gpu.GpuEncoder,
  target: gpu.GpuTextureView,
  width: number,
  height: number,
  scale: number,
) => void;
interface Painter {
  paint: Paint;
  release(): void;
}
interface WindowGpu {
  instance: gpu.GpuInstance;
  adapter: gpu.GpuAdapter;
  device: gpu.GpuDevice;
  queue: gpu.GpuQueue;
  surface: gpu.GpuSurface;
  format: gpu.TextureFormat;
  alpha: gpu.AlphaMode;
}

/** Persistent window/device, with a replaceable scene and bounded main-thread event pumping. */
export class NativeWindowHost {
  readonly ready: Promise<void>;
  readonly window: window.Window;
  readonly #transparent: boolean;
  #gpu: WindowGpu | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #urgent = false;
  #pumping = false;
  readonly #listeners = new Set<(event: window.Event) => void>();
  #painter: Painter | undefined;
  #disposed = false;
  #painting = false;
  #holdingFrame = false;
  #dirty = true;
  #occluded = false;
  #suspended = false;
  #width = 0;
  #height = 0;
  #frames = 0;
  #error: unknown;
  #stats: SceneRenderStats | undefined;

  constructor(bindings: NativeBindings, options: window.WindowAttributes = {}) {
    this.#transparent = options.transparent ?? false;
    this.window = bindings.window.Window.open({
      title: 'Blinc',
      width: 720,
      height: 480,
      ...options,
    });
    this.ready = this.#initialize(bindings)
      .then(() => {
        if (!this.#disposed) {
          this.initializeContent();
        }
      })
      .catch((error: unknown) => {
        this.#error = error;
        this.dispose();
        throw error;
      });
    // poll() must run on the owning thread; never block Node's Vite/timer callbacks with wait().
    this.#schedule();
  }
  /** @internal Called after GPU initialization, before ready resolves. */
  protected initializeContent(): void {
    // Subclasses may install shared-lifecycle GPU probes here.
  }

  get disposed(): boolean {
    return this.#disposed;
  }
  get frames(): number {
    return this.#frames;
  }
  get error(): unknown {
    return this.#error;
  }
  get stats(): SceneRenderStats | undefined {
    return this.#stats;
  }
  get device(): gpu.GpuDevice {
    return this.#liveGpu().device;
  }
  get queue(): gpu.GpuQueue {
    return this.#liveGpu().queue;
  }
  get format(): gpu.TextureFormat {
    return this.#liveGpu().format;
  }
  #liveGpu(): WindowGpu {
    if (this.#disposed) {
      throw new Error('Native window disposed');
    }
    if (!this.#gpu) {
      throw new Error('Native window is not ready; await ready first');
    }
    return this.#gpu;
  }
  #assertIdle(): void {
    if (this.#painting) {
      throw new Error('Cannot replace or dispose a window during painting');
    }
  }
  onEvent(listener: (event: window.Event) => void, scope?: Scope): () => void {
    if (this.#disposed) {
      throw new Error('Native window disposed');
    }
    // Per-registration identity protects replacement listeners from stale cleanup.
    const callback = (event: window.Event) => listener(event);
    this.#listeners.add(callback);
    const remove = () => {
      this.#listeners.delete(callback);
    };
    scope?.onCleanup(remove);
    return remove;
  }
  requestFrame(): void {
    if (this.#disposed) {
      return;
    }
    const wasDirty = this.#dirty;
    this.#dirty = true;
    // Wake once per edit burst. In-frame requests are scheduled after presentation.
    if (!wasDirty && !this.#painting && !this.#pumping) {
      this.#schedule(true);
    }
  }
  #schedule(urgent = false): void {
    if (this.#disposed) {
      return;
    }
    if (this.#timer !== undefined) {
      if (!urgent || this.#urgent) {
        return;
      }
      clearTimeout(this.#timer);
    }
    this.#urgent = urgent;
    this.#timer = setTimeout(
      () => {
        this.#timer = undefined;
        this.#urgent = false;
        this.#tick();
      },
      urgent ? 0 : 16,
    );
  }

  /** Attach after ready. Owns the renderer, while the caller owns the layout. */
  attachScene(
    layout: Layout,
    root: LayoutNode,
    options: WindowSceneOptions = {},
    scope?: Scope,
  ): SceneRenderer {
    this.#assertIdle();
    const state = this.#liveGpu();
    if (layout.disposed) {
      throw new Error('Cannot attach a disposed layout');
    }
    LayoutNode.unwrap(root, layout);
    const renderer = new SceneRenderer(state.device, layout, state.format);
    const render: RenderOptions = { ...options, width: 0, height: 0, scale: 1 };
    let needsLayout = true;
    let width = -1,
      height = -1,
      scale = -1;
    const detach = this.setPainter(
      (encoder, target, w, h, ratio) => {
        if (needsLayout || width !== w || height !== h || scale !== ratio) {
          // Clear before compute so invalidation during this frame survives for the next one.
          needsLayout = false;
          layout.compute(root, w / ratio, h / ratio);
          width = w;
          height = h;
          scale = ratio;
        }
        render.width = w;
        render.height = h;
        render.scale = ratio;
        this.#stats = renderer.encode(encoder, root, target, render);
      },
      () => {
        unsubscribe();
        renderer.dispose();
      },
    );
    const unsubscribe = layout.onChange((change) => {
      if (change === 'disposed') {
        this.detachScene();
        return;
      }
      needsLayout ||= change === 'layout';
      this.requestFrame();
    });
    scope?.onCleanup(detach);
    return renderer;
  }

  /** Detach and release the current renderer; the next frame clears the surface. */
  detachScene(): void {
    this.#assertIdle();
    const painter = this.#painter;
    this.#painter = undefined;
    this.#stats = undefined;
    this.#holdingFrame = false;
    painter?.release();
    this.requestFrame();
  }

  /** @internal Low-level hosts can share the same surface/lifetime without creating a scene. */
  protected setPainter(paint: Paint, release: () => void): () => void {
    this.#assertIdle();
    this.#liveGpu();
    this.detachScene();
    const painter = { paint, release };
    this.#painter = painter;
    this.requestFrame();
    let released = false;
    const dispose = () => {
      this.#assertIdle();
      if (released) {
        return;
      }
      released = true;
      if (this.#painter === painter) {
        this.#painter = undefined;
        this.#stats = undefined;
        // HMR may await module evaluation before attaching its replacement.
        // Leave the last presented frame visible instead of flashing a cleared window.
        this.#holdingFrame = true;
      }
      release();
    };
    painter.release = dispose;
    return dispose;
  }

  async #initialize(bindings: NativeBindings): Promise<void> {
    const owned: { destroy(): void }[] = [];
    const keep = <T extends { destroy(): void }>(resource: T): T => {
      owned.push(resource);
      return resource;
    };
    try {
      const instance = keep(bindings.gpu.GpuInstance.new());
      const adapter = await instance.requestAdapter(gpu.Power.LowPower);
      if (adapter) {
        keep(adapter);
      }
      if (this.#disposed) {
        return;
      }
      if (!adapter?.valid()) {
        throw new Error('No native GPU adapter');
      }
      const device = await adapter.requestDevice();
      if (device) {
        keep(device);
      }
      if (this.#disposed) {
        return;
      }
      if (!device?.valid()) {
        throw new Error('No native GPU device');
      }
      const surface = keep(
        instance.surface(
          this.window.platform(),
          this.window.raw(0),
          this.window.raw(1),
          this.window.raw(2),
          this.window.raw(3),
        ),
      );
      const capabilities = surface.capabilities(adapter);
      let format: gpu.TextureFormat | undefined;
      let alpha: gpu.AlphaMode | undefined;
      try {
        // UI colors are already display encoded; an sRGB target would encode them a second time.
        for (const wanted of [gpu.TextureFormat.Bgra8unorm, gpu.TextureFormat.Rgba8unorm]) {
          for (let i = 0; i < capabilities.formatCount(); i++) {
            if (capabilities.format(i) === wanted) {
              format = wanted;
              break;
            }
          }
          if (format !== undefined) {
            break;
          }
        }
        if (format === undefined) {
          throw new Error('Native UI presentation requires an RGBA8/BGRA8 unorm surface');
        }
        if (this.#transparent) {
          for (let i = 0; i < capabilities.alphaModeCount(); i++) {
            if (capabilities.alphaMode(i) === gpu.AlphaMode.PreMultiplied) {
              alpha = gpu.AlphaMode.PreMultiplied;
              break;
            }
          }
          if (alpha === undefined) {
            throw new Error('Surface does not support premultiplied window transparency');
          }
        } else {
          alpha = capabilities.alphaMode(0);
          for (let i = 0; i < capabilities.alphaModeCount(); i++) {
            if (capabilities.alphaMode(i) === gpu.AlphaMode.Opaque) {
              alpha = gpu.AlphaMode.Opaque;
              break;
            }
          }
        }
      } finally {
        capabilities.destroy();
      }
      this.#gpu = { instance, adapter, device, queue: device.queue(), surface, format, alpha };
      owned.length = 0;
    } finally {
      for (const resource of owned.reverse()) {
        resource.destroy();
      }
    }
  }

  #tick(): void {
    if (this.#disposed) {
      return;
    }
    let presented = false;
    this.#pumping = true;
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
          this.requestFrame();
        } else if (event.kind === 'Occluded') {
          this.#occluded = event.occluded;
          this.requestFrame();
        } else if (event.kind === 'Suspended') {
          this.#suspended = true;
        } else if (event.kind === 'Resumed') {
          this.#suspended = false;
          this.#width = 0;
          this.requestFrame();
        }
        for (const listener of this.#listeners) {
          listener(event);
        }
        if (this.#disposed) {
          return;
        }
      }
      if (this.#dirty) {
        presented = this.render();
      }
    } catch (error) {
      this.#error = error;
      this.dispose();
      console.error(error);
    } finally {
      this.#pumping = false;
      // Continuous painting yields to Node immediately and lets FIFO pace the GPU.
      // Idle/hidden/unavailable surfaces only pump events, without a redraw loop.
      this.#schedule(presented && this.#dirty);
    }
  }

  /** Present a dirty frame; returns false when unchanged, hidden, or no surface frame is available. */
  render(): boolean {
    this.#assertIdle();
    const state = this.#gpu;
    if (
      this.#disposed ||
      !state ||
      !this.#dirty ||
      this.#holdingFrame ||
      this.#occluded ||
      this.#suspended ||
      !this.window.isVisible() ||
      this.window.isMinimized()
    ) {
      return false;
    }
    const width = this.window.width(),
      height = this.window.height(),
      scale = this.window.scaleFactor();
    if (width <= 0 || height <= 0) {
      return false;
    }
    if (width !== this.#width || height !== this.#height) {
      state.device.configureSurfaceWith(state.surface, {
        format: state.format,
        width,
        height,
        alphaMode: state.alpha,
        presentMode: gpu.PresentMode.Fifo,
      });
      this.#width = width;
      this.#height = height;
    }
    const view = state.surface.acquire();
    if (!view.valid()) {
      view.destroy();
      this.#width = 0; // Retry configuration on the next pump, without spinning.
      this.#check(state.device);
      return false;
    }
    const encoder = state.device.encoder();
    let failed = false;
    this.#painting = true;
    this.#dirty = false;
    try {
      if (this.#painter) {
        this.#painter.paint(encoder, view, width, height, scale);
      } else {
        encoder.passColour(view, 0, 0, 0, this.#transparent ? 0 : 1);
        encoder.passBegin();
        encoder.renderEnd();
      }
      encoder.submit(state.queue);
      this.window.prePresentNotify();
      state.queue.presentSurface(state.surface);
      this.#check(state.device);
      this.#frames++;
      return true;
    } catch (error) {
      failed = true;
      this.#error = error;
      throw error;
    } finally {
      this.#painting = false;
      encoder.destroy();
      view.destroy();
      // A failed frame may still be held by the surface; dispose it before a retry can reuse it.
      if (failed) {
        this.dispose();
      }
    }
  }
  #check(device: gpu.GpuDevice): void {
    const error = device.takeError();
    if (error !== null) {
      throw new Error(error);
    }
  }
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#assertIdle();
    this.#disposed = true;
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
    }
    this.#listeners.clear();
    try {
      this.detachScene();
    } finally {
      const state = this.#gpu;
      this.#gpu = undefined;
      if (state) {
        // The surface must die before the native window. Pending initialization owns its own cleanup.
        for (const resource of [state.surface, state.device, state.adapter, state.instance]) {
          resource.destroy();
        }
      }
      this.window.close();
    }
  }
}
