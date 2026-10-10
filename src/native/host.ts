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
import type { Notch } from './notch.js';
import {
  HostEvent,
  HostEventTarget,
  HostPointerEvent,
  type HostPointerEventInit,
} from './events.js';
import { window as win } from './index.js';
import { Input, WHEEL_LINE } from './input.js';
import type { HitCache, Layout, LayoutAnimationOptions, LayoutNode, Restyled } from './layout.js';
import { MemoryClipboard, SystemClipboard, type Clipboard } from './clipboard.js';
import type { Computed, Disposable, ReactiveContext, Signal } from './reactive.js';
import type { AffineTransform, Color, PaintStyle, TextStyle } from './scene.js';
import type { ShapeTokens } from '../theme/shape.js';
import { ScrollThumb, words } from './scrollbar.js';
import { InlineFlows } from './inline-flow.js';
import { HostImages } from './host-images.js';
import { Behaviours } from './behaviours.js';
import type { ValidityFlags } from './validity.js';
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

/** Where `scrollIntoView` puts an element in its container's view along each axis. */
export interface ScrollIntoViewOptions {
  block?: 'start' | 'center' | 'end' | 'nearest';
  inline?: 'start' | 'center' | 'end' | 'nearest';
}

/** Properties the host reads itself beyond paint, text and layout. */
const otherProperties: ReadonlySet<string> = new Set([
  'cursor',
  'pointer-events',
  'scrollbar-color',
  'scrollbar-width',
  'scrollbar-visibility',
  'text-align',
  'list-style-type',
  'object-fit',
  ...Object.keys(shapeProperties),
]);

/**
 * What a brush, a colour or a matrix given directly sets. Text values go
 * through the cascade, which reads them natively; these cannot be written in
 * CSS text.
 */
const directPaint: Readonly<
  Record<string, (value: Brush | Color | AffineTransform) => PaintStyle>
> = {
  background: (v) => ({ background: v instanceof Brush ? v : Brush.solid(v as Color) }),
  'background-color': (v) => directPaint.background!(v),
  'background-image': (v) => directPaint.background!(v),
  color: (v) => ({ textColor: v as Color }),
  'border-color': (v) => ({ borderColor: v as Color }),
  'mask-image': (v) => ({ maskImage: v as Brush }),
  transform: (v) => ({ transform: v as AffineTransform }),
};
/** What each paint field is when nothing sets it, for a direct value cleared. */
const directReset: Readonly<Partial<Record<keyof PaintStyle, PaintStyle>>> = {
  background: { background: Brush.solid([0, 0, 0, 0]) },
  borderColor: { borderColor: [0, 0, 0, 0] },
  maskImage: { maskImage: null },
  transform: { transform: [1, 0, 0, 1, 0, 0] },
};
/** The paint fields each direct property sets, to take them back when it is cleared. */
const directFields: Readonly<Record<string, readonly (keyof PaintStyle)[]>> = {
  background: ['background'],
  'background-color': ['background'],
  'background-image': ['background'],
  color: ['textColor'],
  'border-color': ['borderColor'],
  'mask-image': ['maskImage'],
  transform: ['transform'],
};

/** States the host keeps from input; the rest an element is given. */
const OWN_STATES: ReadonlySet<string> = new Set([
  'hover',
  'active',
  'focus',
  'focus-visible',
  'focus-within',
  'disabled',
  'enabled',
]);

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
    return this.composedParent;
  }
  /**
   * Where events, hover and press go up to: the parent, or for an element the host made for
   * another to hold, the one it holds it for.
   */
  get composedParent(): HostElement | null {
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
  #owner: HostElement | null = null;
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
  /**
   * Give or take a state the host does not track itself, so `:checked`,
   * `:indeterminate`, `:user-invalid` and the like match: a component sets
   * what its control is. Pointer and focus states, `disabled` and `enabled`
   * come from input and are refused here.
   */
  setState(name: string, on: boolean): void {
    this.host.setElementState(this, name, on);
  }
  /** Whether `setState` gave the element `name`. */
  hasState(name: string): boolean {
    return this.host.elementHasState(this, name);
  }
  /** The element this one was made for, when the host made it: a marker, a bar, a thumb. */
  get owner(): HostElement | null {
    return this.#owner;
  }
  /** @internal */
  setOwner(owner: HostElement): void {
    this.#owner = owner;
  }
  override get composedParent(): HostElement | null {
    return this.parentNode ?? this.#owner;
  }
  /** Whether a `dialog` or a `details` is open: its `open` attribute. */
  get open(): boolean {
    return this.hasAttribute('open');
  }
  set open(on: boolean) {
    if (on) {
      this.setAttribute('open', '');
    } else {
      this.removeAttribute('open');
    }
  }
  /** A dialog's: open it where it is. */
  show(): void {
    this.host.behaviours.dialogs.show(this);
  }
  /** A dialog's: open it in the top layer over a dimmed backdrop, with focus kept inside it. */
  showModal(): void {
    this.host.behaviours.dialogs.showModal(this);
  }
  /** A dialog's: close it, saying why in `returnValue`. */
  close(returnValue?: string): void {
    this.host.behaviours.dialogs.close(this, returnValue);
  }
  /** A dialog's: ask it to close, which a `cancel` listener may refuse. */
  requestClose(returnValue?: string): void {
    this.host.behaviours.dialogs.requestClose(this, returnValue);
  }
  /** A dialog's: what closing it last said. */
  get returnValue(): string {
    return this.host.behaviours.dialogs.returnValue(this);
  }
  set returnValue(value: string) {
    this.host.behaviours.dialogs.setReturnValue(this, value);
  }
  /** The form a control belongs to: the one its `form` attribute names, else the one around it. */
  get form(): HostElement | null {
    return this.host.behaviours.forms.ownerOf(this);
  }
  /** A form's controls, in tree order, including those elsewhere that name it with `form`. */
  get elements(): HostElement[] {
    return this.host.behaviours.forms.elements(this);
  }
  /** What a form holds, as `FormData`: named inputs not disabled, a box or radio only if checked. */
  formData(): FormData {
    return this.host.behaviours.forms.formData(this);
  }
  /** Fire a form's `submit` event as `submitter`, a submit button of it, asks; false when cancelled. */
  requestSubmit(submitter: HostElement | null = null): boolean {
    return this.host.behaviours.forms.requestSubmit(this, submitter);
  }
  /** Put a form's controls back as they began, unless its `reset` event is cancelled. */
  reset(): boolean {
    return this.host.behaviours.forms.reset(this);
  }
  /** Whether a control is checked for its constraints: enabled, not read-only, and one the user fills in. */
  get willValidate(): boolean {
    return this.host.behaviours.validity.willValidate(this);
  }
  /** What a control's constraints say of it: `valid`, `valueMissing`, `patternMismatch` and the rest. */
  get validity(): ValidityFlags {
    return this.host.behaviours.validity.validity(this);
  }
  /** Why a control is invalid, as a browser says it; empty when it is valid. */
  get validationMessage(): string {
    return this.host.behaviours.validity.validationMessage(this);
  }
  /** Make a control invalid with `message` until a script sets an empty one. */
  setCustomValidity(message: string): void {
    this.host.behaviours.validity.setCustomValidity(this, message);
  }
  /** Whether a control, or every control of a form, is valid; each that is not fires `invalid`. */
  checkValidity(): boolean {
    return this.host.behaviours.validity.checkValidity(this);
  }
  /** As `checkValidity`, and the first control that is not valid takes focus and shows as `:user-invalid`. */
  reportValidity(): boolean {
    return this.host.behaviours.validity.reportValidity(this);
  }
  /** Whether a checkbox or a radio is checked; setting it fires no event, as a script's does. */
  get checked(): boolean {
    return this.host.behaviours.inputs.checked(this);
  }
  set checked(on: boolean) {
    this.host.behaviours.inputs.setChecked(this, on);
    this.host.behaviours.validity.changed(this);
  }
  /** A checkbox in neither state until it is clicked: `:indeterminate`. */
  get indeterminate(): boolean {
    return this.host.behaviours.inputs.indeterminate(this);
  }
  set indeterminate(on: boolean) {
    this.host.behaviours.inputs.setIndeterminate(this, on);
  }
  /** An input's value as text: a range's number, else its `value` attribute; a select's chosen option's value. */
  get value(): string {
    const { inputs, selects, textFields } = this.host.behaviours;
    return selects.has(this)
      ? selects.value(this)
      : (textFields.value(this) ?? inputs.value(this) ?? '');
  }
  set value(text: string) {
    const { inputs, selects, textFields } = this.host.behaviours;
    if (selects.has(this)) {
      selects.setValue(this, text);
    } else if (textFields.has(this)) {
      textFields.setValue(this, text);
    } else {
      inputs.setValue(this, text);
    }
    this.host.behaviours.validity.changed(this);
  }
  /** A text field's: where the selection starts and ends, as UTF-16 indices. */
  get selectionStart(): number {
    return this.host.behaviours.textFields.selectionStart(this);
  }
  get selectionEnd(): number {
    return this.host.behaviours.textFields.selectionEnd(this);
  }
  /** A text field's: select all of what it holds, or from `start` to `end`. */
  select(start?: number, end?: number): void {
    this.host.behaviours.textFields.select(this, start, end);
  }
  setSelectionRange(start: number, end: number): void {
    this.host.behaviours.textFields.select(this, start, end);
  }
  /** A select's: the index of the chosen option, or -1. */
  get selectedIndex(): number {
    return this.host.behaviours.selects.selectedIndex(this);
  }
  set selectedIndex(index: number) {
    this.host.behaviours.selects.setSelectedIndex(this, index);
    this.host.behaviours.validity.changed(this);
  }
  /** A select's options, in order, those in an `optgroup` too. */
  get options(): HostElement[] {
    return this.host.behaviours.selects.options(this);
  }
  /** A range's value as a number, NaN for any other element. */
  get valueAsNumber(): number {
    const { inputs, textFields } = this.host.behaviours;
    const range = inputs.valueAsNumber(this);
    return Number.isNaN(range) ? textFields.valueAsNumber(this) : range;
  }
  set valueAsNumber(value: number) {
    const { inputs, textFields } = this.host.behaviours;
    if (textFields.has(this)) {
      textFields.setValue(this, Number.isFinite(value) ? String(value) : '');
    } else {
      inputs.setValueAsNumber(this, value);
    }
  }
  /** Animate this element's layout changes, or stop with null: see `LayoutNode.animateLayout`. */
  animateLayout(options: LayoutAnimationOptions | null = {}): void {
    this.layoutNode.animateLayout(options);
  }
  /**
   * Resolves when this element's transitions and animations have ended, or
   * at once when it has none. Styles are applied first, so a class or
   * attribute set just before has started what it starts: a component sets
   * `closing`, awaits this, then removes the element.
   */
  animationsFinished(): Promise<void> {
    const { layout, root } = this.host;
    layout.restyle(root.layoutNode);
    return layout.motionFinished(this.layoutNode);
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
    this.host.behaviours.attributeChanged(this, name);
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
    this.host.behaviours.attributeChanged(this, name);
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

  /** Draw the element as `notch`, or as a plain box when it is null. */
  setNotch(notch: Notch | null): void {
    this.host.assertOwn(this);
    this.layoutNode.setNotch(notch);
  }

  /**
   * Draw the element as the notch `source` holds, again each time it changes.
   * It ends when the node is destroyed, the returned handle is disposed, or a
   * notch is bound again; the element is a plain box after.
   */
  bindNotch(
    source: Signal<Notch | null> | Computed<Notch | null>,
    context: ReactiveContext,
  ): Disposable {
    this.#bindings?.get('notch')?.dispose();
    const effect = context.effect(() => {
      this.setNotch(source.get());
    });
    const binding: Disposable = {
      dispose: () => {
        effect.dispose();
        if (this.#bindings?.get('notch') === binding) {
          this.#bindings.delete('notch');
          if (!this.destroyed) {
            this.setNotch(null);
          }
        }
      },
    };
    (this.#bindings ??= new Map()).set('notch', binding);
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
    const before = child.parentNode;
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
    this.host.inlineFlows?.touch(before);
    this.host.inlineFlows?.touch(this);
    this.host.behaviours.childrenChanged(before, child);
    this.host.behaviours.childrenChanged(this, child);
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
    this.host.inlineFlows?.touch(this);
    this.host.behaviours.childrenChanged(this, child);
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
  /** Click this element, as a press and release on it would, unless it is disabled. */
  click(): void {
    if (this.destroyed || this.host.input.isDisabled(this)) {
      return;
    }
    const [x, y, width, height] = this.bounds();
    this.dispatchEvent(
      new HostPointerEvent('click', { x: x + width / 2, y: y + height / 2, button: 0, detail: 1 }),
    );
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
  /** How far this element's content reaches, which its scroll position can show: at least its own size. */
  get scrollWidth(): number {
    return Math.max(this.layoutNode.contentSize()[0], this.clientWidth);
  }
  get scrollHeight(): number {
    return Math.max(this.layoutNode.contentSize()[1], this.clientHeight);
  }
  /** The size of this element's box, which is as much of its content as shows at once. */
  get clientWidth(): number {
    return this.bounds()[2];
  }
  get clientHeight(): number {
    return this.bounds()[3];
  }
  /** Scroll this element's content by (dx, dy), kept within its content, dispatching `scroll`. */
  scrollBy(dx: number, dy: number): void {
    this.host.scrollBy(this, dx, dy);
  }
  /**
   * Scroll the containers around this element until it shows, nearest first:
   * by the least that brings it into view, or to a `start`, `center` or `end`
   * of the container's view.
   */
  scrollIntoView(options: ScrollIntoViewOptions = {}): void {
    this.host.scrollIntoView(this, options);
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
  /** States elements were given with `setState`. */
  readonly #givenStates = new WeakMap<HostElement, Set<string>>();
  #width = 0;
  #height = 0;
  #computed = false;
  /** Pointer, focus, keyboard and scrolling state, and the entry points a window feeds. */
  readonly input: Input = new Input(this);
  /** Held in the process until the host is mounted in a window, then the system's. */
  clipboard: Clipboard = new MemoryClipboard();
  readonly #cursors = new Map<HostElement, string>();
  #hits: HitCache | undefined;

  /** Inline flows, where the host has the addon to measure them with. */
  readonly inlineFlows: InlineFlows | undefined;
  /** What built-in elements do: list markers, links, labels and the like. */
  readonly behaviours: Behaviours;
  /** The images elements name, loaded once each, which a mounted window draws. */
  readonly images: HostImages | undefined;
  /** The native bindings this host measures text with, when it was given them. */
  readonly native: NativeBindings | undefined;
  /** Elements the host made for another to hold, which frameworks do not see among its children. */
  readonly #owned = new WeakMap<HostElement, HostElement[]>();
  readonly #anonymous = new WeakSet<HostElement>();

  constructor(layout: Layout, scope?: Scope, native?: NativeBindings) {
    this.layout = layout;
    this.native = native;
    this.inlineFlows = native ? new InlineFlows(this, native) : undefined;
    this.images = native ? new HostImages(native, layout) : undefined;
    this.behaviours = new Behaviours(this);
    this.#stateBits = new Map(layout.stateNames.map((name, i) => [name, 1 << i]));
    this.root = this.#register(new HostElement(this, layout.createNode(), 'root'));
    this.styleChanged(this.root);
    this.root.layoutNode.setLayoutProperty('width', '100%');
    this.root.layoutNode.setLayoutProperty('height', '100%');
    this.behaviours.attach();
    layout.beforeFlush(() => {
      this.behaviours.flush();
      this.#queueElements();
      this.#queueText();
    });
    layout.onRestyle((restyled) => this.#restyled(restyled), scope);
    layout.onImageUse((id, source) => this.#backgroundImage(id, source), scope);
    this.input.onInteraction((element, state) => {
      if (!element.destroyed) {
        element.layoutNode.queueStates(this.#bits(element, state));
        this.#scrolls.get(element)?.thumb.hovered(state.hover);
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
    return new Host(native.createLayout(scope), scope, native);
  }

  createElement(tag: string): HostElement {
    if (!/^[a-z][a-z0-9-]*$/.test(tag)) {
      throw new Error(`Invalid element name: ${tag}`);
    }
    const element = this.#register(new HostElement(this, this.layout.createNode(), tag));
    // Described to the cascade now, so type and structural selectors reach it with no class set.
    this.styleChanged(element);
    this.behaviours.created(element);
    return element;
  }
  /**
   * An element the host makes for `parent` to hold, as list items hold their
   * markers: in the native tree and the cascade, so CSS styles it, but not
   * among `childNodes`, so a framework that owns its children never sees it.
   * Counted by no structural selector. It goes when `parent` does, or with
   * `destroy`.
   */
  ownedElement(
    parent: HostElement,
    tag: string,
    classes: readonly string[] = [],
    before: HostNode | null = null,
  ): HostElement {
    const element = this.createElement(tag);
    this.#anonymous.add(element);
    element.setOwner(parent);
    for (const name of classes) {
      element.classList.add(name);
    }
    const list = this.#owned.get(parent) ?? [];
    list.push(element);
    this.#owned.set(parent, list);
    parent.layoutNode.queueInsertBefore(element.layoutNode, before?.layoutNode ?? null);
    return element;
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
      const paint = directPaint[name];
      if (!paint) {
        throw new TypeError(`${name} does not take a brush or a color`);
      }
      const patch = paint(value as Brush | Color | AffineTransform);
      this.#paintOverrides.set(element, { ...this.#paintOverrides.get(element), ...patch });
      element.layoutNode.queuePaint(patch);
      return;
    }
    if (
      !name.startsWith('--') &&
      !this.layout.isPaintProperty(name) &&
      !textProperties[name] &&
      !otherProperties.has(name) &&
      !this.layout.isLayoutProperty(name)
    ) {
      throw new Error(`Unknown property: ${name}`);
    }
    if (value === null || value === undefined) {
      const overrides = this.#paintOverrides.get(element);
      if (overrides) {
        // What was set directly goes, and the cascade writes the node's paint over the reset.
        const reset: { [K in keyof PaintStyle]?: PaintStyle[K] } = {};
        for (const key of directFields[name] ?? []) {
          if (key in overrides) {
            delete overrides[key];
            Object.assign(reset, directReset[key]);
          }
        }
        if (Object.keys(reset).length > 0) {
          element.layoutNode.queuePaint(reset);
          this.layout.repaint(element.layoutNode);
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
        anonymous: this.#anonymous.has(node),
      });
      // Registering an element starts its states at none: those it already has are given again, after it.
      const bits = this.#bits(node, this.input.stateOf(node));
      if (bits !== 0) {
        node.layoutNode.queueStates(bits);
      }
    }
    this.#styleDirty.clear();
  }
  /** @internal HostElement.setState. */
  setElementState(element: HostElement, name: string, on: boolean): void {
    if (OWN_STATES.has(name) || !this.#stateBits.has(name)) {
      const given = this.layout.stateNames.filter((n) => !OWN_STATES.has(n));
      throw new Error(`"${name}" is not a state an element is given: ${given.join(', ')}`);
    }
    let states = this.#givenStates.get(element);
    if (on === (states?.has(name) ?? false)) {
      return;
    }
    if (!states) {
      states = new Set();
      this.#givenStates.set(element, states);
    }
    if (on) {
      states.add(name);
    } else {
      states.delete(name);
    }
    if (!element.destroyed) {
      element.layoutNode.queueStates(this.#bits(element, this.input.stateOf(element)));
    }
  }
  /** @internal HostElement.hasState. */
  elementHasState(element: HostElement, name: string): boolean {
    return this.#givenStates.get(element)?.has(name) ?? false;
  }
  #bits(element: HostElement, state: Readonly<InteractionState>): number {
    const bit = (name: string) => this.#stateBits.get(name) ?? 0;
    let bits = 0;
    for (const name of this.#givenStates.get(element) ?? []) {
      bits |= bit(name);
    }
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
    // The restyle wrote paint natively; what was set directly on a node stays over it.
    for (const id of restyled.painted) {
      const node = this.#nodes.get(id);
      const overrides = node instanceof HostElement ? this.#paintOverrides.get(node) : undefined;
      if (node instanceof HostElement && overrides && Object.keys(overrides).length > 0) {
        node.layoutNode.queuePaint(overrides);
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
        this.inlineFlows?.restyled(node.parentNode);
        continue;
      }
      if (!(node instanceof HostElement)) {
        continue;
      }
      if (node === this.root) {
        this.#rootShape(now);
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
      const events = now.get('pointer-events');
      if (events !== before.get('pointer-events')) {
        node.layoutNode.setPointerEvents(events?.trim() !== 'none');
      }
      if (
        ['scrollbar-color', 'scrollbar-width', 'scrollbar-visibility'].some(
          (name) => now.get(name) !== before.get(name),
        )
      ) {
        this.#scrollbar(node, now);
      }
      this.inlineFlows?.restyled(node);
      this.behaviours.restyled(node);
      for (const name of ['overflow', 'overflow-x', 'overflow-y']) {
        if (now.get(name) !== before.get(name)) {
          this.#overflow(node, name, now.get(name) ?? null);
        }
      }
    }
  }
  /** What each element's `url()` background has loaded, to let go of when it names another or goes. */
  readonly #backgrounds = new Map<HostElement, { release(): void }>();
  /** The element `id` now names `source` as its background image, or none. */
  #backgroundImage(id: bigint, source: string | null): void {
    const node = this.#nodes.get(id);
    if (!(node instanceof HostElement) || !this.images) {
      return;
    }
    this.#backgrounds.get(node)?.release();
    this.#backgrounds.delete(node);
    if (source === null) {
      return;
    }
    const use = this.images.use(source, () => {
      if (use.entry.status === 'error') {
        this.#reportOne(`background: url(${source}): ${use.entry.error ?? 'cannot be loaded'}`);
      }
      this.#schedule();
    });
    this.#backgrounds.set(node, use);
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
  /** @internal Report a style problem the host found, as the cascade reports its own. */
  reportStyleError(error: string): void {
    this.#reportOne(error);
  }
  /** @internal Ask for a frame: something changed outside a tick. */
  wake(): void {
    this.#schedule();
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
    this.behaviours.selects.changed(node.parentNode);
    this.#text.add(node);
    this.#schedule();
  }
  /** @internal The text style `node` has now, defaults under what the cascade gave it. */
  textStyleOf(node: HostText): TextStyle {
    return { ...defaultText, ...this.#textStyles.get(node) };
  }
  /** @internal The declarations the host reads that `element` has now, as the cascade last gave them. */
  declaredOf(element: HostElement): ReadonlyMap<string, string> {
    return this.#declared.get(element) ?? new Map();
  }
  #schedule(): void {
    // A load that settles after the host went has nothing to ask a frame of.
    if (!this.layout.disposed) {
      this.layout.queue();
    }
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
      // A text a flow hides or shows is the flow's to size: it does not wrap, and its display is the flow's.
      const flowed = this.inlineFlows?.owns(node) ?? false;
      const style = {
        ...defaultText,
        ...this.#textStyles.get(node),
        ...(flowed ? { wrap: false } : {}),
      };
      const sent = this.#sentText.get(node);
      if (sent?.data === node.data && sameText(sent.style, style)) {
        continue;
      }
      // Unchanged text and style are not sent again; crossing text costs per character.
      this.#sentText.set(node, { data: node.data, style });
      node.layoutNode.queueText(node.data, style);
      if (!flowed && (sent?.data === '') !== (node.data === '')) {
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
    this.#laying = true;
    try {
      this.layout.compute(this.root.layoutNode, width, height);
    } finally {
      this.#laying = false;
    }
    this.#computed = true;
  }
  /** Whether a layout pass is running, whose listeners read the bounds it just made. */
  #laying = false;
  #ensureLayout(): void {
    if (this.#laying) {
      return;
    }
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

  /** Whether `element` scrolls along x and y: `overflow` set to scroll or auto, where it is, and its thumb. */
  #scrolls = new Map<
    HostElement,
    { axes: [boolean, boolean]; x: number; y: number; thumb: ScrollThumb }
  >();
  #scrollEntry(element: HostElement) {
    let entry = this.#scrolls.get(element);
    if (!entry) {
      const thumb = new ScrollThumb((colour) => {
        if (!element.destroyed) {
          element.layoutNode.queueScroll(entry!.x, entry!.y, thumbOf(entry!, colour));
        }
      });
      entry = { axes: [false, false], x: 0, y: 0, thumb };
      this.#scrolls.set(element, entry);
    }
    return entry;
  }
  #overflow(element: HostElement, name: string, value: PropertyValue): void {
    const scrolls = value === 'scroll' || value === 'auto';
    const entry = this.#scrollEntry(element);
    if (name !== 'overflow-y') {
      entry.axes[0] = scrolls;
    }
    if (name !== 'overflow-x') {
      entry.axes[1] = scrolls;
    }
    // The engine draws a thumb for a container it has a scroll record of, which every container
    // may have for its scroll offset, so one that does not scroll is given a thumb of no colour.
    element.layoutNode.queueScroll(entry.x, entry.y, thumbOf(entry, entry.thumb.current));
  }
  /** `scrollbar-color`, `scrollbar-width` and `scrollbar-visibility`, as `element`'s declarations now have them. */
  #scrollbar(element: HostElement, declared: ReadonlyMap<string, string>): void {
    const colour = words(declared.get('scrollbar-color') ?? '')[0];
    const parsed = colour && colour !== 'auto' ? this.layout.parseColor(colour) : null;
    const visibility = declared.get('scrollbar-visibility')?.trim();
    this.#scrollEntry(element).thumb.restyle(
      parsed,
      declared.get('scrollbar-width')?.trim() === 'none',
      visibility === 'auto' || visibility === 'hover' || visibility === 'hidden'
        ? visibility
        : 'always',
    );
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
  /** @internal Whether `element` scrolls along x and y. */
  scrollAxes(element: HostElement): readonly [boolean, boolean] {
    return this.#scrolls.get(element)?.axes ?? [false, false];
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
  /** @internal HostElement.scrollIntoView. */
  scrollIntoView(element: HostElement, options: ScrollIntoViewOptions): void {
    const align = [options.inline ?? 'nearest', options.block ?? 'nearest'] as const;
    const [ex, ey, ew, eh] = this.boundsOf(element);
    for (let container = element.parentNode; container; container = container.parentNode) {
      const axes = this.scrollAxes(container);
      if (!axes[0] && !axes[1]) {
        continue;
      }
      // Where the element is in the container's view: its layout place from the container's, less
      // what the container and those between it and the element have scrolled, which move it
      // without moving its layout.
      let moved = [0, 0];
      for (
        let step: HostElement | null = element.parentNode;
        step;
        step = step === container ? null : step.parentNode
      ) {
        const [sx, sy] = this.scrollOf(step);
        moved = [moved[0]! + sx, moved[1]! + sy];
      }
      const [cx, cy, cw, ch] = this.boundsOf(container);
      const at = [ex - cx - moved[0]!, ey - cy - moved[1]!];
      const size = [ew, eh];
      const view = [cw, ch];
      const delta = [0, 0];
      for (const axis of [0, 1]) {
        if (!axes[axis]) {
          continue;
        }
        const start = at[axis]!;
        const end = start + size[axis]!;
        switch (align[axis]) {
          case 'start':
            delta[axis] = start;
            break;
          case 'end':
            delta[axis] = end - view[axis]!;
            break;
          case 'center':
            delta[axis] = start + size[axis]! / 2 - view[axis]! / 2;
            break;
          case 'nearest':
          case undefined:
            // The least that shows it; one bigger than the view lines up its start.
            delta[axis] =
              start < 0 || size[axis]! > view[axis]!
                ? start
                : end > view[axis]!
                  ? end - view[axis]!
                  : 0;
        }
      }
      if (delta[0] !== 0 || delta[1] !== 0) {
        this.scrollBy(container, delta[0]!, delta[1]!);
      }
    }
  }
  /** @internal Scroll `element` to (x, y) and dispatch `scroll` to it. */
  scrollTo(element: HostElement, x: number, y: number): void {
    const entry = this.#scrollEntry(element);
    entry.x = x;
    entry.y = y;
    element.layoutNode.queueScroll(x, y, thumbOf(entry, entry.thumb.current));
    entry.thumb.scrolled();
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
    window.attachScene(
      this.layout,
      this.root.layoutNode,
      this.images ? { ...scene, images: this.images.library } : scene,
      scope,
    );
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
    // What a flow made for it goes first, while it is still where it was.
    this.inlineFlows?.forget(node);
    this.behaviours.forget(node);
    if (node instanceof HostElement) {
      this.#backgrounds.get(node)?.release();
      this.#backgrounds.delete(node);
      for (const owned of this.#owned.get(node) ?? []) {
        this.destroyNode(owned);
      }
      this.#owned.delete(node);
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
        this.#scrolls.get(current)?.thumb.dispose();
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
    this.behaviours.dispose();
    this.images?.dispose();
    this.#text.clear();
    this.#nodes.clear();
    this.layout.dispose();
  }
}

/** The thumb a container draws: its own colour if it scrolls, none otherwise. */
function thumbOf(
  entry: { axes: [boolean, boolean] },
  colour: readonly [number, number, number, number],
): [number, number, number, number] {
  return entry.axes[0] || entry.axes[1]
    ? [colour[0], colour[1], colour[2], colour[3]]
    : [0, 0, 0, 0];
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
