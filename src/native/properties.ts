/**
 * Layout properties by router id, and CSS layout declarations turned into
 * router writes. Ids follow blinc_abi's property router (ashui's
 * `PropertyId` numbering), so a CSS cascade and these setters write through
 * the same native path.
 */

/** Router property ids. A `*Percent` id takes a fraction of the parent, 0 to 1. */
export const LayoutProperty = Object.freeze({
  BorderWidth: 2,
  Width: 10,
  Height: 11,
  MinWidth: 12,
  MaxWidth: 13,
  MinHeight: 14,
  MaxHeight: 15,
  Padding: 16,
  Margin: 17,
  Gap: 18,
  FlexDirection: 19,
  AlignItems: 20,
  JustifyContent: 21,
  AlignSelf: 22,
  FlexGrow: 23,
  FlexShrink: 24,
  FlexWrap: 25,
  FlexBasis: 26,
  Display: 27,
  Overflow: 28,
  Position: 29,
  Top: 30,
  Right: 31,
  Bottom: 32,
  Left: 33,
  PaddingTop: 43,
  PaddingRight: 44,
  PaddingBottom: 45,
  PaddingLeft: 46,
  MarginTop: 47,
  MarginRight: 48,
  MarginBottom: 49,
  MarginLeft: 50,
  GapX: 51,
  GapY: 52,
  WidthPercent: 53,
  HeightPercent: 54,
  MinWidthPercent: 55,
  MaxWidthPercent: 56,
  MinHeightPercent: 57,
  MaxHeightPercent: 58,
  FlexBasisPercent: 59,
  BorderTopWidth: 60,
  BorderRightWidth: 61,
  BorderBottomWidth: 62,
  BorderLeftWidth: 63,
  GridTemplateColumns: 85,
  GridTemplateRows: 86,
  GridColumn: 87,
  GridRow: 88,
  AspectRatio: 90,
  OverflowX: 99,
  OverflowY: 100,
  AlignContent: 101,
  JustifyItems: 102,
  JustifySelf: 103,
  PaddingTopPercent: 104,
  PaddingRightPercent: 105,
  PaddingBottomPercent: 106,
  PaddingLeftPercent: 107,
  MarginTopPercent: 108,
  MarginRightPercent: 109,
  MarginBottomPercent: 110,
  MarginLeftPercent: 111,
  TopPercent: 112,
  RightPercent: 113,
  BottomPercent: 114,
  LeftPercent: 115,
  GapXPercent: 116,
  GapYPercent: 117,
  Order: 118,
});
export type LayoutProperty = (typeof LayoutProperty)[keyof typeof LayoutProperty];

/** How a router write carries its value; `Unset` restores a new node's value. */
export const WriteKind = Object.freeze({ Number: 0, Enum: 1, Text: 2, NoText: 3, Unset: 4 });
export type WriteKind = (typeof WriteKind)[keyof typeof WriteKind];
export type PropertyWrite =
  | readonly [id: number, kind: 0 | 1, value: number]
  | readonly [id: number, kind: 2, value: string]
  | readonly [id: number, kind: 3 | 4, value: 0];

const P = LayoutProperty;
const numberIds = new Set<number>([
  P.BorderWidth,
  ...range(P.Width, P.Gap),
  P.FlexGrow,
  P.FlexShrink,
  P.FlexBasis,
  ...range(P.Top, P.Left),
  ...range(P.PaddingTop, P.BorderLeftWidth),
  P.AspectRatio,
  ...range(P.PaddingTopPercent, P.GapYPercent),
]);
const enumIds = new Set<number>([
  P.FlexDirection,
  P.AlignItems,
  P.JustifyContent,
  P.AlignSelf,
  P.FlexWrap,
  P.Display,
  P.Overflow,
  P.Position,
  ...range(P.OverflowX, P.JustifySelf),
  P.Order,
]);
const textIds = new Set<number>(range(P.GridTemplateColumns, P.GridRow));
function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** The router write for one value; null unsets. Throws for an id that takes another kind. */
export function propertyWrite(id: number, value: number | string | null): PropertyWrite {
  if (value === null) {
    if (!numberIds.has(id) && !enumIds.has(id) && !textIds.has(id)) {
      throw new RangeError(`Unknown layout property ${id}`);
    }
    return [id, WriteKind.Unset, 0];
  }
  if (typeof value === 'string') {
    if (!textIds.has(id)) {
      throw new TypeError(`Layout property ${id} does not take text`);
    }
    return [id, WriteKind.Text, value];
  }
  if (enumIds.has(id)) {
    if (!Number.isInteger(value)) {
      throw new TypeError(`Layout property ${id} takes an integer`);
    }
    return [id, WriteKind.Enum, value];
  }
  if (!numberIds.has(id)) {
    throw new TypeError(`Layout property ${id} does not take a number`);
  }
  if (Number.isFinite(value) || Number.isNaN(value)) {
    return [id, WriteKind.Number, value];
  }
  throw new RangeError('Layout values must be finite, or NaN for auto');
}

const align: Record<string, number> = {
  start: 0,
  'self-start': 0,
  end: 1,
  'self-end': 1,
  'flex-start': 2,
  'flex-end': 3,
  center: 4,
  baseline: 5,
  stretch: 6,
  auto: -1,
  normal: -1,
};
const justify: Record<string, number> = {
  start: 0,
  left: 0,
  end: 1,
  right: 1,
  'flex-start': 2,
  'flex-end': 3,
  center: 4,
  stretch: 5,
  'space-between': 6,
  'space-evenly': 7,
  'space-around': 8,
  normal: -1,
};
const keywords: Record<number, Record<string, number>> = {
  [P.FlexDirection]: { row: 0, column: 1, 'row-reverse': 2, 'column-reverse': 3 },
  [P.FlexWrap]: { nowrap: 0, wrap: 1, 'wrap-reverse': 2 },
  [P.Display]: { block: 0, flex: 1, grid: 2, none: 3 },
  [P.Position]: { static: 0, relative: 0, absolute: 1, fixed: 1 },
  [P.Overflow]: { visible: 0, clip: 1, hidden: 2, scroll: 3, auto: 3 },
  [P.AlignItems]: align,
  [P.AlignSelf]: align,
  [P.JustifyItems]: align,
  [P.JustifySelf]: align,
  [P.JustifyContent]: justify,
  [P.AlignContent]: justify,
};
keywords[P.OverflowX] = keywords[P.Overflow]!;
keywords[P.OverflowY] = keywords[P.Overflow]!;

/** Length-valued CSS properties: their pixel id, and their percentage id if any. */
const lengths: Record<string, readonly [px: number, percent?: number]> = {
  width: [P.Width, P.WidthPercent],
  height: [P.Height, P.HeightPercent],
  'min-width': [P.MinWidth, P.MinWidthPercent],
  'max-width': [P.MaxWidth, P.MaxWidthPercent],
  'min-height': [P.MinHeight, P.MinHeightPercent],
  'max-height': [P.MaxHeight, P.MaxHeightPercent],
  'flex-basis': [P.FlexBasis, P.FlexBasisPercent],
  'padding-top': [P.PaddingTop, P.PaddingTopPercent],
  'padding-right': [P.PaddingRight, P.PaddingRightPercent],
  'padding-bottom': [P.PaddingBottom, P.PaddingBottomPercent],
  'padding-left': [P.PaddingLeft, P.PaddingLeftPercent],
  'margin-top': [P.MarginTop, P.MarginTopPercent],
  'margin-right': [P.MarginRight, P.MarginRightPercent],
  'margin-bottom': [P.MarginBottom, P.MarginBottomPercent],
  'margin-left': [P.MarginLeft, P.MarginLeftPercent],
  top: [P.Top, P.TopPercent],
  right: [P.Right, P.RightPercent],
  bottom: [P.Bottom, P.BottomPercent],
  left: [P.Left, P.LeftPercent],
  'column-gap': [P.GapX, P.GapXPercent],
  'row-gap': [P.GapY, P.GapYPercent],
  'border-top-width': [P.BorderTopWidth],
  'border-right-width': [P.BorderRightWidth],
  'border-bottom-width': [P.BorderBottomWidth],
  'border-left-width': [P.BorderLeftWidth],
};
const enums: Record<string, number> = {
  'flex-direction': P.FlexDirection,
  'flex-wrap': P.FlexWrap,
  display: P.Display,
  position: P.Position,
  overflow: P.Overflow,
  'overflow-x': P.OverflowX,
  'overflow-y': P.OverflowY,
  'align-items': P.AlignItems,
  'align-self': P.AlignSelf,
  'align-content': P.AlignContent,
  'justify-content': P.JustifyContent,
  'justify-items': P.JustifyItems,
  'justify-self': P.JustifySelf,
};
const texts: Record<string, number> = {
  'grid-template-columns': P.GridTemplateColumns,
  'grid-template-rows': P.GridTemplateRows,
  'grid-column': P.GridColumn,
  'grid-row': P.GridRow,
};
/** Shorthands over four sides, top, right, bottom, left, as CSS expands them. */
const sides: Record<string, readonly string[]> = {
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  inset: ['top', 'right', 'bottom', 'left'],
  'border-width': [
    'border-top-width',
    'border-right-width',
    'border-bottom-width',
    'border-left-width',
  ],
};

/** Every CSS property name `layoutDeclaration` understands. */
export const layoutPropertyNames: ReadonlySet<string> = new Set([
  ...Object.keys(lengths),
  ...Object.keys(enums),
  ...Object.keys(texts),
  ...Object.keys(sides),
  'gap',
  'flex',
  'flex-grow',
  'flex-shrink',
  'order',
  'aspect-ratio',
]);

/** A CSS length: a number of pixels, `Npx`, `N%` or `auto` (NaN). */
function length(name: string, value: number | string): [id: number, value: number] {
  const ids = lengths[name]!;
  if (typeof value === 'number') {
    return [ids[0], value];
  }
  const text = value.trim();
  if (text === 'auto') {
    return [ids[0], NaN];
  }
  if (text.endsWith('%') && ids[1] !== undefined) {
    return [ids[1], parseNumber(text.slice(0, -1), name) / 100];
  }
  return [ids[0], parseNumber(text.endsWith('px') ? text.slice(0, -2) : text, name)];
}
function parseNumber(text: string, name: string): number {
  const value = Number(text.trim());
  if (text.trim() === '' || !Number.isFinite(value)) {
    throw new TypeError(`Invalid value for ${name}: ${text}`);
  }
  return value;
}
function parts(value: number | string): (number | string)[] {
  return typeof value === 'number' ? [value] : value.trim().split(/\s+/);
}

/**
 * The router writes for one CSS layout declaration. Lengths are pixels;
 * em, rem and viewport units belong to the stylesheet that resolves them.
 * A null value unsets every property the declaration writes. Returns
 * undefined for a property that is not a layout property.
 */
export function layoutDeclaration(
  name: string,
  value: number | string | null,
): PropertyWrite[] | undefined {
  const side = sides[name];
  if (side) {
    if (value === null) {
      return side.flatMap((n) => layoutDeclaration(n, null)!);
    }
    const v = parts(value);
    if (v.length < 1 || v.length > 4) {
      throw new TypeError(`Invalid value for ${name}`);
    }
    const [t, r = t, b = t, l = r] = v as [number | string, ...(number | string)[]];
    return [t, r, b, l].flatMap((part, i) => layoutDeclaration(side[i]!, part)!);
  }
  if (lengths[name]) {
    if (value === null) {
      // The pixel id's unset also resets the field its percentage id writes.
      return [propertyWrite(lengths[name][0], null)];
    }
    const [id, v] = length(name, value);
    return [propertyWrite(id, v)];
  }
  const enumId = enums[name];
  if (enumId !== undefined) {
    if (value === null) {
      return [propertyWrite(enumId, null)];
    }
    const code = keywords[enumId]![String(value).trim()];
    if (code === undefined) {
      throw new TypeError(`Invalid value for ${name}: ${value}`);
    }
    return [propertyWrite(enumId, code)];
  }
  const textId = texts[name];
  if (textId !== undefined) {
    return [propertyWrite(textId, value === null ? null : String(value))];
  }
  switch (name) {
    case 'gap': {
      if (value === null) {
        return [propertyWrite(P.GapY, null), propertyWrite(P.GapX, null)];
      }
      const [row, column = row] = parts(value) as [number | string, (number | string)?];
      return [...layoutDeclaration('row-gap', row)!, ...layoutDeclaration('column-gap', column)!];
    }
    case 'flex-grow':
    case 'flex-shrink': {
      const id = name === 'flex-grow' ? P.FlexGrow : P.FlexShrink;
      return [propertyWrite(id, value === null ? null : parseNumber(String(value), name))];
    }
    case 'flex': {
      // `flex: N` is N 1 0%; `none` is 0 0 auto; `auto` is 1 1 auto.
      if (value === null) {
        return [P.FlexGrow, P.FlexShrink, P.FlexBasis].map((id) => propertyWrite(id, null));
      }
      const text = String(value).trim();
      const [grow, shrink, basis] =
        text === 'none'
          ? ['0', '0', 'auto']
          : text === 'auto'
            ? ['1', '1', 'auto']
            : ((): [string, string, string] => {
                const v = text.split(/\s+/);
                return [v[0]!, v[1] ?? '1', v[2] ?? '0%'];
              })();
      return [
        propertyWrite(P.FlexGrow, parseNumber(grow, name)),
        propertyWrite(P.FlexShrink, parseNumber(shrink, name)),
        ...layoutDeclaration('flex-basis', basis)!,
      ];
    }
    case 'order':
      return [propertyWrite(P.Order, value === null ? null : parseNumber(String(value), name))];
    case 'aspect-ratio': {
      if (value === null || value === 'auto') {
        return [propertyWrite(P.AspectRatio, null)];
      }
      const [w, h = '1'] = String(value).split('/');
      return [propertyWrite(P.AspectRatio, parseNumber(w!, name) / parseNumber(h, name))];
    }
  }
  return undefined;
}
