import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative();
const W = 480;
const H = 320;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../.blinc/motion/', import.meta.url);
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

const css = `
.box { position: absolute; top: 20px; width: 100px; height: 60px; }
#fade { left: 20px; background: #ff0000; transition: opacity 100ms linear; }
#fade.out { opacity: 0; }
#tint { left: 140px; background: #000000; transition: background-color 100ms linear; }
#tint.on { background: #ffffff; }
#plain { left: 260px; background: #ff0000; }
#plain.out { opacity: 0; }
#pop { left: 380px; background: #ff0000; }
#pop.go { animation: grow 100ms linear forwards; }
@keyframes grow { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }
#flash { left: 20px; top: 100px; background: #ff0000; }
#flash.go { animation: flash 100ms linear; }
@keyframes flash { from { background: #ff0000; } to { background: #0000ff; } }
.dialog { left: 140px; top: 100px; background: #ff0000; }
.dialog[closing] { animation: shrink 100ms linear forwards; }
@keyframes shrink { from { opacity: 1; } to { opacity: 0; } }
#wide { left: 260px; top: 100px; background: #ff0000; transition: display 100ms linear; }
#wide.on { display: none; }
#missing { left: 380px; top: 100px; }
#missing.go { animation: nowhere 100ms; }
#themed { left: 20px; top: 180px; background: #000000; }
#themed.go { animation: themed 100ms linear forwards; }
#row { position: absolute; left: 140px; top: 180px; flex-direction: row; }
#grow { width: 40px; height: 20px; background: #ff0000; transition: width 100ms linear; }
#grow.on { width: 140px; }
#after { width: 20px; height: 20px; background: #0000ff; }
#list { position: absolute; left: 20px; top: 220px; width: 100px; flex-direction: column; }
#first { height: 20px; background: #00ff00; }
#first.tall { height: 60px; }
#second { height: 20px; background: #0000ff; }
#sizer { position: absolute; left: 300px; top: 220px; width: 60px; height: 20px; background: #ff0000; }
#sizer.tall { height: 60px; }
#away { position: absolute; left: 600px; top: 260px; width: 40px; height: 40px; background: #ff0000; transition: opacity 100ms linear; }
#away.out { opacity: 0; }
#scroller { position: absolute; left: 380px; top: 182px; width: 50px; height: 36px; overflow: auto; flex-direction: column; }
#spacer { height: 100px; flex-shrink: 0; }
#below { width: 40px; height: 20px; flex-shrink: 0; background: #ff0000; animation: dim 100ms linear infinite alternate; }
@keyframes dim { from { opacity: 1; } to { opacity: 0; } }
@keyframes themed { from { background: var(--from); } to { background: #000000; } }
`;

const context = native.createReactive();
const host = Host.create(native);
try {
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  host.root.setAttribute('style', 'background: #202020');
  host.layout.addStyleSheet(css);
  const make = (id, classes = 'box') => {
    const box = host.createElement('div');
    box.setAttribute('id', id);
    box.setAttribute('class', classes);
    host.root.appendChild(box);
    return box;
  };
  const fade = make('fade');
  const tint = make('tint');
  const plain = make('plain');
  const pop = make('pop');
  const flash = make('flash');
  const dialog = make('dialog', 'box dialog');
  const wide = make('wide');
  const missing = make('missing');
  const themed = make('themed');
  const row = host.createElement('div');
  row.setAttribute('id', 'row');
  host.root.appendChild(row);
  const grow = host.createElement('div');
  grow.setAttribute('id', 'grow');
  const after = host.createElement('div');
  after.setAttribute('id', 'after');
  row.appendChild(grow);
  row.appendChild(after);

  const at = (pixels, node, dx, dy) => {
    const [x, y] = node.bounds();
    return pixel(pixels, x + dx, y + dy);
  };

  // A first style is not a change: nothing runs for the boxes as created, bar the animations.
  let frame = await capture(host);
  assert.ok(near(at(frame, fade, 50, 30), RED), 'a transitioned box starts as styled');
  assert.ok(near(at(frame, tint, 50, 30), [0, 0, 0]), 'its tint starts black');

  // Transitions begin when a class changes, and run on the time the host gives.
  fade.classList.add('out');
  tint.classList.add('on');
  plain.classList.add('out');
  host.compute(W, H);
  assert.equal(host.layout.tickMotion(1000), true, 'a transition wants frames');
  frame = await capture(host);
  assert.ok(near(at(frame, fade, 50, 30), RED), 'at its start the old value shows');
  assert.ok(near(at(frame, plain, 50, 30), GROUND), 'a box with no transition changes at once');

  host.layout.tickMotion(1050);
  frame = await capture(host, 'halfway');
  assert.ok(
    near(at(frame, fade, 50, 30), [144, 16, 16], 6),
    `fade halfway ${at(frame, fade, 50, 30)}`,
  );
  assert.ok(
    near(at(frame, tint, 50, 30), [128, 128, 128], 6),
    `tint halfway ${at(frame, tint, 50, 30)}`,
  );

  // Turned back round mid-flight, the box goes from where it is, not from the end.
  fade.classList.remove('out');
  host.compute(W, H);
  host.layout.tickMotion(1060);
  frame = await capture(host);
  assert.ok(
    near(at(frame, fade, 50, 30), [144, 16, 16], 8),
    `reversal starts at ${at(frame, fade, 50, 30)}`,
  );
  host.layout.tickMotion(1160);
  frame = await capture(host);
  assert.ok(near(at(frame, fade, 50, 30), RED), 'and arrives back at the style');
  assert.ok(near(at(frame, tint, 50, 30), [255, 255, 255]), 'the tint arrived');
  assert.equal(host.layout.tickMotion(1200), false, 'nothing is left to ask frames for');

  // Keyframes: a box grows in, then holds its last frame.
  pop.classList.add('go');
  host.compute(W, H);
  host.layout.tickMotion(2000);
  frame = await capture(host);
  assert.ok(near(at(frame, pop, 6, 6), GROUND), 'it starts hidden');
  host.layout.tickMotion(2050);
  frame = await capture(host, 'pop');
  const [px, py] = pop.bounds();
  const mid = pixel(frame, px + 50, py + 30);
  assert.ok(mid[0] > 100 && mid[0] < 255 && mid[1] < 40, `half in ${mid}`);
  assert.ok(near(pixel(frame, px + 4, py + 4), GROUND), 'and half size: the corner is not reached');
  host.layout.tickMotion(2100);
  frame = await capture(host);
  assert.ok(near(at(frame, pop, 4, 4), RED), 'a forwards animation ends at its last frame');
  assert.equal(host.layout.tickMotion(2150), false);

  // A background animates between colours.
  flash.classList.add('go');
  host.compute(W, H);
  const flashFrame = async (t) => {
    host.layout.tickMotion(t);
    return at(await capture(host), flash, 50, 30);
  };
  await flashFrame(3000);
  const halfFlash = await flashFrame(3050);
  assert.ok(near(halfFlash, [128, 0, 128], 6), `flash halfway ${halfFlash}`);
  // Without a fill it lets go: the box is its styled red again.
  assert.ok(near(await flashFrame(3100), RED), 'an animation without a fill gives the style back');

  // An exit: set [closing], wait for the animation, then remove.
  let removed = false;
  dialog.setAttribute('closing', '');
  const exit = dialog.animationsFinished().then(() => {
    removed = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(removed, false, 'it waits while the animation runs');
  host.layout.tickMotion(4000);
  host.layout.tickMotion(4050);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(removed, false, 'and is not done halfway');
  assert.ok(near(at(await capture(host), dialog, 50, 30), [144, 16, 16], 6), 'the dialog fades');
  host.layout.tickMotion(4100);
  await exit;
  assert.equal(removed, true);
  assert.ok(near(at(await capture(host), dialog, 50, 30), GROUND), 'it stays faded');
  dialog.remove();
  assert.equal(host.root.childNodes.includes(dialog), false);

  // An element with no motion is finished at once; one destroyed mid-animation is released.
  await plain.animationsFinished();
  const second = make('second', 'box dialog');
  second.setAttribute('closing', '');
  const left = second.animationsFinished();
  second.remove();
  second.destroy();
  host.layout.flush();
  host.layout.tickMotion(5000);
  await left;

  // A keyframe reads the theme, and a theme change mid-flight recolours it in place.
  host.layout.setTheme({ '--from': '#ff0000' });
  themed.classList.add('go');
  host.compute(W, H);
  const themedAt = async (t) => {
    host.layout.tickMotion(t);
    return at(await capture(host), themed, 50, 30);
  };
  assert.ok(near(await themedAt(6000), RED), 'it starts in the theme colour');
  assert.ok(near(await themedAt(6050), [128, 0, 0], 6), 'and is halfway');
  host.layout.setTheme({ '--from': '#0000ff' });
  host.compute(W, H);
  assert.ok(
    near(await themedAt(6050), [0, 0, 128], 6),
    `after the switch it is halfway from the new colour: ${await themedAt(6050)}`,
  );

  // A width transitions through layout: the box is laid out at the width between, and what
  // follows it moves with it.
  host.compute(W, H);
  const [, , startWidth] = grow.bounds();
  assert.equal(startWidth, 40);
  grow.classList.add('on');
  host.compute(W, H);
  assert.equal(grow.bounds()[2], 40, 'held at the old width until the clock moves');
  host.layout.tickMotion(7000);
  host.layout.tickMotion(7050);
  host.compute(W, H);
  assert.equal(grow.bounds()[2], 90, `halfway: ${grow.bounds()[2]}`);
  assert.equal(after.bounds()[0], grow.bounds()[0] + 90, 'its sibling is laid out after it');
  const midway = await capture(host, 'width');
  assert.ok(near(at(midway, after, 10, 10), [0, 0, 255]), 'and drawn there');
  // Restyled for another reason mid-flight, the run goes on rather than starting again.
  after.setAttribute('style', 'width: 24px');
  host.compute(W, H);
  host.layout.tickMotion(7075);
  host.compute(W, H);
  assert.equal(grow.bounds()[2], 115);
  host.layout.tickMotion(7100);
  host.compute(W, H);
  assert.equal(grow.bounds()[2], 140);

  // Layout animation: pushed down by a sibling, a box is drawn from where it was and eases home.
  const list = host.createElement('div');
  list.setAttribute('id', 'list');
  const first = host.createElement('div');
  first.setAttribute('id', 'first');
  const pushed = host.createElement('div');
  pushed.setAttribute('id', 'second');
  list.appendChild(first);
  list.appendChild(pushed);
  host.root.appendChild(list);
  pushed.animateLayout({ duration: 100, easing: 'linear' });
  host.compute(W, H);
  const BLUE = [0, 0, 255];
  const flipAt = async (t) => {
    host.layout.tickMotion(t);
    return capture(host);
  };
  first.classList.add('tall');
  host.compute(W, H);
  assert.equal(pushed.bounds()[1], 280, 'layout settles at once');
  let flipped = await flipAt(8000);
  assert.ok(near(pixel(flipped, 70, 250), BLUE), 'drawn where it was');
  assert.ok(near(pixel(flipped, 70, 290), GROUND), 'not yet where it is laid out');
  flipped = await flipAt(8050);
  assert.ok(near(pixel(flipped, 70, 270), BLUE), 'halfway');
  let home = false;
  const settled = pushed.animationsFinished().then(() => (home = true));
  flipped = await flipAt(8100);
  assert.ok(near(pixel(flipped, 70, 290), BLUE), 'and home');
  await settled;
  assert.equal(home, true, 'animationsFinished waits for the move');

  // A child carried by its animated parent does not move again on its own.
  list.animateLayout({ duration: 100, easing: 'linear' });
  host.compute(W, H);
  list.setAttribute('style', 'left: 140px');
  host.compute(W, H);
  flipped = await flipAt(9000);
  flipped = await flipAt(9050);
  assert.ok(near(pixel(flipped, 85, 290), BLUE), 'the child rides with its parent, halfway over');
  assert.ok(near(pixel(flipped, 225, 290), GROUND), 'not at its own layout');
  assert.equal(
    await Promise.race([
      pushed.animationsFinished().then(() => 'done'),
      new Promise((resolve) => setTimeout(() => resolve('waiting'), 0)),
    ]),
    'done',
    'nor has a move of its own to wait for',
  );
  await flipAt(9100);

  // A resize is drawn at the size between, what it holds clipped to it.
  const sizer = host.createElement('div');
  sizer.setAttribute('id', 'sizer');
  host.root.appendChild(sizer);
  sizer.animateLayout({ duration: 100, easing: 'linear' });
  host.compute(W, H);
  sizer.classList.add('tall');
  host.compute(W, H);
  await flipAt(10000);
  flipped = await flipAt(10050);
  assert.ok(near(pixel(flipped, 330, 255), RED), 'drawn 40 tall halfway');
  assert.ok(near(pixel(flipped, 330, 265), GROUND), 'and no taller');
  flipped = await flipAt(10100);
  assert.ok(near(pixel(flipped, 330, 275), RED), 'then at its full height');
  sizer.animateLayout(null);

  // Out of view, motion keeps its clock but draws nothing and asks for no frames, only a wake.
  const away = host.createElement('div');
  away.setAttribute('id', 'away');
  host.root.appendChild(away);
  host.compute(W, H);
  away.classList.add('out');
  host.compute(W, H);
  assert.equal(host.layout.tickMotion(11000), false, 'no frames for what is out of view');
  assert.equal(host.layout.motionWake, 100, 'but a wake when it ends');
  assert.equal(host.layout.tickMotion(11040), false);
  assert.equal(host.layout.motionWake, 60);
  // Brought into view mid-flight, it is drawn where its clock has got to.
  away.setAttribute('style', 'left: 420px');
  host.compute(W, H);
  assert.equal(host.layout.tickMotion(11050), true, 'in view, it wants frames again');
  assert.ok(near(at(await capture(host), away, 20, 20), [144, 16, 16], 6), 'halfway');
  // It ends out of view, and is right when it is next seen.
  away.setAttribute('style', 'left: 600px');
  host.compute(W, H);
  host.layout.tickMotion(11060);
  host.layout.tickMotion(11100);
  assert.equal(host.layout.motionWake, null);
  away.setAttribute('style', 'left: 420px');
  assert.ok(near(at(await capture(host), away, 20, 20), GROUND), 'faded out');

  // Below a scroller's fold it asks for nothing; scrolled into view it is drawn as its clock says.
  const scroller = host.createElement('div');
  scroller.setAttribute('id', 'scroller');
  const spacer = host.createElement('div');
  spacer.setAttribute('id', 'spacer');
  const below = host.createElement('div');
  below.setAttribute('id', 'below');
  scroller.appendChild(spacer);
  scroller.appendChild(below);
  host.root.appendChild(scroller);
  host.compute(W, H);
  assert.equal(host.layout.tickMotion(12000), false, 'below the fold');
  assert.equal(host.layout.tickMotion(12025), false);
  // A scroll is not a layout: a window draws the next frame without laying out.
  scroller.scrollTo(0, 80);
  host.layout.flush();
  assert.equal(host.layout.tickMotion(12050), true, 'scrolled into view');
  const [sx, sy] = scroller.bounds();
  assert.ok(near(pixel(await capture(host), sx + 20, sy + 30), [144, 16, 16], 6), 'halfway dimmed');
  scroller.remove();

  // What motion cannot do is said once, not on every restyle.
  missing.classList.add('go');
  wide.classList.add('on');
  host.compute(W, H);
  wide.classList.remove('on');
  host.compute(W, H);
  wide.classList.add('on');
  host.compute(W, H);
  assert.equal(
    errors.filter((e) => /transition of "display"/.test(e)).length,
    1,
    `a transition of a keyword is reported once: ${errors}`,
  );
  assert.equal(
    errors.filter((e) => /no @keyframes/.test(e) && /nowhere/.test(e)).length,
    1,
    `${errors}`,
  );
  assert.equal(errors.length, 2, `nothing else was reported: ${errors}`);
} finally {
  host.dispose();
  context.dispose();
  target.dispose();
}
console.log('Native motion: transitions, interruption, keyframes, fills, exits and reports passed');
