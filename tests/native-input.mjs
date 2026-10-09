import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';

const native = loadNative();
const host = Host.create(native);
const { input, root } = host;
const log = [];
const record = (element, types) => {
  for (const type of types) {
    element.addEventListener(type, () => log.push(`${type}:${element.id}`));
  }
};
function box(id, parent, style, tag = 'div') {
  const element = host.createElement(tag);
  element.id = id;
  for (const [name, value] of Object.entries(style)) {
    element.setProperty(name, value);
  }
  parent.appendChild(element);
  return element;
}
const center = (element) => {
  const [x, y, w, h] = element.bounds();
  return [x + w / 2, y + h / 2];
};
try {
  root.id = 'root';
  const panel = box('panel', root, { width: 200, height: 100, padding: 10, 'flex-shrink': 0 });
  const a = box('a', panel, { width: 50, height: 50 }, 'button');
  const b = box('b', panel, { width: 50, height: 50 });
  host.compute(400, 300);

  // Hover: leave innermost first, enter outermost first; over and out bubble.
  const hover = ['pointerenter', 'pointerleave', 'pointerover', 'pointerout'];
  [root, panel, a, b].forEach((element) => record(element, hover));
  input.pointerMove(...center(a));
  assert.deepEqual(log, [
    'pointerenter:root',
    'pointerenter:panel',
    'pointerenter:a',
    'pointerover:a',
    'pointerover:panel',
    'pointerover:root',
  ]);
  assert(a.interaction.hover && panel.interaction.hover);
  log.length = 0;
  input.pointerMove(...center(b));
  assert.deepEqual(log, [
    'pointerout:a',
    'pointerout:panel',
    'pointerout:root',
    'pointerleave:a',
    'pointerenter:b',
    'pointerover:b',
    'pointerover:panel',
    'pointerover:root',
  ]);
  assert(!a.interaction.hover && b.interaction.hover);
  log.length = 0;

  // A press over b and release over a clicks their deepest common element.
  record(panel, ['click']);
  record(a, ['click', 'dblclick']);
  input.pointerDown(0);
  assert(b.interaction.active && panel.interaction.active);
  input.pointerMove(...center(a));
  log.length = 0;
  input.pointerUp(0);
  assert.deepEqual(log, ['click:panel']);
  assert(!b.interaction.active);
  log.length = 0;
  // Two quick presses on a make a double click.
  for (let i = 0; i < 2; i++) {
    input.pointerDown(0);
    input.pointerUp(0);
  }
  assert.deepEqual(log, ['click:a', 'click:panel', 'click:a', 'click:panel', 'dblclick:a']);
  log.length = 0;
  // Disabled elements take no presses or clicks.
  a.setAttribute('disabled', '');
  input.pointerDown(0);
  input.pointerUp(0);
  assert.deepEqual(log, []);
  a.removeAttribute('disabled');

  // Pointer capture routes moves and the release to the capturing element.
  b.addEventListener('pointerdown', () => b.setPointerCapture());
  record(b, ['pointermove', 'pointerup', 'lostpointercapture']);
  input.pointerMove(...center(b));
  input.pointerDown(0);
  log.length = 0;
  input.pointerMove(390, 290);
  input.pointerUp(0);
  // After release, hover moves to what is under the pointer; the click still goes to b.
  assert.deepEqual(log, [
    'pointermove:b',
    'pointerup:b',
    'lostpointercapture:b',
    'pointerout:b',
    'pointerout:panel',
    'pointerout:root',
    'pointerleave:b',
    'pointerleave:panel',
    'pointerover:root',
    'click:panel',
  ]);
  assert.equal(input.pointerCapture, null);
  log.length = 0;

  // Pressing focuses the nearest focusable element; pressing elsewhere blurs it.
  const focus = ['focus', 'blur', 'focusin', 'focusout'];
  [panel, a].forEach((element) => record(element, focus));
  input.pointerMove(...center(a));
  input.pointerDown(0);
  input.pointerUp(0);
  assert.equal(input.focused, a);
  assert(a.interaction.focus && !a.interaction.focusVisible && panel.interaction.focusWithin);
  input.pointerMove(390, 290);
  input.pointerDown(0);
  input.pointerUp(0);
  assert.equal(input.focused, null);
  assert.deepEqual(
    log.filter((entry) => /^(focus|blur)/.test(entry)),
    ['focus:a', 'focusin:a', 'focusin:panel', 'blur:a', 'focusout:a', 'focusout:panel'],
  );
  assert(!panel.interaction.focusWithin);
  log.length = 0;

  // Tab order: positive tabindex first, then document order; the keyboard makes focus visible.
  b.setAttribute('tabindex', '0');
  const c = box('c', panel, { width: 10, height: 10 });
  c.setAttribute('tabindex', '2');
  const order = [];
  for (let i = 0; i < 4; i++) {
    input.keyDown({ key: 'Tab' });
    order.push(input.focused.id);
  }
  assert.deepEqual(order, ['c', 'a', 'b', 'c']);
  assert(c.interaction.focusVisible);
  input.keyDown({
    key: 'Tab',
    modifiers: { shift: true, control: false, alt: false, meta: false },
  });
  assert.equal(input.focused, b);
  // A trap keeps Tab inside it.
  const release = input.trapFocus(b);
  input.keyDown({ key: 'Tab' });
  assert.equal(input.focused, b);
  release();
  log.length = 0;

  // Keys go to the focused element and bubble; cancelling Tab keeps focus.
  record(panel, ['keydown', 'keyup', 'textinput']);
  b.addEventListener('keydown', (event) => event.key === 'Tab' && event.preventDefault());
  input.keyDown({ key: 'Tab', code: 'Tab' });
  assert.equal(input.focused, b);
  assert.deepEqual(log, ['keydown:panel']);
  log.length = 0;
  // Enter and Space activate the focused element as a click.
  input.focus(a);
  log.length = 0;
  input.keyDown({ key: 'Enter' });
  input.keyUp({ key: ' ' });
  assert.deepEqual(log, [
    'keydown:panel',
    'click:a',
    'click:panel',
    'keyup:panel',
    'click:a',
    'click:panel',
  ]);
  log.length = 0;

  // Typed text and input-method composition go to the focused element.
  record(a, ['compositionstart', 'compositionupdate', 'compositionend']);
  const typed = [];
  a.addEventListener('textinput', (event) => typed.push(event.data));
  input.composition('ni', 2);
  input.composition('nih', 3);
  input.text('你');
  assert.deepEqual(log, [
    'compositionstart:a',
    'compositionupdate:a',
    'compositionupdate:a',
    'compositionend:a',
    'textinput:panel',
  ]);
  assert.deepEqual(typed, ['你']);
  log.length = 0;

  // Interaction changes reach the cascade's hook.
  const changes = [];
  const off = input.onInteraction((element, state) => changes.push([element.id, state.focus]));
  input.blur();
  off();
  assert.deepEqual(changes, [
    ['a', false],
    ['a', false],
    ['a', false],
    ['panel', false],
    ['root', false],
  ]);

  // Wheel scrolling: the inner container scrolls to its edge, then the outer one takes the rest.
  const outer = box('outer', root, {
    width: 100,
    height: 100,
    overflow: 'scroll',
    'flex-shrink': 0,
  });
  const inner = box('inner', outer, {
    width: 100,
    height: 100,
    'flex-shrink': 0,
    'overflow-y': 'scroll',
    'flex-direction': 'column',
  });
  box('content', inner, { width: 100, height: 160, 'flex-shrink': 0 });
  box('more', outer, { width: 100, height: 100, 'flex-shrink': 0 });
  outer.setProperty('flex-direction', 'column');
  host.compute(400, 300);
  const scrolled = [];
  outer.addEventListener('scroll', () => scrolled.push(`outer:${outer.scrollTop}`));
  inner.addEventListener('scroll', () => scrolled.push(`inner:${inner.scrollTop}`));
  input.pointerMove(...center(inner));
  input.wheel(0, 100);
  assert.deepEqual(scrolled, ['inner:60', 'outer:40']);
  input.wheel(0, -500);
  assert.equal(inner.scrollTop, 0);
  assert.equal(outer.scrollTop, 0);
  outer.addEventListener('wheel', (event) => event.preventDefault());
  input.wheel(0, 50);
  assert.equal(inner.scrollTop, 0, 'A cancelled wheel does not scroll');

  // Destroying the focused element drops focus and its state.
  input.focus(a);
  a.destroy();
  assert.equal(input.focused, null);
  assert.equal(input.hovered === a, false);
} finally {
  host.dispose();
}
// Disabled state, cursors, clipboard shortcuts and cached hit regions.
{
  const host2 = Host.create(native);
  const { input: input2, root: root2 } = host2;
  try {
    const button = host2.createElement('button');
    button.setProperty('width', 40);
    button.setProperty('height', 20);
    button.setProperty('cursor', 'pointer');
    const inner = host2.createElement('span');
    inner.setProperty('width', 10);
    inner.setProperty('height', 10);
    button.appendChild(inner);
    root2.appendChild(button);
    host2.compute(200, 100);
    const states = [];
    input2.onInteraction((element, state) => states.push(`${element.tag}:${state.disabled}`));
    const cursors = [];
    input2.onCursor((cursor) => cursors.push(cursor));
    input2.pointerMove(5, 5);
    assert.equal(input2.cursor, 'pointer', 'An ancestor sets the cursor');
    inner.setProperty('cursor', 'text');
    assert.equal(input2.cursor, 'text');
    inner.setProperty('cursor', null);
    input2.pointerMove(150, 50);
    assert.deepEqual(cursors, ['pointer', 'text', 'pointer', 'default']);

    button.focus();
    assert.equal(input2.focused, button);
    button.setAttribute('disabled', '');
    assert(button.interaction.disabled);
    assert.equal(input2.focused, null, 'Disabling the focused element blurs it');
    assert.equal(button.focus(), false);
    button.removeAttribute('disabled');
    assert(!button.interaction.disabled);
    assert(states.includes('button:true') && states.at(-1) === 'button:false');

    // The platform's shortcut sends copy, cut and paste to the focused element.
    const meta = process.platform === 'darwin';
    const mods = { shift: false, control: !meta, alt: false, meta };
    button.focus();
    button.addEventListener('copy', (event) => event.clipboard.setText('copied'));
    let pasted = '';
    root2.addEventListener('paste', (event) => (pasted = event.clipboard.text()));
    input2.keyDown({ key: 'c', modifiers: mods });
    input2.keyDown({ key: 'v', modifiers: mods });
    assert.equal(pasted, 'copied');
    assert.deepEqual(host2.clipboard.types(), ['text/plain']);
    host2.clipboard.write([
      { type: 'text/html', data: new TextEncoder().encode('<b>x</b>') },
      { type: 'text/plain', data: new TextEncoder().encode('x') },
    ]);
    assert.equal(host2.clipboard.text(), 'x');
    input2.keyDown({ key: 'c' });
    assert.equal(host2.clipboard.text(), 'x', 'Without the modifier, c is only a key');

    // Repeated points inside one hit region cross no native boundary.
    const addon = createRequire(import.meta.url)('../native/blinc_ts.node');
    const region = addon.NativeLayout.prototype.hitTestRegion;
    let walks = 0;
    addon.NativeLayout.prototype.hitTestRegion = function (...args) {
      walks++;
      return region.apply(this, args);
    };
    try {
      input2.pointerMove(150, 50);
      for (let x = 150; x < 160; x++) {
        input2.pointerMove(x, 50);
      }
      assert(walks <= 1, 'Quiet movement reuses the hit region');
      button.setProperty('width', 180);
      input2.pointerMove(151, 5);
      assert.equal(input2.hovered, button, 'An edit invalidates the region');
    } finally {
      addon.NativeLayout.prototype.hitTestRegion = region;
    }
  } finally {
    host2.dispose();
  }
}
console.log(
  'Native input: hover, clicks, capture, focus, keys, composition, scrolling, cursors, clipboard and hit caching passed',
);
