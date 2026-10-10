import type { ImageFit } from './generated/scene.js';
import type { ImageResource } from './image.js';

/**
 * Image record slots from this up belong to a library: `IMAGE_BASE + id * 4 + fit`. Below it are
 * the fixed slots given to `SceneRenderer.setImage`. Records hold 32-bit floats, exact to 2^24.
 */
export const IMAGE_BASE = 1 << 20;

/** What a library holds under an id. */
export type LibraryImage =
  | { readonly kind: 'bitmap'; readonly image: ImageResource }
  | { readonly kind: 'svg'; readonly markup: string; readonly mask: boolean };

/** Rasterizes SVG markup at a size, as `loadNative().rasterizeSvg` does. */
export type Rasterize = (markup: string, width: number, height: number) => ImageResource;

/**
 * Images by id, drawn by a `SceneRenderer` that uses the library: each record naming one is
 * resampled, or rasterized, to the size it covers on screen. The library keeps no pixels of its
 * own and no device, so one serves any number of renderers.
 */
export class ImageLibrary {
  readonly #images = new Map<number, LibraryImage>();
  readonly #rasterize: Rasterize;
  #next = 0;

  constructor(rasterize: Rasterize) {
    this.#rasterize = rasterize;
  }

  /** A decoded image, which the caller keeps alive and disposes. */
  add(image: ImageResource): number {
    return this.#put({ kind: 'bitmap', image });
  }

  /**
   * SVG markup, rasterized wherever it is drawn. A `mask` is drawn white and tinted by the node's
   * colour, as an icon is; any other keeps its own colours, `currentColor` being the node's.
   */
  addSvg(markup: string, options: { mask?: boolean } = {}): number {
    return this.#put({ kind: 'svg', markup, mask: options.mask ?? false });
  }

  /** The slot an image record uses to draw `id` fitted by `fit`. */
  slot(id: number, fit: ImageFit): number {
    if (!this.#images.has(id)) {
      throw new RangeError(`Unknown image ${id}`);
    }
    return IMAGE_BASE + id * 4 + fit;
  }

  /** Forgets `id`; records that still name it draw nothing. */
  remove(id: number): void {
    this.#images.delete(id);
  }

  /** @internal */
  get(slot: number): { image: LibraryImage; id: number; fit: ImageFit } | undefined {
    const code = slot - IMAGE_BASE;
    const id = Math.floor(code / 4);
    const image = this.#images.get(id);
    return image && { image, id, fit: (code % 4) as ImageFit };
  }

  /** @internal */
  rasterize(markup: string, width: number, height: number): ImageResource {
    return this.#rasterize(markup, width, height);
  }

  #put(image: LibraryImage): number {
    const id = this.#next++;
    if (IMAGE_BASE + id * 4 + 3 >= 1 << 24) {
      throw new RangeError('Too many images');
    }
    this.#images.set(id, image);
    return id;
  }
}
