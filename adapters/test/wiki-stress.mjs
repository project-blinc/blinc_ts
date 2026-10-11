// Hundreds of presses, in a seeded random order, on the toggles page, with frames as a window makes
// them: after each, every control shows what a model of the page says it should, and neither the
// time a press takes nor the memory the process holds creeps up as they go on.
import assert from 'node:assert/strict';
import { loadNative } from 'blinc_ts/native';
import { Host } from 'blinc_ts/native/host';
import { OffscreenRenderer } from 'blinc_ts/native/offscreen';
import { probeShader } from 'blinc_ts/shaders';
import { ThemeState } from 'blinc_ts/theme';
import { addUserAgent } from 'blinc_ts/theme/user-agent';
import { addUtilities } from 'blinc_ts/theme/utilities';
import { jsx, mount } from '../dist/jsx/jsx-runtime.js';
import { baseUiTheme } from '../dist/base-ui/theme.js';
import { addBaseUi } from '../dist/base-ui/sheet.js';
import { addWikiSheet } from '../dist/wiki/sheet.js';
import { Wiki } from '../dist/wiki/wiki.js';
import { buttonNamed, findAll, windowed } from './wiki-driver.mjs';

const STEPS = Number(process.env.STEPS ?? 300);
const SEED = Number(process.env.SEED ?? 20261011);
const W = 1100;
const H = 760;

/** A small, seeded generator, so a failing order can be run again. */
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const native = loadNative();
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const context = native.createReactive();
const host = Host.create(native);
const errors = [];
host.onStyleErrors((e) => errors.push(...e));
const theme = new ThemeState(context, baseUiTheme, { scheme: 'light' });
theme.attach(host.layout);
addUserAgent(host.layout);
addBaseUi(host.layout);
addWikiSheet(host.layout);
addUtilities(host.layout);
const page = context.signal('toggles');
const unmount = mount(host, jsx(Wiki, { theme, page }), { context });
const { frame, settle, pixels } = windowed(host, target, W, H);
try {
  await frame();
  await settle();
  const switches = findAll(host.root, 'bui-switch');
  const checkbox = findAll(host.root, 'bui-checkbox')[0];
  const toggle = buttonNamed(host.root, 'Bold');
  const flip = buttonNamed(host.root, 'Flip the first switch from outside');
  const readouts = () => findAll(host.root, 'wiki-readout').map((e) => e.textContent);
  const notes = () =>
    findAll(host.root, 'wiki-row')
      .map((row) => row.textContent)
      .find((t) => t.startsWith('Notifications are'));
  // What each control holds, as the page starts.
  const model = { notifications: true, icon: false, checked: true, bold: false };
  const controls = [
    ['the first switch', switches[0], () => (model.notifications = !model.notifications)],
    ['the icon switch', switches[1], () => (model.icon = !model.icon)],
    ['the checkbox', checkbox, () => (model.checked = !model.checked)],
    ['the toggle', toggle, () => (model.bold = !model.bold)],
    ['the outside button', flip, () => (model.notifications = !model.notifications)],
  ];
  const next = random(SEED);
  const press = async (element) => {
    const [x, y, w, h] = element.viewBounds();
    host.input.pointerMove(x + w * (0.3 + next() * 0.4), y + h * (0.3 + next() * 0.4));
    await frame();
    host.input.pointerDown();
    await frame();
    host.input.pointerUp();
    // Sometimes the next press comes before this one's motion has played.
    const frames = Math.floor(next() * 6);
    for (let i = 0; i < frames; i++) {
      await frame();
    }
  };
  const check = (step, name) => {
    const at = `step ${step} (seed ${SEED}), after ${name}`;
    assert.equal(
      switches[0].hasAttribute('data-checked'),
      model.notifications,
      `${at}: first switch`,
    );
    assert.equal(
      notes(),
      `Notifications are ${model.notifications ? 'on' : 'off'}`,
      `${at}: its readout`,
    );
    assert.equal(switches[1].hasAttribute('data-checked'), model.icon, `${at}: icon switch`);
    assert.equal(checkbox.hasAttribute('data-checked'), model.checked, `${at}: checkbox`);
    assert.equal(toggle.hasAttribute('data-pressed'), model.bold, `${at}: toggle`);
    assert.ok(readouts().includes(`pressed = ${model.bold}`), `${at}: toggle's readout`);
  };
  // Where the first switch's knob is drawn: the middle of its light pixels, as a share of the track.
  const knob = () => {
    const [x, y, w, h] = switches[0].viewBounds();
    let sum = 0;
    let n = 0;
    for (let py = Math.round(y) + 3; py < y + h - 3; py++) {
      for (let px = Math.round(x) + 2; px < x + w - 2; px++) {
        const i = (py * W + px) * 4;
        if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 700) {
          sum += px - x;
          n++;
        }
      }
    }
    return n ? sum / n / w : -1;
  };
  const times = [];
  globalThis.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  for (let step = 0; step < STEPS; step++) {
    const [name, element, change] = controls[Math.floor(next() * controls.length)];
    const started = performance.now();
    await press(element);
    change();
    times.push(performance.now() - started);
    check(step, name);
    // Now and then, once motion has played, the knob is drawn at the end its state says.
    if (step % 25 === 24) {
      await settle();
      const at = knob();
      assert.ok(
        model.notifications ? at > 0.55 : at > 0 && at < 0.45,
        `step ${step} (seed ${SEED}): the knob is drawn ${model.notifications ? 'right' : 'left'}: ${at}`,
      );
    }
  }
  // Every motion plays out, and the last state is the one drawn.
  const left = await settle();
  assert.ok(left < 400, 'the page comes to rest');
  check(STEPS, 'settling');
  // A press at the end takes no longer than one at the start.
  const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
  const early = median(times.slice(10, 60));
  const late = median(times.slice(-50));
  assert.ok(
    late < early * 2 + 2,
    `presses did not slow: ${early.toFixed(2)} ms then ${late.toFixed(2)} ms`,
  );
  globalThis.gc?.();
  const grown = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;
  assert.ok(grown < 32, `the heap held steady: ${grown.toFixed(1)} MB more`);
  assert.deepEqual(errors, []);
  console.log(
    `Wiki stress: ${STEPS} presses in order ${SEED} matched the model; a press ${early.toFixed(1)} ms then ${late.toFixed(1)} ms; heap ${grown.toFixed(1)} MB`,
  );
} finally {
  unmount();
  theme.dispose();
  host.dispose();
  context.dispose();
  target.dispose();
}
