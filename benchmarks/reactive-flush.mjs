// Time to run many due effects: one write that N effects read, a batch of N
// writes that one effect each reads, and 1,000 effects that each read 1, 5 or
// 20 signals, all rerun by one batch. Run: node benchmarks/reactive-flush.mjs.
import { loadNative } from '../dist/native/index.js';

const native = loadNative();
if (native.buildProfile !== 'release') {
  throw new Error('Build a release addon before benchmarking');
}
function median(run) {
  for (let i = 0; i < 5; i++) {
    run(i);
  }
  const samples = [];
  for (let i = 0; i < 31; i++) {
    const start = performance.now();
    run(i + 5);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return samples[15];
}
const results = {};
for (const N of [1000, 10000]) {
  const graph = native.createReactive();
  let sink = 0;
  const shared = graph.signal(0);
  for (let i = 0; i < N; i++) {
    graph.effect(() => {
      sink += shared.get();
    });
  }
  const fanOut = median((n) => shared.set(n));
  graph.dispose();

  const batch = native.createReactive();
  const signals = Array.from({ length: N }, (_, i) => batch.signal(i));
  for (const signal of signals) {
    batch.effect(() => {
      sink += signal.get();
    });
  }
  const batched = median((n) =>
    batch.batch(() => {
      for (const signal of signals) {
        signal.set(n);
      }
    }),
  );
  batch.dispose();
  results[N] = {
    oneWriteNEffectsMs: Number(fanOut.toFixed(3)),
    nsPerEffect: Math.round((fanOut * 1e6) / N),
    batchOfNWritesMs: Number(batched.toFixed(3)),
    nsPerWriteAndEffect: Math.round((batched * 1e6) / N),
  };
  if (sink === 0) {
    throw new Error('Effects did not run');
  }
}
for (const reads of [1, 5, 20]) {
  const N = 1000;
  const graph = native.createReactive();
  let sink = 0;
  const signals = Array.from({ length: reads }, (_, i) => graph.signal(i));
  for (let i = 0; i < N; i++) {
    graph.effect(() => {
      for (const signal of signals) {
        sink += signal.get();
      }
    });
  }
  const time = median((n) =>
    graph.batch(() => {
      for (const signal of signals) {
        signal.set(n);
      }
    }),
  );
  graph.dispose();
  results[`1000 effects reading ${reads}`] = {
    ms: Number(time.toFixed(3)),
    nsPerEffect: Math.round((time * 1e6) / N),
  };
  if (sink === 0) {
    throw new Error('Effects did not run');
  }
}
console.log(JSON.stringify({ node: process.version, results }));
