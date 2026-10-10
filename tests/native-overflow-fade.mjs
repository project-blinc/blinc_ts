import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative();
const W = 500;
const H = 140;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../.blinc/overflow-fade/', import.meta.url);
await mkdir(output, { recursive: true });

async function capture(host, name) {
  host.compute(W, H);
  const renderer = new SceneRenderer(target.device, host.layout);
  try {
    const pixels = new Uint8Array(W * H * 4);
    await target.captureCommandsInto(
      pixels,
      (encoder, view) =>
        renderer.encode(encoder, host.root.layoutNode, view, { width: W, height: H, scale: 1 })
          .drawCalls,
    );
    if (name) {
      await writeFile(
        new URL(`${name}.png`, output),
        PNG.sync.write({ width: W, height: H, data: Buffer.from(pixels) }),
      );
    }
    return Buffer.from(pixels);
  } finally {
    renderer.dispose();
  }
}
const pixel = (pixels, x, y) => {
  const at = (Math.round(y) * W + Math.round(x)) * 4;
  return [...pixels.subarray(at, at + 3)];
};

const sheet = `
.box { position: absolute; top: 20px; width: 120px; height: 100px; overflow: hidden; }
.fill { width: 120px; height: 100px; background: #ff0000; }
#all { left: 20px; overflow-fade: 30px; }
#bottom { left: 160px; overflow-fade: 0 0 30px 0; }
#hard { left: 300px; }
#move { left: 440px; width: 40px; transition: overflow-fade 100ms linear; }
#move.on { overflow-fade: 0 0 0 30px; }
.bad { overflow-fade: -4px; }
`;

const context = native.createReactive();
const host = Host.create(native);
try {
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  host.layout.addStyleSheet(sheet);
  host.root.setAttribute('style', 'background: #202020');
  const box = (id) => {
    const e = host.createElement('div');
    e.id = id;
    e.className = 'box';
    const fill = host.createElement('div');
    fill.className = 'fill';
    e.appendChild(fill);
    host.root.appendChild(e);
    return e;
  };
  const all = box('all');
  const bottom = box('bottom');
  const hard = box('hard');
  const move = box('move');

  let frame = await capture(host, 'fade');
  const red = (node, dx, dy) => {
    const [x, y] = node.bounds();
    return pixel(frame, x + dx, y + dy)[0];
  };
  // Content fades to nothing at the edge over the distance given, and not at all beyond it.
  assert.ok(red(all, 1, 50) < 70, `the edge is nearly gone: ${red(all, 1, 50)}`);
  const half = red(all, 15, 50);
  assert.ok(half > 110 && half < 175, `halfway along the fade: ${half}`);
  assert.ok(red(all, 45, 50) > 245, `past it the content is whole: ${red(all, 45, 50)}`);
  assert.ok(red(all, 118, 50) < 70, 'every edge fades, the right one too');
  assert.ok(red(all, 60, 1) < 70, 'and the top');
  assert.ok(red(all, 60, 98) < 70, 'and the bottom');
  // One distance per side: only the bottom edge fades here.
  assert.ok(red(bottom, 60, 1) > 245, 'a side given 0 stays hard');
  assert.ok(red(bottom, 1, 50) > 245);
  assert.ok(red(bottom, 60, 98) < 70, 'the bottom fades');
  const bottomHalf = red(bottom, 60, 85);
  assert.ok(bottomHalf > 110 && bottomHalf < 175, `halfway down the bottom fade: ${bottomHalf}`);
  assert.ok(red(hard, 1, 50) > 245, 'no fade is a hard clip');

  // A fade moves from one distance to another, edge by edge.
  assert.ok(red(move, 10, 50) > 245, 'it starts hard');
  move.classList.add('on');
  host.compute(W, H);
  assert.equal(host.layout.tickMotion(1000), true, 'a fade transition wants frames');
  host.layout.tickMotion(1050);
  frame = await capture(host, 'moving');
  const mid = red(move, 10, 50);
  assert.ok(mid > 160 && mid < 215, `halfway there, 10 pixels in is most of the way up: ${mid}`);
  assert.ok(red(move, 36, 50) > 245, 'the right edge stays hard');
  host.layout.tickMotion(1100);
  frame = await capture(host);
  const end = red(move, 10, 50);
  assert.ok(end > 90 && end < 130, `it arrives, the same pixel a third of the way up: ${end}`);

  // A negative distance is reported.
  assert.deepEqual(errors, []);
  const bad = host.createElement('div');
  bad.className = 'bad';
  host.root.appendChild(bad);
  host.compute(W, H);
  assert.ok(
    errors.some((e) => e.startsWith('overflow-fade: -4px:')),
    String(errors),
  );
} finally {
  host.dispose();
  context.dispose();
  target.dispose();
}
console.log('Native overflow-fade: edges, sides, transitions and errors passed');
