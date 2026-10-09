import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Brush, loadNative } from '../dist/native/index.js';

const native = loadNative();
const layout = native.createLayout();
let calls = 0;
const addon = createRequire(import.meta.url)('../native/blinc_ts.node');
const apply = addon.NativeLayout.prototype.applyCommands;
addon.NativeLayout.prototype.applyCommands = function (...args) {
  calls++;
  return apply.apply(this, args);
};
const bounds = new Float32Array(8);
try {
  const root = layout.createNode({ width: 200, height: 100 });
  const [a, b, c] = [10, 20, 30].map((width) =>
    layout.createNode({ width, height: 10, shrink: 0 }),
  );
  const label = layout.createText('one');
  const changes = [];
  layout.onChange((change) => changes.push(change));

  // Tree edits, properties, text, paint and scroll in one tick are one native call.
  root.queueInsertBefore(a, null);
  root.queueInsertBefore(c, null);
  root.queueInsertBefore(b, c);
  a.queueInsertBefore(label, null);
  a.setLayoutProperty('margin-left', 5);
  label.queueText('two', { fontSize: 20 });
  label.queueText('three', { fontSize: 24 });
  a.queuePaint({ background: Brush.solid(0x336699), opacity: 0.5 });
  a.queuePaint({ radius: [2, 2, 2, 2] });
  b.queuePaint({ background: Brush.linear(0, 0, 1, 0, true).stop(0, 0xff0000).stop(1, 0x0000ff) });
  root.queueScroll(0, 3);
  root.queueScroll(0, 0);
  assert.deepEqual(changes, []);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.deepEqual(changes, ['layout']);
  layout.compute(root, 200, 100);
  layout.readBounds([a, b], bounds);
  assert.deepEqual([...bounds], [5, 0, 10, 10, 15, 0, 20, 10]);
  const info = layout.prepareDisplayList(root, {});
  assert(info.count >= 3, 'Both backgrounds and the text are painted');

  // Commands for a node removed earlier in the batch are dropped.
  c.queueRemove();
  c.queuePaint({ opacity: 1 });
  b.queueDetach();
  root.queueInsertBefore(b, a);
  layout.flush();
  assert.equal(calls, 2);
  layout.compute(root, 200, 100);
  layout.readBounds([b, a], bounds);
  assert.deepEqual([bounds[0], bounds[4]], [0, 25]);
  assert.equal(layout.size, 4);

  // Paint-only batches report paint; invalid values throw before they are queued.
  changes.length = 0;
  a.queuePaint({ opacity: 1 });
  layout.flush();
  assert.deepEqual(changes, ['paint']);
  assert.throws(() => a.queuePaint({ opacity: 2 }), /Invalid paint/);
  assert.throws(() => a.queueScroll(NaN, 0), /finite/);

  // A failing command throws from flush; the edits before it stay applied.
  b.setLayoutProperty('width', 40);
  root.queueInsertBefore(root, null);
  assert.throws(() => layout.flush(), /cycle/);
  layout.compute(root, 200, 100);
  layout.readBounds([b], bounds);
  assert.equal(bounds[2], 40);
} finally {
  layout.dispose();
}
console.log('Native command buffer: one call per tick, coalescing, removal and errors passed');
