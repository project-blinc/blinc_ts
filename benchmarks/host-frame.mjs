// Native calls and time per frame for host edits on a few thousand nodes.
// Run: node benchmarks/host-frame.mjs. Each frame repaints and retexts a tenth of
// the cells (each to a value it did not hold), moves a few cells between rows,
// and lays out; it counts every call into the addon's layout objects made while
// the frame runs, and how many nodes the CSS restyle matched again.
import { createRequire } from 'node:module';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';

const addon = createRequire(import.meta.url)('../native/blinc_ts.node');
const native = loadNative();
if (native.buildProfile !== 'release') {
  throw new Error('Build a release addon before benchmarking');
}
let calls = 0;
const counted = {};
for (const cls of [addon.NativeLayout, addon.NativeLayoutNode]) {
  for (const name of Object.getOwnPropertyNames(cls.prototype)) {
    const descriptor = Object.getOwnPropertyDescriptor(cls.prototype, name);
    if (name === 'constructor' || typeof descriptor.value !== 'function') {
      continue;
    }
    const original = descriptor.value;
    cls.prototype[name] = function (...args) {
      calls++;
      counted[name] = (counted[name] ?? 0) + 1;
      return original.apply(this, args);
    };
  }
}
const ROWS = 30;
const CELLS = 100;
const host = Host.create(native);
let matched = 0;
host.layout.onRestyle((restyled) => (matched += restyled.matched));
const rows = [];
const cells = [];
const labels = [];
for (let r = 0; r < ROWS; r++) {
  const row = host.root.appendChild(host.createElement('div'));
  row.setAttribute('style', 'flex-direction: row; height: 20px; gap: 1px');
  rows.push(row);
  for (let c = 0; c < CELLS; c++) {
    const cell = row.appendChild(host.createElement('span'));
    cell.setProperty('width', 8);
    cell.setProperty('background', '#336699');
    const label = cell.appendChild(host.createTextNode(String(c)));
    cells.push(cell);
    labels.push(label);
  }
}
host.compute(1200, 800);
const nodes = ROWS * CELLS * 2 + ROWS + 1;
function frame(n) {
  for (let i = n % 10; i < cells.length; i += 10) {
    cells[i].setProperty('background', Math.floor(n / 10) % 2 ? '#336699' : '#993366');
    labels[i].data = `${i}:${n}`;
  }
  for (let r = 0; r < ROWS; r++) {
    const row = rows[r];
    const next = rows[(r + 1) % ROWS];
    next.insertBefore(row.lastChild, next.firstChild);
  }
  host.compute(1200, 800);
}
for (let n = 0; n < 5; n++) {
  frame(n);
}
const samples = [];
calls = 0;
matched = 0;
for (const key of Object.keys(counted)) {
  delete counted[key];
}
const FRAMES = 31;
for (let n = 0; n < FRAMES; n++) {
  const start = performance.now();
  frame(n + 5);
  samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
console.log(
  JSON.stringify({
    nodes,
    editsPerFrame: { paint: cells.length / 10, text: cells.length / 10, moves: ROWS },
    nativeCallsPerFrame: calls / FRAMES,
    restyledPerFrame: matched / FRAMES,
    byMethod: Object.fromEntries(Object.entries(counted).map(([k, v]) => [k, v / FRAMES])),
    medianMs: Number(samples[FRAMES >> 1].toFixed(3)),
  }),
);
host.dispose();
