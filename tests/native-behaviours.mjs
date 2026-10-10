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
const W = 500;
const H = 400;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../.blinc/behaviours/', import.meta.url);
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
const near = (actual, expected, tolerance = 8) =>
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
  const text = (data) => host.createTextNode(data);
  const el = (tag, children = [], attributes = {}, style = '') => {
    const e = host.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      e.setAttribute(name, value);
    }
    if (style) {
      e.setAttribute('style', style);
    }
    for (const c of children) {
      e.appendChild(typeof c === 'string' ? text(c) : c);
    }
    return e;
  };
  const place = (element, left, top) => {
    element.setAttribute(
      'style',
      `${element.getAttribute('style') ?? ''}; position: absolute; left: ${left}px; top: ${top}px`,
    );
    host.root.appendChild(element);
    return element;
  };
  const centre = (e) => {
    const [x, y, w, h] = e.bounds();
    return [x + w / 2, y + h / 2];
  };
  const press = (e) => {
    const [x, y] = centre(e);
    host.input.pointerMove(x, y);
    host.input.pointerDown();
    host.input.pointerUp();
    host.input.pointerMove(W - 1, H - 1);
  };
  let clock = 0;
  const settle = () => {
    host.compute(W, H);
    host.layout.tickMotion((clock += 1));
    host.layout.tickMotion((clock += 2000));
    host.compute(W, H);
  };

  // Links: a click opens the URL with the system's handler, unless someone took it.
  const opened = [];
  host.behaviours.opener = (url) => opened.push(url);
  const link = place(el('a', ['site'], { href: 'https://example.com/docs' }), 10, 10);
  const mail = place(el('a', ['mail'], { href: 'mailto:someone@example.com' }), 100, 10);
  const script = place(el('a', ['script'], { href: 'javascript:alert(1)' }), 180, 10);
  const relative = place(el('a', ['relative'], { href: 'docs/page.html' }), 280, 10);
  const bare = place(el('a', ['bare']), 380, 10);
  host.compute(W, H);
  press(link);
  assert.deepEqual(opened, ['https://example.com/docs'], 'a click opens it');
  press(mail);
  assert.equal(opened.at(-1), 'mailto:someone@example.com');
  press(script);
  press(relative);
  press(bare);
  assert.equal(
    opened.length,
    2,
    'a script, a path with no scheme and an anchor with no href open nothing',
  );
  assert.equal(host.input.isFocusable(bare), false, 'no href, no focus');
  assert.equal(host.input.isFocusable(link), true);
  const taken = (event) => event.preventDefault();
  link.addEventListener('click', taken);
  press(link);
  assert.equal(opened.length, 2, 'preventDefault keeps it from opening');
  link.removeEventListener('click', taken);
  link.focus();
  host.input.keyDown({ key: 'Enter' });
  assert.equal(opened.length, 3, 'Enter on a focused link opens it');
  host.input.keyUp({ key: 'Enter' });
  link.blur();

  // A link to an element of the page scrolls to it.
  const page = place(
    el('div', [], {}, 'width: 150px; height: 60px; overflow: auto; flex-direction: column'),
    10,
    60,
  );
  const jump = el('a', ['jump'], { href: '#target' });
  page.appendChild(jump);
  page.appendChild(el('div', [], {}, 'height: 200px; flex-shrink: 0'));
  const targetBox = el('div', ['here'], { id: 'target' }, 'height: 20px; flex-shrink: 0');
  page.appendChild(targetBox);
  page.appendChild(el('div', [], {}, 'height: 200px; flex-shrink: 0'));
  host.compute(W, H);
  assert.equal(page.scrollTop, 0);
  press(jump);
  assert.ok(page.scrollTop > 100, `scrolled toward it: ${page.scrollTop}`);
  assert.equal(opened.length, 3, 'and opened nothing');
  host.root.removeChild(page);

  // A label: a click on it focuses and clicks its control, once.
  const clicks = [];
  const control = el('button', ['go'], { id: 'go' });
  control.addEventListener('click', () => clicks.push('button'));
  const inside = el('label', ['Press ', control]);
  place(inside, 10, 100);
  const outside = place(el('button', ['elsewhere'], { id: 'elsewhere' }), 200, 100);
  outside.addEventListener('click', () => clicks.push('elsewhere'));
  const named = place(el('label', ['Named'], { for: 'elsewhere' }), 300, 100);
  const dead = place(el('label', ['Dead'], { for: 'nothing' }), 400, 100);
  host.compute(W, H);
  const label = (e) => {
    const [x, y, w, h] = e.bounds();
    host.input.pointerMove(x + 2, y + h / 2);
    host.input.pointerDown();
    host.input.pointerUp();
    host.input.pointerMove(W - 1, H - 1);
    return w;
  };
  label(inside);
  assert.deepEqual(clicks, ['button'], 'its control inside is clicked once');
  assert.equal(host.input.focused, control, 'and focused');
  clicks.length = 0;
  press(control);
  assert.deepEqual(clicks, ['button'], 'a click on the control itself is not doubled');
  clicks.length = 0;
  label(named);
  assert.deepEqual(clicks, ['elsewhere'], 'for names the control');
  assert.equal(host.input.focused, outside);
  clicks.length = 0;
  label(dead);
  assert.deepEqual(clicks, [], 'a label for nothing does nothing');
  control.setAttribute('disabled', '');
  label(inside);
  assert.deepEqual(clicks, [], 'nor does one whose control is disabled');
  for (const e of [inside, outside, named, dead]) {
    host.root.removeChild(e);
  }

  // Details: a summary opens and closes it, by pointer and key, with a toggle event.
  const body = el('p', ['the rest'], {}, 'margin: 0');
  const summary = el('summary', ['More']);
  const details = place(el('details', [summary, body], {}, 'width: 200px'), 10, 160);
  let toggles = 0;
  details.addEventListener('toggle', () => toggles++);
  host.compute(W, H);
  assert.equal(summary.childNodes.length, 1, 'the marker is not among its children');
  assert.equal(body.bounds()[3], 0, 'closed, the rest takes no room');
  let frame = await capture(host, 'details-closed');
  press(summary);
  settle();
  assert.equal(details.hasAttribute('open'), true, 'a click opens it');
  assert.equal(toggles, 1);
  assert.ok(body.bounds()[3] > 10, `and the rest shows: ${body.bounds()[3]}`);
  const open = await capture(host, 'details-open');
  assert.ok(!open.equals(frame), 'the frame differs');
  press(summary);
  settle();
  assert.equal(details.hasAttribute('open'), false, 'a second click closes it');
  assert.equal(toggles, 2);
  summary.focus();
  host.input.keyDown({ key: 'Enter' });
  host.input.keyUp({ key: 'Enter' });
  settle();
  assert.equal(details.hasAttribute('open'), true, 'Enter on a focused summary opens it');
  host.input.keyDown({ key: ' ' });
  host.input.keyUp({ key: ' ' });
  settle();
  assert.equal(details.hasAttribute('open'), false, 'and Space closes it');
  summary.blur();
  // The chevron is a part the host owns: a press on it is a press on the summary, and the pointer
  // over it is over the summary.
  const [sx, sy, , sh] = summary.bounds();
  let over = null;
  for (let dx = 1; dx < 60 && !over; dx += 2) {
    host.input.pointerMove(sx + dx, sy + sh / 2);
    const hit = host.input.hovered;
    if (hit && hit !== summary && hit.owner === summary) {
      over = hit;
    }
  }
  assert.ok(over, 'the pointer finds the chevron');
  assert.equal(host.input.stateOf(summary).hover, true, 'the summary is hovered over its chevron');
  host.input.pointerDown();
  host.input.pointerUp();
  settle();
  assert.equal(details.hasAttribute('open'), true, 'a press on the chevron opens it');
  host.input.pointerMove(W - 1, H - 1);
  assert.equal(host.input.stateOf(summary).hover, false);
  press(summary);
  settle();
  assert.equal(details.hasAttribute('open'), false, 'and a press on the summary closes it again');
  // Only the first summary is the toggle.
  const second = el('summary', ['Not this']);
  details.appendChild(second);
  host.compute(W, H);
  details.setAttribute('open', '');
  settle();
  const before = toggles;
  press(second);
  assert.equal(toggles, before, 'a second summary does not toggle it');
  host.root.removeChild(details);

  // Progress and meter: a bar that is as long as the value says, and meter's by where it is.
  const progress = place(el('progress', [], { value: '30', max: '120' }), 10, 220);
  settle();
  frame = await capture(host, 'progress');
  const [px, py, pw, ph] = progress.bounds();
  const filled = (x) => near(pixel(frame, px + x * pw, py + ph / 2), rgb8(colours.primary), 12);
  assert.ok(filled(0.1) && !filled(0.5), 'a quarter of the track is filled');
  progress.setAttribute('value', '90');
  settle();
  frame = await capture(host);
  assert.ok(filled(0.6) && !filled(0.9), 'it follows the value: three quarters');
  progress.setAttribute('value', '500');
  settle();
  frame = await capture(host);
  assert.ok(filled(0.95), 'a value over the maximum is full');
  progress.removeAttribute('value');
  settle();
  frame = await capture(host, 'indeterminate');
  const track = rgb8(colours.border);
  const trackAt = (x) => near(pixel(frame, px + x * pw, py + ph / 2), track, 6);
  assert.ok(!trackAt(0.12) && trackAt(0.6), 'with no value: a bar over the first 30% of the track');
  host.compute(W, H);
  assert.equal(
    host.layout.tickMotion((clock += 1)),
    true,
    'no value: a bar that pulses, which wants frames',
  );
  progress.setAttribute('value', '60');
  progress.setAttribute('max', '120');
  settle();
  assert.equal(host.layout.tickMotion((clock += 1)), false, 'a value stops it');
  // What a framework does to its children leaves the bar alone.
  progress.appendChild(text('fallback'));
  progress.removeChild(progress.firstChild);
  settle();
  frame = await capture(host);
  assert.ok(filled(0.25), 'the bar is still there');
  host.root.removeChild(progress);
  const meterColour = async (attributes) => {
    const m = place(el('meter', [], attributes), 10, 220);
    settle();
    const shot = await capture(host);
    const [mx, my, , mh] = m.bounds();
    const at = pixel(shot, mx + 4, my + mh / 2);
    host.root.removeChild(m);
    return at;
  };
  const range = { min: '0', max: '10', low: '3', high: '7', optimum: '9' };
  assert.ok(
    near(await meterColour({ ...range, value: '8' }), rgb8(colours.success), 12),
    'in the best region: success',
  );
  assert.ok(
    near(await meterColour({ ...range, value: '5' }), rgb8(colours.warning), 12),
    'next to it: warning',
  );
  assert.ok(
    near(await meterColour({ ...range, value: '1' }), rgb8(colours.error), 12),
    'furthest: error',
  );
  assert.ok(
    near(await meterColour({ ...range, optimum: '1', value: '2' }), rgb8(colours.success), 12),
    'an optimum at the low end makes low values the good ones',
  );

  // A control made disabled before it is ever styled is `:disabled` from its first style.
  const born = place(el('button', ['born disabled'], { disabled: '' }), 150, 300);
  const alive = place(el('button', ['enabled']), 300, 300);
  settle();
  frame = await capture(host, 'born-disabled');
  const face = (button) => {
    const [bx, by, , bh] = button.bounds();
    return pixel(frame, bx + 3, by + bh / 2);
  };
  assert.ok(!near(face(born), face(alive), 10), 'it is dimmed with no change to start from');
  host.root.removeChild(born);
  host.root.removeChild(alive);

  // A disabled fieldset disables the controls in it: no press, no focus, and `:disabled` matches.
  const clicked = [];
  const inField = el('button', ['inside']);
  inField.addEventListener('click', () => clicked.push('in'));
  const fieldset = place(
    el('fieldset', [el('legend', ['Group']), inField], { disabled: '' }),
    10,
    260,
  );
  const free = place(el('button', ['outside']), 300, 260);
  free.addEventListener('click', () => clicked.push('out'));
  settle();
  frame = await capture(host, 'fieldset-disabled');
  const wash = (button) => {
    const [bx, by, , bh] = button.bounds();
    return pixel(frame, bx + 3, by + bh / 2);
  };
  assert.ok(
    !near(wash(inField), wash(free), 10),
    'a control in it is dimmed, as a disabled one is',
  );
  press(inField);
  assert.deepEqual(clicked, [], 'a press on it does nothing');
  assert.equal(host.input.isFocusable(inField), false, 'it cannot take focus');
  press(free);
  assert.deepEqual(clicked, ['out'], 'one outside is untouched');
  fieldset.removeAttribute('disabled');
  settle();
  frame = await capture(host);
  assert.ok(near(wash(inField), wash(free), 10), 'enabled again, it looks it');
  press(inField);
  assert.deepEqual(clicked, ['out', 'in']);
  fieldset.setAttribute('disabled', '');
  const late = el('button', ['late']);
  fieldset.appendChild(late);
  settle();
  frame = await capture(host);
  assert.ok(!near(wash(late), wash(free), 10), 'a control added to it is disabled too');

  assert.deepEqual(errors, []);
  state.dispose();
} finally {
  host.dispose();
  context.dispose();
  target.dispose();
}
console.log(
  'Native behaviours: links, labels, details, progress, meter and disabled fieldsets passed',
);
