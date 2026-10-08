import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { PNG } from 'pngjs';
import { loadNative, Brush, LayoutOverflow } from '../dist/native/index.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

// --addon/--verify compare optimized paint walks with an unchanged producer,
// in separate processes using the same GPU and fonts. No reference regeneration.
const { values } = parseArgs({
  options: {
    addon: { type: 'string' },
    verify: { type: 'string' },
    output: { type: 'string', default: '.blinc/renderer/clipping' },
  },
});
const api = values.addon ? loadNative(resolve(values.addon)) : loadNative();
const layout = api.createLayout();
const root = layout.createNode({ width: 640, height: 440 });
root.setPaint({ background: Brush.solid(0x101722), textColor: [1, 1, 1, 1] });
// Position without a visual-size override, which would itself clip overflow.
function box(x, y, w, h, paint = {}, children = []) {
  const anchor = layout.createNode({ width: 0, height: 0, shrink: 0 });
  anchor.setVisual([x, y, -1, 0]);
  const node = layout.createNode({ width: w, height: h, shrink: 0 });
  node.setPaint(paint);
  node.setChildren(children.map((child) => child.anchor));
  anchor.setChildren([node]);
  return { anchor, node };
}
const solid = (hex) => ({ background: Brush.solid(hex) });
const rows = Array.from({ length: 40 }, (_, i) => {
  const row = box(0, i * 28, 300, 28, solid(i % 2 ? 0x304857 : 0x263744));
  const label = layout.createText(
    `Row ${i} — fj Åg`,
    {
      fontFamily: 'Arial',
      fontSize: 20,
      italic: true,
      letterSpacing: -0.25,
      wrap: false,
    },
    { width: 270, height: 28, shrink: 0 },
  );
  label.setVisual([6.375, -1.25, -1, 0]);
  row.node.setChildren([label]);
  return row;
});
const list = box(20, 20, 300, 180, { radius: [18.375, 18.375, 18.375, 18.375] }, rows);
list.node.setStyle({ overflow: LayoutOverflow.Hidden });
const overflowChild = box(-65, 0, 60, 30, solid(0x72dbc8));
const overflowParent = box(280, 12, 20, 30, solid(0xff00ff), [overflowChild]);
const shadow = box(-35, 55, 25, 38, {
  ...solid(0xff00ff),
  shadows: [{ x: 35, y: 0, blur: 8, spread: 2, color: [1, 0.3, 0.2, 1] }],
});
const transformed = box(-60, 110, 45, 38, {
  ...solid(0x68a6ee),
  transform: [0.92, 0.3, -0.3, 0.92, 85, 0],
});
const edge = box(-4, 40, 4.5, 4, solid(0xffffff));
const panel = box(
  355,
  20,
  260,
  180,
  { ...solid(0x1b2734), radius: [18.375, 18.375, 18.375, 18.375] },
  [overflowParent, shadow, transformed, edge],
);
panel.node.setStyle({ overflow: LayoutOverflow.Hidden });
const glass = box(30, 36, 120, 75, {
  background: Brush.glass(0, 0xffffff, 0.04, { bevel: 0.18, aberration: 1, inset: true }),
  radius: [18.375, 18.375, 18.375, 18.375],
});
const filtered = box(
  20,
  244,
  300,
  160,
  {
    opacity: 0.7,
    filter: { blur: 2, dropShadow: { x: 5, y: 8, blur: 8, color: [0.1, 0.5, 1, 1] } },
    maskImage: Brush.linear(0, 0, 1, 0, true).stop(0, 0xffffff, 0.3).stop(1, 0xffffff, 1),
  },
  [box(-25, -20, 280, 165, solid(0x385f80)), box(350, 40, 30, 40, solid(0xff0000)), glass],
);
filtered.node.setStyle({ overflow: LayoutOverflow.Hidden });
const rotated = box(
  370,
  252,
  230,
  145,
  {
    ...solid(0x273e55),
    transform: [0.97, 0.17, -0.17, 0.97, 0, 0],
    radius: [18.375, 18.375, 18.375, 18.375],
  },
  [box(-20, -30, 130, 180, solid(0x669ed6)), box(280, 40, 40, 40, solid(0xff0000))],
);
rotated.node.setStyle({ overflow: LayoutOverflow.Hidden });
// A retained canvas record must survive culling even when the renderer can
// skip its callback under its established scissor/target rules.
const canvas = box(400, 0, 20, 20);
canvas.node.setResource(17, true);
const canvasClip = box(0, 0, 1, 1, {}, [canvas]);
canvasClip.node.setStyle({ overflow: LayoutOverflow.Hidden });
root.setChildren([list, panel, filtered, rotated, canvasClip].map((item) => item.anchor));
layout.compute(root, 640, 440);
await mkdir(values.output, { recursive: true });
try {
  for (const scale of [1, 2]) {
    const target = await OffscreenRenderer.create(api, 640 * scale, 440 * scale, probeShader);
    const renderer = new SceneRenderer(target.device, layout);
    try {
      let previous;
      for (const scroll of [0, 43, 260]) {
        list.node.setScroll(0, scroll);
        const options = {
          width: 640 * scale,
          height: 440 * scale,
          scale,
          cornerShape: Math.fround(Math.log2(Math.fround(2.52))),
        };
        const info = layout.prepareDisplayList(root, options);
        const records = new Float32Array(info.floats);
        layout.readDisplayList(records);
        const kinds = Array.from({ length: info.count }, (_, i) => records[i * 112 + 44]);
        assert.equal(kinds.filter((kind) => kind === 33).length, 1, 'Keep canvas records');
        assert(kinds.includes(3) && kinds.includes(7) && kinds.includes(40) && kinds.includes(42));
        if (!values.addon) {
          assert(info.count < 150, 'Clipped rows must not generate their glyph and box records');
        }
        const pixels = new Uint8Array(640 * scale * 440 * scale * 4);
        let stats;
        const capture = () =>
          target.captureCommandsInto(pixels, (encoder, view) => {
            stats = renderer.encode(encoder, root, view, options);
            return stats.drawCalls;
          });
        await capture();
        const first = Buffer.from(pixels);
        await capture();
        assert.deepEqual(Buffer.from(pixels), first, 'Warm frames preserve pixels');
        assert.equal(stats.atlasBytes, 0);
        if (previous) {
          assert.notDeepEqual(first, previous, 'Scrolling reveals different rows');
        }
        previous = first;
        const name = `${scale}x-scroll-${scroll}.png`;
        await writeFile(
          join(values.output, name),
          PNG.sync.write({ width: 640 * scale, height: 440 * scale, data: first }),
        );
        if (values.verify) {
          const reference = PNG.sync.read(await readFile(join(values.verify, name)));
          assert.deepEqual(first, reference.data, `${name}: culling must preserve every pixel`);
        }
        console.log(`${name}: ${stats.primitives} primitives, ${stats.drawCalls} draws`);
      }
    } finally {
      renderer.dispose();
      target.dispose();
    }
  }
} finally {
  layout.dispose();
}
