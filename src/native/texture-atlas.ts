import { gpu } from './index.js';
export interface AtlasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Shelf-packed RGBA images with a transparent pixel between entries. */
export class TextureAtlas {
  readonly #device: gpu.GpuDevice;
  readonly #shelves: { x: number; y: number; height: number }[] = [];
  #nextY = 0;
  #size = 1;
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
      size: { width: this.#size, height: this.#size, depthOrArrayLayers: 1 },
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
        if (height <= shelf.height && shelf.x + width + 1 <= this.#size) {
          const rect = { x: shelf.x, y: shelf.y, width, height };
          shelf.x += width + 1;
          this.#upload(rect, pixels);
          return rect;
        }
      }
      if (width + 1 <= this.#size && this.#nextY + height + 1 <= this.#size) {
        const rect = { x: 0, y: this.#nextY, width, height };
        this.#shelves.push({ x: width + 1, y: this.#nextY, height });
        this.#nextY += height + 1;
        this.#upload(rect, pixels);
        return rect;
      }
      if (this.#size >= 4096) {
        throw new RangeError('Image atlas full');
      }
      const old = this.#texture;
      const oldSize = this.#size;
      // Grow directly to the required shelf size; unused image slots need only a pixel.
      this.#size = Math.max(256, this.#size * 2);
      while (
        this.#size < 4096 &&
        (width + 1 > this.#size || this.#nextY + height + 1 > this.#size)
      ) {
        this.#size *= 2;
      }
      this.#texture = this.#allocate();
      const encoder = this.#device.encoder();
      try {
        encoder.copyTextureToTexture(old, this.#texture, oldSize, oldSize);
        encoder.submit(this.#device.queue());
      } finally {
        encoder.destroy();
      }
      this.view.destroy();
      old.destroy();
      this.view = this.#texture.createView({});
      this.revision++;
    }
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
  dispose(): void {
    this.view.destroy();
    this.#texture.destroy();
  }
}
