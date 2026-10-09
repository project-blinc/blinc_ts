import { Brush, type BrushFactory, type NativeBrush } from './brush.js';
import type { ImageFit } from './generated/scene.js';
import type {
  TextStyle,
  PaintStyle,
  VisualBounds,
  PaintOptions,
  PaintInfo,
  AtlasInfo,
  SceneHit,
} from './scene.js';
import type {
  LayoutDirection,
  LayoutAlign,
  LayoutJustify,
  LayoutOverflow,
} from './generated/layout.js';
import type { Scope } from '../hmr.js';
import { propertyWrite } from './properties.js';
import { CommandQueue, type QueuedElement, type QueuedNode, type QueuedPaint } from './commands.js';

export type LayoutChange = 'layout' | 'paint' | 'disposed';

export type LayoutLength = number | `${number}%` | 'auto';
function checkPaint(
  p: Omit<
    PaintStyle,
    'background' | 'maskImage' | 'filter' | 'shadows' | 'cornerShape' | 'cornerShapeLocked'
  >,
): void {
  const unit = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1;
  const ok =
    (p.opacity === undefined || unit(p.opacity)) &&
    (p.borderWidth === undefined || (Number.isFinite(p.borderWidth) && p.borderWidth >= 0)) &&
    [p.textColor, p.borderColor].every(
      (c) => c === undefined || (c.length === 4 && c.every(unit)),
    ) &&
    (p.radius === undefined ||
      (p.radius.length === 4 && p.radius.every((v) => Number.isFinite(v) && v >= 0))) &&
    (p.transform === undefined || (p.transform.length === 6 && p.transform.every(Number.isFinite)));
  if (!ok) {
    throw new RangeError('Invalid paint value');
  }
}
/** One value for every side, or top, right, bottom and left. */
export type LayoutSides<T> = T | readonly [top: T, right: T, bottom: T, left: T];
export type LayoutAlignKeyword =
  'auto' | 'start' | 'end' | 'flex-start' | 'flex-end' | 'center' | 'baseline' | 'stretch';
export type LayoutContentKeyword =
  | 'normal'
  | 'start'
  | 'end'
  | 'flex-start'
  | 'flex-end'
  | 'center'
  | 'stretch'
  | 'space-between'
  | 'space-around'
  | 'space-evenly';
export type LayoutOverflowKeyword = 'visible' | 'clip' | 'hidden' | 'scroll';
/**
 * A typed layout style. Values use logical pixels. The box-model fields are
 * written through the same property router as `setProperty`; null on one of
 * them restores a new node's value.
 */
export interface LayoutStyle {
  width?: LayoutLength;
  height?: LayoutLength;
  minWidth?: LayoutLength;
  minHeight?: LayoutLength;
  maxWidth?: LayoutLength;
  maxHeight?: LayoutLength;
  direction?: LayoutDirection;
  align?: LayoutAlign;
  justify?: LayoutJustify;
  overflow?: LayoutOverflow;
  grow?: number;
  shrink?: number;
  gap?: number;
  padding?: LayoutSides<LayoutLength> | null;
  margin?: LayoutSides<LayoutLength> | null;
  /** Border widths take layout space and paint with the node's border color. */
  border?: LayoutSides<number> | null;
  rowGap?: LayoutLength | null;
  columnGap?: LayoutLength | null;
  display?: 'flex' | 'grid' | 'block' | 'none' | null;
  position?: 'relative' | 'absolute' | null;
  inset?: LayoutSides<LayoutLength> | null;
  wrap?: 'nowrap' | 'wrap' | 'wrap-reverse' | null;
  alignSelf?: LayoutAlignKeyword | null;
  alignContent?: LayoutContentKeyword | null;
  justifyItems?: LayoutAlignKeyword | null;
  justifySelf?: LayoutAlignKeyword | null;
  basis?: LayoutLength | null;
  /** CSS `order`: children lay out and paint stably sorted by it. */
  order?: number | null;
  /** Width over height. */
  aspectRatio?: number | null;
  overflowX?: LayoutOverflowKeyword | null;
  overflowY?: LayoutOverflowKeyword | null;
  /** CSS grid text, such as `repeat(3, 1fr) 120px`, `span 2` or `1 / -1`. */
  gridTemplateColumns?: string | null;
  gridTemplateRows?: string | null;
  gridColumn?: string | null;
  gridRow?: string | null;
}
type NativeLayoutStyle = Pick<
  LayoutStyle,
  | 'width'
  | 'height'
  | 'minWidth'
  | 'minHeight'
  | 'maxWidth'
  | 'maxHeight'
  | 'direction'
  | 'align'
  | 'justify'
  | 'overflow'
  | 'grow'
  | 'shrink'
  | 'gap'
> & { padding?: number };
/** Typed fields routed through the property router, by the CSS property each writes. */
const routed: Readonly<Record<string, string>> = {
  margin: 'margin',
  border: 'border-width',
  rowGap: 'row-gap',
  columnGap: 'column-gap',
  display: 'display',
  position: 'position',
  inset: 'inset',
  wrap: 'flex-wrap',
  alignSelf: 'align-self',
  alignContent: 'align-content',
  justifyItems: 'justify-items',
  justifySelf: 'justify-self',
  basis: 'flex-basis',
  order: 'order',
  aspectRatio: 'aspect-ratio',
  overflowX: 'overflow-x',
  overflowY: 'overflow-y',
  gridTemplateColumns: 'grid-template-columns',
  gridTemplateRows: 'grid-template-rows',
  gridColumn: 'grid-column',
  gridRow: 'grid-row',
  padding: 'padding',
};
function cssText(value: unknown): string {
  return Array.isArray(value) ? value.join(' ') : String(value);
}
/** Split a typed style into the native fields and CSS layout declarations. */
function splitStyle(style: LayoutStyle): {
  native: NativeLayoutStyle;
  declarations: [name: string, value: string | null][];
} {
  const native: Record<string, unknown> = {};
  const declarations: [string, string | null][] = [];
  for (const [key, value] of Object.entries(style)) {
    if (value === undefined) {
      continue;
    }
    const css = routed[key];
    if (css === undefined || (key === 'padding' && typeof value === 'number')) {
      native[key] = value;
      continue;
    }
    declarations.push([css, value === null ? null : cssText(value)]);
  }
  return { native: native, declarations };
}

/** @internal Native adapter contract; applications use Layout and LayoutNode. */
interface NativePaintStyle extends Omit<PaintStyle, 'background' | 'maskImage' | 'filter'> {
  background?: NativeBrush;
  maskImage?: NativeBrush;
  filter?: Exclude<PaintStyle['filter'], null | undefined>;
  clearFilter?: boolean;
  clearMask?: boolean;
}
export interface NativeLayoutNode {
  readonly id: bigint;
  setPaint(style: NativePaintStyle): void;
  clearPaint(): void;
  setText(content: string, style: TextStyle): void;
  setVisual(bounds: VisualBounds | null): void;
  setPointerEvents(enabled: boolean): void;
  setResource(slot: number | null, canvas: boolean): void;
  setScroll(x: number, y: number): void;
  setStyle(style: NativeLayoutStyle): void;
  setChildren(children: readonly NativeLayoutNode[]): void;
  insertBefore(child: NativeLayoutNode, before: NativeLayoutNode | null | undefined): void;
  removeChild(child: NativeLayoutNode): void;
  detach(): void;
  contentSize(): number[];
  remove(): void;
}
/** @internal */
export interface NativeLayout extends BrushFactory {
  setImageSource(source: string, fit: ImageFit, slot: number | null): void;
  createText(content: string, text: TextStyle, style: NativeLayoutStyle): NativeLayoutNode;
  applyCommands(
    words: Uint32Array,
    numbers: Float64Array,
    strings: readonly string[],
    brushes: readonly NativeBrush[],
  ): void;
  prepareDisplayList(root: NativeLayoutNode, options: PaintOptions): PaintInfo;
  readDisplayList(target: Float32Array): void;
  atlasInfo(color: boolean, seen: number): AtlasInfo | null;
  readAtlas(color: boolean, seen: number, target: Uint8Array): AtlasInfo | null;
  hitTest(root: NativeLayoutNode, x: number, y: number): SceneHit[];
  hitTestRegion(
    root: NativeLayoutNode,
    x: number,
    y: number,
  ): { hits: SceneHit[]; bounds: number[] };
  readonly size: number;
  readonly disposed: boolean;
  createNode(style: NativeLayoutStyle): NativeLayoutNode;
  compute(root: NativeLayoutNode, width: number, height: number): void;
  readBounds(nodes: readonly NativeLayoutNode[], target: Float32Array): void;
  cssAddSheet(
    source: Uint8Array | string,
    file: string | undefined,
    at: number | undefined,
  ): { id: number; diagnostics: CssDiagnostic[] };
  cssRemoveSheet(id: number): boolean;
  cssSetTheme(names: string[], values: string[]): void;
  cssSetEnvironment(width: number, height: number, dark: boolean): void;
  cssSetRootFontSize(px: number): void;
  cssIntern(names: string[]): Uint32Array;
  cssRestyle(root: NativeLayoutNode): {
    errors: string[];
    restyled: number;
    nodes: Uint32Array;
    counts: Uint32Array;
    names: string[];
    values: string[];
  };
  dispose(): void;
}

/** A stylesheet added to a layout, and what reading it reported. */
export interface StyleSheet {
  readonly id: number;
  readonly diagnostics: readonly CssDiagnostic[];
}
export interface CssDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly line: number;
  readonly column: number;
  /** The file it is in, when it is not the sheet's own: one it imports. */
  readonly file?: string | null;
}
/** What a restyle changed beyond layout. */
export interface Restyled {
  /** Declarations that could not be applied, as `property: value: reason`. */
  readonly errors: readonly string[];
  /** How many nodes the restyle matched again. */
  readonly matched: number;
  /** By node id: the paint and text declarations that apply to it now, `var()`s resolved. */
  readonly nodes: ReadonlyMap<bigint, readonly (readonly [property: string, value: string])[]>;
}
/** @internal Addon functions that need no layout context. */
export interface NativeCss {
  cssIsLayoutProperty(name: string): boolean;
  cssStates(): string[];
}

/** An owned native tree. A mounted root's Scope can release it during HMR. */
export class Layout {
  readonly #native: NativeLayout;
  #hitRevision = 0;
  readonly #listeners = new Set<(change: LayoutChange) => void>();
  readonly #queue = new CommandQueue();
  readonly #css: NativeCss;
  readonly #atoms = new Map<string, number>();
  readonly #layoutNames = new Map<string, boolean>();
  readonly #restyleListeners = new Set<(restyled: Restyled) => void>();
  #styled = false;
  #dark = false;
  #environment = '';
  readonly #beforeFlush: (() => void)[] = [];
  #scheduled = false;

  /** @internal Use loadNative().createLayout(scope). */
  constructor(native: NativeLayout, css: NativeCss, scope?: Scope) {
    this.#native = native;
    this.#css = css;
    scope?.onCleanup(() => this.dispose());
  }

  /** Successful edits notify synchronously; hosts coalesce them into one frame. */
  onChange(listener: (change: LayoutChange) => void, scope?: Scope): () => void {
    if (this.disposed) {
      throw new Error('Layout disposed');
    }
    const callback = (change: LayoutChange) => listener(change);
    this.#listeners.add(callback);
    const remove = () => {
      this.#listeners.delete(callback);
    };
    scope?.onCleanup(remove);
    return remove;
  }
  /** @internal Nodes notify only after a native edit succeeds. */
  changed(change: LayoutChange): void {
    this.#hitRevision++;
    let errors: unknown[] | undefined;
    for (const listener of this.#listeners) {
      try {
        listener(change);
      } catch (error) {
        (errors ??= []).push(error);
      }
    }
    if (errors) {
      throw new AggregateError(errors, 'Layout change listener failed');
    }
  }

  /** @internal The command buffer, which flushes at the end of the tick. */
  queue(): CommandQueue {
    if (this.disposed) {
      throw new Error('Layout disposed');
    }
    if (!this.#scheduled) {
      this.#scheduled = true;
      queueMicrotask(() => {
        this.#scheduled = false;
        if (!this.disposed) {
          this.flush();
        }
      });
    }
    return this.#queue;
  }

  /**
   * Submit queued edits as one native call. They flush on their own at the
   * end of the tick, and before any read or immediate edit. Commands apply
   * in order; if one fails, the error is thrown and the edits before it stay.
   */
  flush(): void {
    for (const hook of this.#beforeFlush) {
      hook();
    }
    if (this.#queue.empty) {
      return;
    }
    const batch = this.#queue.take();
    try {
      this.#native.applyCommands(batch.words, batch.numbers, batch.strings, batch.brushes);
    } finally {
      this.changed(batch.layout ? 'layout' : 'paint');
    }
  }

  /** @internal Run `hook` at the start of every flush, so it can queue what it deferred. */
  beforeFlush(hook: () => void): void {
    this.#beforeFlush.push(hook);
  }

  /** @internal Apply CSS layout declarations now, after any queued edits. */
  applyNow(node: LayoutNode, declarations: readonly (readonly [string, string | null])[]): void {
    if (declarations.length > 0) {
      for (const [name, value] of declarations) {
        this.#queue.cssProperty(node, name, value);
      }
      this.flush();
    }
  }

  /** Changes on edits and computed geometry, including visual transforms and clipping. */
  get hitRevision(): number {
    return this.#hitRevision;
  }

  /** Cache geometric paths; continuous move handlers and dragging must still receive events. */
  createHitCache(root: LayoutNode): HitCache {
    this.flush();
    LayoutNode.unwrap(root, this);
    return new HitCache(this, root);
  }
  /** Exact local coordinates and bounds for a hit path, from one native walk. */
  hitTestRegion(root: LayoutNode, x: number, y: number): HitRegion {
    this.flush();
    const result = this.#native.hitTestRegion(LayoutNode.unwrap(root, this), x, y);
    return { hits: result.hits, bounds: result.bounds as [number, number, number, number] };
  }

  get size(): number {
    this.flush();
    return this.#native.size;
  }
  get disposed(): boolean {
    return this.#native.disposed;
  }

  createNode(style: LayoutStyle = {}): LayoutNode {
    const { native, declarations } = splitStyle(style);
    const node = new LayoutNode(this, this.#native.createNode(native));
    this.applyNow(node, declarations);
    return node;
  }

  /** Bind a source/fit to the renderer's prepared image slot; null removes it. */
  setImageSource(source: string, fit: ImageFit, slot: number | null): void {
    this.#native.setImageSource(source, fit, slot);
    this.changed('paint');
  }

  /** @internal */
  brushValue(brush: Brush): NativeBrush {
    return Brush.unwrap(brush, this.#native);
  }

  createText(content: string, text: TextStyle = {}, style: LayoutStyle = {}): LayoutNode {
    const { native, declarations } = splitStyle(style);
    const node = new LayoutNode(this, this.#native.createText(content, text, native));
    this.applyNow(node, declarations);
    return node;
  }

  /** Encode the computed scene once; native vectors retain capacity across frames. */
  prepareDisplayList(root: LayoutNode, options: PaintOptions = {}): PaintInfo {
    this.flush();
    return this.#native.prepareDisplayList(LayoutNode.unwrap(root, this), options);
  }

  /** Copy prepared records; edits invalidate them until the next preparation. */
  readDisplayList(target: Float32Array): void {
    this.#native.readDisplayList(target);
  }

  /** Inspect changes since the last GPU upload. Revision 0 requests a full atlas. */
  atlasInfo(color: boolean, seen: number): AtlasInfo | null {
    return this.#native.atlasInfo(color, seen);
  }

  /** Read the tightly packed update; acknowledge its revision only after uploading. */
  readAtlas(color: boolean, seen: number, target: Uint8Array): AtlasInfo | null {
    return this.#native.readAtlas(color, seen, target);
  }

  /** Topmost hit followed by its ancestors; uses the same visual offsets as paint. */
  hitTest(root: LayoutNode, x: number, y: number): SceneHit[] {
    this.flush();
    return this.#native.hitTest(LayoutNode.unwrap(root, this), x, y);
  }

  compute(root: LayoutNode, width: number, height: number): void {
    this.flush();
    if (this.#styled) {
      this.#setEnvironment(width, height);
      this.restyle(root);
      this.flush();
    }
    this.#hitRevision++;
    this.#native.compute(LayoutNode.unwrap(root, this), width, height);
  }

  // --- CSS, run by the native engine ---

  /** The state pseudo-classes, in the order of their bits (see `LayoutNode.queueStates`). */
  get stateNames(): readonly string[] {
    return (this.#stateNames ??= this.#css.cssStates());
  }
  #stateNames: string[] | undefined;
  /** Whether `name` is a property the layout router writes. */
  isLayoutProperty(name: string): boolean {
    let known = this.#layoutNames.get(name);
    if (known === undefined) {
      known = this.#css.cssIsLayoutProperty(name);
      this.#layoutNames.set(name, known);
    }
    return known;
  }
  /**
   * Atoms of this context's name table for `names`: class, attribute, type
   * and property names cross to native code as these numbers.
   */
  intern(names: readonly string[]): number[] {
    const missing = names.filter((name) => !this.#atoms.has(name));
    if (missing.length > 0) {
      const unique = [...new Set(missing)];
      const atoms = this.#native.cssIntern(unique);
      unique.forEach((name, i) => this.#atoms.set(name, atoms[i]!));
    }
    return names.map((name) => this.#atoms.get(name)!);
  }
  /**
   * Add a stylesheet, from compiled bytes (as the build step makes them) or
   * CSS text, last or at position `at` among the sheets. Diagnostics are
   * returned, not thrown: the rest of the sheet applies.
   */
  addStyleSheet(
    source: Uint8Array | string,
    options: { at?: number; file?: string } = {},
  ): StyleSheet {
    const sheet = this.#native.cssAddSheet(source, options.file, options.at);
    this.#markStyled();
    return { id: sheet.id, diagnostics: sheet.diagnostics };
  }
  /** Remove a sheet; false if it was removed already. */
  removeStyleSheet(sheet: StyleSheet): boolean {
    const removed = this.#native.cssRemoveSheet(sheet.id);
    if (removed) {
      this.changed('layout');
    }
    return removed;
  }
  /** The theme's variables, by name with or without `--`, which `var()` reads after the sheets'. */
  setTheme(variables: Readonly<Record<string, string>>): void {
    const names = Object.keys(variables);
    this.#native.cssSetTheme(
      names.map((name) => name.replace(/^--/, '')),
      names.map((name) => variables[name]!),
    );
    this.#markStyled();
  }
  /** Whether `prefers-color-scheme: dark` holds. */
  setColorScheme(scheme: 'light' | 'dark'): void {
    this.#dark = scheme === 'dark';
    this.#environment = '';
    this.#markStyled();
  }
  /** What `rem` is relative to. */
  setRootFontSize(px: number): void {
    this.#native.cssSetRootFontSize(px);
    this.#markStyled();
  }
  /** Listen for restyles: the paint and text declarations of each node whose changed. */
  onRestyle(listener: (restyled: Restyled) => void, scope?: Scope): () => void {
    const callback = (restyled: Restyled) => listener(restyled);
    this.#restyleListeners.add(callback);
    const remove = () => {
      this.#restyleListeners.delete(callback);
    };
    scope?.onCleanup(remove);
    return remove;
  }
  /**
   * Match what changed under `root` and apply its layout declarations.
   * Compute does this; call it to restyle without laying out. Declarations
   * that could not be applied are reported to `onRestyle` listeners, or as
   * warnings when there are none.
   */
  restyle(root: LayoutNode): Restyled {
    this.flush();
    const r = this.#native.cssRestyle(LayoutNode.unwrap(root, this));
    const nodes = new Map<bigint, [string, string][]>();
    let at = 0;
    for (let i = 0; i < r.counts.length; i++) {
      const id = BigInt(r.nodes[i * 2]!) | (BigInt(r.nodes[i * 2 + 1]!) << 32n);
      const declarations: [string, string][] = [];
      for (let k = 0; k < r.counts[i]!; k++, at++) {
        declarations.push([r.names[at]!, r.values[at]!]);
      }
      nodes.set(id, declarations);
    }
    const restyled: Restyled = { errors: r.errors, nodes, matched: r.restyled };
    if (this.#restyleListeners.size === 0) {
      for (const error of r.errors) {
        console.warn(`CSS: ${error}`);
      }
    }
    for (const listener of this.#restyleListeners) {
      listener(restyled);
    }
    return restyled;
  }
  /** @internal Something the cascade reads changed. */
  markStyled(): void {
    this.#markStyled();
  }
  #markStyled(): void {
    this.#styled = true;
    this.changed('layout');
  }
  #setEnvironment(width: number, height: number): void {
    const key = `${width}x${height}:${this.#dark}`;
    if (key !== this.#environment) {
      this.#environment = key;
      this.#native.cssSetEnvironment(width, height, this.#dark);
    }
  }

  /** Write absolute [x, y, width, height] per node into reusable caller-owned storage. */
  readBounds(nodes: readonly LayoutNode[], target: Float32Array): void {
    this.flush();
    this.#native.readBounds(
      nodes.map((node) => LayoutNode.unwrap(node, this)),
      target,
    );
  }

  /** Release the tree and invalidate every node. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.#queue.clear();
    this.#native.dispose();
    try {
      this.changed('disposed');
    } finally {
      this.#listeners.clear();
    }
  }
}

export class LayoutNode implements QueuedNode {
  readonly #layout: Layout;
  readonly #native: NativeLayoutNode;
  readonly #id: bigint;
  /** @internal The raw id's low and high words, as the command buffer names nodes. */
  readonly lo: number;
  /** @internal */
  readonly hi: number;

  /** @internal Use layout.createNode(). */
  constructor(layout: Layout, native: NativeLayoutNode) {
    this.#layout = layout;
    this.#native = native;
    this.#id = native.id;
    this.lo = Number(this.#id & 0xffffffffn);
    this.hi = Number(this.#id >> 32n);
  }

  /** @internal */
  static unwrap(node: LayoutNode, layout: Layout): NativeLayoutNode {
    if (node.#layout !== layout) {
      throw new Error('Node belongs to another layout context');
    }
    return node.#native;
  }

  /** Generation-bearing identity, unique within the layout context. */
  get id(): bigint {
    return this.#id;
  }

  setPaint(style: PaintStyle): void {
    const { background, maskImage, filter, ...fields } = style;
    const patch: NativePaintStyle = fields;
    if (background !== undefined) {
      patch.background = this.#layout.brushValue(background);
    }
    if (maskImage === null) {
      patch.clearMask = true;
    } else if (maskImage !== undefined) {
      patch.maskImage = this.#layout.brushValue(maskImage);
    }
    if (filter === null) {
      patch.clearFilter = true;
    } else if (filter !== undefined) {
      patch.filter = filter;
    }
    this.#layout.flush();
    this.#native.setPaint(patch);
    this.#layout.changed('paint');
  }
  clearPaint(): void {
    this.#layout.flush();
    this.#native.clearPaint();
    this.#layout.changed('paint');
  }
  setText(content: string, style: TextStyle = {}): void {
    this.#layout.flush();
    this.#native.setText(content, style);
    this.#layout.changed('layout');
  }
  setVisual(bounds: VisualBounds | null): void {
    this.#layout.flush();
    this.#native.setVisual(bounds);
    this.#layout.changed('paint');
  }
  setPointerEvents(enabled: boolean): void {
    this.#layout.flush();
    this.#native.setPointerEvents(enabled);
  }
  /** Reference a renderer-owned image or canvas slot; null removes the reference. */
  setResource(slot: number | null, canvas = false): void {
    this.#layout.flush();
    this.#native.setResource(slot, canvas);
    this.#layout.changed('paint');
  }
  setScroll(x: number, y: number): void {
    this.#layout.flush();
    this.#native.setScroll(x, y);
    this.#layout.changed('paint');
  }

  /**
   * @internal Queue a paint patch for the end of the tick. Patches with
   * shadows, filters, masks or corner shapes are applied at once, after the queue.
   */
  queuePaint(style: PaintStyle, clear = false): void {
    const { background, maskImage, filter, shadows, cornerShape, cornerShapeLocked, ...fields } =
      style;
    if (
      maskImage !== undefined ||
      filter !== undefined ||
      shadows !== undefined ||
      cornerShape !== undefined ||
      cornerShapeLocked !== undefined
    ) {
      if (clear) {
        this.clearPaint();
      }
      this.setPaint(style);
      return;
    }
    checkPaint(fields);
    const patch: QueuedPaint = { ...fields, ...(clear ? { clear } : {}) };
    if (background !== undefined) {
      const solid = Brush.solidColor(background);
      if (solid) {
        patch.solid = solid;
      } else {
        patch.brush = this.#layout.brushValue(background);
      }
    }
    this.#layout.queue().paint(this, patch);
  }
  /** @internal Queue text and its style for the end of the tick. */
  queueText(content: string, style: TextStyle = {}): void {
    this.#layout.queue().text(this, content, style);
  }
  /** @internal Queue a scroll offset for the end of the tick. */
  queueScroll(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError('Expected a finite number');
    }
    this.#layout.queue().scroll(this, x, y);
  }
  /** @internal Queue an insertion; the caller has checked it makes no cycle. */
  queueInsertBefore(child: LayoutNode, before: LayoutNode | null): void {
    LayoutNode.unwrap(child, this.#layout);
    if (before) {
      LayoutNode.unwrap(before, this.#layout);
    }
    this.#layout.queue().insert(this, child, before);
  }
  /** @internal Describe this node to the cascade; names are atoms (see `Layout.intern`). */
  queueElement(element: QueuedElement): void {
    this.#layout.markStyled();
    this.#layout.queue().element(this, element);
  }
  /** @internal This node's state pseudo-classes, a bit each in the engine's order. */
  queueStates(bits: number): void {
    this.#layout.queue().states(this, bits);
  }
  /** @internal Queue taking this node out of its parent. */
  queueDetach(): void {
    this.#layout.queue().detach(this);
  }
  /** @internal Queue removing this node and its descendants. */
  queueRemove(): void {
    this.#layout.queue().remove(this);
  }

  /** Merge the supplied style fields; omitted fields retain their values. */
  setStyle(style: LayoutStyle): void {
    const { native, declarations } = splitStyle(style);
    this.#layout.flush();
    if (Object.keys(native).length > 0) {
      this.#native.setStyle(native);
    }
    this.#layout.applyNow(this, declarations);
    this.#layout.changed('layout');
  }

  /**
   * Queue a write of router property `id` (see `LayoutProperty`): a number,
   * an enum code, grid text, or null to restore a new node's value. Writes
   * in one tick coalesce and are submitted together.
   */
  setProperty(id: number, value: number | string | null): void {
    this.#layout.queue().property(this, propertyWrite(id, value));
  }

  /**
   * Queue a CSS layout declaration, such as `('margin', '8px auto')` or
   * `('grid-column', '1 / -1')`, read by the same native parser as a
   * stylesheet's. Numbers are pixels. Returns false for a property that is
   * not a layout property; a value that does not parse makes the flush throw.
   */
  setLayoutProperty(name: string, value: number | string | null): boolean {
    if (!this.#layout.isLayoutProperty(name)) {
      return false;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new RangeError(`Invalid value for ${name}: ${value}`);
    }
    this.#layout.queue().cssProperty(this, name, value === null ? null : String(value));
    return true;
  }

  /** Replace or reorder children, detaching moved nodes from previous parents. */
  setChildren(children: readonly LayoutNode[]): void {
    this.#layout.flush();
    this.#native.setChildren(children.map((child) => LayoutNode.unwrap(child, this.#layout)));
    this.#layout.changed('layout');
  }

  /**
   * Place `child` before `before`, or last when it is null, moving it from
   * wherever it is. One native edit; siblings are not resubmitted.
   */
  insertBefore(child: LayoutNode, before: LayoutNode | null = null): void {
    this.#layout.flush();
    this.#native.insertBefore(
      LayoutNode.unwrap(child, this.#layout),
      before && LayoutNode.unwrap(before, this.#layout),
    );
    this.#layout.changed('layout');
  }

  append(child: LayoutNode): void {
    this.insertBefore(child, null);
  }

  /** Detach `child`, which must be this node's; it stays valid and can be placed again. */
  removeChild(child: LayoutNode): void {
    this.#layout.flush();
    this.#native.removeChild(LayoutNode.unwrap(child, this.#layout));
    this.#layout.changed('layout');
  }

  /**
   * How far laid-out content reaches, right and down from this node's
   * top-left, after compute: past its size when content overflows.
   */
  contentSize(): [width: number, height: number] {
    this.#layout.flush();
    const [width, height] = this.#native.contentSize();
    return [width!, height!];
  }

  /** Take this node out of its parent, keeping it valid. */
  detach(): void {
    this.#layout.flush();
    this.#native.detach();
    this.#layout.changed('layout');
  }

  /** Remove this node and its descendants. Removed handles remain invalid. */
  remove(): void {
    this.#layout.flush();
    this.#native.remove();
    this.#layout.changed('layout');
  }
}

/** A geometric path cache. Repeated points allocate nothing and cross no native boundary. */
export class HitCache {
  readonly #layout: Layout;
  readonly #root: LayoutNode;
  #revision = -1;
  #region: HitRegion | undefined;
  #path: readonly bigint[] = [];
  constructor(layout: Layout, root: LayoutNode) {
    this.#layout = layout;
    this.#root = root;
  }
  /** Valid only for the current geometry. Bounds use layout pixels, not device pixels. */
  get bounds(): readonly [number, number, number, number] | undefined {
    return this.#revision === this.#layout.hitRevision && !this.#layout.disposed
      ? this.#region?.bounds
      : undefined;
  }
  pathAt(x: number, y: number): readonly bigint[] {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError('Invalid hit coordinates');
    }
    if (this.#layout.disposed) {
      throw new Error('Layout disposed');
    }
    const bounds = this.bounds;
    if (bounds && x >= bounds[0] && y >= bounds[1] && x < bounds[2] && y < bounds[3]) {
      return this.#path;
    }
    this.#region = this.#layout.hitTestRegion(this.#root, x, y);
    this.#revision = this.#layout.hitRevision;
    this.#path = this.#region.hits.map((hit) => hit.nodeId);
    return this.#path;
  }
}
export interface HitRegion {
  /** Fresh local coordinates at the queried point. */
  readonly hits: readonly SceneHit[];
  readonly bounds: readonly [number, number, number, number];
}
