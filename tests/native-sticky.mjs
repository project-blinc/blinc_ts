// position: sticky: a header held at the top of its scroll box while its section scrolls, going up
// with the end of the section, seen in the pixels, found by a press, and horizontal too.
import assert from 'node:assert/strict';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative(process.env.BLINC_CALC_ADDON);
const W = 200;
const H = 160;
const host = Host.create(native);
const errors = [];
host.onStyleErrors((e) => errors.push(...e));
host.layout.addStyleSheet(`
  .box { position: absolute; left: 20px; top: 20px; width: 160px; height: 100px; overflow: auto;
    scrollbar-width: none; flex-direction: column; }
  .section { width: 160px; height: 200px; flex-shrink: 0; flex-direction: column; }
  .head { position: sticky; top: 0; width: 160px; height: 20px; flex-shrink: 0; background: #ff0000; }
  .body { width: 160px; height: 180px; flex-shrink: 0; background: #202020; }
`);
host.root.setAttribute('style', 'background: #000000');
const el = (cls, parent) => {
  const e = host.createElement('div');
  e.setAttribute('class', cls);
  parent.appendChild(e);
  return e;
};
const box = el('box', host.root);
const first = el('section', box);
const header = el('head', first);
el('body', first);
const second = el('section', box);
const header2 = el('head', second);
el('body', second);
host.compute(W, H);
const target = await OffscreenRenderer.create(native, W * 2, H * 2, probeShader);
const renderer = new SceneRenderer(target.device, host.layout);
const px = new Uint8Array(W * 2 * H * 2 * 4);
const frame = async () => {
  host.compute(W, H);
  await target.captureCommandsInto(
    px,
    (encoder, view) =>
      renderer.encode(encoder, host.root.layoutNode, view, {
        width: W * 2,
        height: H * 2,
        scale: 2,
      }).drawCalls,
  );
};
const red = (x, y) => {
  const i = (y * 2 * W * 2 + x * 2) * 4;
  return px[i] > 200 && px[i + 1] < 40;
};
try {
  await frame();
  assert.ok(red(100, 30), 'the header starts at the top of the box');
  assert.deepEqual(header.viewBounds().slice(0, 2), [20, 20]);

  // Scrolled into the section, the header is still at the top of the box.
  box.scrollBy(0, 60);
  await frame();
  assert.ok(red(100, 30), 'held at the top as the section scrolls');
  assert.deepEqual(header.viewBounds().slice(0, 2), [20, 20], 'its bounds are where it is drawn');
  assert.equal(host.elementAt(100, 30), header, 'what is at the top of the box is the header');

  // A press where it is held reaches it, not what it has scrolled over.
  let pressed = 0;
  header.addEventListener('click', () => pressed++);
  host.input.pointerMove(100, 30);
  host.input.pointerDown();
  host.input.pointerUp();
  assert.equal(pressed, 1, 'a press on the held header reaches it');

  // The next section's header arrives and pushes the first up and away.
  box.scrollBy(0, 150);
  await frame();
  const [, y1] = header.viewBounds();
  const [, y2] = header2.viewBounds();
  assert.ok(y1 < 20, `the first goes up with its section: ${y1}`);
  assert.equal(y2, 20, 'the second is held at the top');

  // Back at the top, they are where layout put them; a sticky header without its section's room
  // does not leave it.
  box.scrollBy(0, -1000);
  await frame();
  assert.equal(header2.viewBounds()[1], 20 + 200, 'unscrolled, the second is below');

  // A calculated inset uses its containing block and follows a resize while held.
  header.setAttribute('style', 'top: calc(10% + 2px)');
  box.scrollBy(0, 60);
  await frame();
  assert.equal(header.viewBounds()[1], 42, '10% of the 200px section, plus 2px');
  assert.ok(red(100, 47), 'the calculated inset is used by the paint walk');
  first.setAttribute('style', 'height: 240px');
  await frame();
  assert.equal(header.viewBounds()[1], 46, 'the inset follows its containing block');
  first.setAttribute('style', '');
  await frame();

  // Taken out of sticky, it scrolls away like any other.
  header.setAttribute('style', 'position: relative; top: calc(10% + 2px)');
  await frame();
  assert.ok(header.viewBounds()[1] < 20, 'no longer held');
  assert.deepEqual(errors, []);
} finally {
  renderer.dispose();
  target.dispose();
  host.dispose();
}
console.log(
  'Native sticky: held in view, in the pixels, bounds and presses, leaving with its section passed',
);
