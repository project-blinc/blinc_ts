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
export interface NativeLayoutNode {
  setStyle(style: LayoutStyle): void;
  setChildren(children: readonly NativeLayoutNode[]): void;
  remove(): void;
}
/** @internal */
export interface NativeLayout {
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
