import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { defaultImageLoader } from '../dist/native/image-source.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative();
const W = 640;
const H = 260;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../.blinc/background-image/', import.meta.url);
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

const picture = (width, height, left, right) => {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set([...(x < width / 2 ? left : right), 255], (y * width + x) * 4);
    }
  }
  return `data:image/png;base64,${PNG.sync.write({ width, height, data }).toString('base64')}`;
};
const wide = picture(40, 20, RED, BLUE);
const tile = picture(20, 20, GREEN, RED);
const svg = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="20" height="20" fill="#00ff00"/><rect x="20" width="20" height="20" fill="#0000ff"/></svg>')}`;

const context = native.createReactive();
const host = Host.create(native);
try {
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  host.root.setAttribute('style', 'background: #202020');
  const builtIn = defaultImageLoader();
  const loads = [];
  host.images.loader = async (source) => {
    if (source.startsWith('data:')) {
      loads.push(source);
      return builtIn(source);
    }
    throw new Error(`${source}: not found`);
  };
  const urls = { wide, tile, svg };
  host.layout.addStyleSheet(`
    .cell { position: absolute; width: 100px; height: 100px; }
    .cover { background: url("${wide}") center / cover no-repeat; }
    .contain { background-image: url(${wide}); background-size: contain; }
    .fill { background: url('${wide}') 50% 50% / 100% 100%; }
    .tiled { background-image: url(${tile}); }
    .vector { background-image: url("${svg}"); }
    .other { background-image: url("${tile}"); }
    .missing { background-image: url(missing.png); }
    .small { width: 100px; height: 40px; }
    .repeatx { background: url(${tile}) repeat-x; }
    .sized { background-image: url(${tile}); background-size: 40px 40px; }
    .corner { background: url(${tile}) top left; }
  `);
  const cells = {};
  const add = (name, left, top, classes) => {
    const e = host.createElement('div');
    e.className = `cell ${classes}`;
    e.setAttribute('style', `left: ${left}px; top: ${top}px`);
    host.root.appendChild(e);
    cells[name] = e;
    return e;
  };
  add('cover', 10, 10, 'cover');
  add('contain', 120, 10, 'contain');
  add('fill', 230, 10, 'fill');
  add('tiled', 340, 10, 'tiled');
  add('vector', 450, 10, 'vector');
  add('shared', 10, 130, 'other');
  add('missing', 120, 130, 'missing');
  // Nothing draws until the images have loaded.
  host.compute(W, H);
  let frame = await capture(host);
  const at = (name, dx, dy) => {
    const [x, y] = cells[name].bounds();
    return pixel(frame, x + dx, y + dy);
  };
  assert.ok(near(at('cover', 50, 50), GROUND, 8), 'a source still loading draws nothing');
  /** Restyle, which finds the sources; wait for them to load; then lay out with what arrived. */
  const settle = async () => {
    host.compute(W, H);
    await host.images.idle();
    host.flush();
    host.compute(W, H);
  };
  await settle();
  frame = await capture(host, 'backgrounds');

  // Cover fills the box and crops the sides of a wide image; contain letterboxes it.
  assert.ok(near(at('cover', 20, 50), RED, 30) && near(at('cover', 80, 50), BLUE, 30), 'cover');
  assert.ok(
    near(at('cover', 20, 3), RED, 30) && near(at('cover', 80, 97), BLUE, 30),
    'to the edges',
  );
  assert.ok(
    near(at('contain', 25, 50), RED, 30) && near(at('contain', 75, 50), BLUE, 30),
    'contain',
  );
  assert.ok(near(at('contain', 50, 10), GROUND, 8), 'letterboxed');
  assert.ok(
    near(at('fill', 25, 5), RED, 30) && near(at('fill', 75, 95), BLUE, 30),
    'fill stretches',
  );
  // Without a size, an image is repeated at its own size: twenty pixels, halves of ten.
  for (const [x, y, colour] of [
    [5, 5, GREEN],
    [15, 5, RED],
    [25, 5, GREEN],
    [95, 5, RED],
    [5, 45, GREEN],
    [15, 85, RED],
    [65, 65, GREEN],
  ]) {
    assert.ok(near(at('tiled', x, y), colour, 20), `tiled at ${x},${y}: ${at('tiled', x, y)}`);
  }
  // An SVG is tiled at the size it says it is, forty by twenty.
  assert.ok(near(at('vector', 5, 5), GREEN, 20) && near(at('vector', 30, 5), BLUE, 20), 'svg cell');
  assert.ok(
    near(at('vector', 45, 5), GREEN, 20) && near(at('vector', 70, 25), BLUE, 20),
    'repeated',
  );
  assert.ok(
    near(at('shared', 5, 5), GREEN, 20) && near(at('shared', 15, 5), RED, 20),
    'shared source',
  );
  // A source that cannot load is reported, and draws nothing.
  assert.ok(near(at('missing', 50, 50), GROUND, 8));
  assert.ok(
    errors.some((e) => e.startsWith('background: url(missing.png):') && e.includes('not found')),
    String(errors),
  );
  // Two nodes naming one source load it once.
  assert.equal(loads.filter((l) => l === tile).length, 1, `loads: ${loads.length}`);

  // The image goes when the class does, and comes back with it.
  cells.cover.className = 'cell';
  host.compute(W, H);
  frame = await capture(host);
  assert.ok(near(at('cover', 20, 50), GROUND, 8), 'no class, no image');
  cells.cover.className = 'cell cover';
  host.compute(W, H);
  frame = await capture(host);
  assert.ok(near(at('cover', 20, 50), RED, 30), 'and it is back, from the same load');
  assert.equal(loads.filter((l) => l === wide).length, 1, 'with no second load');

  // What an image background cannot do is reported where it is declared.
  errors.length = 0;
  add('sized', 230, 130, 'sized');
  add('repeat', 340, 130, 'repeatx');
  add('corner', 450, 130, 'corner');
  host.compute(W, H);
  for (const [property, text] of [
    ['background-size', '40px 40px'],
    ['background-repeat', 'repeat-x'],
    ['background-position', 'only the centre'],
  ]) {
    assert.ok(
      errors.some((e) => e.includes(property) && e.includes(text.split(' ')[0])),
      `${property}: ${errors.join(' | ')}`,
    );
  }

  // A destroyed node lets go of its image; a new one names it again and loads it afresh.
  const before = loads.length;
  for (const name of ['shared', 'tiled']) {
    cells[name].destroy();
  }
  const again = add('again', 10, 130, 'other');
  await settle();
  frame = await capture(host);
  assert.ok(near(at('again', 5, 5), GREEN, 20), 'drawn again');
  assert.equal(loads.length, before + 1, 'once the last user had gone, the source loaded again');
  void again;
  void urls;
} finally {
  host.dispose();
  context.dispose();
  target.dispose();
}
console.log('Native background images: fills, tiles, svg, sharing, release and errors passed');
