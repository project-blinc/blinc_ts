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
import { layoutDeclaration, propertyWrite, type PropertyWrite } from './properties.js';

export type LayoutChange = 'layout' | 'paint' | 'disposed';

export type LayoutLength = number | `${number}%` | 'auto';
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
function cssText(value: unknown): string | number {
  return Array.isArray(value) ? value.join(' ') : (value as string | number);
}
/** Split a typed style into the native fields and router writes, validating both. */
function splitStyle(style: LayoutStyle): { native: NativeLayoutStyle; writes: PropertyWrite[] } {
  const native: Record<string, unknown> = {};
  const writes: PropertyWrite[] = [];
  for (const [key, value] of Object.entries(style)) {
    if (value === undefined) {
      continue;
    }
    const css = routed[key];
    if (css === undefined || (key === 'padding' && typeof value === 'number')) {
      native[key] = value;
      continue;
    }
    const v = value === null ? null : cssText(value);
    writes.push(
      ...(key === 'aspectRatio' && typeof v === 'number'
        ? [propertyWrite(90, v)]
        : layoutDeclaration(css, v)!),
    );
  }
  return { native: native, writes };
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
  remove(): void;
}
/** @internal */
export interface NativeLayout extends BrushFactory {
  setImageSource(source: string, fit: ImageFit, slot: number | null): void;
  createText(content: string, text: TextStyle, style: NativeLayoutStyle): NativeLayoutNode;
  applyProperties(
    nodes: readonly NativeLayoutNode[],
    ops: Int32Array,
    numbers: Float64Array,
    strings: readonly string[],
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
  dispose(): void;
}

/** An owned native tree. A mounted root's Scope can release it during HMR. */
export class Layout {
  readonly #native: NativeLayout;
  #hitRevision = 0;
  readonly #listeners = new Set<(change: LayoutChange) => void>();
  // Queued property writes: the latest write per node and property, in write order.
  #nodes: NativeLayoutNode[] = [];
  readonly #nodeIndex = new Map<NativeLayoutNode, number>();
  #writes: ([node: number, write: PropertyWrite] | undefined)[] = [];
  readonly #slots = new Map<string, number>();
  #scheduled = false;

  /** @internal Use loadNative().createLayout(scope). */
  constructor(native: NativeLayout, scope?: Scope) {
    this.#native = native;
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

  /** @internal Queue a write; a later write to the same property replaces it. */
  queueProperty(node: NativeLayoutNode, write: PropertyWrite): void {
    if (this.disposed) {
      throw new Error('Layout disposed');
    }
    let index = this.#nodeIndex.get(node);
    if (index === undefined) {
      index = this.#nodes.push(node) - 1;
      this.#nodeIndex.set(node, index);
    }
    // Percentage and pixel ids share a field, so a replaced write moves to the end.
    const key = `${index}:${write[0]}`;
    const slot = this.#slots.get(key);
    if (slot !== undefined) {
      this.#writes[slot] = undefined;
    }
    this.#slots.set(key, this.#writes.push([index, write]) - 1);
    if (!this.#scheduled) {
      this.#scheduled = true;
      queueMicrotask(() => {
        this.#scheduled = false;
        if (!this.disposed) {
          this.flush();
        }
      });
    }
  }

  /**
   * Submit queued property writes as one native edit. Writes flush on their
   * own at the end of the tick, and before any read or other edit.
   */
  flush(): void {
    if (this.#writes.length === 0) {
      return;
    }
    const nodes = this.#nodes;
    const writes = this.#writes.filter((write) => write !== undefined);
    this.#nodes = [];
    this.#writes = [];
    this.#nodeIndex.clear();
    this.#slots.clear();
    this.#submit(nodes, writes);
  }

  /** @internal Apply writes now, after any queued ones. */
  applyNow(node: NativeLayoutNode, writes: readonly PropertyWrite[]): void {
    this.flush();
    if (writes.length > 0) {
      this.#submit(
        [node],
        writes.map((write) => [0, write]),
      );
    }
  }

  #submit(
    nodes: readonly NativeLayoutNode[],
    writes: readonly (readonly [number, PropertyWrite])[],
  ): void {
    const ops = new Int32Array(writes.length * 3);
    const numbers = new Float64Array(writes.length);
    const strings: string[] = [];
    writes.forEach(([node, [id, kind, value]], i) => {
      ops[i * 3] = node;
      ops[i * 3 + 1] = id;
      ops[i * 3 + 2] = kind;
      numbers[i] = typeof value === 'string' ? strings.push(value) - 1 : value;
    });
    this.#native.applyProperties(nodes, ops, numbers, strings);
    this.changed('layout');
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
    return this.#native.size;
  }
  get disposed(): boolean {
    return this.#native.disposed;
  }

  createNode(style: LayoutStyle = {}): LayoutNode {
    const { native, writes } = splitStyle(style);
    const node = this.#native.createNode(native);
    this.applyNow(node, writes);
    return new LayoutNode(this, node);
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
    const { native, writes } = splitStyle(style);
    const node = this.#native.createText(content, text, native);
    this.applyNow(node, writes);
    return new LayoutNode(this, node);
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
    this.#hitRevision++;
    this.#native.compute(LayoutNode.unwrap(root, this), width, height);
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
    this.#writes = [];
    this.#nodes = [];
    this.#nodeIndex.clear();
    this.#slots.clear();
    this.#native.dispose();
    try {
      this.changed('disposed');
    } finally {
      this.#listeners.clear();
    }
  }
}

export class LayoutNode {
  readonly #layout: Layout;
  readonly #native: NativeLayoutNode;

  /** @internal Use layout.createNode(). */
  constructor(layout: Layout, native: NativeLayoutNode) {
    this.#layout = layout;
    this.#native = native;
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
    return this.#native.id;
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
    this.#native.setPaint(patch);
    this.#layout.changed('paint');
  }
  clearPaint(): void {
    this.#native.clearPaint();
    this.#layout.changed('paint');
  }
  setText(content: string, style: TextStyle = {}): void {
    this.#native.setText(content, style);
    this.#layout.changed('layout');
  }
  setVisual(bounds: VisualBounds | null): void {
    this.#native.setVisual(bounds);
    this.#layout.changed('paint');
  }
  setPointerEvents(enabled: boolean): void {
    this.#native.setPointerEvents(enabled);
  }
  /** Reference a renderer-owned image or canvas slot; null removes the reference. */
  setResource(slot: number | null, canvas = false): void {
    this.#native.setResource(slot, canvas);
    this.#layout.changed('paint');
  }
  setScroll(x: number, y: number): void {
    this.#native.setScroll(x, y);
    this.#layout.changed('paint');
  }

  /** Merge the supplied style fields; omitted fields retain their values. */
  setStyle(style: LayoutStyle): void {
    const { native, writes } = splitStyle(style);
    this.#layout.flush();
    if (Object.keys(native).length > 0) {
      this.#native.setStyle(native);
    }
    this.#layout.applyNow(this.#native, writes);
    this.#layout.changed('layout');
  }

  /**
   * Queue a write of router property `id` (see `LayoutProperty`): a number,
   * an enum code, grid text, or null to restore a new node's value. Writes
   * in one tick coalesce and are submitted together.
   */
  setProperty(id: number, value: number | string | null): void {
    this.#layout.queueProperty(this.#native, propertyWrite(id, value));
  }

  /**
   * Queue a CSS layout declaration, such as `('margin', '8px auto')` or
   * `('grid-column', '1 / -1')`. Returns false for a property that is not a
   * layout property; throws for a value that does not parse.
   */
  setLayoutProperty(name: string, value: number | string | null): boolean {
    const writes = layoutDeclaration(name, value);
    if (!writes) {
      return false;
    }
    for (const write of writes) {
      this.#layout.queueProperty(this.#native, write);
    }
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
