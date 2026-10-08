import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { compare } from '../tools/snapshot/image.mjs';
import { PNG } from 'pngjs';
import { loadNative, Brush, ImageFit, LayoutOverflow } from '../dist/native/index.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';
const native = loadNative();
const layout = native.createLayout();
const target = await OffscreenRenderer.create(native, 640, 440, probeShader);
let renderer;
const output = new URL('../.blinc/renderer/', import.meta.url);
await mkdir(output, { recursive: true });
try {
  renderer = new SceneRenderer(target.device, layout);
  const root = layout.createNode({ width: 640, height: 440 });
  root.setPaint({ background: Brush.solid(0x101722), textColor: [1, 1, 1, 1] });
  const nodes = [];
  const box = (x, y, width, height, background, paint = {}) => {
    const node = layout.createNode({ width: 0, height: 0, shrink: 0 });
    node.setVisual([x, y, width, height]);
    node.setPaint({ background, ...paint });
    nodes.push(node);
    return node;
  };
  box(
    20,
    64,
    600,
    230,
    Brush.linear(0, 0, 1, 1, true).stop(0, 0x173d8a).stop(0.5, 0x8a3155).stop(1, 0x087c70),
    { radius: [28, 28, 28, 28] },
  );
  box(90, 80, 148, 148, Brush.radial(0.5, 0.5, 0.5, true).stop(0, 0xffc875).stop(1, 0xe96442), {
    radius: [74, 74, 74, 74],
  });
  box(338, 152, 170, 170, Brush.solid(0x42cbbe), { radius: [85, 85, 85, 85] });
  // High contrast lines make real refraction and chromatic separation measurable.
  for (let x = 42; x < 605; x += 32) {
    box(x, 100, 3, 174, Brush.solid(0xffffff, 0.72));
  }
  const glass = box(
    48,
    112,
    256,
    144,
    Brush.glass(1, 0xffffff, 0.06, { bevel: 0.18, aberration: 0, inset: true }),
    { radius: [24, 24, 24, 24] },
  );
  box(334, 112, 256, 144, Brush.blur(8, 0xffffff, 0.08), {
    radius: [24, 24, 24, 24],
    borderWidth: 1,
    borderColor: [1, 1, 1, 0.3],
  });
  box(26, 334, 122, 78, Brush.linear(0, 0, 1, 0, true).stop(0, 0x699cfa).stop(1, 0x64dec4), {
    radius: [18, 18, 18, 18],
    borderWidth: 2,
    borderColor: [0.85, 0.95, 1, 0.8],
    shadows: [{ x: 0, y: 6, blur: 12, spread: 2, color: [0, 0, 0, 0.7] }],
  });
  const clip = box(178, 334, 120, 78, Brush.solid(0x263544), { radius: [18, 18, 18, 18] });
  clip.setStyle({ overflow: LayoutOverflow.Hidden });
  const overflow = layout.createNode({ width: 140, height: 110, shrink: 0 });
  overflow.setPaint({ background: Brush.solid(0x4c8fc2) });
  clip.setChildren([overflow]);
  const labels = [];
  const label = (x, y, text, size) => {
    const node = layout.createText(text, { fontSize: size, wrap: false });
    node.setStyle({ width: 0, height: 0, shrink: 0 });
    node.setVisual([x, y, 560, 36]);
    nodes.push(node);
    labels.push(node);
    return node;
  };
  label(24, 18, 'Brushes, rendered natively', 26);
  label(66, 202, 'Liquid glass', 21);
  label(352, 202, 'Backdrop blur', 21);
  label(324, 352, 'Text stays sharp', 20);
  label(324, 382, 'Rounded edges · gradients · shadows', 12);
  root.setChildren(nodes);
  layout.compute(root, 640, 440);
  let stats;
  const capture = async (name, paint = {}) => {
    const pixels = new Uint8Array(640 * 440 * 4);
    await target.captureCommandsInto(pixels, (encoder, view) => {
      stats = renderer.encode(encoder, root, view, { width: 640, height: 440, ...paint });
      return stats.drawCalls;
    });
    await writeFile(
      new URL(name + '.png', output),
      PNG.sync.write({ width: 640, height: 440, data: Buffer.from(pixels) }),
    );
    return pixels;
  };
  const plain = await capture('brushes');
  const frameStats = { ...stats };
  assert(stats.primitives > 80);
  assert(stats.drawCalls < 20, 'Contiguous box and glyph runs must be batched');
  assert(stats.atlasBytes > 0);
  assert.deepEqual(await capture('repeat'), plain);
  assert.equal(stats.atlasBytes, 0, 'Unchanged glyph atlases must not be uploaded again');
  const pixel = (pixels, x, y) => [...pixels.slice((y * 640 + x) * 4, (y * 640 + x) * 4 + 4)];
  assert.deepEqual(pixel(plain, 0, 0), [16, 23, 34, 255]);
  assert.deepEqual(pixel(plain, 180, 336), [16, 23, 34, 255], 'Rounded overflow clip');
  assert.deepEqual(pixel(plain, 210, 365), [76, 143, 194, 255], 'Clipped content visible inside');
  glass.setPaint({
    background: Brush.glass(1, 0xffffff, 0.06, { bevel: 0.18, aberration: 1, inset: true }),
  });
  const chromatic = await capture('aberration');
  let edgeChanges = 0;
  for (let y = 112; y < 256; y++) {
    for (let x = 48; x < 304; x++) {
      const a = pixel(plain, x, y),
        b = pixel(chromatic, x, y);
      if (a.some((v, i) => Math.abs(v - b[i]) > 2)) {
        edgeChanges++;
      }
    }
  }
  assert(edgeChanges > 300, 'Aberration must visibly change the rim at a fixed reduced bevel');
  for (let y = 140; y < 180; y++) {
    for (let x = 80; x < 270; x++) {
      assert.deepEqual(
        pixel(plain, x, y),
        pixel(chromatic, x, y),
        'Aberration leaves the clear center alone',
      );
    }
  }
  assert.deepEqual(
    pixel(plain, 450, 180),
    pixel(chromatic, 450, 180),
    'Later unrelated backdrop unchanged',
  );
  // Export the same geometric display list for comparison against an independent renderer.
  for (const label of labels) {
    label.setPaint({ visible: false });
  }
  // A fractional shape, radius and border width expose any integer conversion in the pipeline.
  const fractionalShape = Math.fround(Math.log2(Math.fround(2.52)));
  const variants = ['geometry', 'squircle', 'fractional'];
  for (const name of variants) {
    const n = name === 'fractional' ? fractionalShape : 2;
    const shapeOptions =
      name === 'geometry' ? {} : { cornerShape: n, smoothingThreshold: 0, fullRadius: 9999 };
    if (name === 'fractional') {
      glass.setPaint({
        radius: [24.375, 24.375, 24.375, 24.375],
        borderWidth: 1.375,
        borderColor: [1, 0.8, 0.6, 0.4],
      });
    }

    for (const scale of [1, 2]) {
      const info = layout.prepareDisplayList(root, { scale, ...shapeOptions });
      const records = new Float32Array(info.floats);
      layout.readDisplayList(records);
      if (name !== 'geometry') {
        const rows = Array.from({ length: info.count }, (_, i) =>
          records.subarray(i * 112, (i + 1) * 112),
        );
        assert(
          rows.some((r) => r[44] === 42 && r[48] === n),
          'Glass uses the squircle shape',
        );
        assert(
          rows.some((r) => r[44] === 3 && r[48] === n),
          'Shadow uses the squircle shape',
        );
        assert(
          rows.some((r) => r[47] === n),
          'Children inherit the squircle clip',
        );
        const circle = rows.find((r) => r[44] === 0 && r[0] === 90 && r[1] === 80);
        assert(circle);
        assert.deepEqual([...circle.slice(48, 52)], [1, 1, 1, 1], 'Full-radius circle stays round');
        if (name === 'fractional') {
          const glassBox = rows.find((r) => r[44] === 0 && r[0] === 48 && r[1] === 112);
          assert(glassBox);
          assert.deepEqual(
            [...glassBox.slice(4, 8)],
            [24.375, 24.375, 24.375, 24.375],
            'Radii preserve fractions',
          );
          assert.deepEqual(
            [...glassBox.slice(16, 20)],
            [1.375, 1.375, 1.375, 1.375],
            'Border widths preserve fractions',
          );
          assert.deepEqual(
            [...glassBox.slice(48, 52)],
            [n, n, n, n],
            'Corner exponents preserve fractions',
          );
        }
      }
      await writeFile(
        new URL(`records-${name}-${scale}x.json`, output),
        JSON.stringify({
          count: info.count,
          width: 640,
          height: 440,
          scale,
          records: [...records],
        }),
      );
      if (scale === 1) {
        await capture(`${name}-1x`, shapeOptions);
        continue;
      }
      const high = await OffscreenRenderer.create(native, 1280, 880, probeShader);
      const highRenderer = new SceneRenderer(high.device, layout);
      try {
        const pixels = new Uint8Array(1280 * 880 * 4);
        await high.captureCommandsInto(
          pixels,
          (encoder, view) =>
            highRenderer.encode(encoder, root, view, {
              width: 1280,
              height: 880,
              scale: 2,
              ...shapeOptions,
            }).drawCalls,
        );
        await writeFile(
          new URL(`${name}-2x.png`, output),
          PNG.sync.write({ width: 1280, height: 880, data: Buffer.from(pixels) }),
        );
      } finally {
        highRenderer.dispose();
        high.dispose();
      }
    }
  }
  glass.setPaint({ radius: [24, 24, 24, 24], borderWidth: 0, borderColor: [0, 0, 0, 0] });
  const references = [];
  for (const name of variants) {
    for (const scale of [1, 2]) {
      const current = PNG.sync.read(await readFile(new URL(`${name}-${scale}x.png`, output)));
      const reference = PNG.sync.read(
        await readFile(new URL(`fixtures/renderer/${name}-${scale}x.png`, import.meta.url)),
      );
      const comparison = compare(current, reference, 2);
      await writeFile(
        new URL(`diff-${name}-${scale}x.png`, output),
        PNG.sync.write({
          width: current.width,
          height: current.height,
          data: Buffer.from(comparison.diff),
        }),
      );
      assert.equal(comparison.changedPixels, 0, `${name} ${scale}x reference comparison`);
      references.push({
        name,
        scale,
        maximumDelta: comparison.maximumDelta,
        changedPixels: comparison.changedPixels,
      });
    }
  }
  const rounded = PNG.sync.read(await readFile(new URL('geometry-1x.png', output)));
  const squircle = PNG.sync.read(await readFile(new URL('squircle-1x.png', output)));
  assert(
    compare(squircle, rounded, 2).changedPixels > 1000,
    'Squircle corners must differ visibly from circular corners',
  );
  for (const label of labels) {
    label.setPaint({ visible: true });
  }

  // Dirty glyph atlas update and reusable image atlas grow: no full-frame rerasterization.
  const glyph = label(24, 302, 'New glyphs: Ω Ж 漢', 16);
  root.setChildren(nodes);
  layout.compute(root, 640, 440);
  await capture('atlas-update');
  assert(stats.atlasBytes > 0);
  await capture('atlas-repeat');
  assert.equal(stats.atlasBytes, 0);
  glyph.remove();
  nodes.pop();
  const image = native.rasterizeSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#e07343"/></svg>',
    40,
    40,
  );
  try {
    renderer.setImage(0, image, 40, 40);
    // Force growth while preserving the first image's pixels.
    renderer.setImage(1, image, 300, 300);
    // Re-registering a cached asset must not consume more atlas space.
    for (let i = 0; i < 256; i++) {
      renderer.setImage(1, image, 300, 300);
    }
    layout.setImageSource('fixture', ImageFit.Fill, 0);
    box(530, 330, 40, 40, Brush.image('fixture', ImageFit.Fill));
    root.setChildren(nodes);
    layout.compute(root, 640, 440);
    const pictured = await capture('image-atlas');
    assert.deepEqual(pixel(pictured, 550, 350), [224, 115, 67, 255]);
  } finally {
    image.dispose();
  }
  // Zero blur must be finite and leave an opaque backdrop unchanged.
  glass.setPaint({ background: Brush.blur(0) });
  const zero = await capture('zero-blur-filter');
  glass.setPaint({ visible: false });
  const behind = await capture('without-glass');
  for (let y = 140; y < 180; y++) {
    for (let x = 80; x < 270; x++) {
      assert.deepEqual(pixel(zero, x, y), pixel(behind, x, y), 'Zero blur is an identity filter');
    }
  }
  // Removing blur from glass must retain its material, lens and adjustable dispersion.
  glass.setPaint({
    visible: true,
    background: Brush.glass(0, 0xffffff, 0.06, { bevel: 0.18, aberration: 0, inset: true }),
  });
  const clearGlass = await capture('zero-blur-no-aberration');
  glass.setPaint({
    background: Brush.glass(0, 0xffffff, 0.06, { bevel: 0.18, aberration: 1, inset: true }),
  });
  const clearChromatic = await capture('zero-blur');
  const clearInfo = layout.prepareDisplayList(root);
  const clearRecords = new Float32Array(clearInfo.floats);
  layout.readDisplayList(clearRecords);
  const clearRecord = Array.from({ length: clearInfo.count }, (_, i) =>
    clearRecords.subarray(i * 112, (i + 1) * 112),
  ).find((r) => r[44] === 42 && r[0] === 48 && r[1] === 112);
  assert(clearRecord);
  assert.equal(clearRecord[8], 0, 'Glass blur remains zero');
  assert.equal(clearRecord[40], 1, 'Zero blur retains the liquid material');
  assert.equal(clearRecord[41], Math.fround(-0.18), 'Bevel and inset remain unchanged');
  assert.equal(clearRecord[56], 1, 'Zero blur retains chromatic aberration');
  let zeroBlurEdgeChanges = 0;
  for (let y = 112; y < 256; y++) {
    for (let x = 48; x < 304; x++) {
      const a = pixel(clearGlass, x, y),
        b = pixel(clearChromatic, x, y);
      if (a.some((v, i) => Math.abs(v - b[i]) > 2)) {
        zeroBlurEdgeChanges++;
      }
    }
  }
  assert(zeroBlurEdgeChanges > 300, 'Zero-blur glass keeps visible chromatic separation');
  for (let y = 140; y < 180; y++) {
    for (let x = 80; x < 270; x++) {
      assert.deepEqual(
        pixel(clearGlass, x, y),
        pixel(clearChromatic, x, y),
        'Clear center is unaffected by aberration',
      );
    }
  }
  for (let y = 100; y < 270; y++) {
    for (let x = 330; x < 605; x++) {
      assert.deepEqual(
        pixel(clearGlass, x, y),
        pixel(clearChromatic, x, y),
        'Separate blur card is unchanged',
      );
    }
  }
  glass.setPaint({
    background: Brush.glass(1, 0xffffff, 0.06, { bevel: 0.18, aberration: 1, inset: true }),
  });
  root.setPaint({ background: Brush.solid(0, 0) });
  root.setChildren([glass]);
  layout.compute(root, 640, 440);
  const transparent = await capture('transparent-glass');
  assert.equal(pixel(transparent, 0, 0)[3], 0);
  assert(
    pixel(transparent, 100, 160)[3] > 0 && pixel(transparent, 100, 160)[3] < 40,
    'Glass preserves transparency',
  );
  console.log(
    JSON.stringify({
      ...frameStats,
      edgeChanges,
      zeroBlurEdgeChanges,
      fractionalShape,
      references,
      output: output.pathname,
    }),
  );
} finally {
  renderer?.dispose();
  target.dispose();
  layout.dispose();
}
