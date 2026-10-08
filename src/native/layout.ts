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
interface NativePaintStyle extends Omit<PaintStyle, 'background'> {
  background?: NativeBrush;
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

  /** @internal Use loadNative().createLayout(scope). */
  constructor(native: NativeLayout, scope?: Scope) {
    this.#native = native;
    scope?.onCleanup(() => this.dispose());
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
    this.#native.dispose();
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
    const { background, ...fields } = style;
    this.#native.setPaint(
      background === undefined
        ? fields
        : { ...fields, background: this.#layout.brushValue(background) },
    );
  }
  clearPaint(): void {
    this.#native.clearPaint();
  }
  setText(content: string, style: TextStyle = {}): void {
    this.#native.setText(content, style);
  }
  setVisual(bounds: VisualBounds | null): void {
    this.#native.setVisual(bounds);
  }
  setPointerEvents(enabled: boolean): void {
    this.#native.setPointerEvents(enabled);
  }
  /** Reference a renderer-owned image or canvas slot; null removes the reference. */
  setResource(slot: number | null, canvas = false): void {
    this.#native.setResource(slot, canvas);
  }
  setScroll(x: number, y: number): void {
    this.#native.setScroll(x, y);
  }

  /** Merge the supplied style fields; omitted fields retain their values. */
  setStyle(style: LayoutStyle): void {
    this.#native.setStyle(style);
  }

  /** Replace or reorder children, detaching moved nodes from previous parents. */
  setChildren(children: readonly LayoutNode[]): void {
    this.#native.setChildren(children.map((child) => LayoutNode.unwrap(child, this.#layout)));
  }

  /** Remove this node and its descendants. Removed handles remain invalid. */
  remove(): void {
    this.#native.remove();
  }
}
