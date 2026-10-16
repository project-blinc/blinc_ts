import { gpu } from './index.js';
export interface AtlasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** How much taller an atlas grows at a time; its width grows in powers of two. */
const HEIGHT_STEP = 256;
const MAX_SIDE = 4096;

/** Where entries go in an atlas of a given size, apart from any texture. */
class Shelves {
  readonly rows: { x: number; y: number; height: number }[] = [];
  nextY = 0;
  constructor(
    public width: number,
    public height: number,
  ) {}
  /** A place for a `width` by `height` entry, or undefined when it needs a larger atlas. */
  place(width: number, height: number): AtlasRect | undefined {
    for (const shelf of this.rows) {
      if (height <= shelf.height && shelf.x + width + 1 <= this.width) {
        const rect = { x: shelf.x, y: shelf.y, width, height };
        shelf.x += width + 1;
        return rect;
      }
    }
    if (width + 1 <= this.width && this.nextY + height + 1 <= this.height) {
      const rect = { x: 0, y: this.nextY, width, height };
      this.rows.push({ x: width + 1, y: this.nextY, height });
      this.nextY += height + 1;
      return rect;
    }
    return undefined;
  }
  /**
   * The size to grow to for an entry `place` had no room for: taller, unless that would make it
   * taller than wide, in which case wider, as soon as being wider leaves room for it.
   */
  grown(width: number, height: number): [number, number] {
    let w = this.width;
    while (w < width + 1) {
      w = Math.max(HEIGHT_STEP, w * 2);
    }
    for (;;) {
      if (w > this.width && this.#fits(w, width, height)) {
        return [w, this.height];
      }
      const h = Math.max(
        this.height,
        Math.ceil((this.nextY + height + 1) / HEIGHT_STEP) * HEIGHT_STEP,
      );
      if (h <= Math.max(w, HEIGHT_STEP) || w >= MAX_SIDE) {
        if (w > MAX_SIDE || h > MAX_SIDE) {
          throw new RangeError('Image atlas full');
        }
        return [w, h];
      }
      w *= 2;
    }
  }
  /** Whether an entry would go on a shelf there is, or under them, were the atlas `atlasWidth` wide. */
  #fits(atlasWidth: number, width: number, height: number): boolean {
    return (
      this.rows.some((shelf) => height <= shelf.height && shelf.x + width + 1 <= atlasWidth) ||
      this.nextY + height + 1 <= this.height
    );
  }
}

/**
 * Shelf-packed RGBA images with a transparent pixel between entries. It is as wide as its widest
 * entry needs, in powers of two, and grows taller as shelves fill, so a few wide pictures do not
 * square it up.
 */
export class TextureAtlas {
  readonly #device: gpu.GpuDevice;
  #shelves = new Shelves(1, 1);
  #texture: gpu.GpuTexture;
  view: gpu.GpuTextureView;
  revision = 0;
  constructor(device: gpu.GpuDevice) {
    this.#device = device;
    this.#texture = this.#allocate(1, 1);
    this.view = this.#texture.createView({});
  }
  #allocate(width: number, height: number): gpu.GpuTexture {
    return this.#device.texture({
      size: { width, height, depthOrArrayLayers: 1 },
      format: gpu.TextureFormat.Rgba8unorm,
      usage:
        gpu.TextureUsage.TEXTURE_BINDING | gpu.TextureUsage.COPY_DST | gpu.TextureUsage.COPY_SRC,
    });
  }
  add(width: number, height: number, pixels: Uint8Array): AtlasRect {
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1 ||
      width >= 4096 ||
      height >= 4096 ||
      pixels.length !== width * height * 4
    ) {
      throw new RangeError('Invalid image atlas entry');
    }
    for (;;) {
      const rect = this.#shelves.place(width, height);
      if (rect) {
        this.#upload(rect, pixels);
        return rect;
      }
      this.#grow(...this.#shelves.grown(width, height));
    }
  }
  #grow(width: number, height: number): void {
    const old = this.#texture;
    const { width: oldWidth, height: oldHeight } = this.#shelves;
    this.#texture = this.#allocate(width, height);
    this.#shelves.width = width;
    this.#shelves.height = height;
    const encoder = this.#device.encoder();
    try {
      encoder.copyTextureToTexture(old, this.#texture, oldWidth, oldHeight);
      encoder.submit(this.#device.queue());
    } finally {
      encoder.destroy();
    }
    this.#replace(old);
  }
  #replace(old: gpu.GpuTexture): void {
    this.view.destroy();
    old.destroy();
    this.view = this.#texture.createView({});
    this.revision++;
  }
  #upload(rect: AtlasRect, pixels: Uint8Array): void {
    this.#device
      .queue()
      .writeTextureWith(
        { texture: this.#texture, origin: { x: rect.x, y: rect.y, z: 0 } },
        pixels,
        { bytesPerRow: rect.width * 4, rowsPerImage: rect.height },
        { width: rect.width, height: rect.height, depthOrArrayLayers: 1 },
      );
  }
  get width(): number {
    return this.#shelves.width;
  }
  get height(): number {
    return this.#shelves.height;
  }
  /** The pixels its entries and the gaps between them take. */
  get used(): number {
    let used = 0;
    for (const shelf of this.#shelves.rows) {
      used += shelf.x * (shelf.height + 1);
    }
    return used;
  }
  /**
   * Keep only `keep`, packed afresh tallest first into an atlas that holds just them, when that
   * takes at most three quarters of what it holds now. Each kept rect is moved in place, its
   * pixels copied on the GPU, and `revision` changes; the rects of every other entry are no
   * longer valid. False, and nothing changes, when repacking would not save that much.
   */
  repack(keep: readonly AtlasRect[]): boolean {
    const order = [...new Set(keep)].sort((a, b) => b.height - a.height || b.width - a.width);
    // Every width that holds the widest, each as tall as its shelves come to; the least of them.
    let best: { shelves: Shelves; moved: Map<AtlasRect, AtlasRect> } | undefined;
    for (let width = HEIGHT_STEP; order.length > 0 && width <= MAX_SIDE; width *= 2) {
      const shelves = new Shelves(width, MAX_SIDE);
      const moved = new Map<AtlasRect, AtlasRect>();
      for (const rect of order) {
        const to = shelves.place(rect.width, rect.height);
        if (!to) {
          break;
        }
        moved.set(rect, to);
      }
      shelves.height = Math.ceil(shelves.nextY / HEIGHT_STEP) * HEIGHT_STEP;
      if (
        moved.size === order.length &&
        (!best || width * shelves.height < best.shelves.width * best.shelves.height)
      ) {
        best = { shelves, moved };
      }
    }
    if (order.length > 0 && !best) {
      return false;
    }
    const { shelves, moved } = best ?? {
      shelves: new Shelves(1, 1),
      moved: new Map<AtlasRect, AtlasRect>(),
    };
    if (shelves.width * shelves.height * 4 > this.width * this.height * 3) {
      return false;
    }
    const old = this.#texture;
    this.#texture = this.#allocate(shelves.width, shelves.height);
    this.#shelves = shelves;
    const encoder = this.#device.encoder();
    try {
      for (const [from, to] of moved) {
        encoder.copyTextureToTextureWith(
          { texture: old, origin: { x: from.x, y: from.y, z: 0 } },
          { texture: this.#texture, origin: { x: to.x, y: to.y, z: 0 } },
          { width: from.width, height: from.height, depthOrArrayLayers: 1 },
        );
      }
      encoder.submit(this.#device.queue());
    } finally {
      encoder.destroy();
    }
    for (const [from, to] of moved) {
      from.x = to.x;
      from.y = to.y;
    }
    this.#replace(old);
    return true;
  }
  /** Forgets every entry: the space is free again, and the rects handed out are no longer valid. */
  reset(): void {
    this.#shelves = new Shelves(this.width, this.height);
  }
  dispose(): void {
    this.view.destroy();
    this.#texture.destroy();
  }
}
