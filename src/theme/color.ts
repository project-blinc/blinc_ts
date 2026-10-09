import type { Color } from '../native/scene.js';

export type { Color };

/** A colour from `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`, or a 0xrrggbb number, with `alpha` over its own. */
export function hex(value: string | number, alpha?: number): Color {
  let r: number, g: number, b: number;
  let a = 1;
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffff) {
      throw new RangeError(`Expected 0xrrggbb, not ${value}`);
    }
    r = (value >> 16) & 255;
    g = (value >> 8) & 255;
    b = value & 255;
  } else {
    const digits = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim())?.[1];
    if (!digits) {
      throw new TypeError(`Expected a hex colour, not ${value}`);
    }
    const full = digits.length <= 4 ? [...digits].map((c) => c + c).join('') : digits;
    const byte = (i: number) => parseInt(full.slice(i * 2, i * 2 + 2), 16);
    r = byte(0);
    g = byte(1);
    b = byte(2);
    a = full.length === 8 ? byte(3) / 255 : 1;
  }
  return Object.freeze<Color>([r / 255, g / 255, b / 255, alpha ?? a]);
}

/** `color` with alpha `alpha`. */
export function withAlpha(color: Color, alpha: number): Color {
  return Object.freeze<Color>([color[0], color[1], color[2], alpha]);
}

/** Each channel from `from` to `to` by `t`, clamped to 0..1. */
export function mixColor(from: Color, to: Color, t: number): Color {
  const k = Math.min(Math.max(t, 0), 1);
  return Object.freeze(from.map((c, i) => c + (to[i]! - c) * k)) as unknown as Color;
}

function byte(channel: number): number {
  return Math.round(Math.min(Math.max(channel, 0), 1) * 255);
}

/** `color` as CSS: `#rrggbb` when opaque, else `rgba(r,g,b,a)`. */
export function cssColor(color: Color): string {
  const [r, g, b, a] = color;
  if (a < 1) {
    return `rgba(${byte(r)},${byte(g)},${byte(b)},${number(Math.min(Math.max(a, 0), 1))})`;
  }
  return `#${[r, g, b].map((c) => byte(c).toString(16).padStart(2, '0')).join('')}`;
}

/** A number as CSS writes it: its shortest form as a 32-bit float. */
export function number(value: number): string {
  const f = Math.fround(value);
  for (let digits = 1; digits <= 9; digits++) {
    const text = Number(f.toPrecision(digits));
    if (Math.fround(text) === f) {
      return String(text);
    }
  }
  return String(f);
}

/** Pixels as CSS: `12px`, `0.5px`. */
export function px(value: number): string {
  return `${number(value)}px`;
}
