/**
 * Text measurement and inline layout, with the shaping and line breaking
 * the renderer draws with. Indices are UTF-16, as JavaScript strings count.
 */
import type { TextStyle } from './scene.js';

/** @internal */
export interface NativeText {
  measureText(
    text: string,
    style: TextStyle,
    wrapWidth: number | null | undefined,
  ): {
    width: number;
    lineHeight: number;
    ascender: number;
    descender: number;
    lines: Float64Array;
    carets: Float64Array;
  };
  layoutInline(
    items: readonly NativeInlineItem[],
    width: number,
    align: number,
    breakWords: boolean,
  ): {
    fragments: Float64Array;
    lines: Float64Array;
    texts: string[];
    maxContent: number;
    minContent: number;
    height: number;
  };
}
interface NativeInlineItem {
  kind: number;
  text?: string;
  style?: TextStyle;
  paddingLeft?: number;
  paddingRight?: number;
  width?: number;
  height?: number;
  baseline?: number;
  block?: boolean;
}

export interface TextLine {
  /** The UTF-16 index the line starts at, and where it ends. */
  readonly start: number;
  readonly end: number;
  readonly width: number;
}
export interface Caret {
  /** The UTF-16 index the caret stands before. */
  readonly index: number;
  readonly x: number;
  readonly line: number;
}

/** A run of text laid out in one style: its lines, metrics and caret stops. */
export class TextMeasurement {
  readonly text: string;
  /** The widest line. */
  readonly width: number;
  readonly lineHeight: number;
  /** Above the baseline, and below it (negative). */
  readonly ascender: number;
  readonly descender: number;
  readonly #lines: Float64Array;
  readonly #carets: Float64Array;

  /** @internal */
  constructor(text: string, measured: ReturnType<NativeText['measureText']>) {
    this.text = text;
    this.width = measured.width;
    this.lineHeight = measured.lineHeight;
    this.ascender = measured.ascender;
    this.descender = measured.descender;
    this.#lines = measured.lines;
    this.#carets = measured.carets;
  }
  get lineCount(): number {
    return this.#lines.length / 3;
  }
  get height(): number {
    return this.lineCount * this.lineHeight;
  }
  /** From the top of a line to its baseline, with half the leading above, as text is drawn. */
  get baseline(): number {
    return (this.lineHeight - (this.ascender - this.descender)) / 2 + this.ascender;
  }
  line(i: number): TextLine {
    const l = this.#lines;
    if (!(i >= 0 && i < this.lineCount)) {
      throw new RangeError('No such line');
    }
    return { start: l[i * 3]!, end: l[i * 3 + 1]!, width: l[i * 3 + 2]! };
  }
  get lines(): TextLine[] {
    return Array.from({ length: this.lineCount }, (_, i) => this.line(i));
  }
  /** Every place a caret can stand, in order. A blank line still has one. */
  get carets(): Caret[] {
    const c = this.#carets;
    return Array.from({ length: c.length / 3 }, (_, i) => ({
      index: c[i * 3]!,
      x: c[i * 3 + 1]!,
      line: c[i * 3 + 2]!,
    }));
  }
  /** Where a caret before UTF-16 `index` stands; an index inside a character snaps back to its start. */
  caretAt(index: number): Caret {
    const c = this.#carets;
    let found = 0;
    for (let i = 0; i < c.length / 3; i++) {
      if (c[i * 3]! <= index) {
        found = i;
      } else {
        break;
      }
    }
    return { index: c[found * 3]!, x: c[found * 3 + 1]!, line: c[found * 3 + 2]! };
  }
  /** The caret nearest a point, in this text's coordinates. */
  caretNear(x: number, y: number): Caret {
    const line = Math.min(Math.max(Math.floor(y / this.lineHeight), 0), this.lineCount - 1);
    const c = this.#carets;
    let best: Caret | undefined;
    for (let i = 0; i < c.length / 3; i++) {
      if (c[i * 3 + 2] !== line) {
        continue;
      }
      const caret = { index: c[i * 3]!, x: c[i * 3 + 1]!, line };
      if (!best || Math.abs(caret.x - x) < Math.abs(best.x - x)) {
        best = caret;
      }
    }
    return best ?? this.caretAt(0);
  }
}

/** One item of a paragraph. */
export type InlineItem =
  | {
      kind: 'text';
      text: string;
      style?: TextStyle;
      /** Padding of a box painted around this run, at its start and end only. */
      paddingLeft?: number;
      paddingRight?: number;
    }
  | {
      /** An element kept whole: an image, an input, an inline box. */
      kind: 'box';
      width: number;
      height: number;
      /** From its top to the baseline it sits on; its bottom when omitted. */
      baseline?: number;
      /** A block takes a line of its own. */
      block?: boolean;
    }
  | { kind: 'break' };

export type InlineAlign = 'left' | 'center' | 'right' | 'justify';

export interface InlineFragment {
  /** The index of the item in the paragraph. */
  readonly item: number;
  /** For text: the characters shown, `start` to `end` of the item's collapsed text. */
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly line: number;
}
export interface InlineLine {
  readonly top: number;
  readonly height: number;
  /** From the line's top to its baseline. */
  readonly baseline: number;
}
export interface InlineLayout {
  readonly fragments: readonly InlineFragment[];
  readonly lines: readonly InlineLine[];
  /** Each text item's text with its whitespace collapsed; empty for other items. */
  readonly texts: readonly string[];
  /** The paragraph's natural width, its longest line unwrapped. */
  readonly maxContent: number;
  /** The narrowest it can be: its widest word or box, or 0 when words may break. */
  readonly minContent: number;
  readonly height: number;
}

const alignCodes: Readonly<Record<InlineAlign, number>> = {
  left: 0,
  center: 1,
  right: 2,
  justify: 3,
};

/** @internal */
export function toInlineLayout(
  native: NativeText,
  items: readonly InlineItem[],
  width: number,
  align: InlineAlign,
  breakWords: boolean,
): InlineLayout {
  const code = alignCodes[align];
  if (code === undefined) {
    throw new RangeError(`Invalid text alignment: ${String(align)}`);
  }
  const laid = native.layoutInline(
    items.map((item) =>
      item.kind === 'text'
        ? { ...item, kind: 0 }
        : item.kind === 'box'
          ? { ...item, kind: 1 }
          : { kind: 2 },
    ),
    width,
    code,
    breakWords,
  );
  const f = laid.fragments;
  const fragments: InlineFragment[] = [];
  for (let i = 0; i < f.length; i += 8) {
    const item = f[i]!;
    const start = f[i + 1]!;
    const end = f[i + 2]!;
    fragments.push({
      item,
      start,
      end,
      text: laid.texts[item]!.slice(start, end),
      x: f[i + 3]!,
      y: f[i + 4]!,
      width: f[i + 5]!,
      height: f[i + 6]!,
      line: f[i + 7]!,
    });
  }
  const l = laid.lines;
  const lines: InlineLine[] = [];
  for (let i = 0; i < l.length; i += 3) {
    lines.push({ top: l[i]!, height: l[i + 1]!, baseline: l[i + 2]! });
  }
  return {
    fragments,
    lines,
    texts: laid.texts,
    maxContent: laid.maxContent,
    minContent: laid.minContent,
    height: laid.height,
  };
}
