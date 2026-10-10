import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative();
const W = 620;
const H = 380;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../.blinc/clip-path/', import.meta.url);
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
const near = (actual, expected, tolerance = 4) =>
  actual.every((c, i) => Math.abs(c - expected[i]) <= tolerance);

const GROUND = [0x20, 0x20, 0x20];
const RED = [255, 0, 0];
const BLUE = [0, 0, 255];

const star = '50px 2px, 81px 98px, 2px 38px, 98px 38px, 19px 98px';
const rings = 'M10 10 H90 V90 H10 Z M30 30 H70 V70 H30 Z';
const cells = {
  circle: 'circle(40%)',
  closest: 'circle(closest-side at 30px 50%)',
  inset: 'inset(10px 20px round 12px)',
  ellipse: 'ellipse(50% 25%)',
  triangle: 'polygon(50% 0, 100% 100%, 0 100%)',
  nonzero: `polygon(${star})`,
  evenodd: `polygon(evenodd, ${star})`,
  ring: `path(evenodd, "${rings}")`,
  filled: `path("${rings}")`,
  hole: `path("M10 10 H90 V90 H10 Z M30 30 V70 H70 V30 Z")`,
  child: 'circle(30%)',
  xywh: 'xywh(20px 20px 50% 50%)',
  rect: 'rect(10px 90px 90px 10px)',
  reveal: 'inset(0 100% 0 0)',
  grow: 'circle(0px)',
};
const sheet = `
${Object.entries(cells)
  .map(([name, clip]) => `#${name} { clip-path: ${clip}; }`)
  .join('\n')}
.cell { position: absolute; width: 100px; height: 100px; background: #ff0000; }
#reveal { transition: clip-path 100ms linear; }
#reveal.shown { clip-path: inset(0); }
#grow.go { animation: spread 100ms linear forwards; }
@keyframes spread { from { clip-path: circle(0px); } to { clip-path: circle(60px); } }
.bad { clip-path: circle(zz); }
`;

const context = native.createReactive();
const host = Host.create(native);
try {
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  host.layout.addStyleSheet(sheet);
  host.root.setAttribute('style', 'background: #202020');

  const nodes = {};
  Object.keys(cells).forEach((name, i) => {
    const box = host.createElement('div');
    box.id = name;
    box.className = 'cell';
    box.setAttribute(
      'style',
      `left: ${20 + (i % 5) * 120}px; top: ${20 + Math.floor(i / 5) * 120}px`,
    );
    host.root.appendChild(box);
    nodes[name] = box;
  });
  // What is inside a clipped node is clipped with it.
  const blue = host.createElement('div');
  blue.setAttribute('style', 'width: 100px; height: 100px; background: #0000ff');
  nodes.child.appendChild(blue);

  let frame = await capture(host, 'clip-path');
  const at = (name, dx, dy) => {
    const [x, y] = nodes[name].bounds();
    return pixel(frame, x + dx, y + dy);
  };
  const shows = (name, dx, dy, colour = RED) =>
    assert.ok(near(at(name, dx, dy), colour, 6), `${name} at ${dx},${dy}: ${at(name, dx, dy)}`);
  const clipped = (name, dx, dy) =>
    assert.ok(near(at(name, dx, dy), GROUND, 6), `${name} at ${dx},${dy}: ${at(name, dx, dy)}`);

  // A circle's percentage radius is of the diagonal over root two.
  shows('circle', 50, 50);
  shows('circle', 85, 50);
  clipped('circle', 95, 50);
  clipped('circle', 5, 5);
  // closest-side reaches the nearest edge of the box from its centre.
  shows('closest', 30, 50);
  shows('closest', 55, 50);
  shows('closest', 10, 50);
  clipped('closest', 65, 50);
  clipped('closest', 90, 50);
  // inset trims each side and rounds the corners it leaves.
  shows('inset', 50, 50);
  shows('inset', 25, 50);
  clipped('inset', 10, 50);
  clipped('inset', 90, 50);
  clipped('inset', 50, 5);
  clipped('inset', 50, 95);
  clipped('inset', 21, 11);
  shows('inset', 40, 12);
  // An ellipse takes its radii from the width and the height.
  shows('ellipse', 50, 50);
  shows('ellipse', 50, 70);
  shows('ellipse', 95, 50);
  clipped('ellipse', 50, 80);
  clipped('ellipse', 8, 8);
  shows('triangle', 50, 10);
  shows('triangle', 50, 95);
  shows('triangle', 12, 95);
  clipped('triangle', 10, 10);
  clipped('triangle', 90, 10);
  clipped('triangle', 2, 80);
  // A star's middle is inside by the nonzero rule and outside by the even-odd rule.
  shows('nonzero', 50, 55);
  shows('evenodd', 50, 20);
  shows('nonzero', 50, 20);
  clipped('evenodd', 50, 55);
  clipped('nonzero', 5, 5);
  clipped('evenodd', 5, 5);
  // A path: two rings the same way round, filled by each rule, and one the other way round.
  shows('ring', 20, 50);
  clipped('ring', 50, 50);
  clipped('ring', 5, 50);
  shows('filled', 50, 50);
  clipped('hole', 50, 50);
  shows('hole', 20, 50);
  // The node's children are clipped with it.
  shows('child', 50, 50, BLUE);
  clipped('child', 5, 5);
  clipped('child', 90, 50);
  shows('xywh', 40, 40);
  clipped('xywh', 10, 10);
  clipped('xywh', 80, 80);
  shows('rect', 50, 50);
  clipped('rect', 5, 50);
  clipped('rect', 95, 50);
  clipped('reveal', 50, 50);
  clipped('grow', 50, 50);

  // The pointer reaches a node only where its clip lets it.
  const hit = (name, dx, dy) => {
    const [x, y] = nodes[name].bounds();
    return host.layout
      .hitTest(host.root.layoutNode, x + dx, y + dy)
      .some((h) => h.nodeId === nodes[name].layoutNode.id);
  };
  assert.equal(hit('circle', 50, 50), true);
  assert.equal(hit('circle', 4, 4), false, 'a clipped corner is not the node');
  assert.equal(hit('nonzero', 50, 55), true);
  assert.equal(hit('evenodd', 50, 55), false, 'and a hole in the even-odd rule lets it through');
  assert.equal(hit('evenodd', 50, 20), true);
  assert.equal(hit('hole', 50, 50), false);
  assert.equal(hit('filled', 50, 50), true);

  // Taken away, a clip leaves the whole box.
  nodes.circle.setAttribute('style', 'left: 20px; top: 20px; clip-path: none');
  frame = await capture(host);
  shows('circle', 5, 5);
  shows('circle', 95, 95);
  assert.equal(hit('circle', 4, 4), true, 'and the whole box takes the pointer');

  // A transition between shapes of a kind moves the lengths in them, a zero taking the other's unit.
  const reveal = nodes.reveal;
  reveal.classList.add('shown');
  host.compute(W, H);
  assert.equal(host.layout.tickMotion(1000), true, 'a clip transition wants frames');
  frame = await capture(host);
  clipped('reveal', 50, 50);
  host.layout.tickMotion(1050);
  frame = await capture(host, 'half');
  shows('reveal', 25, 50);
  clipped('reveal', 75, 50);
  host.layout.tickMotion(1100);
  frame = await capture(host);
  shows('reveal', 95, 50);
  shows('reveal', 5, 50);

  // And keyframes move a clip too.
  nodes.grow.classList.add('go');
  host.compute(W, H);
  host.layout.tickMotion(2000);
  host.layout.tickMotion(2050);
  frame = await capture(host, 'grown');
  shows('grow', 50, 50);
  shows('grow', 50 + 25, 50);
  clipped('grow', 50 + 40, 50);
  host.layout.tickMotion(2100);
  frame = await capture(host);
  shows('grow', 95, 50);
  clipped('grow', 5, 5);
  assert.equal(host.layout.tickMotion(2200), false);

  // A value that is not a shape is reported, and the rest of the rule still applies.
  assert.deepEqual(errors, []);
  const bad = host.createElement('div');
  bad.className = 'bad';
  bad.setAttribute('style', 'width: 10px; height: 10px; background: #ff0000');
  host.root.appendChild(bad);
  host.compute(W, H);
  assert.ok(
    errors.some((e) => e.startsWith('clip-path: circle(zz):')),
    String(errors),
  );
} finally {
  host.dispose();
  context.dispose();
  target.dispose();
}
console.log('Native clip-path: shapes, fill rules, children, hits, transitions and errors passed');
