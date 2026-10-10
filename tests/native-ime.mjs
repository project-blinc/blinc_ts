import assert from 'node:assert/strict';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { ThemeState, neutralTheme } from '../dist/theme/index.js';
import { addUserAgent } from '../dist/theme/user-agent.js';

const native = loadNative();
const W = 400;
const H = 400;
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
  const settle = () => {
    host.flush();
    host.compute(W, H);
    host.compute(W, H);
  };

  // Where the input method is told candidates belong, as a window would take it.
  const told = [];
  host.inputArea = (area) => told.push(area);
  const last = () => told.at(-1);

  const one = el('input', { value: 'hello', style: 'flex-shrink: 0' });
  const other = el('input', { value: 'there', style: 'flex-shrink: 0' });
  const locked = el('input', { value: 'fixed', readonly: '', style: 'flex-shrink: 0' });
  const off = el('input', { value: 'off', disabled: '', style: 'flex-shrink: 0' });
  const area = el('textarea', { style: 'height: 80px; flex-shrink: 0' }, [
    'one\ntwo\nthree\nfour\nfive\nsix\nseven',
  ]);
  const scroller = el(
    'div',
    {
      style:
        'position: absolute; left: 10px; top: 10px; width: 260px; height: 360px; overflow-y: scroll; gap: 8px',
    },
    [
      el('div', { style: 'height: 40px; flex-shrink: 0' }),
      one,
      other,
      locked,
      off,
      area,
      el('div', { style: 'height: 300px; flex-shrink: 0' }),
    ],
  );
  host.root.appendChild(scroller);
  settle();
  assert.equal(told.length, 0, 'nothing has focus, nothing is told');

  // Focus: told where the caret is, at the end of what the field holds.
  one.focus();
  settle();
  assert.equal(told.length, 1);
  const [fx, fy, fw, fh] = one.viewBounds();
  const first = last();
  assert.ok(first, 'told an area');
  assert.ok(first.x > fx && first.x < fx + fw, `the caret is inside the field (${first.x})`);
  assert.ok(
    first.y >= fy && first.y + first.height <= fy + fh + 0.5,
    `and level with it ${JSON.stringify([first, fy, fh])}`,
  );
  assert.ok(first.height > 8 && first.width >= 1);

  // Typing moves it right, and an unchanged area is not told again.
  host.input.text(' world');
  settle();
  assert.equal(told.length, 2);
  assert.ok(last().x > first.x + 20, 'the caret moved along with the text');
  settle();
  assert.equal(told.length, 2, 'the same area is not told twice');
  host.input.keyDown({ key: 'Home' });
  host.input.keyUp({ key: 'Home' });
  settle();
  assert.ok(Math.abs(last().x - first.x) > 20 && last().x < first.x, 'Home takes it to the start');

  // Moving to another field is not an interval of none.
  const before = told.length;
  other.focus();
  settle();
  assert.ok(told.length > before);
  assert.ok(!told.slice(before).includes(null), 'no gap between one field and the next');
  assert.ok(last().y > first.y, 'the second field is below the first');

  // Where it shows: a container scrolled moves everything, so the area follows.
  const level = last().y;
  scroller.scrollBy(0, 20);
  settle();
  assert.ok(Math.abs(last().y - (level - 20)) < 0.5, 'a scrolled container moves the area');
  scroller.scrollBy(0, -20);
  settle();

  // Read-only and disabled text have no input method; leaving a field turns it off.
  locked.focus();
  settle();
  assert.equal(last(), null, 'a read-only field takes no input method');
  other.focus();
  settle();
  assert.ok(last(), 'back on');
  other.blur();
  settle();
  assert.equal(last(), null, 'no text has focus');
  const turnedOff = told.length;
  settle();
  assert.equal(told.length, turnedOff, 'told once');

  // A text area's caret is on its line, and the area follows it as the text scrolls.
  area.focus();
  settle();
  const top = last();
  assert.ok(top, 'told for a text area');
  const [, ay, , ah] = area.viewBounds();
  assert.ok(top.y >= ay && top.y < ay + ah, 'on the line the caret is at, in view');
  for (let line = 0; line < 6; line++) {
    host.input.keyDown({ key: 'ArrowUp' });
    host.input.keyUp({ key: 'ArrowUp' });
  }
  settle();
  settle();
  assert.ok(last().y < top.y, 'the caret went up to the first line');
  assert.ok(last().y >= ay, 'which is in view, the text having scrolled back');
  assert.ok(last().y + last().height <= ay + ah + 1, 'and stays in view');

  // A field removed while it has focus turns the input method off.
  scroller.removeChild(area);
  settle();
  assert.equal(last(), null);
  area.destroy();
  const gone = el('input', { style: 'flex-shrink: 0' });
  scroller.appendChild(gone);
  gone.focus();
  settle();
  assert.ok(last(), 'on for a new field');
  gone.destroy();
  settle();
  assert.equal(last(), null, 'and off when it is destroyed with focus');

  // A mounted host hands the area to its window: on, by the caret in window units, off.
  const calls = [];
  const window = {
    disposed: false,
    bindings: { window: {} },
    window: {
      scaleFactor: () => 2,
      width: () => W * 2,
      height: () => H * 2,
      setCursorIcon: () => undefined,
      setImeAllowed: (on) => calls.push(['allowed', on]),
      setImeCursorArea: (x, y, w, h) => calls.push(['area', x, y, w, h]),
    },
    attachScene: () => undefined,
    detachScene: () => undefined,
    onEvent: () => () => undefined,
  };
  const unmount = host.mount(window);
  assert.equal(typeof host.inputArea, 'function', 'mounting replaces the sink with its window');
  other.focus();
  settle();
  const [x, y, w, h] = other.viewBounds();
  assert.deepEqual(calls[0], ['allowed', true]);
  assert.equal(calls[1][0], 'area');
  assert.ok(calls[1][1] > x && calls[1][1] < x + w, 'window units, not pixels');
  assert.ok(calls[1][2] >= y && calls[1][2] <= y + h);
  host.input.text('!');
  settle();
  assert.equal(calls.filter((c) => c[0] === 'allowed').length, 1, 'on once');
  assert.ok(calls.filter((c) => c[0] === 'area').length >= 2, 'the area follows the caret');
  unmount();
  assert.deepEqual(calls.at(-1), ['allowed', false], 'unmounting turns it off');
  assert.equal(host.inputArea, null);

  assert.deepEqual(errors, [], String(errors));
  state.dispose();
} finally {
  host.dispose();
  context.dispose();
}
console.log('Native input method: caret area, focus changes, scrolling and mounting passed');
