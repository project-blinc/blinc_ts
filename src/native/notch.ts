/**
 * A shape a rounded box cannot make, drawn in place of the element's box:
 * each corner's radius, negative for a concave corner that curves out to the
 * element's edge, as a menu-bar dropdown meets its bar, and a modifier at the
 * centre of the top and of the bottom edge.
 *
 * Concave corners and outward modifiers (a bulge or a peak) lie inside the
 * element's box: the body is inset by them, so give the element padding for
 * its content. A scoop or a cut carves into the body and insets nothing.
 * Signed radii can be animated through zero, from convex to concave.
 */

/** What one edge carries at its centre. */
export interface NotchEdge {
  readonly kind: 'none' | 'scoop' | 'bulge' | 'cut' | 'peak';
  /** Across the edge, in pixels. */
  readonly width: number;
  /** How far it goes in or out: a scoop's or cut's depth, a bulge's or peak's height. */
  readonly extent: number;
  /** How far its entry or foot is rounded; a scoop and a bulge only. */
  readonly radius: number;
}

const kinds = { none: 0, scoop: 1, bulge: 2, cut: 3, peak: 4 } as const;
const edge = (kind: NotchEdge['kind'], width: number, extent: number, radius = 0): NotchEdge =>
  Object.freeze({ kind, width, extent, radius });

/** The edge modifiers. */
export const notchEdge = Object.freeze({
  none: edge('none', 0, 0),
  /** A bowl carved in, `width` across and `depth` deep, its entry rounded by `radius`: a camera island's. */
  scoop: (width: number, depth: number, radius = 0) => edge('scoop', width, depth, radius),
  /** An arc rising `height` out of the edge over `width`, its foot rounded by `radius`. */
  bulge: (width: number, height: number, radius = 0) => edge('bulge', width, height, radius),
  /** A V cut in, `width` across and `depth` deep. */
  cut: (width: number, depth: number) => edge('cut', width, depth),
  /** A V rising `height` out of the edge over `width`, as a tooltip's arrow. */
  peak: (width: number, height: number) => edge('peak', width, height),
});

export interface Notch {
  /** Pixels per corner; negative for a concave one. */
  readonly topLeft: number;
  readonly topRight: number;
  readonly bottomRight: number;
  readonly bottomLeft: number;
  readonly top: NotchEdge;
  readonly bottom: NotchEdge;
}

/** A notch from its parts; a corner or an edge left out is plain. */
export function notch(parts: Partial<Notch> = {}): Notch {
  return Object.freeze({
    topLeft: parts.topLeft ?? 0,
    topRight: parts.topRight ?? 0,
    bottomRight: parts.bottomRight ?? 0,
    bottomLeft: parts.bottomLeft ?? 0,
    top: parts.top ?? notchEdge.none,
    bottom: parts.bottom ?? notchEdge.none,
  });
}

/** Concave top corners of `radius`, flaring to meet what is above, and round bottom corners of `bottomRadius`: a menu-bar dropdown. */
export function concaveTop(radius: number, bottomRadius = 0): Notch {
  return notch({
    topLeft: -radius,
    topRight: -radius,
    bottomRight: bottomRadius,
    bottomLeft: bottomRadius,
  });
}

/** The twelve numbers the renderer reads: the radii, then each edge as kind, width, extent and radius. */
export function encodeNotch(n: Notch): number[] {
  const edgeValues = (e: NotchEdge) => [kinds[e.kind], e.width, e.extent, e.radius];
  return [
    n.topLeft,
    n.topRight,
    n.bottomRight,
    n.bottomLeft,
    ...edgeValues(n.top),
    ...edgeValues(n.bottom),
  ];
}
