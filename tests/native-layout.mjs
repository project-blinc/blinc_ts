import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { AppSession } from '../dist/hmr.js';
import { loadNative } from '../dist/native/index.js';

const native = loadNative();
const layout = native.createLayout();
const other = native.createLayout();
try {
  const root = layout.createNode({ width: '100%', height: '100%', padding: 16, gap: 8 });
  const a = layout.createNode({ width: 40, height: 30, shrink: 0 });
  const b = layout.createNode({ width: 60, height: 20, shrink: 0 });
  root.setChildren([a, b]);
  const bounds = new Float32Array(12);
  assert.throws(() => layout.readBounds([root, a, b], bounds), /Compute layout/);
  layout.compute(root, 320, 180);
  layout.readBounds([root, a, b], bounds);
  assert.deepEqual([...bounds], [0, 0, 320, 180, 16, 16, 40, 30, 64, 16, 60, 20]);
  a.setStyle({ width: 80 });
  assert.throws(() => layout.readBounds([a], bounds), /Compute layout/);
  layout.compute(root, 320, 180);
  layout.readBounds([a, b], bounds);
  assert.deepEqual([...bounds.slice(0, 8)], [16, 16, 80, 30, 104, 16, 60, 20]);
  root.setChildren([b, a]);
  layout.compute(root, 320, 180);
  layout.readBounds([a, b], bounds);
  assert.equal(bounds[0], 84);
  b.setChildren([a]);
  layout.compute(root, 320, 180);
  layout.readBounds([a], bounds);
  assert.equal(bounds[0], 16);
  assert.throws(() => a.setChildren([root]), /cycle/);
  assert.throws(() => root.setChildren([b, b]), /Duplicate/);
  assert.throws(() => root.setChildren([other.createNode()]), /another layout context/);
  assert.throws(() => layout.compute(a, 320, 180), /no parent/);
  assert.throws(() => layout.compute(root, Infinity, 180), /finite/);
  assert.throws(() => a.setStyle({ width: 'oops' }), /percentage/);
  assert.throws(() => a.setStyle({ height: -1 }), /non-negative/);
  assert.throws(() => a.setStyle({ direction: 'diagonal' }), /direction/);
  layout.readBounds([a], bounds); // Rejected edits keep computed geometry valid.
  assert.throws(() => layout.readBounds([a], new Float32Array(3)), /too small/);
  assert.throws(() => layout.readBounds([a], new Uint32Array(4)), /Float32Array/);
  assert.throws(
    () => layout.readBounds([a], new Float32Array(new SharedArrayBuffer(16))),
    /Shared/,
  );
  const detached = new Float32Array(4);
  structuredClone(detached.buffer, { transfer: [detached.buffer] });
  assert.throws(() => layout.readBounds([a], detached), /Detached|Float32Array/);
  bounds.fill(-99);
  layout.readBounds([a], bounds.subarray(4, 8));
  assert.deepEqual([...bounds.slice(0, 4)], [-99, -99, -99, -99]);
  assert.deepEqual([...bounds.slice(4, 8)], [16, 16, 80, 30]);
  b.remove();
  assert.equal(layout.size, 1);
  layout.createNode(); // Slot reuse must not revive removed handles.
  assert.throws(() => a.setStyle({ width: 20 }), /removed/);
  layout.dispose();
  assert.throws(() => root.setStyle({ width: 20 }), /disposed/);
} finally {
  layout.dispose();
  other.dispose();
}

// Verify native ownership checks directly as well as the TypeScript facade.
const addon = createRequire(import.meta.url)('../native/blinc_ts.node');
const raw = new addon.NativeLayout();
const foreign = new addon.NativeLayout();
try {
  const root = raw.createNode({ width: 100, height: 100 });
  const child = foreign.createNode({});
  assert.throws(() => root.setChildren([child]), /another layout context/);
  assert.throws(() => raw.compute(child, 100, 100), /another layout context/);
  raw.compute(root, 100, 100);
  const bounds = new Float32Array(8).fill(42);
  assert.throws(() => raw.readBounds([root, child], bounds), /another layout context/);
  assert.deepEqual([...bounds], Array(8).fill(42));
} finally {
  raw.dispose();
  foreign.dispose();
}

let hostDisposed = false;
const session = new AppSession({
  dispose() {
    hostDisposed = true;
  },
});
const first = session.mount((host, scope) => native.createLayout(scope));
const node = first.createNode();
const second = session.mount((host, scope) => native.createLayout(scope));
assert.equal(first.disposed, true);
assert.equal(second.disposed, false);
assert.throws(() => node.setStyle({ width: 1 }), /disposed/);
session.dispose();
assert.equal(second.disposed, true);
assert.equal(hostDisposed, true);
console.log('Native layout: geometry, ownership, buffers, edits and HMR disposal passed');
