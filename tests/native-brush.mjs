import assert from 'node:assert/strict';
import { Brush, ImageFit, loadNative, sceneSchema } from '../dist/native/index.js';
const native = loadNative();
const scene = native.createLayout();
try {
  const root = scene.createNode({ width: 100, height: 80 });
  scene.compute(root, 100, 80);
  const encode = (background) => {
    root.setPaint({ background });
    const info = scene.prepareDisplayList(root);
    const records = new Float32Array(info.floats);
    scene.readDisplayList(records);
    return { info, records };
  };
  const solid = Brush.solid(0x336699);
  const first = encode(solid);
  assert.deepEqual([...first.records.slice(8, 12)], [...new Float32Array([0.2, 0.4, 0.6, 1])]);
  assert.deepEqual(encode(solid), first, 'Native brush values are reusable');
  const gradient = Brush.linear(0, 0, 1, 1, true)
    .stop(0, 0xff0000)
    .stop(0.5, 0x00ff00)
    .stop(1, 0x0000ff);
  let { records } = encode(gradient);
  assert.equal(records[45], 1);
  assert.deepEqual([...records.slice(40, 44)], [0, 0, 100, 80]);
  assert.deepEqual([...records.slice(52, 56)], [0, 1, 0, 1]);
  assert.deepEqual([...records.slice(56, 60)], [0, 0.5, 1, 1]);
  records = encode(Brush.radial(0.5, 0.5, 0.5, true).stop(0, 0xffffff).stop(1, 0)).records;
  assert.equal(records[45], 2);
  assert.deepEqual([...records.slice(40, 44)], [50, 40, 50, 0]);
  records = encode(Brush.blur(12, 0xffffff, 0.2)).records;
  assert.equal(records[44], 42, 'Blur remains a backdrop primitive');
  assert.equal(records[8], 12);
  assert.equal(records[40], 0, 'Blur has no liquid rim');
  const glass = Brush.glass(2, 0xffffff, 0.1, {
    aberration: 0.8,
    bevel: 0.2,
    inset: true,
    noise: 0.03,
  });
  records = encode(glass).records;
  assert.equal(records[44], 42, 'Glass remains a backdrop primitive');
  assert.equal(records[8], 2);
  assert.equal(records[40], 1);
  assert(Math.abs(records[41] + 0.2) < 0.00001, 'Inset bevel is encoded with its sign');
  assert(Math.abs(records[56] - 0.8) < 0.00001, 'Aberration is independent of bevel');
  const previous = records.slice();
  for (const invalid of [
    Brush.blur(-1),
    Brush.glass(2, 0xffffff, 0.1, { aberration: NaN }),
    Brush.glass(2, 0xffffff, 0.1, { bevel: 2 }),
    Brush.linear(0, 0, 1, Infinity).stop(0, 0),
    Brush.linear(0, 0, 1, 1).stop(0.8, 0).stop(0.2, 0xffffff),
    Brush.solid([1, 0, 0, 2]),
  ]) {
    assert.throws(() => root.setPaint({ background: invalid }));
    scene.readDisplayList(records);
    assert.deepEqual(records, previous, 'Failed brush creation preserves the prepared scene');
  }
  records = encode(Brush.glass(2, 0xffffff, 0.1, { simple: true })).records;
  assert.equal(records[40], 0, 'Simple glass has no liquid rim');
  records = encode(Brush.blur(4)).records;
  assert.equal(records[56], 0, 'Changing brush removes previous glass effects');
  scene.setImageSource('test:image', ImageFit.Cover, 7);
  scene.setImageSource('test:image', ImageFit.Contain, 9);
  records = encode(Brush.image('test:image', ImageFit.Contain)).records;
  assert.equal(records[44], 32);
  assert.equal(records[40], 9);
  records = encode(Brush.image('test:image', ImageFit.Cover)).records;
  assert.equal(records[40], 7);
  scene.setImageSource('test:image', ImageFit.Cover, null);
  assert.throws(() => scene.readDisplayList(records), /Prepare/);
  assert.equal(encode(Brush.image('test:image', ImageFit.Cover)).info.count, 0);
  assert.equal(encode(Brush.image('test:image', ImageFit.Contain)).info.count, 1);
  root.clearPaint();
  assert.equal(scene.prepareDisplayList(root).count, 0);
  assert.equal(sceneSchema.recordFloats, 112);
} finally {
  scene.dispose();
}
console.log(
  'Native Blinc brushes: solid, gradients, blur, glass effects, images and atomic validation passed',
);
