// The Base UI components: state held or shared, data attributes, keyboard, and mounting.
import assert from 'node:assert/strict';
import { loadNative } from 'blinc_ts/native';
import { Host, HostElement } from 'blinc_ts/native/host';
import { ThemeState } from 'blinc_ts/theme';
import { addUserAgent } from 'blinc_ts/theme/user-agent';
import { mount } from '../dist/jsx/jsx-runtime.js';
import { baseUiTheme } from '../dist/base-ui/theme.js';
import * as views from '../dist/scene/base-ui-components.js';

const native = loadNative();
const context = native.createReactive();
const host = Host.create(native);
try {
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  const state = new ThemeState(context, baseUiTheme, { scheme: 'light' });
  state.attach(host.layout);
  addUserAgent(host.layout);
  const W = 500;
  const H = 400;
  const shared = () => ({
    flag: context.signal(false),
    value: context.signal('one'),
    list: context.signal([]),
    log: [],
    refs: {},
  });
  const has = (e, name) => e.hasAttribute(name);
  const attr = (e, name) => e.getAttribute(name);
  const tap = (key) => {
    host.input.keyDown({ key });
    host.input.keyUp({ key });
  };
  let clock = 0;
  /** Let motion play out, and what waits for it: a panel stays built while it folds away. */
  const exit = async () => {
    for (let i = 0; i < 3; i++) {
      host.flush();
      host.compute(W, H);
      host.layout.tickMotion((clock += 1));
      host.layout.tickMotion((clock += 3000));
      host.compute(W, H);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  const run = async (view, s, check) => {
    const unmount = mount(host, view(s), { context });
    host.compute(W, H);
    try {
      await check();
    } finally {
      unmount();
    }
    host.flush();
    assert.equal(host.root.firstChild, null, 'unmounting leaves nothing');
  };

  // Toggle, Switch and Checkbox: state held, shared as a signal, or only asked for.
  {
    const s = shared();
    await run(views.toggles, s, async () => {
      const { toggle, switch: sw, thumb, off, box, fixed } = s.refs;
      assert.equal(toggle.tag, 'button');
      assert.equal(attr(toggle, 'class'), 'bui-toggle mine', 'the user class is added');
      assert.equal(has(toggle, 'data-pressed'), false);
      toggle.click();
      assert.equal(has(toggle, 'data-pressed'), true);
      assert.equal(attr(toggle, 'aria-pressed'), 'true');
      assert.deepEqual(s.log, ['pressed:true', 'click'], 'the part acts, then the user handler');
      // A switch holding a signal that is shared both ways.
      assert.equal(attr(sw, 'role'), 'switch');
      assert.equal(has(sw, 'data-unchecked'), true);
      assert.equal(has(thumb, 'data-unchecked'), true);
      sw.click();
      assert.equal(s.flag.get(), true, 'the click wrote the user signal');
      assert.equal(has(sw, 'data-checked'), true);
      assert.equal(has(sw, 'data-unchecked'), false);
      assert.equal(attr(sw, 'aria-checked'), 'true');
      assert.equal(has(thumb, 'data-checked'), true);
      s.flag.set(false);
      assert.equal(has(sw, 'data-unchecked'), true, 'and the user signal moves it');
      // Keyboard: focus, Space and Enter.
      sw.focus();
      tap(' ');
      assert.equal(s.flag.get(), true, 'Space');
      tap('Enter');
      assert.equal(s.flag.get(), false, 'and Enter');
      assert.deepEqual(
        s.log.slice(2),
        ['switch:true', 'switch:true', 'switch:false'],
        'the user writing the signal is not reported back to the user',
      );
      // A read-only one keeps its value.
      s.refs.locked.click();
      assert.equal(has(s.refs.locked, 'data-checked'), true, 'a read-only switch stays checked');
      // A disabled one does nothing, and says so.
      s.log.length = 0;
      assert.equal(has(off, 'data-checked'), true);
      assert.equal(has(off, 'data-disabled'), true);
      assert.equal(host.input.isDisabled(off), true, 'the built-in disabled state follows');
      off.click();
      assert.equal(has(off, 'data-checked'), true);
      // A checkbox: indeterminate first, which a click settles as checked.
      assert.equal(has(box, 'data-unchecked'), true);
      assert.equal(host.root.firstChild !== null, true);
      assert.deepEqual(
        s.refs.tick.childNodes.filter((n) => n instanceof HostElement),
        [],
        'no mark yet',
      );
      box.click();
      assert.equal(has(box, 'data-checked'), true);
      assert.equal(
        s.refs.tick.childNodes.filter((n) => n instanceof HostElement).length,
        1,
        'the mark is built',
      );
      box.click();
      assert.equal(has(box, 'data-unchecked'), true);
      assert.equal(
        s.refs.tick.childNodes.filter((n) => n instanceof HostElement).length,
        0,
        'and taken away',
      );
      s.value.set('mixed');
      assert.equal(has(box, 'data-indeterminate'), true);
      assert.equal(attr(box, 'aria-checked'), 'mixed');
      assert.equal(
        s.refs.tick.childNodes.filter((n) => n instanceof HostElement).length,
        1,
        'shown while mixed',
      );
      box.click();
      assert.equal(
        has(box, 'data-indeterminate'),
        true,
        'a click does not clear what the user holds',
      );
      s.value.set('one');
      assert.equal(
        has(box, 'data-checked'),
        true,
        'it was checked by the click, and shows when clear',
      );
      // A pressed value that is only read: a click asks, nothing changes until the user does.
      assert.equal(has(fixed, 'data-pressed'), false);
      fixed.click();
      assert.deepEqual(s.log, ['ask:true']);
      assert.equal(has(fixed, 'data-pressed'), false, 'the user decides');
      s.flag.set(true);
      assert.equal(has(fixed, 'data-pressed'), true);
    });
  }

  // Collapsible: the trigger toggles; the panel is built only while open unless kept.
  {
    const s = shared();
    await run(views.collapsible, s, async () => {
      const { root, trigger, panel, kept } = s.refs;
      assert.equal(has(root, 'data-closed'), true);
      assert.equal(attr(trigger, 'aria-expanded'), 'false');
      assert.equal(has(panel, 'hidden'), true);
      assert.equal(
        panel.childNodes.filter((n) => n instanceof HostElement).length,
        0,
        'not built while closed',
      );
      trigger.click();
      assert.equal(s.flag.get(), true);
      assert.equal(has(root, 'data-open'), true);
      assert.equal(has(trigger, 'data-panel-open'), true);
      assert.equal(attr(trigger, 'aria-expanded'), 'true');
      assert.equal(has(panel, 'hidden'), false);
      assert.equal(panel.textContent, 'Hidden until open');
      host.compute(W, H);
      assert.ok(panel.bounds()[3] > 0, 'open, it has height');
      trigger.click();
      host.flush();
      host.compute(W, H);
      host.layout.tickMotion((clock += 1));
      host.layout.tickMotion((clock += 60));
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(panel.textContent, 'Hidden until open', 'it is seen folding away');
      await exit();
      assert.equal(
        panel.childNodes.filter((n) => n instanceof HostElement).length,
        0,
        'and goes when closed',
      );
      assert.deepEqual(s.log, ['open:true', 'open:false']);
      assert.equal(kept.textContent, 'Kept', 'a kept panel is built');
      assert.equal(has(kept, 'hidden'), false);
    });
  }

  // Accordion: one open at a time, keys among the enabled triggers, shared values.
  {
    const s = shared();
    await run(views.accordion, s, async () => {
      const { root, 'trigger-a': a, 'trigger-b': b, 'trigger-c': c } = s.refs;
      assert.equal(attr(root, 'class'), 'bui-accordion');
      assert.equal(has(b, 'data-disabled'), true);
      a.click();
      assert.deepEqual(s.list.get(), ['a']);
      assert.equal(s.refs['panel-a'].textContent, 'Body a');
      assert.equal(attr(a, 'aria-expanded'), 'true');
      c.click();
      assert.deepEqual(s.list.get(), ['c'], 'opening another closes the first');
      await exit();
      assert.equal(s.refs['panel-a'].textContent, '');
      b.click();
      assert.deepEqual(s.list.get(), ['c'], 'a disabled item does not open');
      s.list.set(['a']);
      await exit();
      assert.equal(s.refs['panel-a'].textContent, 'Body a', 'the user value moves it');
      assert.deepEqual(s.log, ['a', 'c']);
      // Arrow keys skip what is disabled, and wrap.
      a.focus();
      tap('ArrowDown');
      assert.equal(host.input.focused, c, 'down from a lands on c, past the disabled b');
      tap('ArrowDown');
      assert.equal(host.input.focused, a, 'and wraps');
      tap('ArrowUp');
      assert.equal(host.input.focused, c);
      tap('Home');
      assert.equal(host.input.focused, a);
      tap('End');
      assert.equal(host.input.focused, c);
    });
  }
  {
    const s = shared();
    await run(views.multiple, s, async () => {
      const { 'trigger-x': x, 'trigger-y': y } = s.refs;
      assert.equal(attr(x, 'aria-expanded'), 'true', 'defaultValue opens it');
      y.click();
      assert.equal(attr(x, 'aria-expanded'), 'true');
      assert.equal(attr(y, 'aria-expanded'), 'true', 'several may be open');
      x.click();
      assert.equal(attr(x, 'aria-expanded'), 'false');
    });
  }

  // Tabs: chosen by click and key, roving tab index, panels follow, disabled skipped.
  for (const activate of [false, true]) {
    const s = shared();
    s.flag.set(activate);
    await run(views.tabs, s, async () => {
      const { root, list, one, two, three, four } = s.refs;
      assert.equal(attr(root, 'data-orientation'), 'horizontal');
      assert.equal(attr(list, 'role'), 'tablist');
      assert.equal(has(one, 'data-active'), true);
      assert.equal(attr(one, 'tabindex'), '0');
      assert.equal(attr(three, 'tabindex'), '-1', 'only the chosen tab is in the tab order');
      assert.equal(attr(three, 'aria-selected'), 'false');
      assert.equal(s.refs['panel-one'].textContent, 'First');
      assert.equal(s.refs['panel-three'].textContent, '');
      assert.equal(has(s.refs['panel-three'], 'hidden'), true);
      one.focus();
      tap('ArrowRight');
      assert.equal(host.input.focused, three, 'the disabled tab is skipped');
      assert.equal(
        s.value.get(),
        activate ? 'three' : 'one',
        'focus chooses only with activateOnFocus',
      );
      if (!activate) {
        tap('Enter');
      }
      assert.equal(s.value.get(), 'three');
      assert.equal(has(three, 'data-active'), true);
      assert.equal(attr(three, 'tabindex'), '0');
      assert.equal(s.refs['panel-three'].textContent, 'Third');
      assert.equal(s.refs['panel-one'].textContent, '');
      tap('ArrowRight');
      assert.equal(host.input.focused, four);
      tap('ArrowLeft');
      assert.equal(host.input.focused, three, 'Left goes back');
      tap('ArrowLeft');
      assert.equal(host.input.focused, one, 'past the disabled tab');
      tap('ArrowLeft');
      assert.equal(host.input.focused, four, 'and wraps');
      tap('ArrowRight');
      assert.equal(host.input.focused, one, 'Right wraps too');
      tap('End');
      assert.equal(host.input.focused, four);
      tap('Home');
      assert.equal(host.input.focused, one);
      two.click();
      assert.equal(s.value.get(), activate ? 'one' : 'three', 'a disabled tab is not chosen');
      s.value.set('three');
      assert.equal(has(three, 'data-active'), true, 'the user value moves it');
    });
  }
  {
    const s = shared();
    await run(views.uncontrolledTabs, s, async () => {
      const { root, a, b } = s.refs;
      assert.equal(attr(root, 'data-orientation'), 'vertical');
      assert.equal(has(a, 'data-active'), true, 'the first tab is chosen with no value given');
      a.focus();
      tap('ArrowDown');
      assert.equal(host.input.focused, b, 'vertical tabs go by Up and Down');
      tap('ArrowRight');
      assert.equal(host.input.focused, b, 'and not by Right');
      b.click();
      assert.equal(has(b, 'data-active'), true);
      assert.equal(has(a, 'data-active'), false);
    });
  }

  assert.deepEqual(errors, [], String(errors));
  state.dispose();
} finally {
  host.dispose();
  context.dispose();
}
console.log('Base UI components: toggles, collapsible, accordion and tabs passed');
