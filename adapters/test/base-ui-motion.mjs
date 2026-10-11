// The small movements: a chevron turns, a knob slides, a pill follows the tab, a mark pops, a
// panel is revealed. Each is caught part of the way, which is neither where it was nor where it
// is going.
import assert from 'node:assert/strict';
import { loadNative } from 'blinc_ts/native';
import { Host } from 'blinc_ts/native/host';
import { OffscreenRenderer } from 'blinc_ts/native/offscreen';
import { SceneRenderer } from 'blinc_ts/native/renderer';
import { probeShader } from 'blinc_ts/shaders';
import { ThemeState } from 'blinc_ts/theme';
import { addUserAgent } from 'blinc_ts/theme/user-agent';
import { mount } from '../dist/jsx/jsx-runtime.js';
import { baseUiTheme } from '../dist/base-ui/theme.js';
import { addBaseUi } from '../dist/base-ui/sheet.js';
import { motion } from '../dist/scene/base-ui-motion.js';

const native = loadNative();
const W = 400;
const H = 360;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const context = native.createReactive();
const host = Host.create(native);
try {
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  const state = new ThemeState(context, baseUiTheme, { scheme: 'light' });
  state.attach(host.layout);
  addUserAgent(host.layout);
  addBaseUi(host.layout);
  // What else eases as these change is held still, so only the movement under test is seen.
  host.layout.addStyleSheet(`
    .bui-chevron, [data-panel-open] > .bui-chevron { color: var(--text-primary); }
    .bui-switch, .bui-switch:hover, .bui-switch[data-checked] { background: var(--primary); border-color: var(--primary); }
    .bui-checkbox, .bui-checkbox:hover, .bui-checkbox[data-checked] { background: var(--primary); border-color: var(--primary); }
    .bui-tabs-tab, .bui-tabs-tab[data-active] { transition: none; }
  `);
  const refs = {};
  mount(host, motion(refs), { context });
  await host.images.idle();
  let clock = 0;
  const settle = () => {
    for (let i = 0; i < 3; i++) {
      host.flush();
      host.compute(W, H);
      host.layout.tickMotion((clock += 1));
      host.layout.tickMotion((clock += 3000));
      host.compute(W, H);
    }
  };
  const draw = async () => {
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
      return pixels;
    } finally {
      renderer.dispose();
    }
  };
  /** The pixels of a box `[x, y, w, h]`, grown by `grow`, as one string to compare. */
  const patch = (pixels, [x, y, w, h], grow = 2) => {
    const rows = [];
    for (let row = Math.floor(y - grow); row < Math.ceil(y + h + grow); row++) {
      const from = (row * W + Math.floor(x - grow)) * 4;
      rows.push(
        Buffer.from(pixels.subarray(from, from + Math.ceil(w + 2 * grow) * 4)).toString('hex'),
      );
    }
    return rows.join('');
  };
  /**
   * Change something, and see the box `watch` (an element's, as it is now, held while it moves)
   * before the change, partway after `part` ms, and when it is done: all three differ.
   */
  const caught = async (name, watch, change, part = 70) => {
    settle();
    const box = Array.isArray(watch) ? watch : watch.bounds();
    const before = patch(await draw(), box);
    change();
    host.flush();
    host.compute(W, H);
    host.layout.tickMotion((clock += 1));
    host.layout.tickMotion((clock += part));
    const between = patch(await draw(), box);
    host.layout.tickMotion((clock += 3000));
    const after = patch(await draw(), box);
    // Compared as text, but said without it: a frame's worth of pixels is no message.
    assert.ok(between !== before, `${name}: it has left where it was`);
    assert.ok(between !== after, `${name}: it is still on its way`);
    assert.ok(after !== before, `${name}: it got there`);
  };

  const chevron = () => refs.trigger.lastChild;
  await caught('a chevron turns over', chevron(), () => refs.trigger.click());
  await caught('and turns back', chevron(), () => refs.trigger.click());
  await caught('a switch slides its knob', refs.switch, () => refs.switch.click());
  await caught('and slides it back', refs.switch, () => refs.switch.click());
  await caught('a checkbox mark pops in', refs.checkbox, () => refs.checkbox.click(), 30);
  await caught('and out', refs.checkbox, () => refs.checkbox.click(), 30);
  await caught('a pill follows the chosen tab', refs.tray, () => refs.b.click());
  await caught('and goes back', refs.tray, () => refs.a.click());
  // A panel is revealed and folded away by its size easing: it is seen part of its height, in the
  // strip from its top to below what follows it.
  const [bx, by, bw, bh] = refs.below.bounds();
  const top = refs.panel.bounds()[1];
  const strip = [bx, top, bw, by - top + bh + 80];
  await caught('a panel is revealed', strip, () => refs.trigger.click());
  await caught('and folded away', strip, () => refs.trigger.click());

  assert.deepEqual(errors, [], String(errors));
  state.dispose();
} finally {
  host.dispose();
  context.dispose();
  target.dispose();
}
console.log('Base UI motion: chevron, knob, mark, pill and panel each ease between their states');
