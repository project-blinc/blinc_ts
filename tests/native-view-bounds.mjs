import assert from 'node:assert/strict';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { TopLayer } from '../dist/native/top-layer.js';
import { ThemeState, neutralTheme } from '../dist/theme/index.js';
import { addUserAgent } from '../dist/theme/user-agent.js';

const native = loadNative();
const W = 400;
const H = 420;
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
  let clock = 0;
  const settle = () => {
    host.flush();
    host.compute(W, H);
    host.compute(W, H);
    host.layout.tickMotion((clock += 1));
    host.layout.tickMotion((clock += 2000));
    host.compute(W, H);
  };
  const press = (x, y) => {
    host.input.pointerMove(x, y);
    host.input.pointerDown();
    host.input.pointerUp();
    host.input.pointerMove(W - 1, H - 1);
  };
  const spacer = (height) => el('div', { style: `height: ${height}px; flex-shrink: 0` });
  const tall = (e) => {
    e.setAttribute('style', `${e.getAttribute('style') ?? ''}; flex-shrink: 0`);
    return e;
  };

  // Everything here lives in a container scrolled well down, so what is laid out and where it
  // shows differ by the scroll. The first and second scrollers hold the same content: one is not
  // scrolled (what is read from it is what layout says), the other is.
  const build = (left) => {
    const area = tall(
      el('textarea', { style: 'height: 100px' }, ['line one\nline two\nline three\nline four']),
    );
    const pick = tall(
      el('select', {}, [
        el('option', { value: 'a' }, ['Apple']),
        el('option', { value: 'b' }, ['Banana']),
      ]),
    );
    const slider = tall(
      el('input', {
        type: 'range',
        'data-orientation': 'vertical',
        min: '0',
        max: '100',
        value: '0',
        style: 'height: 100px; width: 16px',
      }),
    );
    const scroller = el(
      'div',
      {
        style: `position: absolute; left: ${left}px; top: 10px; width: 180px; height: 380px; overflow-y: scroll; gap: 8px`,
      },
      [spacer(60), area, pick, slider, spacer(300)],
    );
    host.root.appendChild(scroller);
    return { scroller, area, pick, slider };
  };
  const still = build(10);
  const moved = build(210);
  settle();
  moved.scroller.scrollBy(0, 40);
  settle();
  assert.equal(still.scroller.scrollTop, 0);
  assert.equal(moved.scroller.scrollTop, 40);

  // A node's view bounds are its layout less the scroll of what holds it.
  for (const name of ['area', 'pick', 'slider']) {
    const [lx, ly, lw, lh] = moved[name].bounds();
    const [vx, vy, vw, vh] = moved[name].viewBounds();
    assert.deepEqual([vx, vy, vw, vh], [lx, ly - 40, lw, lh], `${name} shows 40 higher`);
    const [sx, sy] = still[name].viewBounds();
    assert.deepEqual([sx, sy], still[name].bounds().slice(0, 2), 'unscrolled, they agree');
  }
  const [, , , scrollerHeight] = moved.scroller.bounds();
  assert.equal(
    moved.scroller.viewBounds()[1],
    moved.scroller.bounds()[1],
    'a scroller itself stays',
  );
  assert.ok(scrollerHeight > 0);

  // A press in a text area lands where it shows, so it picks the same character in both.
  const caretFor = ({ area, scroller }) => {
    const [x, y] = area.viewBounds();
    area.blur();
    press(x + 14, y + 8 + 30);
    assert.equal(host.input.focused, area, 'the press focused the text area');
    void scroller;
    return area.selectionStart;
  };
  const wanted = caretFor(still);
  assert.ok(wanted > 0, 'a press inside the text lands past its start');
  assert.equal(caretFor(moved), wanted, 'scrolled, the press still lands on the same place');
  host.input.pointerMove(W - 1, H - 1);

  // A vertical range follows a pointer along its track as it shows.
  const track = (slider) => {
    const [x, y, , height] = slider.viewBounds();
    press(x + 8, y + height / 2);
    return Number(slider.value);
  };
  const middle = track(still.slider);
  assert.ok(middle > 30 && middle < 70, `the middle of the track is near half (${middle})`);
  assert.ok(Math.abs(track(moved.slider) - middle) <= 1, 'as it is when its container is scrolled');

  // A select's list opens under the select as it shows.
  const stack = TopLayer.of(host);
  const opened = (select) => {
    const [x, y, w, h] = select.viewBounds();
    press(x + w / 2, y + h / 2);
    const list = stack.entries.at(-1)?.content;
    assert.ok(list, 'the list is open');
    settle();
    const at = list.bounds();
    void x;
    return { select: [x, y, w, h], list: at };
  };
  const close = () => {
    host.input.keyDown({ key: 'Escape' });
    host.input.keyUp({ key: 'Escape' });
    settle();
  };
  const near = opened(moved.pick);
  assert.ok(
    Math.abs(near.list[1] - (near.select[1] + near.select[3])) < 8,
    `the list sits under the select (list ${near.list[1]}, select bottom ${near.select[1] + near.select[3]})`,
  );
  assert.ok(Math.abs(near.list[0] - near.select[0]) < 2, 'and lines up with it');
  close();
  const base = opened(still.pick);
  assert.ok(Math.abs(base.list[1] - (base.select[1] + base.select[3])) < 8);
  close();

  assert.deepEqual(errors, [], String(errors));
  state.dispose();
} finally {
  host.dispose();
  context.dispose();
}
console.log(
  'Native view bounds: pointer, range and select placement in scrolled containers passed',
);
