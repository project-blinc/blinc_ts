/**
 * The host interface framework adapters render through: elements by tag,
 * text nodes, DOM-shaped tree operations, properties by CSS name,
 * attributes, events, and reading geometry back. It knows no framework and
 * does not need the SDK's reactive graph; binding a signal to a property is
 * an optional fast path. Writes in one tick coalesce and are submitted
 * together.
 *
 * Styling is CSS, run by the native engine: each element's tag, id,
 * classes, attributes, states and properties (its inline declarations) go
 * to the layout context's cascade, with stylesheets added to the layout.
 * Layout declarations apply natively; paint and text declarations come back
 * from each restyle, and the host draws with them.
 */
import type { Scope } from '../hmr.js';
import { Brush } from './brush.js';
import {
  HostEvent,
  HostEventTarget,
  HostPointerEvent,
  type HostPointerEventInit,
} from './events.js';
import { window as win } from './index.js';
import { Input, WHEEL_LINE } from './input.js';
import type { HitCache, Layout, LayoutNode, Restyled } from './layout.js';
import { MemoryClipboard, SystemClipboard, type Clipboard } from './clipboard.js';
import type { Computed, Disposable, ReactiveContext, Signal } from './reactive.js';
import type { Color, CornerRadii, PaintShadow, PaintStyle, TextStyle } from './scene.js';
import type { ShapeTokens } from '../theme/shape.js';
import type { NativeBindings } from './index.js';
import type { NativeWindowHost, WindowSceneOptions } from './window.js';
import type { InteractionState } from './input.js';

/** The built-in element names, after HTML's. Other valid names make plain boxes. */
export const builtinTags: ReadonlySet<string> = new Set([
  'div',
  'span',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'button',
  'label',
  'input',
  'textarea',
  'select',
  'option',
  'optgroup',
  'form',
  'fieldset',
  'legend',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'img',
  'svg',
  'canvas',
  'details',
  'summary',
  'dialog',
  'progress',
  'meter',
  'section',
  'header',
  'footer',
  'nav',
  'main',
  'article',
  'aside',
]);

export type PropertyValue = string | number | Brush | Color | null | undefined;

/** Text properties, read from a text node's declarations, which inherit them. */
const textProperties: Readonly<Record<string, (style: TextStyle, value: string | number) => void>> =
  {
    'font-size': (s, v) => (s.fontSize = px(v)),
    'line-height': (s, v) => (s.lineHeight = Number(v)),
    'letter-spacing': (s, v) => (s.letterSpacing = px(v)),
    'font-family': (s, v) => (s.fontFamily = String(v)),
    'font-weight': (s, v) => (s.fontWeight = v === 'bold' ? 700 : v === 'normal' ? 400 : Number(v)),
    'font-style': (s, v) => (s.italic = v === 'italic' || v === 'oblique'),
    'white-space': (s, v) => (s.wrap = v !== 'nowrap' && v !== 'pre'),
  };
function px(value: string | number): number {
  const n = typeof value === 'number' ? value : Number(value.trim().replace(/px$/, ''));
  if (!Number.isFinite(n)) {
    throw new TypeError(`Expected a pixel length, not ${value}`);
  }
  return n;
}

const named: Readonly<Record<string, number>> = {
  black: 0x000000,
  white: 0xffffff,
  red: 0xff0000,
  green: 0x008000,
  blue: 0x0000ff,
  gray: 0x808080,
  grey: 0x808080,
  yellow: 0xffff00,
  orange: 0xffa500,
  purple: 0x800080,
};
/** A CSS color: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, a few names, or channels. */
export function parseColor(value: string | Color): Color {
  if (typeof value !== 'string') {
    return value;
  }
  const text = value.trim().toLowerCase();
  if (text === 'transparent') {
    return [0, 0, 0, 0];
  }
  const name = named[text];
  if (name !== undefined) {
    return [(name >> 16) / 255, ((name >> 8) & 255) / 255, (name & 255) / 255, 1];
  }
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    const channels = full.match(/../g)!.map((pair) => parseInt(pair, 16) / 255);
    return [channels[0]!, channels[1]!, channels[2]!, channels[3] ?? 1];
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(text)?.[1];
  if (fn) {
    const parts = fn.split(/[\s,/]+/).filter(Boolean);
    if (parts.length === 3 || parts.length === 4) {
      const channel = (part: string, max: number) =>
        part.endsWith('%') ? Number(part.slice(0, -1)) / 100 : Number(part) / max;
      const color = [
        channel(parts[0]!, 255),
        channel(parts[1]!, 255),
        channel(parts[2]!, 255),
        parts[3] === undefined ? 1 : channel(parts[3], 1),
      ];
      if (color.every((c) => Number.isFinite(c) && c >= 0 && c <= 1)) {
        return color as unknown as Color;
      }
    }
  }
  throw new TypeError(`Unsupported color: ${value}`);
}

function radii(value: PropertyValue): CornerRadii {
  if (typeof value === 'number') {
    return [value, value, value, value];
  }
  if (typeof value !== 'string') {
    throw new TypeError('border-radius takes pixels');
  }
  const parts = value.trim().split(/\s+/).map(px);
  const [a, b = a, c = a, d = b] = parts as [number, number?, number?, number?];
  return [a, b, c, d];
}

/** Properties whose numbers are plain numbers; a number for any other is pixels. */
const unitless: ReadonlySet<string> = new Set([
  'opacity',
  'flex',
  'flex-grow',
  'flex-shrink',
  'order',
  'z-index',
  'line-height',
  'font-weight',
  'aspect-ratio',
]);

/** The root's properties that set the corner smoothing of everything drawn, over the theme's. */
const shapeProperties: Readonly<Record<string, keyof ShapeTokens>> = {
  'corner-smoothing': 'cornerSmoothing',
  'corner-exponent': 'cornerExponent',
  'smoothing-threshold': 'smoothingThreshold',
};

/** Properties the host reads itself beyond paint, text and layout. */
const otherProperties: ReadonlySet<string> = new Set(['cursor', ...Object.keys(shapeProperties)]);

/** `value` split at top-level `separator`s, outside parentheses. */
function splitTop(value: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
    } else if (depth === 0 && separator.test(c)) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

const cornerKeywords: Readonly<Record<string, number>> = {
  round: 1,
  squircle: 2,
  bevel: 0,
  scoop: -1,
  notch: -100,
  square: 100,
};
/**
 * `corner-shape`: one to four of `round`, `squircle`, `bevel`, `scoop`,
 * `notch`, `square` or `superellipse(n)`, top-left first, and `locked` to
 * keep them whatever the theme's smoothing.
 */
function cornerShape(value: PropertyValue): PaintStyle {
  if (value === null) {
    return { cornerShape: [1, 1, 1, 1], cornerShapeLocked: false };
  }
  if (typeof value !== 'string') {
    throw new TypeError('corner-shape takes keywords or superellipse(n)');
  }
  const words = splitTop(value.toLowerCase(), /\s/);
  const locked = words.includes('locked');
  const shapes = words
    .filter((word) => word !== 'locked')
    .map((word) => {
      const keyword = cornerKeywords[word];
      if (keyword !== undefined) {
        return keyword;
      }
      const n = /^superellipse\(([^)]*)\)$/.exec(word)?.[1];
      const parsed = n === undefined ? NaN : Number(n.trim() === 'infinity' ? Infinity : n);
      if (!Number.isFinite(parsed)) {
        throw new TypeError(
          `Expected round, squircle, bevel, scoop, notch, square or superellipse(n), not ${word}`,
        );
      }
      return parsed;
    });
  if (shapes.length < 1 || shapes.length > 4) {
    throw new TypeError('corner-shape takes one to four shapes');
  }
  const [a, b = a, c = a, d = b] = shapes as [number, number?, number?, number?];
  return { cornerShape: [a, b, c, d], cornerShapeLocked: locked };
}

/** `box-shadow`: `none`, or layers of two to four lengths, a colour and `inset`. */
function boxShadow(value: PropertyValue): PaintStyle {
  if (value === null || value === 'none') {
    return { shadows: [] };
  }
  if (typeof value !== 'string') {
    throw new TypeError('box-shadow takes CSS text');
  }
  const shadows = splitTop(value, /,/).map((layer): PaintShadow => {
    const lengths: number[] = [];
    let color: Color = [0, 0, 0, 1];
    let inset = false;
    for (const word of splitTop(layer, /\s/)) {
      if (word === 'inset') {
        inset = true;
        continue;
      }
      if (/^-?(\d+\.?\d*|\.\d+)(px)?$/.test(word)) {
        lengths.push(px(word));
      } else {
        color = parseColor(word);
      }
    }
    if (lengths.length < 2 || lengths.length > 4) {
      throw new TypeError('a shadow takes two to four lengths');
    }
    const [x, y, blur = 0, spread = 0] = lengths as [number, number, number?, number?];
    return { x, y, blur: Math.max(blur, 0), spread, color, ...(inset ? { inset } : {}) };
  });
  return { shadows };
}

/** Paint properties by CSS name. A null value clears the field. */
const paintProperties: Readonly<Record<string, (value: PropertyValue) => PaintStyle>> = {
  background: (v) => ({
    background:
      v instanceof Brush
        ? v
        : Brush.solid(v === null ? [0, 0, 0, 0] : parseColor(v as string | Color)),
  }),
  'background-color': (v) => paintProperties.background!(v),
  color: (v) => ({ textColor: v === null ? [0, 0, 0, 1] : parseColor(v as string | Color) }),
  opacity: (v) => ({ opacity: v === null ? 1 : Number(v) }),
  'border-radius': (v) => ({ radius: v === null ? [0, 0, 0, 0] : radii(v) }),
  'border-color': (v) => ({
    borderColor: v === null ? [0, 0, 0, 0] : parseColor(v as string | Color),
  }),
  visibility: (v) => ({ visible: v !== 'hidden' }),
  'corner-shape': cornerShape,
  'box-shadow': boxShadow,
};

/** A node of the host tree: an element or a text node. */
export abstract class HostNode extends HostEventTarget {
  readonly host: Host;
  /** @internal */
  readonly layoutNode: LayoutNode;
  #parent: HostElement | null = null;
  #next: HostNode | null = null;
  #previous: HostNode | null = null;
  #removed = false;

  /** @internal */
  constructor(host: Host, layoutNode: LayoutNode) {
    super();
    this.host = host;
    this.layoutNode = layoutNode;
  }
  get parentNode(): HostElement | null {
    return this.#parent;
  }
  get nextSibling(): HostNode | null {
    return this.#next;
  }
  get previousSibling(): HostNode | null {
    return this.#previous;
  }
  get eventParent(): HostEventTarget | null {
    return this.#parent;
  }
  /** Whether `destroy` released this node; a removed node cannot be used again. */
  get destroyed(): boolean {
    return this.#removed;
  }
  /** Take this node out of its parent. It can be inserted again. */
  remove(): void {
    this.#parent?.removeChild(this);
  }
  /** Absolute x, y, width and height after layout, in layout units. */
  bounds(): [x: number, y: number, width: number, height: number] {
    return this.host.boundsOf(this);
  }
  /** @internal Link bookkeeping, called by HostElement. */
  static link(
    node: HostNode,
    parent: HostElement | null,
    previous: HostNode | null,
    next: HostNode | null,
  ): void {
    node.#parent = parent;
    node.#previous = previous;
    node.#next = next;
  }
  /** @internal */
  static setNext(node: HostNode, next: HostNode | null): void {
    node.#next = next;
  }
  /** @internal */
  static setPrevious(node: HostNode, previous: HostNode | null): void {
    node.#previous = previous;
  }
  /** @internal */
  static markDestroyed(node: HostNode): void {
    node.#removed = true;
  }
  /** The text this node and its descendants show. */
  abstract get textContent(): string;
  /** Release this node and its subtree, natively and in the host; it cannot be used again. */
  abstract destroy(): void;
}

export class HostText extends HostNode {
  #data: string;
  /** @internal */
  constructor(host: Host, layoutNode: LayoutNode, data: string) {
    super(host, layoutNode);
    this.#data = data;
  }
  get data(): string {
    return this.#data;
  }
  set data(value: string) {
    if (value !== this.#data) {
      this.#data = value;
      this.host.textChanged(this);
    }
  }
  get nodeValue(): string {
    return this.#data;
  }
  set nodeValue(value: string) {
    this.data = value;
  }
  get textContent(): string {
    return this.#data;
  }
  destroy(): void {
    this.host.destroyNode(this);
  }
}

/** A placeholder renderers keep between nodes, as DOM comments are used: it takes no space. */
export class HostComment extends HostNode {
  readonly data: string;
  /** @internal */
  constructor(host: Host, layoutNode: LayoutNode, data: string) {
    super(host, layoutNode);
    this.data = data;
  }
  // An accessor, as the base class declares it.
  // eslint-disable-next-line @typescript-eslint/class-literal-property-style
  get textContent(): string {
    return '';
  }
  destroy(): void {
    this.host.destroyNode(this);
  }
}

/** Space-separated classes, after the DOM's classList. Kept for the CSS cascade. */
export class ClassList {
  readonly #classes = new Set<string>();
  readonly #changed: () => void;
  /** @internal */
  constructor(changed: () => void) {
    this.#changed = changed;
  }
  get value(): string {
    return [...this.#classes].join(' ');
  }
  set value(text: string) {
    this.#classes.clear();
    for (const name of text.split(/\s+/)) {
      if (name) {
        this.#classes.add(name);
      }
    }
    this.#changed();
  }
  get length(): number {
    return this.#classes.size;
  }
  contains(name: string): boolean {
    return this.#classes.has(name);
  }
  add(...names: string[]): void {
    names.forEach((name) => this.#classes.add(name));
    this.#changed();
  }
  remove(...names: string[]): void {
    names.forEach((name) => this.#classes.delete(name));
    this.#changed();
  }
  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.#classes.has(name);
    if (on) {
      this.#classes.add(name);
    } else {
      this.#classes.delete(name);
    }
    this.#changed();
    return on;
  }
  [Symbol.iterator](): IterableIterator<string> {
    return this.#classes.values();
  }
}

export class HostElement extends HostNode {
  readonly tag: string;
  readonly classList: ClassList;
  #first: HostNode | null = null;
  #last: HostNode | null = null;
  readonly #attributes = new Map<string, string>();
  /** Its own declarations, as `setProperty` and the `style` attribute give them. */
  readonly #inline = new Map<string, string>();
  /** Properties named by the last `style` attribute string, cleared when it changes. */
  #styleNames: string[] = [];
  #bindings: Map<string, Disposable> | undefined;

  /** @internal */
  constructor(host: Host, layoutNode: LayoutNode, tag: string) {
    super(host, layoutNode);
    this.tag = tag;
    this.classList = new ClassList(() => {
      this.#attributes.set('class', this.classList.value);
      host.styleChanged(this);
    });
  }
  get firstChild(): HostNode | null {
    return this.#first;
  }
  get lastChild(): HostNode | null {
    return this.#last;
  }
  get childNodes(): HostNode[] {
    const nodes: HostNode[] = [];
    for (let node = this.#first; node; node = node.nextSibling) {
      nodes.push(node);
    }
    return nodes;
  }
  get id(): string {
    return this.#attributes.get('id') ?? '';
  }
  set id(value: string) {
    this.#attributes.set('id', value);
    this.host.styleChanged(this);
  }
  get className(): string {
    return this.classList.value;
  }
  set className(value: string) {
    this.classList.value = value;
  }
  get textContent(): string {
    return this.childNodes.map((node) => node.textContent).join('');
  }

  getAttribute(name: string): string | null {
    return this.#attributes.get(name) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.#attributes.has(name);
  }
  get attributeNames(): string[] {
    return [...this.#attributes.keys()];
  }
  /** Stored for selectors. `class` sets the class list and `style` sets properties. */
  setAttribute(name: string, value: string): void {
    if (name === 'class') {
      this.classList.value = value;
      return;
    }
    this.#attributes.set(name, value);
    if (name === 'style') {
      this.#applyStyleText(value);
    }
    this.host.styleChanged(this);
    this.host.input.attributeChanged(this, name);
  }
  removeAttribute(name: string): void {
    if (name === 'class') {
      this.classList.value = '';
    } else if (name === 'style') {
      this.#applyStyleText('');
    }
    this.#attributes.delete(name);
    this.host.styleChanged(this);
    this.host.input.attributeChanged(this, name);
  }
  #applyStyleText(text: string): void {
    const names: string[] = [];
    for (const declaration of text.split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) {
        continue;
      }
      const name = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).trim();
      if (name) {
        names.push(name);
        this.setProperty(name, value);
      }
    }
    for (const name of this.#styleNames) {
      if (!names.includes(name)) {
        this.setProperty(name, null);
      }
    }
    this.#styleNames = names;
  }

  /**
   * Set a property by CSS name, as an inline declaration the cascade puts
   * over the stylesheets'. Numbers are pixels where a length is meant; null
   * or undefined removes it. A `Brush`, or a color as channels, sets paint
   * directly, over the cascade. Throws for an unknown property; a value that
   * does not parse is reported by the restyle (see `Host.onStyleErrors`).
   */
  setProperty(name: string, value: PropertyValue): void {
    this.host.setProperty(this, name, value);
  }
  /** Its inline declarations. */
  get style(): ReadonlyMap<string, string> {
    return this.#inline;
  }
  /** @internal */
  setInline(name: string, value: string | null): void {
    if (value === null) {
      this.#inline.delete(name);
    } else {
      this.#inline.set(name, value);
    }
    this.host.styleChanged(this);
  }
  /** @internal Its attributes, for the cascade's attribute selectors. */
  get attributeEntries(): IterableIterator<[string, string]> {
    return this.#attributes.entries();
  }

  /**
   * The optional fast path: keep property `name` equal to `source` without
   * the framework handling each change. The binding ends when the node is
   * destroyed, the returned handle is disposed, or the property is bound again.
   */
  bindProperty<V extends PropertyValue>(
    name: string,
    source: Signal<V> | Computed<V>,
    context: ReactiveContext,
  ): Disposable {
    this.#bindings?.get(name)?.dispose();
    const effect = context.effect(() => {
      this.setProperty(name, source.get());
    });
    const binding: Disposable = {
      dispose: () => {
        effect.dispose();
        if (this.#bindings?.get(name) === binding) {
          this.#bindings.delete(name);
        }
      },
    };
    (this.#bindings ??= new Map()).set(name, binding);
    return binding;
  }

  /**
   * Place `child` before `reference`, or last when it is null, moving it
   * from wherever it is. One native edit; siblings are not resubmitted.
   */
  insertBefore<T extends HostNode>(child: T, reference: HostNode | null = null): T {
    if (reference && reference.parentNode !== this) {
      throw new Error('Reference node is not a child of this element');
    }
    if (child === reference) {
      return child;
    }
    if (contains(child, this)) {
      throw new Error('Host edit would create a cycle');
    }
    this.host.assertOwn(child);
    this.layoutNode.queueInsertBefore(child.layoutNode, reference?.layoutNode ?? null);
    child.parentNode?.unlink(child);
    const previous = reference ? reference.previousSibling : this.#last;
    HostNode.link(child, this, previous, reference);
    if (previous) {
      HostNode.setNext(previous, child);
    } else {
      this.#first = child;
    }
    if (reference) {
      HostNode.setPrevious(reference, child);
    } else {
      this.#last = child;
    }
    return child;
  }
  appendChild<T extends HostNode>(child: T): T {
    return this.insertBefore(child, null);
  }
  removeChild<T extends HostNode>(child: T): T {
    if (child.parentNode !== this) {
      throw new Error('Node is not a child of this element');
    }
    child.layoutNode.queueDetach();
    this.unlink(child);
    return child;
  }
  /** @internal Unlink in JavaScript only; the native edit was already made. */
  unlink(child: HostNode): void {
    const previous = child.previousSibling;
    const next = child.nextSibling;
    if (previous) {
      HostNode.setNext(previous, next);
    } else {
      this.#first = next;
    }
    if (next) {
      HostNode.setPrevious(next, previous);
    } else {
      this.#last = previous;
    }
    HostNode.link(child, null, null, null);
  }
  /** Give this element focus, if it can take it. */
  focus(): boolean {
    return this.host.input.focus(this, false);
  }
  blur(): void {
    if (this.host.input.focused === this) {
      this.host.input.blur();
    }
  }
  /** Hover, active, focus, focus-visible and focus-within, as CSS pseudo-classes match them. */
  get interaction(): Readonly<InteractionState> {
    return this.host.input.stateOf(this);
  }
  get scrollLeft(): number {
    return this.host.scrollOf(this)[0];
  }
  get scrollTop(): number {
    return this.host.scrollOf(this)[1];
  }
  /** Scroll this element's content to (x, y), unclamped, dispatching `scroll`. */
  scrollTo(x: number, y: number): void {
    this.host.scrollTo(this, x, y);
  }
  setPointerCapture(): void {
    this.host.input.setPointerCapture(this);
  }
  releasePointerCapture(): void {
    this.host.input.releasePointerCapture(this);
  }
  /** Release this element, its subtree and their bindings. */
  destroy(): void {
    this.host.destroyNode(this);
  }
  /** @internal */
  disposeBindings(): void {
    for (const binding of [...(this.#bindings?.values() ?? [])]) {
      binding.dispose();
    }
  }
}

export interface HostMountOptions extends WindowSceneOptions {
  scope?: Scope;
}

/**
 * A host tree on one owned layout. `root` fills the viewport; adapters
 * create nodes, place them under it, and mount the host into a window.
 */
export class Host {
  readonly layout: Layout;
  readonly root: HostElement;
  readonly #nodes = new Map<bigint, HostNode>();
  readonly #text = new Set<HostText>();
  readonly #sentText = new WeakMap<HostText, { data: string; style: TextStyle }>();
  /** Each text node's style, from its last restyle. */
  readonly #textStyles = new WeakMap<HostText, TextStyle>();
  /** Nodes whose element (names, attributes, inline declarations) changed. */
  readonly #styleDirty = new Set<HostElement | HostText>();
  /** Each element's paint and text declarations from its last restyle. */
  readonly #declared = new WeakMap<HostNode, ReadonlyMap<string, string>>();
  /** Paint set with a `Brush` or channels, over the cascade's. */
  readonly #paintOverrides = new Map<HostElement, PaintStyle>();
  readonly #styleErrorListeners = new Set<(errors: readonly string[]) => void>();
  readonly #stateBits: ReadonlyMap<string, number>;
  #width = 0;
  #height = 0;
  #computed = false;
  /** Pointer, focus, keyboard and scrolling state, and the entry points a window feeds. */
  readonly input: Input = new Input(this);
  /** Held in the process until the host is mounted in a window, then the system's. */
  clipboard: Clipboard = new MemoryClipboard();
  readonly #cursors = new Map<HostElement, string>();
  #hits: HitCache | undefined;

  constructor(layout: Layout, scope?: Scope) {
    this.layout = layout;
    this.#stateBits = new Map(layout.stateNames.map((name, i) => [name, 1 << i]));
    this.root = this.#register(new HostElement(this, layout.createNode(), 'root'));
    this.styleChanged(this.root);
    this.root.layoutNode.setLayoutProperty('width', '100%');
    this.root.layoutNode.setLayoutProperty('height', '100%');
    layout.beforeFlush(() => {
      this.#queueElements();
      this.#queueText();
    });
    layout.onRestyle((restyled) => this.#restyled(restyled), scope);
    this.input.onInteraction((element, state) => {
      if (!element.destroyed) {
        element.layoutNode.queueStates(this.#bits(element, state));
      }
    });
    layout.onChange((change) => {
      if (change === 'layout') {
        this.#computed = false;
      }
    }, scope);
    scope?.onCleanup(() => this.dispose());
  }

  /** A host on a new layout, released with `scope`. */
  static create(native: NativeBindings, scope?: Scope): Host {
    return new Host(native.createLayout(scope), scope);
  }

  createElement(tag: string): HostElement {
    if (!/^[a-z][a-z0-9-]*$/.test(tag)) {
      throw new Error(`Invalid element name: ${tag}`);
    }
    return this.#register(new HostElement(this, this.layout.createNode(), tag));
  }
  createTextNode(data: string): HostText {
    const layoutNode = this.layout.createText(data, {}, data === '' ? { display: 'none' } : {});
    const node = this.#register(new HostText(this, layoutNode, data));
    this.#sentText.set(node, { data, style: { ...defaultText } });
    this.#text.add(node);
    this.styleChanged(node);
    return node;
  }
  createComment(data = ''): HostComment {
    return this.#register(new HostComment(this, this.layout.createNode({ display: 'none' }), data));
  }
  #register<T extends HostNode>(node: T): T {
    this.#nodes.set(node.layoutNode.id, node);
    return node;
  }
  /** The host node for a native node id, as hit tests report them. */
  nodeById(id: bigint): HostNode | undefined {
    return this.#nodes.get(id);
  }
  /** @internal */
  assertOwn(node: HostNode): void {
    if (node.host !== this || node.destroyed) {
      throw new Error('Node belongs to another host or was destroyed');
    }
  }

  /** @internal */
  setProperty(element: HostElement, name: string, value: PropertyValue): void {
    this.assertOwn(element);
    if (value instanceof Brush || Array.isArray(value)) {
      const paint = paintProperties[name];
      if (!paint) {
        throw new TypeError(`${name} does not take a brush or a color`);
      }
      this.#paintOverrides.set(element, { ...this.#paintOverrides.get(element), ...paint(value) });
      element.layoutNode.queuePaint(paint(value));
      return;
    }
    if (
      !name.startsWith('--') &&
      !paintProperties[name] &&
      !textProperties[name] &&
      !otherProperties.has(name) &&
      !this.layout.isLayoutProperty(name)
    ) {
      throw new Error(`Unknown property: ${name}`);
    }
    if (value === null || value === undefined) {
      if (this.#paintOverrides.get(element)) {
        const overrides = this.#paintOverrides.get(element)!;
        const reset = paintProperties[name]?.(null);
        if (reset) {
          for (const key of Object.keys(reset)) {
            delete overrides[key as keyof PaintStyle];
          }
        }
      }
      element.setInline(name, null);
      return;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new RangeError(`Invalid value for ${name}: ${value}`);
    }
    element.setInline(
      name,
      typeof value === 'number' && !unitless.has(name) ? `${value}px` : String(value),
    );
  }
  /** Called with the declarations a restyle could not apply; with none, they are warnings. */
  onStyleErrors(listener: (errors: readonly string[]) => void): () => void {
    const callback = (errors: readonly string[]) => listener(errors);
    this.#styleErrorListeners.add(callback);
    return () => {
      this.#styleErrorListeners.delete(callback);
    };
  }
  /** @internal A node's names, attributes or inline declarations changed. */
  styleChanged(node: HostElement | HostText): void {
    this.#styleDirty.add(node);
    this.layout.queue();
  }
  /** Describe changed nodes to the cascade, their names as atoms. */
  #queueElements(): void {
    for (const node of this.#styleDirty) {
      if (node.destroyed) {
        continue;
      }
      if (node instanceof HostText) {
        // Text is an element the cascade inherits text properties into, not
        // counted among its siblings by structural selectors.
        const [text] = this.layout.intern(['text']);
        node.layoutNode.queueElement({
          types: [text!],
          id: -1,
          classes: [],
          attributes: [],
          inline: [],
          anonymous: true,
        });
        continue;
      }
      const attributes = [...node.attributeEntries].filter(([name]) => name !== 'style');
      const inline = [...node.style];
      // Names cross as atoms; inline values are free text.
      const names = [
        node.tag,
        ...node.classList,
        ...attributes.flat(),
        ...inline.map(([name]) => name),
        ...(node.id ? [node.id] : []),
      ];
      const atoms = this.layout.intern(names);
      let at = 0;
      const next = () => atoms[at++]!;
      const types = [next()];
      const classes = [...node.classList].map(next);
      const attributePairs = attributes.map(() => [next(), next()] as const);
      const inlinePairs = inline.map(([, value]) => [next(), value] as const);
      const id = node.id ? next() : -1;
      node.layoutNode.queueElement({
        types,
        id,
        classes,
        attributes: attributePairs,
        inline: inlinePairs,
        anonymous: false,
      });
    }
    this.#styleDirty.clear();
  }
  #bits(element: HostElement, state: Readonly<InteractionState>): number {
    const bit = (name: string) => this.#stateBits.get(name) ?? 0;
    let bits = 0;
    const states: [boolean, string][] = [
      [state.hover, 'hover'],
      [state.active, 'active'],
      [state.focus, 'focus'],
      [state.focusVisible, 'focus-visible'],
      [state.focusWithin, 'focus-within'],
      [state.disabled, 'disabled'],
      [!state.disabled && this.input.isFocusable(element, false), 'enabled'],
    ];
    for (const [on, name] of states) {
      if (on) {
        bits |= bit(name);
      }
    }
    return bits;
  }
  /** Apply what a restyle hands back: paint and text, by node. */
  #restyled(restyled: Restyled): void {
    if (restyled.errors.length > 0) {
      if (this.#styleErrorListeners.size === 0) {
        for (const error of restyled.errors) {
          console.warn(`CSS: ${error}`);
        }
      }
      for (const listener of this.#styleErrorListeners) {
        listener(restyled.errors);
      }
    }
    for (const [id, declarations] of restyled.nodes) {
      const node = this.#nodes.get(id);
      if (!node || node.destroyed) {
        continue;
      }
      const now = new Map(declarations);
      const before = this.#declared.get(node) ?? new Map<string, string>();
      this.#declared.set(node, now);
      if (node instanceof HostText) {
        const style: TextStyle = {};
        for (const [name, value] of now) {
          try {
            textProperties[name]?.(style, value);
          } catch {
            // A value the renderer cannot take is left at its default.
          }
        }
        const tracking = /^(-?[\d.]+)em$/.exec(now.get('letter-spacing')?.trim() ?? '')?.[1];
        if (tracking !== undefined) {
          style.letterSpacing = Number(tracking) * (style.fontSize ?? defaultText.fontSize!);
        }
        this.#textStyles.set(node, style);
        this.#text.add(node);
        const color = now.get('color');
        if (color !== undefined) {
          try {
            node.layoutNode.queuePaint({ textColor: parseColor(color) });
          } catch {
            node.layoutNode.queuePaint({}, true);
          }
        } else if (before.has('color')) {
          node.layoutNode.queuePaint({}, true);
        }
        continue;
      }
      if (!(node instanceof HostElement)) {
        continue;
      }
      if (node === this.root) {
        this.#rootShape(now);
      }
      let paint: PaintStyle = {};
      for (const name of before.keys()) {
        if (!now.has(name) && paintProperties[name]) {
          paint = { ...paint, ...paintProperties[name](null) };
        }
      }
      for (const [name, value] of now) {
        const apply = paintProperties[name];
        if (apply) {
          try {
            paint = { ...paint, ...apply(value) };
          } catch (error) {
            this.#reportOne(`${name}: ${value}: ${(error as Error).message}`);
          }
        }
      }
      paint = { ...paint, ...this.#paintOverrides.get(node) };
      if (Object.keys(paint).length > 0) {
        node.layoutNode.queuePaint(paint);
      }
      const cursor = now.get('cursor');
      if (cursor !== before.get('cursor')) {
        if (cursor === undefined) {
          this.#cursors.delete(node);
        } else {
          this.#cursors.set(node, cursor.trim());
        }
        this.input.updateCursor();
      }
      for (const name of ['overflow', 'overflow-x', 'overflow-y']) {
        if (now.get(name) !== before.get(name)) {
          this.#overflow(node, name, now.get(name) ?? null);
        }
      }
    }
  }
  /** The corner smoothing the root's declarations set, over the theme's. */
  #rootShape(declared: ReadonlyMap<string, string>): void {
    const override: { -readonly [K in keyof ShapeTokens]?: number } = {};
    for (const [name, token] of Object.entries(shapeProperties)) {
      const value = declared.get(name)?.trim();
      if (value === undefined || value === '') {
        continue;
      }
      const n =
        value === 'infinity' || value === 'none' ? Infinity : Number(value.replace(/px$/, ''));
      if (Number.isNaN(n)) {
        this.#reportOne(`${name}: ${value}: expected a number`);
      } else {
        override[token] = n;
      }
    }
    this.layout.setShapeOverride(override);
  }
  #reportOne(error: string): void {
    if (this.#styleErrorListeners.size === 0) {
      console.warn(`CSS: ${error}`);
    }
    for (const listener of this.#styleErrorListeners) {
      listener([error]);
    }
  }
  /** @internal */
  textChanged(node: HostText): void {
    this.#text.add(node);
    this.#schedule();
  }
  #schedule(): void {
    this.layout.queue();
  }

  /** Submit coalesced paint, text and layout writes now instead of at the end of the tick. */
  flush(): void {
    this.layout.flush();
  }

  /** Queue changed text, with the style it inherits, into the layout's command buffer. */
  #queueText(): void {
    for (const node of this.#text) {
      if (node.destroyed) {
        continue;
      }
      const style = { ...defaultText, ...this.#textStyles.get(node) };
      const sent = this.#sentText.get(node);
      if (sent?.data === node.data && sameText(sent.style, style)) {
        continue;
      }
      // Unchanged text and style are not sent again; crossing text costs per character.
      this.#sentText.set(node, { data: node.data, style });
      node.layoutNode.queueText(node.data, style);
      if ((sent?.data === '') !== (node.data === '')) {
        // Empty text, which renderers use as anchors, takes no space, as in the DOM.
        node.layoutNode.setLayoutProperty('display', node.data === '' ? 'none' : null);
      }
    }
    this.#text.clear();
  }

  /** Lay the root out at this size; later reads lay out again only after edits. */
  compute(width: number, height: number): void {
    this.flush();
    this.#width = width;
    this.#height = height;
    this.layout.compute(this.root.layoutNode, width, height);
    this.#computed = true;
  }
  #ensureLayout(): void {
    this.flush();
    if (!this.#computed) {
      this.compute(this.#width, this.#height);
    }
  }
  /** @internal */
  boundsOf(node: HostNode): [number, number, number, number] {
    this.#ensureLayout();
    const out = new Float32Array(4);
    this.layout.readBounds([node.layoutNode], out);
    return [out[0]!, out[1]!, out[2]!, out[3]!];
  }
  /** The topmost element at a point, or null; text hits resolve to their element. */
  elementAt(x: number, y: number): HostElement | null {
    this.#ensureLayout();
    // The cache answers repeated points inside the last hit region without a native call.
    this.#hits ??= this.layout.createHitCache(this.root.layoutNode);
    for (const id of this.#hits.pathAt(x, y)) {
      const node = this.#nodes.get(id);
      const element = node instanceof HostText ? node.parentNode : node;
      if (element instanceof HostElement) {
        return element;
      }
    }
    return null;
  }

  /**
   * Feed a pointer event at (x, y) through `input`, as a window would:
   * `pointermove`, `pointerdown`, `pointerup` and `wheel` update hover,
   * presses, clicks and scrolling; other types dispatch to the element under
   * the point. Returns false if a listener cancelled it.
   */
  dispatchPointer(type: string, init: HostPointerEventInit): boolean {
    const moved = this.input.pointerMove(init.x, init.y);
    if (init.modifiers) {
      this.input.setModifiers(init.modifiers);
    }
    switch (type) {
      case 'pointermove':
        return moved;
      case 'pointerdown':
        return this.input.pointerDown(init.button ?? 0);
      case 'pointerup':
        return this.input.pointerUp(init.button ?? 0);
      case 'wheel':
        return this.input.wheel(init.deltaX ?? 0, init.deltaY ?? 0);
      default:
        return (this.input.hovered ?? this.root).dispatchEvent(new HostPointerEvent(type, init));
    }
  }

  /** Whether `element` scrolls along x and y: `overflow` set to scroll or auto. */
  #scrolls = new Map<HostElement, { axes: [boolean, boolean]; x: number; y: number }>();
  #overflow(element: HostElement, name: string, value: PropertyValue): void {
    const scrolls = value === 'scroll' || value === 'auto';
    const entry = this.#scrolls.get(element) ?? { axes: [false, false], x: 0, y: 0 };
    if (name !== 'overflow-y') {
      entry.axes[0] = scrolls;
    }
    if (name !== 'overflow-x') {
      entry.axes[1] = scrolls;
    }
    this.#scrolls.set(element, entry);
  }
  /** @internal The `cursor` property `element` sets, if any. */
  cursorOf(element: HostElement): string | undefined {
    return this.#cursors.get(element);
  }
  /** @internal How far `element` is scrolled right and down. */
  scrollOf(element: HostElement): [number, number] {
    const entry = this.#scrolls.get(element);
    return entry ? [entry.x, entry.y] : [0, 0];
  }
  /**
   * @internal Scroll `element` by (dx, dy) within its content, if it is a
   * scroll container, and return what it could not take.
   */
  scrollBy(element: HostElement, dx: number, dy: number): [number, number] {
    const entry = this.#scrolls.get(element);
    if (!entry || (!entry.axes[0] && !entry.axes[1])) {
      return [dx, dy];
    }
    const [, , width, height] = this.boundsOf(element);
    const [contentWidth, contentHeight] = element.layoutNode.contentSize();
    const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), Math.max(max, 0));
    const x = entry.axes[0] ? clamp(entry.x + dx, contentWidth - width) : entry.x;
    const y = entry.axes[1] ? clamp(entry.y + dy, contentHeight - height) : entry.y;
    const rest: [number, number] = [dx - (x - entry.x), dy - (y - entry.y)];
    if (x !== entry.x || y !== entry.y) {
      this.scrollTo(element, x, y);
    }
    return rest;
  }
  /** @internal Scroll `element` to (x, y) and dispatch `scroll` to it. */
  scrollTo(element: HostElement, x: number, y: number): void {
    const entry = this.#scrolls.get(element) ?? { axes: [false, false], x: 0, y: 0 };
    entry.x = x;
    entry.y = y;
    this.#scrolls.set(element, entry);
    element.layoutNode.queueScroll(x, y);
    element.dispatchEvent(new HostEvent('scroll'));
  }

  /**
   * Present the root in a window, laying out at its size, and route its
   * pointer, wheel, keyboard and input-method events to `input`. Returns the
   * unmount function, which `options.scope` also runs.
   */
  mount(window: NativeWindowHost, options: HostMountOptions = {}): () => void {
    const { scope, ...scene } = options;
    this.flush();
    window.attachScene(this.layout, this.root.layoutNode, scene, scope);
    this.clipboard = new SystemClipboard(window.bindings.window);
    const offCursor = this.input.onCursor((cursor) => {
      window.window.setCursorIcon(cursorIcon(cursor));
    });
    const off = window.onEvent((event) => {
      const ratio = window.window.scaleFactor();
      if (event.kind === 'Resized') {
        this.#width = Number(event.width) / ratio;
        this.#height = Number(event.height) / ratio;
        this.#computed = false;
      } else if (event.kind === 'CursorMoved') {
        this.input.pointerMove(event.x / ratio, event.y / ratio);
      } else if (event.kind === 'CursorLeft') {
        this.input.pointerLeave();
      } else if (event.kind === 'MouseInput') {
        const button = mouseButton(event.button);
        if (event.state === win.MouseElementState.Pressed) {
          this.input.pointerDown(button);
        } else {
          this.input.pointerUp(button);
        }
      } else if (event.kind === 'MouseWheel') {
        const delta = event.delta;
        // Line deltas scroll a fixed distance per line; pixel deltas are device pixels.
        const [dx, dy] =
          delta.kind === 'LineDelta'
            ? [delta.x * WHEEL_LINE, delta.y * WHEEL_LINE]
            : [delta.x / ratio, delta.y / ratio];
        this.input.wheel(-dx, -dy);
      } else if (event.kind === 'ModifiersChanged') {
        const m = event.modifiers;
        this.input.setModifiers({
          shift: m.shift,
          control: m.control,
          alt: m.alt,
          meta: m.super_key,
        });
      } else if (event.kind === 'KeyboardInput') {
        const key = event.event;
        const init = {
          key: keyName(key.logical_key),
          code: codeName(key.physical_key),
          location: key.location,
          repeat: key.repeat,
        };
        if (key.state === win.MouseElementState.Pressed) {
          const allowed = this.input.keyDown(init);
          const text = key.text.kind === 'Some' ? key.text.text : '';
          // Control characters are keys, not text.
          if (allowed && [...text].some((c) => c >= ' ' && c !== '\u007f')) {
            this.input.text(text);
          }
        } else {
          this.input.keyUp(init);
        }
      } else if (event.kind === 'Ime') {
        const ime = event.event;
        if (ime.kind === 'Preedit') {
          const cursor = ime.cursor.kind === 'Range' ? Number(ime.cursor.start) : -1;
          this.input.composition(ime.text, cursor);
        } else if (ime.kind === 'Commit') {
          this.input.text(ime.text);
        } else if (ime.kind === 'Disabled') {
          this.input.composition('');
        }
      } else if (event.kind === 'Focused' && !event.focused) {
        this.input.pointerLeave();
      }
    }, scope);
    const ratio = window.window.scaleFactor();
    this.#width = window.window.width() / ratio;
    this.#height = window.window.height() / ratio;
    let mounted = true;
    const unmount = () => {
      if (mounted) {
        mounted = false;
        off();
        offCursor();
        if (!window.disposed) {
          window.detachScene();
        }
      }
    };
    scope?.onCleanup(unmount);
    return unmount;
  }

  /** @internal Release a node, its subtree and their listeners and bindings. */
  destroyNode(node: HostNode): void {
    if (node.destroyed) {
      return;
    }
    node.parentNode?.unlink(node);
    const forget = (current: HostNode) => {
      if (current instanceof HostElement) {
        for (let child = current.firstChild; child; child = child.nextSibling) {
          forget(child);
        }
        current.disposeBindings();
        this.#paintOverrides.delete(current);
        this.#cursors.delete(current);
        this.#scrolls.delete(current);
        this.input.forget(current);
      } else if (current instanceof HostText) {
        this.#text.delete(current);
      }
      current.clearListeners();
      this.#nodes.delete(current.layoutNode.id);
      HostNode.markDestroyed(current);
    };
    forget(node);
    node.layoutNode.queueRemove();
  }

  dispose(): void {
    this.#text.clear();
    this.#nodes.clear();
    this.layout.dispose();
  }
}

/** A text node's defaults, so a property no ancestor sets any more reverts. */
const defaultText: TextStyle = {
  fontSize: 16,
  lineHeight: 1.2,
  letterSpacing: 0,
  wrap: true,
  fontWeight: 400,
  italic: false,
};
const cursorNames: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(win.CursorIcon).map(([name, icon]) => [
    name.replace(/[A-Z]/g, (c, i: number) => (i ? '-' : '') + c.toLowerCase()),
    icon,
  ]),
);
/** A CSS cursor name as the window's icon; unknown names show the default. */
function cursorIcon(cursor: string): win.CursorIcon {
  return (cursorNames[cursor] ?? win.CursorIcon.Default) as win.CursorIcon;
}
function sameText(a: TextStyle, b: TextStyle): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof TextStyle)[]);
  return [...keys].every((key) => a[key] === b[key]);
}
const namedKeys = new Map<number, string>(
  Object.entries(win.NamedKey).map(([name, code]) => [code, name]),
);
const keyCodes = new Map<number, string>(
  Object.entries(win.KeyCode).map(([name, code]) => [code, name]),
);
/** A logical key as the DOM's `key` names it. */
function keyName(key: win.Key): string {
  switch (key.kind) {
    case 'Named': {
      const name = namedKeys.get(key.key) ?? 'Unidentified';
      return name === 'Space' ? ' ' : name;
    }
    case 'Character':
      return key.text;
    case 'Dead':
      return 'Dead';
    case 'Unidentified':
      return 'Unidentified';
  }
}
/** A physical key as the DOM's `code` names it. */
function codeName(key: win.PhysicalKey): string {
  return key.kind === 'Code' ? (keyCodes.get(key.code) ?? '') : '';
}
function contains(ancestor: HostNode, node: HostNode | null): boolean {
  for (let current = node; current; current = current.parentNode) {
    if (current === ancestor) {
      return true;
    }
  }
  return false;
}
function mouseButton(button: { kind: string }): number {
  return button.kind === 'Right' ? 2 : button.kind === 'Middle' ? 1 : 0;
}

export {
  MemoryClipboard,
  SystemClipboard,
  HostClipboardEvent,
  TEXT as CLIPBOARD_TEXT,
  type Clipboard,
  type ClipboardEntry,
} from './clipboard.js';
export {
  Input,
  HostKeyboardEvent,
  HostTextEvent,
  HostCompositionEvent,
  HostFocusEvent,
  WHEEL_LINE,
  type KeyModifiers,
  type HostKeyboardEventInit,
  type InteractionState,
  type InteractionChange,
} from './input.js';
export {
  EventPhase,
  HostEvent,
  HostEventTarget,
  HostPointerEvent,
  type HostEventInit,
  type HostEventListener,
  type HostPointerEventInit,
  type ListenerOptions,
} from './events.js';
