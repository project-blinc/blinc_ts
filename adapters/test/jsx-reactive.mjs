// The JSX runtime's reactive layer: sources in props and children, control flow, owners.
import assert from 'node:assert/strict';
import { loadNative } from 'blinc_ts/native';
import { Host, HostElement } from 'blinc_ts/native/host';
import { render, mount } from '../dist/jsx/jsx-runtime.js';
import * as views from '../dist/scene/jsx-reactive.js';

const native = loadNative();
const context = native.createReactive();
const host = Host.create(native);
try {
  const state = () => ({
    on: context.signal(false),
    color: context.signal('#ff0000'),
    width: context.signal(40),
    label: context.signal(undefined),
    count: context.signal(0),
    items: context.signal([]),
    mode: context.signal('a'),
    log: [],
    refs: {},
  });
  /** The elements under `element`, anchors left out. */
  const elements = (element) => element.childNodes.filter((n) => n instanceof HostElement);
  const ids = (element) => elements(element).map((e) => e.id || e.tag);
  const size = (e) => {
    host.compute(400, 300);
    return e.bounds().slice(2);
  };
  const run = (view, s, check) => {
    const unmount = mount(host, view(s), { context });
    try {
      check();
    } finally {
      unmount();
    }
    host.flush();
    assert.equal(host.root.firstChild, null, 'unmounting leaves nothing in the root');
  };

  // Props follow their sources: attributes, class, style properties, a whole style.
  {
    const s = state();
    run(views.props, s, () => {
      const box = s.refs.box;
      assert.equal(box.className, 'off');
      assert.equal(box.getAttribute('data-state'), '#ff0000');
      assert.equal(
        box.getAttribute('data-flag'),
        'false',
        'a boolean data attribute holds its word',
      );
      assert.equal(box.hasAttribute('hidden'), false, 'false takes a boolean attribute away');
      assert.equal(box.hasAttribute('title'), false, 'undefined takes any attribute away');
      assert.deepEqual(size(box), [40, 20]);
      s.on.set(true);
      s.color.set('#00ff00');
      s.width.set(70);
      s.label.set('Hello');
      assert.equal(box.className, 'on');
      assert.equal(box.getAttribute('data-state'), '#00ff00');
      assert.equal(box.getAttribute('data-flag'), 'true');
      assert.equal(box.getAttribute('hidden'), '', 'true is the attribute present');
      assert.equal(box.getAttribute('title'), 'Hello');
      assert.deepEqual(size(box), [70, 20], 'a style property follows its signal');
      s.label.set(undefined);
      assert.equal(box.hasAttribute('title'), false);
    });
  }
  {
    const s = state();
    run(views.wholeStyle, s, () => {
      const whole = s.refs.whole;
      assert.equal(whole.style.get('height'), '12px');
      assert.equal(whole.style.get('opacity'), '0.5');
      s.on.set(true);
      assert.equal(whole.style.get('width'), '30px');
      assert.equal(whole.style.get('height'), '10px');
      assert.equal(whole.style.has('opacity'), false, 'what the new style lacks is taken away');
      s.on.set(false);
      assert.equal(whole.style.has('width'), false);
      assert.equal(whole.style.get('opacity'), '0.5');
    });
  }

  // Text that follows a source is rewritten in place; anything else rebuilds.
  {
    const s = state();
    run(views.text, s, () => {
      const box = s.refs.text;
      assert.equal(box.textContent, 'Count: 0no');
      const [, counted] = box.childNodes.filter((n) => !(n instanceof HostElement) && n.data);
      s.count.set(3);
      assert.equal(box.textContent, 'Count: 3no');
      const after = box.childNodes.filter((n) => !(n instanceof HostElement) && n.data)[1];
      assert.equal(after, counted, 'the text node is the same, its data rewritten');
      s.on.set(true);
      assert.equal(box.textContent, 'Count: 3yes');
      assert.deepEqual(ids(box), ['b']);
      s.on.set(false);
      assert.equal(box.textContent, 'Count: 3no');
      assert.deepEqual(ids(box), [], 'the element is gone');
    });
  }

  // A function child is run in a fresh scope each time; text it only rewrites leaves none behind.
  {
    const s = state();
    run(views.fresh, s, () => {
      assert.equal(s.refs.fresh.textContent, '0');
      s.count.set(1);
      assert.equal(s.refs.fresh.textContent, '1');
      assert.deepEqual(s.log, ['end:1'], 'the scope of the rewrite ended at once');
    });
    assert.deepEqual(s.log, ['end:1', 'end:0'], 'the one that built the text ends with the view');
  }

  // Show: builds while true, fallback otherwise; a component under it is made and ended with it.
  {
    const s = state();
    run(views.show, s, () => {
      const box = s.refs.show;
      assert.deepEqual(ids(box), ['off']);
      assert.deepEqual(s.log, []);
      s.on.set(true);
      assert.deepEqual(ids(box), ['a']);
      assert.deepEqual(s.log, ['a:0'], 'the component ran once, and its effect with it');
      s.on.set(true);
      assert.deepEqual(s.log, ['a:0'], 'a write of the same value changes nothing');
      elements(box)[0].click();
      assert.deepEqual(s.log, ['a:0', 'a:1'], 'a handler writes the component own signal');
      elements(box)[0].click();
      assert.deepEqual(s.log, ['a:0', 'a:1', 'a:2']);
      s.log.length = 0;
      s.count.set(1);
      assert.deepEqual(ids(box), ['a', 'keyed', 'plain']);
      assert.equal(elements(box)[1].textContent, 'n=1', 'a function child is given the value');
      const plain = elements(box)[2];
      s.count.set(2);
      assert.equal(elements(box)[1].textContent, 'n=2', 'and builds again when it changes');
      assert.equal(elements(box)[2], plain, 'a child that is not given it is not rebuilt');
      s.on.set(false);
      assert.deepEqual(ids(box), ['off', 'keyed', 'plain']);
      assert.deepEqual(s.log, ['a:cleanup'], 'what it made ended with it');
      s.on.set(true);
      assert.deepEqual(s.log, ['a:cleanup', 'a:0'], 'and starts again from nothing');
      s.count.set(0);
      assert.deepEqual(ids(box), ['a'], 'a falsy value hides what is keyed to it');
    });
  }

  // For: items built once and kept by identity; moved, not rebuilt; index follows.
  {
    const s = state();
    run(views.list, s, () => {
      const box = s.refs.list;
      assert.deepEqual(ids(box), ['none'], 'an empty list shows the fallback');
      s.items.set(['a', 'b', 'c']);
      assert.deepEqual(
        elements(box).map((e) => e.textContent),
        ['a', 'b', 'c'],
      );
      const [a, b, c] = [s.refs.a, s.refs.b, s.refs.c];
      assert.deepEqual(
        elements(box).map((e) => e.getAttribute('data-at')),
        ['0', '1', '2'],
      );
      s.items.set(['c', 'a', 'b']);
      assert.deepEqual(
        elements(box).map((e) => e.textContent),
        ['c', 'a', 'b'],
      );
      assert.deepEqual([elements(box)[1], elements(box)[2], elements(box)[0]], [a, b, c], 'moved');
      assert.deepEqual(
        elements(box).map((e) => e.getAttribute('data-at')),
        ['0', '1', '2'],
        'the index follows the move',
      );
      s.items.set(['c', 'x', 'b']);
      assert.deepEqual(
        elements(box).map((e) => e.textContent),
        ['c', 'x', 'b'],
      );
      assert.equal(a.destroyed, true, 'an item that left is gone');
      assert.equal(elements(box)[0], c);
      assert.equal(elements(box)[2], b, 'the others are kept');
      s.items.set(['b', 'b']);
      assert.deepEqual(
        elements(box).map((e) => e.textContent),
        ['b', 'b'],
        'an item twice is kept twice',
      );
      assert.equal(elements(box)[0], b, 'the first of them is the one kept');
      s.items.set([]);
      assert.deepEqual(ids(box), ['none']);
      s.items.set(['z']);
      assert.deepEqual(ids(box), ['li']);
      assert.equal(box.textContent, 'z', 'the fallback went when the list came back');
    });
  }

  // Ending a Show ends the items under it, with their owners.
  {
    const s = state();
    s.items.set(['p', 'q']);
    run(views.nested, s, () => {
      const box = s.refs.nested;
      assert.deepEqual(ids(box), []);
      s.on.set(true);
      assert.equal(box.textContent, 'pq');
      s.items.set(['p']);
      assert.deepEqual(s.log, ['end:q'], 'a removed item ended');
      s.on.set(false);
      assert.deepEqual(s.log, ['end:q', 'end:p']);
      assert.equal(box.textContent, '');
      assert.deepEqual(
        box.childNodes.filter((n) => n instanceof HostElement),
        [],
      );
      s.on.set(true);
      s.items.set(['r']);
      assert.equal(box.textContent, 'r');
    });
    assert.deepEqual(s.log.slice(-1), ['end:r'], 'unmounting ends what is left');
  }

  // Switch: the first case that holds, else the fallback; nothing rebuilds while it stays.
  {
    const s = state();
    run(views.choose, s, () => {
      const box = s.refs.choose;
      assert.deepEqual(ids(box), ['a']);
      const first = elements(box)[0];
      s.mode.set('aa');
      assert.equal(elements(box)[0], first, 'a change that picks the same case rebuilds nothing');
      s.mode.set('b');
      assert.deepEqual(ids(box), ['b']);
      s.mode.set('c');
      assert.deepEqual(ids(box), ['other']);
    });
  }

  // Context: the nearest provider above, else the default.
  {
    const s = state();
    run(views.context, s, () => {
      assert.deepEqual(
        elements(s.refs.context).map((e) => e.getAttribute('data-theme')),
        ['plain', 'dark', 'warm'],
      );
    });
  }

  // A computed value is a source like any other.
  {
    const s = state();
    run(views.derived, s, () => {
      const box = s.refs.derived;
      assert.equal(box.getAttribute('data-double'), '0');
      s.count.set(21);
      assert.equal(box.getAttribute('data-double'), '42');
    });
  }

  // Ending a view stops what it started: nothing runs, and no write throws.
  {
    const s = state();
    const unmount = mount(host, views.props(s), { context });
    const box = s.refs.box;
    unmount();
    s.width.set(90);
    s.on.set(true);
    assert.equal(box.destroyed, true);
    unmount();
  }

  // A view that cannot change says so, rather than quietly never updating.
  assert.throws(() => render(host, views.props(state())), /mount\(\)/);
} finally {
  host.dispose();
  context.dispose();
}
console.log('JSX reactive runtime: props, text, Show, For, Switch, context and cleanup passed');
