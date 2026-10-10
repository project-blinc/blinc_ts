import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';
import { concaveTop, notch, notchEdge } from '../dist/native/notch.js';

const native = loadNative();
const W = 720;
const H = 360;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../.blinc/notch/', import.meta.url);
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
const WHITE = [255, 255, 255];

const context = native.createReactive();
const host = Host.create(native);
try {
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  host.root.setAttribute('style', 'background: #202020');
  const cells = {};
  const shapes = [
    ['dropdown', concaveTop(16, 8), ''],
    ['tooltip', notch({ bottom: notchEdge.peak(24, 12) }), ''],
    ['island', notch({ top: notchEdge.scoop(40, 12, 6) }), ''],
    ['bulge', notch({ bottom: notchEdge.bulge(40, 10, 4) }), ''],
    ['cut', notch({ top: notchEdge.cut(40, 12) }), ''],
    ['bordered', concaveTop(16, 8), 'border: 2px solid #ff0000'],
    ['shadow', concaveTop(16, 8), 'box-shadow: 0 0 0 4px #00ff00'],
    ['bound', null, ''],
    ['slot', notch({ top: notchEdge.scoop(20, 30, 2) }), ''],
    ['inner', concaveTop(16, 8), 'box-shadow: inset 0 0 0 4px #0000ff'],
    [
      'innerPeak',
      notch({ bottom: notchEdge.peak(40, 20) }),
      'box-shadow: inset 0 0 0 14px #0000ff',
    ],
    [
      'innerBulge',
      notch({ bottom: notchEdge.bulge(60, 20, 4) }),
      'box-shadow: inset 0 0 0 14px #0000ff',
    ],
    ['innerDropdown', concaveTop(16, 8), 'box-shadow: inset 0 0 0 12px #0000ff'],
  ];
  shapes.forEach(([name, shape, style], i) => {
    const box = host.createElement('div');
    box.setAttribute(
      'style',
      `position: absolute; left: ${20 + (i % 5) * 140}px; top: ${20 + Math.floor(i / 5) * 110}px; width: 120px; height: 80px; background: #ffffff; ${style}`,
    );
    host.root.appendChild(box);
    if (shape) {
      box.setNotch(shape);
    }
    cells[name] = box;
  });
  const pixels = await capture(host, 'notches');
  const at = (name, dx, dy) => {
    const [x, y] = cells[name].bounds();
    return pixel(pixels, x + dx, y + dy);
  };
  const ground = (name, dx, dy) =>
    assert.ok(
      near(at(name, dx, dy), GROUND),
      `${name} (${dx}, ${dy}) is bare: ${at(name, dx, dy)}`,
    );
  const white = (name, dx, dy) =>
    assert.ok(
      near(at(name, dx, dy), WHITE),
      `${name} (${dx}, ${dy}) is filled: ${at(name, dx, dy)}`,
    );

  // A concave-top dropdown: the body is inset by its flares, which meet the box's top corners.
  ground('dropdown', 60, 6);
  ground('dropdown', 2, 30);
  white('dropdown', 60, 24);
  white('dropdown', 20, 30);
  white('dropdown', 12, 18);
  ground('dropdown', 1, 79);
  white('dropdown', 60, 78);

  // A peak rises out of the bottom edge, so the body ends above it and only the arrow reaches the box.
  white('tooltip', 60, 78);
  ground('tooltip', 30, 78);
  ground('tooltip', 68, 78);
  ground('tooltip', 30, 74);
  white('tooltip', 60, 40);
  white('tooltip', 10, 66);

  // A scoop carves a bowl into the top edge and insets nothing.
  ground('island', 60, 3);
  white('island', 60, 20);
  white('island', 10, 3);
  white('island', 110, 3);

  // A narrow, deep scoop is a slot with a round bottom: still as wide deep down as at the top,
  // where a V cut of the same size has narrowed to a point.
  ground('slot', 60, 15);
  ground('slot', 68, 15);
  white('slot', 75, 15);
  white('slot', 60, 40);

  // A bulge rises out of the bottom edge.
  white('bulge', 60, 74);
  // An arc is still wide a little way out; a peak has narrowed.
  white('bulge', 72, 75);
  ground('bulge', 30, 74);
  white('bulge', 30, 40);

  // A cut is a V into the top edge.
  ground('cut', 60, 3);
  ground('cut', 60, 6);
  white('cut', 60, 20);
  white('cut', 10, 3);

  // A border follows the notch's silhouette, not the box's.
  assert.ok(near(at('bordered', 17, 50), [255, 0, 0]), `side border ${at('bordered', 17, 50)}`);
  assert.ok(near(at('bordered', 60, 17), [255, 0, 0]), `top border ${at('bordered', 60, 17)}`);
  white('bordered', 60, 30);
  ground('bordered', 60, 8);
  ground('bordered', 8, 50);

  // So does an outer shadow.
  assert.ok(near(at('shadow', 14, 50), [0, 255, 0]), `shadow beside ${at('shadow', 14, 50)}`);
  assert.ok(near(at('shadow', 60, 14), [0, 255, 0]), `shadow above ${at('shadow', 60, 14)}`);
  ground('shadow', 8, 50);
  white('shadow', 60, 40);

  // An inset shadow is a ring inside the notched outline, not the box's.
  const blue = (name, dx, dy) =>
    assert.ok(
      near(at(name, dx, dy), [0, 0, 255]),
      `${name} (${dx}, ${dy}) is ring: ${at(name, dx, dy)}`,
    );
  blue('inner', 18, 50);
  white('inner', 60, 40);
  ground('inner', 2, 30);
  blue('innerDropdown', 24, 50);
  blue('innerDropdown', 60, 22);
  white('innerDropdown', 40, 50);
  // A ring wider than the piece's reach has no seam where a peak or a bulge meets the body: the
  // interior goes down into the arrow, which a straight cut across the base would not.
  blue('innerPeak', 20, 54);
  white('innerPeak', 60, 54);
  blue('innerPeak', 60, 70);
  blue('innerBulge', 20, 56);
  white('innerBulge', 60, 56);
  blue('innerBulge', 60, 76);

  // A notch an edge cannot make is refused, and null draws a plain box.
  assert.throws(
    () =>
      cells.dropdown.setNotch(notch({ top: { kind: 'scoop', width: -1, extent: 4, radius: 0 } })),
    /cannot be negative/,
  );
  cells.dropdown.setNotch(null);
  const plain = await capture(host);
  const [px, py] = cells.dropdown.bounds();
  assert.ok(near(pixel(plain, px + 2, py + 2), WHITE), 'a null notch is a plain box');
  cells.dropdown.setNotch(concaveTop(16, 8));

  // A notch follows a signal, and a plain box is back when the binding ends.
  const [bx, by] = cells.bound.bounds();
  const sig = context.signal(notch({ topLeft: -12 }));
  const binding = cells.bound.bindNotch(sig, context);
  const bay = async () => pixel(await capture(host), bx + 4, by + 20);
  assert.ok(near(await bay(), GROUND), 'a concave corner leaves its bay bare');
  sig.set(null);
  assert.ok(near(await bay(), WHITE), 'following null draws a box');
  sig.set(notch({ topLeft: -12 }));
  assert.ok(near(await bay(), GROUND), 'and follows it back');
  binding.dispose();
  assert.ok(near(await bay(), WHITE), 'an ended binding leaves a box');

  // A radius animated through zero is continuous: either side of it the corner differs from a
  // plain box by a pixel or two, while the ends of the sweep differ a great deal.
  const swept = async (radius) => {
    cells.bound.setNotch(radius === 0 ? null : notch({ topLeft: radius }));
    const frame = await capture(host);
    let bare = 0;
    for (let y = 0; y < 36; y++) {
      for (let x = 0; x < 36; x++) {
        if (near(pixel(frame, bx + x, by + y), GROUND, 40)) {
          bare++;
        }
      }
    }
    return bare;
  };
  const concave = await swept(-12);
  const nearlyConcave = await swept(-0.5);
  const flat = await swept(0);
  const nearlyConvex = await swept(0.5);
  const convex = await swept(12);
  assert.ok(Math.abs(nearlyConcave - flat) <= 40, `${nearlyConcave} against ${flat}`);
  assert.ok(Math.abs(nearlyConvex - flat) <= 40, `${nearlyConvex} against ${flat}`);
  assert.ok(concave > flat + 100, `concave ${concave} against ${flat}`);
  assert.ok(convex > flat + 15, `convex ${convex} against ${flat}`);
  assert.deepEqual(errors, []);
} finally {
  host.dispose();
  context.dispose();
  target.dispose();
}
console.log(
  'Native notch: dropdown, peak, scoop, bulge, cut, border, shadow, validation, binding and continuity passed',
);
