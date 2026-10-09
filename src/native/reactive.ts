import { Scope } from '../hmr.js';

export interface Disposable {
  dispose(): void;
}
export interface GraphStats {
  signals: number;
  computeds: number;
  effects: number;
}
/**
 * @internal Native graph items are named by generation-checked numeric keys;
 * computeds and effects name their callback by an id in the context's table,
 * which the native graph passes to the dispatcher given at construction.
 */
export interface NativeGraph {
  readonly disposed: boolean;
  signal(): number;
  computed(callback: number): number;
  effect(callback: number): number;
  track(signal: number): void;
  peek(signal: number): void;
  notify(signal: number): void;
  trackComputed(computed: number): void;
  release(key: number): void;
  beginBatch(): void;
  endBatch(): void;
  stats(): GraphStats;
  dispose(): void;
}
/** @internal */
export type NativeGraphFactory = (dispatch: (callback: number) => void) => NativeGraph;
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
  /** Computed and effect callbacks by id; native code holds only the ids. */
  readonly #callbacks: ((() => void) | undefined)[] = [];
  readonly #freeIds: number[] = [];
  #disposed = false;
  /** @internal Use loadNative().createReactive(scope). */
  constructor(create: NativeGraphFactory, scope?: Scope) {
    this.#native = create((id) => this.#callbacks[id]?.());
    scope?.onCleanup(() => this.dispose());
  }
  /** @internal */
  get native(): NativeGraph {
    return this.#native;
  }
  /** @internal Keep `callback` in the table; native code calls it by the returned id. */
  register(callback: () => void): number {
    const id = this.#freeIds.pop() ?? this.#callbacks.length;
    this.#callbacks[id] = callback;
    return id;
  }
  /** @internal */
  unregister(id: number): void {
    if (this.#callbacks[id] !== undefined) {
      this.#callbacks[id] = undefined;
      this.#freeIds.push(id);
    }
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
    if (this.#disposed) {
      resource.dispose();
      return;
    }
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
    const value = new Computed(this, compute);
    this.own(value, scope);
    return value;
  }
  #cleanup(scope: Scope | undefined): void {
    const previous = active;
    active = { context: this, computed: false, tracking: false };
    try {
      scope?.dispose();
    } finally {
      active = previous;
    }
  }
  #cleanupAfterError(scope: Scope | undefined, error: unknown): never {
    try {
      this.#cleanup(scope);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Effect and cleanup failed', {
        cause: cleanupError,
      });
    }
    throw error;
  }
  effect(run: (scope: Scope) => void, scope?: Scope): Disposable {
    this.check(true);
    let current: Scope | undefined;
    let disposed = false;
    let key = -1;
    const id = this.register(() => {
      if (disposed || this.#disposed) {
        return;
      }
      this.#cleanup(current);
      current = new Scope();
      try {
        this.evaluate(false, () => run(current!), current);
      } catch (error) {
        this.#cleanupAfterError(current, error);
      }
    });
    try {
      key = this.#native.effect(id);
    } catch (error) {
      this.unregister(id);
      this.#cleanupAfterError(current, error);
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
          this.#native.release(key);
        } finally {
          this.unregister(id);
          // Cleanup remains valid while the context itself is being disposed.
          this.#cleanup(current);
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
  readonly #key: number;
  #value: T | undefined;
  #disposed = false;
  /** @internal */
  constructor(context: ReactiveContext, key: number, value: T) {
    this.#context = context;
    this.#key = key;
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
      this.#context.native.peek(this.#key);
    } else {
      this.#context.native.track(this.#key);
    }
    return this.#value as T;
  }
  peek(): T {
    this.#check();
    this.#context.native.peek(this.#key);
    return this.#value as T;
  }
  set(value: T): void {
    this.#check(true);
    if (Object.is(this.#value, value)) {
      return;
    }
    this.#value = value;
    this.#context.native.notify(this.#key);
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
    this.#context.native.release(this.#key);
  }
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
export class Computed<T> implements Disposable {
  readonly #context: ReactiveContext;
  readonly #key: number;
  readonly #id: number;
  #compute: (() => T) | undefined;
  #outcome: Outcome<T> | undefined;
  #running = false;
  #disposed = false;
  /** @internal */
  constructor(context: ReactiveContext, compute: () => T) {
    this.#context = context;
    this.#compute = compute;
    this.#id = context.register(() => {
      try {
        this.#outcome = { ok: true, value: this.#evaluate() };
      } catch (error) {
        this.#outcome = { ok: false, error };
      }
    });
    try {
      this.#key = context.native.computed(this.#id);
    } catch (error) {
      context.unregister(this.#id);
      throw error;
    }
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
    this.#context.native.trackComputed(this.#key);
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
    try {
      this.#context.native.release(this.#key);
    } finally {
      this.#context.unregister(this.#id);
    }
  }
}
