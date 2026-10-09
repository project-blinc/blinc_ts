import { BrushKind, ImageFit } from './generated/scene.js';
import type { Color } from './scene.js';

export type BrushColor = Color | number;
export interface GlassOptions {
  simple?: boolean;
  noise?: number;
  saturation?: number;
  brightness?: number;
  borderThickness?: number;
  borderColor?: Color;
  aberration?: number;
  bevel?: number;
  inset?: boolean;
}
/** @internal */
export interface BrushDescriptor extends GlassOptions {
  kind: BrushKind;
  color?: Color;
  points?: readonly number[];
  stops?: { offset: number; color: Color }[];
  boundingBox?: boolean;
  radius?: number;
  tint?: Color;
  source?: string;
  fit?: ImageFit;
}
declare const brushHandle: unique symbol;
/** @internal Opaque native Blinc brush. */
export interface NativeBrush {
  readonly [brushHandle]: true;
}
/** @internal */
export interface BrushFactory {
  createBrush(descriptor: BrushDescriptor): NativeBrush;
}
function rgba(value: BrushColor, alpha: number): Color {
  if (typeof value !== 'number') {
    return [value[0], value[1], value[2], value[3] * alpha];
  }
  if (!Number.isInteger(value) || value < 0 || value > 0xffffff) {
    throw new RangeError('Expected a 24-bit RGB color');
  }
  return [(value >>> 16) / 255, ((value >>> 8) & 255) / 255, (value & 255) / 255, alpha];
}
/** Blinc brush values: fills and backdrop effects, reusable across nodes. */
export class Brush {
  readonly #descriptor: BrushDescriptor;
  #native = new WeakMap<BrushFactory, NativeBrush>();
  private constructor(descriptor: BrushDescriptor) {
    this.#descriptor = descriptor;
  }

  static solid(color: BrushColor, alpha = 1): Brush {
    return new Brush({ kind: BrushKind.Solid, color: rgba(color, alpha) });
  }
  /** Coordinates are logical pixels, or fractions of the box when boundingBox is true. */
  static linear(x1: number, y1: number, x2: number, y2: number, boundingBox = false): Brush {
    return new Brush({ kind: BrushKind.Linear, points: [x1, y1, x2, y2], stops: [], boundingBox });
  }
  static radial(cx: number, cy: number, radius: number, boundingBox = false): Brush {
    return new Brush({
      kind: BrushKind.Radial,
      points: [cx, cy, radius, 0],
      stops: [],
      boundingBox,
    });
  }
  /** Add stops in offset order; assign the brush after its last stop. */
  stop(offset: number, color: BrushColor, alpha = 1): this {
    const stops = this.#descriptor.stops;
    if (!stops) {
      throw new Error('Only gradient brushes have stops');
    }
    stops.push({ offset, color: rgba(color, alpha) });
    this.#native = new WeakMap();
    return this;
  }
  static blur(radius: number, tint: BrushColor = 0, alpha?: number): Brush {
    return new Brush({
      kind: BrushKind.Blur,
      radius,
      tint: rgba(tint, alpha ?? (typeof tint === 'number' ? 0 : 1)),
    });
  }
  static glass(
    blur: number,
    tint: BrushColor = 0xffffff,
    alpha?: number,
    options: GlassOptions = {},
  ): Brush {
    return new Brush({
      ...options,
      kind: BrushKind.Glass,
      radius: blur,
      tint: rgba(tint, alpha ?? (typeof tint === 'number' ? 0.1 : 1)),
      ...(options.borderColor ? { borderColor: [...options.borderColor] as Color } : {}),
    });
  }
  /** A host resolves the source and fit to a prepared renderer slot with setImageSource. */
  static image(source: string, fit: ImageFit = ImageFit.Cover): Brush {
    return new Brush({ kind: BrushKind.Image, source, fit });
  }
  /** @internal A solid brush's color, which the command buffer carries without a native brush. */
  static solidColor(brush: Brush): Color | undefined {
    return brush.#descriptor.kind === BrushKind.Solid ? brush.#descriptor.color : undefined;
  }
  /** @internal Construct once per native context; repeated assignment reuses the value. */
  static unwrap(brush: Brush, factory: BrushFactory): NativeBrush {
    let native = brush.#native.get(factory);
    if (!native) {
      native = factory.createBrush(brush.#descriptor);
      brush.#native.set(factory, native);
    }
    return native;
  }
}
