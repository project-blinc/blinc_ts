import assert from 'node:assert/strict';
import { cpus, platform, arch, release } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadNative } from '../dist/native/index.js';

const api = loadNative();
if (api.buildProfile !== 'release') {
  throw new Error('Build a release addon before benchmarking layout');
}
function measure(name, operation) {
  for (let i = 0; i < 5; i++) {
    operation(i);
  }
  const rawSamplesMs = [];
  for (let i = 0; i < 31; i++) {
    const start = performance.now();
    operation(i + 5);
    rawSamplesMs.push(performance.now() - start);
  }
  const sorted = [...rawSamplesMs].sort((a, b) => a - b);
  return { name, medianMs: sorted[15], p95Ms: sorted[29], rawSamplesMs };
}
const results = [];
for (const count of [100, 1000, 10000]) {
  const layout = api.createLayout();
  try {
    const root = layout.createNode({ width: '100%', direction: 'column' });
    const other = layout.createNode({ width: '100%', direction: 'column' });
    const nodes = Array.from({ length: count }, () => layout.createNode({ height: 12, shrink: 0 }));
    root.setChildren(nodes);
    const bounds = new Float32Array(count * 4);
    const compute = measure('resize_and_compute', (i) =>
      layout.compute(root, 800 + (i % 2), count * 12),
    );
    layout.readBounds(nodes, bounds);
    assert.equal(bounds[(count - 1) * 4 + 1], (count - 1) * 12);
    const read = measure('read_bounds_into', () => layout.readBounds(nodes, bounds));
    const reparent = measure('bulk_reparent', (i) => (i % 2 ? root : other).setChildren(nodes));
    results.push({ nodes: count, results: [compute, read, reparent] });
  } finally {
    layout.dispose();
  }
}
const result = {
  schema: 1,
  workload: 'native-layout',
  buildProfile: api.buildProfile,
  node: process.version,
  platform: platform(),
  arch: arch(),
  os: release(),
  cpu: cpus()[0]?.model,
  warmup: 5,
  samples: 31,
  results,
};
console.log(JSON.stringify(result, null, 2));
const output = process.argv.indexOf('--output');
if (output >= 0) {
  if (!process.argv[output + 1]) {
    throw new Error('Missing --output path');
  }
  const path = resolve(process.argv[output + 1]);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(result, null, 2) + '\n');
}
