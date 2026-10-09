import assert from 'node:assert/strict';
import { loadNative } from '../dist/native/index.js';
import { Host, HostEvent, HostPointerEvent, HostText, parseColor } from '../dist/native/host.js';

const native = loadNative();
const host = Host.create(native);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
try {
  const { root } = host;
  const row = root.appendChild(host.createElement('div'));
  row.setAttribute('style', 'flex-direction: row; gap: 4px; padding: 2px 0 0 10%');
  const items = ['a', 'b', 'c'].map((id) => {
    const item = host.createElement('span');
    item.id = id;
    item.setProperty('width', 20);
    item.setProperty('height', 10);
    item.setProperty('flex-shrink', 0);
    return item;
  });
  for (const item of items) {
    row.appendChild(item);
  }
  host.compute(200, 100);
  assert.deepEqual(
    items.map((item) => item.bounds()[0]),
    [20, 44, 68],
  );

  // DOM-shaped tree edits keep sibling links and native order together.
  const [a, b, c] = items;
  row.insertBefore(c, a);
  assert.deepEqual(row.childNodes, [c, a, b]);
  assert.equal(c.nextSibling, a);
  assert.equal(b.previousSibling, a);
  assert.equal(row.lastChild, b);
  assert.deepEqual(
    [c, a, b].map((item) => item.bounds()[0]),
    [20, 44, 68],
  );
  a.remove();
  assert.equal(a.parentNode, null);
  assert.deepEqual(row.childNodes, [c, b]);
  assert.equal(c.nextSibling, b);
  b.appendChild(a);
  assert.equal(a.parentNode, b);
  assert.throws(() => a.appendChild(row), /cycle/);
  assert.throws(() => row.insertBefore(c, a), /not a child/);
  assert.throws(() => row.removeChild(a), /not a child/);

  // Style attributes replace what the previous one set.
  row.setAttribute('style', 'flex-direction: column');
  host.compute(200, 100);
  assert.deepEqual(row.bounds().slice(0, 2), [0, 0]);
  assert.equal(c.bounds()[0], 0);

  // Attributes, id and classes are kept for the cascade.
  row.setAttribute('data-kind', 'list');
  row.className = 'one two';
  row.classList.add('three');
  row.classList.remove('one');
  assert.equal(row.getAttribute('class'), 'two three');
  assert(row.classList.contains('three'));
  assert.equal(row.classList.toggle('two'), false);
  assert.deepEqual(row.attributeNames.sort(), ['class', 'data-kind', 'style']);
  assert.equal(c.id, 'c');

  // Text inherits text properties from its ancestors, and writes coalesce per tick.
  const label = host.createTextNode('Hello');
  row.setProperty('font-size', 30);
  c.appendChild(label);
  c.setProperty('width', 'auto');
  c.setProperty('height', 'auto');
  await tick();
  host.compute(400, 200);
  const big = label.bounds();
  row.setProperty('font-size', null);
  label.data = 'Hello';
  host.compute(400, 200);
  assert(label.bounds()[3] < big[3], 'Unsetting the inherited size shrinks the text');
  assert.equal(c.textContent, 'Hello');
  const empty = host.createTextNode('');
  c.appendChild(empty);
  assert.deepEqual(empty.bounds().slice(2), [0, 0]);
  assert(host.createComment('anchor').bounds);

  // Paint properties accept CSS colors and brushes; unknown names throw.
  c.setProperty('background-color', '#336699');
  c.setProperty('border-radius', '4px 2px');
  c.setProperty('opacity', 0.5);
  assert.throws(() => c.setProperty('colour', 'red'), /Unknown property/);
  assert.throws(() => c.setProperty('width', 'wide'), /Invalid value/);
  assert.deepEqual(parseColor('#f008'), [1, 0, 0, 0x88 / 255]);
  assert.deepEqual(parseColor('rgb(255 0 0 / 50%)'), [1, 0, 0, 0.5]);
  assert.throws(() => parseColor('hsl(0, 1, 1)'), /Unsupported/);
  host.flush();

  // Event dispatch: capture from the root, the target, then bubbling.
  const log = [];
  root.addEventListener('pointerdown', () => log.push('root-capture'), { capture: true });
  root.addEventListener('pointerdown', () => log.push('root'));
  row.addEventListener('pointerdown', (event) => {
    log.push(`row:${event.eventPhase}:${event.target.id}`);
  });
  const once = () => log.push('once');
  c.addEventListener('pointerdown', once, { once: true });
  c.addEventListener('pointerdown', once, { once: true }); // Duplicate registrations collapse.
  host.compute(400, 200);
  const [x, y, w, h] = c.bounds();
  host.dispatchPointer('pointerdown', { x: x + w / 2, y: y + h / 2, button: 0 });
  assert.deepEqual(log, ['root-capture', 'once', 'row:3:c', 'root']);
  log.length = 0;
  // Text hits resolve to their element.
  assert.equal(host.elementAt(label.bounds()[0] + 2, label.bounds()[1] + 2), c);
  const stop = (event) => {
    event.stopPropagation();
    log.push('stopped');
  };
  c.addEventListener('pointerdown', stop);
  host.dispatchPointer('pointerdown', { x: x + 1, y: y + 1, button: 0 });
  assert.deepEqual(log, ['root-capture', 'stopped']);
  c.removeEventListener('pointerdown', stop);
  log.length = 0;
  // A click follows a press and release over the same element.
  c.addEventListener('click', (event) => log.push(`click:${event.detail}`));
  host.dispatchPointer('pointerup', { x: x + 1, y: y + 1, button: 0 });
  assert.deepEqual(log, ['click:1']);
  // Passive listeners cannot cancel; stopImmediatePropagation skips the rest.
  const event = new HostEvent('custom', { bubbles: true, cancelable: true });
  c.addEventListener('custom', (e) => e.preventDefault(), { passive: true });
  assert.equal(c.dispatchEvent(event), true);
  c.addEventListener('custom', (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  });
  let late = false;
  c.addEventListener('custom', () => (late = true));
  assert.equal(
    c.dispatchEvent(new HostEvent('custom', { bubbles: true, cancelable: true })),
    false,
  );
  assert.equal(late, false);
  const aborter = new AbortController();
  c.addEventListener('custom2', () => (late = true), { signal: aborter.signal });
  aborter.abort();
  c.dispatchEvent(new HostEvent('custom2'));
  assert.equal(late, false);
  assert(new HostPointerEvent('pointermove', { x: 1, y: 2 }).bubbles);

  // The signal fast path writes through the same coalesced path.
  const reactive = native.createReactive();
  const width = reactive.signal(30);
  const binding = b.bindProperty('width', width, reactive);
  host.compute(400, 200);
  assert.equal(b.bounds()[2], 30);
  width.set(45);
  host.compute(400, 200);
  assert.equal(b.bounds()[2], 45);
  binding.dispose();
  width.set(60);
  host.compute(400, 200);
  assert.equal(b.bounds()[2], 45);

  // Destroying releases the subtree; destroyed nodes cannot be placed again.
  const size = host.layout.size;
  b.destroy();
  assert(b.destroyed && a.destroyed);
  assert.equal(host.layout.size, size - 2);
  assert.throws(() => row.appendChild(a), /destroyed/);
  assert.equal(host.nodeById(c.layoutNode.id), c);
  assert(label instanceof HostText);
  reactive.dispose();
} finally {
  host.dispose();
}
console.log('Native host: tree edits, properties, text inheritance, events and bindings passed');

// Mounting presents the root in a window; the scope unmounts it, and edits redraw.
const { Scope } = await import('../dist/hmr.js');
const { NativeWindowHost } = await import('../dist/native/window.js');
const { setTimeout: delay } = await import('node:timers/promises');
const window = new NativeWindowHost(native, {
  title: 'Host mount verification',
  width: 320,
  height: 200,
});
const scope = new Scope();
const mounted = Host.create(native, scope);
const waitFor = async (condition, message) => {
  const until = performance.now() + 5000;
  while (!condition()) {
    assert.equal(window.error, undefined);
    assert(performance.now() < until, message);
    await delay(16);
  }
};
try {
  await window.ready;
  const box = mounted.root.appendChild(mounted.createElement('div'));
  box.setProperty('width', '50%');
  box.setProperty('height', 40);
  box.setProperty('background', '#ff8800');
  box.appendChild(mounted.createTextNode('Mounted'));
  mounted.mount(window, { scope });
  await waitFor(() => window.frames > 0 && window.stats?.primitives > 1, 'First mounted frame');
  assert.equal(box.bounds()[2], 160);
  const frames = window.frames;
  box.setProperty('height', 60);
  await waitFor(() => window.frames > frames, 'An edit redraws');
  scope.dispose();
  assert.equal(mounted.layout.disposed, true);
  assert.equal(window.stats, undefined);
} finally {
  scope.dispose();
  window.dispose();
  await window.closed;
}
console.log('Native host: window mount and scope unmount passed');
