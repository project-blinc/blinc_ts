import { gpu } from './index.js';

/** A frame a window presented, as its scene was drawn for it. */
export interface CapturedFrame {
  /** The window's frame count once this frame was presented. */
  readonly index: number;
  /** The clock its transitions and animations were sampled at, in milliseconds. */
  readonly time: number;
  /** Device pixels. */
  readonly width: number;
  readonly height: number;
  /** RGBA, row by row. */
  readonly pixels: Uint8Array;
}

/**
 * Reads back what a window presents: the painter draws the frame's scene a
 * second time into a readable texture, in the frame's own submission, so a
 * capture is the state that frame showed. Each frame gets its own readback
 * buffer, so none is skipped while an earlier one is still being mapped.
 */
export class FrameTap {
  readonly #device: gpu.GpuDevice;
  readonly #format: gpu.TextureFormat;
  readonly #listener: (frame: CapturedFrame) => void;
  #target:
    | { texture: gpu.GpuTexture; view: gpu.GpuTextureView; width: number; height: number }
    | undefined;
  #recorded:
    | { buffer: gpu.GpuBuffer; width: number; height: number; stride: number; time: number }
    | undefined;
  #disposed = false;

  constructor(
    device: gpu.GpuDevice,
    format: gpu.TextureFormat,
    listener: (frame: CapturedFrame) => void,
  ) {
    this.#device = device;
    this.#format = format;
    this.#listener = listener;
  }

  /** Draw the frame again with `draw` and copy it out, in `encoder`'s submission. */
  record(
    encoder: gpu.GpuEncoder,
    draw: (view: gpu.GpuTextureView) => void,
    width: number,
    height: number,
    time: number,
  ): void {
    if (this.#disposed) {
      return;
    }
    let target = this.#target;
    if (target?.width !== width || target.height !== height) {
      target?.view.destroy();
      target?.texture.destroy();
      const texture = this.#device.texture({
        size: { width, height, depthOrArrayLayers: 1 },
        format: this.#format,
        usage: gpu.TextureUsage.RENDER_ATTACHMENT | gpu.TextureUsage.COPY_SRC,
      });
      target = { texture, view: texture.createView({}), width, height };
      this.#target = target;
    }
    draw(target.view);
    const stride = Math.ceil((width * 4) / 256) * 256;
    const buffer = this.#device.createBuffer({
      size: BigInt(stride * height),
      usage: gpu.BufferUsage.MAP_READ | gpu.BufferUsage.COPY_DST,
    });
    encoder.copyTextureToBuffer(target.texture, buffer, width, height, stride);
    this.#recorded = { buffer, width, height, stride, time };
  }

  /** The frame recorded is submitted and presented as `index`: read it back. */
  presented(index: number): void {
    const recorded = this.#recorded;
    this.#recorded = undefined;
    if (!recorded) {
      return;
    }
    const { buffer, width, height, stride, time } = recorded;
    const padded = new Uint8Array(stride * height);
    void this.#device
      .mapBuffer(buffer, 0n, BigInt(padded.length))
      .then(() => {
        const copied = buffer.copyOut(0n, padded, padded.length);
        buffer.unmap();
        if (!copied || this.#disposed) {
          return;
        }
        const pixels = new Uint8Array(width * height * 4);
        for (let row = 0; row < height; row++) {
          pixels.set(padded.subarray(row * stride, row * stride + width * 4), row * width * 4);
        }
        // The surface may be BGRA; captures are RGBA.
        if (
          this.#format === gpu.TextureFormat.Bgra8unorm ||
          this.#format === gpu.TextureFormat.Bgra8unormSrgb
        ) {
          for (let i = 0; i < pixels.length; i += 4) {
            const b = pixels[i]!;
            pixels[i] = pixels[i + 2]!;
            pixels[i + 2] = b;
          }
        }
        this.#listener({ index, time, width, height, pixels });
      })
      .finally(() => buffer.destroy());
  }

  /** A frame recorded and then not presented is dropped. */
  dropped(): void {
    this.#recorded?.buffer.destroy();
    this.#recorded = undefined;
  }

  dispose(): void {
    this.#disposed = true;
    this.dropped();
    this.#target?.view.destroy();
    this.#target?.texture.destroy();
    this.#target = undefined;
  }
}
