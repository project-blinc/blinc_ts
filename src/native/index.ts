export { Brush } from './brush.js';
export type { BrushColor, GlassOptions } from './brush.js';
import { ImageResource, type NativeImage } from './image.js';
import { validateSceneSchema } from './scene.js';
import { bind as bindScene } from './generated/scene.js';
export { ImageResource } from './image.js';
export { ImageFit } from './generated/scene.js';
export { sceneSchema } from './scene.js';
export type {
  Color,
  CornerRadii,
  AffineTransform,
  VisualBounds,
  TextStyle,
  PaintShadow,
  PaintFilter,
  PaintStyle,
  PaintOptions,
  PaintInfo,
  AtlasInfo,
  SceneHit,
} from './scene.js';
import { ReactiveContext, type NativeGraph } from './reactive.js';
export { ReactiveContext, Signal, Computed } from './reactive.js';
export type { GraphStats, Disposable } from './reactive.js';
import type { Scope } from '../hmr.js';
import { Layout, type NativeLayout } from './layout.js';
export { Layout, LayoutNode, HitCache } from './layout.js';
export type { LayoutStyle, LayoutLength, LayoutChange, HitRegion } from './layout.js';
export { LayoutDirection, LayoutAlign, LayoutJustify, LayoutOverflow } from './generated/layout.js';
import { bind as bindLayout } from './generated/layout.js';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isMainThread } from 'node:worker_threads';
import {
  bind as bindGpu,
  type NativeBinding,
  type Bindings as GpuBindings,
} from './generated/gpu.js';
import { bind as bindWindow, type Bindings as WindowBindings } from './generated/window.js';
export * as gpu from './generated/gpu.js';
export * as window from './generated/window.js';

interface Addon {
  NativeEventPump?: new (callback: () => void) => { dispose(): void };
  sceneSchema(): unknown;
  sceneCall: NativeBinding['call'];
  decodeImage(bytes: Uint8Array): NativeImage;
  rasterizeSvg(markup: string, width: number, height: number): NativeImage;
  NativeLayout: new () => NativeLayout;
  NativeGraph: new () => NativeGraph;
  buildProfile(): string;
  gpuCall: NativeBinding['call'];
  windowCall: NativeBinding['call'];
  layoutCall: NativeBinding['call'];
}
const eventPumps = new WeakMap<Addon, { listeners: Set<() => void>; pump: { dispose(): void } }>();
function subscribeEvents(addon: Addon, callback: () => void): () => void {
  let entry = eventPumps.get(addon);
  if (!entry) {
    const listeners = new Set<() => void>();
    const pump = new addon.NativeEventPump!(() => {
      for (const listener of listeners) {
        listener();
      }
    });
    entry = { listeners, pump };
    eventPumps.set(addon, entry);
  }
  const live = entry;
  const listener = () => callback();
  live.listeners.add(listener);
  return () => {
    if (!live.listeners.delete(listener)) {
      return;
    }
    if (live.listeners.size === 0) {
      eventPumps.delete(addon);
      live.pump.dispose();
    }
  };
}
export interface NativeBindings {
  /** @internal Event readiness integration, where supported by the native host. */
  subscribeWindowEvents?: (callback: () => void) => () => void;
  decodeImage(bytes: Uint8Array, scope?: Scope): ImageResource;
  rasterizeSvg(markup: string, width: number, height: number, scope?: Scope): ImageResource;
  readonly buildProfile: string;
  createLayout(scope?: Scope): Layout;
  createReactive(scope?: Scope): ReactiveContext;
  gpu: GpuBindings;
  window: WindowBindings;
}
/** Load the native addon on the Node thread that will own windows and rendering. */
export function loadNative(
  path: string | URL = new URL('../../native/blinc_ts.node', import.meta.url),
): NativeBindings {
  if (!isMainThread) {
    throw new Error('Native windows and rendering must run on the Node main thread');
  }
  const addon = createRequire(import.meta.url)(
    path instanceof URL ? fileURLToPath(path) : path,
  ) as Addon;
  bindLayout({ call: addon.layoutCall });
  bindScene({ call: addon.sceneCall });
  validateSceneSchema(addon.sceneSchema());
  return {
    ...(addon.NativeEventPump
      ? { subscribeWindowEvents: (callback: () => void) => subscribeEvents(addon, callback) }
      : {}),
    buildProfile: addon.buildProfile(),
    decodeImage: (bytes, scope) => new ImageResource(addon.decodeImage(bytes), scope),
    rasterizeSvg: (markup, width, height, scope) =>
      new ImageResource(addon.rasterizeSvg(markup, width, height), scope),
    createLayout: (scope?: Scope) => new Layout(new addon.NativeLayout(), scope),
    createReactive: (scope?: Scope) => new ReactiveContext(new addon.NativeGraph(), scope),
    gpu: bindGpu({ call: addon.gpuCall }),
    window: bindWindow({ call: addon.windowCall }),
  };
}
