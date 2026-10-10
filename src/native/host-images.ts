/**
 * The images a host has loaded, one per source however many elements name it, kept in the
 * library its renderer draws from. A source loads when first named and is let go when the last
 * to name it lets go; one that cannot be loaded or decoded is an error, which says why.
 */
import type { ImageResource } from './image.js';
import { ImageLibrary } from './image-library.js';
import { defaultImageLoader, isSvg, svgSize, type ImageLoader } from './image-source.js';
import type { NativeBindings } from './index.js';

/** What is known of a source. It changes once, from loading to loaded or to an error. */
export interface ImageEntry {
  readonly source: string;
  status: 'loading' | 'loaded' | 'error';
  /** Its id in the library, once loaded. */
  id: number;
  /** Its size in pixels, or for an SVG what it says its size is. */
  width: number;
  height: number;
  svg: boolean;
  error?: string;
}

interface Slot {
  readonly entry: ImageEntry;
  resource?: ImageResource;
  users: number;
  readonly waiters: Set<() => void>;
}

export class HostImages {
  readonly library: ImageLibrary;
  /** Where a relative path is from, by default the working directory. */
  base: string = process.cwd();
  /** Loads a source; replace it to read from somewhere else. */
  loader: ImageLoader = (source) => defaultImageLoader(this.base)(source);
  readonly #native: NativeBindings;
  readonly #slots = new Map<string, Slot>();

  constructor(native: NativeBindings) {
    this.#native = native;
    this.library = new ImageLibrary((markup, width, height) =>
      native.rasterizeSvg(markup, width, height),
    );
  }

  /**
   * Name `source`, loading it unless it is loaded or loading; `settled` runs once it is one or
   * the other (at once, in a microtask, if it already is). Release the name when done with it.
   */
  use(source: string, settled: () => void): { entry: ImageEntry; release(): void } {
    let slot = this.#slots.get(source);
    if (!slot) {
      slot = {
        entry: { source, status: 'loading', id: -1, width: 0, height: 0, svg: false },
        users: 0,
        waiters: new Set(),
      };
      this.#slots.set(source, slot);
      void this.#load(slot);
    }
    slot.users++;
    const taken = slot;
    if (taken.entry.status === 'loading') {
      taken.waiters.add(settled);
    } else {
      queueMicrotask(settled);
    }
    let released = false;
    return {
      entry: taken.entry,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        taken.waiters.delete(settled);
        if (--taken.users === 0) {
          this.#drop(taken);
        }
      },
    };
  }

  async #load(slot: Slot): Promise<void> {
    const { entry } = slot;
    try {
      const loaded = await this.loader(entry.source);
      if (slot.users === 0) {
        return;
      }
      if (isSvg(loaded, entry.source)) {
        const markup = new TextDecoder().decode(loaded.bytes);
        ({ width: entry.width, height: entry.height } = svgSize(markup));
        entry.id = this.library.addSvg(markup);
        entry.svg = true;
      } else {
        const resource = this.#native.decodeImage(loaded.bytes);
        slot.resource = resource;
        entry.width = resource.width;
        entry.height = resource.height;
        entry.id = this.library.add(resource);
      }
      entry.status = 'loaded';
    } catch (error) {
      entry.status = 'error';
      entry.error = error instanceof Error ? error.message : String(error);
    }
    const waiters = [...slot.waiters];
    slot.waiters.clear();
    for (const settled of waiters) {
      settled();
    }
  }

  #drop(slot: Slot): void {
    this.#slots.delete(slot.entry.source);
    if (slot.entry.id >= 0) {
      this.library.remove(slot.entry.id);
    }
    slot.resource?.dispose();
  }

  /** Let every image go. */
  dispose(): void {
    for (const slot of [...this.#slots.values()]) {
      slot.users = 0;
      this.#drop(slot);
    }
  }
}
