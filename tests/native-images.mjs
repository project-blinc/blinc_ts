import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { loadNative, ImageFit } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { ImageLibrary } from '../dist/native/image-library.js';
import { Brush } from '../dist/native/brush.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative();
const W = 400;
const H = 200;
const targets = new Map();
const output = new URL('../.blinc/images/', import.meta.url);
await mkdir(output, { recursive: true });

/** Frame `host` at `scale` into `w` by `h` device pixels with `library`. */
async function capture(host, library, name, scale = 1, w = W, h = H, keep = null) {
  host.compute(w / scale, h / scale);
  let target = targets.get(`${w}x${h}`);
  if (!target) {
    target = await OffscreenRenderer.create(native, w, h, probeShader);
    targets.set(`${w}x${h}`, target);
  }
  const renderer = keep ?? new SceneRenderer(target.device, host.layout);
  try {
    renderer.useImages(library);
    const pixels = new Uint8Array(w * h * 4);
    await target.captureCommandsInto(
      pixels,
      (encoder, view) =>
        renderer.encode(encoder, host.root.layoutNode, view, { width: w, height: h, scale })
          .drawCalls,
    );
    if (name) {
      await writeFile(
        new URL(`${name}.png`, output),
        PNG.sync.write({ width: w, height: h, data: Buffer.from(pixels) }),
      );
    }
    return { pixels: Buffer.from(pixels), width: w };
  } finally {
    if (!keep) {
      renderer.dispose();
    }
  }
}
const pixel = ({ pixels, width }, x, y) => {
  const at = (Math.round(y) * width + Math.round(x)) * 4;
  return [...pixels.subarray(at, at + 3)];
};
const near = (actual, expected, tolerance = 12) =>
  actual.every((c, i) => Math.abs(c - expected[i]) <= tolerance);
const GROUND = [0x20, 0x20, 0x20];
const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];
const WHITE = [255, 255, 255];

/** A PNG of `rows` of colours. */
const decode = (rows) => {
  const height = rows.length;
  const width = rows[0].length;
  const data = Buffer.alloc(width * height * 4);
  rows.flat().forEach((c, i) => data.set([...c, 255], i * 4));
  return native.decodeImage(PNG.sync.write({ width, height, data }));
};

const context = native.createReactive();
const host = Host.create(native);
const library = new ImageLibrary((markup, w, h) => native.rasterizeSvg(markup, w, h));
const owned = [];
try {
  host.root.setAttribute('style', 'background: #202020');
  const box = (left, top, width, height) => {
    const e = host.createElement('div');
    e.setAttribute(
      'style',
      `position: absolute; left: ${left}px; top: ${top}px; width: ${width}px; height: ${height}px`,
    );
    host.root.appendChild(e);
    return e;
  };
  /** Gives `e` an image background, the library's `id` fitted by `fit`. */
  const paint = (e, id, fit) => {
    const source = `lib:${id}`;
    host.layout.setImageSource(source, fit, library.slot(id, fit));
    e.layoutNode.setPaint({ background: Brush.image(source, fit) });
  };

  // A 2 by 2 image: red, green over blue, white.
  const quad = decode([
    [RED, GREEN],
    [BLUE, WHITE],
  ]);
  owned.push(quad);
  const quadId = library.add(quad);
  const fill = box(10, 10, 100, 100);
  paint(fill, quadId, ImageFit.Fill);
  const contain = box(120, 10, 200, 100);
  paint(contain, quadId, ImageFit.Contain);
  const cover = box(10, 120, 200, 60);
  paint(cover, quadId, ImageFit.Cover);
  let frame = await capture(host, library, 'fit');
  const at = (e, dx, dy) => {
    const [x, y] = e.bounds();
    return pixel(frame, x + dx, y + dy);
  };
  // Fill stretches the image over the box; its four pixels are its four quadrants.
  assert.ok(near(at(fill, 25, 25), RED, 30), `fill top left: ${at(fill, 25, 25)}`);
  assert.ok(near(at(fill, 75, 25), GREEN, 30), `fill top right: ${at(fill, 75, 25)}`);
  assert.ok(near(at(fill, 25, 75), BLUE, 30), `fill bottom left: ${at(fill, 25, 75)}`);
  assert.ok(near(at(fill, 75, 75), WHITE, 30), `fill bottom right: ${at(fill, 75, 75)}`);
  // Contain keeps its shape: a 100 by 100 square in the middle of a box twice as wide.
  assert.ok(
    near(at(contain, 20, 50), GROUND, 8),
    `contain leaves the sides bare: ${at(contain, 20, 50)}`,
  );
  assert.ok(near(at(contain, 70, 25), RED, 30), `contain's top left: ${at(contain, 70, 25)}`);
  assert.ok(
    near(at(contain, 130, 75), WHITE, 30),
    `contain's bottom right: ${at(contain, 130, 75)}`,
  );
  assert.ok(near(at(contain, 180, 50), GROUND, 8), 'and the right side');
  // Cover fills a wide, short box with the middle of the image, cropping its top and bottom. The
  // four pixels blend into each other as the image is enlarged, so the corners lean to their colour.
  const [cr, cg, cb] = at(cover, 5, 5);
  assert.ok(cr > 150 && cg < 40, `cover's corner leans red: ${[cr, cg, cb]}`);
  const [fr, fg, fb] = at(cover, 195, 55);
  assert.ok(fr > 150 && fg > 200 && fb > 150, `and the far corner to white: ${[fr, fg, fb]}`);
  assert.ok(
    at(cover, 5, 30)[2] > 40 && at(cover, 5, 30)[0] < 230,
    'blending toward blue in the middle',
  );

  // SVG is drawn at the size it covers: an edge stays sharp at a larger scale.
  const svg = library.addSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60" viewBox="0 0 100 60"><rect width="50" height="60" fill="#00ff00"/><rect x="50" width="50" height="60" fill="#0000ff"/></svg>',
  );
  const vector = box(250, 120, 100, 60);
  paint(vector, svg, ImageFit.Fill);
  frame = await capture(host, library, 'svg');
  assert.ok(near(at(vector, 20, 30), GREEN, 8), `svg left: ${at(vector, 20, 30)}`);
  assert.ok(near(at(vector, 80, 30), BLUE, 8), `svg right: ${at(vector, 80, 30)}`);
  assert.ok(
    near(at(vector, 48, 30), GREEN, 8) && near(at(vector, 52, 30), BLUE, 8),
    'with a sharp edge',
  );
  frame = await capture(host, library, 'svg-2x', 2, W * 2, H * 2);
  const [vx, vy] = vector.bounds();
  const scaled = (dx, dy) => pixel(frame, (vx + dx) * 2, (vy + dy) * 2);
  assert.ok(
    near(scaled(49.5, 30), GREEN, 8) && near(scaled(50.5, 30), BLUE, 8),
    'sharp at twice the scale too',
  );

  // An image the library does not have, or has lost, draws nothing, and nothing else is harmed.
  const lost = library.add(quad);
  const gone = box(340, 10, 40, 40);
  paint(gone, lost, ImageFit.Fill);
  frame = await capture(host, library);
  assert.ok(
    near(at(gone, 20, 20), RED, 40) || near(at(gone, 10, 10), RED, 40),
    'drawn while it is there',
  );
  library.remove(lost);
  frame = await capture(host, library);
  assert.ok(
    near(at(gone, 10, 10), GROUND, 8) && near(at(gone, 30, 30), GROUND, 8),
    'and bare once it is gone',
  );
  assert.ok(near(at(fill, 25, 25), RED, 30), 'the others still draw');
  frame = await capture(host, null);
  assert.ok(near(at(fill, 25, 25), GROUND, 8), 'with no library, a library image draws nothing');

  // The atlas empties and starts afresh when the images on screen outgrow it.
  const fresh = new ImageLibrary((markup, w, h) => native.rasterizeSvg(markup, w, h));
  const big = (c) => {
    const image = decode([
      [c, c],
      [c, c],
    ]);
    owned.push(image);
    return fresh.add(image);
  };
  const hues = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
    [0, 255, 255],
    [255, 0, 255],
    [255, 128, 0],
    [128, 0, 255],
    [0, 128, 255],
    [128, 255, 0],
  ];
  const ids = hues.map(big);
  // One surface with eight 1400 pixel images at 14 times the scale; four fill the atlas.
  const surface = Host.create(native);
  surface.root.setAttribute('style', 'background: #202020');
  const cells = ids.map((id, i) => {
    const e = surface.createElement('div');
    e.setAttribute('style', 'position: absolute; left: 0; top: 0; width: 100px; height: 100px');
    surface.root.appendChild(e);
    surface.layout.setImageSource(`big:${i}`, ImageFit.Fill, fresh.slot(id, ImageFit.Fill));
    e.layoutNode.setPaint({ background: Brush.image(`big:${i}`, ImageFit.Fill) });
    return e;
  });
  const showing = (from, to) =>
    cells.forEach((e, i) =>
      e.setAttribute(
        'style',
        `position: absolute; left: 0; top: 0; width: 100px; height: 100px; display: ${i >= from && i < to ? 'block' : 'none'}`,
      ),
    );
  surface.compute(100, 100);
  const target = await OffscreenRenderer.create(native, 1400, 1400, probeShader);
  targets.set('1400x1400', target);
  const shared = new SceneRenderer(target.device, surface.layout);
  try {
    for (const [from, to] of [
      [0, 4],
      [4, 8],
      [0, 4],
      [4, 8],
    ]) {
      showing(from, to);
      // They are drawn on top of each other: the last shows.
      const shot = await capture(surface, fresh, null, 14, 1400, 1400, shared);
      const want = hues[to - 1];
      assert.ok(
        near(pixel(shot, 700, 700), want, 8),
        `${from}..${to}: ${pixel(shot, 700, 700)} for ${want}`,
      );
    }
  } finally {
    shared.dispose();
    surface.dispose();
  }
} finally {
  for (const image of owned) {
    image.dispose();
  }
  host.dispose();
  context.dispose();
  for (const target of targets.values()) {
    target.dispose();
  }
}
console.log('Native images: fits, svg, scale, removal and atlas reset passed');
