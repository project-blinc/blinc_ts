/**
 * What a `table` does: every row is a grid of the same columns, so cells line up down the
 * table: as many as its widest row has, or its `col`s say. A column a `col` gives a width has it;
 * any other is sized by its cells, as a browser's automatic table layout does: never narrower
 * than the widest thing in it that cannot break, and sharing the rest of the width in proportion
 * to what its cells would take on one line. A cell's `colspan` spans columns. Rows and cells that
 * come or go later are laid out the same. Spanning rows share a native grid while their
 * authored row/cell ancestry stays intact for styles, events and row backgrounds.
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

interface Cell {
  element: HostElement;
  column: number;
  columns: number;
  rows: number;
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
  readonly #rowTemplates = new WeakMap<HostElement, string>();
  readonly #cells = new Map<HostElement, Cell[]>();
  readonly #grids = new Map<HostElement, Map<HostElement, HostElement[]>>();
  #measuring: (() => void) | undefined;
  /** Placement written after a restyle needs another pass through the cascade. */
  #placed = false;

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
      ((name === 'colspan' || name === 'rowspan') &&
        (element.tag === 'td' || element.tag === 'th')) ||
      ((name === 'span' || name === 'width') &&
        (element.tag === 'col' || element.tag === 'colgroup'))
    ) {
      this.changed(element);
    }
  }

  /** Hidden rows and cells leave their occupied slots when the cascade changes. */
  restyled(
    element: HostElement,
    before: ReadonlyMap<string, string>,
    now: ReadonlyMap<string, string>,
  ): void {
    if (['tr', 'td', 'th'].includes(element.tag) && before.get('display') !== now.get('display')) {
      this.changed(element);
    }
  }

  forget(node: HostNode): void {
    if (node instanceof ElementClass) {
      this.#dirty.delete(node);
      this.#given.delete(node);
      this.#cells.delete(node);
      this.#grids.delete(node);
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
    const tracks = this.#columns(table);
    let count = tracks.length;
    const groups: { parent: HostElement; rows: HostElement[] }[] = [];
    for (const row of rows) {
      const parent = row.parentNode;
      if (parent instanceof ElementClass) {
        const group = groups.at(-1);
        if (group?.parent === parent) {
          group.rows.push(row);
        } else {
          groups.push({ parent, rows: [row] });
        }
      }
    }
    const cells: Cell[] = [];
    const grids = new Map<HostElement, HostElement[]>();
    for (const { parent, rows: group } of groups) {
      const placed: { cell: Cell; row: number }[] = [];
      const occupied: number[] = [];
      for (let y = 0; y < group.length; y++) {
        if (this.host.declaredOf(group[y]!).get('display') === 'none') {
          continue;
        }
        let x = 0;
        for (const element of this.#children(group[y]!, new Set(['td', 'th']))) {
          if (this.host.declaredOf(element).get('display') === 'none') {
            continue;
          }
          const columns = Math.min(span(element, 'colspan'), 1000);
          const raw = Number.parseInt(element.getAttribute('rowspan') ?? '', 10);
          const tall = raw === 0 ? group.length - y : Math.max(raw || 1, 1);
          const height = Math.min(tall, group.length - y);
          // A colspan needs consecutive free slots, including those occupied by earlier rows.
          for (;;) {
            let collision = -1;
            for (let c = x; c < x + columns; c++) {
              if ((occupied[c] ?? 0) > y) {
                collision = c;
                break;
              }
            }
            if (collision < 0) {
              break;
            }
            x = collision + 1;
          }
          const cell = { element, column: x, columns, rows: height };
          cells.push(cell);
          placed.push({ cell, row: y });
          for (let c = x; c < x + columns; c++) {
            occupied[c] = y + height;
          }
          x += columns;
          count = Math.max(count, x);
        }
      }
      const shared = placed.some(({ cell }) => cell.rows > 1);
      for (const { cell, row } of placed) {
        this.#place(cell.element, 'grid-column', `${cell.column + 1} / span ${cell.columns}`);
        this.#place(cell.element, 'grid-row', shared ? `${row + 1} / span ${cell.rows}` : null);
      }
      if (shared) {
        grids.set(parent, [...(grids.get(parent) ?? []), ...group]);
      }
    }
    for (const group of this.#grids.get(table)?.keys() ?? []) {
      if (!grids.has(group) && !group.destroyed) {
        this.host.layout.setGridRows(group.layoutNode, []);
      }
    }
    for (const [parent, group] of grids) {
      const before = this.#grids.get(table)?.get(parent);
      if (before?.length !== group.length || group.some((row, i) => row !== before[i])) {
        this.host.layout.setGridRows(
          parent.layoutNode,
          group.map((row) => row.layoutNode),
        );
      }
    }
    this.#grids.set(table, grids);
    this.#cells.set(table, cells);
    while (tracks.length < count) {
      tracks.push(undefined);
    }
    this.#given.set(table, tracks);
    // Until its cells have been measured, a sized column is an equal share.
    this.#placed =
      this.#apply(
        rows,
        tracks.map((t) => t ?? track(null)),
      ) || this.#placed;
    if ((this.#placed || tracks.some((t) => t === undefined)) && !this.#measuring) {
      this.#measuring = this.host.inlineFlows?.onSettled(() => this.#measure());
    }
  }

  #place(element: HostElement, property: string, value: string | null): void {
    if ((element.style.get(property) ?? null) !== value) {
      element.setProperty(property, value);
      this.#placed = true;
    }
  }

  #apply(rows: readonly HostElement[], tracks: readonly string[]): boolean {
    const template = tracks.length === 0 ? 'none' : tracks.join(' ');
    let wrote = false;
    for (const row of rows) {
      if (this.#rowTemplates.get(row) !== template) {
        this.#rowTemplates.set(row, template);
        row.setProperty('grid-template-columns', template);
        wrote = true;
      }
    }
    return wrote;
  }

  /**
   * Once the cells' flows have measured what they hold, size each column that no `col` sizes by
   * its cells: no narrower than its widest unbreakable content, and a share of the rest by the
   * widest one-line width. A cell that spans columns sizes none of them.
   */
  #measure(): boolean {
    if (this.#placed) {
      this.#placed = false;
      return true;
    }
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
      for (const { element, column, columns } of this.#cells.get(table) ?? []) {
        const widths = columns === 1 ? flows.widths(element) : undefined;
        if (widths && column < given.length) {
          min[column] = Math.max(min[column]!, widths.min);
          max[column] = Math.max(max[column]!, widths.max);
        }
      }
      const shares = given.some((t) => t?.includes('fr') ?? false);
      const tracks = given.map((t, i) => t ?? sized(min[i]!, max[i]!, shares));
      wrote = this.#apply(rows, tracks) || wrote;
    }
    return wrote;
  }

  dispose(): void {
    this.#measuring?.();
    this.#measuring = undefined;
    this.#dirty.clear();
    this.#given.clear();
    this.#cells.clear();
    this.#grids.clear();
  }
}
