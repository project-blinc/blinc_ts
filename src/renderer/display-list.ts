/**
 * Current Blinc ABI display-list format, following the native record layout. This is an extraction baseline; a negotiated ABI version must
 * be added before native bindings consume independently released versions.
 */
export const DISPLAY_LIST_LAYOUT = {
  recordFloats: 112,
  recordBytes: 448,
  recordRows: 28,
  recordsPerRow: 73,
  rowTexels: 2044,
} as const;

export const PrimitiveKind = {
  Rect: 0,
  Shadow: 3,
  Text: 7,
  Image: 32,
  Canvas: 33,
  LayerBegin: 40,
  Layer: 41,
  Backdrop: 42,
} as const;

/** Borrowed records in paint order; payload can include polygon points after them. */
export class DisplayListView {
  readonly data: Float32Array;
  readonly count: number;

  constructor(data: Float32Array, count: number) {
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > Math.floor(data.length / DISPLAY_LIST_LAYOUT.recordFloats)
    ) {
      throw new RangeError('Primitive count exceeds the display-list buffer');
    }
    this.data = data;
    this.count = count;
  }

  row(record: number, row: number): Float32Array {
    if (
      !Number.isInteger(record) ||
      record < 0 ||
      record >= this.count ||
      !Number.isInteger(row) ||
      row < 0 ||
      row >= DISPLAY_LIST_LAYOUT.recordRows
    ) {
      throw new RangeError('Display-list record or row is out of bounds');
    }
    const offset = record * DISPLAY_LIST_LAYOUT.recordFloats + row * 4;
    return this.data.subarray(offset, offset + 4);
  }

  kind(record: number): number {
    return this.row(record, 11)[0]!;
  }
}
