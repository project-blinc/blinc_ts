/**
 * Layout properties by router id, for code that writes the router directly.
 * Ids are those of blinc_abi's property router; CSS names and values are
 * read natively (`LayoutNode.setLayoutProperty`, stylesheets).
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
