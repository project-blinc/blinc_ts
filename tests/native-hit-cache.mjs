import assert from 'node:assert/strict';
import { loadNative, Brush, LayoutOverflow } from '../dist/native/index.js';
const layout = loadNative().createLayout();
try {
  const root = layout.createNode({ width: 400, height: 300 });
  const box = layout.createNode({ width: 100, height: 100 });
  root.setChildren([box]);
  layout.compute(root, 400, 300);
  const cache = layout.createHitCache(root);
  const exact = (x, y) => layout.hitTest(root, x, y).map((h) => h.nodeId);
  const first = cache.pathAt(40.125, 50.875);
  assert.deepEqual(first, exact(40.125, 50.875));
  let walks = 0;
  const query = layout.hitTestRegion.bind(layout);
  layout.hitTestRegion = (...args) => {
    walks++;
    return query(...args);
  };
  for (let i = 0; i < 100000; i++) {
    assert.equal(cache.pathAt(40.125 + (i % 7), 50.875), first);
  }
  assert.equal(walks, 0);
  assert.deepEqual(cache.pathAt(150, 50), exact(150, 50));
  box.setVisual([160.5, 20.25, 100, 100]);
  assert.equal(cache.bounds, undefined);
  assert.deepEqual(cache.pathAt(170.75, 40.125), exact(170.75, 40.125));
  box.setPaint({
    background: Brush.solid(0xffffff),
    radius: [50, 50, 50, 50],
    transform: [1, 0.2, -0.2, 1, 0, 0],
  });
  assert.deepEqual(cache.pathAt(210.5, 70.25), exact(210.5, 70.25));
  assert.deepEqual(cache.bounds, [0, 0, 0, 0], 'Rotated geometry must fall back to exact hits');
  const clipped = layout.createNode({ width: 80, height: 80, overflow: LayoutOverflow.Hidden });
  root.setChildren([clipped]);
  clipped.setChildren([box]);
  layout.compute(root, 400, 300);
  assert.equal(cache.bounds, undefined);
  assert.deepEqual(cache.pathAt(170.75, 40.125), exact(170.75, 40.125));
  assert.throws(() => cache.pathAt(NaN, 1), /Invalid/);
  console.log(
    JSON.stringify({ quietQueries: 100000, quietNativeWalks: 0, invalidatedWalks: walks }),
  );
  layout.dispose();
  assert.equal(cache.bounds, undefined);
  assert.throws(() => cache.pathAt(20, 20), /disposed/);
} finally {
  layout.dispose();
}
