// The Base UI overlays: a tooltip, a popover and a dialog in the top layer.
import assert from 'node:assert/strict';
import { loadNative } from 'blinc_ts/native';
import { Host } from 'blinc_ts/native/host';
import { TopLayer } from 'blinc_ts/native/top-layer';
import { ThemeState } from 'blinc_ts/theme';
import { addUserAgent } from 'blinc_ts/theme/user-agent';
import { mount } from '../dist/jsx/jsx-runtime.js';
import { baseUiTheme } from '../dist/base-ui/theme.js';
import * as views from '../dist/scene/base-ui-overlays.js';

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
  const layer = TopLayer.of(host);
  const shared = (delay = 0) => ({
    open: context.signal(false),
    text: context.signal('Tip'),
    delay,
    log: [],
    refs: {},
  });
  const has = (e, name) => e.hasAttribute(name);
  const tap = (key) => {
    host.input.keyDown({ key });
    host.input.keyUp({ key });
  };
  let clock = 0;
  /** Lay out, run motion to its end, and let the promises of closing entries settle. */
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      host.flush();
      host.compute(W, H);
      host.layout.tickMotion((clock += 1));
      host.layout.tickMotion((clock += 2000));
      host.compute(W, H);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  const run = async (view, s, check) => {
    const unmount = mount(host, view(s), { context });
    await settle();
    try {
      await check();
    } finally {
      unmount();
    }
    await settle();
    assert.equal(layer.entries.length, 0, 'unmounting closes what was open');
    assert.equal(host.root.firstChild, null, 'and leaves nothing');
  };
  const hover = (e) => {
    const [x, y, w, h] = e.bounds();
    host.input.pointerMove(x + w / 2, y + h / 2);
  };
  const press = (e) => {
    hover(e);
    host.input.pointerDown();
    host.input.pointerUp();
  };

  // Tooltip: opens on hover after its delay, above the trigger, and goes when the pointer does.
  {
    const s = shared(40);
    await run(views.tooltip, s, async () => {
      const { trigger } = s.refs;
      hover(trigger);
      await settle();
      assert.equal(layer.entries.length, 0, 'not before the delay');
      await new Promise((resolve) => setTimeout(resolve, 80));
      await settle();
      assert.equal(layer.entries.length, 1, 'open after it');
      const popup = layer.entries[0].content;
      assert.equal(popup.getAttribute('class'), 'bui-tooltip-popup');
      assert.equal(popup.getAttribute('role'), 'tooltip');
      assert.equal(popup.textContent, 'Tip');
      assert.equal(has(trigger, 'data-popup-open'), true);
      const [tx, ty, tw] = trigger.viewBounds();
      const [px, py, pw, ph] = popup.viewBounds();
      assert.ok(py + ph <= ty + 1, `above the trigger (${py + ph} <= ${ty})`);
      assert.ok(Math.abs(px + pw / 2 - (tx + tw / 2)) < 2, 'centred on it');
      assert.equal(popup.getAttribute('data-side'), 'top');
      s.text.set('Changed');
      assert.equal(popup.textContent, 'Changed', 'what it holds follows its sources');
      host.input.pointerMove(W - 1, H - 1);
      await settle();
      assert.equal(layer.entries.length, 0, 'it goes with the pointer');
      assert.deepEqual(s.log, ['tip:true', 'tip:false']);
      assert.equal(popup.destroyed, true, 'and what it made is gone once it has');
      s.text.set('After');
    });
  }
  {
    const s = shared(0);
    await run(views.tooltip, s, async () => {
      const { trigger } = s.refs;
      // Keyboard focus opens it at once; blur and Escape close it, and a press.
      tap('Tab');
      await settle();
      assert.equal(layer.entries.length, 1, 'keyboard focus opens it');
      trigger.blur();
      await settle();
      assert.equal(layer.entries.length, 0, 'blur closes it');
      tap('Tab');
      await settle();
      assert.equal(layer.entries.length, 1);
      tap('Escape');
      await settle();
      assert.equal(layer.entries.length, 0, 'Escape closes it');
      assert.equal(s.log.at(-1), 'tip:false', 'and the state follows');
      trigger.blur();
      trigger.focus();
      await settle();
      assert.equal(layer.entries.length, 0, 'a script focusing it, or a press, does not');
      trigger.blur();
      hover(trigger);
      await settle();
      assert.equal(layer.entries.length, 1);
      host.input.pointerDown();
      host.input.pointerUp();
      await settle();
      assert.equal(layer.entries.length, 0, 'a press on the trigger closes it');
    });
  }

  // Popover: a click opens it, focus moves in, and it closes by Escape, outside and Close.
  {
    const s = shared();
    await run(views.popover, s, async () => {
      const { trigger } = s.refs;
      assert.equal(has(trigger, 'aria-expanded') && trigger.getAttribute('aria-expanded'), 'false');
      press(trigger);
      await settle();
      assert.equal(s.open.get(), true, 'the click wrote the user signal');
      assert.equal(layer.entries.length, 1);
      const popup = layer.entries[0].content;
      assert.equal(popup.getAttribute('class'), 'bui-popover-popup');
      assert.equal(trigger.getAttribute('aria-expanded'), 'true');
      assert.equal(popup.textContent.replace(/\s/g, ''), 'TitleTipInnerClose');
      const focused = host.input.focused;
      assert.ok(
        focused && (focused === popup || popup.contains?.(focused) !== false),
        'focus is in it',
      );
      assert.equal(focused, s.refs.inner, 'on its first control');
      const [tx, ty, , th] = trigger.viewBounds();
      const [px, py] = popup.viewBounds();
      assert.ok(py >= ty + th - 1, 'below the trigger');
      assert.ok(Math.abs(px - tx) < 2, 'aligned to its start');
      tap('Escape');
      await settle();
      assert.equal(layer.entries.length, 0);
      assert.equal(s.open.get(), false, 'Escape wrote the signal');
      assert.equal(host.input.focused, trigger, 'focus went back to the trigger');
      s.open.set(true);
      await settle();
      assert.equal(layer.entries.length, 1, 'the user signal opens it');
      host.input.pointerMove(W - 2, H - 2);
      host.input.pointerDown();
      host.input.pointerUp();
      await settle();
      assert.equal(layer.entries.length, 0, 'a press outside closes it');
      assert.equal(s.open.get(), false);
      s.open.set(true);
      await settle();
      press(s.refs.close);
      await settle();
      assert.equal(layer.entries.length, 0, 'Close closes it');
      assert.deepEqual(
        s.log,
        ['popover:true', 'popover:false', 'popover:false', 'popover:false'],
        'the part reports what it changed, not what the user wrote',
      );
      s.open.set(true);
      await settle();
      assert.equal(layer.entries.length, 1);
    });
  }

  // Dialog: modal, focus kept inside, closed by Escape, the backdrop and Close.
  {
    const s = shared();
    await run(views.dialog, s, async () => {
      const { trigger, behind } = s.refs;
      press(trigger);
      await settle();
      assert.equal(s.open.get(), true);
      assert.equal(layer.entries.length, 1);
      const entry = layer.entries[0];
      assert.equal(entry.options.modal, true);
      const popup = entry.content;
      assert.equal(popup.getAttribute('role'), 'dialog');
      assert.equal(popup.getAttribute('aria-modal'), 'true');
      const inside = (e) => {
        for (let n = e; n; n = n.parentNode) {
          if (n === popup) {
            return true;
          }
        }
        return false;
      };
      assert.ok(inside(host.input.focused), 'focus moved into it');
      for (let i = 0; i < 4; i++) {
        tap('Tab');
        assert.ok(inside(host.input.focused), 'Tab stays inside it');
      }
      const [bx, by, bw, bh] = behind.viewBounds();
      host.input.pointerMove(bx + bw / 2, by + bh / 2);
      assert.notEqual(
        host.elementAt(bx + bw / 2, by + bh / 2),
        behind,
        'the page behind takes no presses',
      );
      tap('Escape');
      await settle();
      assert.equal(layer.entries.length, 0);
      assert.equal(s.open.get(), false);
      assert.equal(host.input.focused, trigger, 'focus went back');
      s.open.set(true);
      await settle();
      press(s.refs.close);
      await settle();
      assert.equal(layer.entries.length, 0, 'Close closes it');
      // Not dismissible: Escape and the backdrop leave it open, Close does not.
      s.text.set('locked');
      s.open.set(true);
      await settle();
      assert.equal(layer.entries[0].options.dismissible, false);
      tap('Escape');
      await settle();
      assert.equal(layer.entries.length, 1, 'Escape does not close it');
      host.input.pointerMove(W - 2, H - 2);
      host.input.pointerDown();
      host.input.pointerUp();
      await settle();
      assert.equal(layer.entries.length, 1, 'nor the backdrop');
      press(s.refs.close);
      await settle();
      assert.equal(layer.entries.length, 0);
      assert.deepEqual(s.log, ['dialog:true', 'dialog:false', 'dialog:false', 'dialog:false']);
    });
  }

  assert.deepEqual(errors, [], String(errors));
  state.dispose();
} finally {
  host.dispose();
  context.dispose();
}
console.log('Base UI overlays: tooltip, popover and dialog passed');
