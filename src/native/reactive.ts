import { Scope } from '../hmr.js';

export interface Disposable {
  dispose(): void;
}
export interface GraphStats {
  signals: number;
  computeds: number;
  effects: number;
}
/** @internal */
export interface NativeSignal extends Disposable {
  track(): void;
  peek(): void;
  notify(): void;
}
/** @internal */
export interface NativeComputed extends Disposable {
  track(): void;
}
/** @internal */
export interface NativeGraph extends Disposable {
  readonly disposed: boolean;
  signal(): NativeSignal;
  computed(callback: () => void): NativeComputed;
  effect(callback: () => void): Disposable;
  beginBatch(): void;
  endBatch(): void;
  stats(): GraphStats;
}
interface Evaluation {
  context: ReactiveContext;
  computed: boolean;
  tracking: boolean;
  scope?: Scope;
}
let active: Evaluation | undefined;

/** JavaScript values retain identity; Blinc owns dependency tracking and scheduling. */
export class ReactiveContext implements Disposable {
  readonly #native: NativeGraph;
  readonly #owned = new Set<Disposable>();
  #disposed = false;
  /** @internal Use loadNative().createReactive(scope). */
  constructor(native: NativeGraph, scope?: Scope) {
    this.#native = native;
    scope?.onCleanup(() => this.dispose());
  }
  get disposed(): boolean {
    return this.#disposed;
  }
  /** @internal */
  check(mutable = false): void {
    if (this.#disposed) {
      throw new Error('Reactive context is disposed');
    }
    if (active && active.context !== this) {
      throw new Error('Reactive dependencies cannot cross contexts');
    }
    if (mutable && active?.computed) {
      throw new Error('Cannot mutate reactive state from a computed callback');
    }
  }
  /** @internal */
  evaluate<T>(computed: boolean, run: () => T, scope?: Scope): T {
    this.check();
    const previous = active;
    active = {
      context: this,
      computed,
      tracking: previous?.tracking ?? true,
      ...(scope ? { scope } : {}),
    };
    try {
      return run();
    } finally {
      active = previous;
    }
  }
  /** @internal */
  own(resource: Disposable, scope?: Scope): void {
    this.#owned.add(resource);
    (scope ?? active?.scope)?.onCleanup(() => resource.dispose());
  }
  /** @internal */
  forget(resource: Disposable): void {
    this.#owned.delete(resource);
  }
  signal<T>(value: T, scope?: Scope): Signal<T> {
    this.check(true);
    const signal = new Signal(this, this.#native.signal(), value);
    this.own(signal, scope);
    return signal;
  }
  computed<T>(compute: () => T, scope?: Scope): Computed<T> {
    this.check(true);
    const value = new Computed(this, compute, (callback) => this.#native.computed(callback));
    this.own(value, scope);
    return value;
  }
  effect(run: (scope: Scope) => void, scope?: Scope): Disposable {
    this.check(true);
    let current: Scope | undefined;
    let disposed = false;
    let native: Disposable;
    try {
      native = this.#native.effect(() => {
        if (disposed || this.#disposed) {
          return;
        }
        this.untrack(() => current?.dispose());
        current = new Scope();
        try {
          this.evaluate(false, () => run(current!), current);
        } catch (error) {
          this.untrack(() => current?.dispose());
          throw error;
        }
      });
    } catch (error) {
      this.untrack(() => current?.dispose());
      throw error;
    }
    const effect: Disposable = {
      dispose: () => {
        if (disposed) {
          return;
        }
        if (!this.#disposed) {
          this.check(true);
        }
        disposed = true;
        this.forget(effect);
        try {
          native.dispose();
        } finally {
          // Cleanup remains valid while the context itself is being disposed.
          const previous = active;
          active = { context: this, computed: false, tracking: false };
          try {
            current?.dispose();
          } finally {
            active = previous;
          }
        }
      },
    };
    this.own(effect, scope);
    return effect;
  }
  batch<T>(run: () => T): T {
    this.check(true);
    this.#native.beginBatch();
    let result: T | undefined;
    let failed = false;
    let failure: unknown;
    try {
      result = run();
    } catch (error) {
      failed = true;
      failure = error;
    }
    try {
      if (!this.#disposed) {
        this.#native.endBatch();
      }
    } catch (error) {
      if (failed) {
        throw new AggregateError([failure, error], 'Batch and effects failed', { cause: error });
      }
      throw error;
    }
    if (failed) {
      throw failure;
    }
    return result as T;
  }
  /** Read current values without subscribing the surrounding computation. */
  untrack<T>(run: () => T): T {
    this.check();
    const previous = active;
    active = {
      context: this,
      computed: previous?.computed ?? false,
      tracking: false,
      ...(previous?.scope ? { scope: previous.scope } : {}),
    };
    try {
      return run();
    } finally {
      active = previous;
    }
  }
  stats(): GraphStats {
    this.check();
    return this.#native.stats();
  }
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.check(true);
    this.#disposed = true;
    const errors: unknown[] = [];
    for (const resource of [...this.#owned].reverse()) {
      try {
        resource.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    this.#owned.clear();
    this.#native.dispose();
    if (errors.length) {
      throw new AggregateError(errors, 'Reactive cleanup failed');
    }
  }
}

export class Signal<T> implements Disposable {
  readonly #context: ReactiveContext;
  readonly #native: NativeSignal;
  #value: T | undefined;
  #disposed = false;
  /** @internal */
  constructor(context: ReactiveContext, native: NativeSignal, value: T) {
    this.#context = context;
    this.#native = native;
    this.#value = value;
  }
  #check(mutable = false): void {
    this.#context.check(mutable);
    if (this.#disposed) {
      throw new Error('Signal is disposed');
    }
  }
  get(): T {
    this.#check();
    if (active?.tracking === false) {
      this.#native.peek();
    } else {
      this.#native.track();
    }
    return this.#value as T;
  }
  peek(): T {
    this.#check();
    this.#native.peek();
    return this.#value as T;
  }
  set(value: T): void {
    this.#check(true);
    if (Object.is(this.#value, value)) {
      return;
    }
    this.#value = value;
    this.#native.notify();
  }
  update(update: (value: T) => T): void {
    this.set(update(this.peek()));
  }
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    if (!this.#context.disposed) {
      this.#check(true);
    }
    this.#disposed = true;
    this.#value = undefined;
    this.#context.forget(this);
    this.#native.dispose();
  }
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
export class Computed<T> implements Disposable {
  readonly #context: ReactiveContext;
  readonly #native: NativeComputed;
  #compute: (() => T) | undefined;
  #outcome: Outcome<T> | undefined;
  #running = false;
  #disposed = false;
  /** @internal */
  constructor(
    context: ReactiveContext,
    compute: () => T,
    create: (run: () => void) => NativeComputed,
  ) {
    this.#context = context;
    this.#compute = compute;
    this.#native = create(() => {
      try {
        this.#outcome = { ok: true, value: this.#evaluate() };
      } catch (error) {
        this.#outcome = { ok: false, error };
      }
    });
  }
  #evaluate(): T {
    if (this.#running) {
      throw new Error('Computed dependency cycle');
    }
    this.#running = true;
    try {
      return this.#context.evaluate(true, () => this.#compute!());
    } finally {
      this.#running = false;
    }
  }
  get(): T {
    this.#context.check();
    if (this.#disposed) {
      throw new Error('Computed is disposed');
    }
    if (this.#running) {
      throw new Error('Computed dependency cycle');
    }
    // Untracked reads evaluate the pure callback without changing its native
    // cache or inheriting the dependencies of a cached native derived value.
    if (active?.tracking === false) {
      return this.#evaluate();
    }
    this.#native.track();
    const outcome = this.#outcome;
    if (!outcome) {
      throw new Error('Computed callback did not produce a result');
    }
    if (!outcome.ok) {
      throw outcome.error;
    }
    return outcome.value;
  }
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    if (!this.#context.disposed) {
      this.#context.check(true);
    }
    this.#disposed = true;
    this.#outcome = undefined;
    this.#compute = undefined;
    this.#context.forget(this);
    this.#native.dispose();
  }
}
