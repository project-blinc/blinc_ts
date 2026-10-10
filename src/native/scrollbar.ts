/**
 * What a scroll container's thumb shows, and when. The engine draws a thumb
 * from a colour; this decides that colour's alpha as the container is
 * scrolled and hovered: always there, there while scrolling and a moment
 * after, there while the pointer is over the container, or never.
 */

export type ScrollbarVisibility = 'always' | 'auto' | 'hover' | 'hidden';

export type Thumb = readonly [red: number, green: number, blue: number, alpha: number];

/** The thumb's colour where no `scrollbar-color` gives one: a mid grey that shows on light and dark. */
export const DEFAULT_THUMB: Thumb = [0.5, 0.5, 0.5, 0.5];

/** How long an `auto` thumb stays after the last scroll, and how long it takes to fade, in milliseconds. */
export const THUMB_LINGER = 900;
export const THUMB_FADE = 250;
const FADE_STEP = 16;

/** The thumb of one scroll container. */
export class ScrollThumb {
  readonly #show: (thumb: Thumb) => void;
  #color: Thumb = DEFAULT_THUMB;
  #visibility: ScrollbarVisibility = 'always';
  #none = false;
  #hover = false;
  #lingering = false;
  #alpha = 1;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #fade: ReturnType<typeof setTimeout> | undefined;

  /** `show` is given the thumb's colour, its alpha included, whenever it changes. */
  constructor(show: (thumb: Thumb) => void) {
    this.#show = show;
    this.#alpha = this.#target();
  }

  /** The thumb as drawn now. */
  get current(): Thumb {
    const [r, g, b, a] = this.#color;
    return [r, g, b, a * this.#alpha];
  }

  /** The cascade's `scrollbar-color` (the thumb's, or none), `scrollbar-width: none` and `scrollbar-visibility`. */
  restyle(color: Thumb | null, none: boolean, visibility: ScrollbarVisibility): void {
    this.#color = color ?? DEFAULT_THUMB;
    this.#none = none;
    this.#visibility = visibility;
    this.#settle(true);
  }

  /** The container scrolled. */
  scrolled(): void {
    if (this.#visibility !== 'auto' || this.#none) {
      return;
    }
    this.#lingering = true;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#lingering = false;
      this.#settle(false);
    }, THUMB_LINGER);
    this.#timer.unref();
    this.#settle(false);
  }

  /** The pointer went over the container, or left it. */
  hovered(on: boolean): void {
    if (on !== this.#hover) {
      this.#hover = on;
      this.#settle(false);
    }
  }

  dispose(): void {
    clearTimeout(this.#timer);
    clearTimeout(this.#fade);
  }

  #target(): number {
    if (this.#none || this.#visibility === 'hidden') {
      return 0;
    }
    switch (this.#visibility) {
      case 'always':
        return 1;
      case 'auto':
        return this.#lingering ? 1 : 0;
      case 'hover':
        return this.#hover ? 1 : 0;
    }
  }

  /** Move toward what it should show: at once up, or when `at once`, and fading down. */
  #settle(atOnce: boolean): void {
    const target = this.#target();
    clearTimeout(this.#fade);
    if (target >= this.#alpha || atOnce) {
      this.#alpha = target;
      this.#show(this.current);
      return;
    }
    const from = this.#alpha;
    const start = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / THUMB_FADE);
      this.#alpha = Math.max(this.#target(), from * (1 - t));
      this.#show(this.current);
      if (t < 1 && this.#alpha > this.#target()) {
        this.#fade = setTimeout(step, FADE_STEP);
        this.#fade.unref();
      }
    };
    step();
  }
}

/** The space-separated parts of a value, a function's arguments kept with its name. */
export function words(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = -1;
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
    }
    if (/\s/.test(c) && depth === 0) {
      if (from >= 0) {
        out.push(value.slice(from, i));
        from = -1;
      }
    } else if (from < 0) {
      from = i;
    }
  }
  if (from >= 0) {
    out.push(value.slice(from));
  }
  return out;
}
