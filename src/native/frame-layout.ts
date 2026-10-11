import type { Layout, LayoutChange, LayoutNode } from './layout.js';

/**
 * What a window does with layout before it draws a frame: lay out when something changed or the
 * window did, tick motion, and lay out again for what motion moved.
 *
 * Edits queue until the layout flushes, and only a flush says layout changed. A window runs a
 * frame in the same turn as the input events it handles, so edits an event made are still queued
 * when the frame begins: flushing first is what lets the frame see them, and lay out before it
 * draws.
 */
export class FrameLayout {
  readonly #layout: Layout;
  readonly #root: LayoutNode;
  #needs = true;
  #width = -1;
  #height = -1;
  #scale = -1;

  constructor(layout: Layout, root: LayoutNode) {
    this.#layout = layout;
    this.#root = root;
  }

  /** The layout reported `change`: if it is one of geometry, the next frame lays out. */
  changed(change: LayoutChange): void {
    this.#needs ||= change === 'layout';
  }

  /**
   * Make the layout ready to draw at `width` by `height` pixels at `scale`, with motion advanced to
   * `now`. True while motion in view still needs frames.
   */
  prepare(width: number, height: number, scale: number, now: () => number): boolean {
    const layout = this.#layout;
    layout.flush();
    if (this.#needs || this.#width !== width || this.#height !== height || this.#scale !== scale) {
      // Clear before computing, so a change made during the frame survives for the next.
      this.#needs = false;
      layout.compute(this.#root, width / scale, height / scale);
      this.#width = width;
      this.#height = height;
      this.#scale = scale;
    }
    // After layout, which restyles and may have started a transition; before drawing, which shows it.
    const moving = layout.tickMotion(now());
    // A transitioned size or place reported a layout change: lay out what it moved.
    if (this.#needs) {
      this.#needs = false;
      layout.compute(this.#root, width / scale, height / scale);
    }
    return moving;
  }
}
