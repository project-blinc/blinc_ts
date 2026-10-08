import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PNG } from 'pngjs';
import { AppSession } from '../dist/hmr.js';
import {
  loadNative,
  LayoutDirection,
  ImageFit,
  sceneSchema,
  gpu,
  Brush,
} from '../dist/native/index.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { sceneProbeShader } from '../dist/renderer/shaders.js';
import { bindingSchema, bind } from '../dist/native/generated/scene.js';

const addon = createRequire(import.meta.url)('../native/blinc_ts.node');
assert.equal(addon.sceneCall(0xffffffff, []), bindingSchema);
assert.throws(() => bind({ call: () => 'old-scene' }), /schema mismatch/);
assert.deepEqual(addon.sceneSchema(), sceneSchema);
const output = new URL('../.blinc/scene-adapter/', import.meta.url);
await mkdir(output, { recursive: true });
const stale = new URL('stale-addon.cjs', output);
// Resolve a stale producer through the real public loader, not just the validator.
await writeFile(
  stale,
  `module.exports = { ...require('../../native/blinc_ts.node'), sceneSchema: () => ({ version: 0, recordFloats: 112, recordRows: 28 }) };`,
);
try {
  assert.throws(() => loadNative(stale), /scene schema mismatch/);
} finally {
  await rm(stale);
}
const native = loadNative();
const session = new AppSession({ dispose() {} });
const png = PNG.sync.write({
  width: 2,
  height: 1,
  data: Buffer.from([255, 80, 60, 255, 40, 170, 240, 255]),
});
const first = session.mount((_, scope) => ({
  layout: native.createLayout(scope),
  image: native.decodeImage(png, scope),
}));
const layout = first.layout;
const owned = [];
const keep = (resource) => {
  owned.push(resource);
  return resource;
};
let renderer;
try {
  const root = layout.createNode({
    width: 360,
    height: 180,
    padding: 20,
    gap: 12,
    direction: LayoutDirection.Column,
  });
  root.setPaint({ background: Brush.solid([0.05, 0.08, 0.12, 1]), textColor: [0.9, 0.95, 1, 1] });
  const title = layout.createText('Native scenes', { fontSize: 26, fontWeight: 600, wrap: false });
  const row = layout.createNode({ gap: 16, height: 56, shrink: 0 });
  const imageNode = layout.createNode({ width: 56, height: 56, shrink: 0 });
  layout.setImageSource('fixture:image', ImageFit.Fill, 0);
  imageNode.setPaint({ background: Brush.image('fixture:image', ImageFit.Fill) });
  const details = layout.createNode({ direction: LayoutDirection.Column, gap: 5 });
  const label = layout.createText('Text and images', { fontSize: 18, wrap: false });
  const caption = layout.createText('Owned data / native rendering', { fontSize: 13, wrap: false });
  caption.setPaint({ textColor: [0.48, 0.68, 0.82, 1] });
  details.setChildren([label, caption]);
  row.setChildren([imageNode, details]);
  root.setChildren([title, row]);
  layout.compute(root, 360, 180);
  const boxes = new Float32Array(12);
  layout.readBounds([imageNode, label, title], boxes);
  const [ix, iy] = boxes;
  assert.equal(layout.hitTest(root, ix + 1, iy + 1)[0].nodeId, imageNode.id);
  const info = layout.prepareDisplayList(root);
  const records = new Float32Array(info.floats);
  layout.readDisplayList(records);
  const kinds = Array.from(
    { length: info.count },
    (_, i) => records[i * sceneSchema.recordFloats + 44],
  );
  assert(kinds.includes(0) && kinds.includes(7) && kinds.includes(32));
  assert(
    kinds.every((kind) => [0, 7, 32].includes(kind)),
    'Fixture only uses supported probe primitives',
  );
  renderer = await OffscreenRenderer.create(native, 360, 180, sceneProbeShader);
  const buffer = keep(
    renderer.device.createBuffer({
      size: BigInt(records.byteLength),
      usage: gpu.BufferUsage.STORAGE | gpu.BufferUsage.COPY_DST,
    }),
  );
  const viewport = keep(
    renderer.device.createBuffer({
      size: 16n,
      usage: gpu.BufferUsage.UNIFORM | gpu.BufferUsage.COPY_DST,
    }),
  );
  const params = new Float32Array([360, 180, 0, 0]);
  renderer.queue.writeBuffer(viewport, 0n, new Uint8Array(params.buffer), params.byteLength);
  renderer.queue.writeBuffer(buffer, 0n, new Uint8Array(records.buffer), records.byteLength);
  const atlasInfo = layout.atlasInfo(false, 0);
  const atlasBytes = new Uint8Array(atlasInfo.bytes);
  layout.readAtlas(false, 0, atlasBytes);
  const texture = (width, height, format) =>
    keep(
      renderer.device.texture({
        size: { width, height, depthOrArrayLayers: 1 },
        format,
        usage: gpu.TextureUsage.TEXTURE_BINDING | gpu.TextureUsage.COPY_DST,
      }),
    );
  const atlas = texture(atlasInfo.width, atlasInfo.height, gpu.TextureFormat.R8unorm);
  renderer.queue.writeTexture(
    atlas,
    atlasBytes,
    atlasInfo.width,
    atlasInfo.height,
    atlasInfo.width,
  );
  const image = texture(56, 56, gpu.TextureFormat.Rgba8unorm);
  const imagePixels = new Uint8Array(56 * 56 * 4);
  first.image.resample(56, 56, ImageFit.Fill, imagePixels);
  renderer.queue.writeTexture(image, imagePixels, 56, 56, 56 * 4);
  const atlasView = keep(atlas.createView({}));
  const imageView = keep(image.createView({}));
  const groupLayout = keep(renderer.pipeline.getBindGroupLayout(0));
  const group = keep(
    renderer.device.createBindGroup({
      layout: groupLayout,
      entries: [
        { binding: 0, resource: { kind: 'Buffer', value: viewport } },
        { binding: 1, resource: { kind: 'Buffer', value: buffer } },
        { binding: 2, resource: { kind: 'TextureView', value: atlasView } },
        { binding: 3, resource: { kind: 'TextureView', value: imageView } },
      ],
    }),
  );
  const capture = async (name) => {
    const pixels = new Uint8Array(360 * 180 * 4);
    await renderer.captureInto(pixels, 6, [group], info.count);
    await writeFile(
      new URL(name, output),
      PNG.sync.write({ width: 360, height: 180, data: Buffer.from(pixels) }),
    );
    return pixels;
  };
  const pixels = await capture('scene-png.png');
  const sample = (data, x, y) => [
    ...data.slice(
      (Math.floor(y) * 360 + Math.floor(x)) * 4,
      (Math.floor(y) * 360 + Math.floor(x)) * 4 + 4,
    ),
  ];
  assert.deepEqual(sample(pixels, 2, 2), [13, 20, 31, 255]);
  assert.deepEqual(sample(pixels, ix + 1, iy + 10), [255, 80, 60, 255]);
  assert.deepEqual(sample(pixels, ix + 54, iy + 10), [40, 170, 240, 255]);
  // Check coverage at actual native glyph texels, including partially covered edges.
  let checkedGlyphPixels = 0;
  for (let i = 0; i < info.count; i++) {
    const r = records.subarray(i * sceneSchema.recordFloats, (i + 1) * sceneSchema.recordFloats);
    if (r[44] !== 7) {
      continue;
    }
    for (let y = 0; y < r[3]; y++) {
      for (let x = 0; x < r[2]; x++) {
        const u = Math.floor(r[40] + ((x + 0.5) / r[2]) * (r[42] - r[40]));
        const v = Math.floor(r[41] + ((y + 0.5) / r[3]) * (r[43] - r[41]));
        const alpha = (atlasBytes[v * atlasInfo.width + u] / 255) ** 0.7 * r[11];
        if (alpha < 0.1) {
          continue;
        }
        const actual = sample(pixels, r[0] + x, r[1] + y);
        for (let c = 0; c < 3; c++) {
          const expected = Math.round(r[8 + c] * 255 * alpha + [13, 20, 31][c] * (1 - alpha));
          assert(
            Math.abs(actual[c] - expected) <= 2,
            `Glyph pixel mismatch: ${actual} vs ${expected}, record ${i}`,
          );
        }
        checkedGlyphPixels++;
      }
    }
  }
  assert(checkedGlyphPixels > 200, 'Text reached the GPU through real native atlas bytes');
  assert.deepEqual(
    await capture('scene-repeat.png'),
    pixels,
    'Identical native scene pixels repeat',
  );
  const svg = native.rasterizeSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><rect width="56" height="56" fill="#25bda1"/><path d="M14 29l9 9 19-22" fill="none" stroke="white" stroke-width="4"/></svg>',
    56,
    56,
  );
  try {
    svg.readPixels(imagePixels);
  } finally {
    svg.dispose();
  }
  renderer.queue.writeTexture(image, imagePixels, 56, 56, 56 * 4);
  const svgPixels = await capture('scene-svg.png');
  assert.deepEqual(sample(svgPixels, ix + 2, iy + 2), [37, 189, 161, 255]);
  assert.notDeepEqual(svgPixels, pixels);
  session.mount((_, scope) => native.createLayout(scope));
  assert.equal(layout.disposed, true);
  assert.throws(() => title.setText('gone'), /disposed/);
  assert.throws(() => first.image.width, /disposed/);
  console.log(
    JSON.stringify({
      test: 'Public native scenes and offscreen data',
      records: info.count,
      checkedGlyphPixels,
      captures: output.pathname,
      scopeDisposal: true,
    }),
  );
} finally {
  for (const resource of owned.reverse()) {
    resource.destroy();
  }
  renderer?.dispose();
  session.dispose();
}
