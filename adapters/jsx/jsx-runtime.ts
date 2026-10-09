/**
 * A minimal JSX runtime on the blinc_ts host interface, for TypeScript's
 * `react-jsx` transform. It builds host nodes once from the JSX tree; there
 * is no virtual DOM diffing. Components are functions of their props, and a
 * `ref` callback receives the host node, which a component can change later.
 */
import type { Host, HostElement, HostEventListener, HostNode } from 'blinc_ts/native/host';

export const Fragment = Symbol.for('blinc.jsx.fragment');
export type Child = JsxNode | string | number | boolean | null | undefined | readonly Child[];
export type Component<P = Record<string, unknown>> = (props: P) => Child;
export interface JsxNode {
  readonly type: string | typeof Fragment | Component<never>;
  readonly props: Readonly<Record<string, unknown>>;
}

export function jsx(type: JsxNode['type'], props: Record<string, unknown>): JsxNode {
  return { type, props };
}
export const jsxs = jsx;
export const jsxDEV = jsx;

/** Build `child` under `parent` (the root by default) and return the top-level nodes made. */
export function render(host: Host, child: Child, parent: HostElement = host.root): HostNode[] {
  const made: HostNode[] = [];
  build(host, child, (node) => {
    parent.appendChild(node);
    made.push(node);
  });
  return made;
}

function build(host: Host, child: Child, place: (node: HostNode) => void): void {
  if (child === null || child === undefined || typeof child === 'boolean') {
    return;
  }
  if (typeof child === 'string' || typeof child === 'number') {
    place(host.createTextNode(String(child)));
    return;
  }
  if (Array.isArray(child)) {
    for (const item of child as readonly Child[]) {
      build(host, item, place);
    }
    return;
  }
  const { type, props } = child as JsxNode;
  if (type === Fragment) {
    build(host, props.children as Child, place);
    return;
  }
  if (typeof type === 'function') {
    build(host, (type as Component)(props), place);
    return;
  }
  const element = host.createElement(type);
  for (const [name, value] of Object.entries(props)) {
    applyProp(element, name, value);
  }
  build(host, props.children as Child, (node) => element.appendChild(node));
  place(element);
  (props.ref as ((node: HostElement) => void) | undefined)?.(element);
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function text(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  throw new TypeError('Attribute values are strings, numbers or booleans');
}

function applyProp(element: HostElement, name: string, value: unknown): void {
  if (name === 'children' || name === 'ref' || name === 'key' || value === undefined) {
    return;
  }
  if (name === 'style') {
    if (typeof value === 'string') {
      element.setAttribute('style', value);
    } else {
      for (const [property, v] of Object.entries(value as Record<string, unknown>)) {
        element.setProperty(kebab(property), v as never);
      }
    }
  } else if (name === 'class' || name === 'className') {
    element.className = text(value);
  } else if (/^on[A-Z]/.test(name)) {
    const capture = name.endsWith('Capture');
    const type = name.slice(2, capture ? -7 : undefined).toLowerCase();
    element.addEventListener(type, value as HostEventListener, { capture });
  } else {
    element.setAttribute(name, text(value));
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace JSX {
  export type Element = JsxNode;
  export type IntrinsicElements = Record<string, Record<string, unknown>>;
  export interface ElementChildrenAttribute {
    children: unknown;
  }
}
