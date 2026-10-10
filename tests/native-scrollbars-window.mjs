// Scroll thumbs in a window, where nothing but a change asks for a frame: an
// `auto` thumb shows as the box scrolls, fades over presented frames that
// only ever lose it, and then the window draws nothing more.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Scope } from '../dist/hmr.js';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { NativeWindowHost } from '../dist/native/window.js';
import { THUMB_FADE, THUMB_LINGER } from '../dist/native/scrollbar.js';
import { testWindow, waitForWindow } from './window-wait.mjs';

const native = loadNative();
const window = new NativeWindowHost(native, {
  ...testWindow,
  title: 'Scroll thumbs',
  width: 300,
  height: 200,
});
const scope = new Scope();
const host = Host.create(native, scope);
const waitFor = (condition, message) => waitForWindow(window, condition, message);
try {
  await window.ready;
  host.root.setAttribute('style', 'background: #202020');
  const box = host.createElement('div');
  box.setAttribute(
    'style',
    'position: absolute; left: 20px; top: 20px; width: 100px; height: 80px; background: #ffffff; overflow: auto; flex-direction: column; scrollbar-color: #ff0000 transparent; scrollbar-visibility: auto',
  );
  const content = host.createElement('div');
  content.setAttribute('style', 'width: 80px; height: 300px; flex-shrink: 0');
  box.appendChild(content);
  host.root.appendChild(box);
  host.mount(window, { scope });
  await waitFor(() => window.frames > 0, 'First frame');
  await delay(100);
  const ratio = window.window.scaleFactor();
  const frames = [];
  const stop = window.captureFrames((frame) => frames.push(frame));
  // The thumb's red in the middle of its track, as a share of the way from the page's white to red.
  const thumb = (frame) => {
    const x = Math.round((20 + 100 - 4) * ratio);
    const y = Math.round((20 + 2 + 12) * ratio);
    const at = (y * frame.width + x) * 4;
    return (255 - frame.pixels[at + 1]) / 255;
  };

  assert.equal(frames.length, 0, 'nothing is drawn while nothing changes');
  box.scrollTo(0, 10);
  const scrolledAt = performance.now();
  await waitFor(() => frames.length > 0, 'a frame for the scroll');
  assert.ok(thumb(frames[0]) > 0.95, `the thumb shows as it scrolls: ${thumb(frames[0])}`);

  // Quiet while it lingers: no frames drawn for nothing.
  await delay(THUMB_LINGER / 2);
  assert.ok(frames.length <= 3, `${frames.length} frames while a thumb merely stays`);
  // Then it fades, over frames that only lose it.
  await delay(Math.max(0, scrolledAt + THUMB_LINGER + THUMB_FADE + 200 - performance.now()));
  const shares = frames.map(thumb);
  assert.ok(shares.length >= 4, `${shares.length} frames across the fade`);
  assert.ok(shares.at(-1) < 0.02, `and it is gone: ${shares.at(-1)}`);
  for (let i = 1; i < shares.length; i++) {
    assert.ok(shares[i] <= shares[i - 1] + 0.02, `fading only goes one way: ${shares}`);
  }
  assert.ok(
    shares.some((v) => v > 0.1 && v < 0.9),
    `with frames between shown and gone: ${shares}`,
  );
  // Then quiet again.
  const quiet = window.frames;
  await delay(300);
  assert.equal(window.frames, quiet, 'no frames once it is gone');
  stop();
} finally {
  scope.dispose();
  window.dispose();
  await window.closed;
}
console.log(JSON.stringify({ test: 'Native scroll thumbs in a window' }));
