import { number } from './color.js';

/** A damped spring: its mass, stiffness, damping and the velocity it starts at, in moves a second. */
export interface SpringEasing {
  readonly mass: number;
  readonly stiffness: number;
  readonly damping: number;
  readonly velocity?: number;
}

/**
 * A timing curve. The named curves are CSS's; `steps` jumps `count` times,
 * the first at the start when `jumpStart`; `points` is CSS's `linear()`, each
 * an input from 0 to 1 and the output there. A `spring` transition runs until
 * the spring settles, whatever duration it is given; in a `@keyframes` block
 * it is fitted to its segment.
 */
export type Easing =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | { readonly cubicBezier: readonly [x1: number, y1: number, x2: number, y2: number] }
  | { readonly steps: number; readonly jumpStart?: boolean }
  | { readonly points: readonly (readonly [input: number, output: number])[] }
  | { readonly spring: SpringEasing };

/** A cubic bézier curve, as CSS's `cubic-bezier(x1, y1, x2, y2)`. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  return Object.freeze({ cubicBezier: Object.freeze([x1, y1, x2, y2] as const) });
}

/** A spring, as CSS's `spring(mass stiffness damping velocity)`. */
export function spring(mass: number, stiffness: number, damping: number, velocity = 0): Easing {
  if (
    ![mass, stiffness, damping].every((v) => Number.isFinite(v) && v > 0) ||
    !Number.isFinite(velocity)
  ) {
    throw new RangeError('A spring takes a positive mass, stiffness and damping');
  }
  return Object.freeze({ spring: Object.freeze({ mass, stiffness, damping, velocity }) });
}

/** The curve's control points, as CSS writes them; null for linear, steps, points and springs. */
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
  if (typeof easing === 'object' && 'points' in easing) {
    return `linear(${easing.points.map(([x, y]) => `${number(y)} ${number(x * 100)}%`).join(', ')})`;
  }
  if (typeof easing === 'object' && 'spring' in easing) {
    const { mass, stiffness, damping, velocity = 0 } = easing.spring;
    return `spring(${[mass, stiffness, damping, velocity].map(number).join(' ')})`;
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
  if (typeof easing === 'object' && 'points' in easing) {
    const points = easing.points;
    if (points.length === 0) {
      return x;
    }
    if (x <= points[0]![0]) {
      return points[0]![1];
    }
    let i = 0;
    while (i + 1 < points.length && points[i + 1]![0] <= x) {
      i++;
    }
    if (i + 1 >= points.length) {
      return points[i]![1];
    }
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1]!;
    return x1 <= x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  if (typeof easing === 'object' && 'spring' in easing) {
    const velocity = easing.spring.velocity ?? 0;
    return x >= 1 ? 1 : springAt(easing.spring, x * springSettles(easing.spring), velocity);
  }
  const p = controlPoints(easing);
  return p ? bezier(p[0], p[1], p[2], p[3], x) : x;
}

/** What a spring counts as settled: within this share of the move, and moving less than it a second. */
const SETTLED = 1e-3;

/** A spring's progress `t` seconds in, from rest at 0 toward 1, starting at `velocity` a second. */
function springAt(s: SpringEasing, t: number, velocity: number): number {
  const w = Math.sqrt(s.stiffness / s.mass);
  const zeta = s.damping / (2 * Math.sqrt(s.stiffness * s.mass));
  let rest: number;
  if (Math.abs(zeta - 1) < 1e-6) {
    rest = (1 + (w - velocity) * t) * Math.exp(-w * t);
  } else if (zeta < 1) {
    const wd = w * Math.sqrt(1 - zeta * zeta);
    const b = (zeta * w - velocity) / wd;
    rest = Math.exp(-zeta * w * t) * (Math.cos(wd * t) + b * Math.sin(wd * t));
  } else {
    const root = Math.sqrt(zeta * zeta - 1);
    const r1 = -w * (zeta - root);
    const r2 = -w * (zeta + root);
    const c1 = (-velocity - r2) / (r1 - r2);
    rest = c1 * Math.exp(r1 * t) + (1 - c1) * Math.exp(r2 * t);
  }
  return 1 - rest;
}

/** Seconds until a spring stays within `SETTLED` of the end, at most ten: the engine's own measure. */
function springSettles(s: SpringEasing): number {
  const velocity = s.velocity ?? 0;
  const w = Math.sqrt(s.stiffness / s.mass);
  const zeta = s.damping / (2 * Math.sqrt(s.stiffness * s.mass));
  const decay = zeta < 1 ? zeta * w : w * (zeta - Math.sqrt(Math.max(zeta * zeta - 1, 0)));
  const bound = Math.min(Math.log((10 * (1 + Math.abs(velocity)) * (1 + w)) / SETTLED) / decay, 10);
  const rate = (t: number) => {
    const h = 1e-4;
    const before = Math.max(t - h, 0);
    return (springAt(s, t + h, velocity) - springAt(s, before, velocity)) / (t + h - before);
  };
  let last = 0;
  for (let t = 0; t <= bound; t += 1e-3) {
    if (Math.abs(1 - springAt(s, t, velocity)) > SETTLED || Math.abs(rate(t)) > SETTLED) {
      last = t;
    }
  }
  return last + 1e-3;
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
