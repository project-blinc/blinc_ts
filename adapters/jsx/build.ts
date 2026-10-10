/**
 * Building host nodes from JSX descriptions. A description is built once, where it is placed;
 * what changes later is a prop given as a source (a signal, a computed value or a function) or
 * a child that is one, which rebuild or rewrite only what depends on them. A region keeps its
 * place between two anchors, so what it holds can be replaced without disturbing its siblings.
 */
import type { Computed, Signal } from 'blinc_ts/native';
import type {
  Host,
  HostElement,
  HostEventListener,
  HostNode,
  HostText,
} from 'blinc_ts/native/host';
import { Owner, isSource, read, runWithOwner } from './owner.js';

export const Fragment = Symbol.for('blinc.jsx.fragment');
export const Direct = Symbol.for('blinc.jsx.direct');

export type Child =
  | JsxNode
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly Child[]
  | Signal<Child>
  | Computed<Child>
  | (() => Child);
export type Component<P = Record<string, unknown>> = (props: P) => Child;
export interface JsxNode {
  readonly type: string | typeof Fragment | typeof Direct | Component<never>;
  readonly props: Readonly<Record<string, unknown>>;
}

/** Where a node goes: called for each node a build makes at the top, in order. */
export type Place = (node: HostNode) => void;

/** What a node that builds itself is given. */
export interface Placement {
  readonly host: Host;
  readonly place: Place;
  readonly owner: Owner;
}

/** A node that builds itself where it is placed, for what needs the host and a place: control flow. */
export function direct(run: (at: Placement) => void): JsxNode {
  return { type: Direct, props: { run } };
}

/** Build `child` and hand each node it makes at the top to `place`, in order, under `owner`. */
export function build(host: Host, child: Child, place: Place, owner: Owner): void {
  if (child === null || child === undefined || typeof child === 'boolean') {
    return;
  }
  if (typeof child === 'string' || typeof child === 'number') {
    place(host.createTextNode(String(child)));
    return;
  }
  if (Array.isArray(child)) {
    for (const item of child as readonly Child[]) {
      build(host, item, place, owner);
    }
    return;
  }
  if (isSource(child)) {
    region(host, child as () => Child, place, owner);
    return;
  }
  const { type, props } = child as JsxNode;
  if (type === Fragment) {
    build(host, props.children as Child, place, owner);
    return;
  }
  if (type === Direct) {
    (props.run as (at: Placement) => void)({ host, place, owner });
    return;
  }
  if (typeof type === 'function') {
    build(
      host,
      runWithOwner(owner, () => (type as Component)(props)),
      place,
      owner,
    );
    return;
  }
  const element = host.createElement(type);
  for (const [name, value] of Object.entries(props)) {
    applyProp(element, name, value, owner);
  }
  build(host, props.children as Child, (node) => element.appendChild(node), owner);
  place(element);
  (props.ref as ((node: HostElement) => void) | undefined)?.(element);
}

/** Destroy every node between `start` and `end`, which stay. */
export function removeBetween(start: HostNode, end: HostNode): void {
  for (let node = start.nextSibling; node && node !== end; node = start.nextSibling) {
    node.destroy();
  }
}

/**
 * A child that changes. `source` is read again whenever what it read changes: text is rewritten
 * in place, and anything else is built anew in a fresh owner, after the last is ended and its
 * nodes removed. A region made while another is updating is built when that one has finished.
 */
export function region(host: Host, source: () => Child, place: Place, owner: Owner): void {
  const context = owner.reactive();
  const start = host.createComment('[');
  const end = host.createComment(']');
  place(start);
  place(end);
  let inner: Owner | null = null;
  let text: HostText | null = null;
  owner.scope.onCleanup(() => {
    inner?.dispose();
    inner = null;
  });
  context.effect(() => {
    const next = new Owner(context, owner, false);
    // Read under the new owner, which a rebuild's signals and cleanups belong to.
    const value = runWithOwner(next, () => read(source) as Child);
    const plain = typeof value === 'string' || typeof value === 'number';
    context.untrack(() => {
      if (plain && text) {
        text.data = String(value);
        return;
      }
      inner?.dispose();
      inner = null;
      text = null;
      removeBetween(start, end);
      const parent = end.parentNode;
      if (value === null || value === undefined || typeof value === 'boolean' || !parent) {
        return;
      }
      inner = next;
      runWithOwner(next, () => build(host, value, (node) => parent.insertBefore(node, end), next));
      if (plain) {
        text = start.nextSibling as HostText;
      }
    });
    if (inner !== next) {
      next.dispose();
    }
  }, owner.scope);
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

/** The properties a style object set, so a later object can take away what it no longer has. */
function applyStyle(
  element: HostElement,
  value: unknown,
  before: ReadonlySet<string>,
): Set<string> {
  const names = new Set<string>();
  if (typeof value === 'string') {
    element.setAttribute('style', value);
  } else if (value && typeof value === 'object') {
    for (const [property, v] of Object.entries(value)) {
      names.add(kebab(property));
      element.setProperty(kebab(property), v as never);
    }
  }
  for (const name of before) {
    if (!names.has(name)) {
      element.setProperty(name, null);
    }
  }
  if (value === null || value === undefined || value === false) {
    element.removeAttribute('style');
  }
  return names;
}

/**
 * Give `element` the attribute `name`: nothing takes it away, and a boolean is the attribute
 * present or absent, except where the name says it holds a word (`aria-` and `data-`).
 */
function assign(element: HostElement, name: string, value: unknown): void {
  if (name === 'class' || name === 'className') {
    element.className = value === null || value === undefined || value === false ? '' : text(value);
  } else if (value === null || value === undefined) {
    element.removeAttribute(name);
  } else if (typeof value === 'boolean' && !/^(aria|data)-/.test(name)) {
    if (value) {
      element.setAttribute(name, '');
    } else {
      element.removeAttribute(name);
    }
  } else {
    element.setAttribute(name, text(value));
  }
}

/** Keep `name` equal to `source`: set now, and again when it changes. */
function bind(element: HostElement, name: string, source: () => unknown, owner: Owner): void {
  const context = owner.reactive();
  const unset = Symbol('unset');
  let applied: unknown = unset;
  let styled: ReadonlySet<string> = new Set();
  const put = (value: unknown): void => {
    if (element.destroyed || Object.is(value, applied)) {
      return;
    }
    applied = value;
    if (name === 'style') {
      styled = applyStyle(element, value, styled);
    } else {
      assign(element, name, value);
    }
  };
  // Set at once, so what a ref reads is right even where the effect first runs later.
  put(context.untrack(() => read(source)));
  context.effect(() => put(read(source)), owner.scope);
}

function applyProp(element: HostElement, name: string, value: unknown, owner: Owner): void {
  if (name === 'children' || name === 'ref' || name === 'key' || value === undefined) {
    return;
  }
  if (/^on[A-Z]/.test(name)) {
    const capture = name.endsWith('Capture');
    const type = name.slice(2, capture ? -7 : undefined).toLowerCase();
    element.addEventListener(type, value as HostEventListener, { capture });
  } else if (isSource(value)) {
    bind(element, name, value as () => unknown, owner);
  } else if (name === 'style') {
    if (typeof value === 'string' || value === null) {
      applyStyle(element, value, new Set());
      return;
    }
    // Each property of a style object may be a source of its own.
    for (const [property, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSource(v)) {
        bindProperty(element, kebab(property), v as () => unknown, owner);
      } else {
        element.setProperty(kebab(property), v as never);
      }
    }
  } else {
    assign(element, name, value);
  }
}

function bindProperty(
  element: HostElement,
  name: string,
  source: () => unknown,
  owner: Owner,
): void {
  const context = owner.reactive();
  const put = (value: unknown): void => {
    if (!element.destroyed) {
      element.setProperty(name, value as never);
    }
  };
  put(context.untrack(() => read(source)));
  context.effect(() => put(read(source)), owner.scope);
}
