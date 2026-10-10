/**
 * A layer above the app for what floats over it, as HTML's top layer: a
 * popover, a menu, a select's list, a tooltip, a modal dialog. An entry is
 * placed last under the host's root, absolutely positioned in its
 * coordinates, so it is drawn over the rest, hit first, and clipped by no
 * element.
 *
 * Beside the content is a `backdrop` element as large as the root: clear, or
 * dimmed for a modal. A press on it, outside the content, closes a
 * dismissible entry, as does Escape. An entry anchored to an element is
 * placed against it after each layout, so it follows the content's size and
 * the anchor's place, and its side is on `data-side` for a stylesheet.
 */
import type { Host, HostElement } from './host.js';
import { HostKeyboardEvent } from './input.js';
import { boxOf, place, type Placed, type Placement, type Size } from './placement.js';

export interface TopLayerOptions {
  /** Where the content goes; centred by default. */
  placement?: Placement;
  /** Dim what is beneath, keep Tab inside the content and move focus into it. */
  modal?: boolean;
  /** The backdrop's CSS colour, over the sheet's dimming for a modal and clear otherwise. */
  backdrop?: string;
  /** A press outside, or Escape, closes it; true by default. A control of its own closes it otherwise. */
  dismissible?: boolean;
  /** No backdrop: the page beneath keeps its presses and pointer while the content takes its own. A hover card. */
  modeless?: boolean;
  /** It takes no presses at all, which reach what is beneath. A tooltip. */
  passThrough?: boolean;
  /** Move focus into the content as it opens; true for a modal. */
  focus?: boolean;
  /** Give focus back to what had it, as it closes; true by default. */
  restoreFocus?: boolean;
  /** Runs as it begins to close, however it is closed. */
  onClose?: () => void;
}

const within = (element: HostElement | null, ancestor: HostElement): boolean => {
  for (let node: HostElement | null = element; node; node = node.parentNode) {
    if (node === ancestor) {
      return true;
    }
  }
  return false;
};

/** What placing an entry reads. */
export interface Plan {
  minWidth: number | null;
  spot: Placed | null;
}

export class TopLayerEntry {
  readonly content: HostElement;
  readonly options: Readonly<TopLayerOptions>;
  readonly #stack: TopLayer;
  readonly #layer: HostElement;
  readonly #backdrop: HostElement;
  readonly #holder: HostElement;
  readonly #released: (() => void)[] = [];
  readonly #returnTo: HostElement | null;
  #placed: Placed | null = null;
  #open = true;
  #closed: Promise<void> | undefined;

  /** @internal Use `TopLayer.open`. */
  constructor(
    stack: TopLayer,
    content: HostElement,
    layer: HostElement,
    backdrop: HostElement,
    holder: HostElement,
    options: TopLayerOptions,
    returnTo: HostElement | null,
  ) {
    this.#stack = stack;
    this.content = content;
    this.#layer = layer;
    this.#backdrop = backdrop;
    this.#holder = holder;
    this.options = options;
    this.#returnTo = returnTo;
  }

  get isOpen(): boolean {
    return this.#open;
  }

  /** Where the content was last placed against its anchor; none for centred and edge placements. */
  get placed(): Placed | null {
    return this.#placed;
  }

  /** @internal */
  get layer(): HostElement {
    return this.#layer;
  }

  /** @internal Release hooks for when it closes. */
  onClosing(release: () => void): void {
    this.#released.push(release);
  }

  /**
   * Where an anchored entry goes for the content's size and the anchor's
   * place now. Reads only: every entry is read before any is moved, since a
   * move makes the bounds unreadable until layout runs again.
   */
  plan(viewport: Size): Plan | null {
    const p = this.options.placement;
    if (!this.#open || !p || this.content.destroyed) {
      return null;
    }
    // At least as wide as its anchor, the content stretched to it.
    const minWidth = p.kind === 'below' ? Math.round(boxOf(p.anchor).width * 100) / 100 : null;
    const [, , width = 0, height = 0] = this.content.bounds();
    return { minWidth, spot: place(p, { width, height }, viewport) };
  }

  /** Put the content where `plan` says. True when that moved it, so layout runs again. */
  apply(plan: Plan): boolean {
    let moved = false;
    if (plan.minWidth !== null && plan.minWidth !== this.#minWidth) {
      this.#minWidth = plan.minWidth;
      this.#holder.setProperty('min-width', plan.minWidth);
      moved = true;
    }
    const spot = plan.spot;
    if (!spot) {
      return moved;
    }
    const before = this.#placed;
    if (
      before &&
      Math.abs(before.left - spot.left) < 0.5 &&
      Math.abs(before.top - spot.top) < 0.5
    ) {
      return moved;
    }
    this.#placed = spot;
    this.#holder.setProperty('left', spot.left);
    this.#holder.setProperty('top', spot.top);
    if (spot.side && this.content.getAttribute('data-side') !== spot.side) {
      this.content.setAttribute('data-side', spot.side);
    }
    return true;
  }
  #minWidth = -1;

  /**
   * Close it: focus returns, `closing` goes on the backdrop and the content
   * so a stylesheet can animate them away, and presses pass through while
   * they play. Resolves once they have and the entry is gone; the content
   * is kept, to open again.
   */
  close(): Promise<void> {
    if (this.#closed) {
      return this.#closed;
    }
    this.#open = false;
    this.#stack.forget(this);
    for (const release of this.#released) {
      release();
    }
    const input = this.content.host.input;
    const focused = input.focused;
    if (
      this.options.restoreFocus !== false &&
      this.#returnTo &&
      !this.#returnTo.destroyed &&
      (focused === null || within(focused, this.content))
    ) {
      input.focus(this.#returnTo, false);
    }
    this.options.onClose?.();
    const marked = [this.#backdrop, this.content];
    for (const element of marked) {
      element.setAttribute('closing', '');
    }
    this.#layer.setProperty('pointer-events', 'none');
    this.#closed = Promise.all(marked.map((element) => element.animationsFinished())).then(() => {
      // The host may have gone while they played.
      if (this.content.host.layout.disposed) {
        return;
      }
      for (const element of marked) {
        if (!element.destroyed) {
          element.removeAttribute('closing');
        }
      }
      // Opened again meanwhile, it is in another holder by now.
      if (!this.content.destroyed && this.content.parentNode === this.#holder) {
        this.#holder.removeChild(this.content);
      }
      if (!this.#layer.destroyed) {
        this.#layer.destroy();
      }
    });
    return this.#closed;
  }
}

export class TopLayer {
  static readonly #stacks = new WeakMap<Host, TopLayer>();
  readonly host: Host;
  readonly #entries: TopLayerEntry[] = [];

  private constructor(host: Host) {
    this.host = host;
    // An anchored entry follows its content's size and its anchor, before the frame is drawn.
    const release = host.layout.onLaidOut(() => {
      if (this.#entries.length === 0) {
        return false;
      }
      const [, , width = 0, height = 0] = host.root.bounds();
      const plans: [TopLayerEntry, Plan][] = [];
      for (const entry of this.#entries) {
        const plan = entry.plan({ width, height });
        if (plan) {
          plans.push([entry, plan]);
        }
      }
      let moved = false;
      for (const [entry, plan] of plans) {
        moved = entry.apply(plan) || moved;
      }
      return moved;
    });
    host.layout.onChange((change) => {
      if (change === 'disposed') {
        release();
      }
    });
    // Escape closes the topmost entry, unless something inside took it. One that cannot be
    // closed that way keeps it from those beneath.
    host.root.addEventListener('keydown', (event) => {
      if (
        !(event instanceof HostKeyboardEvent) ||
        event.key !== 'Escape' ||
        event.defaultPrevented
      ) {
        return;
      }
      const top = this.#entries.at(-1);
      if (top && top.options.dismissible !== false) {
        event.preventDefault();
        void top.close();
      }
    });
  }

  /** The top layer of `host`. */
  static of(host: Host): TopLayer {
    let stack = TopLayer.#stacks.get(host);
    if (!stack) {
      stack = new TopLayer(host);
      TopLayer.#stacks.set(host, stack);
    }
    return stack;
  }

  /** The open entries, the topmost last. */
  get entries(): readonly TopLayerEntry[] {
    return [...this.#entries];
  }

  /** @internal */
  forget(entry: TopLayerEntry): void {
    const at = this.#entries.indexOf(entry);
    if (at >= 0) {
      this.#entries.splice(at, 1);
    }
  }

  /**
   * Open `content` above the rest of the host, placed by `options.placement`.
   * Laid out first, so there is a root to be placed in.
   */
  open(content: HostElement, options: TopLayerOptions = {}): TopLayerEntry {
    const host = this.host;
    if (this.#entries.some((entry) => entry.content === content)) {
      throw new Error('That element is already open in the top layer');
    }
    const p = options.placement;
    const modeless = options.modeless === true;
    const size = modeless ? 'width: 0; height: 0;' : 'width: 100%; height: 100%;';
    const layer = host.createElement('div');
    layer.setAttribute(
      'style',
      `position: absolute; left: 0; top: 0; ${size} flex-direction: row; align-items: center; justify-content: center;`,
    );
    const backdrop = host.createElement('backdrop');
    const colour =
      options.backdrop ?? (options.modal === true && !modeless ? undefined : 'transparent');
    backdrop.setAttribute(
      'style',
      `position: absolute; left: 0; top: 0; ${size}${colour ? ` background: ${colour};` : ''}`,
    );
    const holder = host.createElement('div');
    holder.setAttribute('style', holderStyle(p));
    layer.appendChild(backdrop);
    layer.appendChild(holder);
    content.removeAttribute('closing');
    holder.appendChild(content);
    host.root.appendChild(layer);
    if (options.passThrough) {
      layer.setProperty('pointer-events', 'none');
    }
    const returnTo = host.input.focused;
    const entry = new TopLayerEntry(this, content, layer, backdrop, holder, options, returnTo);
    this.#entries.push(entry);
    layer.addEventListener('pointerdown', (event) => {
      // A press on the backdrop itself, not on what it holds.
      if ((event.target === layer || event.target === backdrop) && options.dismissible !== false) {
        event.preventDefault();
        void entry.close();
      }
    });
    if (options.modal) {
      entry.onClosing(host.input.trapFocus(content));
    }
    // Laid out now, which places it for the size its content has.
    host.root.bounds();
    if (options.focus ?? options.modal) {
      host.input.moveFocus();
      if (!within(host.input.focused, content) && host.input.isFocusable(content)) {
        host.input.focus(content, false);
      }
    }
    return entry;
  }
}

/** The holder's own style: where layout puts it, for what the placement leaves to layout. */
function holderStyle(p: Placement | undefined): string {
  switch (p?.kind) {
    case undefined:
    case 'center':
      return '';
    case 'below':
      return 'position: absolute; left: 0; top: 0; flex-direction: column; align-items: stretch;';
    case 'beside':
    case 'at':
      return 'position: absolute; left: 0; top: 0;';
    case 'edge': {
      const row = p.side === 'left' || p.side === 'right';
      const pins =
        p.side === 'left'
          ? 'left: 0; top: 0; bottom: 0;'
          : p.side === 'right'
            ? 'right: 0; top: 0; bottom: 0;'
            : p.side === 'top'
              ? 'left: 0; right: 0; top: 0;'
              : 'left: 0; right: 0; bottom: 0;';
      return `position: absolute; ${pins} flex-direction: ${row ? 'row' : 'column'}; align-items: stretch;`;
    }
  }
}
