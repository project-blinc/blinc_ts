/** An owned face decoded by the shared native font engine. */
import type { Scope } from '../hmr.js';

/** @internal */
export interface NativeFont {
  family(weight: number): string;
  dispose(): void;
}

export class FontResource {
  readonly #native: NativeFont;
  #disposed = false;
  /** @internal */
  constructor(native: NativeFont, scope?: Scope) {
    this.#native = native;
    scope?.onCleanup(() => this.dispose());
  }
  /** A private family name for measuring/drawing this face at a variable weight. */
  family(weight = 400): string {
    if (this.#disposed) {
      throw new Error('Font disposed');
    }
    if (!Number.isInteger(weight) || weight < 1 || weight > 1000) {
      throw new RangeError('Font weight must be 1..1000');
    }
    return this.#native.family(weight);
  }
  dispose(): void {
    if (!this.#disposed) {
      this.#disposed = true;
      this.#native.dispose();
    }
  }
}
