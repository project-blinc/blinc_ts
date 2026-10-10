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
import { TopLayer } from '../dist/native/top-layer.js';

const native = loadNative();
const W = 500;
const H = 360;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../.blinc/selects/', import.meta.url);
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

const context = native.createReactive();
const host = Host.create(native);
try {
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  const state = new ThemeState(context, neutralTheme, { scheme: 'light' });
  state.attach(host.layout);
  addUserAgent(host.layout);
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
  const option = (value, label, attributes = {}) => el('option', { value, ...attributes }, [label]);
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
  const tap = (key) => {
    host.input.keyDown({ key });
    host.input.keyUp({ key });
  };
  let clock = 0;
  const settle = () => {
    host.compute(W, H);
    host.flush();
    host.layout.tickMotion((clock += 1));
    host.layout.tickMotion((clock += 2000));
    host.compute(W, H);
  };
  const stack = TopLayer.of(host);
  const selects = host.behaviours.selects;
  const log = (e) => {
    const events = [];
    for (const type of ['input', 'change']) {
      e.addEventListener(type, () => events.push(type));
    }
    return events;
  };
  /** The rows of the open list, with their text. */
  const rows = () => {
    const list = stack.entries.at(-1)?.content;
    const out = [];
    for (let n = list?.firstChild; n; n = n.nextSibling) {
      if (n.tag === 'option') {
        out.push({ row: n, text: n.firstChild.data });
      }
    }
    return out;
  };
  const focusedText = () => rows().find((r) => r.row === host.input.focused)?.text;

  const apple = option('a', 'Apple');
  const banana = option('b', 'Banana', { selected: '' });
  const lemon = option('l', 'Lemon');
  const lime = option('li', 'Lime', { disabled: '' });
  const cherry = option('c', 'Cherry');
  const choose = el('select', { name: 'fruit' }, [
    apple,
    banana,
    el('optgroup', { label: 'Citrus' }, [lemon, lime]),
    cherry,
  ]);
  const empty = el('select', {}, [option('x', 'First'), option('y', 'Second')]);
  const off = el('select', { disabled: '' }, [option('x', 'X')]);
  const page = el('div', { style: 'position: absolute; left: 20px; top: 20px; gap: 12px' }, [
    choose,
    empty,
    off,
  ]);
  host.root.appendChild(page);
  host.root.setAttribute('style', 'background: #ffffff');
  settle();

  // What it shows: the option `selected` names, else the first.
  assert.equal(choose.value, 'b');
  assert.equal(choose.selectedIndex, 1);
  assert.equal(selects.label(choose), 'Banana');
  assert.equal(empty.value, 'x', 'the first, with none chosen');
  assert.deepEqual(
    choose.options.map((o) => o.getAttribute('value')),
    ['a', 'b', 'l', 'li', 'c'],
  );
  const quiet = await capture(host);

  // A click opens the list under it, the chosen row focused.
  const events = log(choose);
  press(choose);
  settle();
  assert.equal(stack.entries.length, 1, 'the list is open');
  assert.equal(choose.hasAttribute('open'), true);
  assert.deepEqual(
    rows().map((r) => r.text),
    ['Apple', 'Banana', 'Lemon', 'Lime', 'Cherry'],
  );
  assert.equal(focusedText(), 'Banana', 'focus on the chosen option');
  assert.equal(rows()[1].row.hasState('checked'), true, 'which is :checked');
  assert.equal(rows()[0].row.hasState('checked'), false);
  assert.equal(rows()[3].row.hasAttribute('disabled'), true);
  const [lx, ly] = stack.entries[0].content.bounds();
  const [sx, sy, , sh] = choose.bounds();
  assert.ok(
    Math.abs(lx - sx) < 2 && ly >= sy + sh,
    `under the select: ${lx},${ly} for ${sx},${sy + sh}`,
  );
  const shown = await capture(host, 'open');
  assert.ok(!shown.equals(quiet), 'the frame shows it');

  // The arrows move among the enabled rows, Home and End to the ends.
  tap('ArrowDown');
  assert.equal(focusedText(), 'Lemon');
  tap('ArrowDown');
  assert.equal(focusedText(), 'Cherry', 'a disabled row is passed over');
  tap('ArrowDown');
  assert.equal(focusedText(), 'Cherry', 'and the end is the end');
  tap('Home');
  assert.equal(focusedText(), 'Apple');
  tap('End');
  assert.equal(focusedText(), 'Cherry');
  tap('ArrowUp');
  assert.equal(focusedText(), 'Lemon');
  // Typing finds a row by its label.
  host.input.text('c');
  assert.equal(focusedText(), 'Cherry', 'c finds Cherry');
  host.input.text('x');
  assert.equal(focusedText(), 'Cherry', 'no match, no move');
  // Enter chooses it: a change, announced once, and the list is shut.
  tap('Home');
  tap('Enter');
  assert.equal(choose.value, 'a');
  assert.deepEqual(events, ['input', 'change']);
  assert.equal(choose.hasAttribute('open'), false);
  assert.equal(stack.entries.length, 0);
  assert.equal(host.input.focused, choose, 'focus goes back to the select');
  settle();
  assert.equal(selects.label(choose), 'Apple', 'it shows what was chosen');

  // Choosing what is already chosen says nothing; Escape and a press outside choose nothing.
  events.length = 0;
  press(choose);
  settle();
  tap('Enter');
  assert.deepEqual(events, [], 'the same option is no change');
  press(choose);
  settle();
  tap('ArrowDown');
  tap('Escape');
  assert.equal(choose.value, 'a', 'Escape chooses nothing');
  assert.equal(stack.entries.length, 0);
  press(choose);
  settle();
  host.input.pointerMove(W - 5, H - 5);
  host.input.pointerDown();
  host.input.pointerUp();
  assert.equal(stack.entries.length, 0, 'a press outside shuts it');
  assert.equal(choose.value, 'a');
  // A click on a row chooses it, unless it is disabled.
  press(choose);
  settle();
  press(rows()[3].row);
  assert.equal(stack.entries.length, 1, 'a disabled row cannot be chosen');
  assert.equal(choose.value, 'a');
  press(rows()[4].row);
  assert.equal(choose.value, 'c', 'a click on a row chooses it');
  assert.deepEqual(events, ['input', 'change']);
  settle();
  // The arrows open it from the select itself, and a click on the open select shuts it.
  choose.focus();
  tap('ArrowDown');
  assert.equal(stack.entries.length, 1, 'ArrowDown opens it');
  tap('Tab');
  assert.equal(stack.entries.length, 0, 'Tab shuts it');
  settle();
  press(choose);
  press(choose);
  assert.equal(stack.entries.length, 0, 'a second click shuts it');
  // Typing on a closed select chooses by label, as a change.
  events.length = 0;
  choose.focus();
  host.input.text('l');
  assert.equal(choose.value, 'l', 'typing chooses');
  assert.deepEqual(events, ['input', 'change']);
  assert.equal(stack.entries.length, 0, 'without opening it');
  await new Promise((r) => setTimeout(r, 1100));
  host.input.text('c');
  assert.equal(choose.value, 'c', 'after a pause, a new search');

  // Space and Enter on the focused select open it too.
  choose.focus();
  tap(' ');
  assert.equal(stack.entries.length, 1, 'Space opens it');
  tap('Escape');
  settle();

  // A disabled select does not open; a script sets the value without an event.
  press(off);
  assert.equal(stack.entries.length, 0);
  events.length = 0;
  choose.value = 'b';
  assert.equal(choose.value, 'b');
  assert.equal(choose.selectedIndex, 1);
  assert.deepEqual(events, [], 'a script announces nothing');
  settle();
  assert.equal(selects.label(choose), 'Banana');
  choose.value = 'nope';
  assert.equal(choose.value, '');
  assert.equal(choose.selectedIndex, -1);
  choose.selectedIndex = 4;
  assert.equal(choose.value, 'c');

  // Options come and go while it is closed or open.
  const plum = option('p', 'Plum');
  choose.appendChild(plum);
  assert.equal(choose.options.length, 6);
  choose.value = 'p';
  settle();
  assert.equal(selects.label(choose), 'Plum');
  plum.firstChild.data = 'Greengage';
  settle();
  assert.equal(selects.label(choose), 'Greengage', 'a changed label shows');
  choose.removeChild(plum);
  settle();
  assert.equal(choose.value, 'a', 'with the chosen option gone, the first');

  // What a form holds, and reset.
  const form = el('form', { style: 'position: absolute; left: 300px; top: 20px' }, [
    el('select', { name: 'size' }, [
      option('s', 'S'),
      option('m', 'M', { selected: '' }),
      option('l', 'L'),
    ]),
  ]);
  host.root.appendChild(form);
  settle();
  const sizeSelect = form.elements[0];
  assert.deepEqual([...form.formData().entries()], [['size', 'm']]);
  sizeSelect.value = 'l';
  assert.deepEqual([...form.formData().entries()], [['size', 'l']]);
  form.reset();
  assert.equal(sizeSelect.value, 'm', 'reset puts back the selected one');
  assert.deepEqual(errors, [], String(errors));
  state.dispose();
} finally {
  host.dispose();
  context.dispose();
  target.dispose();
}
console.log('Native selects: label, list, keys, typing, choosing, forms and options passed');
