import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseSide, place, placement } from '../dist/native/placement.js';

const viewport = { width: 400, height: 300 };
const content = { width: 80, height: 40 };
const anchor = { x: 100, y: 100, width: 60, height: 20 };

test('a box goes on the preferred side, centred along the anchor, with its arrow on the anchor', () => {
  const at = (side) => place(placement.beside(anchor, side, { gap: 4 }), content, viewport);
  assert.deepEqual(at('bottom'), { left: 90, top: 124, side: 'bottom', arrow: 40 });
  assert.deepEqual(at('top'), { left: 90, top: 56, side: 'top', arrow: 40 });
  assert.deepEqual(at('right'), { left: 164, top: 90, side: 'right', arrow: 20 });
  assert.deepEqual(at('left'), { left: 16, top: 90, side: 'left', arrow: 20 });
});

test('alignment and offset slide the box along the anchor', () => {
  const along = (align, offset) =>
    place(placement.beside(anchor, 'bottom', { align, offset }), content, viewport);
  assert.equal(along('start', 0).left, 100);
  assert.equal(along('end', 0).left, 80);
  assert.equal(along('center', 6).left, 96);
  assert.equal(along('start', 0).arrow, 30, 'the arrow stays on the anchor when the box slides');
});

test('a box flips to the opposite side where its own has no room', () => {
  const low = { x: 100, y: 270, width: 60, height: 20 };
  assert.equal(place(placement.beside(low, 'bottom', { gap: 4 }), content, viewport).side, 'top');
  assert.equal(place(placement.beside(low, 'bottom', { gap: 4 }), content, viewport).top, 226);
  const high = { x: 100, y: 2, width: 60, height: 20 };
  assert.equal(place(placement.beside(high, 'top'), content, viewport).side, 'bottom');
  const edge = { x: 390, y: 100, width: 10, height: 20 };
  assert.equal(place(placement.beside(edge, 'right'), content, viewport).side, 'left');
  const start = { x: 0, y: 100, width: 10, height: 20 };
  assert.equal(place(placement.beside(start, 'left'), content, viewport).side, 'right');
});

test('with room on neither side it takes the side with more', () => {
  const tall = { width: 80, height: 250 };
  const middle = { x: 100, y: 130, width: 60, height: 20 };
  // 130 above against 150 below, for 250 tall: neither fits; below has more.
  assert.equal(chooseSide('top', middle, tall, 0, viewport), 'bottom');
  assert.equal(chooseSide('bottom', middle, tall, 0, viewport), 'bottom');
  assert.equal(chooseSide('top', { ...middle, y: 160 }, tall, 0, viewport), 'top');
});

test('a box is kept inside the viewport, and its arrow still finds the anchor', () => {
  const corner = { x: 0, y: 0, width: 20, height: 20 };
  const placed = place(placement.beside(corner, 'bottom'), content, viewport);
  assert.equal(placed.left, 0, 'not past the left edge');
  assert.equal(placed.arrow, 10);
  const far = { x: 380, y: 100, width: 20, height: 20 };
  const right = place(placement.beside(far, 'bottom'), content, viewport);
  assert.equal(right.left, 320, 'not past the right edge');
  assert.equal(right.arrow, 70);
  // Bigger than the viewport: it starts at the corner.
  assert.deepEqual(
    place(placement.beside(anchor, 'bottom'), { width: 500, height: 400 }, viewport).left,
    0,
  );
});

test('a list below its control matches its left edge, and goes above where there is no room', () => {
  const control = { x: 100, y: 100, width: 120, height: 30 };
  assert.deepEqual(place(placement.below(control), content, viewport), {
    left: 100,
    top: 130,
    side: 'bottom',
    arrow: 60,
  });
  const low = { x: 100, y: 270, width: 120, height: 30 };
  const above = place(placement.below(low, { gap: 2 }), content, viewport);
  assert.equal(above.side, 'top');
  assert.equal(above.top, 228);
});

test('a point places the box at it, flipped left and up where it would run past an edge', () => {
  assert.deepEqual(place(placement.at(50, 60), content, viewport), {
    left: 50,
    top: 60,
    side: null,
    arrow: null,
  });
  const flipped = place(placement.at(380, 290), content, viewport);
  assert.deepEqual([flipped.left, flipped.top], [300, 250]);
  assert.deepEqual([place(placement.at(10, 10), { width: 500, height: 500 }, viewport).left], [0]);
});

test("centre and edge are layout's, not this", () => {
  assert.equal(place(placement.center(), content, viewport), null);
  assert.equal(place(placement.edge('left'), content, viewport), null);
});

test('an anchor can be anything with bounds, read when the box is placed', () => {
  let x = 100;
  const element = { bounds: () => [x, 100, 60, 20] };
  const p = placement.beside(element, 'bottom');
  assert.equal(place(p, content, viewport).left, 90);
  x = 200;
  assert.equal(place(p, content, viewport).left, 190);
});
