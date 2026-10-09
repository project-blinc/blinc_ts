// Process memory per reactive item, against closures in a JavaScript array.
// Run: node --expose-gc benchmarks/reactive-memory.mjs [count]. macOS only (footprint -p).
// Each case runs in its own process. "alive" is footprint per item while the items
// exist; "rounds" is footprint per item after each of six rounds of making and
// disposing them, with N-API finalizers given ticks to run after each GC.
import { execFileSync, spawnSync } from 'node:child_process';
import { setImmediate as tick } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { loadNative } from '../dist/native/index.js';

const cases = ['closure', 'signal', 'computed', 'effect'];
const [kind, countArg] = process.argv.slice(2);
if (!cases.includes(kind)) {
  const count = kind ?? '100000';
  const results = cases.map((name) => {
    const run = spawnSync(
      process.execPath,
      ['--expose-gc', fileURLToPath(import.meta.url), name, count],
      { encoding: 'utf8' },
    );
    if (run.status !== 0) {
      throw new Error(run.stderr);
    }
    return JSON.parse(run.stdout);
  });
  console.log(JSON.stringify({ node: process.version, count: Number(count), results }, null, 2));
  process.exit(0);
}
const N = Number(countArg);
const footprint = () =>
  Number(
    execFileSync('footprint', ['-p', String(process.pid), '-f', 'bytes'])
      .toString()
      .match(/Footprint:\s*(\d+)/)[1],
  );
async function settle() {
  for (let i = 0; i < 6; i++) {
    globalThis.gc();
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
const api = loadNative();
const graph = api.createReactive();
const source = graph.signal(1);
let sink = 0;
const make = (i) =>
  kind === 'effect'
    ? graph.effect(() => {
        sink += source.get() + i;
      })
    : kind === 'computed'
      ? graph.computed(() => source.get() + i)
      : kind === 'signal'
        ? graph.signal(i)
        : { dispose() {}, f: () => source.peek() + i };
await settle();
const base = footprint();
const baseHeap = process.memoryUsage().heapUsed;
const per = (bytes) => Math.round(bytes / N);
let alive;
const rounds = [];
for (let round = 0; round < 6; round++) {
  const keep = [];
  for (let i = 0; i < N; i++) {
    keep.push(make(i));
  }
  if (kind === 'computed') {
    for (const item of keep) {
      sink += item.get();
    }
  }
  if (round === 0) {
    await settle();
    alive = {
      footprint: per(footprint() - base),
      heap: per(process.memoryUsage().heapUsed - baseHeap),
    };
  }
  for (const item of keep) {
    item.dispose();
  }
  keep.length = 0;
  await settle();
  rounds.push(per(footprint() - base));
}
console.log(JSON.stringify({ kind, alive, rounds, sink: sink > 0 }));
graph.dispose();
