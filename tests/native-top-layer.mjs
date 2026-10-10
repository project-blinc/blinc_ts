import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';
import { placement } from '../dist/native/placement.js';
import { TopLayer } from '../dist/native/top-layer.js';

const native = loadNative();
const W = 400;
const H = 300;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../.blinc/top-layer/', import.meta.url);
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
const near = (actual, expected, tolerance = 4) =>
  actual.every((c, i) => Math.abs(c - expected[i]) <= tolerance);
const GROUND = [0x20, 0x20, 0x20];
const RED = [255, 0, 0];
const WHITE = [255, 255, 255];

const css = `
.anchor { position: absolute; width: 60px; height: 20px; background: #ffffff; }
.panel { width: 80px; height: 40px; background: #ff0000; flex-shrink: 0; }
.panel[closing] { animation: fade 100ms linear forwards; }
backdrop[closing] { animation: fade 100ms linear forwards; }
@keyframes fade { from { opacity: 1; } to { opacity: 0; } }
`;

const clock = { now: 0 };
const advance = (ms) => host.layout.tickMotion((clock.now += ms));
const host = Host.create(native);
try {
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  host.root.setAttribute('style', 'background: #202020');
  host.layout.addStyleSheet(css);
  const make = (tag, className, style = '') => {
    const element = host.createElement(tag);
    if (className) {
      element.setAttribute('class', className);
    }
    if (style) {
      element.setAttribute('style', style);
    }
    return element;
  };
  const anchor = host.root.appendChild(make('div', 'anchor', 'left: 160px; top: 120px'));
  const stack = TopLayer.of(host);
  assert.equal(TopLayer.of(host), stack, 'one top layer a host');
  const settle = async (entry) => {
    const done = entry.close();
    let ended = false;
    void done.then(() => {
      ended = true;
    });
    for (let i = 0; i < 20 && !ended; i++) {
      advance(50);
      await new Promise((resolve) => setImmediate(resolve));
    }
    await done;
  };
  const boundsOf = (element) => element.bounds().map((v) => Math.round(v * 100) / 100);

  // Each side: where the box goes, centred along the anchor, and the side on data-side.
  const sides = {
    bottom: [150, 144],
    top: [150, 76],
    right: [224, 110],
    left: [76, 110],
  };
  for (const [side, [left, top]] of Object.entries(sides)) {
    const panel = make('div', 'panel');
    const entry = stack.open(panel, { placement: placement.beside(anchor, side, { gap: 4 }) });
    host.compute(W, H);
    assert.deepEqual(boundsOf(panel).slice(0, 2), [left, top], `${side}: placed`);
    assert.equal(panel.getAttribute('data-side'), side);
    const frame = await capture(host, `side-${side}`);
    assert.ok(near(pixel(frame, left + 40, top + 20), RED), `${side}: drawn there`);
    assert.ok(near(pixel(frame, left - 6, top + 20), side === 'right' ? WHITE : GROUND, 70));
    await settle(entry);
    assert.equal(panel.parentNode, null, `${side}: the content is let go`);
    assert.equal(panel.destroyed, false, 'and kept, to open again');
  }
  assert.equal(host.root.childNodes.length, 1, 'only the anchor is left under the root');

  // Flipped where there is no room, and kept inside the viewport.
  anchor.setAttribute('style', 'left: 160px; top: 270px');
  let panel = make('div', 'panel');
  let entry = stack.open(panel, { placement: placement.beside(anchor, 'bottom', { gap: 4 }) });
  host.compute(W, H);
  assert.deepEqual(boundsOf(panel).slice(0, 2), [150, 226], 'flipped above');
  assert.equal(panel.getAttribute('data-side'), 'top');
  await settle(entry);
  anchor.setAttribute('style', 'left: 0px; top: 120px');
  panel = make('div', 'panel');
  entry = stack.open(panel, { placement: placement.beside(anchor, 'bottom') });
  host.compute(W, H);
  assert.equal(panel.bounds()[0], 0, 'not past the left edge');
  assert.equal(entry.placed.arrow, 30, 'with its arrow on the anchor');
  await settle(entry);
  anchor.setAttribute('style', 'left: 160px; top: 120px');

  // It follows its content's size and its anchor's place, laid out again before the frame.
  panel = make('div', 'panel');
  entry = stack.open(panel, { placement: placement.beside(anchor, 'bottom', { gap: 4 }) });
  host.compute(W, H);
  panel.setProperty('width', 120);
  host.compute(W, H);
  assert.deepEqual(boundsOf(panel).slice(0, 2), [130, 144], 'recentred when it grows');
  anchor.setAttribute('style', 'left: 200px; top: 150px');
  host.compute(W, H);
  assert.deepEqual(boundsOf(panel).slice(0, 2), [170, 174], 'and when the anchor moves');
  await settle(entry);
  anchor.setAttribute('style', 'left: 160px; top: 120px');

  // A list below its control is at least as wide as it.
  const list = make('div', '', 'height: 40px; background: #ff0000');
  list.appendChild(make('div', '', 'width: 20px; height: 40px'));
  entry = stack.open(list, { placement: placement.below(anchor) });
  host.compute(W, H);
  assert.deepEqual(boundsOf(list), [160, 140, 60, 40], 'matches the control, stretched to it');
  assert.equal(list.getAttribute('data-side'), 'bottom');
  await settle(entry);

  // Centred, at an edge, and at a point.
  panel = make('div', 'panel');
  entry = stack.open(panel);
  host.compute(W, H);
  assert.deepEqual(boundsOf(panel), [160, 130, 80, 40], 'centred');
  await settle(entry);
  panel = make('div', '', 'width: 80px; background: #ff0000');
  panel.appendChild(make('div', '', 'height: 10px'));
  entry = stack.open(panel, { placement: placement.edge('left') });
  host.compute(W, H);
  assert.deepEqual(boundsOf(panel), [0, 0, 80, 300], 'pinned along the left edge');
  await settle(entry);
  panel = make('div', 'panel');
  entry = stack.open(panel, { placement: placement.at(370, 280) });
  host.compute(W, H);
  assert.deepEqual(boundsOf(panel).slice(0, 2), [290, 240], 'flipped left and up of a point');
  await settle(entry);

  // A modal dims what is beneath it.
  panel = make('div', 'panel');
  entry = stack.open(panel, { modal: true, backdrop: 'rgba(0, 0, 0, 0.5)' });
  let frame = await capture(host, 'modal');
  assert.ok(near(pixel(frame, 10, 10), [0x10, 0x10, 0x10], 3), 'the page is dimmed');
  assert.ok(near(pixel(frame, 200, 150), RED), 'the content is not');
  await settle(entry);
  frame = await capture(host);
  assert.ok(near(pixel(frame, 10, 10), GROUND), 'and the page is back');

  // A press outside closes it, and does not reach what is beneath; one inside does not close it.
  let clicks = 0;
  const under = host.root.appendChild(
    make('div', '', 'position: absolute; left: 10px; top: 10px; width: 50px; height: 50px'),
  );
  under.addEventListener('click', () => clicks++);
  const press = (x, y) => {
    host.input.pointerMove(x, y);
    host.input.pointerDown();
    host.input.pointerUp();
  };
  press(30, 30);
  assert.equal(clicks, 1, 'a press reaches it with nothing over it');
  panel = make('div', 'panel');
  entry = stack.open(panel, { placement: placement.at(100, 100) });
  host.compute(W, H);
  press(140, 120);
  assert.equal(entry.isOpen, true, 'a press on the content leaves it open');
  press(30, 30);
  assert.equal(entry.isOpen, false, 'a press outside closes it');
  assert.equal(clicks, 1, 'and goes no further');
  await settle(entry);
  panel = make('div', 'panel');
  entry = stack.open(panel, { placement: placement.at(100, 100), dismissible: false });
  host.compute(W, H);
  press(30, 30);
  host.input.keyDown({ key: 'Escape' });
  assert.equal(entry.isOpen, true, 'one that is not dismissible stays');
  await settle(entry);

  // Escape closes the topmost, and one that cannot be closed that way keeps it from those beneath.
  const first = make('div', 'panel');
  const second = make('div', 'panel');
  const a = stack.open(first, { placement: placement.at(10, 100) });
  const b = stack.open(second, { placement: placement.at(200, 100) });
  assert.deepEqual(stack.entries, [a, b], 'the topmost last');
  host.input.keyDown({ key: 'Escape' });
  assert.deepEqual([a.isOpen, b.isOpen], [true, false], 'the topmost goes');
  host.input.keyDown({ key: 'Escape' });
  assert.equal(a.isOpen, false);
  await Promise.all([settle(a), settle(b)]);
  const held = stack.open(make('div', 'panel'), { dismissible: false });
  const beneath = stack.open(make('div', 'panel'), {});
  const above = stack.open(make('div', 'panel'), { dismissible: false });
  host.input.keyDown({ key: 'Escape' });
  assert.deepEqual(
    [beneath.isOpen, above.isOpen],
    [true, true],
    'a topmost that stays shields the rest',
  );
  await Promise.all([settle(above), settle(beneath), settle(held)]);

  // Focus goes into a modal, stays in it, and comes back.
  const opener = host.root.appendChild(
    make('div', '', 'position: absolute; left: 300px; top: 10px; width: 40px; height: 20px'),
  );
  opener.setAttribute('tabindex', '0');
  opener.focus();
  assert.equal(host.input.focused, opener);
  const dialog = make('div', 'panel');
  const one = dialog.appendChild(make('div', '', 'width: 20px; height: 20px'));
  const two = dialog.appendChild(make('div', '', 'width: 20px; height: 20px'));
  one.setAttribute('tabindex', '0');
  two.setAttribute('tabindex', '0');
  entry = stack.open(dialog, { modal: true });
  assert.equal(host.input.focused, one, 'focus moves into it');
  host.input.keyDown({ key: 'Tab' });
  assert.equal(host.input.focused, two);
  host.input.keyDown({ key: 'Tab' });
  assert.equal(host.input.focused, one, 'and wraps inside it');
  host.input.keyDown({ key: 'Escape' });
  assert.equal(host.input.focused, opener, 'focus returns as it closes');
  await settle(entry);
  host.input.keyDown({ key: 'Tab' });
  assert.notEqual(host.input.focused, one, 'no trap is left behind');

  // A popover that is not modal leaves focus alone; one that kept it hands it back.
  panel = make('div', 'panel');
  panel.setAttribute('tabindex', '0');
  entry = stack.open(panel, { placement: placement.at(100, 100) });
  assert.equal(host.input.focused, opener, 'not moved');
  panel.focus();
  await settle(entry);
  assert.equal(host.input.focused, opener, 'back to what had it');

  // While it closes, presses pass through; it keeps its animation until it ends.
  panel = make('div', 'panel');
  entry = stack.open(panel, { placement: placement.at(100, 100) });
  host.compute(W, H);
  const closing = entry.close();
  assert.equal(panel.getAttribute('closing'), '', 'marked closing for a stylesheet');
  host.compute(W, H);
  press(30, 30);
  assert.equal(clicks, 2, 'a press goes through what is closing');
  let ended = false;
  void closing.then(() => {
    ended = true;
  });
  advance(1);
  advance(50);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ended, false, 'it is kept while it animates');
  frame = await capture(host);
  assert.ok(near(pixel(frame, 140, 120), [144, 16, 16], 8), 'halfway faded');
  advance(100);
  await closing;
  assert.equal(panel.parentNode, null);
  assert.equal(panel.getAttribute('closing'), null, 'not left marked');
  assert.equal(host.root.childNodes.includes(entry.layer), false, 'the layer is gone');

  // Opened again while it was closing, it stays in its new place when the old one ends.
  panel = make('div', 'panel');
  entry = stack.open(panel, { placement: placement.at(100, 100) });
  host.compute(W, H);
  const old = entry.close();
  host.compute(W, H);
  const again = stack.open(panel, { placement: placement.at(200, 100) });
  host.compute(W, H);
  advance(1);
  advance(200);
  await old;
  assert.notEqual(panel.parentNode, null, 'still in the new layer');
  assert.deepEqual(boundsOf(panel).slice(0, 2), [200, 100]);
  assert.equal(panel.getAttribute('closing'), null);
  await settle(again);
  assert.throws(() => {
    const open = stack.open(panel);
    stack.open(panel);
    void open;
  }, /already open/);
  await settle(stack.entries[0]);

  // A tooltip takes no presses; a hover card keeps the page's, and takes its own.
  panel = make('div', 'panel');
  entry = stack.open(panel, { placement: placement.at(100, 100), passThrough: true });
  host.compute(W, H);
  press(140, 120);
  press(30, 30);
  assert.equal(clicks, 3, 'a press anywhere, over it too, reaches what is beneath');
  await settle(entry);
  let inside = 0;
  panel = make('div', 'panel');
  panel.addEventListener('click', () => inside++);
  entry = stack.open(panel, { placement: placement.at(100, 100), modeless: true });
  host.compute(W, H);
  press(30, 30);
  assert.equal(clicks, 4, 'the page beneath still takes its presses');
  press(140, 120);
  assert.equal(inside, 1, 'and the content its own');
  assert.equal(entry.isOpen, true, 'a press elsewhere does not close it');
  host.input.keyDown({ key: 'Escape' });
  assert.equal(entry.isOpen, false, 'but Escape does');
  await settle(entry);

  assert.deepEqual(errors, []);
  assert.equal(host.root.childNodes.length, 3, 'everything opened is gone');
} finally {
  host.dispose();
  target.dispose();
}
console.log(
  'Native top layer: placement, flipping, following, dismissal, focus, exit and pass-through passed',
);
