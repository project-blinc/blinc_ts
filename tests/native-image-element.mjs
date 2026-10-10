import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative();
const W = 560;
const H = 240;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../.blinc/image-element/', import.meta.url);
await mkdir(output, { recursive: true });

async function capture(host, name) {
  host.compute(W, H);
  const renderer = new SceneRenderer(target.device, host.layout);
  try {
    renderer.useImages(host.images.library);
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
const near = (actual, expected, tolerance = 14) =>
  actual.every((c, i) => Math.abs(c - expected[i]) <= tolerance);
const GROUND = [0x20, 0x20, 0x20];
const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];

/** A `width` by `height` PNG, `left` on its left half and `right` on its right, as bytes and a data URL. */
const picture = (width, height, left, right) => {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set([...(x < width / 2 ? left : right), 255], (y * width + x) * 4);
    }
  }
  const bytes = PNG.sync.write({ width, height, data });
  return { bytes, url: `data:image/png;base64,${bytes.toString('base64')}` };
};
const wide = picture(40, 20, RED, BLUE);
const square = picture(20, 20, GREEN, RED);
const svg = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"><rect width="30" height="30" fill="#00ff00"/><rect x="30" width="30" height="30" fill="#0000ff"/></svg>')}`;

const context = native.createReactive();
const host = Host.create(native);
try {
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  host.root.setAttribute('style', 'background: #202020');
  host.layout.addStyleSheet(`
    img { position: absolute; }
    .sized { width: 100px; }
    .box { width: 100px; height: 100px; }
    .contain { object-fit: contain; }
    .cover { object-fit: cover; }
    .none { object-fit: none; }
  `);
  // The built-in loader reads data URLs; the rest are named to the test's own.
  const builtIn = (await import('../dist/native/image-source.js')).defaultImageLoader();
  const loads = [];
  host.images.loader = async (source) => {
    if (source.startsWith('data:')) {
      return builtIn(source);
    }
    loads.push(source);
    if (source === 'missing.png') {
      throw new Error('missing.png: not found');
    }
    return { bytes: new Uint8Array([1, 2, 3]) };
  };
  const img = (left, top, src, attributes = {}, classes = '') => {
    const e = host.createElement('img');
    e.className = classes;
    e.setAttribute('style', `left: ${left}px; top: ${top}px`);
    for (const [k, v] of Object.entries(attributes)) {
      e.setAttribute(k, v);
    }
    host.root.appendChild(e);
    const settled = new Promise((resolve) => {
      e.addEventListener('load', () => resolve('load'));
      e.addEventListener('error', () => resolve('error'));
    });
    if (src !== null) {
      e.setAttribute('src', src);
    }
    return { e, settled };
  };
  const natural = img(10, 10, wide.url);
  const attribute = img(70, 10, wide.url, { width: '80' });
  const styled = img(170, 10, wide.url, { width: '30' }, 'sized');
  const fitted = img(290, 10, square.url, {}, 'box');
  const contained = img(400, 10, wide.url, {}, 'box contain');
  const covered = img(10, 130, wide.url, {}, 'box cover');
  const vector = img(130, 130, svg);
  const bad = img(250, 130, 'missing.png');
  const broken = img(350, 130, 'broken.png');
  const outcomes = await Promise.all(
    [natural, attribute, styled, fitted, contained, covered, vector, bad, broken].map(
      (i) => i.settled,
    ),
  );
  assert.deepEqual(outcomes, [
    'load',
    'load',
    'load',
    'load',
    'load',
    'load',
    'load',
    'error',
    'error',
  ]);
  host.compute(W, H);
  const size = (i) => {
    const [, , w, h] = i.e.bounds();
    return [Math.round(w), Math.round(h)];
  };
  // With no size from style, an image is as big as it is; the width and height attributes shape it.
  assert.deepEqual(size(natural), [40, 20], 'its own size');
  assert.deepEqual(size(attribute), [80, 40], 'a width attribute, the height follows its shape');
  assert.deepEqual(size(styled), [100, 50], 'style over the attribute, the height from the shape');
  assert.deepEqual(size(fitted), [100, 100]);
  assert.deepEqual(size(vector), [60, 30], 'an svg is as big as it says');
  assert.deepEqual(size(bad), [0, 0], 'one that did not load takes no room');
  assert.deepEqual(
    loads,
    ['missing.png', 'broken.png'],
    'only the two that need fetching were asked for, once',
  );

  let frame = await capture(host, 'images');
  const at = (i, dx, dy) => {
    const [x, y] = i.e.bounds();
    return pixel(frame, x + dx, y + dy);
  };
  assert.ok(near(at(natural, 10, 10), RED) && near(at(natural, 30, 10), BLUE), 'a raster image');
  assert.ok(
    near(at(attribute, 20, 20), RED) && near(at(attribute, 60, 20), BLUE),
    'resampled to its size',
  );
  // Fill stretches, contain keeps the shape inside the box, cover fills the box and crops.
  assert.ok(near(at(fitted, 25, 25), GREEN, 30) && near(at(fitted, 75, 75), RED, 30), 'fill');
  assert.ok(
    near(at(contained, 25, 50), RED, 30) && near(at(contained, 75, 50), BLUE, 30),
    'contain',
  );
  assert.ok(
    near(at(contained, 50, 10), GROUND, 8) && near(at(contained, 50, 90), GROUND, 8),
    'contain letterboxes',
  );
  assert.ok(near(at(covered, 5, 50), RED, 30) && near(at(covered, 95, 50), BLUE, 30), 'cover');
  assert.ok(near(at(vector, 15, 15), GREEN, 8) && near(at(vector, 45, 15), BLUE, 8), 'an svg');
  assert.ok(near(at(bad, 5, 5), GROUND, 8), 'nothing is drawn for a failed image');

  // A different src loads and draws; a shared one is loaded once.
  natural.e.setAttribute('src', square.url);
  assert.equal(
    await new Promise((r) => (natural.e.addEventListener('load', () => r('load')), undefined)),
    'load',
  );
  host.compute(W, H);
  assert.deepEqual(size(natural), [20, 20], 'the new image gives its own size');
  frame = await capture(host);
  assert.ok(near(at(natural, 5, 10), GREEN) && near(at(natural, 15, 10), RED), 'and is drawn');
  // Taking the src away leaves nothing, and a failing one fires error.
  natural.e.removeAttribute('src');
  host.compute(W, H);
  assert.deepEqual(size(natural), [0, 0]);
  frame = await capture(host);
  assert.ok(near(at(natural, 5, 5), GROUND, 8), 'nothing is drawn without a src');

  // object-fit values that cannot be drawn are reported, and the image fills.
  assert.deepEqual(errors, []);
  fitted.e.className = 'box none';
  host.compute(W, H);
  assert.ok(
    errors.some((e) => e.startsWith('object-fit: none:')),
    String(errors),
  );
  frame = await capture(host);
  assert.ok(near(at(fitted, 25, 25), GREEN, 30), 'drawn as fill meanwhile');

  // A destroyed image lets go, and the others are unharmed.
  covered.e.destroy();
  frame = await capture(host);
  assert.ok(near(at(attribute, 20, 20), RED), 'the others are unharmed');
} finally {
  host.dispose();
  context.dispose();
  target.dispose();
}
console.log('Native img: loading, sizes, fits, events, sources and errors passed');
