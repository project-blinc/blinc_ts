import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const output = await mkdtemp(join(tmpdir(), 'blinc-snapshot-'));
const run = (...args) =>
  spawnSync(process.execPath, ['tools/snapshot/index.mjs', ...args], {
    encoding: 'utf8',
    timeout: 30000,
  });
function expect(result, code) {
  assert.equal(result.status, code, result.stderr + result.stdout);
}
try {
  const baseline = join(output, 'baseline');
  expect(
    run(
      'motion',
      '--width',
      '319',
      '--height',
      '213',
      '--frames',
      '3',
      '--fps',
      '2',
      '--output',
      baseline,
    ),
    0,
  );
  const manifest = JSON.parse(await readFile(join(baseline, 'capture.json')));
  assert.deepEqual(
    manifest.frames.map((frame) => frame.timeMs),
    [0, 500, 1000],
  );
  assert.deepEqual(
    manifest.frames.map((frame) => frame.debug.eased),
    [0, 0.5, 1],
  );
  assert.equal(manifest.shaderHash.length, 64);
  assert.equal(manifest.motion.issueCount, 0);
  assert.equal(manifest.motion.tracks[0].samples.length, 3);
  assert.deepEqual(manifest.artifacts.filmstripFrames, [0, 1, 2]);
  assert.equal(manifest.artifacts.elements[0].targetId, 'disc');
  for (const file of [
    manifest.artifacts.filmstrip,
    manifest.artifacts.plainFilmstrip,
    manifest.artifacts.curves,
    manifest.artifacts.elements[0].file,
  ]) {
    const png = PNG.sync.read(await readFile(join(baseline, file)));
    assert(png.width > 100 && png.height > 100);
  }
  const trace = JSON.parse(await readFile(join(baseline, 'trace.json')));
  assert.deepEqual(trace, manifest.motion);
  assert.match(await readFile(join(baseline, 'report.txt'), 'utf8'), /0 issues/);
  assert.equal(manifest.frames[1].motionDiff.fromFrame, 0);
  assert(manifest.frames[1].motionDiff.changedPixels > 1000);
  for (const [index, center] of [0.18, 0.5, 0.82].entries()) {
    const png = PNG.sync.read(await readFile(join(baseline, manifest.frames[index].file)));
    let minX = png.width,
      maxX = -1,
      minY = png.height,
      maxY = -1;
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        if (png.data[(y * png.width + x) * 4 + 2] > 180) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }
    assert(
      Math.abs((minX + maxX + 1) / 2 - center * png.width) <= 1,
      'Motion center differs from trace',
    );
    assert(
      Math.abs(maxX - minX - (maxY - minY)) <= 1,
      'Motion disc was stretched by the capture aspect ratio',
    );
  }
  const debugPng = PNG.sync.read(await readFile(join(baseline, manifest.frames[1].debugFile)));
  let pinkPixels = 0;
  for (let i = 0; i < debugPng.data.length; i += 4) {
    if (debugPng.data[i] > 230 && debugPng.data[i + 1] < 110 && debugPng.data[i + 2] > 80) {
      pinkPixels++;
    }
  }
  assert(pinkPixels > 100, 'Highlighted capture is missing colored bounds and trails');
  const repeat = join(output, 'repeat');
  expect(
    run(
      'motion',
      '--width',
      '319',
      '--height',
      '213',
      '--frames',
      '3',
      '--fps',
      '2',
      '--output',
      repeat,
      '--baseline',
      baseline,
    ),
    0,
  );
  const comparison = JSON.parse(await readFile(join(repeat, 'capture.json')));
  assert(comparison.frames.every((frame) => frame.comparison.changedPixels === 0));
  const mismatch = join(output, 'mismatch');
  expect(
    run(
      'motion',
      '--width',
      '319',
      '--height',
      '213',
      '--at',
      '1000',
      '--output',
      mismatch,
      '--baseline',
      join(baseline, 'frame-0000.png'),
    ),
    1,
  );
  const failed = JSON.parse(await readFile(join(mismatch, 'capture.json')));
  assert(failed.frames[0].comparison.changedPixels > 1000);
  assert.equal(failed.frames[0].diff, 'diff-0000.png');
  const diff = PNG.sync.read(await readFile(join(mismatch, 'diff-0000.png')));
  assert(diff.data.some((value) => value === 255));
  console.log(
    JSON.stringify({
      test: 'Deterministic motion snapshots',
      matchingFrames: 3,
      mismatchDetected: true,
      roundGeometry: true,
      motionDiagnostics: true,
    }),
  );
} finally {
  await rm(output, { recursive: true, force: true });
}
