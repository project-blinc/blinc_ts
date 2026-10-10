import type { Scope } from '../hmr.js';
import type { ImageFit } from './generated/scene.js';

/** @internal */
export interface NativeImage {
  readonly width: number;
  readonly height: number;
  readPixels(target: Uint8Array): void;
  resample(width: number, height: number, fit: ImageFit, target: Uint8Array): void;
  dispose(): void;
}
/** @internal What the native loader read, until its raster image is taken. */
export interface NativeLoadedImage {
  readonly svg: boolean;
  readonly width: number;
  readonly height: number;
  markup(): string | null;
  takeImage(): NativeImage;
}
/** Decoded native pixels, independent of a GPU device or layout tree. */
export class ImageResource {
  readonly #native: NativeImage;

  /** @internal Use loadNative().decodeImage or rasterizeSvg. */
  constructor(native: NativeImage, scope?: Scope) {
    this.#native = native;
    scope?.onCleanup(() => this.dispose());
  }
  get width(): number {
    return this.#native.width;
  }
  get height(): number {
    return this.#native.height;
  }
  /** Copy straight-alpha RGBA into reusable storage, with no retained native pointer. */
  readPixels(target: Uint8Array): void {
    this.#native.readPixels(target);
  }
  /** Resample with the shared native image fitter into width * height * 4 bytes. */
  resample(width: number, height: number, fit: ImageFit, target: Uint8Array): void {
    this.#native.resample(width, height, fit, target);
  }
  /** Safe to call repeatedly; subsequent pixel or size reads fail. */
  dispose(): void {
    this.#native.dispose();
  }
}
