/**
 * What a `table` does: every row is a grid of the same columns, so cells line up down the
 * table: as many as its widest row has, or its `col`s say, each an equal share of the width
 * unless a `col` gives it one. A cell's `colspan` spans columns. Rows and cells that come or go
 * later are laid out the same. `rowspan` is not supported.
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

export class Tables {
  readonly host: Host;
  /** Tables whose columns may be wrong now. */
  readonly #dirty = new Set<HostElement>();

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

  /** The columns the table's `col`s and `colgroup`s stand for, a track each. */
  #columns(table: HostElement): string[] {
    const tracks: string[] = [];
    const add = (col: HostElement): void => {
      for (let i = 0; i < span(col, 'span'); i++) {
        tracks.push(track(col.getAttribute('width')));
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
        // A group with no col stands for as many default columns as its span.
        for (let i = 0; i < span(child, 'span'); i++) {
          tracks.push(track(null));
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
      tracks.push(track(null));
    }
    const template = tracks.length === 0 ? 'none' : tracks.join(' ');
    for (const row of rows) {
      row.setProperty('grid-template-columns', template);
      for (const cell of cells.get(row) ?? []) {
        const n = span(cell, 'colspan');
        cell.setProperty('grid-column', n > 1 ? `span ${n}` : null);
      }
    }
  }
}
