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
 * @internal Native graph items are named by generation-checked numeric keys.
 * Computeds and effects name their callback by an id in the context's table.
 * The native graph calls the dispatcher with a computed's id while it
 * evaluates; effects are run here, by the ids of due effects that writes,
 * batches and effect creation leave for `takeDue`.
 */
export interface NativeGraph {
  readonly disposed: boolean;
  signal(): number;
  computed(callback: number): number;
  /** An effect named by `tag` when due; it is due at once. */
  effect(tag: number): number;
  beginEffect(effect: number): boolean;
  /** Calls that can make effects due return how many tags wait for `takeDue`. */
  endEffect(effect: number): number;
  takeDue(target: Uint32Array): number;
  track(signal: number): void;
  peek(signal: number): void;
  notify(signal: number): number;
  trackComputed(computed: number): void;
  release(key: number): void;
  beginBatch(): void;
  endBatch(): number;
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
  /** Due effects in the order they became due; a pass runs them all. */
  readonly #due: number[] = [];
  #dueBuffer = new Uint32Array(64);
  #running = false;
  #batches = 0;
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
  /**
   * @internal Take the `waiting` due effects from native code, and run them
   * and those they make due in
   * one pass. Inside a pass or a batch they wait for it to end. Every due
   * effect runs; the first error is thrown after the pass.
   */
  schedule(waiting: number): void {
    if (waiting > 0) {
      if (waiting > this.#dueBuffer.length) {
        this.#dueBuffer = new Uint32Array(waiting);
      }
      let count;
      do {
        count = this.#native.takeDue(this.#dueBuffer);
        for (let i = 0; i < count; i++) {
          this.#due.push(this.#dueBuffer[i]!);
        }
      } while (count === this.#dueBuffer.length);
    }
    if (this.#running || this.#batches > 0 || this.#due.length === 0 || this.#disposed) {
      return;
    }
    this.#running = true;
    let errors: unknown[] | undefined;
    let runs: Map<number, number> | undefined;
    const initial = this.#due.length;
    try {
      for (let i = 0; i < this.#due.length && !this.#disposed; i++) {
        const id = this.#due[i]!;
        if (i >= initial) {
          // An effect that keeps writing what it reads would never settle.
          runs ??= new Map();
          const count = (runs.get(id) ?? 0) + 1;
          if (count > 1024) {
            throw new Error('Reactive update cycle exceeded 1024 flush waves');
          }
          runs.set(id, count);
        }
        try {
          this.#callbacks[id]?.();
        } catch (error) {
          (errors ??= []).push(error);
        }
      }
    } finally {
      this.#due.length = 0;
      this.#running = false;
    }
    if (errors) {
      throw errors[0];
    }
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
  /** @internal */
  cleanup(scope: Scope | undefined): void {
    const previous = active;
    active = { context: this, computed: false, tracking: false };
    try {
      scope?.dispose();
    } finally {
      active = previous;
    }
  }
  /** @internal */
  cleanupAfterError(scope: Scope | undefined, error: unknown): never {
    try {
      this.cleanup(scope);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Effect and cleanup failed', {
        cause: cleanupError,
      });
    }
    throw error;
  }
  effect(run: (scope: Scope) => void, scope?: Scope): Disposable {
    this.check(true);
    const effect = new Effect(this, run);
    this.own(effect, scope);
    return effect;
  }
  batch<T>(run: () => T): T {
    this.check(true);
    this.#native.beginBatch();
    this.#batches++;
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
      this.#batches--;
      if (!this.#disposed) {
        this.schedule(this.#native.endBatch());
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
    this.#context.schedule(this.#context.native.notify(this.#key));
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

/** One object per effect: its key, callback id and the scope of its current run. */
/** One object per effect: its key, its callback id and the scope of its current run. */
class Effect implements Disposable {
  readonly #context: ReactiveContext;
  readonly #run: (scope: Scope) => void;
  readonly #id: number;
  #key = -1;
  #current: Scope | undefined;
  #disposed = false;
  constructor(context: ReactiveContext, run: (scope: Scope) => void) {
    this.#context = context;
    this.#run = run;
    this.#id = context.register(() => this.#tick());
    try {
      this.#key = context.native.effect(this.#id);
    } catch (error) {
      context.unregister(this.#id);
      throw error;
    }
    // Run now, or with the pass or batch this was created in.
    context.schedule(1);
  }
  /** Run the effect between the native begin and end, which track what it reads. */
  #tick(): void {
    if (this.#disposed || this.#context.disposed) {
      return;
    }
    const native = this.#context.native;
    if (!native.beginEffect(this.#key)) {
      return;
    }
    const first = this.#current === undefined;
    let failure: { error: unknown } | undefined;
    try {
      this.#context.cleanup(this.#current);
      const current = (this.#current = new Scope());
      try {
        this.#context.evaluate(false, () => this.#run(current), current);
      } catch (error) {
        this.#context.cleanupAfterError(current, error);
      }
    } catch (error) {
      failure = { error };
    } finally {
      this.#context.schedule(native.endEffect(this.#key));
    }
    if (failure) {
      // A first run that fails leaves no effect behind, as if creation failed.
      if (first) {
        this.dispose();
      }
      throw failure.error;
    }
  }
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    if (!this.#context.disposed) {
      this.#context.check(true);
    }
    this.#disposed = true;
    this.#context.forget(this);
    try {
      this.#context.native.release(this.#key);
    } finally {
      this.#context.unregister(this.#id);
      // Cleanup remains valid while the context itself is being disposed.
      this.#context.cleanup(this.#current);
    }
  }
}
