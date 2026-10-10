import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';
import { ThemeState, neutralTheme } from '../dist/theme/index.js';
import { addUserAgent } from '../dist/theme/user-agent.js';
import { counter } from '../dist/native/behaviours.js';

const native = loadNative();
const W = 500;
const H = 400;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../.blinc/lists/', import.meta.url);
await mkdir(output, { recursive: true });

async function capture(host, name) {
  host.compute(W, H);
  const renderer = new SceneRenderer(target.device, host.layout);
  try {
    const pixels = new Uint8Array(W * H * 4);
    await target.captureCommandsInto(
      pixels,
      (encoder, view) =>
        renderer.encode(encoder, host.root.layoutNode, view, { width: W, height: H, scale: 1 })
          .drawCalls,
    );
    if (name) {
      await writeFile(
        new URL(`${name}.png`, output),
        PNG.sync.write({ width: W, height: H, data: Buffer.from(pixels) }),
      );
    }
    return Buffer.from(pixels);
  } finally {
    renderer.dispose();
  }
}
const pixel = (pixels, x, y) => {
  const at = (Math.round(y) * W + Math.round(x)) * 4;
  return [...pixels.subarray(at, at + 3)];
};
const near = (actual, expected, tolerance = 6) =>
  actual.every((c, i) => Math.abs(c - expected[i]) <= tolerance);
const rgb8 = (color) => [...color.slice(0, 3).map((c) => Math.round(c * 255))];
/** The bounding box of pixels near `colour` in `area`, or null. */
function find(pixels, colour, [ax, ay, aw, ah], tolerance = 8) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -1,
    y1 = -1;
  for (let y = Math.floor(ay); y < Math.min(H, Math.ceil(ay + ah)); y++) {
    for (let x = Math.floor(ax); x < Math.min(W, Math.ceil(ax + aw)); x++) {
      if (near(pixel(pixels, x, y), colour, tolerance)) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

const context = native.createReactive();
const host = Host.create(native);
try {
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  const state = new ThemeState(context, neutralTheme, { scheme: 'light' });
  state.attach(host.layout);
  addUserAgent(host.layout);
  host.layout.addStyleSheet(`
    .plain { list-style-type: none; }
    .roman { list-style-type: upper-roman; }
    .box { position: absolute; width: 200px; }
  `);
  const colours = neutralTheme.light.colors;
  const ink = rgb8(colours.textSecondary);
  const text = (data) => host.createTextNode(data);
  const el = (tag, children = [], attributes = {}) => {
    const e = host.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      e.setAttribute(name, value);
    }
    for (const c of children) {
      e.appendChild(typeof c === 'string' ? text(c) : c);
    }
    return e;
  };
  const items = (...labels) => labels.map((label) => el('li', [label]));
  const place = (element, left, top) => {
    element.classList.add('box');
    element.setAttribute('style', `left: ${left}px; top: ${top}px`);
    host.root.appendChild(element);
    return element;
  };
  const markers = (list) =>
    list.childNodes.filter((n) => n.tag === 'li').map((li) => host.behaviours.markerOf(li));
  const settle = () => {
    host.flush();
    host.compute(W, H);
  };

  // Bullets by depth: a disc, then a circle inside it, then a square.
  const deep = el('ul');
  const topItem = el('li', ['top ']);
  const middle = el('ul');
  const middleItem = el('li', ['middle ']);
  const inner = el('ul', items('inner'));
  middleItem.appendChild(inner);
  middle.appendChild(middleItem);
  topItem.appendChild(middle);
  deep.appendChild(topItem);
  deep.appendChild(el('li', ['second']));
  place(deep, 10, 10);
  settle();
  assert.deepEqual(markers(deep), ['disc', 'disc']);
  assert.deepEqual(markers(middle), ['circle']);
  assert.deepEqual(markers(inner), ['square']);
  assert.equal(
    topItem.childNodes.length,
    2,
    'the tree is as it was made: the marker is not a child',
  );
  let frame = await capture(host, 'bullets');
  const shape = (li) => {
    const [x, y] = li.bounds();
    return find(frame, ink, [x, y, 30, 22]);
  };
  const [secondX, secondY] = deep.childNodes[1].bounds();
  const disc = shape(deep.childNodes[1]);
  assert.ok(disc, 'a disc is drawn');
  assert.ok(disc[2] <= secondX + 32, `left of the text: ${disc}`);
  assert.ok(disc[3] - disc[1] >= 4 && disc[3] - disc[1] <= 8, `a few pixels across: ${disc}`);
  assert.ok(
    near(pixel(frame, (disc[0] + disc[2]) / 2, (disc[1] + disc[3]) / 2), ink),
    'a disc is filled',
  );
  assert.ok(disc[1] > secondY + 6 && disc[3] < secondY + 18, 'beside the first line of text');
  const [mx, my] = middleItem.bounds();
  const circle = find(frame, ink, [mx, my, 30, 22]);
  assert.ok(circle, 'a circle is drawn');
  const hole = pixel(frame, (circle[0] + circle[2]) / 2, (circle[1] + circle[3]) / 2);
  assert.ok(
    hole[0] > ink[0] + 40,
    `a circle is hollow, not solid as a disc is: ${hole} against ${ink}`,
  );
  const [ix, iy] = inner.childNodes[0].bounds();
  const square = find(frame, ink, [ix, iy, 30, 22]);
  assert.ok(square, 'a square is drawn');
  assert.ok(
    near(pixel(frame, (square[0] + square[2]) / 2, (square[1] + square[3]) / 2), ink),
    'filled',
  );
  host.root.removeChild(deep);

  // Numbers: from 1, from `start`, reversed, in letters and numerals, and reset by `value`.
  const labels = (attributes, ...words) => {
    const list = el('ol', items(...words), attributes);
    place(list, 10, 10);
    settle();
    const out = markers(list);
    host.root.removeChild(list);
    return out;
  };
  assert.deepEqual(labels({}, 'a', 'b', 'c'), ['1.', '2.', '3.']);
  assert.deepEqual(labels({ start: '5' }, 'a', 'b'), ['5.', '6.']);
  assert.deepEqual(labels({ reversed: '' }, 'a', 'b', 'c'), ['3.', '2.', '1.']);
  assert.deepEqual(labels({ reversed: '', start: '10' }, 'a', 'b'), ['10.', '9.']);
  assert.deepEqual(labels({ type: 'a' }, 'a', 'b', 'c'), ['a.', 'b.', 'c.']);
  assert.deepEqual(labels({ type: 'A', start: '26' }, 'a', 'b'), ['Z.', 'AA.']);
  assert.deepEqual(labels({ type: 'i' }, 'a', 'b', 'c', 'd'), ['i.', 'ii.', 'iii.', 'iv.']);
  assert.deepEqual(labels({ type: 'I', start: '9' }, 'a', 'b'), ['IX.', 'X.']);
  assert.deepEqual(counter(1994, 'lower-roman'), 'mcmxciv');
  assert.deepEqual(counter(7, 'decimal-leading-zero'), '07');
  const reset = el('ol', items('a', 'b', 'c'));
  reset.childNodes[1].setAttribute('value', '10');
  place(reset, 10, 10);
  settle();
  assert.deepEqual(markers(reset), ['1.', '10.', '11.']);
  // The numbers are drawn, right-aligned in the gutter beside the first line.
  frame = await capture(host, 'numbers');
  const [nx, ny] = reset.childNodes[1].bounds();
  const digits = find(frame, ink, [nx, ny, 32, 22]);
  assert.ok(digits, 'a number is drawn');
  assert.ok(digits[2] <= nx + 25, `ending short of the text: ${digits}`);
  assert.ok(digits[2] - digits[0] > 8, 'two digits and a stop are wider than a bullet');

  // Kept right as items come and go.
  settle();
  const list = reset;
  const fresh = el('li', ['new']);
  list.insertBefore(fresh, list.childNodes[1]);
  settle();
  assert.deepEqual(markers(list), ['1.', '2.', '10.', '11.'], 'inserted: those after it follow');
  list.removeChild(list.childNodes[0]);
  settle();
  assert.deepEqual(markers(list), ['1.', '10.', '11.'], 'removed: the next takes its place');
  list.childNodes[1].removeAttribute('value');
  settle();
  assert.deepEqual(markers(list), ['1.', '2.', '3.'], 'and a value taken away');
  list.setAttribute('start', '3');
  settle();
  assert.deepEqual(markers(list), ['3.', '4.', '5.'], 'a start set later');
  list.setAttribute('type', 'a');
  settle();
  assert.deepEqual(markers(list), ['c.', 'd.', 'e.'], 'and a type');
  const gone = list.childNodes[0];
  gone.destroy();
  settle();
  assert.deepEqual(markers(list), ['c.', 'd.'], 'a destroyed item takes its marker with it');
  // Moved to another list, an item is numbered there.
  const other = el('ul', items('x'));
  place(other, 250, 10);
  settle();
  other.appendChild(list.childNodes[0]);
  settle();
  assert.deepEqual(markers(other), ['disc', 'disc'], 'in a bulleted list it is a bullet');
  assert.deepEqual(markers(list), ['c.'], 'and the one it left renumbers');
  host.root.removeChild(list);
  host.root.removeChild(other);

  // list-style-type: none takes the marker away, a name changes it, an item may set its own.
  const styled = el('ul', items('a', 'b'));
  place(styled, 10, 10);
  settle();
  assert.deepEqual(markers(styled), ['disc', 'disc']);
  styled.classList.add('plain');
  settle();
  assert.deepEqual(markers(styled), [null, null], 'none');
  styled.childNodes[1].setAttribute('style', 'list-style-type: square');
  settle();
  assert.deepEqual(markers(styled), [null, 'square'], 'an item sets its own over the list');
  styled.classList.remove('plain');
  styled.childNodes[1].removeAttribute('style');
  settle();
  assert.deepEqual(markers(styled), ['disc', 'disc'], 'and it is back');
  styled.classList.add('roman');
  settle();
  assert.deepEqual(markers(styled), ['I.', 'II.'], 'a counter style on a bulleted list');
  host.root.removeChild(styled);

  // What a framework does to an item's children leaves its marker alone.
  const rendered = el('ol', items('first', 'second'));
  place(rendered, 10, 10);
  settle();
  const item = rendered.childNodes[0];
  while (item.firstChild) {
    item.removeChild(item.firstChild);
  }
  item.appendChild(text('replaced'));
  item.appendChild(el('strong', ['bold']));
  settle();
  assert.deepEqual(markers(rendered), ['1.', '2.']);
  frame = await capture(host, 'rendered');
  const [rx, ry] = item.bounds();
  assert.ok(find(frame, ink, [rx, ry, 30, 22]), 'its marker is still drawn');
  // And the text is indented past it: flowed, since it holds an inline element.
  const inkText = find(frame, [0, 0, 0], [rx + 30, ry, 150, 22], 90);
  assert.ok(inkText && inkText[0] >= rx + 31, `the text starts past the gutter: ${inkText}`);
  host.root.removeChild(rendered);

  assert.deepEqual(errors, []);
  state.dispose();
} finally {
  host.dispose();
  context.dispose();
  target.dispose();
}
console.log('Native lists: bullets, numbers, renumbering, styles and re-rendering passed');
