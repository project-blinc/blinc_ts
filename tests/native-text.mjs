import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { Brush, Paragraph, loadNative } from '../dist/native/index.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative();

// Measurement: lines, metrics and caret stops, in UTF-16 indices.
const style = { fontSize: 16, lineHeight: 1.5 };
const text = 'Hi 😀 there\n\nwrapping words go here';
const one = native.measureText(text, style);
assert.equal(one.lineCount, 3);
assert.equal(one.lineHeight, 24);
assert(one.ascender > 0 && one.descender < 0);
assert.deepEqual(
  one.lines.map((l) => [l.start, l.end]),
  [
    [0, 11],
    [12, 12],
    [13, text.length],
  ],
);
const carets = one.carets;
assert(
  carets.some((c) => c.index === 5) && !carets.some((c) => c.index === 4),
  'Emoji is one stop',
);
assert.equal(one.caretAt(4).index, 3, 'Inside a surrogate pair snaps to its start');
assert(carets.every((c, i) => i === 0 || c.index > carets[i - 1].index));
const end = one.caretAt(text.length);
assert.equal(end.line, 2);
assert.equal(end.x, one.line(2).width);
assert.equal(one.caretNear(end.x + 50, 2.5 * 24).index, text.length);
assert.equal(one.caretNear(-5, 0).index, 0);
const wrapped = native.measureText(text, style, one.line(2).width / 2);
assert(wrapped.lineCount > 3);
assert(native.measureText(text, { ...style, letterSpacing: 2 }).width > one.width);
assert(
  native.measureText('W', { fontSize: 32, fontWeight: 700 }).width >
    native.measureText('W', { fontSize: 16 }).width,
);
assert.throws(() => native.measureText('x', style, -1), /non-negative/);

// Inline layout: runs in different styles wrap together on one baseline.
const items = [
  { kind: 'text', text: 'A paragraph with ', style: { fontSize: 16 } },
  { kind: 'text', text: 'large bold', style: { fontSize: 28, fontWeight: 700 } },
  { kind: 'text', text: '  words that wrap across lines.  ', style: { fontSize: 16 } },
];
const natural = native.layoutInline(items, 10000);
assert.equal(natural.lines.length, 1);
assert.equal(
  natural.texts[2],
  ' words that wrap across lines. ',
  'Runs of whitespace collapse to one space',
);
const [small, large] = natural.fragments;
assert(large.y < small.y, 'The larger run reaches higher');
assert(Math.abs(small.y + small.height - (large.y + large.height)) < 4, 'Runs share a line');
const width = Math.ceil(natural.maxContent / 2);
const narrow = native.layoutInline(items, width);
assert(narrow.lines.length >= 2);
assert(narrow.fragments.every((f) => f.x + f.width <= width + 0.5));
const right = native.layoutInline(items, width, { align: 'right' });
const lastOnLine = (laid, line) =>
  Math.max(...laid.fragments.filter((f) => f.line === line).map((f) => f.x + f.width));
assert(Math.abs(lastOnLine(right, 0) - width) < 0.5);
const justified = native.layoutInline(items, width, { align: 'justify' });
assert(Math.abs(lastOnLine(justified, 0) - width) < 0.5);
assert(
  lastOnLine(justified, justified.lines.length - 1) < width - 1,
  'The last line is not stretched',
);
assert.throws(() => native.layoutInline(items, 100, { align: 'middle' }), /alignment/);

// A paragraph in a layout tree, drawn.
const layout = native.createLayout();
try {
  const root = layout.createNode({ width: 360, height: 200, padding: 12 });
  root.setPaint({ background: Brush.solid(0x101722) });
  const paragraph = new Paragraph(native, layout, 'center');
  paragraph.runs = [
    { text: 'Inline runs ', style: { fontSize: 18 }, paint: { textColor: [1, 1, 1, 1] } },
    {
      text: 'in different styles',
      style: { fontSize: 26, fontWeight: 700 },
      paint: { textColor: [1, 0.6, 0.2, 1] },
    },
    {
      text: ' wrap together, centred, on shared baselines.',
      style: { fontSize: 18, italic: true },
      paint: { textColor: [0.6, 0.8, 1, 1] },
    },
  ];
  root.append(paragraph.node);
  const height = paragraph.update(336);
  assert(height > 40);
  layout.compute(root, 360, 200);
  const bounds = new Float32Array(4);
  layout.readBounds([paragraph.node], bounds);
  assert.deepEqual([...bounds], [12, 12, 336, height]);
  const target = await OffscreenRenderer.create(native, 360, 200, probeShader);
  const renderer = new SceneRenderer(target.device, layout);
  try {
    const pixels = new Uint8Array(360 * 200 * 4);
    await target.captureCommandsInto(
      pixels,
      (encoder, view) =>
        renderer.encode(encoder, root, view, { width: 360, height: 200, scale: 1 }).drawCalls,
    );
    const output = new URL('../.blinc/text/', import.meta.url);
    await mkdir(output, { recursive: true });
    await writeFile(
      new URL('paragraph.png', output),
      PNG.sync.write({ width: 360, height: 200, data: Buffer.from(pixels) }),
    );
    // Orange text appears on the line of the bold run.
    let orange = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 200 && pixels[i + 1] > 100 && pixels[i + 1] < 200 && pixels[i + 2] < 120) {
        orange++;
      }
    }
    assert(orange > 50, 'The bold run is drawn in its colour');
  } finally {
    renderer.dispose();
    target.dispose();
  }
  // Narrower, it wraps to more lines and grows taller.
  assert(paragraph.update(160) > height);
} finally {
  layout.dispose();
}
// Runs of different sizes, weights, families and line heights on one line
// share a baseline as drawn. Each run is drawn alone in white, the others
// transparent, and its baseline is the bottom edge of its x's ink (no
// descenders), to a fraction of a pixel from the last row's coverage.
{
  const W = 520;
  const H = 110;
  const styles = [
    { fontSize: 18 },
    { fontSize: 26, fontWeight: 700 },
    { fontSize: 18, italic: true },
    { fontSize: 13 },
    { fontSize: 22, lineHeight: 2 },
    { fontSize: 16, fontFamily: 'serif' },
    { fontSize: 15, fontFamily: 'monospace', lineHeight: 1.6 },
  ];
  const layout = native.createLayout();
  try {
    const root = layout.createNode({ width: W, height: H, padding: 7 });
    root.setPaint({ background: Brush.solid(0) });
    const paragraph = new Paragraph(native, layout);
    root.append(paragraph.node);
    for (const scale of [1, 2]) {
      const target = await OffscreenRenderer.create(native, W * scale, H * scale, probeShader);
      const renderer = new SceneRenderer(target.device, layout);
      try {
        const baselines = [];
        for (let only = 0; only < styles.length; only++) {
          paragraph.runs = styles.map((style, i) => ({
            text: i ? ' xxx' : 'xxx',
            style,
            paint: { textColor: i === only ? [1, 1, 1, 1] : [0, 0, 0, 0] },
          }));
          paragraph.update(W - 14);
          assert.equal(paragraph.laidOut.lines.length, 1);
          layout.compute(root, W, H);
          const pixels = new Uint8Array(W * H * scale * scale * 4);
          await target.captureCommandsInto(
            pixels,
            (encoder, view) =>
              renderer.encode(encoder, root, view, { width: W * scale, height: H * scale, scale })
                .drawCalls,
          );
          const rows = Array.from({ length: H * scale }, (_, y) => {
            let sum = 0;
            for (let x = 0; x < W * scale; x++) {
              sum += pixels[(y * W * scale + x) * 4];
            }
            return sum;
          });
          let last = rows.length - 1;
          while (last > 0 && rows[last] === 0) {
            last--;
          }
          baselines.push((last + rows[last] / Math.max(...rows)) / scale);
        }
        const spread = Math.max(...baselines) - Math.min(...baselines);
        assert(spread < 1, `Baselines at scale ${scale}: ${baselines.map((b) => b.toFixed(2))}`);
        const expected = 7 + paragraph.laidOut.lines[0].baseline;
        assert(
          baselines.every((b) => Math.abs(b - expected) <= 1),
          `Baseline near ${expected}`,
        );
      } finally {
        renderer.dispose();
        target.dispose();
      }
    }
  } finally {
    layout.dispose();
  }
}
console.log('Native text: measurement, caret stops, inline runs and paragraphs passed');
