/**
 * How a theme turns rounded corners into squircles. Values are kept as
 * 32-bit floats, as the renderer reads them.
 */

/**
 * `cornerSmoothing` (0 to 1) pulls the corner's superellipse exponent from
 * 2, a circle, toward `cornerExponent`. Only corners of at least
 * `smoothingThreshold` pixels are smoothed. Smoothing is off when
 * `cornerSmoothing` is 0 or the threshold is infinite.
 */
export interface ShapeTokens {
  readonly cornerSmoothing: number;
  readonly cornerExponent: number;
  readonly smoothingThreshold: number;
}

/** No smoothing: every corner stays circular unless a node gives its own shape. */
export const shapeOff: ShapeTokens = Object.freeze({
  cornerSmoothing: 0,
  cornerExponent: 2,
  smoothingThreshold: Infinity,
});

/** Shape tokens rounded to 32-bit floats; an infinite threshold stays infinite. */
export function shapeTokens(
  cornerSmoothing: number,
  cornerExponent: number,
  smoothingThreshold: number,
): ShapeTokens {
  return Object.freeze({
    cornerSmoothing: Math.fround(cornerSmoothing),
    cornerExponent: Math.fround(cornerExponent),
    smoothingThreshold:
      smoothingThreshold === Infinity ? Infinity : Math.fround(smoothingThreshold),
  });
}

/** Whether no corner is smoothed. */
export function isShapeOff(shape: ShapeTokens): boolean {
  return shape.cornerSmoothing <= 0.001 || !Number.isFinite(shape.smoothingThreshold);
}

/** The superellipse exponent: 2 + (max(exponent, 2) − 2) × clamp(smoothing, 0, 1). 2 is a circle. */
export function effectiveExponent(shape: ShapeTokens): number {
  const smoothing = Math.min(Math.max(shape.cornerSmoothing, 0), 1);
  return Math.fround(2 + (Math.max(shape.cornerExponent, 2) - 2) * smoothing);
}

/**
 * The corner shape `n` the renderer takes, log2 of the exponent, as a
 * fraction: 1 is a circle, 2 a classic squircle. 0 when smoothing is off,
 * which the renderer reads as no smoothing.
 */
export function cornerN(shape: ShapeTokens): number {
  if (isShapeOff(shape)) {
    return 0;
  }
  return Math.fround(Math.max(Math.log2(effectiveExponent(shape)), 0));
}

/** From `from` to `to` by `t`, clamped; an infinite threshold takes the other end's. */
export function lerpShape(from: ShapeTokens, to: ShapeTokens, t: number): ShapeTokens {
  const k = Math.min(Math.max(t, 0), 1);
  const a = from.smoothingThreshold;
  const b = to.smoothingThreshold;
  const threshold = Number.isFinite(a)
    ? Number.isFinite(b)
      ? a + (b - a) * k
      : a
    : Number.isFinite(b)
      ? b
      : Infinity;
  return shapeTokens(
    from.cornerSmoothing + (to.cornerSmoothing - from.cornerSmoothing) * k,
    from.cornerExponent + (to.cornerExponent - from.cornerExponent) * k,
    threshold,
  );
}

/** What the renderer's paint options take for `shape`, with the theme's full radius. */
export interface ShapeOptions {
  /** The corner `n`; 0 turns smoothing off. */
  readonly cornerShape: number;
  /** Radii below this stay circular. */
  readonly smoothingThreshold: number;
  /** Radii at about this size stay circular, so circles and pills keep their shape. */
  readonly fullRadius: number;
}

/** `shape` resolved for the renderer. */
export function shapeOptions(shape: ShapeTokens, fullRadius = 9999): ShapeOptions {
  const n = cornerN(shape);
  return {
    cornerShape: n,
    smoothingThreshold: n === 0 ? 0 : shape.smoothingThreshold,
    fullRadius,
  };
}
