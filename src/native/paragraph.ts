/**
 * A paragraph in a layout tree: differently styled runs laid out as one
 * inline flow and shown as text nodes placed where each line puts them.
 */
import type { NativeBindings } from './index.js';
import type { Layout, LayoutNode } from './layout.js';
import type { PaintStyle, TextStyle } from './scene.js';
import type { InlineAlign, InlineItem, InlineLayout } from './text.js';

export interface ParagraphRun {
  text: string;
  style?: TextStyle;
  /** Paint for this run's text, such as its `textColor`. */
  paint?: PaintStyle;
}

/**
 * Lays its runs out at a given width under `node`, which it sizes to their
 * height. Each line's part of a run is one text node that does not wrap,
 * positioned absolutely, so a run that wraps shows as several pieces.
 */
export class Paragraph {
  readonly node: LayoutNode;
  readonly #native: NativeBindings;
  readonly #layout: Layout;
  #runs: ParagraphRun[] = [];
  #align: InlineAlign;
  #pieces: LayoutNode[] = [];
  #last: InlineLayout | undefined;

  constructor(native: NativeBindings, layout: Layout, align: InlineAlign = 'left') {
    this.#native = native;
    this.#layout = layout;
    this.#align = align;
    this.node = layout.createNode({ position: 'relative', shrink: 0 });
  }
  get runs(): readonly ParagraphRun[] {
    return this.#runs;
  }
  set runs(runs: readonly ParagraphRun[]) {
    this.#runs = [...runs];
    this.#last = undefined;
  }
  set align(align: InlineAlign) {
    this.#align = align;
    this.#last = undefined;
  }
  /** The last layout, for hit-testing a point to a run and caret. */
  get laidOut(): InlineLayout | undefined {
    return this.#last;
  }

  /** Lay the runs out `width` wide and place their pieces; returns the height. */
  update(width: number): number {
    const items: InlineItem[] = this.#runs.map((run) => ({
      kind: 'text',
      text: run.text,
      ...(run.style ? { style: run.style } : {}),
    }));
    const laid = this.#native.layoutInline(items, width, { align: this.#align });
    this.#last = laid;
    const fragments = laid.fragments;
    while (this.#pieces.length < fragments.length) {
      this.#pieces.push(this.#layout.createText('', {}, { position: 'absolute' }));
    }
    for (const piece of this.#pieces.splice(fragments.length)) {
      piece.remove();
    }
    fragments.forEach((fragment, i) => {
      const run = this.#runs[fragment.item]!;
      const piece = this.#pieces[i]!;
      piece.setText(fragment.text, { ...run.style, wrap: false });
      piece.setStyle({ inset: [fragment.y, 'auto', 'auto', fragment.x] });
      if (run.paint) {
        piece.setPaint(run.paint);
      }
    });
    this.node.setChildren(this.#pieces);
    this.node.setStyle({ width, height: laid.height });
    return laid.height;
  }
}
