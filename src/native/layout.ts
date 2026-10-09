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

export type LayoutChange = 'layout' | 'paint' | 'disposed';

export type LayoutLength = number | `${number}%` | 'auto';
/** Initial native flex layout surface. Values use logical pixels. */
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
  padding?: number;
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
  setStyle(style: LayoutStyle): void;
  setChildren(children: readonly NativeLayoutNode[]): void;
  remove(): void;
}
/** @internal */
export interface NativeLayout extends BrushFactory {
  setImageSource(source: string, fit: ImageFit, slot: number | null): void;
  createText(content: string, text: TextStyle, style: LayoutStyle): NativeLayoutNode;
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
  createNode(style: LayoutStyle): NativeLayoutNode;
  compute(root: NativeLayoutNode, width: number, height: number): void;
  readBounds(nodes: readonly NativeLayoutNode[], target: Float32Array): void;
  dispose(): void;
}

/** An owned native tree. A mounted root's Scope can release it during HMR. */
export class Layout {
  readonly #native: NativeLayout;
  #hitRevision = 0;
  readonly #listeners = new Set<(change: LayoutChange) => void>();

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

  /** Changes on edits and computed geometry, including visual transforms and clipping. */
  get hitRevision(): number {
    return this.#hitRevision;
  }

  /** Cache geometric paths; continuous move handlers and dragging must still receive events. */
  createHitCache(root: LayoutNode): HitCache {
    LayoutNode.unwrap(root, this);
    return new HitCache(this, root);
  }
  /** Exact local coordinates and bounds for a hit path, from one native walk. */
  hitTestRegion(root: LayoutNode, x: number, y: number): HitRegion {
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
    return new LayoutNode(this, this.#native.createNode(style));
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
    return new LayoutNode(this, this.#native.createText(content, text, style));
  }

  /** Encode the computed scene once; native vectors retain capacity across frames. */
  prepareDisplayList(root: LayoutNode, options: PaintOptions = {}): PaintInfo {
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
    return this.#native.hitTest(LayoutNode.unwrap(root, this), x, y);
  }

  compute(root: LayoutNode, width: number, height: number): void {
    this.#hitRevision++;
    this.#native.compute(LayoutNode.unwrap(root, this), width, height);
  }

  /** Write absolute [x, y, width, height] per node into reusable caller-owned storage. */
  readBounds(nodes: readonly LayoutNode[], target: Float32Array): void {
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
    this.#native.setStyle(style);
    this.#layout.changed('layout');
  }

  /** Replace or reorder children, detaching moved nodes from previous parents. */
  setChildren(children: readonly LayoutNode[]): void {
    this.#native.setChildren(children.map((child) => LayoutNode.unwrap(child, this.#layout)));
    this.#layout.changed('layout');
  }

  /** Remove this node and its descendants. Removed handles remain invalid. */
  remove(): void {
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
