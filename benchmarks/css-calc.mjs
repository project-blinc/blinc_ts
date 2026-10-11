// Compare the cost of percentage widths and deferred math at identical geometry.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';

const addon = process.env.BLINC_CALC_ADDON ?? new URL('../native/blinc_ts.node', import.meta.url);
const native = loadNative(addon);
assert.equal(native.buildProfile, 'release', 'Build a release addon before benchmarking');
const warmup = 5;
const samples = 31;
const results = [];
for (const count of [100, 1000, 10000]) {
  const reference = [];
  for (const math of [false, true]) {
    const host = Host.create(native);
    const errors = [];
    host.onStyleErrors((e) => errors.push(...e));
    host.layout.addStyleSheet(`:root { flex-direction: column; }
      .row { width: ${math ? 'max(50%, 1px)' : '50%'}; height: 12px; flex-shrink: 0; }`);
    const nodes = Array.from({ length: count }, () => {
      const row = host.createElement('div');
      row.className = 'row';
      host.root.appendChild(row);
      return row;
    });
    try {
      for (const width of [800, 801]) {
        host.compute(width, count * 12);
        const geometry = nodes.map((n) => n.bounds());
        if (math) {
          assert.deepEqual(geometry, reference[width - 800]);
        } else {
          reference.push(geometry);
        }
      }
      for (let i = 0; i < warmup; i++) {
        host.compute(800 + (i % 2), count * 12);
      }
      const rawSamplesMs = [];
      for (let i = 0; i < samples; i++) {
        const start = performance.now();
        host.compute(800 + ((i + warmup) % 2), count * 12);
        rawSamplesMs.push(performance.now() - start);
      }
      assert.deepEqual(errors, []);
      const sorted = [...rawSamplesMs].sort((a, b) => a - b);
      results.push({
        nodes: count,
        expression: math ? 'max(50%, 1px)' : '50%',
        medianMs: sorted[15],
        p95Ms: sorted[29],
        rawSamplesMs,
      });
    } finally {
      host.dispose();
    }
  }
}
const report = {
  schema: 1,
  workload: 'css-math-resize',
  capturedAt: new Date().toISOString(),
  addonSha256: createHash('sha256')
    .update(await readFile(addon))
    .digest('hex'),
  buildProfile: native.buildProfile,
  node: process.version,
  platform: platform(),
  arch: arch(),
  os: release(),
  cpu: cpus()[0]?.model,
  warmup,
  samples,
  results,
};
console.log(JSON.stringify(report, null, 2));
const at = process.argv.indexOf('--output');
if (at >= 0) {
  assert(process.argv[at + 1], 'Missing --output path');
  const destination = resolve(process.argv[at + 1]);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
}
