import type { Brush } from './brush.js';
/** Straight-alpha RGBA channels in [0, 1]. */
export type Color = readonly [r: number, g: number, b: number, a: number];
export type CornerRadii = readonly [
  topLeft: number,
  topRight: number,
  bottomRight: number,
  bottomLeft: number,
];
/** Applied around the node's center: x' = ax + cy + e, y' = bx + dy + f. */
export type AffineTransform = readonly [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
];
/** Offset from layout; a negative width preserves the computed size. Null clears it. */
export type VisualBounds = readonly [x: number, y: number, width: number, height: number];
export interface TextStyle {
  fontSize?: number;
  /** Multiplier of fontSize. */
  lineHeight?: number;
  letterSpacing?: number;
  wrap?: boolean;
  /** Font name or CSS family stack. */
  fontFamily?: string;
  fontWeight?: number;
  italic?: boolean;
}
export interface PaintShadow {
  x: number;
  y: number;
  blur: number;
  spread?: number;
  color: Color;
}
/** Partial paint update; clearPaint resets all paint fields. */
export interface PaintStyle {
  background?: Brush;
  textColor?: Color;
  radius?: CornerRadii;
  borderColor?: Color;
  borderWidth?: number;
  opacity?: number;
  visible?: boolean;
  transform?: AffineTransform;
  shadows?: readonly PaintShadow[];
}
export interface PaintOptions {
  /** Device pixels per logical pixel; determines glyph raster resolution. */
  scale?: number;
  /** Theme corner-shape n: 2 smooths eligible corners to squircles; 0 disables smoothing. */
  cornerShape?: number;
  /** Radii below this threshold remain circular. */
  smoothingThreshold?: number;
  /** Radii at this size, or near half the box size, keep circles and pills round. */
  fullRadius?: number;
  textColor?: Color;
}
export interface PaintInfo {
  /** Primitive count; trailing polygon data is not a primitive. */
  count: number;
  /** Required Float32Array capacity, including trailing data. */
  floats: number;
}
export interface AtlasInfo {
  width: number;
  height: number;
  revision: number;
  x: number;
  y: number;
  updateWidth: number;
  updateHeight: number;
  /** Tightly packed update bytes; one channel for glyph masks, four for color glyphs. */
  bytes: number;
}
export interface SceneHit {
  /** Matches LayoutNode.id; unique within its layout context. */
  nodeId: bigint;
  /** Point in the node's local coordinates. */
  x: number;
  y: number;
}
export const sceneSchema = Object.freeze({ version: 1, recordFloats: 112, recordRows: 28 });
/** @internal Reject a stale producer before any records can reach a shader. */
export function validateSceneSchema(schema: unknown): void {
  if (
    typeof schema !== 'object' ||
    schema === null ||
    !('version' in schema) ||
    schema.version !== sceneSchema.version ||
    !('recordFloats' in schema) ||
    schema.recordFloats !== sceneSchema.recordFloats ||
    !('recordRows' in schema) ||
    schema.recordRows !== sceneSchema.recordRows
  ) {
    throw new Error('Native scene schema mismatch; rebuild the addon and SDK together');
  }
}
