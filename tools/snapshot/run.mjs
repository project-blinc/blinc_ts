import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { release } from 'node:os';
import { PNG } from 'pngjs';
import { loadNative } from '../../dist/native/index.js';
import { OffscreenRenderer } from '../../dist/native/offscreen.js';
import { MotionTrace, motionReport } from '../../dist/debug/motion.js';
import { parse } from './args.mjs';
import { encode, compare } from './image.mjs';
import { writeArtifacts } from './artifacts.mjs';
import { viewer } from './viewer.mjs';
import * as probe from './scenes/probe.mjs';
import * as motion from './scenes/motion.mjs';

const scenes = { probe, motion };
const options = parse(process.argv.slice(2));
const baselineDirectory = options.baseline ? (await stat(options.baseline)).isDirectory() : false;
if (options.baseline && !baselineDirectory && options.frames !== 1) {
  throw new Error('A motion baseline must be a directory');
}
await mkdir(options.output, { recursive: true });
const api = loadNative(),
  scene = scenes[options.scene];
const renderer = await OffscreenRenderer.create(api, options.width, options.height, scene.shader);
const pixels = new Uint8Array(options.width * options.height * 4);
const previous = options.frames > 1 ? new Uint8Array(pixels.length) : null;
const diffPixels =
  options.frames > 1 || options.baseline ? new Uint8Array(pixels.length) : undefined;
const manifest = {
  schema: 1,
  scene: options.scene,
  width: options.width,
  height: options.height,
  fps: options.fps,
  format: 'rgba8unorm',
  shaderHash: createHash('sha256').update(scene.shader.code).digest('hex'),
  buildProfile: api.buildProfile,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  osRelease: release(),
  gpu: {
    name: renderer.adapter.name(),
    backend: renderer.adapter.backend(),
    driver: renderer.adapter.driver(),
  },
  comparison: {
    baseline: options.baseline ?? null,
    tolerance: options.tolerance,
    maxDiff: options.maxDiff,
  },
  frames: [],
};
let live,
  trace,
  baselineFailed = false;
try {
  live = scene.create(renderer);
  trace = new MotionTrace(live.tracks ?? []);
  for (let index = 0; index < options.frames; index++) {
    const timeMs = options.at + (index * 1000) / options.fps;
    const frame = live.frame(timeMs);
    const stats = await renderer.captureInto(pixels, scene.shader.vertexCount, frame.groups);
    const suffix = String(index).padStart(4, '0') + '.png';
    const file = 'frame-' + suffix;
    await writeFile(join(options.output, file), encode(options.width, options.height, pixels));
    const captured = { file, timeMs, stats, debug: frame.debug };
    for (const sample of frame.debug.motion ?? []) {
      trace.sample(sample.id, index, timeMs, sample.value);
    }
    const image = { width: options.width, height: options.height, data: pixels };
    if (previous && index > 0) {
      const result = compare(image, { ...image, data: previous }, options.tolerance, diffPixels);
      captured.motionDiff = {
        file: 'motion-diff-' + suffix,
        fromFrame: index - 1,
        changedPixels: result.changedPixels,
        changedRatio: result.changedRatio,
        maximumDelta: result.maximumDelta,
      };
      await writeFile(
        join(options.output, captured.motionDiff.file),
        encode(options.width, options.height, result.diff),
      );
    }
    previous?.set(pixels);
    if (options.baseline) {
      const reference = PNG.sync.read(
        await readFile(baselineDirectory ? join(options.baseline, file) : options.baseline),
      );
      const result = compare(image, reference, options.tolerance, diffPixels);
      captured.comparison = {
        changedPixels: result.changedPixels,
        changedRatio: result.changedRatio,
        maximumDelta: result.maximumDelta,
      };
      if (result.changedRatio > options.maxDiff) {
        baselineFailed = true;
        captured.diff = 'diff-' + suffix;
        await writeFile(
          join(options.output, captured.diff),
          encode(options.width, options.height, result.diff),
        );
      }
    }
    manifest.frames.push(captured);
  }
  manifest.motion = trace.snapshot();
} finally {
  try {
    live?.dispose();
  } finally {
    renderer.dispose();
  }
}
await writeFile(
  join(options.output, 'trace.json'),
  JSON.stringify(manifest.motion, null, 2) + '\n',
);
await writeFile(join(options.output, 'report.txt'), motionReport(manifest.motion));
manifest.artifacts = await writeArtifacts(manifest, options.output);
await writeFile(join(options.output, 'capture.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(join(options.output, 'index.html'), viewer(manifest));
console.log(
  JSON.stringify({
    scene: options.scene,
    frames: manifest.frames.length,
    output: options.output,
    matched: options.baseline ? !baselineFailed : null,
    motionIssues: manifest.motion.issueCount,
  }),
);
if (baselineFailed || manifest.motion.issueCount > 0) {
  process.exitCode = 1;
}
