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
console.log(
  'Native reactivity: branching, batching, identity, errors, nested effects and disposal passed',
);
