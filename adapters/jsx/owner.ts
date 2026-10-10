/**
 * Who owns what a view makes: effects, signals and cleanups belong to the owner running when they
 * are made, and end with it. A mounted view is one owner; each region that rebuilds (a `Show`, a
 * `For` item, a function child) has its own, disposed when it rebuilds or its parent ends.
 */
import { Computed, Signal, type ReactiveContext } from 'blinc_ts/native';
import { Scope } from 'blinc_ts/hmr';

export class Owner {
  readonly context: ReactiveContext | null;
  readonly scope = new Scope();
  readonly parent: Owner | null;
  #values: Map<symbol, unknown> | undefined;

  /**
   * With `attached`, ending the parent ends this. A region that makes an owner at each rebuild
   * ends the last itself, so it leaves them unattached rather than leave a cleanup per rebuild.
   */
  constructor(context: ReactiveContext | null, parent: Owner | null = null, attached = true) {
    this.context = context;
    this.parent = parent;
    if (attached) {
      parent?.scope.onCleanup(() => this.dispose());
    }
  }

  /** The reactive context, or the error a view built without one deserves. */
  reactive(): ReactiveContext {
    if (!this.context) {
      throw new TypeError(
        'A reactive value needs a reactive context: mount the view with mount(), not render()',
      );
    }
    return this.context;
  }

  /** Give `id` the value `value` for this owner and everything under it. */
  provide(id: symbol, value: unknown): void {
    (this.#values ??= new Map()).set(id, value);
  }

  /** The value `id` has here, from the nearest owner that provides it. */
  lookup(id: symbol): { value: unknown } | undefined {
    for (let owner: Owner | null = this; owner; owner = owner.parent) {
      if (owner.#values?.has(id)) {
        return { value: owner.#values.get(id) };
      }
    }
    return undefined;
  }

  dispose(): void {
    this.scope.dispose();
  }
}

let current: Owner | null = null;

/** The owner running now: whatever a view makes belongs to it. */
export function getOwner(): Owner | null {
  return current;
}

/** Run `run` with `owner` as the owner, and put the previous one back after. */
export function runWithOwner<T>(owner: Owner | null, run: () => T): T {
  const previous = current;
  current = owner;
  try {
    return run();
  } finally {
    current = previous;
  }
}

function owner(what: string): Owner {
  if (!current) {
    throw new Error(`${what} is for a view being built: call it in a component or an effect`);
  }
  return current;
}

/** Run `cleanup` when the current owner ends or rebuilds. */
export function onCleanup(cleanup: () => void): void {
  owner('onCleanup').scope.onCleanup(cleanup);
}

/** A value a view can depend on, a signal, a computed value, or a function of them. */
export type Source<T> = T | Signal<T> | Computed<T> | (() => T);

/** Whether `value` is read to find the current value, rather than being it. */
export function isSource(
  value: unknown,
): value is Signal<unknown> | Computed<unknown> | (() => unknown) {
  return value instanceof Signal || value instanceof Computed || typeof value === 'function';
}

/** `source`'s value now; inside an effect, the dependency is noted. */
export function read<T>(source: Source<T>): T {
  if (source instanceof Signal || source instanceof Computed) {
    return source.get() as T;
  }
  return typeof source === 'function' ? (source as () => T)() : source;
}

/** A signal that ends with the current owner. */
export function signal<T>(value: T): Signal<T> {
  const o = owner('signal');
  return o.reactive().signal(value, o.scope);
}

/** A value computed from signals, which ends with the current owner. */
export function computed<T>(compute: () => T): Computed<T> {
  const o = owner('computed');
  return o.reactive().computed(compute, o.scope);
}

/** Run `run` now and again whenever what it read changes; what it returns runs before each rerun and at the end. */
export function effect(run: () => void | (() => void)): void {
  const o = owner('effect');
  o.reactive().effect((scope) => {
    const cleanup = runWithOwner(o, run);
    if (typeof cleanup === 'function') {
      scope.onCleanup(cleanup);
    }
  }, o.scope);
}

/**
 * A signal that follows `compute`, and tells what reads it only when its value changes: a
 * computed value has no such cutoff, so what depends on one reruns when it is recomputed.
 */
export function memoOf<T>(of: Owner, compute: () => T): Signal<T> {
  const context = of.reactive();
  const value = context.signal(context.untrack(compute), of.scope);
  context.effect(() => value.set(compute()), of.scope);
  return value;
}

export function memo<T>(compute: () => T): Signal<T> {
  return memoOf(owner('memo'), compute);
}

/** Group writes so what depends on them runs once, after. */
export function batch<T>(run: () => T): T {
  return owner('batch').reactive().batch(run);
}

/** Read without depending on what is read. */
export function untrack<T>(run: () => T): T {
  return owner('untrack').reactive().untrack(run);
}

/** A value a view provides to what is under it, and what asks for it. */
export interface Context<T> {
  readonly id: symbol;
  readonly defaultValue: T | undefined;
}

/** The value of `context` from the nearest `Provider` above, else its default. */
export function useContext<T>(context: Context<T>): T {
  const found = owner('useContext').lookup(context.id);
  if (found) {
    return found.value as T;
  }
  if (context.defaultValue === undefined) {
    throw new Error('useContext: nothing provides this context and it has no default');
  }
  return context.defaultValue;
}
