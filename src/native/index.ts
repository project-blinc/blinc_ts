import { ReactiveContext, type NativeGraph } from './reactive.js';
export { ReactiveContext, Signal, Computed } from './reactive.js';
export type { GraphStats, Disposable } from './reactive.js';
import type { Scope } from '../hmr.js';
import { Layout, type NativeLayout } from './layout.js';
export { Layout, LayoutNode } from './layout.js';
export type { LayoutStyle, LayoutLength } from './layout.js';
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
  NativeLayout: new () => NativeLayout;
  NativeGraph: new () => NativeGraph;
  buildProfile(): string;
  gpuCall: NativeBinding['call'];
  windowCall: NativeBinding['call'];
  layoutCall: NativeBinding['call'];
}
export interface NativeBindings {
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
  return {
    buildProfile: addon.buildProfile(),
    createLayout: (scope?: Scope) => new Layout(new addon.NativeLayout(), scope),
    createReactive: (scope?: Scope) => new ReactiveContext(new addon.NativeGraph(), scope),
    gpu: bindGpu({ call: addon.gpuCall }),
    window: bindWindow({ call: addon.windowCall }),
  };
}
