// Inline flow in a window, where the painter lays out itself: a paragraph
// with inline elements settles within the layout of the frame that first
// shows it, so no presented frame shows it half-flowed, and a wrapped link
// takes a click.
import assert from 'node:assert/strict';
import { Scope } from '../dist/hmr.js';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { NativeWindowHost } from '../dist/native/window.js';
import { testWindow, waitForWindow } from './window-wait.mjs';

const native = loadNative();
const window = new NativeWindowHost(native, {
  ...testWindow,
  title: 'Inline flow',
  width: 400,
  height: 300,
});
const scope = new Scope();
const host = Host.create(native, scope);
const waitFor = (condition, message) => waitForWindow(window, condition, message);
try {
  await window.ready;
  host.root.setAttribute('style', 'background: #000000');
  host.layout.addStyleSheet(`
    p { position: absolute; left: 10px; top: 10px; width: 140px; font-size: 16px; color: #ffffff; line-height: 1.5; }
    a { color: #00ff00; }
  `);
  host.mount(window, { scope });
  await waitFor(() => window.frames > 0, 'First frame');
  const ratio = window.window.scaleFactor();
  const frames = [];
  const stop = window.captureFrames((frame) => frames.push(frame));

  // Added after the window is up: it is laid out and flowed before the first frame that shows it.
  const link = host.createElement('a');
  link.appendChild(host.createTextNode('a link long enough to run over a second line'));
  const p = host.createElement('p');
  for (const node of [
    host.createTextNode('See '),
    link,
    host.createTextNode(' for the rest of it, which goes on a good while.'),
  ]) {
    p.appendChild(node);
  }
  host.root.appendChild(p);
  await waitFor(() => frames.length > 0, 'a frame');
  await new Promise((resolve) => setTimeout(resolve, 200));

  const ink = (frame, test) => {
    let bottom = -1;
    let right = -1;
    let any = false;
    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) {
        const at = (y * frame.width + x) * 4;
        if (test(frame.pixels[at], frame.pixels[at + 1], frame.pixels[at + 2])) {
          bottom = Math.max(bottom, y);
          right = Math.max(right, x);
          any = true;
        }
      }
    }
    return any ? { bottom: (bottom + 1) / ratio, right: (right + 1) / ratio } : null;
  };
  const white = (r, g, b) => r > 120 && g > 120 && b > 120 && Math.abs(r - g) < 40;
  const final = ink(frames.at(-1), white);
  assert.ok(final, 'the paragraph is drawn');
  assert.ok(final.right <= 150.5, `inside its width: ${final.right}`);
  assert.ok(final.bottom > 10 + 24 * 2, `over several lines: ${final.bottom}`);
  for (const frame of frames) {
    const seen = ink(frame, white);
    assert.ok(seen, 'every frame that shows it shows it drawn');
    assert.ok(
      Math.abs(seen.bottom - final.bottom) <= 0.5 && seen.right <= 150.5,
      `no frame shows it half-flowed: ${JSON.stringify(seen)} against ${JSON.stringify(final)}`,
    );
  }

  // A press on the wrapped link's second line is a press on the link.
  const green = (r, g, b) => g > 150 && r < 80 && b < 80;
  const second = (() => {
    const frame = frames.at(-1);
    let found = null;
    for (let y = frame.height - 1; y >= 0 && !found; y--) {
      for (let x = 0; x < frame.width; x++) {
        const at = (y * frame.width + x) * 4;
        if (green(frame.pixels[at], frame.pixels[at + 1], frame.pixels[at + 2])) {
          found = { x: x / ratio, y: y / ratio };
          break;
        }
      }
    }
    return found;
  })();
  assert.ok(second, 'the link is drawn');
  assert.ok(second.y > 10 + 24, `its last pixel is below the first line: ${second.y}`);
  assert.equal(host.elementAt(second.x, second.y - 2), link, 'the second line is the link');
  let clicked = 0;
  link.addEventListener('click', () => clicked++);
  host.input.pointerMove(second.x, second.y - 2);
  host.input.pointerDown();
  host.input.pointerUp();
  assert.equal(clicked, 1);
  stop();
} finally {
  scope.dispose();
  window.dispose();
  await window.closed;
}
console.log(JSON.stringify({ test: 'Native inline flow in a window' }));
