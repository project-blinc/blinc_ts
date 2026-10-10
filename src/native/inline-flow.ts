/**
 * HTML's inline formatting: a paragraph's text and the inline elements in it
 * laid out as one flow, wrapped together at the paragraph's width, each
 * line's pieces on one baseline whatever their font. Whitespace collapses as
 * HTML's does.
 *
 * The elements in a flow keep their place in the tree, so CSS styles them and
 * they take input as before; only how they are laid out changes:
 *
 * - each text is measured in its own font and hidden, and what each line
 *   shows of it is a piece, a text that does not wrap, placed under the same
 *   element so the cascade styles it as the text is;
 * - an inline element that paints nothing of its own (`a`, `strong`, `em`) is
 *   a frame its pieces are placed in, so a click on any of its text is a
 *   click on it;
 * - an inline element that paints a box (`code`'s background), and anything
 *   not inline (an `img`, an `input`), is kept whole and placed as a box by
 *   its laid-out size, on its first text's baseline.
 *
 * A flow's size comes from a spacer laid out in its place: as wide as its
 * longest line can be, no narrower than its longest word, and as tall as its
 * lines at the width it is given. After each layout pass the flow lays its
 * lines out again at that width and asks for another pass when anything
 * moved. Only an element that holds an inline element or a `br` is a flow;
 * one that holds only text is a plain wrapping text, as before.
 */
import type { Host, HostElement, HostNode, HostText } from './host.js';
import { HostElement as ElementClass, HostText as TextClass } from './host.js';
import type { NativeBindings } from './index.js';
import type { LayoutNode } from './layout.js';
import type { InlineAlign, InlineItem, InlineLayout } from './text.js';

/** The elements that hold a flow, when they hold an inline element. */
const FLOW_TAGS: ReadonlySet<string> = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'dt',
  'dd',
  'figcaption',
  'caption',
  'legend',
  'li',
  'th',
  'td',
]);

/** HTML's inline elements. */
export const INLINE_TAGS: ReadonlySet<string> = new Set([
  'span',
  'strong',
  'b',
  'em',
  'i',
  'small',
  'code',
  'kbd',
  'mark',
  's',
  'u',
  'a',
  'output',
  'sub',
  'sup',
  'abbr',
  'cite',
  'q',
  'time',
  'var',
  'samp',
  'del',
  'ins',
  'label',
]);

/** Inline elements that paint a box of their own, kept whole. */
const BOX_TAGS: ReadonlySet<string> = new Set(['code', 'kbd', 'mark']);

/** Where a line of a flow's text starts: wide enough that nothing wraps. */
const UNBOUNDED = 1_000_000;

/** A text of the flow, and the pieces that show it a line at a time. */
interface Member {
  readonly text: HostText;
  /** The element the pieces go under: the flow's root or an inline element in it. */
  readonly owner: HostElement;
  readonly pieces: HostText[];
}

type Entry =
  | { kind: 'text'; member: Member }
  | { kind: 'box'; element: HostElement; block: boolean }
  | { kind: 'break' };

const frame = [
  ['position', 'absolute'],
  ['left', 0],
  ['top', 0],
  ['width', 0],
  ['height', 0],
] as const;

class Flow {
  readonly root: HostElement;
  readonly #flows: InlineFlows;
  readonly #anchor: LayoutNode;
  readonly #spacer: LayoutNode;
  #entries: Entry[] = [];
  #members: Member[] = [];
  /** Inline elements made frames, and elements kept whole, to be given back. */
  readonly #frames = new Set<HostElement>();
  readonly #boxes = new Set<HostElement>();
  /** Texts and breaks hidden, whose pieces show instead. */
  readonly #hidden = new Set<HostNode>();
  dirty = true;
  #key = '';
  #natural = { max: 0, min: 0 };
  #applied = { width: -1, min: -1, height: -1 };
  #laidFor = '';
  #laid: InlineLayout | undefined;
  #placed = '';

  constructor(flows: InlineFlows, root: HostElement) {
    this.#flows = flows;
    this.root = root;
    const { host } = flows;
    // The origin absolute positions are measured from, and what sizes the flow's place.
    const [type] = host.layout.intern(['flow']);
    const register = (node: LayoutNode) =>
      node.queueElement({
        types: [type!],
        id: -1,
        classes: [],
        attributes: [],
        inline: [],
        anonymous: true,
      });
    this.#anchor = host.layout.createNode({
      position: 'absolute',
      inset: [0, 'auto', 'auto', 0],
      width: 0,
      height: 0,
    });
    this.#spacer = host.layout.createNode({ grow: 1, shrink: 1, width: 0, height: 0 });
    register(this.#anchor);
    register(this.#spacer);
    // First, so they are under everything for the hit test.
    const first = root.firstChild?.layoutNode ?? null;
    root.layoutNode.queueInsertBefore(this.#anchor, first);
    root.layoutNode.queueInsertBefore(this.#spacer, first);
  }

  /** A node is being destroyed: what the flow made for it goes now, before its place in the tree does. */
  forgetNode(node: HostNode): void {
    const under = (member: Member) => {
      if (member.text === node || member.owner === node) {
        return true;
      }
      for (let n: HostNode | null = member.owner; n; n = n.parentNode) {
        if (n === node) {
          return true;
        }
      }
      return false;
    };
    const gone = this.#members.filter(under);
    for (const member of gone) {
      this.#release(member);
    }
    this.#members = this.#members.filter((member) => !gone.includes(member));
    this.#frames.delete(node as HostElement);
    this.#boxes.delete(node as HostElement);
    this.#hidden.delete(node);
    this.dirty = true;
  }

  /** The flow's content, in order, read from the tree. Returns whether it changed a style. */
  collect(): boolean {
    let styled = false;
    const style = (node: HostElement, props: readonly (readonly [string, string | number])[]) => {
      for (const [name, value] of props) {
        node.layoutNode.setLayoutProperty(name, value);
      }
      styled = true;
    };
    const entries: Entry[] = [];
    const members: Member[] = [];
    const frames = new Set<HostElement>();
    const boxes = new Set<HostElement>();
    const kept = new Map(this.#members.map((m) => [m.text, m]));
    const walk = (owner: HostElement) => {
      for (let child = owner.firstChild; child; child = child.nextSibling) {
        if (child instanceof TextClass) {
          let member = kept.get(child);
          if (member && member.owner !== owner) {
            // Moved to another element: its pieces are under the old one.
            this.#drop(member);
            member = undefined;
            styled = true;
          }
          member ??= { text: child, owner, pieces: [] };
          if (!this.#hidden.has(child)) {
            this.#hidden.add(child);
            child.layoutNode.setLayoutProperty('display', 'none');
            this.#flows.own(child);
            styled = true;
          }
          members.push(member);
          entries.push({ kind: 'text', member });
        } else if (child instanceof ElementClass) {
          if (child.tag === 'br') {
            if (!this.#hidden.has(child)) {
              this.#hidden.add(child);
              child.layoutNode.setLayoutProperty('display', 'none');
              styled = true;
            }
            entries.push({ kind: 'break' });
          } else if (INLINE_TAGS.has(child.tag) && !BOX_TAGS.has(child.tag)) {
            frames.add(child);
            if (!this.#frames.has(child)) {
              style(child, frame);
            }
            walk(child);
          } else {
            boxes.add(child);
            if (!this.#boxes.has(child)) {
              style(child, [
                ['position', 'absolute'],
                ['left', 0],
                ['top', 0],
              ]);
            }
            entries.push({ kind: 'box', element: child, block: !INLINE_TAGS.has(child.tag) });
          }
        }
      }
    };
    walk(this.root);
    // What left the flow goes back to being laid out as it was.
    for (const element of this.#frames) {
      if (!frames.has(element) && !element.destroyed) {
        for (const [name] of frame) {
          element.layoutNode.setLayoutProperty(name, null);
        }
        styled = true;
      }
    }
    for (const element of this.#boxes) {
      if (!boxes.has(element) && !element.destroyed) {
        element.layoutNode.setVisual(null);
        for (const name of ['position', 'left', 'top']) {
          element.layoutNode.setLayoutProperty(name, null);
        }
        styled = true;
      }
    }
    for (const member of this.#members) {
      if (!members.includes(member)) {
        this.#release(member);
        styled = true;
      }
    }
    this.#frames.clear();
    for (const element of frames) {
      this.#frames.add(element);
    }
    this.#boxes.clear();
    for (const element of boxes) {
      this.#boxes.add(element);
    }
    this.#entries = entries;
    this.#members = members;
    return styled;
  }

  /** The pieces of a text, gone. */
  #drop(member: Member): void {
    for (const piece of member.pieces) {
      this.#flows.disown(piece);
      piece.destroy();
    }
    member.pieces.length = 0;
  }

  /** A text that has left the flow shows itself again, its pieces gone. */
  #release(member: Member): void {
    this.#drop(member);
    if (!member.text.destroyed) {
      this.#hidden.delete(member.text);
      this.#flows.disown(member.text);
      member.text.layoutNode.setLayoutProperty('display', member.text.data === '' ? 'none' : null);
    }
  }

  /** The flow's items for the engine, with the sizes of the boxes in it as laid out now. */
  #items(): InlineItem[] {
    const { host, native } = this.#flows;
    return this.#entries.map((entry): InlineItem => {
      switch (entry.kind) {
        case 'text':
          return {
            kind: 'text',
            text: entry.member.text.data,
            style: host.textStyleOf(entry.member.text),
          };
        case 'break':
          return { kind: 'break' };
        case 'box': {
          const [, , width = 0, height = 0] = entry.element.bounds();
          const baseline = firstBaseline(host, native, entry.element);
          return {
            kind: 'box',
            width,
            height,
            ...(baseline === undefined ? {} : { baseline }),
            ...(entry.block ? { block: true } : {}),
          };
        }
      }
    });
  }

  #align(): InlineAlign {
    for (let node: HostNode | null = this.root; node; node = node.parentNode) {
      const value =
        node instanceof ElementClass
          ? this.#flows.host.declaredOf(node).get('text-align')
          : undefined;
      if (value) {
        const align = value.trim();
        if (align === 'center' || align === 'right' || align === 'justify') {
          return align;
        }
        if (align === 'left' || align === 'start') {
          return 'left';
        }
        if (align === 'end') {
          return 'right';
        }
      }
    }
    return 'left';
  }

  /**
   * Read what layout has made and work out what the flow should write: none
   * when it is as it should be. Reads only; every flow is read before any is
   * written, since a write makes the bounds unreadable until layout runs again.
   */
  plan(): (() => void) | null {
    const { native } = this.#flows;
    const items = this.#items();
    const align = this.#align();
    const key = JSON.stringify([items, align]);
    let natural = this.#natural;
    if (key !== this.#key) {
      const n = native.layoutInline(items, UNBOUNDED, { align: 'left' });
      natural = { max: n.maxContent, min: n.minContent };
    }
    const width = round(natural.max);
    const min = round(natural.min);
    // Its width first: lines are laid out at the width layout gives it, once it has been given.
    if (width !== this.#applied.width || min !== this.#applied.min) {
      return () => {
        this.#key = key;
        this.#natural = natural;
        this.#applied.width = width;
        this.#applied.min = min;
        this.#spacer.setStyle({ width, minWidth: min, maxWidth: '100%' });
      };
    }
    const out = new Float32Array(8);
    this.#flows.host.layout.readBounds([this.#anchor, this.#spacer], out);
    const origin = [out[0]!, out[1]!];
    const at = [out[4]!, out[5]!];
    const laidWidth = out[6]!;
    const laidKey = `${key}@${laidWidth}`;
    let laid = this.#laid;
    if (laidKey !== this.#laidFor) {
      laid = native.layoutInline(items, laidWidth, { align });
    }
    const height = round(laid?.height ?? 0);
    const left = at[0]! - origin[0]!;
    const top = at[1]! - origin[1]!;
    const placed = `${laidKey}|${left}|${top}`;
    const tall = laidKey !== this.#laidFor && height !== this.#applied.height;
    const blocks = laidKey !== this.#laidFor;
    const place = placed !== this.#placed;
    if (!tall && !blocks && !place && key === this.#key) {
      return null;
    }
    const finished = laid;
    return () => {
      this.#key = key;
      this.#natural = natural;
      this.#laid = finished;
      if (tall) {
        this.#applied.height = height;
        this.#spacer.setStyle({ height });
      }
      if (blocks) {
        // A block as wide as the flow.
        for (const entry of this.#entries) {
          if (entry.kind === 'box' && entry.block) {
            entry.element.layoutNode.setLayoutProperty('width', round(laidWidth));
          }
        }
      }
      this.#laidFor = laidKey;
      if (place && finished) {
        this.#placed = placed;
        this.#place(finished, left, top);
      }
    };
  }

  /** Put each line's part of each text, and each box, where the lines say. */
  #place(laid: InlineLayout, left: number, top: number): void {
    const { host } = this.#flows;
    const used = new Map<Member, number>();
    for (const fragment of laid.fragments) {
      const entry = this.#entries[fragment.item];
      if (entry?.kind === 'box') {
        // Layout rounds positions to whole pixels; the exact offset goes in the visual offset, which it does not.
        entry.element.layoutNode.setVisual([fragment.x + left, fragment.y + top, -1, 0]);
        continue;
      }
      if (entry?.kind !== 'text') {
        continue;
      }
      const member = entry.member;
      const at = used.get(member) ?? 0;
      used.set(member, at + 1);
      let piece = member.pieces[at];
      if (!piece) {
        piece = host.createTextNode(fragment.text);
        this.#flows.own(piece);
        for (const [name, value] of [
          ['position', 'absolute'],
          ['left', 0],
          ['top', 0],
        ] as const) {
          piece.layoutNode.setLayoutProperty(name, value);
        }
        member.owner.layoutNode.queueInsertBefore(piece.layoutNode, null);
        member.pieces.push(piece);
      } else {
        piece.data = fragment.text;
        piece.layoutNode.setLayoutProperty('display', null);
      }
      piece.layoutNode.setVisual([fragment.x + left, fragment.y + top, -1, 0]);
    }
    for (const member of this.#members) {
      for (let i = used.get(member) ?? 0; i < member.pieces.length; i++) {
        member.pieces[i]!.layoutNode.setLayoutProperty('display', 'none');
      }
    }
  }

  /** The flow ends: its elements are laid out as any others, and its pieces go. */
  dissolve(): void {
    for (const member of this.#members) {
      this.#release(member);
    }
    for (const element of this.#frames) {
      if (!element.destroyed) {
        for (const [name] of frame) {
          element.layoutNode.setLayoutProperty(name, null);
        }
      }
    }
    for (const element of this.#boxes) {
      if (!element.destroyed) {
        element.layoutNode.setVisual(null);
        for (const name of ['position', 'left', 'top', 'width']) {
          element.layoutNode.setLayoutProperty(name, null);
        }
      }
    }
    for (const node of this.#hidden) {
      if (node instanceof ElementClass && !node.destroyed) {
        node.layoutNode.setLayoutProperty('display', null);
      }
    }
    this.#hidden.clear();
    this.#spacer.remove();
    this.#anchor.remove();
  }
}

const round = (value: number) => Math.round(value * 100) / 100;

/** From the top of `element` to the baseline of its first text, if it holds one. */
function firstBaseline(
  host: Host,
  native: NativeBindings,
  element: HostElement,
): number | undefined {
  const find = (parent: HostElement): HostText | undefined => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child instanceof TextClass && child.data.trim() !== '') {
        return child;
      }
      if (child instanceof ElementClass) {
        const found = find(child);
        if (found) {
          return found;
        }
      }
    }
    return undefined;
  };
  const text = find(element);
  if (!text) {
    return undefined;
  }
  const line = native.layoutInline(
    [{ kind: 'text', text: 'x', style: host.textStyleOf(text) }],
    UNBOUNDED,
    {},
  ).lines[0];
  return line ? text.bounds()[1] - element.bounds()[1] + line.baseline : undefined;
}

/** The flows of one host. */
export class InlineFlows {
  readonly host: Host;
  readonly native: NativeBindings;
  readonly #flows = new Map<HostElement, Flow>();
  /** Texts a flow hides, and the pieces it shows: the host leaves their display and wrapping to it. */
  readonly #owned = new WeakSet<HostText>();
  readonly #pending = new Set<HostElement>();
  #release: (() => void) | undefined;

  constructor(host: Host, native: NativeBindings) {
    this.host = host;
    this.native = native;
  }

  /** Whether a flow has the text: hidden by it, or shown by it. */
  owns(node: HostText): boolean {
    return this.#owned.has(node);
  }
  /** @internal */
  own(node: HostText): void {
    this.#owned.add(node);
  }
  /** @internal */
  disown(node: HostText): void {
    this.#owned.delete(node);
  }

  /** Whether there is anything to lay out: some flow, or some element that may become one. */
  get active(): boolean {
    return this.#pending.size > 0 || [...this.#flows.keys()].some((root) => this.#attached(root));
  }

  /**
   * Something changed at or under `node`: a child, a text, a style. Each
   * flow around it lays itself out again, and an element that now holds an
   * inline element becomes one.
   */
  touch(node: HostNode | null): void {
    for (let n: HostNode | null = node; n; n = n.parentNode) {
      if (n instanceof ElementClass && FLOW_TAGS.has(n.tag)) {
        this.#pending.add(n);
      }
    }
    if (this.#pending.size > 0 && !this.#release) {
      this.#release = this.host.layout.onLaidOut(() => this.#layOut());
    }
  }

  /** A style changed at `node`, which a flow around it may lay out by; nothing to do where there are none. */
  restyled(node: HostNode | null): void {
    if (this.#flows.size > 0) {
      this.touch(node);
    }
  }

  /** A node is destroyed: its flow forgets it. */
  forget(node: HostNode): void {
    if (node instanceof ElementClass) {
      const flow = this.#flows.get(node);
      if (flow) {
        flow.dissolve();
        this.#flows.delete(node);
      }
    }
    this.#pending.delete(node as HostElement);
    for (const flow of this.#flows.values()) {
      flow.forgetNode(node);
    }
    this.touch(node.parentNode);
  }

  #attached(element: HostElement): boolean {
    for (let n: HostNode | null = element; n; n = n.parentNode) {
      if (n === this.host.root) {
        return true;
      }
    }
    return false;
  }

  #qualifies(root: HostElement): boolean {
    if (root.destroyed) {
      return false;
    }
    for (let child = root.firstChild; child; child = child.nextSibling) {
      if (child instanceof ElementClass && (INLINE_TAGS.has(child.tag) || child.tag === 'br')) {
        return true;
      }
    }
    return false;
  }

  #layOut(): boolean {
    let wrote = false;
    for (const root of this.#pending) {
      const flow = this.#flows.get(root);
      if (this.#qualifies(root)) {
        if (flow) {
          flow.dirty = true;
        } else {
          this.#flows.set(root, new Flow(this, root));
          wrote = true;
        }
      } else if (flow) {
        flow.dissolve();
        this.#flows.delete(root);
        wrote = true;
      }
    }
    this.#pending.clear();
    for (const flow of this.#flows.values()) {
      if (flow.dirty && this.#attached(flow.root)) {
        flow.dirty = false;
        wrote = flow.collect() || wrote;
      }
    }
    // What was written is laid out before anything is read.
    if (wrote) {
      return true;
    }
    const writes: (() => void)[] = [];
    for (const flow of this.#flows.values()) {
      // One out of the tree has no layout to read, and waits to be put back.
      const write = this.#attached(flow.root) ? flow.plan() : null;
      if (write) {
        writes.push(write);
      }
    }
    for (const write of writes) {
      write();
    }
    return writes.length > 0;
  }
}
