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
// The raw graph takes keys, calls one dispatcher with computed ids, and
// returns due effect tags for the caller to run between begin and end.
function rawGraph() {
  const callbacks = [];
  const graph = new addon.NativeGraph((id) => callbacks[id]());
  const scratch = new Float64Array(8);
  graph.setScratch(scratch);
  const effects = [];
  const id = (callback) => callbacks.push(callback) - 1;
  const runs = [];
  const buffer = new Uint32Array(4);
  const take = (waiting) => {
    const tags = [];
    for (let n = waiting; n > 0;) {
      n = graph.takeDue(buffer);
      tags.push(...buffer.subarray(0, n));
      n = n === buffer.length ? 1 : 0;
    }
    return tags;
  };
  const run = (waiting) => runTags(take(waiting));
  const runTags = (tags) => {
    const queue = [...tags];
    while (queue.length) {
      const tag = queue.shift();
      runs.push(tag);
      const effect = effects[tag];
      if (graph.beginEffect(effect.key)) {
        let reads = 0;
        try {
          reads = effect.run(scratch) ?? 0;
        } finally {
          queue.push(...take(graph.endEffect(effect.key, reads)));
        }
      }
    }
  };
  return {
    graph,
    runs,
    run,
    scratch,
    /** `body` may write signal keys into the scratch array and return how many. */
    effect(body) {
      const key = graph.effect();
      const tag = key % 2 ** 32;
      effects[tag] = { key, run: body };
      const due = take(1);
      assert.deepEqual(due, [tag], 'An effect is due when made, reported by its slot index');
      runTags(due);
      return key;
    },
    computed: (callback) => graph.computed(id(callback)),
  };
}
const raw = rawGraph();
const native = raw.graph;
try {
  const s = native.signal();
  let reads = 0;
  const first = raw.effect(() => {
    native.track(s);
    reads++;
  });
  // Writing what it read makes it due again; the write waits for the end of the run.
  let writes = 0;
  const writer = raw.effect(() => {
    native.track(s);
    if (writes < 2) {
      writes++;
      assert.equal(native.notify(s), 0, 'Writes inside a run wait for its end');
    }
  });
  assert.equal(writes, 2);
  assert.equal(reads, 3);
  raw.runs.length = 0;
  raw.run(native.notify(s));
  assert.deepEqual(raw.runs.length, 2);
  native.beginBatch();
  assert.equal(native.notify(s), 0);
  assert.equal(native.notify(s), 0);
  const batched = native.endBatch();
  assert.equal(batched, 2, 'A batch makes each effect due once');
  raw.run(batched);
  native.release(first);
  native.release(writer);
  assert.equal(native.beginEffect(first), false, 'A released effect cannot begin');
  assert.equal(native.endEffect(first, 0), 0);
  assert.throws(() => native.takeDue(new Float32Array(2)), /Uint32Array/);
  native.release(s);
  assert.deepEqual(native.stats(), { signals: 0, computeds: 0, effects: 0 });
  // Reads reported through the scratch array subscribe as tracked ones do;
  // keys that are not live signals are ignored.
  const [p, q] = [native.signal(), native.signal()];
  let reported = 0;
  const reporter = raw.effect((scratch) => {
    reported++;
    scratch[0] = p;
    scratch[1] = -7;
    scratch[2] = 0.5;
    return 3;
  });
  raw.run(native.notify(p));
  raw.run(native.notify(q));
  assert.equal(reported, 2);
  native.release(reporter);
  native.release(p);
  native.release(q);
  assert.throws(() => native.setScratch(new Float32Array(4)), /Float64Array/);
  // A reused slot gets a new generation, so a stale key cannot reach its successor.
  const reused = native.signal();
  assert.notEqual(reused, s);
  assert.throws(() => native.track(s), /disposed/);
  assert.throws(() => native.track(first), /disposed/);
  assert.throws(() => native.track(-1), /disposed/);
  assert.throws(() => native.track(0.5), /disposed/);
  native.track(reused);
  native.release(reused);
} finally {
  native.dispose();
}
const disposingRaw = rawGraph();
const disposing = disposingRaw.graph;
const trigger = disposing.signal();
let armed = false;
disposingRaw.effect(() => {
  disposing.track(trigger);
  if (armed) {
    disposing.dispose();
  }
});
armed = true;
disposingRaw.run(disposing.notify(trigger));
assert.equal(disposing.disposed, true);
disposing.release(trigger);
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
const lifecycleRaw = rawGraph();
const rawLifecycle = lifecycleRaw.graph;
try {
  const compute = lifecycleRaw.computed(() => rawLifecycle.dispose());
  assert.throws(() => rawLifecycle.trackComputed(compute), /computed callback/);
  assert.equal(rawLifecycle.disposed, false);
  rawLifecycle.release(compute);
  rawLifecycle.release(compute);
  assert.throws(() => rawLifecycle.trackComputed(compute), /disposed/);
  const signal = rawLifecycle.signal();
  assert.throws(() => rawLifecycle.trackComputed(signal), /disposed/);
  const effect = lifecycleRaw.effect(() => rawLifecycle.track(signal));
  assert.equal(rawLifecycle.stats().effects, 1);
  rawLifecycle.release(effect);
  rawLifecycle.release(effect);
  rawLifecycle.release(signal);
  rawLifecycle.release(signal);
  assert.deepEqual(rawLifecycle.stats(), { signals: 0, computeds: 0, effects: 0 });
} finally {
  rawLifecycle.dispose();
}
// An effect that writes what it read runs again until it settles, in one pass;
// one that never settles is stopped.
{
  const context = api.createReactive();
  const n = context.signal(0);
  const seen = [];
  context.effect(() => {
    seen.push(n.get());
    if (n.peek() < 3) {
      n.set(n.peek() + 1);
    }
  });
  assert.deepEqual(seen, [0, 1, 2, 3]);
  const order = [];
  const a = context.signal(0);
  context.effect(() => order.push(`x${a.get()}`));
  context.effect(() => order.push(`y${a.get()}`));
  order.length = 0;
  a.set(1);
  assert.deepEqual(order, ['x1', 'y1'], 'Due effects run in the order they were made');
  // An effect that disposes itself mid-run still closes its run, so later writes apply.
  const self = context.signal(0);
  let selfRuns = 0;
  const once = context.effect(() => {
    self.get();
    selfRuns++;
    if (selfRuns === 2) {
      once.dispose();
      self.set(5);
    }
  });
  const watcher = [];
  context.effect(() => watcher.push(self.get()));
  self.set(1);
  assert.equal(selfRuns, 2);
  assert.deepEqual(watcher, [0, 5], 'The watcher, due once, sees the write made before it ran');
  self.set(6);
  assert.deepEqual(watcher, [0, 5, 6]);
  const loop = context.signal(0);
  assert.throws(
    () =>
      context.effect(() => {
        loop.set(loop.get() + 1);
      }),
    /cycle/,
  );
  context.dispose();
}
// An effect that reads more signals than the scratch array holds subscribes to
// all of them; reads in an effect, and peeks anywhere, make no native call.
{
  const context = api.createReactive();
  const many = Array.from({ length: 700 }, (_, i) => context.signal(i));
  let total = 0;
  const calls = { track: 0, peek: 0 };
  const proto = addon.NativeGraph.prototype;
  const original = { track: proto.track, peek: proto.peek };
  for (const name of ['track', 'peek']) {
    proto[name] = function (...args) {
      calls[name]++;
      return original[name].apply(this, args);
    };
  }
  try {
    context.effect(() => {
      total = many.reduce((sum, signal) => sum + signal.get(), 0);
    });
    many[699].set(0);
    assert.equal(
      total,
      (699 * 700) / 2 - 699,
      'The last signal past the first array is a dependency',
    );
    many[0].peek();
    many[0].get();
    assert.deepEqual(calls, { track: 0, peek: 0 });
  } finally {
    proto.track = original.track;
    proto.peek = original.peek;
    context.dispose();
  }
}
console.log(
  'Native reactivity: branching, batching, identity, errors, nested effects and disposal passed',
);
