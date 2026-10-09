/**
 * Events on host nodes, after the DOM's EventTarget: listeners per type,
 * capture, target and bubble phases, `stopPropagation`,
 * `stopImmediatePropagation` and `preventDefault`. The dispatch here is the
 * seam the full input model (pointer capture, enter and leave, focus,
 * keyboard) builds on.
 */

export const EventPhase = Object.freeze({ None: 0, Capturing: 1, AtTarget: 2, Bubbling: 3 });
export type EventPhase = (typeof EventPhase)[keyof typeof EventPhase];

export interface HostEventInit {
  bubbles?: boolean;
  cancelable?: boolean;
}

export class HostEvent {
  readonly type: string;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  readonly timeStamp = performance.now();
  #target: HostEventTarget | null = null;
  #currentTarget: HostEventTarget | null = null;
  #phase: EventPhase = EventPhase.None;
  #stopped = false;
  #stoppedNow = false;
  #prevented = false;
  #passive = false;

  constructor(type: string, init: HostEventInit = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
    this.cancelable = init.cancelable ?? false;
  }
  /** Where the event was dispatched. */
  get target(): HostEventTarget | null {
    return this.#target;
  }
  /** The node whose listener is running. */
  get currentTarget(): HostEventTarget | null {
    return this.#currentTarget;
  }
  get eventPhase(): EventPhase {
    return this.#phase;
  }
  get defaultPrevented(): boolean {
    return this.#prevented;
  }
  get propagationStopped(): boolean {
    return this.#stopped;
  }
  /** Hands the event to no further node; the current node's other listeners still run. */
  stopPropagation(): void {
    this.#stopped = true;
  }
  /** Runs no further listener, on this node or any other. */
  stopImmediatePropagation(): void {
    this.#stopped = true;
    this.#stoppedNow = true;
  }
  /** Cancels what follows the listeners; ignored for passive listeners and uncancelable events. */
  preventDefault(): void {
    if (this.cancelable && !this.#passive) {
      this.#prevented = true;
    }
  }

  /** @internal */
  static dispatch(event: HostEvent, target: HostEventTarget): boolean {
    if (event.#phase !== EventPhase.None) {
      throw new Error('Event is already being dispatched');
    }
    const path: HostEventTarget[] = [];
    for (let node = target.eventParent; node; node = node.eventParent) {
      path.push(node);
    }
    event.#target = target;
    try {
      event.#phase = EventPhase.Capturing;
      for (let i = path.length - 1; i >= 0 && !event.#stopped; i--) {
        event.#invoke(path[i]!, true);
      }
      if (!event.#stopped) {
        event.#phase = EventPhase.AtTarget;
        event.#invoke(target, true);
        if (!event.#stoppedNow) {
          event.#invoke(target, false);
        }
      }
      if (event.bubbles) {
        event.#phase = EventPhase.Bubbling;
        for (let i = 0; i < path.length && !event.#stopped; i++) {
          event.#invoke(path[i]!, false);
        }
      }
    } finally {
      event.#phase = EventPhase.None;
      event.#currentTarget = null;
    }
    return !event.#prevented;
  }

  #invoke(node: HostEventTarget, capture: boolean): void {
    const listeners = node.listenersFor(this.type, capture);
    if (!listeners) {
      return;
    }
    this.#currentTarget = node;
    let errors: unknown[] | undefined;
    // A copy, so listeners added during dispatch wait for the next event.
    for (const entry of [...listeners]) {
      if (this.#stoppedNow) {
        break;
      }
      if (entry.removed) {
        continue;
      }
      if (entry.once) {
        node.removeEventListener(this.type, entry.listener, { capture });
      }
      this.#passive = entry.passive;
      try {
        if (typeof entry.listener === 'function') {
          entry.listener.call(node, this);
        } else {
          entry.listener.handleEvent(this);
        }
      } catch (error) {
        (errors ??= []).push(error);
      } finally {
        this.#passive = false;
      }
    }
    if (errors) {
      throw new AggregateError(errors, `${this.type} listener failed`);
    }
  }
}

/** A pointer event, in layout units relative to the root. */
export interface HostPointerEventInit extends HostEventInit {
  x: number;
  y: number;
  /** 0 primary, 1 auxiliary (middle), 2 secondary; -1 when no button changed. */
  button?: number;
  /** Bit mask of held buttons: 1 primary, 2 secondary, 4 auxiliary. */
  buttons?: number;
  deltaX?: number;
  deltaY?: number;
  detail?: number;
}
export class HostPointerEvent extends HostEvent {
  readonly x: number;
  readonly y: number;
  readonly button: number;
  readonly buttons: number;
  readonly deltaX: number;
  readonly deltaY: number;
  /** For click, the number of quick presses at about the same place. */
  readonly detail: number;
  constructor(type: string, init: HostPointerEventInit) {
    super(type, { bubbles: init.bubbles ?? true, cancelable: init.cancelable ?? true });
    this.x = init.x;
    this.y = init.y;
    this.button = init.button ?? -1;
    this.buttons = init.buttons ?? 0;
    this.deltaX = init.deltaX ?? 0;
    this.deltaY = init.deltaY ?? 0;
    this.detail = init.detail ?? 0;
  }
}

export type HostEventListener<E extends HostEvent = HostEvent> =
  ((event: E) => void) | { handleEvent(event: E): void };
export interface ListenerOptions {
  capture?: boolean;
  once?: boolean;
  /** A passive listener cannot cancel the event. */
  passive?: boolean;
  signal?: AbortSignal;
}
/** @internal */
export interface ListenerEntry {
  listener: HostEventListener;
  capture: boolean;
  once: boolean;
  passive: boolean;
  removed: boolean;
}

/** Listener storage per event type, as the DOM keeps it: one entry per listener and phase. */
export abstract class HostEventTarget {
  #listeners: Map<string, ListenerEntry[]> | undefined;

  /** The node an event goes to after this one; null at the root. */
  abstract get eventParent(): HostEventTarget | null;

  addEventListener(
    type: string,
    listener: HostEventListener | null,
    options: boolean | ListenerOptions = {},
  ): void {
    if (!listener) {
      return;
    }
    const opts = typeof options === 'boolean' ? { capture: options } : options;
    if (opts.signal?.aborted) {
      return;
    }
    const capture = opts.capture ?? false;
    const list = ((this.#listeners ??= new Map()).get(type) ?? []) as ListenerEntry[];
    if (list.some((entry) => entry.listener === listener && entry.capture === capture)) {
      return;
    }
    list.push({
      listener,
      capture,
      once: opts.once ?? false,
      passive: opts.passive ?? false,
      removed: false,
    });
    this.#listeners.set(type, list);
    opts.signal?.addEventListener('abort', () =>
      this.removeEventListener(type, listener, { capture }),
    );
  }

  removeEventListener(
    type: string,
    listener: HostEventListener | null,
    options: boolean | { capture?: boolean } = {},
  ): void {
    const capture = typeof options === 'boolean' ? options : (options.capture ?? false);
    const list = this.#listeners?.get(type);
    const index =
      list?.findIndex((entry) => entry.listener === listener && entry.capture === capture) ?? -1;
    if (index < 0) {
      return;
    }
    const [entry] = list!.splice(index, 1);
    entry!.removed = true;
    if (list!.length === 0) {
      this.#listeners!.delete(type);
    }
  }

  /** Whether any listener for `type` is registered here. */
  hasEventListener(type: string): boolean {
    return this.#listeners?.has(type) ?? false;
  }

  /** Dispatch through the capture, target and bubble phases; false if a listener cancelled it. */
  dispatchEvent(event: HostEvent): boolean {
    return HostEvent.dispatch(event, this);
  }

  /** @internal */
  listenersFor(type: string, capture: boolean): ListenerEntry[] | undefined {
    const list = this.#listeners?.get(type)?.filter((entry) => entry.capture === capture);
    return list?.length ? list : undefined;
  }

  /** @internal Drop every listener, for a removed node. */
  clearListeners(): void {
    this.#listeners = undefined;
  }
}
