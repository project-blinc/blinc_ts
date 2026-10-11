/**
 * What a `table` does: every row is a grid of the same columns, so cells line up down the
 * table: as many as its widest row has, or its `col`s say. A column a `col` gives a width has it;
 * any other is sized by its cells, as a browser's automatic table layout does: never narrower
 * than the widest thing in it that cannot break, and sharing the rest of the width in proportion
 * to what its cells would take on one line. A cell's `colspan` spans columns. Rows and cells that
 * come or go later are laid out the same. `rowspan` is not supported.
 */
import type { Host, HostElement, HostNode } from './host.js';
import { HostElement as ElementClass } from './host.js';

/** The elements a change to which can move a table's columns. */
const PARTS: ReadonlySet<string> = new Set([
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'col',
  'colgroup',
]);
const SECTIONS: ReadonlySet<string> = new Set(['thead', 'tbody', 'tfoot']);

/** A positive whole number from an attribute, else 1. */
function span(element: HostElement, name: string): number {
  const n = Number.parseInt(element.getAttribute(name) ?? '', 10);
  return n > 0 ? n : 1;
}

/** A column's track: its width, or an equal share that may shrink below its content. */
function track(width: string | null): string {
  const w = width?.trim() ?? '';
  if (w === '') {
    return 'minmax(0, 1fr)';
  }
  if (w.endsWith('*')) {
    const share = Number.parseFloat(w.slice(0, -1) || '1');
    return `minmax(0, ${share > 0 ? share : 1}fr)`;
  }
  if (w.endsWith('%')) {
    return Number.parseFloat(w) >= 0 ? w : 'minmax(0, 1fr)';
  }
  const px = Number.parseFloat(w);
  return px >= 0 ? `${px}px` : 'minmax(0, 1fr)';
}

/**
 * A column sized by its cells: at least `min`. Beside columns given shares of what is left, it
 * takes up to `max` and leaves the rest to them; otherwise it takes a share by `max`.
 */
function sized(min: number, max: number, shares: boolean): string {
  const least = Math.ceil(min);
  return shares
    ? `minmax(${least}px, ${Math.max(least, Math.ceil(max))}px)`
    : `minmax(${least}px, ${Math.max(max, 1)}fr)`;
}

export class Tables {
  readonly host: Host;
  /** Tables whose columns may be wrong now. */
  readonly #dirty = new Set<HostElement>();
  /** Each table's columns: the `col`s' tracks, undefined for one its cells size. */
  readonly #given = new Map<HostElement, (string | undefined)[]>();
  /** The template each table's rows were given. */
  readonly #templates = new Map<HostElement, string>();
  #measuring: (() => void) | undefined;

  constructor(host: Host) {
    this.host = host;
  }

  /** `node`, or something under it, is a part of a table that changed. */
  changed(node: HostNode | null): void {
    if (!(node instanceof ElementClass) || !PARTS.has(node.tag)) {
      return;
    }
    for (let n: HostElement | null = node; n; n = n.composedParent) {
      if (n.tag === 'table') {
        this.#dirty.add(n);
        this.host.wake();
        return;
      }
    }
  }

  /** An attribute that sets a column or a span changed. */
  attributeChanged(element: HostElement, name: string): void {
    if (
      (name === 'colspan' && (element.tag === 'td' || element.tag === 'th')) ||
      ((name === 'span' || name === 'width') &&
        (element.tag === 'col' || element.tag === 'colgroup'))
    ) {
      this.changed(element);
    }
  }

  forget(node: HostNode): void {
    if (node instanceof ElementClass) {
      this.#dirty.delete(node);
      this.#given.delete(node);
      this.#templates.delete(node);
    }
  }

  /** Before the tick's writes: lay out the columns of each table that changed. */
  flush(): void {
    if (this.#dirty.size === 0) {
      return;
    }
    const tables = [...this.#dirty];
    this.#dirty.clear();
    for (const table of tables) {
      if (!table.destroyed) {
        this.#layOut(table);
      }
    }
  }

  #children(parent: HostElement, tags: ReadonlySet<string>): HostElement[] {
    const found: HostElement[] = [];
    for (let c = parent.firstChild; c; c = c.nextSibling) {
      if (c instanceof ElementClass && tags.has(c.tag)) {
        found.push(c);
      }
    }
    return found;
  }

  /** The rows of a table, its own and its sections'. */
  rows(table: HostElement): HostElement[] {
    const rows: HostElement[] = [];
    for (const child of this.#children(table, new Set(['tr', ...SECTIONS]))) {
      if (child.tag === 'tr') {
        rows.push(child);
      } else {
        rows.push(...this.#children(child, new Set(['tr'])));
      }
    }
    return rows;
  }

  /** The columns the table's `col`s and `colgroup`s stand for: a track each, or none to size. */
  #columns(table: HostElement): (string | undefined)[] {
    const tracks: (string | undefined)[] = [];
    const add = (col: HostElement): void => {
      const width = col.getAttribute('width');
      for (let i = 0; i < span(col, 'span'); i++) {
        tracks.push(width?.trim() ? track(width) : undefined);
      }
    };
    for (const child of this.#children(table, new Set(['col', 'colgroup']))) {
      if (child.tag === 'col') {
        add(child);
        continue;
      }
      const held = this.#children(child, new Set(['col']));
      if (held.length > 0) {
        held.forEach(add);
      } else {
        // A group with no col stands for as many sized columns as its span.
        for (let i = 0; i < span(child, 'span'); i++) {
          tracks.push(undefined);
        }
      }
    }
    return tracks;
  }

  #layOut(table: HostElement): void {
    const rows = this.rows(table);
    const cells = new Map<HostElement, HostElement[]>(
      rows.map((row) => [row, this.#children(row, new Set(['td', 'th']))]),
    );
    const tracks = this.#columns(table);
    let count = tracks.length;
    for (const list of cells.values()) {
      count = Math.max(
        count,
        list.reduce((n, cell) => n + span(cell, 'colspan'), 0),
      );
    }
    while (tracks.length < count) {
      tracks.push(undefined);
    }
    this.#given.set(table, tracks);
    // Until its cells have been measured, a sized column is an equal share.
    this.#apply(
      table,
      rows,
      tracks.map((t) => t ?? track(null)),
    );
    for (const row of rows) {
      for (const cell of cells.get(row) ?? []) {
        const n = span(cell, 'colspan');
        cell.setProperty('grid-column', n > 1 ? `span ${n}` : null);
      }
    }
    if (tracks.some((t) => t === undefined) && !this.#measuring) {
      this.#measuring = this.host.inlineFlows?.onSettled(() => this.#measure());
    }
  }

  #apply(table: HostElement, rows: readonly HostElement[], tracks: readonly string[]): boolean {
    const template = tracks.length === 0 ? 'none' : tracks.join(' ');
    if (this.#templates.get(table) === template) {
      return false;
    }
    this.#templates.set(table, template);
    for (const row of rows) {
      row.setProperty('grid-template-columns', template);
    }
    return true;
  }

  /**
   * Once the cells' flows have measured what they hold, size each column that no `col` sizes by
   * its cells: no narrower than its widest unbreakable content, and a share of the rest by the
   * widest one-line width. A cell that spans columns sizes none of them.
   */
  #measure(): boolean {
    const flows = this.host.inlineFlows;
    if (!flows) {
      return false;
    }
    let wrote = false;
    for (const [table, given] of this.#given) {
      // One out of the tree has no layout to read, and is measured when it is put back.
      if (table.destroyed || !table.isConnected || !given.some((t) => t === undefined)) {
        continue;
      }
      const rows = this.rows(table);
      const min = given.map(() => 0);
      const max = given.map(() => 0);
      for (const row of rows) {
        let column = 0;
        for (const cell of this.#children(row, new Set(['td', 'th']))) {
          const n = span(cell, 'colspan');
          const widths = n === 1 ? flows.widths(cell) : undefined;
          if (widths && column < given.length) {
            min[column] = Math.max(min[column]!, widths.min);
            max[column] = Math.max(max[column]!, widths.max);
          }
          column += n;
        }
      }
      const shares = given.some((t) => t?.includes('fr') ?? false);
      const tracks = given.map((t, i) => t ?? sized(min[i]!, max[i]!, shares));
      wrote = this.#apply(table, rows, tracks) || wrote;
    }
    return wrote;
  }
}
