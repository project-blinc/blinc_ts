import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadNative } from '../dist/native/index.js';
import { Scope } from '../dist/hmr.js';
const api = loadNative();
const scope = new Scope();
const graph = api.createReactive(scope);
try {
  const a = graph.signal(1),
    b = graph.signal(10),
    choose = graph.signal(true);
  let computes = 0;
  const selected = graph.computed(() => {
    computes++;
    return choose.get() ? a.get() : b.get();
  });
  assert.equal(selected.get(), 1);
  assert.equal(selected.get(), 1);
  assert.equal(computes, 1);
  const doubled = graph.computed(() => selected.get() * 2);
  const values = [];
  const effect = graph.effect(() => values.push(doubled.get()));
  assert.deepEqual(values, [2]);
  graph.batch(() => {
    a.set(2);
    a.set(3);
  });
  assert.deepEqual(values, [2, 6]);
  choose.set(false);
  assert.equal(values.at(-1), 20);
  const runs = values.length;
  a.set(9);
  assert.equal(values.length, runs);
  b.set(11);
  assert.equal(values.at(-1), 22);
  b.set(11);
  assert.equal(values.at(-1), 22);
  const object = { value: 42 };
  const state = graph.signal(object);
  assert.equal(state.get(), object);
  const symbol = Symbol('identity');
  state.set(symbol);
  assert.equal(state.get(), symbol);
  state.set(2n ** 62n);
  assert.equal(state.get(), 2n ** 62n);
  state.set(undefined);
  assert.equal(state.get(), undefined);
  let peeks = 0;
  const untracked = graph.effect(() => {
    peeks++;
    graph.untrack(() => doubled.get());
    state.peek();
  });
  b.set(12);
  state.set(NaN);
  assert.equal(peeks, 1);
  untracked.dispose();
  const failure = { reason: 'original identity' };
  const failing = graph.computed(() => {
    if (a.get() < 0) {
      throw failure;
    }
    return a.get();
  });
  a.set(-1);
  assert.throws(
    () => failing.get(),
    (e) => e === failure,
  );
  a.set(5);
  assert.equal(failing.get(), 5);
  const bad = graph.computed(() => a.set(6));
  assert.throws(() => bad.get(), /computed callback/);
  assert.equal(a.peek(), 5);
  const cyclic = graph.computed(() => cyclic.get());
  assert.throws(() => cyclic.get(), /cycle/);
  cyclic.dispose();
  assert.throws(
    () =>
      graph.batch(() => {
        a.set(7);
        throw failure;
      }),
    (e) => e === failure,
  );
  assert.equal(failing.get(), 7);
  const other = api.createReactive();
  const foreign = other.signal(1);
  const cross = graph.computed(() => foreign.get());
  assert.throws(() => cross.get(), /cross contexts/);
  other.dispose();
  let nestedRuns = 0;
  const nested = graph.effect(() => {
    choose.get();
    graph.effect(() => {
      state.get();
      nestedRuns++;
    });
  });
  choose.set(true);
  const previous = nestedRuns;
  state.set('next');
  assert.equal(nestedRuns, previous + 1);
  nested.dispose();
  state.set('ignored');
  assert.equal(nestedRuns, previous + 1);
  const cascade = graph.signal(0);
  const output = [];
  const increment = graph.effect(() => {
    const value = cascade.get();
    output.push(value);
    if (value < 3) {
      cascade.set(value + 1);
    }
  });
  assert.deepEqual(output, [0, 1, 2, 3]);
  increment.dispose();
  effect.dispose();
  selected.dispose();
  assert.throws(() => selected.get(), /disposed/);
  assert(graph.stats().signals > 0);
} finally {
  scope.dispose();
}
assert.equal(graph.disposed, true);
assert.throws(() => graph.signal(1), /disposed/);

// Raw adapter callbacks must preserve exception identity and finish other effects.
const addon = createRequire(import.meta.url)('../native/blinc_ts.node');
const native = new addon.NativeGraph();
try {
  const s = native.signal();
  let armed = false;
  let survived = 0;
  const failure = new Error('callback failed');
  const first = native.effect(() => {
    s.track();
    if (armed) {
      throw failure;
    }
  });
  const second = native.effect(() => {
    s.track();
    survived++;
  });
  armed = true;
  assert.throws(
    () => s.notify(),
    (e) => e === failure,
  );
  assert.equal(survived, 2);
  armed = false;
  s.notify();
  assert.equal(survived, 3);
  const count = native.stats().effects;
  assert.throws(
    () =>
      native.effect(() => {
        throw failure;
      }),
    (e) => e === failure,
  );
  assert.equal(native.stats().effects, count);
  first.dispose();
  second.dispose();
  s.dispose();
  assert.deepEqual(native.stats(), { signals: 0, computeds: 0, effects: 0 });
} finally {
  native.dispose();
}
const disposing = new addon.NativeGraph();
const trigger = disposing.signal();
let armed = false;
disposing.effect(() => {
  trigger.track();
  if (armed) {
    disposing.dispose();
  }
});
armed = true;
trigger.notify();
assert.equal(disposing.disposed, true);
trigger.dispose();
// The initial callback runs before effect() can register its returned handle.
for (const fail of [false, true]) {
  const context = api.createReactive();
  let cleanups = 0;
  const failure = { phase: 'after disposal' };
  const run = () =>
    context.effect((effectScope) => {
      effectScope.onCleanup(() => {
        cleanups++;
      });
      context.dispose();
      if (fail) {
        throw failure;
      }
    });
  if (fail) {
    assert.throws(run, (error) => error === failure);
  } else {
    run().dispose();
  }
  assert.equal(context.disposed, true);
  assert.equal(cleanups, 1);
}
const lifecycle = api.createReactive();
try {
  const compute = lifecycle.computed(() => lifecycle.dispose());
  assert.throws(() => compute.get(), /computed callback/);
  assert.equal(lifecycle.disposed, false);
  compute.dispose();
  const callbackError = new Error('effect');
  const cleanupError = new Error('cleanup');
  assert.throws(
    () =>
      lifecycle.effect((effectScope) => {
        effectScope.onCleanup(() => {
          throw cleanupError;
        });
        throw callbackError;
      }),
    (error) => {
      assert(error instanceof AggregateError);
      assert.equal(error.errors[0], callbackError);
      assert(error.errors[1] instanceof AggregateError);
      assert.equal(error.errors[1].errors[0], cleanupError);
      return true;
    },
  );
  assert.deepEqual(lifecycle.stats(), { signals: 0, computeds: 0, effects: 0 });
} finally {
  lifecycle.dispose();
}
// Arbitrary thrown values must survive the native boundary without coercion.
for (const thrown of [
  undefined,
  null,
  'failure',
  42,
  2n ** 62n,
  Symbol('failure'),
  {
    toString() {
      throw new Error('Must not coerce thrown values');
    },
  },
]) {
  const context = api.createReactive();
  const state = context.signal(false);
  const effect = context.effect(() => {
    if (state.get()) {
      throw thrown;
    }
  });
  let caught = false;
  try {
    state.set(true);
  } catch (error) {
    caught = true;
    assert.equal(error, thrown);
  }
  assert.equal(caught, true);
  state.set(false);
  effect.dispose();
  context.dispose();
}
const rawLifecycle = new addon.NativeGraph();
try {
  const compute = rawLifecycle.computed(() => rawLifecycle.dispose());
  assert.throws(() => compute.track(), /computed callback/);
  assert.equal(rawLifecycle.disposed, false);
  compute.dispose();
  compute.dispose();
  assert.throws(() => compute.track(), /disposed/);
  const signal = rawLifecycle.signal();
  const effect = rawLifecycle.effect(() => signal.track());
  effect.dispose();
  effect.dispose();
  signal.dispose();
  signal.dispose();
  assert.deepEqual(rawLifecycle.stats(), { signals: 0, computeds: 0, effects: 0 });
} finally {
  rawLifecycle.dispose();
}
console.log(
  'Native reactivity: branching, batching, identity, errors, nested effects and disposal passed',
);
