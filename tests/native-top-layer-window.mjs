// The top layer in a window, where the painter lays out itself: an anchored
// panel is placed before the frame that first shows it, follows its anchor,
// flips at the window's edge, and fades away on Escape, read back frame by frame.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { Scope } from '../dist/hmr.js';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { NativeWindowHost } from '../dist/native/window.js';
import { placement } from '../dist/native/placement.js';
import { TopLayer } from '../dist/native/top-layer.js';
import { testWindow, waitForWindow } from './window-wait.mjs';

const native = loadNative();
const output = new URL('../.blinc/top-layer-window/', import.meta.url);
await mkdir(output, { recursive: true });
const css = `
.anchor { position: absolute; width: 60px; height: 20px; background: #ffffff; }
.panel { width: 80px; height: 40px; background: #ff0000; flex-shrink: 0; }
.panel[closing] { animation: fade 150ms linear forwards; }
backdrop[closing] { animation: fade 150ms linear forwards; }
@keyframes fade { from { opacity: 1; } to { opacity: 0; } }
`;
const window = new NativeWindowHost(native, {
  ...testWindow,
  title: 'Top layer',
  width: 400,
  height: 300,
});
const scope = new Scope();
const host = Host.create(native, scope);
const waitFor = (condition, message) => waitForWindow(window, condition, message);
try {
  await window.ready;
  host.root.setAttribute('style', 'background: #202020');
  host.layout.addStyleSheet(css);
  const anchor = host.createElement('div');
  anchor.setAttribute('class', 'anchor');
  anchor.setAttribute('style', 'left: 160px; top: 120px');
  host.root.appendChild(anchor);
  host.mount(window, { scope });
  await waitFor(() => window.frames > 0, 'First frame');
  const ratio = window.window.scaleFactor();
  const frames = [];
  const stop = window.captureFrames((frame) => frames.push(frame));
  const pixel = (frame, x, y) => {
    const at = (Math.round(y * ratio) * frame.width + Math.round(x * ratio)) * 4;
    return [...frame.pixels.subarray(at, at + 3)];
  };
  const isRed = (p) => p[0] > 200 && p[1] < 60 && p[2] < 60;
  const settled = async (message) => {
    let last = -1;
    await waitFor(() => {
      const quiet = window.frames === last;
      last = window.frames;
      return quiet && frames.at(-1)?.index === window.frames;
    }, message);
    return frames.at(-1);
  };
  const stack = TopLayer.of(host);

  // Opened under its anchor: the first frame that shows it has it in place.
  const panel = host.createElement('div');
  panel.setAttribute('class', 'panel');
  frames.length = 0;
  const entry = stack.open(panel, { placement: placement.beside(anchor, 'bottom', { gap: 4 }) });
  await waitFor(() => frames.length > 0, 'a frame with the panel');
  const seen = frames.filter((f) => isRed(pixel(f, 190, 164)));
  assert.ok(seen.length > 0, 'the panel is drawn under the anchor');
  assert.ok(
    frames.every((f) => !isRed(pixel(f, 20, 20)) && !isRed(pixel(f, 190, 20))),
    'and in no frame anywhere it was not going to be',
  );
  assert.deepEqual(panel.bounds().slice(0, 2), [150, 144]);

  // It follows the anchor as the window lays out for it, and flips at the bottom edge.
  anchor.setAttribute('style', 'left: 160px; top: 270px');
  const frame = await settled('moved with its anchor');
  assert.ok(isRed(pixel(frame, 190, 246)), 'flipped above an anchor near the bottom');
  assert.equal(panel.getAttribute('data-side'), 'top');
  await writeFile(
    new URL('flipped.png', output),
    PNG.sync.write({ width: frame.width, height: frame.height, data: Buffer.from(frame.pixels) }),
  );

  // Escape fades it out, each frame less of it, and then it is gone.
  frames.length = 0;
  host.input.keyDown({ key: 'Escape' });
  assert.equal(entry.isOpen, false);
  await entry.close();
  await settled('gone');
  const reds = frames.map((f) => pixel(f, 190, 246)[0]);
  assert.ok(reds.length >= 3, `${reds.length} frames of the exit`);
  assert.ok(reds[0] > 200 && reds.at(-1) < 0x30, `from drawn to gone: ${reds}`);
  for (let i = 1; i < reds.length; i++) {
    assert.ok(reds[i] <= reds[i - 1] + 2, `fading only goes one way: ${reds}`);
  }
  assert.equal(host.root.childNodes.length, 1, 'only the anchor is left');
  assert.equal(panel.destroyed, false, 'the content is kept');
  stop();
  await delay(50);
} finally {
  scope.dispose();
  window.dispose();
  await window.closed;
}
console.log(JSON.stringify({ test: 'Native top layer in a window', output: output.pathname }));
