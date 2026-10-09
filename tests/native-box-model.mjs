import assert from 'node:assert/strict';
import { LayoutProperty, layoutDeclaration, loadNative } from '../dist/native/index.js';

const native = loadNative();
const layout = native.createLayout();
const bounds = new Float32Array(32);
const read = (nodes, width = 200, height = 100) => {
  layout.compute(root, width, height);
  layout.readBounds(nodes, bounds);
  return [...bounds.slice(0, nodes.length * 4)];
};
const root = layout.createNode({ width: 200, height: 100 });
try {
  // Margin, padding and border per side, and percentages.
  const a = layout.createNode({
    width: 40,
    height: 20,
    shrink: 0,
    margin: [1, 2, 3, 4],
    padding: ['10%', 0, 0, 0],
    border: [0, 0, 0, 3],
  });
  const inner = layout.createNode({ width: 5, height: 5 });
  a.append(inner);
  root.append(a);
  assert.deepEqual(read([a, inner]), [4, 1, 40, 20, 7, 21, 5, 5]);

  // Incremental child operations: insertBefore, move, removeChild and reuse.
  const b = layout.createNode({ width: 10, height: 10, shrink: 0 });
  const c = layout.createNode({ width: 20, height: 10, shrink: 0 });
  root.insertBefore(b, a);
  root.insertBefore(c, null);
  assert.deepEqual(
    read([b, a, c]).filter((_, i) => i % 4 === 0),
    [0, 14, 56],
  );
  root.insertBefore(c, b);
  assert.deepEqual(
    read([c, b, a]).filter((_, i) => i % 4 === 0),
    [0, 20, 34],
  );
  root.removeChild(b);
  assert.throws(() => root.removeChild(b), /not a child/);
  assert.throws(() => root.insertBefore(c, b), /not a child of the parent/);
  assert.throws(() => a.append(root), /cycle/);
  inner.append(b);
  assert.deepEqual(read([b]), [27, 21, 10, 10]);
  b.detach();
  root.append(b);
  assert.deepEqual(read([b]).slice(0, 1), [66]);

  // Order sorts layout and paint stably, keeping authored order for later edits.
  b.setStyle({ order: -1 });
  assert.deepEqual(
    read([b, c]).filter((_, i) => i % 4 === 0),
    [0, 10],
  );
  b.setStyle({ order: null });
  assert.deepEqual(read([c]).slice(0, 1), [0]);

  // Queued CSS writes coalesce, the last write to a field wins, and reads flush.
  c.setLayoutProperty('width', '50%');
  c.setLayoutProperty('width', 30);
  c.setProperty(LayoutProperty.Width, 25);
  assert.equal(c.setLayoutProperty('color', 'red'), false);
  assert.deepEqual(read([c]).slice(2, 3), [25]);
  c.setLayoutProperty('width', '50%');
  assert.deepEqual(read([c]).slice(2, 3), [100]);

  // Position, inset and display none.
  c.setLayoutProperty('position', 'absolute');
  c.setLayoutProperty('inset', '5px auto auto 10%');
  assert.deepEqual(read([c]), [20, 5, 100, 10]);
  c.setLayoutProperty('display', 'none');
  assert.deepEqual(read([c]).slice(2, 4), [0, 0]);
  c.setLayoutProperty('display', null);

  // Wrap, align-content, flex shorthand, aspect ratio and per-axis overflow.
  const wrap = layout.createNode({
    width: 50,
    height: 100,
    wrap: 'wrap',
    alignContent: 'flex-end',
  });
  const items = [0, 1].map(() => layout.createNode({ width: 30, height: 10, shrink: 0 }));
  items.forEach((item) => wrap.append(item));
  root.setChildren([wrap]);
  assert.deepEqual(
    read(items).filter((_, i) => i % 4 < 2),
    [0, 80, 0, 90],
  );
  items[0].setLayoutProperty('flex', '1');
  items[1].setStyle({ width: 'auto', height: 'auto', aspectRatio: 2, basis: 20 });
  assert.deepEqual(read(items).slice(4), [30, 90, 20, 10]);
  wrap.setStyle({ overflowX: 'hidden', overflowY: 'scroll', alignSelf: 'center' });

  // Grid templates and placement.
  const grid = layout.createNode({
    width: 120,
    height: 40,
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    columnGap: 0,
  });
  const cell = layout.createNode({ gridColumn: '2 / span 2' });
  grid.append(cell);
  root.setChildren([grid]);
  assert.deepEqual(read([cell]), [40, 0, 80, 40]);

  // Writes that do not parse are rejected before anything is queued.
  assert.throws(() => cell.setLayoutProperty('width', 'wide'), /Invalid value/);
  assert.throws(() => cell.setLayoutProperty('display', 'table'), /Invalid value/);
  assert.throws(() => cell.setProperty(LayoutProperty.Display, 0.5), /integer/);
  assert.throws(() => cell.setProperty(LayoutProperty.Width, 'x'), /text/);
  assert.throws(() => cell.setProperty(4, 1), /does not take/);
  assert.deepEqual(layoutDeclaration('margin', '1px 2px'), [
    [47, 0, 1],
    [48, 0, 2],
    [49, 0, 1],
    [50, 0, 2],
  ]);

  // Removing a node with queued writes flushes them first.
  cell.setProperty(LayoutProperty.Width, 10);
  cell.remove();
  read([grid]);
} finally {
  layout.dispose();
}
console.log('native box model: ok');
