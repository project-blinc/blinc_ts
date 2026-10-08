import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { MotionTrace, motionReport } from '../dist/debug/motion.js';
import { createMotionOverlay, motionSvg } from '../tools/snapshot/motion-overlay.mjs';
import { filmstripFrames, writeArtifacts } from '../tools/snapshot/artifacts.mjs';
import { encode, compare } from '../tools/snapshot/image.mjs';

const definition = (extra = {}) => ({
  id: 'x',
  targetId: 'a',
  label: 'Card A',
  property: 'translate-x',
  kind: 'layout',
  from: 10,
  to: 110,
  startMs: 0,
  durationMs: 1000,
  easing: 'cubic-in-out',
  ...extra,
});
const layer = (id, x, width = 0.1) => ({ id, name: id, bounds: { x, y: 0.3, width, height: 0.2 } });
const frame = (timeMs, layers) => ({ timeMs, debug: { layers } });

test('motion trace compares sampled values with the declared curve and copies reports', () => {
  const trace = new MotionTrace([definition()]);
  for (const [index, progress] of [0, 0.0625, 0.5, 0.9375, 1].entries()) {
    trace.sample('x', index, index * 250, 10 + 100 * progress);
  }
  const report = trace.snapshot(),
    track = report.tracks[0];
  assert.equal(report.issueCount, 0);
  assert.equal(track.maxError, 0);
  assert.equal(track.curve[16].progress, 0.0625);
  assert.equal(track.frameTimeMs, 250);
  assert.deepEqual(track.notes, []);
  track.samples[1].value = -99;
  assert.equal(trace.snapshot().tracks[0].samples[1].value, 16.25);
  assert.match(motionReport(report), /5 frames/);
});

test('delay, reverse movement, partial captures and constant properties have correct expectations', () => {
  const trace = new MotionTrace([
    definition({ from: 20, to: 10, delayMs: 100, durationMs: 500, easing: 'linear' }),
    definition({ id: 'constant', property: 'opacity', from: 0.5, to: 0.5 }),
  ]);
  for (const [index, [time, value]] of [
    [0, 20],
    [100, 20],
    [350, 15],
    [600, 10],
  ].entries()) {
    trace.sample('x', index, time, value);
    trace.sample('constant', index, time, 0.5);
  }
  assert.equal(trace.snapshot().issueCount, 0);
  assert(
    trace
      .snapshot()
      .tracks[1].samples.every((sample) => sample.progress === 0 && sample.expected === 0),
  );
  trace.sample('constant', 4, 1000, 0.7);
  assert.equal(trace.snapshot().tracks[1].issues[0].code, 'off-curve');
  const partial = new MotionTrace([definition()]);
  partial.sample('x', 0, 250, 16.25);
  partial.sample('x', 1, 500, 60);
  assert.equal(partial.snapshot().issueCount, 0);
  assert.equal(partial.snapshot().tracks[0].notes.length, 2);
});

test('wrong curves, jumps, overshoot and incorrect endpoints are reported', () => {
  const trace = new MotionTrace([definition()]);
  trace.sample('x', 0, 0, 10);
  trace.sample('x', 1, 500, 130);
  trace.sample('x', 2, 1000, 90);
  const track = trace.snapshot().tracks[0];
  assert.deepEqual(
    track.issues.map((issue) => issue.code),
    ['off-curve', 'unexpected-jump', 'wrong-end'],
  );
  assert(Math.abs(track.overshoot - 0.2) < 1e-10);
  assert.match(motionReport(trace.snapshot()), /WARN frame 2: Ended at 80/);
});

test('invalid declarations, unknown ids and nonmonotonic samples cannot corrupt a trace', () => {
  assert.throws(() => new MotionTrace([definition(), definition()]), /unique/);
  for (const extra of [
    { durationMs: 0 },
    { delayMs: -1 },
    { from: Infinity },
    { easing: 'unknown' },
  ]) {
    assert.throws(() => new MotionTrace([definition(extra)]), /declaration/);
  }
  const trace = new MotionTrace([definition()]);
  assert.equal(trace.snapshot().tracks[0].issues[0].code, 'missing-samples');
  assert.throws(() => trace.sample('unknown', 0, 0, 10), /Unknown/);
  trace.sample('x', 0, 0, 10);
  for (const input of [
    [0, 1, 10],
    [1, 0, 10],
    [1, 1, NaN],
  ]) {
    assert.throws(() => trace.sample('x', ...input), /increasing/);
  }
  trace.sample('x', 1, 250, 16.25);
  assert.equal(trace.snapshot().tracks[0].samples.length, 2);
});

test('geometry deltas follow stable ids across ordering, insertion and removal', () => {
  const overlay = createMotionOverlay({
    width: 100,
    height: 100,
    frames: [
      frame(0, [layer('a', 0), layer('b', 0.7), layer('removed', 0.2)]),
      frame(100, [layer('b', 0.7), layer('a', 0.2, 0.2), layer('added', 0.4)]),
    ],
  });
  const changes = overlay.changes(1);
  assert.deepEqual(
    changes.map((change) => [change.id, change.kind]),
    [
      ['a', 'changed'],
      ['added', 'added'],
      ['removed', 'removed'],
    ],
  );
  assert.equal(changes[0].dx, 20);
  assert.equal(changes[0].dw, 10);
  assert.equal(changes[0].velocityX, 250);
  const rect = overlay
    .commands(1, { trails: false, deltas: false, curves: false })
    .find((command) => command.kind === 'rect' && command.x === 20);
  assert.equal(rect.width, 20);
  assert.equal(rect.lineWidth, 1.5);
  assert.match(motionSvg(100, 100, [rect]), /width="20".*stroke-width="1.5"/);
});

test('trail dot spacing preserves observed easing and excludes future frames', () => {
  const overlay = createMotionOverlay({
    width: 100,
    height: 100,
    frames: [
      frame(0, [layer('a', 0)]),
      frame(100, [layer('a', 0.01)]),
      frame(200, [layer('a', 0.11)]),
      frame(300, [layer('a', 0.4)]),
    ],
  });
  const dots = overlay
    .commands(2, { bounds: false, deltas: false, curves: false })
    .find((command) => command.kind === 'dots');
  assert.deepEqual(
    dots.points.map((point) => point.x),
    [5, 6, 16],
  );
  assert.deepEqual(
    overlay.commands(2, { bounds: false, trails: false, deltas: false, curves: false }),
    [],
  );
  assert.throws(
    () =>
      createMotionOverlay({
        width: 100,
        height: 100,
        frames: [frame(0, [layer('a', 0), layer('a', 1)])],
      }),
    /unique/,
  );
});

test('filmstrip selection includes endpoints without duplicate frames', () => {
  assert.deepEqual(filmstripFrames(1), [0]);
  assert.deepEqual(filmstripFrames(3), [0, 1, 2]);
  const picks = filmstripFrames(31);
  assert.equal(picks.length, 12);
  assert.equal(new Set(picks).size, 12);
  assert.equal(picks[0], 0);
  assert.equal(picks.at(-1), 30);
});

test('diagnostic sheets cover every property and target, including more than three elements', async () => {
  const output = await mkdtemp(join(tmpdir(), 'blinc-artifacts-'));
  try {
    const definitions = [
      ...Array.from({ length: 4 }, (_, i) =>
        definition({
          id: 'x' + i,
          targetId: 'a' + i,
          label: 'Card ' + i,
          from: 0,
          to: 1,
          easing: 'linear',
        }),
      ),
      definition({
        id: 'fade',
        targetId: 'a0',
        label: 'Card 0',
        property: 'opacity',
        from: 1,
        to: 0,
        easing: 'linear',
      }),
    ];
    const trace = new MotionTrace(definitions);
    const capture = { scene: 'fixture', width: 96, height: 64, frames: [] };
    const raw = encode(96, 64, new Uint8Array(96 * 64 * 4).fill(255));
    for (const [index, time] of [0, 500, 1000].entries()) {
      for (const track of definitions) {
        trace.sample(track.id, index, time, track.from + ((track.to - track.from) * time) / 1000);
      }
      const current = frame(
        time,
        Array.from({ length: 4 }, (_, i) => layer('a' + i, i * 0.15 + index * 0.04)),
      );
      current.file = 'frame-' + index + '.png';
      capture.frames.push(current);
      await writeFile(join(output, current.file), raw);
    }
    capture.motion = trace.snapshot();
    const artifacts = await writeArtifacts(capture, output);
    assert.equal(artifacts.elements.length, 4);
    assert.deepEqual(artifacts.elements[0].tracks, ['x0', 'fade']);
    assert.equal(artifacts.elements.at(-1).targetId, 'a3');
    const sheet = PNG.sync.read(await readFile(join(output, artifacts.curves)));
    assert.deepEqual([sheet.width, sheet.height], [1008, 474]);
    for (const element of artifacts.elements) {
      const png = PNG.sync.read(await readFile(join(output, element.file)));
      assert.equal(png.height, 268);
      assert.equal(png.width, element.targetId === 'a0' ? 676 : 344);
    }
    const plain = PNG.sync.read(await readFile(join(output, capture.frames[1].file)));
    assert.deepEqual([...plain.data], [...PNG.sync.read(raw).data]);
    const highlighted = PNG.sync.read(await readFile(join(output, capture.frames[1].debugFile)));
    assert(compare(plain, highlighted, 0).changedPixels > 20);
    const originalCurve = await readFile(join(output, artifacts.curves));
    const repeated = await writeArtifacts(capture, output);
    assert.deepEqual(await readFile(join(output, repeated.curves)), originalCurve);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
