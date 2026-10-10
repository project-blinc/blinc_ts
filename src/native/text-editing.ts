/**
 * The editing behind a text field and a text area: a value, a caret and a selection over it, the
 * keys and pointer moves that change them, an input method's composition in place, and the
 * clipboard. A view draws what it holds and hands it events.
 *
 * Positions are UTF-16 indices. The caret stands only on the boundaries the text engine reports
 * for the view's font, the text laid out on one line or wrapped at `wrapWidth`.
 */
import type { Clipboard } from './clipboard.js';

/** Where a caret can stand: a string index, its x from the text's left, and its line. */
export interface CaretStop {
  readonly index: number;
  readonly x: number;
  readonly line: number;
}

/** What the text engine says of some text as the view shows it. */
export interface Measured {
  readonly stops: readonly CaretStop[];
  readonly lineHeight: number;
  readonly lines: number;
}

/** The part of a key event editing reads. */
export interface EditKey {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  preventDefault(): void;
}

export interface TextEditingOptions {
  /** Whether Enter starts a new line and Up and Down move between lines, as in a text area. */
  multiline: boolean;
  /** The text as the engine measures it, as the view shows it. */
  measure: (shown: string) => Measured;
  /** Where the clipboard is. */
  clipboard: () => Clipboard;
  /** Whether it takes no edits at all. */
  disabled?: () => boolean;
  /** Whether it can be selected and copied but not changed. */
  readOnly?: () => boolean;
  /** Whether this is a Mac, whose shortcuts differ; the platform's by default. */
  mac?: boolean;
}

const LINE_BREAKS = /\r\n|\r|\n/g;
const SPACE = /\s/;

export class TextEditing {
  readonly multiline: boolean;
  /** The text being edited. */
  value = '';
  /** Where the caret is, and where the selection started; equal when nothing is selected. */
  caret = 0;
  anchor = 0;
  /** An input method's text being composed at the caret, not yet in the value. */
  composing = '';
  /** Where the input method's caret is in `composing`, or -1 for its end. */
  composeCursor = -1;
  /** The width lines wrap at; 0 keeps the text on one line. */
  wrapWidth = 0;
  /** A password's: the character each of the value's is shown and measured as; none shows the value. */
  mask: string | null = null;
  /** What may be typed or pasted: the inserted text with anything refused taken out. */
  accept: ((text: string) => string) | null = null;
  /** The longest the value may be, in UTF-16 units; none is unlimited. */
  maxLength: number | null = null;
  /** Lines a page moves by, for Page Up and Page Down. */
  pageLines = (): number => 10;
  /** Called after anything the view shows changes: the value, the caret, the selection, a composition. */
  onChange: (() => void) | null = null;
  /** Called with the new value after each edit by the user. */
  onInput: ((value: string) => void) | null = null;
  /** Called on Enter in a single line field. */
  onSubmit: (() => void) | null = null;
  /** Called on Escape. */
  onEscape: (() => void) | null = null;

  readonly #options: TextEditingOptions;
  readonly #mac: boolean;
  /** What a press selects as it is dragged: 1 characters, 2 words, 3 paragraphs, and what it first selected. */
  #granularity = 1;
  #pressRange = { from: 0, to: 0 };
  /** The x the caret keeps to across Up and Down, until it moves another way. */
  #goalX: number | null = null;
  #dragging = false;
  #measured: { shown: string; wrap: number; result: Measured } | null = null;

  constructor(options: TextEditingOptions) {
    this.#options = options;
    this.multiline = options.multiline;
    this.#mac = options.mac ?? process.platform === 'darwin';
  }

  // --- geometry --------------------------------------------------------------------------

  /** The caret stops of what is shown, from the text engine, measured again only when it changes. */
  measured(): Measured {
    const shown = this.display();
    const cached = this.#measured;
    if (cached?.shown === shown && cached.wrap === this.wrapWidth) {
      return cached.result;
    }
    const result = this.#options.measure(shown);
    this.#measured = { shown, wrap: this.wrapWidth, result };
    return result;
  }

  /** Forget what was measured: the font, or the width it wraps at, changed. */
  remeasure(): void {
    this.#measured = null;
  }

  /** The stop the caret before string index `i` of what is shown stands at. */
  stopAt(i: number): CaretStop {
    const stops = this.measured().stops;
    let best = stops[0] ?? { index: 0, x: 0, line: 0 };
    for (const stop of stops) {
      if (stop.index <= i) {
        best = stop;
      } else {
        break;
      }
    }
    return best;
  }

  /** The index of the stop nearest `x` on `line`, or on the nearest line there is. */
  indexAt(x: number, line: number): number {
    const stops = this.measured().stops;
    const last = stops.at(-1)?.line ?? 0;
    const on = Math.max(0, Math.min(last, line));
    let best = stops[0]?.index ?? 0;
    let distance = Number.POSITIVE_INFINITY;
    for (const stop of stops) {
      if (stop.line !== on) {
        continue;
      }
      const d = Math.abs(stop.x - x);
      if (d < distance) {
        distance = d;
        best = stop.index;
      }
    }
    return best;
  }

  /** The line a point `y` from the text's top falls on. */
  lineAtY(y: number): number {
    const height = this.measured().lineHeight;
    return height > 0 ? Math.floor(y / height) : 0;
  }

  /** The stop after, or before, string index `i`. */
  #step(i: number, forward: boolean): number {
    const stops = this.measured().stops;
    if (forward) {
      return stops.find((stop) => stop.index > i)?.index ?? stops.at(-1)?.index ?? 0;
    }
    let previous = 0;
    for (const stop of stops) {
      if (stop.index >= i) {
        return previous;
      }
      previous = stop.index;
    }
    return previous;
  }

  /** Where the word before, or after, `i` starts or ends. */
  #word(i: number, forward: boolean): number {
    // A password is one word, so moving by word gives nothing of it away.
    const s = this.#masked(this.value);
    const space = (at: number): boolean => SPACE.test(s.charAt(at));
    let j = i;
    if (forward) {
      while (j < s.length && space(j)) {
        j++;
      }
      while (j < s.length && !space(j)) {
        j++;
      }
      return j;
    }
    while (j > 0 && space(j - 1)) {
      j--;
    }
    while (j > 0 && !space(j - 1)) {
      j--;
    }
    return j;
  }

  /** The first, or last, stop on the line `i` is on. */
  #lineEdge(i: number, end: boolean): number {
    const line = this.stopAt(i).line;
    let edge = i;
    let found = false;
    for (const stop of this.measured().stops) {
      if (stop.line !== line) {
        continue;
      }
      if (!end && !found) {
        edge = stop.index;
        found = true;
      }
      if (end) {
        edge = stop.index;
      }
    }
    return edge;
  }

  /** The stop `by` lines down (up when negative) from `i`, keeping to the goal x. */
  #vertical(i: number, by: number): number {
    const here = this.stopAt(i);
    this.#goalX ??= here.x;
    const line = here.line + by;
    const stops = this.measured().stops;
    if (line < 0) {
      return 0;
    }
    if (line > (stops.at(-1)?.line ?? 0)) {
      return this.value.length;
    }
    return this.indexAt(this.#goalX, line);
  }

  // --- what is held ------------------------------------------------------------------------

  /** The selection as string indices, `from` before `to`. */
  selectionRange(): { from: number; to: number } {
    return { from: Math.min(this.caret, this.anchor), to: Math.max(this.caret, this.anchor) };
  }

  /** The selected text. */
  selection(): string {
    const { from, to } = this.selectionRange();
    return this.value.slice(from, to);
  }

  /** `s` as shown: one mask character for each of its, keeping indices, or `s` itself. */
  #masked(s: string): string {
    return this.mask === null ? s : this.mask.repeat(s.length);
  }

  /** The text as shown: the value, with any composition in place of the selection, masked for a password. */
  display(): string {
    if (this.composing === '') {
      return this.#masked(this.value);
    }
    const { from, to } = this.selectionRange();
    return this.#masked(this.value.slice(0, from) + this.composing + this.value.slice(to));
  }

  /** Where the caret is in what is shown: in the composition while there is one. */
  displayCaret(): number {
    if (this.composing === '') {
      return this.caret;
    }
    return (
      this.selectionRange().from +
      (this.composeCursor >= 0 ? this.composeCursor : this.composing.length)
    );
  }

  /** The composition's range in what is shown, or null while there is none. */
  composedRange(): { from: number; to: number } | null {
    if (this.composing === '') {
      return null;
    }
    const { from } = this.selectionRange();
    return { from, to: from + this.composing.length };
  }

  // --- changing it -------------------------------------------------------------------------

  #changed(): void {
    this.onChange?.();
  }

  /** Put the value from outside, as a script does: the caret goes to its end, and nothing is announced. */
  setValue(value: string): void {
    this.value = value;
    this.caret = this.anchor = value.length;
    this.composing = '';
    this.#goalX = null;
    this.#changed();
  }

  /** Select `from` to `to`, the caret at `to`. */
  select(from: number, to: number): void {
    const length = this.value.length;
    this.anchor = Math.min(Math.max(from, 0), length);
    this.caret = Math.min(Math.max(to, 0), length);
    this.#goalX = null;
    this.#changed();
  }

  #move(to: number, select: boolean, keepGoal = false): void {
    if (!keepGoal) {
      this.#goalX = null;
    }
    this.caret = to;
    if (!select) {
      this.anchor = to;
    }
    this.#changed();
  }

  #locked(): boolean {
    return this.#options.disabled?.() === true;
  }

  #frozen(): boolean {
    return this.#locked() || this.#options.readOnly?.() === true;
  }

  /** An input method's composition changed; empty text when it ends, as it commits or cancels. */
  compose(text: string, cursor: number): void {
    if (this.#frozen()) {
      return;
    }
    this.composeCursor = cursor;
    this.composing = text;
    this.#changed();
  }

  /** Replace the selection with `insert`, leaving the caret after it; what would pass `maxLength` is cut. */
  replace(insert: string): void {
    const { from, to } = this.selectionRange();
    let text = insert;
    if (this.maxLength !== null) {
      const room = Math.max(0, this.maxLength - (this.value.length - (to - from)));
      text = text.slice(0, room);
    }
    this.value = this.value.slice(0, from) + text + this.value.slice(to);
    this.composing = '';
    this.caret = this.anchor = from + text.length;
    this.#goalX = null;
    this.#changed();
    this.onInput?.(this.value);
  }

  /** Delete the selection, or from the caret to `to` when nothing is selected. */
  #erase(to: number): void {
    if (this.caret === this.anchor) {
      this.anchor = to;
    }
    if (this.caret !== this.anchor) {
      this.replace('');
    }
  }

  #oneLine(text: string): string {
    return this.multiline ? text.replace(/\r\n|\r/g, '\n') : text.replace(LINE_BREAKS, ' ');
  }

  /** Typed text goes in place of the selection; a line break is a space unless multiline. */
  type(text: string): void {
    if (this.#frozen()) {
      return;
    }
    const typed = this.accept ? this.accept(text) : text;
    if (typed !== '') {
      this.replace(this.#oneLine(typed));
    }
  }

  /** Put `text` where the selection is, as a paste does. */
  paste(text: string): void {
    if (this.#frozen()) {
      return;
    }
    let pasted = this.#oneLine(text);
    if (this.accept) {
      pasted = this.accept(pasted);
    }
    if (pasted !== '' || this.caret !== this.anchor) {
      this.replace(pasted);
    }
  }

  /** Copy the selection, unless there is none or it is a password's. True when it was. */
  copy(): boolean {
    if (this.caret === this.anchor || this.mask !== null) {
      return false;
    }
    this.#options.clipboard().setText(this.selection());
    return true;
  }

  /** Cut the selection, as a copy and then a deletion. True when it was. */
  cut(): boolean {
    if (this.#frozen() || !this.copy()) {
      return false;
    }
    this.replace('');
    return true;
  }

  /** Select all of it. */
  selectAll(): void {
    this.anchor = 0;
    this.#move(this.value.length, true);
  }

  /**
   * Moves, selects, deletes or submits for a key going down. True when the key was one of those,
   * which the caller keeps from doing anything else. Clipboard shortcuts are the `copy`, `cut` and
   * `paste` events' to answer, and Tab is left to move focus.
   */
  key(e: EditKey): boolean {
    // The input method handles keys while it composes.
    if (this.#locked() || this.composing !== '') {
      return false;
    }
    const mac = this.#mac;
    const word = mac ? e.altKey : e.ctrlKey;
    const byLine = mac && e.metaKey;
    const toEnds = mac ? e.metaKey : e.ctrlKey;
    const at = this.caret;
    const selected = this.caret !== this.anchor;
    const length = this.value.length;
    const frozen = this.#frozen();
    switch (e.key) {
      case 'ArrowLeft':
        this.#move(
          byLine
            ? this.#lineEdge(at, false)
            : word
              ? this.#word(at, false)
              : selected && !e.shiftKey
                ? this.selectionRange().from
                : this.#step(at, false),
          e.shiftKey,
        );
        return true;
      case 'ArrowRight':
        this.#move(
          byLine
            ? this.#lineEdge(at, true)
            : word
              ? this.#word(at, true)
              : selected && !e.shiftKey
                ? this.selectionRange().to
                : this.#step(at, true),
          e.shiftKey,
        );
        return true;
      case 'ArrowUp':
        if (this.multiline && !byLine) {
          this.#move(this.#vertical(at, -1), e.shiftKey, true);
        } else {
          this.#move(0, e.shiftKey);
        }
        return true;
      case 'ArrowDown':
        if (this.multiline && !byLine) {
          this.#move(this.#vertical(at, 1), e.shiftKey, true);
        } else {
          this.#move(length, e.shiftKey);
        }
        return true;
      case 'PageUp':
        this.#move(this.multiline ? this.#vertical(at, -this.pageLines()) : 0, e.shiftKey, true);
        return true;
      case 'PageDown':
        this.#move(
          this.multiline ? this.#vertical(at, this.pageLines()) : length,
          e.shiftKey,
          true,
        );
        return true;
      case 'Home':
        this.#move(this.multiline && !toEnds ? this.#lineEdge(at, false) : 0, e.shiftKey);
        return true;
      case 'End':
        this.#move(this.multiline && !toEnds ? this.#lineEdge(at, true) : length, e.shiftKey);
        return true;
      case 'Backspace':
        if (!frozen) {
          this.#erase(
            byLine
              ? this.#lineEdge(at, false)
              : word
                ? this.#word(at, false)
                : this.#step(at, false),
          );
        }
        return true;
      case 'Delete':
        if (!frozen) {
          this.#erase(
            byLine ? this.#lineEdge(at, true) : word ? this.#word(at, true) : this.#step(at, true),
          );
        }
        return true;
      case 'Escape':
        this.onEscape?.();
        return false;
      case 'Enter':
        if (this.multiline) {
          if (!frozen) {
            this.replace('\n');
          }
        } else {
          this.onSubmit?.();
        }
        return true;
      case ' ':
        // Typed as text, so it must not click the view as well.
        return true;
      default:
        if (e.key.length === 1 && (mac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'a') {
          this.selectAll();
          return true;
        }
        return false;
    }
  }

  // --- the pointer -------------------------------------------------------------------------

  /**
   * A press at `(x, y)` from the text's top left: the caret goes there, and Shift extends the
   * selection to it. A double-click selects the word there and a triple-click its paragraph;
   * dragging after either extends the selection by words or paragraphs.
   */
  press(x: number, y: number, shift: boolean, clicks = 1): void {
    if (this.#locked()) {
      return;
    }
    const at = this.indexAt(x, this.lineAtY(y));
    this.#granularity = clicks >= 3 ? 3 : clicks;
    if (this.#granularity === 1 || shift) {
      this.#move(at, shift);
    } else {
      this.#pressRange = this.#unit(at);
      this.anchor = this.#pressRange.from;
      this.#move(this.#pressRange.to, true);
    }
    this.#dragging = true;
  }

  /** The pointer moved to `(x, y)` from the text's top left: a drag selects to it, by the unit the press chose. */
  drag(x: number, y: number): void {
    if (!this.#dragging) {
      return;
    }
    const at = this.indexAt(x, this.lineAtY(y));
    if (this.#granularity === 1) {
      this.#move(at, true);
      return;
    }
    // The selection keeps the unit first pressed and reaches the unit under the pointer.
    const here = this.#unit(at);
    if (here.from < this.#pressRange.from) {
      this.anchor = this.#pressRange.to;
      this.#move(here.from, true);
    } else {
      this.anchor = this.#pressRange.from;
      this.#move(Math.max(here.to, this.#pressRange.to), true);
    }
  }

  /** The word, or paragraph, around string index `i`, as the press's granularity takes it. */
  #unit(i: number): { from: number; to: number } {
    const s = this.#masked(this.value);
    if (this.#granularity >= 3) {
      const from = s.lastIndexOf('\n', i - 1) + 1;
      const to = s.indexOf('\n', i);
      return { from: i > 0 ? from : 0, to: to < 0 ? s.length : to };
    }
    const isWord = (at: number): boolean =>
      at >= 0 &&
      at < s.length &&
      !SPACE.test(s.charAt(at)) &&
      !'\n.,;:!?()[]{}"\''.includes(s.charAt(at));
    let from = i;
    let to = i;
    while (from > 0 && isWord(from - 1)) {
      from--;
    }
    while (to < s.length && isWord(to)) {
      to++;
    }
    // Between words, the run of spaces or punctuation there.
    if (from === to && to < s.length) {
      to++;
    }
    return { from, to };
  }

  /** The press ended: dragging selects no further. */
  release(): void {
    this.#dragging = false;
  }

  /** The view lost focus: any composition is dropped and the selection collapses to the caret. */
  blur(): void {
    this.#dragging = false;
    this.composing = '';
    this.anchor = this.caret;
    this.#changed();
  }
}
