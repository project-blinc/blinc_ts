import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';
import { THUMB_FADE, THUMB_LINGER } from '../dist/native/scrollbar.js';

const native = loadNative();
const W = 400;
const H = 300;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../.blinc/scrollbars/', import.meta.url);
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
const RED = [255, 0, 0];
const WHITE = [255, 255, 255];

const host = Host.create(native);
try {
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  host.root.setAttribute('style', 'background: #202020');
  host.layout.addStyleSheet(`
    .box { position: absolute; top: 20px; width: 100px; height: 80px; background: #ffffff;
      overflow: auto; flex-direction: column; scrollbar-color: #ff0000 transparent; }
    .tall { width: 80px; height: 300px; flex-shrink: 0; }
    .wide { width: 400px; height: 20px; flex-shrink: 0; }
  `);
  let nextLeft = 20;
  const box = (extra = '', content = 'tall') => {
    const element = host.createElement('div');
    element.setAttribute('class', 'box');
    element.setAttribute('style', `left: ${nextLeft}px;${extra}`);
    nextLeft += 120;
    const inner = host.createElement('div');
    inner.setAttribute('class', content);
    element.appendChild(inner);
    host.root.appendChild(element);
    return { element, inner };
  };
  // The vertical thumb is 4 wide, 2 in from the right edge; 24 long here, travelling 52 of the 76 track.
  const thumbAt = (pixels, b, along) => {
    const [x, y, w] = b.element.bounds();
    return pixel(pixels, x + w - 4, y + 2 + along);
  };

  // A scrolling box draws its thumb at the scroll position, and it moves with the scroll.
  const a = box();
  let frame = await capture(host, 'scrolled-top');
  assert.ok(near(thumbAt(frame, a, 10), RED), `a thumb at the top: ${thumbAt(frame, a, 10)}`);
  assert.ok(near(thumbAt(frame, a, 40), WHITE), 'and not further down');
  a.element.scrollTo(0, 110);
  frame = await capture(host, 'scrolled-middle');
  assert.ok(near(thumbAt(frame, a, 10), WHITE), 'it has left the top');
  assert.ok(near(thumbAt(frame, a, 26 + 12), RED), 'and is halfway down');
  a.element.scrollTo(0, 220);
  frame = await capture(host);
  assert.ok(near(thumbAt(frame, a, 52 + 12), RED), 'and at the bottom');
  assert.ok(near(thumbAt(frame, a, 10), WHITE));

  // Along the other axis, the thumb is at the bottom edge.
  const b = box('', 'wide');
  b.element.scrollTo(0, 0);
  frame = await capture(host);
  const [bx, by, , bh] = b.element.bounds();
  assert.ok(near(pixel(frame, bx + 10, by + bh - 4), RED), 'a thumb along the bottom');
  assert.ok(near(pixel(frame, bx + 90, by + bh - 4), WHITE), 'short of the right end');
  b.element.scrollTo(300, 0);
  frame = await capture(host);
  assert.ok(near(pixel(frame, bx + 90, by + bh - 4), RED), 'and at the right end');

  // Nothing to scroll, nothing to show.
  const fits = box('', 'tall');
  fits.inner.setAttribute('style', 'height: 20px');
  frame = await capture(host);
  assert.ok(near(thumbAt(frame, fits, 10), WHITE), 'a box that fits has no thumb');

  // Hidden three ways: no width, no visibility, no colour.
  nextLeft = 20;
  for (const [i, hide] of [
    'scrollbar-width: none;',
    'scrollbar-visibility: hidden;',
    'scrollbar-color: transparent transparent;',
  ].entries()) {
    const hidden = box(` top: 120px; ${hide}`);
    frame = await capture(host, `hidden-${i}`);
    assert.ok(near(thumbAt(frame, hidden, 10), WHITE), `${hide} draws none`);
    hidden.element.scrollTo(0, 50);
    frame = await capture(host);
    assert.ok(near(thumbAt(frame, hidden, 16), WHITE), `${hide} draws none scrolled either`);
  }
  // Coming back: the property cleared, the thumb is back.
  nextLeft = 20;
  const back = box(' top: 220px; scrollbar-width: none;');
  await capture(host);
  back.element.setProperty('scrollbar-width', null);
  frame = await capture(host);
  assert.ok(near(thumbAt(frame, back, 10), RED), 'clearing it brings the thumb back');
  host.root.removeChild(back.element);

  // With no colour given, a neutral one shows.
  const plain = host.createElement('div');
  plain.setAttribute(
    'style',
    'position: absolute; left: 260px; top: 120px; width: 100px; height: 80px; background: #ffffff; overflow: auto; flex-direction: column',
  );
  const plainInner = host.createElement('div');
  plainInner.setAttribute('style', 'width: 80px; height: 300px; flex-shrink: 0');
  plain.appendChild(plainInner);
  host.root.appendChild(plain);
  frame = await capture(host);
  const grey = pixel(frame, 260 + 96, 120 + 12);
  assert.ok(grey[0] < 230 && near(grey, [grey[0], grey[0], grey[0]], 2), `a grey thumb: ${grey}`);
  host.root.removeChild(plain);

  // `auto`: there while scrolling and a moment after, then gone.
  nextLeft = 20;
  const auto = box(' top: 220px; height: 60px; scrollbar-visibility: auto;');
  frame = await capture(host);
  const autoAt = (pixels, along) => {
    const [x, y, w] = auto.element.bounds();
    return pixel(pixels, x + w - 4, y + 2 + along);
  };
  assert.ok(near(autoAt(frame, 10), WHITE), 'not there at rest');
  auto.element.scrollTo(0, 5);
  frame = await capture(host);
  assert.ok(near(autoAt(frame, 10), RED), 'there as it scrolls');
  await delay(THUMB_LINGER / 2);
  auto.element.scrollTo(0, 10);
  const scrolledAt = performance.now();
  await delay(THUMB_LINGER / 2);
  frame = await capture(host);
  assert.ok(near(autoAt(frame, 14), RED), 'scrolling again keeps it');
  // Early in the fade, timed from the last scroll since a capture takes a while.
  await delay(Math.max(0, scrolledAt + THUMB_LINGER + 80 - performance.now()));
  frame = await capture(host, 'auto-fading');
  const fading = autoAt(frame, 14);
  assert.ok(!near(fading, WHITE, 6) && !near(fading, RED, 6), `fading: ${fading}`);
  await delay(THUMB_FADE + 100);
  frame = await capture(host);
  assert.ok(near(autoAt(frame, 14), WHITE), 'and gone');

  // `hover`: there while the pointer is over the box.
  nextLeft = 140;
  const hover = box(' top: 220px; height: 60px; scrollbar-visibility: hover;');
  frame = await capture(host);
  const [hx, hy, hw] = hover.element.bounds();
  assert.ok(near(pixel(frame, hx + hw - 4, hy + 12), WHITE), 'not there at rest');
  host.input.pointerMove(hx + 30, hy + 30);
  frame = await capture(host);
  assert.ok(near(pixel(frame, hx + hw - 4, hy + 12), RED), 'there under the pointer');
  host.input.pointerMove(390, 290);
  await delay(THUMB_FADE + 120);
  frame = await capture(host);
  assert.ok(near(pixel(frame, hx + hw - 4, hy + 12), WHITE), 'and gone when it leaves');

  // Sizes, and scrolling by a step, kept within the content.
  assert.equal(a.element.clientHeight, 80);
  assert.equal(a.element.scrollHeight, 300);
  assert.equal(b.element.scrollWidth, 400);
  assert.equal(fits.element.scrollHeight, 80, 'no less than its own size');
  a.element.scrollTo(0, 0);
  a.element.scrollBy(0, 30);
  assert.equal(a.element.scrollTop, 30);
  a.element.scrollBy(0, 1000);
  assert.equal(a.element.scrollTop, 220, 'stops at the end of the content');
  a.element.scrollBy(0, -1000);
  assert.equal(a.element.scrollTop, 0);

  // scrollIntoView: the least that shows it, or a chosen edge, through nested containers.
  const list = box(' top: 20px;', 'tall');
  list.inner.setAttribute('style', 'flex-direction: column');
  const rows = [];
  for (let i = 0; i < 10; i++) {
    const row = host.createElement('div');
    row.setAttribute('style', 'height: 30px; flex-shrink: 0');
    list.inner.appendChild(row);
    rows.push(row);
  }
  const visibleTop = (row) => row.bounds()[1] - list.element.bounds()[1] - list.element.scrollTop;
  list.element.scrollTo(0, 0);
  rows[1].scrollIntoView();
  assert.equal(list.element.scrollTop, 0, 'already in view: left where it is');
  rows[5].scrollIntoView();
  assert.equal(visibleTop(rows[5]) + 30, 80, "nearest from below: its end at the view's");
  rows[0].scrollIntoView();
  assert.equal(visibleTop(rows[0]), 0, "nearest from above: its start at the view's");
  rows[7].scrollIntoView({ block: 'start' });
  assert.equal(visibleTop(rows[7]), 0);
  rows[4].scrollIntoView({ block: 'center' });
  assert.equal(visibleTop(rows[4]), 25, 'centred: 80 / 2 - 30 / 2');
  rows[2].scrollIntoView({ block: 'end' });
  assert.equal(visibleTop(rows[2]) + 30, 80);
  list.element.scrollTo(0, 0);
  // Inside a scrolling box that is itself in a scrolling page.
  const page = host.createElement('div');
  page.setAttribute(
    'style',
    'position: absolute; left: 260px; top: 20px; width: 120px; height: 100px; overflow: auto; flex-direction: column',
  );
  const spacer = host.createElement('div');
  spacer.setAttribute('style', 'height: 200px; flex-shrink: 0');
  const inner = host.createElement('div');
  inner.setAttribute(
    'style',
    'height: 60px; width: 100px; overflow: auto; flex-shrink: 0; flex-direction: column',
  );
  const deep = host.createElement('div');
  deep.setAttribute('style', 'height: 20px; margin-top: 120px; flex-shrink: 0');
  inner.appendChild(deep);
  page.appendChild(spacer);
  page.appendChild(inner);
  host.root.appendChild(page);
  host.compute(W, H);
  deep.scrollIntoView();
  assert.ok(inner.scrollTop > 0, 'the nearer container scrolled');
  assert.ok(page.scrollTop > 0, 'and the one around it');
  const deepTop = deep.bounds()[1] - page.bounds()[1] - page.scrollTop - inner.scrollTop;
  assert.ok(deepTop >= 0 && deepTop + 20 <= 100, `it shows in the page's view: ${deepTop}`);

  assert.deepEqual(errors, []);
} finally {
  host.dispose();
  target.dispose();
}
console.log(
  'Native scrollbars: thumb position, hiding, auto and hover, sizes and scrollIntoView passed',
);
