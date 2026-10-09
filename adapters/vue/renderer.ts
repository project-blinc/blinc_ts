/**
 * A Vue custom renderer on the blinc_ts host interface. Vue's own
 * reactivity drives updates; the host coalesces the writes of each tick.
 */
import { createRenderer, type App, type Component, type RendererOptions } from '@vue/runtime-core';
import { type HostElement, HostText, type Host, type HostNode } from 'blinc_ts/native/host';

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** One listener per element and event, whose handler Vue swaps without re-registering. */
interface Invoker {
  (event: unknown): void;
  handler: ((event: unknown) => void) | ((event: unknown) => void)[];
}
const invokers = new WeakMap<HostElement, Map<string, Invoker>>();

function patchEvent(element: HostElement, key: string, next: unknown): void {
  const capture = key.endsWith('Capture');
  const type = key.slice(2, capture ? -7 : undefined).toLowerCase();
  const slot = `${type}:${capture}`;
  const map = invokers.get(element) ?? new Map<string, Invoker>();
  invokers.set(element, map);
  const existing = map.get(slot);
  if (next && existing) {
    existing.handler = next as Invoker['handler'];
  } else if (next) {
    const invoker = ((event: unknown) => {
      const handler = invoker.handler;
      for (const fn of Array.isArray(handler) ? handler : [handler]) {
        fn(event);
      }
    }) as Invoker;
    invoker.handler = next as Invoker['handler'];
    map.set(slot, invoker);
    element.addEventListener(type, invoker, { capture });
  } else if (existing) {
    element.removeEventListener(type, existing, { capture });
    map.delete(slot);
  }
}

function patchStyle(element: HostElement, previous: unknown, next: unknown): void {
  if (typeof next === 'string') {
    element.setAttribute('style', next);
    return;
  }
  const before = (previous && typeof previous === 'object' ? previous : {}) as Record<
    string,
    unknown
  >;
  const after = (next && typeof next === 'object' ? next : {}) as Record<string, unknown>;
  for (const name of Object.keys(before)) {
    if (!(name in after)) {
      element.setProperty(kebab(name), null);
    }
  }
  for (const [name, value] of Object.entries(after)) {
    if (before[name] !== value) {
      element.setProperty(kebab(name), value as never);
    }
  }
}

function nodeOps(host: Host): RendererOptions<HostNode, HostElement> {
  return {
    createElement: (tag) => host.createElement(tag),
    createText: (text) => host.createTextNode(text),
    createComment: (text) => host.createComment(text),
    setText: (node, text) => {
      if (node instanceof HostText) {
        node.data = text;
      }
    },
    setElementText: (element, text) => {
      for (let child = element.firstChild; child; child = element.firstChild) {
        child.destroy();
      }
      if (text) {
        element.appendChild(host.createTextNode(text));
      }
    },
    insert: (child, parent, anchor) => {
      parent.insertBefore(child, anchor ?? null);
    },
    remove: (child) => {
      child.destroy();
    },
    parentNode: (node) => node.parentNode,
    nextSibling: (node) => node.nextSibling,
    patchProp: (element, key, previous, next) => {
      if (key === 'style') {
        patchStyle(element, previous, next);
      } else if (key === 'class') {
        element.className = next === null || next === undefined ? '' : String(next as string);
      } else if (/^on[A-Z]/.test(key)) {
        patchEvent(element, key, next);
      } else if (next === null || next === undefined || next === false) {
        element.removeAttribute(key);
      } else {
        element.setAttribute(key, String(next as string));
      }
    },
  };
}

/** A Vue app rendering into `host.root`, or into `container` when given. */
export function createApp(
  host: Host,
  root: Component,
  container: HostElement = host.root,
): { app: App<HostElement>; mount(): void; unmount(): void } {
  const renderer = createRenderer(nodeOps(host));
  const app = renderer.createApp(root);
  return {
    app,
    mount: () => {
      app.mount(container);
    },
    unmount: () => {
      app.unmount();
    },
  };
}
