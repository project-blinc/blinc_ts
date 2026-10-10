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
const H = 780;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../.blinc/text-fields/', import.meta.url);
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
    await writeFile(
      new URL(`${name}.png`, output),
      PNG.sync.write({ width: W, height: H, data: Buffer.from(pixels) }),
    );
  } finally {
    renderer.dispose();
  }
}

const mac = process.platform === 'darwin';
/** The shortcut modifier: Command on a Mac, Control elsewhere. */
const shortcut = mac ? { meta: true } : { control: true };
const mods = (m = {}) => ({ shift: false, control: false, alt: false, meta: false, ...m });

const context = native.createReactive();
const host = Host.create(native);
try {
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  const state = new ThemeState(context, neutralTheme, { scheme: 'light' });
  state.attach(host.layout);
  addUserAgent(host.layout);
  const fields = host.behaviours.textFields;
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
  // The controls are stacked as they would be on a page, not pinned at offsets that may not fit.
  const stack = el('div', {
    style: 'position: absolute; left: 10px; top: 10px; gap: 14px; align-items: flex-start',
  });
  host.root.appendChild(stack);
  const place = (e) => {
    stack.appendChild(e);
    return e;
  };
  let clock = 0;
  const settle = () => {
    host.flush();
    host.compute(W, H);
    host.compute(W, H);
    // Transitions are timed by the ticks, so a frame has their end only after them.
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
  const tap = (name, m = {}) => {
    host.input.keyDown({ key: name, modifiers: mods(m) });
    host.input.keyUp({ key: name, modifiers: mods(m) });
  };
  const typeText = (text) => host.input.text(text);
  const press = (x, y, extra = {}) => {
    host.input.pointerMove(x, y);
    host.input.pointerDown();
    host.input.pointerUp();
    void extra;
  };
  const textBox = (e) => fields.part(e, 'text').bounds();
  const caretBox = (e) => fields.part(e, 'caret').bounds();

  // A text input: a press focuses it, typing fills it, and each edit is an input event.
  const name = place(el('input', { type: 'text', placeholder: 'Your name' }));
  const nameEvents = log(name);
  settle();
  assert.equal(name.value, '');
  assert.equal(name.hasState('placeholder-shown'), true, 'an empty field shows its placeholder');
  assert.ok(fields.part(name, 'placeholder').bounds()[2] > 20, 'the placeholder is drawn');
  const [nx, ny, nw, nh] = name.bounds();
  press(nx + nw / 2, ny + nh / 2);
  assert.equal(host.input.focused, name, 'a press focuses it');
  typeText('hello');
  assert.equal(name.value, 'hello');
  assert.deepEqual(nameEvents, ['input'], 'typing is an input event');
  settle();
  assert.equal(name.hasState('placeholder-shown'), false);
  assert.equal(fields.part(name, 'placeholder').bounds()[2], 0, 'and the placeholder is gone');
  const textEdge = () => textBox(name)[0] + textBox(name)[2];
  assert.ok(
    Math.abs(caretBox(name)[0] - textEdge()) < 2.5,
    `the caret is at the end of the text: ${caretBox(name)[0]} for ${textEdge()}`,
  );
  assert.equal(fields.part(name, 'caret').getAttribute('class') ?? 'caret', 'caret');
  await capture(host, 'typed');

  // The caret moves with the arrows, and typing goes in at it.
  tap('ArrowLeft');
  tap('ArrowLeft');
  typeText('XY');
  assert.equal(name.value, 'helXYlo');
  settle();
  assert.ok(caretBox(name)[0] < textEdge() - 5, 'the caret is inside the text now');
  tap('Home');
  assert.equal(name.selectionStart, 0);
  tap('End', { shift: true });
  assert.equal(name.selectionStart, 0);
  assert.equal(name.selectionEnd, 7, 'Shift+End selects to the end');
  settle();
  assert.equal(fields.selections(name).length, 1, 'a selection is drawn');
  const sel = fields.selections(name)[0].bounds();
  assert.ok(sel[2] > 20 && Math.abs(sel[0] + sel[2] - textEdge()) < 2.5, 'over the selected text');
  tap('Backspace');
  assert.equal(name.value, '');
  settle();
  assert.equal(fields.selections(name).length, 0);
  assert.equal(name.hasState('placeholder-shown'), true);

  // Select all, copy, cut and paste go through the clipboard.
  typeText('one two three');
  tap('a', shortcut);
  assert.equal(name.selectionStart, 0);
  assert.equal(name.selectionEnd, 13);
  tap('c', shortcut);
  assert.equal(host.clipboard.text(), 'one two three');
  tap('x', shortcut);
  assert.equal(name.value, '', 'a cut removes it');
  assert.equal(host.clipboard.text(), 'one two three');
  tap('v', shortcut);
  assert.equal(name.value, 'one two three', 'a paste puts it back');
  host.clipboard.setText('a\nb');
  tap('a', shortcut);
  tap('v', shortcut);
  assert.equal(name.value, 'a b', 'a line break pasted into a single line is a space');

  // The pointer places the caret, selects by drag, by word on a double click, and all on a triple.
  name.value = 'alpha beta gamma';
  settle();
  const [tx, ty, tw, th] = textBox(name);
  press(tx + 2, ty + th / 2);
  assert.equal(name.selectionStart, 0, 'a press at the start of the text');
  assert.equal(name.selectionEnd, 0);
  press(tx + tw + 20, ty + th / 2);
  assert.equal(name.selectionEnd, 16, 'past the end is the end');
  host.input.pointerMove(tx + 2, ty + th / 2);
  host.input.pointerDown();
  host.input.pointerMove(tx + tw / 2, ty + th / 2);
  host.input.pointerUp();
  assert.equal(name.selectionStart, 0);
  assert.ok(
    name.selectionEnd > 3 && name.selectionEnd < 13,
    `a drag selects: ${name.selectionEnd}`,
  );
  host.input.pointerMove(tx + tw / 2, ty + th / 2);
  host.input.pointerDown();
  host.input.pointerUp();
  host.input.pointerDown();
  host.input.pointerUp();
  assert.equal(
    name.value.slice(name.selectionStart, name.selectionEnd),
    'beta',
    'a double click selects a word',
  );
  host.input.pointerDown();
  host.input.pointerUp();
  assert.equal(
    name.value.slice(name.selectionStart, name.selectionEnd),
    'alpha beta gamma',
    'a triple click, the paragraph',
  );
  host.input.pointerMove(W - 1, H - 1);

  // A long value scrolls to keep the caret in view.
  name.value =
    'x'.repeat(5) + ' a very long value that does not fit in a field of this width at all ' + 'end';
  settle();
  settle();
  const clip = fields.part(name, 'clip').bounds();
  assert.ok(
    caretBox(name)[0] <= clip[0] + clip[2] + 1,
    `the caret is within the clip: ${caretBox(name)[0]} in ${clip}`,
  );
  assert.ok(textBox(name)[0] < clip[0], 'the text is scrolled left');
  tap('Home');
  settle();
  settle();
  assert.ok(textBox(name)[0] >= clip[0] - 1, 'back at the start the text is not scrolled');
  name.value = '';
  host.input.pointerMove(W - 1, H - 1);

  // An input method composes in place, underlined, and commits as text.
  name.focus();
  settle();
  typeText('ab');
  tap('ArrowLeft');
  host.input.composition('に', -1);
  settle();
  assert.equal(fields.shown(name), 'aにb', 'the composition shows at the caret');
  assert.equal(name.value, 'ab', 'but is not the value yet');
  assert.ok(fields.part(name, 'composition').bounds()[2] > 3, 'underlined');
  host.input.text('日本');
  assert.equal(name.value, 'a日本b', 'the commit is the value');
  settle();
  assert.equal(fields.part(name, 'composition').bounds()[2], 0, 'and the underline is gone');
  name.value = '';

  // A password shows dots and gives nothing away.
  const secret = place(el('input', { type: 'password' }));
  secret.focus();
  typeText('hunter2');
  assert.equal(secret.value, 'hunter2');
  settle();
  assert.equal(fields.shown(secret), '•'.repeat(7));
  tap('a', shortcut);
  tap('c', shortcut);
  assert.notEqual(host.clipboard.text(), 'hunter2', 'a password is not copied');
  // maxlength cuts what is typed or pasted; readonly can be selected and copied but not changed.
  const short = place(el('input', { maxlength: '5' }));
  short.focus();
  typeText('abcdefgh');
  assert.equal(short.value, 'abcde');
  const fixed = place(el('input', { readonly: '', value: 'fixed' }));
  const fixedEvents = log(fixed);
  fixed.focus();
  typeText('x');
  tap('Backspace');
  assert.equal(fixed.value, 'fixed');
  assert.deepEqual(fixedEvents, []);
  tap('a', shortcut);
  tap('c', shortcut);
  assert.equal(host.clipboard.text(), 'fixed', 'a read-only value can be copied');
  const off = place(el('input', { disabled: '', value: 'off' }));
  off.focus();
  press(...[off.bounds()[0] + 20, off.bounds()[1] + 10]);
  typeText('z');
  assert.equal(off.value, 'off', 'a disabled field takes nothing');
  assert.notEqual(host.input.focused, off);

  // The value attribute is where it starts; a script's value needs no event; reset puts it back.
  const start = place(el('input', { value: 'begin' }));
  assert.equal(start.value, 'begin');
  start.focus();
  typeText('!');
  assert.equal(start.value, 'begin!', 'the user has set it');
  start.setAttribute('value', 'other');
  assert.equal(start.value, 'begin!', 'so the attribute no longer counts');
  const startEvents = log(start);
  start.value = 'set';
  assert.equal(start.value, 'set');
  assert.deepEqual(startEvents, [], 'a script announces nothing');
  assert.equal(start.selectionStart, 3, 'with the caret at the end');
  start.select();
  assert.equal(start.selectionEnd, 3);
  start.setSelectionRange(1, 2);
  assert.equal([start.selectionStart, start.selectionEnd].join(), '1,2');

  // change comes when focus leaves after an edit, once; Enter settles a field and submits its form.
  const named = el('input', { name: 'q', value: 'a' });
  const send = el('button', {}, ['Go']);
  const form = place(el('form', {}, [named, send]));
  const namedEvents = log(named);
  const submissions = [];
  form.addEventListener('submit', (event) => {
    submissions.push(event.submitter);
    event.preventDefault();
  });
  named.focus();
  typeText('b');
  assert.deepEqual(namedEvents, ['input']);
  start.focus();
  assert.deepEqual(namedEvents, ['input', 'change'], 'leaving it announces the change');
  named.focus();
  start.focus();
  assert.deepEqual(namedEvents, ['input', 'change'], 'but not when nothing changed');
  named.focus();
  typeText('c');
  tap('Enter');
  assert.deepEqual(namedEvents, ['input', 'change', 'input', 'change'], 'Enter settles it');
  assert.deepEqual(submissions, [send], 'and submits the form by its default button');
  assert.equal(
    [...form.formData().entries()].map((e) => e.join('=')).join(),
    'q=abc',
    'a field is in the form data',
  );
  form.reset();
  assert.equal(named.value, 'a', 'reset puts back the attribute');

  // A search field empties on Escape.
  const search = place(el('input', { type: 'search', value: 'query' }));
  const searchEvents = log(search);
  search.focus();
  tap('Escape');
  assert.equal(search.value, '');
  assert.deepEqual(searchEvents, ['input']);

  // A text area: Enter is a new line, the arrows move between lines, long text scrolls.
  const area = place(el('textarea', { placeholder: 'Notes' }, ['first\nsecond']));
  area.setAttribute('style', 'height: 96px; width: 200px');
  settle();
  settle();
  assert.equal(area.value, 'first\nsecond', 'its text is its value');
  const areaEvents = log(area);
  area.focus();
  tap('End', { control: !mac, meta: mac });
  tap('Enter');
  typeText('third');
  assert.equal(area.value, 'first\nsecond\nthird');
  assert.deepEqual(areaEvents, ['input', 'input']);
  settle();
  settle();
  const lineHeight = textBox(area)[3] / 3;
  assert.ok(
    Math.abs(caretBox(area)[1] - (textBox(area)[1] + 2 * lineHeight)) < 3,
    'the caret is on the third line',
  );
  tap('ArrowUp');
  tap('ArrowUp');
  settle();
  assert.ok(Math.abs(caretBox(area)[1] - textBox(area)[1]) < 3, 'two lines up, the first');
  for (let i = 0; i < 8; i++) {
    tap('End', { control: !mac, meta: mac });
    tap('Enter');
    typeText(`line ${i}`);
  }
  settle();
  settle();
  const clipArea = fields.part(area, 'clip');
  assert.ok(clipArea.scrollTop > 20, `the text scrolls to the caret: ${clipArea.scrollTop}`);
  const visible = clipArea.bounds();
  // Bounds are layout's, not scrolled: what shows is where they are less the scroll.
  const shownTop = caretBox(area)[1] - clipArea.scrollTop;
  assert.ok(
    shownTop >= visible[1] - 1 && shownTop + caretBox(area)[3] <= visible[1] + visible[3] + 1,
    `and the caret is in view: ${shownTop} in ${visible}`,
  );
  // A press in the scrolled text lands on the line under it, not the one at the top of the text.
  press(visible[0] + 30, visible[1] + 6);
  const pressedLine = area.value.slice(0, area.selectionStart).split('\n').length;
  assert.ok(pressedLine >= 6, `a press at the top of what shows is a late line: ${pressedLine}`);
  // It wraps at its width.
  area.value = 'word '.repeat(30);
  settle();
  settle();
  assert.ok(textBox(area)[3] > 3 * lineHeight, `a long line wraps: ${textBox(area)[3]} high`);
  assert.ok(textBox(area)[2] <= visible[2] + 1, 'within the width');

  // A number takes digits, steps by its arrows and steppers within its bounds.
  const count = place(el('input', { type: 'number', min: '0', max: '10', step: '2', value: '4' }));
  const countEvents = log(count);
  count.focus();
  typeText('a1b');
  assert.equal(count.value, '41', 'letters are refused');
  assert.equal(count.valueAsNumber, 41);
  count.value = '4';
  tap('ArrowUp');
  assert.equal(count.value, '6');
  tap('ArrowUp');
  tap('ArrowUp');
  tap('ArrowUp');
  assert.equal(count.value, '10', 'no further than the maximum');
  tap('ArrowDown');
  assert.equal(count.valueAsNumber, 8);
  count.value = '';
  assert.ok(Number.isNaN(count.valueAsNumber), 'empty is not a number');
  tap('ArrowUp');
  assert.equal(count.value, '2', 'from nothing, one step above the minimum');
  assert.ok(
    countEvents.includes('input') && countEvents.includes('change'),
    'stepping announces it',
  );
  // Undo and redo go by the platform's shortcuts, and are edits the page hears of.
  const note = place(el('input', { type: 'text' }));
  const noteEvents = log(note);
  note.focus();
  typeText('one');
  tap('ArrowLeft');
  typeText('X');
  assert.equal(note.value, 'onXe');
  noteEvents.length = 0;
  tap('z', shortcut);
  assert.equal(note.value, 'one', 'undo takes back the last edit');
  assert.deepEqual(noteEvents, ['input'], 'and tells the page');
  tap('z', { ...shortcut, shift: true });
  assert.equal(note.value, 'onXe', 'Shift redoes it');
  tap('z', shortcut);
  tap('z', shortcut);
  assert.equal(note.value, '', 'the run of typing goes at once');
  note.setAttribute('readonly', '');
  tap('z', { ...shortcut, shift: true });
  assert.equal(note.value, '', 'a read-only field is not changed');
  note.removeAttribute('readonly');
  note.value = 'set by a script';
  tap('z', shortcut);
  assert.equal(note.value, 'set by a script', 'a script setting the value leaves nothing to undo');
  note.blur();
  settle();
  settle();
  assert.deepEqual(errors, [], String(errors));
  assert.deepEqual(errors, [], String(errors));
  await host.images.idle();
  settle();
  await capture(host, 'fields');
  state.dispose();
} finally {
  host.dispose();
  context.dispose();
  target.dispose();
}
console.log(
  'Native text fields: typing, caret, selection, clipboard, pointer, scrolling and composition passed',
);
