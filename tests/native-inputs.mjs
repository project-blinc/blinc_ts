import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';
import { ThemeState, neutralTheme } from '../dist/theme/index.js';
import { addUserAgent } from '../dist/theme/user-agent.js';

const native = loadNative();
const W = 520;
const H = 360;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../.blinc/inputs/', import.meta.url);
await mkdir(output, { recursive: true });

async function capture(host, name) {
  host.compute(W, H);
  const renderer = new SceneRenderer(target.device, host.layout);
  try {
    renderer.useImages(host.images.library);
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
const near = (actual, expected, tolerance = 10) =>
  actual.every((c, i) => Math.abs(c - expected[i]) <= tolerance);
const rgb8 = (color) => color.slice(0, 3).map((c) => Math.round(c * 255));

const context = native.createReactive();
const host = Host.create(native);
try {
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  const state = new ThemeState(context, neutralTheme, { scheme: 'light' });
  state.attach(host.layout);
  addUserAgent(host.layout);
  const colours = neutralTheme.light.colors;
  const PRIMARY = rgb8(colours.primary);
  const el = (tag, attributes = {}, children = []) => {
    const e = host.createElement(tag);
    for (const [k, v] of Object.entries(attributes)) {
      e.setAttribute(k, v);
    }
    for (const c of children) {
      e.appendChild(typeof c === 'string' ? host.createTextNode(c) : c);
    }
    return e;
  };
  const place = (e, left, top) => {
    e.setAttribute(
      'style',
      `${e.getAttribute('style') ?? ''}; position: absolute; left: ${left}px; top: ${top}px`,
    );
    host.root.appendChild(e);
    return e;
  };
  const input = (attributes, left, top) => place(el('input', attributes), left, top);
  const centre = (e) => {
    const [x, y, w, h] = e.bounds();
    return [x + w / 2, y + h / 2];
  };
  const pressAt = (x, y) => {
    host.input.pointerMove(x, y);
    host.input.pointerDown();
    host.input.pointerUp();
    host.input.pointerMove(W - 1, H - 1);
  };
  const press = (e) => pressAt(...centre(e));
  const tap = (key) => {
    host.input.keyDown({ key });
    host.input.keyUp({ key });
  };
  let clock = 0;
  const settle = async () => {
    host.compute(W, H);
    await host.images.idle();
    host.compute(W, H);
    host.layout.tickMotion((clock += 1));
    host.layout.tickMotion((clock += 2000));
    host.compute(W, H);
  };
  const log = (e) => {
    const events = [];
    for (const type of ['input', 'change']) {
      e.addEventListener(type, () => events.push(type));
    }
    return events;
  };

  // A checkbox: a click checks and unchecks it, announcing input then change.
  const box = input({ type: 'checkbox' }, 20, 20);
  const boxEvents = log(box);
  await settle();
  assert.equal(box.checked, false);
  assert.equal(box.hasState('checked'), false);
  press(box);
  assert.equal(box.checked, true, 'a click checks it');
  assert.equal(box.hasState('checked'), true, 'which is :checked');
  assert.deepEqual(boxEvents, ['input', 'change']);
  await settle();
  let frame = await capture(host, 'checked');
  const [bx, by] = centre(box);
  const at = (x, y) => pixel(frame, x, y);
  assert.ok(
    near(at(box.bounds()[0] + 3, box.bounds()[1] + 3), PRIMARY, 14),
    `a checked box is filled: ${at(box.bounds()[0] + 3, box.bounds()[1] + 3)}`,
  );
  const mark = (() => {
    // The mark is drawn light over the fill: some pixels in the middle are not the fill.
    let light = 0;
    for (let y = by - 4; y <= by + 4; y++) {
      for (let x = bx - 4; x <= bx + 4; x++) {
        const [r, g, b] = at(x, y);
        if (r + g + b > 600) {
          light++;
        }
      }
    }
    return light;
  })();
  assert.ok(mark >= 6, `a check mark is drawn: ${mark} light pixels`);
  press(box);
  assert.equal(box.checked, false, 'and a second click unchecks it');
  assert.deepEqual(boxEvents, ['input', 'change', 'input', 'change']);
  await settle();
  frame = await capture(host);
  assert.ok(!near(at(box.bounds()[0] + 3, box.bounds()[1] + 3), PRIMARY, 30), 'unfilled again');

  // Cancelled or disabled, it does not change.
  const prevent = (event) => event.preventDefault();
  box.addEventListener('click', prevent);
  press(box);
  assert.equal(box.checked, false, 'a cancelled click does nothing');
  box.removeEventListener('click', prevent);
  box.setAttribute('disabled', '');
  press(box);
  assert.equal(box.checked, false, 'nor does a click on a disabled one');
  box.removeAttribute('disabled');

  // Indeterminate is its own state, cleared by a click.
  box.indeterminate = true;
  assert.equal(box.hasState('indeterminate'), true);
  assert.equal(box.indeterminate, true);
  press(box);
  assert.equal(box.indeterminate, false, 'a click clears it');
  assert.equal(box.checked, true, 'and checks it');
  press(box);
  boxEvents.length = 0;

  // Space checks a focused box and Enter does not; a script sets it without an event.
  box.focus();
  tap(' ');
  assert.equal(box.checked, true, 'Space checks');
  assert.deepEqual(boxEvents, ['input', 'change']);
  tap('Enter');
  assert.equal(box.checked, true, 'Enter does not');
  boxEvents.length = 0;
  box.checked = false;
  assert.equal(box.hasState('checked'), false);
  assert.deepEqual(boxEvents, [], 'a script announces nothing');

  // The checked attribute is where it starts, until the user or a script has set it.
  const started = input({ type: 'checkbox', checked: '' }, 60, 20);
  assert.equal(started.checked, true);
  assert.equal(started.hasState('checked'), true);
  press(started);
  assert.equal(started.checked, false);
  started.setAttribute('checked', '');
  assert.equal(started.checked, false, 'the attribute no longer counts once the user has set it');
  host.input.pointerMove(W - 1, H - 1);

  // A label's click checks its box once.
  const labelled = el('input', { type: 'checkbox', id: 'plain' });
  const label = place(el('label', { for: 'plain' }, ['Label text']), 20, 60);
  place(labelled, 140, 60);
  const labelEvents = log(labelled);
  press(label);
  assert.equal(labelled.checked, true, 'a label checks its control');
  assert.deepEqual(labelEvents, ['input', 'change'], 'once');

  // Radios of one name in one form are a set; checking one unchecks the others.
  const radio = (name, value, left, top, parent) => {
    const r = el('input', { type: 'radio', name, value });
    parent.appendChild(r);
    return r;
  };
  const formA = el('form', { style: 'flex-direction: row; gap: 8px; align-items: center' });
  place(formA, 20, 100);
  const [r1, r2, r3, r4] = [
    radio('size', 's', 0, 0, formA),
    radio('size', 'm', 0, 0, formA),
    radio('size', 'l', 0, 0, formA),
    radio('shape', 'round', 0, 0, formA),
  ];
  const events2 = log(r2);
  const events1 = log(r1);
  press(r1);
  assert.equal(r1.checked, true);
  assert.equal(r2.checked, false);
  press(r2);
  assert.deepEqual([r1.checked, r2.checked, r3.checked], [false, true, false], 'one of the set');
  assert.deepEqual(events2, ['input', 'change']);
  assert.deepEqual(events1, ['input', 'change'], 'r1 announced only its own check');
  events2.length = 0;
  press(r2);
  assert.deepEqual(events2, [], 'a checked radio stays and says nothing');
  press(r4);
  assert.equal(r2.checked, true, 'another name is another set');
  assert.equal(r4.checked, true);
  assert.equal(r2.hasState('checked'), true);
  assert.equal(r1.hasState('checked'), false);
  // Arrow keys move through the set, checking as they go, wrapping, skipping a disabled one.
  r2.focus();
  tap('ArrowRight');
  assert.equal(r3.checked, true, 'ArrowRight checks the next');
  assert.equal(host.input.focused, r3, 'and focuses it');
  tap('ArrowDown');
  assert.equal(r1.checked, true, 'wrapping round to the first');
  r2.setAttribute('disabled', '');
  tap('ArrowRight');
  assert.equal(r3.checked, true, 'a disabled one is skipped');
  tap('ArrowLeft');
  assert.equal(r1.checked, true, 'ArrowLeft goes back');
  r2.removeAttribute('disabled');
  assert.equal(r4.checked, true, 'the other set is untouched by all of it');
  // The same name in two forms is two sets.
  const formB = el('form', { style: 'flex-direction: row; gap: 8px' });
  place(formB, 20, 140);
  const other = radio('size', 'xl', 0, 0, formB);
  press(other);
  assert.equal(other.checked, true);
  assert.equal(r1.checked, true, 'a set belongs to its form');
  await settle();
  frame = await capture(host, 'radios');
  const [dx, dy] = centre(r1);
  assert.ok(near(at(dx, dy), PRIMARY, 14), `a checked radio shows its dot: ${at(dx, dy)}`);
  const [ex, ey] = centre(r2);
  assert.ok(!near(at(ex, ey), PRIMARY, 30), 'an unchecked one does not');

  // A range: a value between its bounds, a fill and a rest in proportion, a thumb between them.
  const slider = input({ type: 'range' }, 20, 200);
  const sliderEvents = log(slider);
  await settle();
  assert.equal(slider.valueAsNumber, 50, 'the middle by default');
  assert.equal(slider.value, '50');
  const track = () => {
    const part = (name) => host.behaviours.inputs.part(slider, name).bounds();
    return { fill: part('fill'), thumb: part('thumb'), rest: part('rest'), whole: slider.bounds() };
  };
  let t = track();
  assert.ok(Math.abs(t.fill[2] - t.rest[2]) < 2, `half and half: ${t.fill[2]} and ${t.rest[2]}`);
  assert.ok(t.thumb[0] >= t.fill[0] + t.fill[2] - 1, 'the thumb is after the fill');
  slider.setAttribute('value', '25');
  await settle();
  assert.equal(slider.valueAsNumber, 25);
  t = track();
  assert.ok(Math.abs(t.fill[2] / (t.fill[2] + t.rest[2]) - 0.25) < 0.02, 'a quarter filled');
  // A press sets the value from where it lands; a drag follows it; change comes on release.
  const [sx, sy, sw] = slider.bounds();
  const thumbWidth = t.thumb[2];
  const valueAtX = (x) => Math.round(((x - sx - thumbWidth / 2) / (sw - thumbWidth)) * 100);
  host.input.pointerMove(sx + sw * 0.8, sy + 10);
  host.input.pointerDown();
  assert.equal(slider.valueAsNumber, valueAtX(sx + sw * 0.8), 'a press sets the value');
  assert.deepEqual(sliderEvents, ['input'], 'announcing input');
  host.input.pointerMove(sx + sw * 0.3, sy + 10);
  assert.equal(slider.valueAsNumber, valueAtX(sx + sw * 0.3), 'a drag follows');
  host.input.pointerMove(sx + sw * 0.3, sy + 200);
  assert.equal(slider.valueAsNumber, valueAtX(sx + sw * 0.3), 'wherever it strays across');
  assert.equal(
    sliderEvents.filter((e) => e === 'change').length,
    0,
    'change waits for the release',
  );
  host.input.pointerUp();
  assert.equal(sliderEvents.filter((e) => e === 'change').length, 1, 'and comes once');
  host.input.pointerMove(sx + sw * 0.9, sy + 10);
  assert.equal(slider.valueAsNumber, valueAtX(sx + sw * 0.3), 'a released pointer is not dragging');
  host.input.pointerMove(W - 1, H - 1);
  slider.valueAsNumber = 40;
  host.input.pointerMove(sx + 2, sy + 10);
  host.input.pointerDown();
  host.input.pointerMove(-500, sy + 10);
  assert.equal(slider.valueAsNumber, 0, 'dragged past the start, the minimum');
  host.input.pointerMove(5000, sy + 10);
  assert.equal(slider.valueAsNumber, 100, 'past the end, the maximum');
  host.input.pointerUp();
  host.input.pointerMove(W - 1, H - 1);

  // Keys step it, a page is a tenth, Home and End are the ends; each is an input and a change.
  slider.valueAsNumber = 50;
  slider.focus();
  sliderEvents.length = 0;
  tap('ArrowRight');
  assert.equal(slider.valueAsNumber, 51);
  tap('ArrowDown');
  assert.equal(slider.valueAsNumber, 50);
  tap('PageUp');
  assert.equal(slider.valueAsNumber, 60);
  tap('PageDown');
  tap('PageDown');
  assert.equal(slider.valueAsNumber, 40);
  tap('End');
  assert.equal(slider.valueAsNumber, 100);
  tap('ArrowRight');
  assert.equal(slider.valueAsNumber, 100, 'no further than the maximum');
  tap('Home');
  assert.equal(slider.valueAsNumber, 0);
  assert.equal(sliderEvents.filter((e) => e === 'input').length, 7);
  assert.equal(sliderEvents.filter((e) => e === 'change').length, 7, 'each key a change');

  // Bounds and steps: a value is on the step counted from the minimum, never past the last.
  const stepped = input({ type: 'range', min: '10', max: '20', step: '5' }, 200, 200);
  assert.equal(stepped.valueAsNumber, 15, 'the middle');
  stepped.valueAsNumber = 12;
  assert.equal(stepped.valueAsNumber, 10, 'snapped to its step');
  stepped.valueAsNumber = 99;
  assert.equal(stepped.valueAsNumber, 20, 'and to its end');
  stepped.value = '17';
  assert.equal(stepped.value, '15');
  const odd = input({ type: 'range', min: '0', max: '10', step: '4' }, 200, 230);
  odd.valueAsNumber = 10;
  assert.equal(
    odd.valueAsNumber,
    8,
    'a step that does not divide the range stops at the last whole one',
  );

  // Disabled, it takes no press and no key.
  const off = input({ type: 'range', disabled: '', value: '30' }, 200, 260);
  const [ox, oy, ow] = off.bounds();
  pressAt(ox + ow * 0.9, oy + 10);
  assert.equal(off.valueAsNumber, 30);
  host.input.pointerMove(W - 1, H - 1);

  // Vertical, it runs from the bottom up.
  const upright = input({ type: 'range', 'data-orientation': 'vertical' }, 300, 200);
  await settle();
  const [ux, uy, uw, uh] = upright.bounds();
  pressAt(ux + uw / 2, uy + 2);
  assert.ok(upright.valueAsNumber > 90, `the top is the maximum: ${upright.valueAsNumber}`);
  pressAt(ux + uw / 2, uy + uh - 2);
  assert.ok(upright.valueAsNumber < 10, `the bottom is the minimum: ${upright.valueAsNumber}`);
  await settle();
  frame = await capture(host, 'ranges');
  assert.deepEqual(errors, [], String(errors));

  // A control that is not what it was loses its parts, and a destroyed one lets go of them.
  const turning = input({ type: 'checkbox' }, 380, 20);
  assert.ok(host.behaviours.inputs.part(turning, 'check'));
  turning.setAttribute('type', 'radio');
  assert.equal(host.behaviours.inputs.part(turning, 'check'), undefined);
  assert.ok(host.behaviours.inputs.part(turning, 'dot'));
  turning.setAttribute('type', 'text');
  assert.equal(host.behaviours.inputs.part(turning, 'dot'), undefined, 'a text input has none yet');
  turning.destroy();
  state.dispose();
} finally {
  host.dispose();
  context.dispose();
  target.dispose();
}
console.log('Native inputs: checkboxes, radio sets and ranges passed');
