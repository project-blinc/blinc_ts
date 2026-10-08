import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { cpus, platform, arch, release } from 'node:os';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  Layout,
  LayoutDirection as D,
  LayoutAlign as A,
  LayoutJustify as J,
  LayoutOverflow as O,
  loadNative,
} from '../dist/native/index.js';
import { createLayoutFrame } from './layout-frame.mjs';
import { encode } from '../tools/snapshot/image.mjs';

const { values } = parseArgs({
  options: {
    addon: { type: 'string' },
    transport: { type: 'string', default: 'numeric' },
    counts: { type: 'string', default: '100,1000,10000' },
    ratios: { type: 'string', default: '0.01,0.1,1' },
    samples: { type: 'string', default: '41' },
    warmup: { type: 'string', default: '10' },
    gpu: { type: 'boolean', default: false },
    output: { type: 'string' },
    captures: { type: 'string' },
  },
});
assert(['numeric', 'strings'].includes(values.transport), 'Unknown enum transport');
const counts = values.counts.split(',').map(Number),
  ratios = values.ratios.split(',').map(Number);
const samples = Number(values.samples),
  warmup = Number(values.warmup);
assert(counts.every((n) => Number.isSafeInteger(n) && n >= 5 && n <= 100000));
assert(ratios.every((n) => Number.isFinite(n) && n > 0 && n <= 1));
assert(Number.isSafeInteger(samples) && samples >= 3 && samples <= 1000);
assert(Number.isSafeInteger(warmup) && warmup >= 1 && warmup <= 1000);
assert(!values.captures || values.gpu, 'Captures require --gpu');
const addonPath = resolve(
  values.addon ?? fileURLToPath(new URL('../native/blinc_ts.node', import.meta.url)),
);
const addon = createRequire(import.meta.url)(addonPath);
assert.equal(addon.buildProfile(), 'release', 'Use an optimized release addon');
const api = values.gpu ? loadNative(addonPath) : null;
const digest = (data) => createHash('sha256').update(data).digest('hex');
const wire = (number, string) => (values.transport === 'numeric' ? number : string);
function summarize(rawSamplesMs) {
  const sorted = [...rawSamplesMs].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.ceil(p * sorted.length) - 1];
  return {
    medianMs:
      (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2,
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    rawSamplesMs,
  };
}
function fixture(target, topology) {
  const layout = new Layout(new addon.NativeLayout());
  const root = layout.createNode({
    width: 1024,
    direction: wire(D.Column, 'column'),
    gap: 2,
    padding: 8,
  });
  const nodes = [],
    targets = [],
    parents = [];
  const base = { width: 960, height: topology === 'flat' ? 12 : 40, shrink: 0 };
  const n = topology === 'flat' ? target : Math.floor(target / 5);
  for (let i = 0; i < n; i++) {
    const parent = layout.createNode(base);
    parents.push(parent);
    targets.push(parent);
    nodes.push(parent);
    if (topology === 'nested') {
      const children = Array.from({ length: 4 }, () =>
        layout.createNode({ width: 140, height: 12, shrink: 0 }),
      );
      parent.setChildren(children);
      nodes.push(...children);
    }
  }
  root.setChildren(parents);
  const patches = [
    {
      direction: wire(D.Row, 'row'),
      align: wire(A.Start, 'start'),
      justify: wire(J.Start, 'start'),
      overflow: wire(O.Visible, 'visible'),
      height: base.height,
    },
    {
      direction: wire(D.RowReverse, 'row-reverse'),
      align: wire(A.Center, 'center'),
      justify: wire(J.SpaceBetween, 'space-between'),
      overflow: wire(O.Hidden, 'hidden'),
      height: base.height + 2,
    },
  ];
  const bounds = new Float32Array(nodes.length * 4);
  return { layout, root, nodes, targets, patches, bounds };
}
// Check representative pixels against topmost rectangles in the measured geometry.
// This runs only during untimed captures, so verification never changes timings.
function verifyPixels(bounds, pixels) {
  let checked = 0;
  for (let i = 0; i < bounds.length && checked < 32; i += 4) {
    const x = Math.floor(bounds[i] + bounds[i + 2] / 2);
    const y = Math.floor(bounds[i + 1] + bounds[i + 3] / 2);
    if (x < 0 || x >= 1024 || y < 0 || y >= 768) {
      continue;
    }
    let top = -1;
    for (let k = 0; k < bounds.length; k += 4) {
      if (
        x + 0.5 >= bounds[k] &&
        x + 0.5 < bounds[k] + bounds[k + 2] &&
        y + 0.5 >= bounds[k + 1] &&
        y + 0.5 < bounds[k + 1] + bounds[k + 3]
      ) {
        top = k / 4;
      }
    }
    assert(top >= 0);
    const shade = (top % 7) / 7;
    const expected = [
      (0.18 + shade * 0.25) * 255,
      (0.38 + shade * 0.35) * 255,
      (0.65 + shade * 0.25) * 255,
      255,
    ];
    expected.forEach((value, channel) =>
      assert(
        Math.abs(pixels[(y * 1024 + x) * 4 + channel] - value) <= 1,
        `Wrong rectangle at ${x}, ${y}`,
      ),
    );
    checked++;
  }
  assert(checked > 0, 'Verify at least one visible rectangle');
}
const results = [];
for (const targetNodes of counts) {
  for (const topology of ['flat', 'nested']) {
    for (const dirtyRatio of ratios) {
      const f = fixture(targetNodes, topology);
      let frame;
      try {
        const dirtyCount = Math.max(1, Math.round(f.targets.length * dirtyRatio));
        const dirty = Array.from(
          { length: dirtyCount },
          (_, i) => f.targets[Math.floor((i * f.targets.length) / dirtyCount)],
        );
        if (api) {
          frame = await createLayoutFrame(api, 1024, 768, f.bounds);
        }
        const raw = {
          styleMs: [],
          layoutMs: [],
          boundsMs: [],
          cpuLayoutMs: [],
          gpuSubmitMs: [],
          completionWaitMs: [],
          cpuSubmitMs: [],
          frameCompletedMs: [],
        };
        const step = async (index, record) => {
          const start = performance.now();
          const patch = f.patches[index % 2];
          for (const node of dirty) {
            node.setStyle(patch);
          }
          const styled = performance.now();
          f.layout.compute(f.root, 1024, 768);
          const computed = performance.now();
          f.layout.readBounds(f.nodes, f.bounds);
          const read = performance.now();
          const gpuStats = frame ? await frame.render() : null;
          const completed = performance.now();
          if (record) {
            raw.styleMs.push(styled - start);
            raw.layoutMs.push(computed - styled);
            raw.boundsMs.push(read - computed);
            raw.cpuLayoutMs.push(read - start);
            if (gpuStats) {
              raw.gpuSubmitMs.push(gpuStats.gpuSubmitMs);
              raw.completionWaitMs.push(gpuStats.completionWaitMs);
              raw.cpuSubmitMs.push(read - start + gpuStats.gpuSubmitMs);
              raw.frameCompletedMs.push(completed - start);
            }
          }
        };
        for (let i = 0; i < warmup; i++) {
          await step(i, false);
        }
        const geometry = [];
        for (let phase = 0; phase < 2; phase++) {
          await step(phase, false);
          assert(f.bounds.every(Number.isFinite));
          for (let i = 0; i < f.bounds.length; i += 4) {
            assert(f.bounds[i + 2] > 0 && f.bounds[i + 3] > 0);
          }
          const expectedHeight = f.patches[phase].height;
          const stride = topology === 'flat' ? 4 : 20;
          assert.equal(f.bounds[3], expectedHeight);
          const last = f.targets.length - 1;
          const dirtyBeforeLast =
            dirtyCount -
            (Math.floor(((dirtyCount - 1) * f.targets.length) / dirtyCount) === last ? 1 : 0);
          const normal = f.patches[0].height + 2;
          assert.equal(
            f.bounds[last * stride + 1],
            8 + last * normal + (phase === 1 ? dirtyBeforeLast * 2 : 0),
          );
          const hash = digest(new Uint8Array(f.bounds.buffer));
          let pixelHash;
          if (frame) {
            const pixels = await frame.capture();
            assert(
              pixels.some((v, i) => i % 4 !== 3 && v > 50),
              'Frame must contain geometry',
            );
            verifyPixels(f.bounds, pixels);
            pixelHash = digest(pixels);
            if (values.captures) {
              await mkdir(values.captures, { recursive: true });
              const name = `${topology}-${targetNodes}-${dirtyRatio}-${phase}.png`;
              await writeFile(resolve(values.captures, name), encode(1024, 768, pixels));
            }
          }
          geometry.push({ phase, hash, pixelHash });
        }
        assert.notEqual(geometry[0].hash, geometry[1].hash, 'Updates must change layout');
        // Phase 1 was last verified; timed steps start at 0 so every frame changes values.
        for (let i = 0; i < samples; i++) {
          await step(i, true);
        }
        results.push({
          topology,
          targetNodes,
          totalNodes: f.layout.size,
          styleTargets: f.targets.length,
          dirtyRatio,
          dirtyCount,
          geometry,
          gpu: frame?.metadata,
          metrics: Object.fromEntries(
            Object.entries(raw)
              .filter(([, v]) => v.length)
              .map(([key, v]) => [key, summarize(v)]),
          ),
        });
        console.error(
          `${values.transport} ${values.gpu ? 'GPU' : 'CPU'} ${topology} ${targetNodes} nodes / ${dirtyRatio * 100}%: ${results.at(-1).metrics.cpuLayoutMs.medianMs.toFixed(3)}ms CPU layout`,
        );
      } finally {
        frame?.dispose();
        f.layout.dispose();
      }
    }
  }
}
const result = {
  schema: 1,
  workload: values.gpu ? 'layout-rectangles-frame' : 'layout-pipeline',
  transport: values.transport,
  buildProfile: addon.buildProfile(),
  addonSha256: digest(await readFile(addonPath)),
  node: process.version,
  platform: platform(),
  arch: arch(),
  os: release(),
  cpu: cpus()[0]?.model,
  warmup,
  samples,
  counts,
  ratios,
  includes: values.gpu
    ? [
        'style mutation',
        'layout',
        'bounds read',
        'bounds upload',
        'one rectangle draw',
        'queue completion',
      ]
    : ['style mutation', 'layout', 'bounds read'],
  excludes: [
    'construction',
    'text',
    'UI display-list encoding',
    'clipping',
    'effects',
    'virtualization',
    'window presentation',
    'snapshot readback',
  ],
  timing:
    'Wall clock; completion wait includes GPU execution, driver polling and promise delivery, not an isolated GPU timestamp.',
  results,
};
if (values.output) {
  const output = resolve(values.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify(result, null, 2));
