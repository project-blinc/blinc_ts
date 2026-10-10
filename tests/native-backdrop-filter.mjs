import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative();
const W = 740;
const H = 160;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../.blinc/backdrop-filter/', import.meta.url);
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
const near = (actual, expected, tolerance = 10) =>
  actual.every((c, i) => Math.abs(c - expected[i]) <= tolerance);

// Each cell is a 100 by 100 backdrop, red on the left half and blue on the right, with a 60 by 60
// box over its middle; the seam is under the box.
const sheet = `
.cell { position: absolute; top: 20px; width: 100px; height: 100px; }
.red { position: absolute; left: 0; top: 0; width: 50px; height: 100px; background: #ff0000; }
.blue { position: absolute; left: 50px; top: 0; width: 50px; height: 100px; background: #0000ff; }
.over { position: absolute; left: 20px; top: 20px; width: 60px; height: 60px; }
#blur .over { backdrop-filter: blur(8px); }
#gray .over { backdrop-filter: grayscale(1); }
#invert .over { backdrop-filter: invert(1); background: rgba(0, 0, 0, 0); }
#tint .over { backdrop-filter: blur(8px); background: rgba(255, 255, 255, 0.5); }
#plain .over { background: rgba(255, 255, 255, 0.5); }
#move .over { transition: backdrop-filter 100ms linear; }
#move.on .over { backdrop-filter: blur(16px); }
.bad .over { backdrop-filter: opacity(0.5); }
`;

const context = native.createReactive();
const host = Host.create(native);
try {
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  host.layout.addStyleSheet(sheet);
  host.root.setAttribute('style', 'background: #202020');
  const cells = {};
  const names = ['blur', 'gray', 'invert', 'tint', 'plain', 'move'];
  names.forEach((name, i) => {
    const cell = host.createElement('div');
    cell.id = name;
    cell.className = 'cell';
    cell.setAttribute('style', `left: ${20 + i * 120}px`);
    for (const part of ['red', 'blue', 'over']) {
      const e = host.createElement('div');
      e.className = part;
      cell.appendChild(e);
    }
    host.root.appendChild(cell);
    cells[name] = cell;
  });

  let frame = await capture(host, 'backdrop');
  const at = (name, dx, dy) => {
    const [x, y] = cells[name].bounds();
    return pixel(frame, x + dx, y + dy);
  };
  // Blurred, the seam under the box is a smooth ramp from red to blue, and outside the box it is sharp.
  assert.ok(near(at('blur', 22, 50), [255, 0, 0], 40), `left of the seam: ${at('blur', 22, 50)}`);
  const seam = at('blur', 50, 50);
  assert.ok(seam[0] > 90 && seam[0] < 165 && seam[2] > 90 && seam[2] < 165, `at the seam: ${seam}`);
  assert.ok(near(at('blur', 78, 50), [0, 0, 255], 40), `right of the seam: ${at('blur', 78, 50)}`);
  assert.ok(near(at('blur', 10, 50), [255, 0, 0], 3), 'outside the box nothing is blurred');
  assert.ok(near(at('blur', 90, 50), [0, 0, 255], 3));
  assert.ok(
    Math.abs(at('plain', 49, 50)[0] - at('plain', 51, 50)[0]) > 100,
    `a plain translucent fill leaves the seam sharp: ${at('plain', 49, 50)} ${at('plain', 51, 50)}`,
  );
  // Colour filters alone filter what is behind, with nothing else drawn.
  const [gr, gg, gb] = at('gray', 30, 50);
  assert.ok(
    Math.abs(gr - gg) < 6 && Math.abs(gg - gb) < 6 && gr > 40,
    `red as grey: ${[gr, gg, gb]}`,
  );
  const [br, bg, bb] = at('gray', 70, 50);
  assert.ok(Math.abs(br - bg) < 6 && Math.abs(bg - bb) < 6, `blue as grey: ${[br, bg, bb]}`);
  assert.ok(gr > br, 'red is brighter than blue as grey');
  assert.ok(near(at('invert', 30, 50), [0, 255, 255], 8), `red inverted: ${at('invert', 30, 50)}`);
  assert.ok(near(at('invert', 70, 50), [255, 255, 0], 8), `blue inverted: ${at('invert', 70, 50)}`);
  // A background colour is painted over the blurred backdrop.
  const tint = at('tint', 30, 50);
  assert.ok(tint[0] > 200 && tint[1] > 100 && tint[1] < 160, `white over blurred red: ${tint}`);
  const tseam = at('tint', 50, 50);
  assert.ok(Math.abs(tseam[0] - tseam[2]) < 40, `and over the blurred seam: ${tseam}`);

  // The blur moves between values.
  const before = at('move', 49, 50);
  const after = at('move', 51, 50);
  assert.ok(Math.abs(before[0] - after[0]) > 200, 'unblurred at the start');
  cells.move.classList.add('on');
  host.compute(W, H);
  assert.equal(host.layout.tickMotion(1000), true, 'a backdrop transition wants frames');
  host.layout.tickMotion(1050);
  frame = await capture(host, 'moving');
  const half = at('move', 40, 50);
  assert.ok(half[2] > 20 && half[2] < 235, `blur grows as it moves: ${half}`);
  host.layout.tickMotion(1100);
  const settled = await capture(host, 'blurred');
  frame = settled;
  assert.ok(
    near(at('move', 50, 50), [128, 0, 128], 60),
    `blurred at the end: ${at('move', 50, 50)}`,
  );

  // Taking the filter away unfills the box.
  cells.blur.setAttribute('style', 'left: 20px');
  cells.blur.lastChild.setAttribute('style', 'backdrop-filter: none');
  frame = await capture(host);
  assert.ok(near(at('blur', 49, 50), [255, 0, 0], 3), `no filter: ${at('blur', 49, 50)}`);
  assert.ok(near(at('blur', 51, 50), [0, 0, 255], 3), `sharp again: ${at('blur', 51, 50)}`);

  // A filter a backdrop does not take is reported.
  assert.deepEqual(errors, []);
  cells.plain.classList.add('bad');
  host.compute(W, H);
  assert.ok(
    errors.some((e) => e.startsWith('backdrop-filter: opacity(0.5):')),
    String(errors),
  );
} finally {
  host.dispose();
  context.dispose();
  target.dispose();
}
console.log('Native backdrop-filter: blur, colour filters, tint, transitions and errors passed');
