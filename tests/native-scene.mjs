import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { PNG } from 'pngjs';

const addon = createRequire(import.meta.url)('../native/blinc_ts.node');
assert.deepEqual(addon.sceneSchema(), { version: 1, recordFloats: 112, recordRows: 28 });
const tree = new addon.NativeLayout();
const other = new addon.NativeLayout();
const detached = (TypedArray, length) => {
  const view = new TypedArray(length);
  structuredClone(view.buffer, { transfer: [view.buffer] });
  return view;
};
try {
  const root = tree.createNode({ width: 100, height: 100, overflow: 1 });
  const child = tree.createNode({ width: 30, height: 20, shrink: 0 });
  root.setChildren([child]);
  child.setPaint({
    background: tree.createBrush({ kind: 0, color: [1, 0, 0, 1] }),
    radius: [3, 3, 3, 3],
  });
  assert.throws(() => tree.prepareDisplayList(root, {}), /Compute layout/);
  tree.compute(root, 100, 100);
  const info = tree.prepareDisplayList(root, {});
  assert.equal(info.count, 1);
  assert.equal(info.floats, 112);
  const records = new Float32Array(info.floats);
  tree.readDisplayList(records);
  assert.deepEqual([...records.slice(0, 4)], [0, 0, 30, 20]);
  assert.deepEqual([...records.slice(4, 8)], [3, 3, 3, 3]);
  assert.deepEqual([...records.slice(8, 12)], [1, 0, 0, 1]);
  assert.equal(tree.hitTest(root, 5, 5)[0].nodeId, child.id);
  for (const patch of [
    { background: tree.createBrush({ kind: 0, color: [0, 1, 0, 1] }), opacity: NaN },
    { radius: [1, 2, 3] },
    { transform: [1, 0, 0, Infinity, 0, 0] },
    { shadows: [{ x: 0, y: 0, blur: -1, color: [0, 0, 0, 1] }] },
    ...[0.5, 2 ** 32, NaN, Infinity].map((zIndex) => ({ zIndex })),
  ]) {
    assert.throws(() => child.setPaint(patch));
    const after = new Float32Array(records.length);
    tree.readDisplayList(after);
    assert.deepEqual(after, records, 'Rejected paint patches are atomic');
  }
  const small = new Float32Array(111).fill(42);
  assert.throws(() => tree.readDisplayList(small), /too small/);
  assert(small.every((value) => value === 42));
  for (const bad of [
    new Uint32Array(112),
    new Float32Array(new SharedArrayBuffer(448)),
    detached(Float32Array, 112),
  ]) {
    assert.throws(() => tree.readDisplayList(bad), /Float32Array|Shared|Detached/);
  }
  const padded = new Float32Array(116).fill(42);
  tree.readDisplayList(padded.subarray(2, 114));
  assert.deepEqual(padded.subarray(2, 114), records);
  assert.equal(padded[0], 42);
  assert.equal(padded[115], 42);
  child.setVisual([80, 20, 35, 25]);
  assert.throws(() => tree.readDisplayList(records), /Prepare/);
  assert.equal(tree.hitTest(root, 85, 25)[0].nodeId, child.id);
  assert.deepEqual(tree.hitTest(root, 105, 25), [], 'Parent clip excludes overflow');
  tree.prepareDisplayList(root, {});
  tree.readDisplayList(records);
  assert.deepEqual([...records.slice(0, 4)], [80, 20, 35, 25]);
  assert.deepEqual([...records.slice(32, 36)], [0, 0, 100, 100]);
  child.setPointerEvents(false);
  assert.equal(tree.hitTest(root, 85, 25)[0].nodeId, root.id);
  child.setPointerEvents(true);
  child.setVisual(null);
  root.setScroll(0, 10);
  assert.equal(tree.hitTest(root, 5, 5)[0].y, 15);
  root.setScroll(0, 0);
  child.setPaint({ transform: [1, 0, 0, 1, 40, 30] });
  assert.equal(tree.hitTest(root, 45, 35)[0].nodeId, child.id);
  child.clearPaint();
  child.setResource(7, false);
  tree.prepareDisplayList(root, {});
  tree.readDisplayList(records);
  assert.equal(records[44], 32);
  assert.equal(records[40], 7);
  for (const slot of [-1, 0.5, 16777216, 2 ** 32, NaN]) {
    assert.throws(() => child.setResource(slot, false), /integer/);
  }
  child.setResource(null, false);
  const foreign = other.createNode({});
  assert.throws(() => tree.prepareDisplayList(foreign, {}), /another layout context/);
  assert.throws(() => tree.hitTest(foreign, 0, 0), /another layout context/);
  for (const options of [{ scale: 0 }, { scale: Infinity }, { textColor: [1, 2, 3, 1] }]) {
    assert.throws(() => tree.prepareDisplayList(root, options));
  }
  child.remove();
  tree.createNode({});
  assert.throws(() => child.setPaint({}), /removed/);
  tree.dispose();
  assert.throws(() => root.setPaint({}), /disposed/);
  assert.throws(() => tree.createText('gone', {}, {}), /disposed/);
  assert.throws(() => tree.hitTest(root, 0, 0), /disposed/);
} finally {
  tree.dispose();
  other.dispose();
}

const textTree = new addon.NativeLayout();
try {
  const root = textTree.createNode({ width: 300, height: 80 });
  const label = textTree.createText('WWWW', { fontSize: 24, wrap: false }, {});
  root.setChildren([label]);
  textTree.compute(root, 300, 80);
  const bounds = new Float32Array(4);
  textTree.readBounds([label], bounds);
  const wide = bounds[2];
  assert.equal(textTree.prepareDisplayList(root, {}).count, 4);
  const atlas = textTree.atlasInfo(false, 0);
  assert(atlas.bytes > 0);
  const bytes = new Uint8Array(atlas.bytes + 2).fill(99);
  const update = textTree.readAtlas(false, 0, bytes.subarray(1, -1));
  assert.equal(update.revision, atlas.revision);
  assert(bytes.subarray(1, -1).some((v) => v > 0));
  assert.equal(bytes[0], 99);
  assert.equal(bytes.at(-1), 99);
  assert.equal(textTree.atlasInfo(false, update.revision), null);
  for (const fontWeight of [0, 1001, 400.5, 2 ** 32 + 400]) {
    assert.throws(() => label.setText('invalid', { fontWeight }));
  }
  label.setText('iiii', {});
  assert.throws(() => textTree.readBounds([label], bounds), /Compute/);
  textTree.compute(root, 300, 80);
  textTree.readBounds([label], bounds);
  assert(wide > bounds[2] * 1.5);
  textTree.prepareDisplayList(root, {});
  const delta = textTree.atlasInfo(false, update.revision);
  assert(delta.bytes < atlas.bytes);
  const small = new Uint8Array(delta.bytes - 1).fill(42);
  assert.throws(() => textTree.readAtlas(false, update.revision, small), /too small/);
  assert(small.every((v) => v === 42));
  for (const value of [-1, 0.5, NaN, 2 ** 32]) {
    assert.throws(() => textTree.atlasInfo(false, value), /integer/);
  }
  for (const output of [
    new Uint8Array(new SharedArrayBuffer(delta.bytes)),
    detached(Uint8Array, delta.bytes),
    new Float32Array(delta.bytes),
  ]) {
    assert.throws(() => textTree.readAtlas(false, update.revision, output));
  }
  textTree.readAtlas(false, update.revision, new Uint8Array(delta.bytes));
} finally {
  textTree.dispose();
}

const png = PNG.sync.write({
  width: 2,
  height: 1,
  data: Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]),
});
const image = addon.decodeImage(png);
try {
  assert.equal(image.width, 2);
  assert.equal(image.height, 1);
  const pixels = new Uint8Array(10).fill(42);
  image.readPixels(pixels.subarray(1, 9));
  assert.deepEqual([...pixels], [42, 255, 0, 0, 255, 0, 0, 255, 255, 42]);
  const small = new Uint8Array(7).fill(42);
  assert.throws(() => image.readPixels(small), /too small/);
  assert(small.every((v) => v === 42));
  const scaled = new Uint8Array(16 * 16 * 4);
  image.resample(16, 16, 1, scaled);
  assert.equal(scaled[(1 * 16 + 8) * 4 + 3], 0);
  assert.equal(scaled[(8 * 16 + 8) * 4 + 3], 255);
  for (const fit of [-1, 0.5, 3, 2 ** 32, NaN]) {
    assert.throws(() => image.resample(16, 16, fit, scaled), /integer|enum/);
  }
  for (const dimension of [0, -1, 1.5, 16385, Infinity, NaN]) {
    assert.throws(() => image.resample(dimension, 16, 0, scaled), /dimensions/);
  }
  assert.throws(() => image.readPixels(detached(Uint8Array, 8)), /Detached|Uint8Array/);
  assert.throws(() => image.readPixels(new Uint8Array(new SharedArrayBuffer(8))), /Shared/);
} finally {
  image.dispose();
  image.dispose();
}
assert.throws(() => image.width, /disposed/);
assert.throws(() => image.readPixels(new Uint8Array(8)), /disposed/);
assert.throws(() => addon.decodeImage(new Uint8Array(4)));
assert.throws(() => addon.decodeImage(detached(Uint8Array, 4)));
assert.throws(() => addon.decodeImage(new Uint8Array(new SharedArrayBuffer(8))), /Shared/);
const svg = addon.rasterizeSvg(
  '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#ff0000" fill-opacity="0.5"/></svg>',
  2,
  2,
);
try {
  const pixels = new Uint8Array(16);
  svg.readPixels(pixels);
  assert(pixels[0] >= 254, 'SVG RGB is unpremultiplied, allowing one quantization step');
  assert.deepEqual([...pixels.slice(1, 4)], [0, 0, 128]);
} finally {
  svg.dispose();
}
assert.throws(() => addon.rasterizeSvg('<broken', 2, 2));
console.log(
  'Native scenes: records, text, atlases, hits, images, validated buffers and disposal passed',
);
