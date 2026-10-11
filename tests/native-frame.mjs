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
} finally {
  host.dispose();
  target.dispose();
}
console.log('Native frame: an event and the frame after it, laid out before they are drawn');
