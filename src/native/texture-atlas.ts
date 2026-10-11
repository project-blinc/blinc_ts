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
/**
 * Shelf-packed RGBA images with a transparent pixel between entries. It is as wide as its widest
 * entry needs, in powers of two, and grows taller as shelves fill, so a few wide pictures do not
 * square it up.
 */
export class TextureAtlas {
  readonly #device: gpu.GpuDevice;
  readonly #shelves: { x: number; y: number; height: number }[] = [];
  #nextY = 0;
  #width = 1;
  #height = 1;
  #texture: gpu.GpuTexture;
  view: gpu.GpuTextureView;
  revision = 0;
  constructor(device: gpu.GpuDevice) {
    this.#device = device;
    this.#texture = this.#allocate();
    this.view = this.#texture.createView({});
  }
  #allocate(): gpu.GpuTexture {
    return this.#device.texture({
      size: { width: this.#width, height: this.#height, depthOrArrayLayers: 1 },
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
      for (const shelf of this.#shelves) {
        if (height <= shelf.height && shelf.x + width + 1 <= this.#width) {
          const rect = { x: shelf.x, y: shelf.y, width, height };
          shelf.x += width + 1;
          this.#upload(rect, pixels);
          return rect;
        }
      }
      if (width + 1 <= this.#width && this.#nextY + height + 1 <= this.#height) {
        const rect = { x: 0, y: this.#nextY, width, height };
        this.#shelves.push({ x: width + 1, y: this.#nextY, height });
        this.#nextY += height + 1;
        this.#upload(rect, pixels);
        return rect;
      }
      let w = this.#width;
      while (w < width + 1) {
        w = Math.max(HEIGHT_STEP, w * 2);
      }
      let h = Math.max(
        this.#height,
        Math.ceil((this.#nextY + height + 1) / HEIGHT_STEP) * HEIGHT_STEP,
      );
      if (h > MAX_SIDE && w < MAX_SIDE) {
        // No room for another shelf: wider, the shelves there are take more beside what they hold.
        w *= 2;
        h = this.#height;
      }
      if (w > MAX_SIDE || h > MAX_SIDE) {
        throw new RangeError('Image atlas full');
      }
      this.#grow(w, h);
    }
  }
  #grow(width: number, height: number): void {
    const old = this.#texture;
    const [oldWidth, oldHeight] = [this.#width, this.#height];
    this.#width = width;
    this.#height = height;
    this.#texture = this.#allocate();
    const encoder = this.#device.encoder();
    try {
      encoder.copyTextureToTexture(old, this.#texture, oldWidth, oldHeight);
      encoder.submit(this.#device.queue());
    } finally {
      encoder.destroy();
    }
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
    return this.#width;
  }
  get height(): number {
    return this.#height;
  }
  /** The pixels its entries and the gaps between them take. */
  get used(): number {
    let used = 0;
    for (const shelf of this.#shelves) {
      used += shelf.x * (shelf.height + 1);
    }
    return used;
  }
  /**
   * Forgets every entry: the space is free again, and the rects handed out are no longer valid.
   * Given a `width` that holds less than it does, the texture is made again that wide and one step
   * tall, to grow as entries come, and `revision` changes.
   */
  reset(width?: number): void {
    this.#shelves.length = 0;
    this.#nextY = 0;
    if (width !== undefined && width * HEIGHT_STEP < this.#width * this.#height) {
      this.view.destroy();
      this.#texture.destroy();
      this.#width = width;
      this.#height = HEIGHT_STEP;
      this.#texture = this.#allocate();
      this.view = this.#texture.createView({});
      this.revision++;
    }
  }
  dispose(): void {
    this.view.destroy();
    this.#texture.destroy();
  }
}
