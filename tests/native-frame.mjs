// A frame lays out what an event just changed: a window runs a frame in the same turn as the
// events it handles, so the edits are still queued when the frame begins.
import assert from 'node:assert/strict';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { FrameLayout } from '../dist/native/frame-layout.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative();
const W = 300;
const H = 200;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const host = Host.create(native);
try {
  const row = host.createElement('div');
  row.setAttribute(
    'style',
    'position: absolute; left: 10px; top: 10px; flex-direction: row; gap: 4px',
  );
  const button = host.createElement('button');
  button.appendChild(host.createTextNode('Count'));
  const readout = host.createTextNode('0');
  row.appendChild(button);
  row.appendChild(readout);
  host.root.appendChild(row);
  // The click changes text, which changes the row's width: an edit to layout, made by an event.
  button.addEventListener('click', () => {
    readout.data = `${Number(readout.data) * 10 + 7} items counted so far`;
  });
  host.compute(W, H);

  const frame = new FrameLayout(host.layout, host.root.layoutNode);
  host.layout.onChange((change) => frame.changed(change));
  let clock = 0;
  const draw = async () => {
    const moving = frame.prepare(W, H, 1, () => (clock += 16));
    const renderer = new SceneRenderer(target.device, host.layout);
    try {
      renderer.useImages(host.images.library);
      await target.captureCommandsInto(
        new Uint8Array(W * H * 4),
        (encoder, view) =>
          renderer.encode(encoder, host.root.layoutNode, view, { width: W, height: H, scale: 1 })
            .drawCalls,
      );
    } finally {
      renderer.dispose();
    }
    return moving;
  };
  await draw();
  const before = readout.bounds()[2];
  // The event and the frame follow one another with no turn between them. A click made in code
  // changes no pointer state, so what it writes is all that is waiting.
  button.click();
  await draw();
  assert.ok(readout.bounds()[2] > before, 'the frame laid out what the click changed');
  // And again, the way a user clicks over and over.
  for (let i = 0; i < 3; i++) {
    button.click();
    await draw();
  }
  // A resize is laid out too.
  const rows = readout.bounds()[3];
  frame.prepare(W / 2, H, 1, () => (clock += 16));
  assert.ok(readout.bounds()[3] >= rows, 'a narrower window lays out again');
  // What a read of a size saw before the first frame is not where an element moves from: a layout
  // made for a size read lays the page out before it is placed, and a window draws it laid out.
  const stage = Host.create(native);
  try {
    const box = stage.createElement('div');
    box.setAttribute(
      'style',
      'position: absolute; left: 50%; top: 10px; width: 20px; height: 20px; background: #ff0000',
    );
    stage.root.appendChild(box);
    box.animateLayout({ duration: 100, easing: 'linear' });
    stage.compute(100, 100);
    assert.equal(box.bounds()[0], 50, 'a read laid it out at the width it was given');
    const staged = new FrameLayout(stage.layout, stage.root.layoutNode);
    stage.layout.onChange((change) => staged.changed(change));
    assert.equal(
      staged.prepare(400, 300, 1, () => 1000),
      false,
      'the first frame is where it starts',
    );
    assert.equal(box.bounds()[0], 200, 'laid out at the size of the window');
    assert.equal(
      staged.prepare(400, 300, 1, () => 1016),
      false,
      'and nothing moves after it',
    );
    // A read between frames, at a size the window is not, is not a layout to move from.
    stage.compute(100, 100);
    stage.layout.queue();
    assert.equal(
      staged.prepare(400, 300, 1, () => 1032),
      false,
      'a read between frames moves nothing',
    );
    // A later change of the window is a move.
    assert.equal(
      staged.prepare(200, 300, 1, () => 2000),
      true,
      'a resize moves it',
    );
  } finally {
    stage.dispose();
  }
  // A frame whose restyle starts a transition still measures what layout moved: the knob of a
  // switch slides while its track's colour eases, both started by one change.
  const track = Host.create(native);
  try {
    track.layout.addStyleSheet(`
      .track { position: absolute; left: 0; top: 0; width: 200px; height: 20px; flex-direction: row;
        justify-content: flex-start; background: #202020; transition: background 150ms; }
      .track.on { justify-content: flex-end; background: #000000; }
      .knob { width: 20px; height: 20px; background: #ffffff; }
    `);
    const row = track.createElement('div');
    row.className = 'track';
    const knob = track.createElement('div');
    knob.className = 'knob';
    row.appendChild(knob);
    track.root.appendChild(row);
    knob.animateLayout({ duration: 160, easing: 'linear' });
    const frames = new FrameLayout(track.layout, track.root.layoutNode);
    track.layout.onChange((change) => frames.changed(change));
    let now = 0;
    const pixels = new Uint8Array(W * H * 4);
    const knobAt = async () => {
      frames.prepare(W, H, 1, () => (now += 16));
      const renderer = new SceneRenderer(target.device, track.layout);
      try {
        await target.captureCommandsInto(
          pixels,
          (encoder, view) =>
            renderer.encode(encoder, track.root.layoutNode, view, { width: W, height: H, scale: 1 })
              .drawCalls,
        );
      } finally {
        renderer.dispose();
      }
      for (let x = 0; x < W; x++) {
        if (pixels[(10 * W + x) * 4] > 200) {
          return x;
        }
      }
      return -1;
    };
    assert.equal(await knobAt(), 0, 'the knob starts at the left');
    row.classList.add('on');
    const drawn = [];
    for (let i = 0; i < 12; i++) {
      drawn.push(await knobAt());
    }
    assert.equal(drawn.at(-1), 180, `it ends at the right: ${drawn}`);
    assert.ok(
      drawn.some((x) => x > 20 && x < 160),
      `and is drawn on its way, not at its end at once: ${drawn}`,
    );
    // Asked straight after a change, before the frame that lays it out, the knob's motion is the
    // move that frame starts: the promise waits for it to end, not for nothing.
    row.classList.remove('on');
    let done = false;
    const finished = knob.animationsFinished().then(() => (done = true));
    await Promise.resolve();
    assert.equal(done, false, 'nothing has been laid out yet, and it waits');
    await knobAt();
    await knobAt();
    assert.equal(done, false, 'two frames into the move, it still waits');
    for (let i = 0; i < 12; i++) {
      await knobAt();
    }
    await finished;
    assert.equal(done, true, 'and it is told when the move has ended');
  } finally {
    track.dispose();
  }
} finally {
  host.dispose();
  target.dispose();
}
console.log('Native frame: an event and the frame after it, laid out before they are drawn');
