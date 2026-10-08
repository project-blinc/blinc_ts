import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { AppSession } from '../dist/hmr.js';
import {
  LayoutDirection,
  LayoutAlign,
  LayoutJustify,
  LayoutOverflow,
  loadNative,
} from '../dist/native/index.js';

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
  assert.throws(() => a.setStyle({ direction: 'diagonal' }), { code: 'NumberExpected' });
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

// All authored enum values pass as numbers, with the same layout semantics.
const enums = native.createLayout();
try {
  const root = enums.createNode({ width: 100, height: 80 });
  const a = enums.createNode({ width: 10, height: 20, shrink: 0 });
  const b = enums.createNode({ width: 10, height: 20, shrink: 0 });
  root.setChildren([a, b]);
  const bounds = new Float32Array(8);
  const check = (patch, expected) => {
    root.setStyle(patch);
    enums.compute(root, 100, 80);
    enums.readBounds([a, b], bounds);
    assert.deepEqual([...bounds], expected);
  };
  check({ direction: LayoutDirection.Row }, [0, 0, 10, 20, 10, 0, 10, 20]);
  check({ direction: LayoutDirection.Column }, [0, 0, 10, 20, 0, 20, 10, 20]);
  check({ direction: LayoutDirection.RowReverse }, [90, 0, 10, 20, 80, 0, 10, 20]);
  check({ direction: LayoutDirection.ColumnReverse }, [0, 60, 10, 20, 0, 40, 10, 20]);
  for (const [align, y] of [
    [LayoutAlign.Start, 0],
    [LayoutAlign.End, 60],
    [LayoutAlign.Center, 30],
  ]) {
    check({ direction: LayoutDirection.Row, align }, [0, y, 10, 20, 10, y, 10, 20]);
  }
  a.setStyle({ height: 'auto' });
  check({ align: LayoutAlign.Stretch }, [0, 0, 10, 80, 10, 0, 10, 20]);
  a.setStyle({ height: 20 });
  for (const [justify, x1, x2] of [
    [LayoutJustify.Start, 0, 10],
    [LayoutJustify.End, 80, 90],
    [LayoutJustify.Center, 40, 50],
    [LayoutJustify.SpaceBetween, 0, 90],
    [LayoutJustify.SpaceAround, 20, 70],
    [LayoutJustify.SpaceEvenly, 27, 63],
  ]) {
    check({ justify }, [x1, 0, 10, 20, x2, 0, 10, 20]);
  }
  for (const overflow of Object.values(LayoutOverflow)) {
    check({ overflow, justify: LayoutJustify.Start }, [0, 0, 10, 20, 10, 0, 10, 20]);
  }
  // Partial style patches retain enum values, and invalid patches are atomic.
  check({ align: LayoutAlign.Center }, [0, 30, 10, 20, 10, 30, 10, 20]);
  check({ gap: 4 }, [0, 30, 10, 20, 14, 30, 10, 20]);
  const previous = [...bounds];
  for (const key of ['direction', 'align', 'justify', 'overflow']) {
    for (const value of [
      'center',
      '0',
      NaN,
      Infinity,
      -Infinity,
      0.5,
      -1,
      99,
      4294967296,
      true,
      {},
      0n,
    ]) {
      assert.throws(() => root.setStyle({ width: 200, [key]: value }));
      enums.readBounds([a, b], bounds);
      assert.deepEqual([...bounds], previous);
    }
  }
} finally {
  enums.dispose();
}
// Schema mismatch fails at load, before a style can be interpreted differently.
const { bind, bindingSchema } = await import('../dist/native/generated/layout.js');
assert.equal(addon.layoutCall(0xffffffff, []), bindingSchema);
assert.throws(() => bind({ call: () => 'incompatible-layout-schema' }), /schema mismatch/);

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
console.log(
  'Native layout: numeric enums, geometry, ownership, buffers, edits and HMR disposal passed',
);
