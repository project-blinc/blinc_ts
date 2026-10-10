/**
 * A JSX runtime on the blinc_ts host interface, for TypeScript's `react-jsx` transform. There is
 * no virtual DOM: a description is built into host nodes once, where it is placed. What changes
 * later is a prop or a child given as a source (a signal, a computed value, or a function of
 * them), which updates only what depends on it; `Show`, `For` and `Switch` (./flow) rebuild
 * parts of the tree. Components are functions of their props, and run under an owner, so what
 * they make (signals, effects, `onCleanup`) ends with the part of the view that holds them.
 * A `ref` callback receives the host node.
 */
import type { ReactiveContext } from 'blinc_ts/native';
import type { Scope } from 'blinc_ts/hmr';
import type { Host, HostElement, HostNode } from 'blinc_ts/native/host';
import { Fragment, build, removeBetween } from './build.js';
import type { Child, Component, JsxNode } from './build.js';
import { Owner, runWithOwner } from './owner.js';

export { Fragment };
export type { Child, Component, JsxNode };

export function jsx(type: JsxNode['type'], props: Record<string, unknown>): JsxNode {
  return { type, props };
}
export const jsxs = jsx;
export const jsxDEV = jsx;

/**
 * Build `child` under `parent` (the root by default) and return the top-level nodes made. The
 * view cannot change: a source in it is an error, since nothing would update it. See `mount`.
 */
export function render(host: Host, child: Child, parent: HostElement = host.root): HostNode[] {
  const made: HostNode[] = [];
  const owner = new Owner(null);
  runWithOwner(owner, () =>
    build(
      host,
      child,
      (node) => {
        parent.appendChild(node);
        made.push(node);
      },
      owner,
    ),
  );
  return made;
}

export interface MountOptions {
  /** What the view's signals, computed values and effects live in. */
  readonly context: ReactiveContext;
  /** Where the view goes; the host's root by default. */
  readonly parent?: HostElement;
  /** Ends the view when it ends. */
  readonly scope?: Scope;
}

/**
 * Build `view` under `options.parent` as a view that updates: a prop or a child that is a source
 * follows it. Returns the function that ends it, which removes what it built and stops what it
 * started.
 */
export function mount(host: Host, view: Child, options: MountOptions): () => void {
  const parent = options.parent ?? host.root;
  const owner = new Owner(options.context);
  const start = parent.appendChild(host.createComment('<'));
  const end = parent.appendChild(host.createComment('>'));
  let mounted = true;
  const unmount = (): void => {
    if (!mounted) {
      return;
    }
    mounted = false;
    owner.dispose();
    if (!start.destroyed) {
      removeBetween(start, end);
      start.destroy();
      end.destroy();
    }
  };
  options.scope?.onCleanup(unmount);
  try {
    runWithOwner(owner, () => build(host, view, (node) => parent.insertBefore(node, end), owner));
  } catch (error) {
    unmount();
    throw error;
  }
  return unmount;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace JSX {
  export type Element = JsxNode;
  /** A component may return anything a view can show: text, a list, a source. */
  export type ElementType = string | ((props: never) => Child);
  export type IntrinsicElements = Record<string, Record<string, unknown>>;
  export interface ElementChildrenAttribute {
    children: unknown;
  }
}
