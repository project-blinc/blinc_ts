/**
 * @internal The per-tick command buffer: queued tree edits, property
 * writes, text and paint, coalesced and encoded into one native call.
 * Words name each command and its nodes (a raw node id as two u32 words);
 * numbers carry its values; text and brushes go in side arrays.
 */
import type { NativeBrush } from './brush.js';
import type { PropertyWrite } from './properties.js';
import type { AffineTransform, Color, CornerRadii, TextStyle } from './scene.js';

const PROPERTY = 1;
const INSERT = 2;
const DETACH = 3;
const REMOVE = 4;
const TEXT = 5;
const PAINT = 6;
const SCROLL = 7;

/** A queued paint patch: the fields the buffer carries. */
export interface QueuedPaint {
  clear?: boolean;
  brush?: NativeBrush;
  solid?: Color;
  textColor?: Color;
  radius?: CornerRadii;
  borderColor?: Color;
  borderWidth?: number;
  opacity?: number;
  visible?: boolean;
  transform?: AffineTransform;
}

/** A node as the queue names it: its raw id split into two words. */
export interface QueuedNode {
  readonly lo: number;
  readonly hi: number;
}

type Command =
  | { op: typeof PROPERTY; node: QueuedNode; write: PropertyWrite }
  | { op: typeof INSERT; node: QueuedNode; child: QueuedNode; before: QueuedNode | null }
  | { op: typeof DETACH | typeof REMOVE; node: QueuedNode }
  | { op: typeof TEXT; node: QueuedNode; content: string; style: TextStyle }
  | { op: typeof PAINT; node: QueuedNode; paint: QueuedPaint }
  | { op: typeof SCROLL; node: QueuedNode; x: number; y: number };

export interface Encoded {
  words: Uint32Array;
  numbers: Float64Array;
  strings: string[];
  brushes: NativeBrush[];
  /** Whether any command changes geometry, rather than only paint. */
  layout: boolean;
}

export class CommandQueue {
  #commands: (Command | undefined)[] = [];
  /** Latest property write per node and property id, by command index. */
  readonly #properties = new Map<QueuedNode, Map<number, number>>();
  /** The pending text, paint and scroll command per node, which later writes update in place. */
  readonly #text = new Map<QueuedNode, number>();
  readonly #paint = new Map<QueuedNode, number>();
  readonly #scroll = new Map<QueuedNode, number>();

  get empty(): boolean {
    return this.#commands.length === 0;
  }
  get size(): number {
    return this.#commands.length;
  }

  property(node: QueuedNode, write: PropertyWrite): void {
    let byId = this.#properties.get(node);
    if (!byId) {
      byId = new Map();
      this.#properties.set(node, byId);
    }
    // Pixel and percentage ids share a field, so a replaced write moves to the end.
    const previous = byId.get(write[0]);
    if (previous !== undefined) {
      this.#commands[previous] = undefined;
    }
    byId.set(write[0], this.#commands.push({ op: PROPERTY, node, write }) - 1);
  }
  insert(parent: QueuedNode, child: QueuedNode, before: QueuedNode | null): void {
    this.#commands.push({ op: INSERT, node: parent, child, before });
  }
  detach(node: QueuedNode): void {
    this.#commands.push({ op: DETACH, node });
  }
  remove(node: QueuedNode): void {
    this.#commands.push({ op: REMOVE, node });
  }
  text(node: QueuedNode, content: string, style: TextStyle): void {
    const index = this.#text.get(node);
    const command = index === undefined ? undefined : this.#commands[index];
    if (command?.op === TEXT) {
      command.content = content;
      command.style = style;
      return;
    }
    this.#text.set(node, this.#commands.push({ op: TEXT, node, content, style }) - 1);
  }
  paint(node: QueuedNode, paint: QueuedPaint): void {
    const index = this.#paint.get(node);
    const command = index === undefined ? undefined : this.#commands[index];
    if (command?.op === PAINT && !paint.clear) {
      const merged = command.paint;
      if (paint.brush || paint.solid) {
        delete merged.brush;
        delete merged.solid;
      }
      Object.assign(merged, paint);
      return;
    }
    this.#paint.set(node, this.#commands.push({ op: PAINT, node, paint: { ...paint } }) - 1);
  }
  scroll(node: QueuedNode, x: number, y: number): void {
    const index = this.#scroll.get(node);
    const command = index === undefined ? undefined : this.#commands[index];
    if (command?.op === SCROLL) {
      command.x = x;
      command.y = y;
      return;
    }
    this.#scroll.set(node, this.#commands.push({ op: SCROLL, node, x, y }) - 1);
  }
  clear(): void {
    this.#commands = [];
    this.#properties.clear();
    this.#text.clear();
    this.#paint.clear();
    this.#scroll.clear();
  }

  /** Encode and empty the queue. Commands for a node removed earlier in the batch are dropped. */
  take(): Encoded {
    const commands = this.#commands;
    this.clear();
    const words: number[] = [];
    const numbers: number[] = [];
    const strings: string[] = [];
    const brushes: NativeBrush[] = [];
    const removed = new Set<QueuedNode>();
    let layout = false;
    const node = (n: QueuedNode) => words.push(n.lo, n.hi);
    const values = (v: readonly number[] | undefined) => v && numbers.push(...v);
    for (const command of commands) {
      if (!command || removed.has(command.node)) {
        continue;
      }
      switch (command.op) {
        case PROPERTY: {
          const [id, kind, value] = command.write;
          words.push(PROPERTY);
          node(command.node);
          words.push(id, kind);
          numbers.push(typeof value === 'string' ? strings.push(value) - 1 : value);
          layout = true;
          break;
        }
        case INSERT:
          words.push(INSERT);
          node(command.node);
          node(command.child);
          words.push(command.before ? 1 : 0);
          node(command.before ?? { lo: 0, hi: 0 });
          layout = true;
          break;
        case DETACH:
        case REMOVE:
          words.push(command.op);
          node(command.node);
          if (command.op === REMOVE) {
            removed.add(command.node);
          }
          layout = true;
          break;
        case TEXT: {
          const s = command.style;
          let mask = 0;
          const add = (bit: number, value: number | undefined) => {
            if (value !== undefined) {
              mask |= bit;
              numbers.push(value);
            }
          };
          words.push(TEXT);
          node(command.node);
          words.push(strings.push(command.content) - 1);
          add(1, s.fontSize);
          add(2, s.lineHeight);
          add(4, s.letterSpacing);
          add(8, s.fontWeight);
          if (s.wrap !== undefined) {
            mask |= 16 | (s.wrap ? 32 : 0);
          }
          if (s.italic !== undefined) {
            mask |= 64 | (s.italic ? 128 : 0);
          }
          let family = 0;
          if (s.fontFamily !== undefined) {
            mask |= 256;
            family = strings.push(s.fontFamily) - 1;
          }
          words.push(mask, family);
          layout = true;
          break;
        }
        case PAINT: {
          const p = command.paint;
          let mask = p.clear ? 2048 : 0;
          let brush = 0;
          if (p.brush) {
            mask |= 1;
            brush = brushes.push(p.brush) - 1;
          }
          const field = (bit: number, value: readonly number[] | number | undefined) => {
            if (value !== undefined) {
              mask |= bit;
              values(typeof value === 'number' ? [value] : value);
            }
          };
          field(2, p.solid);
          field(4, p.textColor);
          field(8, p.radius);
          field(16, p.borderColor);
          field(32, p.borderWidth);
          field(64, p.opacity);
          if (p.visible !== undefined) {
            mask |= 128 | (p.visible ? 256 : 0);
          }
          field(512, p.transform);
          words.push(PAINT);
          node(command.node);
          words.push(mask, brush);
          break;
        }
        case SCROLL:
          words.push(SCROLL);
          node(command.node);
          numbers.push(command.x, command.y);
          break;
      }
    }
    return {
      words: Uint32Array.from(words),
      numbers: Float64Array.from(numbers),
      strings,
      brushes,
      layout,
    };
  }
}
