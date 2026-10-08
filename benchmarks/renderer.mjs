import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadNative, sceneSchema } from '../dist/native/index.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';
import { encode } from '../tools/snapshot/image.mjs';
import { createScene, viewport, paintOptions, fontFamily } from './renderer-scenes.mjs';

const { values } = parseArgs({
  options: {
    addon: { type: 'string' },
    counts: { type: 'string', default: '30,300,3000' },
    scales: { type: 'string', default: '1,2' },
    cases: { type: 'string', default: 'list,cards,effects' },
    samples: { type: 'string', default: '101' },
    warmup: { type: 'string', default: '20' },
    output: { type: 'string' },
    captures: { type: 'string' },
    verify: { type: 'string' },
  },
});
const counts = values.counts.split(',').map(Number),
  scales = values.scales.split(',').map(Number);
const cases = values.cases.split(','),
  samples = Number(values.samples),
  warmup = Number(values.warmup);
assert(counts.length && counts.every((n) => Number.isSafeInteger(n) && n >= 30 && n <= 10000));
assert(scales.length && scales.every((n) => n === 1 || n === 2));
assert(cases.length && cases.every((n) => ['list', 'cards', 'effects'].includes(n)));
assert(Number.isSafeInteger(samples) && samples >= 3 && samples <= 10000);
assert(Number.isSafeInteger(warmup) && warmup >= 2 && warmup <= 1000);
const rootPath = fileURLToPath(new URL('../', import.meta.url));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}
const sdkHash = createHash('sha256');
for (const file of (await readdir(resolve(rootPath, 'dist'), { recursive: true }))
  .filter((f) => f.endsWith('.js'))
  .sort()) {
  sdkHash.update(file).update(await readFile(resolve(rootPath, 'dist', file)));
}
const addonPath = values.addon ? resolve(values.addon) : resolve(rootPath, 'native/blinc_ts.node');
const api = loadNative(addonPath);
assert.equal(api.buildProfile, 'release', 'Build an optimized native addon first');
const report = {
  schema: 1,
  workload: 'ui-renderer',
  timestamp: new Date().toISOString(),
  node: process.version,
  platform: platform(),
  arch: arch(),
  os: release(),
  cpu: cpus()[0]?.model,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootPath, encoding: 'utf8' }).trim(),
  workingTree: execFileSync('git', ['status', '--short'], {
    cwd: rootPath,
    encoding: 'utf8',
  }).trim(),
  buildProfile: api.buildProfile,
  addonSha256: await hashFile(addonPath),
  sdkSha256: sdkHash.digest('hex'),
  fixtureSha256: await hashFile(new URL('./renderer-scenes.mjs', import.meta.url)),
  harnessSha256: await hashFile(fileURLToPath(import.meta.url)),
  sceneSchema,
  viewport,
  paintOptions,
  fontFamily,
  scales,
  counts,
  cases,
  samples,
  warmup,
  includes: [
    'mutation',
    'layout when dirty',
    'display-list generation/transfer',
    'glyph shaping/cache',
    'atlas/record upload',
    'all scene render passes',
    'serialized queue completion',
  ],
  excludes: [
    'scene construction',
    'pipeline compilation',
    'image decoding',
    'image readback',
    'window presentation',
    'CSS/components',
    'virtualization',
  ],
  timing:
    'Wall-clock CPU phases; queue wait includes GPU execution, driver polling and promise delivery. No isolated GPU timestamps. Forced static redraws measure render cost, not idle behavior.',
  results: [],
};
const summarize = (rawSamplesMs) => {
  const sorted = [...rawSamplesMs].sort((a, b) => a - b);
  return {
    medianMs:
      (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    p99Ms: sorted[Math.ceil(sorted.length * 0.99) - 1],
    rawSamplesMs,
  };
};
const fixtures = cases.flatMap((kind) =>
  (kind === 'list' ? counts : [kind === 'cards' ? 12 : 6]).map((count) => ({ kind, count })),
);
for (const scale of scales) {
  for (const { kind, count } of fixtures) {
    const scene = createScene(api, kind, count);
    const options = {
      width: viewport.width * scale,
      height: viewport.height * scale,
      scale,
      ...paintOptions,
    };
    let target, renderer;
    try {
      target = await OffscreenRenderer.create(api, options.width, options.height, probeShader);
      renderer = new SceneRenderer(target.device, scene.layout);
      scene.prepare(renderer);
      scene.update(0);
      scene.layout.compute(scene.root, viewport.width, viewport.height);
      const frame = async (phase, mutate) => {
        const start = performance.now();
        const dirty = mutate ? scene.update(phase) : false;
        const mutated = performance.now();
        if (dirty) {
          scene.layout.compute(scene.root, viewport.width, viewport.height);
        }
        const laidOut = performance.now();
        const encoder = target.device.encoder();
        let stats, encoded;
        try {
          stats = renderer.encode(encoder, scene.root, target.view, options);
          encoded = performance.now();
          encoder.submit(target.queue);
        } finally {
          encoder.destroy();
        }
        const submitted = performance.now();
        await target.device.queueWorkDone(target.queue);
        const completed = performance.now();
        const error = target.device.takeError();
        if (error !== null) {
          throw new Error(error);
        }
        return {
          phase,
          stats,
          timings: {
            mutationMs: mutated - start,
            layoutMs: laidOut - mutated,
            encodeMs: encoded - laidOut,
            submitMs: submitted - encoded,
            cpuFrameMs: submitted - start,
            queueWaitMs: completed - submitted,
            completedMs: completed - start,
          },
        };
      };
      // Separate first-render/cache-fill diagnostics from the warmed measurements.
      const firstFrame = await frame(0, false);
      const capture = async (phase) => {
        if (scene.update(phase)) {
          scene.layout.compute(scene.root, viewport.width, viewport.height);
        }
        const pixels = new Uint8Array(options.width * options.height * 4);
        let stats;
        await target.captureCommandsInto(pixels, (encoder, view) => {
          stats = renderer.encode(encoder, scene.root, view, options);
          return stats.drawCalls;
        });
        // Includes text and geometry, not merely a clear or rectangle probe.
        const info = scene.layout.prepareDisplayList(scene.root, options);
        const records = new Float32Array(info.floats);
        scene.layout.readDisplayList(records);
        const kinds = {};
        for (let i = 0; i < info.count; i++) {
          const kind = records[i * sceneSchema.recordFloats + 44];
          kinds[kind] = (kinds[kind] ?? 0) + 1;
        }
        assert(kinds[7] > 10, 'The scene must contain rendered glyphs');
        assert(kinds[0] > 1, 'The scene must contain box geometry');
        if (kind === 'cards') {
          assert.equal(kinds[32], 12, 'All image cards must be rendered');
        }
        if (kind === 'effects') {
          assert.equal(kinds[42], 6);
          assert.equal(kinds[40], 6);
          assert.equal(kinds[41], 6);
        }
        assert.deepEqual([...pixels.subarray(0, 4)], [16, 23, 34, 255]);
        assert(
          pixels.some((v, i) => i % 4 !== 3 && v > 180),
          'The frame must contain foreground ink',
        );
        if (values.captures) {
          await mkdir(values.captures, { recursive: true });
          await writeFile(
            resolve(values.captures, `${kind}-${count}-${scale}x-${phase}.png`),
            encode(options.width, options.height, pixels),
          );
        }
        return {
          phase,
          pixelSha256: digest(pixels),
          recordsSha256: digest(new Uint8Array(records.buffer)),
          kinds,
          stats,
        };
      };
      const states = [await capture(0), await capture(1)];
      assert.notEqual(
        states[0].pixelSha256,
        states[1].pixelSha256,
        'Changing the scene must change pixels',
      );
      // Allocate all states first, then prove warm rendering reuses GPU resources.
      const allocations = { texture: 0, createBuffer: 0, createBindGroup: 0 };
      const originals = new Map();
      try {
        for (const key of Object.keys(allocations)) {
          const original = target.device[key];
          originals.set(key, original);
          target.device[key] = function (...args) {
            allocations[key]++;
            return original.apply(this, args);
          };
        }
        for (const phase of [0, 1]) {
          const again = await capture(phase);
          assert.equal(
            again.pixelSha256,
            states[phase].pixelSha256,
            'State replay must produce identical pixels',
          );
          assert.equal(
            again.recordsSha256,
            states[phase].recordsSha256,
            'State replay must preserve the display list',
          );
          assert.equal(again.stats.atlasBytes, 0, 'Warm glyphs must not upload again');
        }
        assert.deepEqual(
          allocations,
          { texture: 0, createBuffer: 0, createBindGroup: 0 },
          'Warm scene resources must be reused',
        );
      } finally {
        for (const [key, original] of originals) {
          target.device[key] = original;
        }
      }
      const measurements = [];
      for (const mode of ['static', 'changed']) {
        const mutate = mode === 'changed';
        if (scene.update(0)) {
          scene.layout.compute(scene.root, viewport.width, viewport.height);
        }
        for (let i = 0; i < warmup; i++) {
          await frame((i + 1) % 2, mutate);
        }
        // Start the measured sequence opposite the last warmed state.
        const raw = [];
        for (let i = 0; i < samples; i++) {
          raw.push(await frame(mutate ? (warmup + i + 1) % 2 : 0, mutate));
        }
        for (const sample of raw) {
          assert.equal(sample.stats.atlasBytes, 0);
        }
        const metrics = Object.fromEntries(
          Object.keys(raw[0].timings).map((key) => [
            key,
            summarize(raw.map((s) => s.timings[key])),
          ]),
        );
        measurements.push({
          mode,
          metrics,
          frameStats: raw.map((s) => ({ phase: s.phase, ...s.stats })),
        });
        console.error(
          `${kind}/${count} ${scale}x ${mode}: CPU ${metrics.cpuFrameMs.medianMs.toFixed(3)}ms, completed ${metrics.completedMs.medianMs.toFixed(3)}ms, ${raw[0].stats.primitives} primitives / ${raw[0].stats.drawCalls} draws`,
        );
      }
      report.results.push({
        kind,
        count,
        scale,
        totalNodes: scene.layout.size,
        description: scene.description,
        gpu: {
          name: target.adapter.name(),
          backend: target.adapter.backend(),
          driver: target.adapter.driver(),
          width: options.width,
          height: options.height,
        },
        firstFrame,
        states,
        warmAllocations: allocations,
        measurements,
      });
    } finally {
      renderer?.dispose();
      target?.dispose();
      scene.dispose();
    }
  }
}
if (values.verify) {
  const previous = JSON.parse(await readFile(values.verify, 'utf8'));
  for (const key of [
    'workload',
    'viewport',
    'paintOptions',
    'fontFamily',
    'counts',
    'scales',
    'cases',
    'fixtureSha256',
  ]) {
    assert.deepEqual(report[key], previous[key], `Incompatible reference field: ${key}`);
  }
  assert.equal(report.results.length, previous.results.length);
  for (let i = 0; i < report.results.length; i++) {
    const current = report.results[i],
      old = previous.results[i];
    assert.deepEqual(current.gpu, old.gpu, 'Compare the same GPU and viewport');
    for (let phase = 0; phase < 2; phase++) {
      assert.equal(
        current.states[phase].pixelSha256,
        old.states[phase].pixelSha256,
        'Reference pixels changed',
      );
    }
  }
  report.verifiedAgainst = resolve(values.verify);
}
if (values.output) {
  const output = resolve(values.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(`Saved ${output}`);
} else {
  console.log(JSON.stringify(report, null, 2));
}
