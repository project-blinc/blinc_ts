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
  CornerShapes,
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
import type { CompileCss } from './css.js';
import {
  TextMeasurement,
  toInlineLayout,
  type InlineAlign,
  type InlineItem,
  type InlineLayout,
  type NativeText,
} from './text.js';
import type { TextStyle } from './scene.js';
export { TextMeasurement } from './text.js';
export { Paragraph } from './paragraph.js';
export type { ParagraphRun } from './paragraph.js';
export type {
  Caret,
  TextLine,
  InlineAlign,
  InlineItem,
  InlineFragment,
  InlineLine,
  InlineLayout,
} from './text.js';
export { Layout, LayoutNode, HitCache } from './layout.js';
export type { StyleSheet, CssDiagnostic, Restyled } from './layout.js';
export { compileCss } from './css.js';
export type { CompiledCss } from './css.js';
export type {
  LayoutStyle,
  LayoutLength,
  LayoutSides,
  LayoutAlignKeyword,
  LayoutContentKeyword,
  LayoutOverflowKeyword,
  LayoutChange,
  HitRegion,
} from './layout.js';
export { LayoutProperty, WriteKind, propertyWrite } from './properties.js';
export type { PropertyWrite } from './properties.js';
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
  measureText: NativeText['measureText'];
  cssIsLayoutProperty(name: string): boolean;
  cssStates(): string[];
  compileCss: CompileCss;
  layoutInline: NativeText['layoutInline'];
  NativeGraph: new (dispatch: (callback: number) => void) => NativeGraph;
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
  /** `text` in `style`, laid out as it is drawn; with `wrapWidth`, wrapped at it. */
  measureText(text: string, style?: TextStyle, wrapWidth?: number): TextMeasurement;
  /** A paragraph of differently styled runs and boxes laid out as one flow `width` wide. */
  layoutInline(
    items: readonly InlineItem[],
    width: number,
    options?: { align?: InlineAlign; breakWords?: boolean },
  ): InlineLayout;
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
    createLayout: (scope?: Scope) => new Layout(new addon.NativeLayout(), addon, scope),
    measureText: (text, style = {}, wrapWidth) =>
      new TextMeasurement(text, addon.measureText(text, style, wrapWidth)),
    layoutInline: (items, width, options = {}) =>
      toInlineLayout(addon, items, width, options.align ?? 'left', options.breakWords ?? false),
    createReactive: (scope?: Scope) =>
      new ReactiveContext((dispatch) => new addon.NativeGraph(dispatch), scope),
    gpu: bindGpu({ call: addon.gpuCall }),
    window: bindWindow({ call: addon.windowCall }),
  };
}
