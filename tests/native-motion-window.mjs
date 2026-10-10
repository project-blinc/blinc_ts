// Motion as a window presents it: every frame is read back as it was drawn,
// with the clock its motion was sampled at, so the sequence of values on
// screen is checked against the declared curve, frame by frame. Filmstrips
// and the motion report are written to .blinc/motion-window/.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { Scope } from '../dist/hmr.js';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { NativeWindowHost } from '../dist/native/window.js';
import { MotionTrace, motionReport } from '../dist/debug/motion.js';
import { testWindow, waitForWindow } from './window-wait.mjs';

const native = loadNative();
const W = 480;
const H = 260;
const DURATION = 300;
const output = new URL('../.blinc/motion-window/', import.meta.url);
await mkdir(output, { recursive: true });

const css = `
.box { position: absolute; top: 20px; width: 100px; height: 80px; }
#fade { left: 20px; background: #ff0000; transition: opacity ${DURATION}ms linear; }
#fade.out { opacity: 0; }
#panel { left: 140px; background: #ff0000; }
#panel[open] { animation: enter ${DURATION}ms linear; }
#panel[closing] { animation: leave ${DURATION}ms linear forwards; }
#panel:not([open]):not([closing]) { opacity: 0; }
@keyframes enter { from { opacity: 0; } to { opacity: 1; } }
@keyframes leave { from { opacity: 1; } to { opacity: 0; } }
#slide { left: 260px; width: 40px; height: 40px; background: #00ff00; transition: transform ${DURATION}ms linear; }
#slide.moved { transform: translateX(160px); }
#bounce { left: 20px; top: 110px; width: 30px; height: 30px; background: #00ff00; transition: transform spring(1 170 10); }
#bounce.moved { transform: translateX(200px); }
#bar { position: absolute; left: 20px; top: 160px; width: 40px; height: 20px; background: #ff0000; transition: width ${DURATION}ms linear; }
#bar.full { width: 240px; }
#stack { position: absolute; left: 300px; top: 160px; width: 60px; flex-direction: column; }
#opener { height: 10px; background: #ff0000; }
#opener.tall { height: 50px; }
#rider { height: 20px; background: #00ff00; }
#elsewhere { position: absolute; left: 2000px; top: 0px; width: 40px; height: 40px; background: #ff0000; animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(180deg); } }
`;

const window = new NativeWindowHost(native, {
  ...testWindow,
  title: 'Motion verification',
  width: W,
  height: H,
});
const scope = new Scope();
const host = Host.create(native, scope);
const waitFor = (condition, message, options) => waitForWindow(window, condition, message, options);
const errors = [];
const report = [];
try {
  await window.ready;
  host.onStyleErrors((e) => errors.push(...e));
  host.root.setAttribute('style', 'background: #202020');
  host.layout.addStyleSheet(css);
  const make = (id) => {
    const box = host.createElement('div');
    box.setAttribute('id', id);
    box.setAttribute('class', 'box');
    return host.root.appendChild(box);
  };
  const fade = make('fade');
  const panel = make('panel');
  const slide = make('slide');
  const bounce = make('bounce');
  const bar = host.createElement('div');
  bar.setAttribute('id', 'bar');
  host.root.appendChild(bar);
  const stack = host.createElement('div');
  stack.setAttribute('id', 'stack');
  const opener = host.createElement('div');
  opener.setAttribute('id', 'opener');
  const rider = host.createElement('div');
  rider.setAttribute('id', 'rider');
  stack.appendChild(opener);
  stack.appendChild(rider);
  host.root.appendChild(stack);
  rider.animateLayout({ duration: DURATION, easing: 'linear' });
  // Out of view all along, an endless animation asks for no frames: every phase below waits
  // for the window to go quiet around it.
  const elsewhere = host.createElement('div');
  elsewhere.setAttribute('id', 'elsewhere');
  host.root.appendChild(elsewhere);
  host.mount(window, { scope });
  await waitFor(() => window.frames > 0, 'First frame');
  await delay(100);
  const ratio = window.window.scaleFactor();

  const captured = [];
  const stop = window.captureFrames((frame) => captured.push(frame));
  const pixel = (frame, x, y) => {
    const at = (Math.round(y * ratio) * frame.width + Math.round(x * ratio)) * 4;
    return [...frame.pixels.subarray(at, at + 3)];
  };
  // Red over the #202020 ground, as an opacity.
  const opacityAt = (node) => (frame) => {
    const [x, y, w, h] = node.bounds();
    return (pixel(frame, x + w / 2, y + h / 2)[0] - 0x20) / (255 - 0x20);
  };
  // Where a green box's left edge is along its row, in layout pixels.
  const edgeOf = (node) => (frame) => {
    const [, y, , h] = node.bounds();
    for (let x = 0; x < W; x++) {
      const [r, g, b] = pixel(frame, x, y + h / 2);
      if (g > 200 && r < 60 && b < 60) {
        return x;
      }
    }
    return Number.NaN;
  };
  const slideAt = edgeOf(slide);

  /** Run `change`, wait for `node`'s motion to end and the window to go quiet; the frames it presented. */
  const play = async (name, node, change) => {
    captured.length = 0;
    const before = window.frames;
    change();
    await Promise.race([
      node.animationsFinished(),
      delay(5000).then(() => assert.fail(`${name}: the motion did not finish`)),
    ]);
    // Idle again: nothing more is presented, and every frame presented has been read back.
    let quiet = window.frames;
    await waitFor(() => {
      const settled = window.frames === quiet && captured.at(-1)?.index === window.frames;
      quiet = window.frames;
      return settled;
    }, `${name}: the window goes quiet`);
    // Readbacks of frames presented before the change can land after it.
    const frames = captured.filter((f) => f.index > before).sort((a, b) => a.index - b.index);
    assert.ok(
      frames.length > 0 && frames[0].index === before + 1,
      `${name}: every frame was read back`,
    );
    return frames;
  };

  /** Check `frames` against a linear move from `from` to `to`, starting at the first frame. */
  const trace = async (name, frames, measure, from, to, tolerance = 0.03) => {
    const start = frames[0].time;
    const motion = new MotionTrace(
      [
        {
          id: name,
          targetId: name,
          label: name,
          property: name,
          kind: 'transition',
          from,
          to,
          startMs: start,
          durationMs: DURATION,
          easing: 'linear',
        },
      ],
      tolerance,
    );
    const values = frames.map(measure);
    frames.forEach((frame, i) => motion.sample(name, frame.index, frame.time, values[i]));
    const snapshot = motion.snapshot();
    report.push(motionReport(snapshot));
    await filmstrip(name, frames);
    assert.equal(snapshot.issueCount, 0, `${name}:\n${motionReport(snapshot)}`);
    // Presented often enough to show the move, and never stalled.
    const inside = frames.filter((f) => f.time < start + DURATION);
    assert.ok(inside.length >= 6, `${name}: ${inside.length} frames during the move`);
    const gaps = frames.slice(1).map((f, i) => f.time - frames[i].time);
    assert.ok(
      Math.max(...gaps) < 100,
      `${name}: a ${Math.max(...gaps).toFixed(0)}ms gap between frames`,
    );
    return values;
  };

  /** The frames side by side, scaled to layout pixels, for looking at. */
  const filmstrip = async (name, frames) => {
    const shown = frames.slice(0, 40);
    const png = new PNG({ width: W, height: H * shown.length });
    shown.forEach((frame, row) => {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const from = (Math.floor(y * ratio) * frame.width + Math.floor(x * ratio)) * 4;
          const to = ((row * H + y) * W + x) * 4;
          png.data.set(frame.pixels.subarray(from, from + 4), to);
        }
      }
    });
    await writeFile(new URL(`${name}.png`, output), PNG.sync.write(png));
  };

  // A transition: the first frame shows where it starts, each frame is on the curve, and it ends there.
  const fading = await play('fade', fade, () => fade.classList.add('out'));
  const fadeValues = await trace('fade', fading, opacityAt(fade), 1, 0);
  assert.ok(fadeValues[0] > 0.97, `the first frame is not the end: ${fadeValues[0]}`);

  // Turned back halfway, it goes from where it is: no frame jumps.
  captured.length = 0;
  fade.classList.remove('out');
  await waitFor(
    () => captured.some((f) => opacityAt(fade)(f) > 0.4),
    'the fade comes back halfway',
  );
  const turned = await play('reverse', fade, () => fade.classList.add('out'));
  const back = turned.map(opacityAt(fade));
  for (let i = 1; i < back.length; i++) {
    const step = Math.abs(back[i] - back[i - 1]);
    const allowed = (turned[i].time - turned[i - 1].time) / DURATION + 0.05;
    assert.ok(step <= allowed, `reverse: frame ${turned[i].index} jumps ${step.toFixed(3)}`);
  }
  assert.ok(back[0] < 0.97, 'the turn starts partway, not from the far end');
  assert.ok(back.at(-1) < 0.02, 'and ends faded');

  // Keyframes: an entrance from nothing, with no frame of the whole panel before it starts.
  const opening = await play('enter', panel, () => panel.setAttribute('open', ''));
  const entered = await trace('enter', opening, opacityAt(panel), 0, 1);
  assert.ok(entered[0] < 0.03, `the first frame of the entrance is empty: ${entered[0]}`);

  // An exit with [closing]: it fades out, and holds faded until the element is let go.
  const closing = await play('leave', panel, () => {
    panel.setAttribute('closing', '');
    panel.removeAttribute('open');
  });
  await trace('leave', closing, opacityAt(panel), 1, 0);
  captured.length = 0;
  await delay(150);
  assert.equal(captured.length, 0, 'nothing is presented while it holds');
  const released = await play('release', panel, () => panel.removeAttribute('closing'));
  assert.ok(
    released.every((f) => opacityAt(panel)(f) < 0.02),
    'letting go of a held exit shows no frame of the panel',
  );

  // A transform: the box slides along its curve, measured where it is drawn.
  const [startX] = slide.bounds();
  const sliding = await play('slide', slide, () => slide.classList.add('moved'));
  const xs = await trace('slide', sliding, slideAt, startX, startX + 160, 0.02);
  assert.ok(Math.abs(xs.at(-1) - (startX + 160)) <= 1, `the slide ends at ${xs.at(-1)}`);

  // A spring: every frame where the spring's own equation puts it, past the target and back.
  const springAt = (t, velocity = 0) => {
    const w = Math.sqrt(170);
    const zeta = 10 / (2 * Math.sqrt(170));
    const wd = w * Math.sqrt(1 - zeta * zeta);
    const b = (zeta * w - velocity) / wd;
    return 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + b * Math.sin(wd * t));
  };
  const [home] = bounce.bounds();
  const bouncing = await play('spring', bounce, () => bounce.classList.add('moved'));
  const xs2 = bouncing.map(edgeOf(bounce));
  await filmstrip('spring', bouncing);
  const off = bouncing.map((f, i) =>
    Math.abs(xs2[i] - (home + 200 * springAt((f.time - bouncing[0].time) / 1000))),
  );
  assert.ok(
    Math.max(...off) <= 1.5,
    `spring: off its equation by ${Math.max(...off).toFixed(2)}px`,
  );
  assert.ok(Math.max(...xs2) > home + 210, `it overshoots: ${Math.max(...xs2)}`);
  assert.ok(Math.abs(xs2.at(-1) - (home + 200)) <= 1, `and lands: ${xs2.at(-1)}`);
  const springTime = bouncing.at(-1).time - bouncing[0].time;
  assert.ok(springTime > 300, `in its own time, not a duration: ${springTime.toFixed(0)}ms`);

  // Turned back on its way out, it carries on out for a moment before it comes back.
  captured.length = 0;
  bounce.classList.remove('moved');
  await waitFor(
    () => captured.some((f) => edgeOf(bounce)(f) < home + 150),
    'the spring heads home',
  );
  await waitFor(() => captured.length >= 1, 'a frame');
  const turnedAt = window.frames;
  const momentum = await play('momentum', bounce, () => bounce.classList.add('moved'));
  const path = momentum.map(edgeOf(bounce));
  report.push(`momentum: frames ${turnedAt + 1}.. edges ${path.slice(0, 8).join(' ')}`);
  await filmstrip('momentum', momentum);
  assert.ok(path[1] < path[0], `still moving home a frame after the turn: ${path.slice(0, 4)}`);
  assert.ok(
    Math.abs(path.at(-1) - (home + 200)) <= 1,
    `then it goes out and lands: ${path.at(-1)}`,
  );

  // A width, through layout: each frame's bar is as wide as the curve says at its time.
  const barWidth = (frame) => {
    const [x, y, , h] = bar.bounds();
    let width = 0;
    while (x + width < W && pixel(frame, x + width, y + h / 2)[0] > 200) {
      width++;
    }
    return width;
  };
  const filling = await play('width', bar, () => bar.classList.add('full'));
  const widths = await trace('width', filling, barWidth, 40, 240, 0.02);
  assert.ok(
    widths.slice(1).every((w, i) => w >= widths[i]),
    'it only grows',
  );
  assert.equal(bar.bounds()[2], 240, 'and is laid out at its full width');

  // A layout animation: pushed down, the box is drawn from where it was in every frame.
  const riderTop = (frame) => {
    for (let y = 150; y < H; y++) {
      const [r, g, b] = pixel(frame, 330, y);
      if (g > 200 && r < 60 && b < 60) {
        return y;
      }
    }
    return Number.NaN;
  };
  const pushed = await play('flip', rider, () => opener.classList.add('tall'));
  const tops = await trace('flip', pushed, riderTop, 170, 210);
  assert.equal(tops[0], 170, 'the first frame draws it where it was');
  assert.equal(rider.bounds()[1], 210, 'while its layout is already where it is going');

  // Still running out of view, it draws nothing.
  const quietFrom = window.frames;
  await delay(300);
  assert.ok(
    window.frames - quietFrom <= 1,
    `${window.frames - quietFrom} frames for motion out of view`,
  );

  stop();
  assert.deepEqual(errors, []);
} finally {
  await writeFile(new URL('report.txt', output), report.join('\n\n'));
  scope.dispose();
  window.dispose();
  await window.closed;
}
console.log(
  JSON.stringify({
    test: 'Native motion in a window',
    scale: 'device pixels read back per presented frame',
    output: output.pathname,
  }),
);
