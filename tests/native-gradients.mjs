import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { compileCss, loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative();
const W = 640;
const H = 500;
const output = new URL('../.blinc/gradients/', import.meta.url);
await mkdir(output, { recursive: true });
const fixtures = [
  ['wheel', 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)'],
  [
    'pie',
    'conic-gradient(red 0deg 90deg, lime 90deg 180deg, blue 180deg 270deg, white 270deg 360deg)',
  ],
  ['turned', 'conic-gradient(from 90deg at 25% 75%, red 0% 50%, blue 50% 100%)'],
  ['stripes', 'repeating-linear-gradient(to right, red 10% 20%, blue 20% 30%)'],
  ['negative', 'repeating-linear-gradient(to right, red -10% 0%, blue 0% 10%)'],
  ['rings', 'repeating-radial-gradient(circle, red 0% 10%, blue 10% 20%)'],
  ['sectors', 'repeating-conic-gradient(red 0deg 45deg, blue 45deg 90deg)'],
  ['flat', 'repeating-linear-gradient(to right, red 40%, blue 40%)'],
  ['four', 'linear-gradient(to right, red 0% 25%, lime 25% 50%, blue 50% 75%, white 75% 100%)'],
  ['masked', 'white; mask-image: conic-gradient(black 0deg 180deg, transparent 180deg 360deg)'],
];
const motion = [
  [
    'sector-motion',
    'repeating-conic-gradient(red 0deg 45deg, black 45deg 90deg)',
    'repeating-conic-gradient(from 180deg, blue 0deg 45deg, white 45deg 90deg)',
    'repeating-conic-gradient(from 90deg, #800080 0deg 45deg, #808080 45deg 90deg)',
  ],
  [
    'cone',
    'conic-gradient(from 0deg at 25% 75%, red, black)',
    'conic-gradient(from 180deg at 75% 25%, blue, white)',
    'conic-gradient(from 90deg at 50% 50%, #800080, #808080)',
  ],
  [
    'line',
    'repeating-linear-gradient(90deg, red 0%, black 25%)',
    'repeating-linear-gradient(90deg, blue 0%, white 50%)',
    'repeating-linear-gradient(90deg, #800080 0%, #808080 37.5%)',
  ],
  [
    'radial',
    'repeating-radial-gradient(circle at 50% 50%, red 0%, black 25%)',
    'repeating-radial-gradient(circle at 50% 50%, blue 0%, white 50%)',
    'repeating-radial-gradient(circle at 50% 50%, #800080 0%, #808080 37.5%)',
  ],
];
const css = `
  :root { background: black; }
  .cell { position: absolute; width: 100px; height: 100px; }
  ${fixtures.map(([id, fill], i) => `#${id} { left:${20 + (i % 5) * 120}px; top:${20 + Math.floor(i / 5) * 120}px; background:${fill}; }`).join('\n')}
  ${motion
    .map(
      (
        [id, from, to, half],
        i,
      ) => `#${id} { left:${20 + i * 120}px; top:260px; background:${from}; transition:background 100ms linear; }
  #${id}.to { background:${to}; }
  #${id}-half { left:${20 + i * 120}px; top:380px; background:${half}; }`,
    )
    .join('\n')}
  #clipped { left:500px; top:380px; width:100px; height:100px; clip-path:polygon(0% 0%, 100% 0%, 100% 100%); background:conic-gradient(red 0% 25%, lime 25% 50%, blue 50% 75%, white 75% 100%); }
  #tiny {left:610px;top:20px;width:24px;height:24px;background:repeating-linear-gradient(to right, red 0%, blue 0.0001%);}
  #alpha {left:500px;top:260px;background:linear-gradient(to right, transparent 0%, red 50%, red 75%, red 100%);}
`;
const near = (actual, expected, tolerance = 5) =>
  actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance);
for (const scale of [1, 2]) {
  const target = await OffscreenRenderer.create(native, W * scale, H * scale, probeShader);
  let reference;
  try {
    for (const compiled of [false, true]) {
      const host = Host.create(native);
      const errors = [];
      host.onStyleErrors((e) => errors.push(...e));
      const renderer = new SceneRenderer(target.device, host.layout);
      try {
        const sheet = host.layout.addStyleSheet(compiled ? compileCss(css).bytes : css);
        assert.deepEqual(sheet.diagnostics, []);
        const cells = new Map();
        for (const id of [
          ...fixtures.map(([id]) => id),
          ...motion.flatMap(([id]) => [id, `${id}-half`]),
          'clipped',
          'alpha',
          'tiny',
        ]) {
          const cell = host.createElement('div');
          cell.id = id;
          cell.className = 'cell';
          cells.set(id, cell);
          host.root.appendChild(cell);
        }
        host.compute(W, H);
        assert.deepEqual(errors, []);
        const capture = async (name) => {
          host.compute(W, H);
          const pixels = new Uint8Array(W * H * scale * scale * 4);
          await target.captureCommandsInto(
            pixels,
            (e, v) =>
              renderer.encode(e, host.root.layoutNode, v, {
                width: W * scale,
                height: H * scale,
                scale,
              }).drawCalls,
          );
          await writeFile(
            new URL(`${compiled ? 'compiled' : 'runtime'}-${scale}x-${name}.png`, output),
            PNG.sync.write({ width: W * scale, height: H * scale, data: Buffer.from(pixels) }),
          );
          return pixels;
        };
        const at = (pixels, id, x, y) => {
          const [bx, by] = cells.get(id).bounds();
          const offset =
            (Math.floor((by + y) * scale) * W * scale + Math.floor((bx + x) * scale)) * 4;
          return [...pixels.subarray(offset, offset + 3)];
        };
        const check = (pixels, id, x, y, color, tolerance = 5) => {
          const value = at(pixels, id, x, y);
          assert.ok(near(value, color, tolerance), `${id} ${x},${y}: ${value}; expected ${color}`);
        };
        const start = await capture('start');
        if (reference) {
          assert.deepEqual(start, reference, 'runtime and compiled pixels agree');
        }
        reference = start;
        for (const [x, y, color] of [
          [70, 30, [255, 0, 0]],
          [70, 70, [0, 255, 0]],
          [30, 70, [0, 0, 255]],
          [30, 30, [255, 255, 255]],
        ]) {
          check(start, 'pie', x, y, color);
        }
        for (const [x, y, color] of [
          [50, 10, [255, 0, 0]],
          [85, 30, [255, 255, 0]],
          [85, 70, [0, 255, 0]],
          [50, 90, [0, 255, 255]],
          [15, 70, [0, 0, 255]],
          [15, 30, [255, 0, 255]],
        ]) {
          check(start, 'wheel', x, y, color, 22);
        }
        check(start, 'turned', 90, 90, [255, 0, 0]);
        check(start, 'turned', 90, 20, [0, 0, 255]);
        for (const x of [5, 25, 45, 65, 85]) {
          check(start, 'stripes', x, 50, [0, 0, 255]);
        }
        for (const x of [15, 35, 55, 75, 95]) {
          check(start, 'stripes', x, 50, [255, 0, 0]);
        }
        for (const x of [5, 25, 45, 65, 85]) {
          check(start, 'negative', x, 50, [0, 0, 255]);
        }
        check(start, 'rings', 54, 50, [255, 0, 0]);
        check(start, 'rings', 60, 50, [0, 0, 255]);
        check(start, 'rings', 68, 50, [255, 0, 0]);
        check(start, 'sectors', 65, 20, [255, 0, 0]);
        check(start, 'sectors', 80, 35, [0, 0, 255]);
        for (const x of [5, 50, 95]) {
          check(start, 'flat', x, 50, [128, 0, 128]);
        }
        for (const [x, color] of [
          [10, [255, 0, 0]],
          [35, [0, 255, 0]],
          [60, [0, 0, 255]],
          [85, [255, 255, 255]],
        ]) {
          check(start, 'four', x, 50, color);
        }
        check(start, 'masked', 75, 50, [255, 255, 255]);
        check(start, 'masked', 25, 50, [0, 0, 0]);
        check(start, 'clipped', 75, 25, [255, 0, 0]);
        check(start, 'clipped', 25, 75, [0, 0, 0]);
        check(start, 'alpha', 25, 50, [130, 0, 0], 6);
        check(start, 'tiny', 12, 12, [128, 0, 128]);
        for (const [id] of motion) {
          cells.get(id).classList.add('to');
        }
        host.compute(W, H);
        host.layout.tickMotion(1000);
        host.layout.tickMotion(1050);
        const half = await capture('half');
        for (const [id] of motion) {
          // Compare sampled interior pixels to an independently authored midpoint gradient.
          for (let y = 4; y < 96; y += 7) {
            for (let x = 4; x < 96; x += 7) {
              assert.ok(
                near(at(half, id, x, y), at(half, `${id}-half`, x, y), 3),
                `${id} midpoint ${x},${y}: ${at(half, id, x, y)} vs ${at(half, `${id}-half`, x, y)}`,
              );
            }
          }
        }
        host.layout.tickMotion(1100);
        await capture('end');
        assert.deepEqual(errors, []);
      } finally {
        renderer.dispose();
        host.dispose();
      }
    }
  } finally {
    target.dispose();
  }
}
console.log(
  'Native conic/repeating gradients, full stops, masks and motion passed at 1x/2x through runtime/compiled CSS.',
);
process.exit(0);
