import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { compileCss, loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative();
const W = 420;
const H = 460;
const output = new URL('../.blinc/border-patterns/', import.meta.url);
await mkdir(output, { recursive: true });
const fixtures = [];
for (const style of ['dashed', 'dotted']) {
  for (const width of [1, 3]) {
    for (const radius of [0, 16]) {
      fixtures.push({ style, width, radius });
    }
  }
}
const css = `
  :root { background: black; }
  .cell { position:absolute;width:180px;height:72px; }
  ${fixtures
    .map(
      (f, i) => `.f${i} {left:${20 + (i % 2) * 200}px;top:${20 + Math.floor(i / 2) * 90}px;
        border:${f.width}px ${f.style} white;border-radius:${f.radius}px;}`,
    )
    .join('\n')}
  .mixed {left:20px;top:380px;border:3px solid white;
    border-style:dashed dotted solid none;border-radius:12px;}
`;

function runs(values, threshold) {
  let count = 0;
  let inside = false;
  for (const value of values) {
    const on = value > threshold;
    if (on && !inside) {
      count++;
    }
    inside = on;
  }
  return count;
}

function markWidths(values, threshold) {
  const widths = [];
  let width = 0;
  for (const value of [...values, 0]) {
    if (value > threshold) {
      width++;
    } else if (width) {
      widths.push(width);
      width = 0;
    }
  }
  return widths.slice(1, -1);
}

for (const scale of [1, 2]) {
  const target = await OffscreenRenderer.create(native, W * scale, H * scale, probeShader);
  let reference;
  try {
    for (const compiled of [false, true]) {
      const host = Host.create(native);
      const errors = [];
      host.onStyleErrors((e) => errors.push(...e));
      try {
        const sheet = host.layout.addStyleSheet(compiled ? compileCss(css).bytes : css);
        assert.deepEqual(sheet.diagnostics, []);
        const cells = fixtures.map((_, i) => {
          const cell = host.createElement('div');
          cell.className = `cell f${i}`;
          const child = host.createElement('div');
          child.setAttribute('style', 'width:4px;height:4px');
          cell.appendChild(child);
          host.root.appendChild(cell);
          return cell;
        });
        const mixed = host.createElement('div');
        mixed.className = 'cell mixed';
        host.root.appendChild(mixed);
        host.compute(W, H);
        const capture = async () => {
          host.compute(W, H);
          const renderer = new SceneRenderer(target.device, host.layout);
          const pixels = new Uint8Array(W * H * scale * scale * 4);
          try {
            await target.captureCommandsInto(
              pixels,
              (e, v) =>
                renderer.encode(e, host.root.layoutNode, v, {
                  width: W * scale,
                  height: H * scale,
                  scale,
                }).drawCalls,
            );
            return pixels;
          } finally {
            renderer.dispose();
          }
        };
        let pixels = await capture();
        await writeFile(
          new URL(`patterns-${compiled ? 'compiled' : 'runtime'}-${scale}x.png`, output),
          PNG.sync.write({ width: W * scale, height: H * scale, data: Buffer.from(pixels) }),
        );
        const at = (x, y) =>
          pixels[(Math.floor(y * scale) * W * scale + Math.floor(x * scale)) * 4];
        const horizontal = (x, y, length) =>
          Array.from({ length: length * scale }, (_, i) => at(x + i / scale, y));
        const vertical = (x, y, length) =>
          Array.from({ length: length * scale }, (_, i) => at(x, y + i / scale));
        for (const [i, f] of fixtures.entries()) {
          const [x, y, w, h] = cells[i].bounds();
          const label = `${f.style}, ${f.width}px, radius ${f.radius}, ${scale}x`;
          assert.deepEqual([w, h], [180, 72], label);
          assert.deepEqual(cells[i].firstChild.bounds().slice(0, 2), [x + f.width, y + f.width]);
          const row = horizontal(x + 20, y + f.width / 2, w - 40);
          assert(runs(row, 90) >= 4, `${label}: separate marks on the top`);
          assert(row.filter((v) => v < 30).length > row.length / 8, `${label}: clear gaps`);
          const widths = markWidths(row, 90).map((width) => width / scale);
          const expected = f.width * (f.style === 'dashed' ? 3 : 1);
          assert(
            widths.length > 2 && widths.every((width) => Math.abs(width - expected) <= 1),
            `${label}: mark lengths follow text-decoration widths`,
          );
          const column = vertical(x + w - f.width / 2, y + 20, h - 40);
          assert(runs(column, 90) >= 2, `${label}: separate marks on the right`);
          assert(at(x + w / 2, y + h / 2) < 5, `${label}: centre stays clear`);
          if (f.radius) {
            assert(at(x + 0.5, y + 0.5) < 10, `${label}: rounded outer corner stays clear`);
            const corner = [];
            for (let dy = 0; dy < 16; dy += 1 / scale) {
              for (let dx = 0; dx < 16; dx += 1 / scale) {
                corner.push(at(x + dx, y + dy));
              }
            }
            assert(
              corner.some((v) => v > 90),
              `${label}: marks follow the corner curve`,
            );
          }
          if (f.style === 'dotted' && f.width === 3 && scale === 2) {
            const middle = horizontal(x + 20, y + 1.5, w - 40);
            const gap = middle.findIndex((v) => v < 30);
            const first = middle.findIndex((v, i) => i > gap && v > 230);
            let last = first;
            while (middle[last + 1] > 230) {
              last++;
            }
            const cx = x + 20 + (first + last + 1) / (2 * scale);
            assert(at(cx, y + 1.5) > 230, `${label}: dot centre is covered`);
            assert(at(cx - 1.25, y + 0.25) < 200, `${label}: dot corners are round`);
          }
        }
        const [mx, my, mw, mh] = mixed.bounds();
        assert(runs(horizontal(mx + 20, my + 1.5, mw - 40), 90) >= 4, 'mixed top is dashed');
        assert(runs(vertical(mx + mw - 1.5, my + 20, mh - 40), 90) >= 2, 'mixed right is dotted');
        assert(
          horizontal(mx + 20, my + mh - 1.5, mw - 40).every((v) => v > 200),
          'mixed bottom is solid',
        );
        assert(
          vertical(mx + 0.5, my + 20, mh - 40).every((v) => v < 10),
          'mixed left is absent',
        );
        assert.deepEqual(errors, []);
        if (reference) {
          assert.deepEqual(pixels, reference, 'compiled and runtime sheets draw identical pixels');
        } else {
          reference = pixels;
        }

        const first = cells[0];
        const [fx, fy, fw] = first.bounds();
        first.setAttribute('style', 'border-top-style:solid');
        pixels = await capture();
        assert(
          horizontal(fx + 20, fy + 0.5, fw - 40).every((v) => v > 200),
          'a side style replaces its shorthand pattern',
        );
        assert(runs(vertical(fx + fw - 0.5, fy + 20, 32), 90) >= 2, 'other sides keep dashes');
        first.setAttribute('style', 'border-top:3px dotted white');
        pixels = await capture();
        assert(runs(horizontal(fx + 20, fy + 1.5, fw - 40), 90) >= 10, 'side shorthand sets dots');
        assert.deepEqual(first.firstChild.bounds().slice(0, 2), [fx + 1, fy + 3]);
        first.setAttribute('style', 'border-style:none;border-width:3px');
        pixels = await capture();
        assert(
          horizontal(fx + 20, fy + 0.5, fw - 40).every((v) => v < 10),
          'none removes paint',
        );
        assert.deepEqual(
          first.firstChild.bounds().slice(0, 2),
          [fx, fy],
          'none removes layout width',
        );
        first.setAttribute('style', '');
        pixels = await capture();
        assert.deepEqual(
          pixels,
          reference,
          'removing inline styles restores all stylesheet patterns',
        );
        for (const sample of [cells[3], cells[6]]) {
          sample.setAttribute('style', 'border-color:rgba(255,255,255,0.5)');
          pixels = await capture();
          const [cx, cy] = sample.bounds();
          let peak = 0;
          for (let dy = 0; dy < 18 * scale; dy++) {
            for (let dx = 0; dx < 25 * scale; dx++) {
              peak = Math.max(peak, at(cx + dx / scale, cy + dy / scale));
            }
          }
          assert(peak <= 190, 'corner marks preserve border colour alpha without overlapping');
          sample.setAttribute('style', '');
        }
        assert.deepEqual(errors, []);
      } finally {
        host.dispose();
      }
    }
  } finally {
    target.dispose();
  }
}
console.log(
  'Native border patterns: dashed/dotted, 1px/3px, square/round, per-side and runtime/compiled pixels at 1x/2x passed',
);
