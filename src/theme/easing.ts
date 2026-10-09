import { number } from './color.js';

/**
 * A timing curve. The named curves are CSS's; `steps` jumps `count` times,
 * the first at the start when `jumpStart`.
 */
export type Easing =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | { readonly cubicBezier: readonly [x1: number, y1: number, x2: number, y2: number] }
  | { readonly steps: number; readonly jumpStart?: boolean };

/** A cubic bézier curve, as CSS's `cubic-bezier(x1, y1, x2, y2)`. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  return Object.freeze({ cubicBezier: Object.freeze([x1, y1, x2, y2] as const) });
}

/** The curve's control points, as CSS writes them; null for linear and steps. */
export function controlPoints(easing: Easing): readonly [number, number, number, number] | null {
  if (typeof easing === 'string') {
    switch (easing) {
      case 'linear':
        return null;
      case 'ease-in':
        return [0.4, 0, 1, 1];
      case 'ease-out':
        return [0, 0, 0.2, 1];
      case 'ease-in-out':
        return [0.4, 0, 0.2, 1];
    }
  }
  return 'cubicBezier' in easing ? easing.cubicBezier : null;
}

/** The curve as a CSS `<easing-function>`. */
export function cssEasing(easing: Easing): string {
  if (typeof easing === 'object' && 'steps' in easing) {
    return `steps(${easing.steps}, ${easing.jumpStart ? 'jump-start' : 'jump-end'})`;
  }
  const p = controlPoints(easing);
  return p ? `cubic-bezier(${p.map(number).join(', ')})` : 'linear';
}

/**
 * Progress at time `t`, clamped to 0..1: the curve's y where its x is `t`.
 * The result is not clamped, so an overshooting curve passes 1 on the way.
 */
export function ease(easing: Easing, t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  if (typeof easing === 'object' && 'steps' in easing) {
    const n = easing.steps;
    return x >= 1 ? 1 : Math.min(1, (Math.floor(x * n) + (easing.jumpStart ? 1 : 0)) / n);
  }
  const p = controlPoints(easing);
  return p ? bezier(p[0], p[1], p[2], p[3], x) : x;
}

/** y at x on the bézier through (0,0), (x1,y1), (x2,y2), (1,1): Newton steps, then bisection. */
function bezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  const at = (a: number, b: number, s: number) => {
    const m = 1 - s;
    return 3 * m * m * s * a + 3 * m * s * s * b + s * s * s;
  };
  const slope = (a: number, b: number, s: number) => {
    const m = 1 - s;
    return 3 * m * m * a + 6 * m * s * (b - a) + 3 * s * s * (1 - b);
  };
  let s = x;
  for (let i = 0; i < 8; i++) {
    const error = at(x1, x2, s) - x;
    if (Math.abs(error) < 1e-7) {
      return at(y1, y2, s);
    }
    const d = slope(x1, x2, s);
    if (Math.abs(d) < 1e-6) {
      break;
    }
    s -= error / d;
  }
  let lo = 0;
  let hi = 1;
  s = x;
  for (let i = 0; i < 40; i++) {
    const value = at(x1, x2, s);
    if (Math.abs(value - x) < 1e-7) {
      break;
    }
    if (value < x) {
      lo = s;
    } else {
      hi = s;
    }
    s = (lo + hi) / 2;
  }
  return at(y1, y2, s);
}
