// The Base UI parts drawn with the theme's sheet, in both schemes.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
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
import { showcase } from '../dist/scene/base-ui-showcase.js';

const native = loadNative();
const W = 480;
const H = 440;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../../.blinc/base-ui/', import.meta.url);
await mkdir(output, { recursive: true });

/** The rgb of the pixel at (x, y). */
const at = (pixels, x, y) => {
  const i = (Math.round(y) * W + Math.round(x)) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2]];
};
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

try {
  for (const scheme of ['light', 'dark']) {
    const context = native.createReactive();
    const host = Host.create(native);
    try {
      const errors = [];
      host.onStyleErrors((e) => errors.push(...e));
      const state = new ThemeState(context, baseUiTheme, { scheme });
      state.attach(host.layout);
      addUserAgent(host.layout);
      addBaseUi(host.layout);
      const s = { tab: context.signal('overview'), refs: {} };
      const unmount = mount(host, showcase(s), { context });
      await host.images.idle();
      let clock = 0;
      const settle = () => {
        for (let i = 0; i < 2; i++) {
          host.flush();
          host.compute(W, H);
          host.layout.tickMotion((clock += 1));
          host.layout.tickMotion((clock += 2000));
          host.compute(W, H);
        }
      };
      settle();
      const draw = async () => {
        host.compute(W, H);
        const renderer = new SceneRenderer(target.device, host.layout);
        try {
          renderer.useImages(host.images.library);
          const pixels = new Uint8Array(W * H * 4);
          await target.captureCommandsInto(
            pixels,
            (encoder, view) =>
              renderer.encode(encoder, host.root.layoutNode, view, {
                width: W,
                height: H,
                scale: 1,
              }).drawCalls,
          );
          return pixels;
        } finally {
          renderer.dispose();
        }
      };
      const pixels = await draw();
      await writeFile(
        new URL(`showcase-${scheme}.png`, output),
        PNG.sync.write({ width: W, height: H, data: Buffer.from(pixels) }),
      );

      // A switch's thumb sits at the end its state names, inside the track.
      const [ox, , ow] = s.refs.off.bounds();
      const [tx, , tw] = s.refs['off-thumb'].bounds();
      assert.ok(tx >= ox && tx - ox <= 5, `off: the thumb is at the start (${tx - ox})`);
      assert.ok(tx + tw <= ox + ow, 'and inside');
      const [nx, ny, nw, nh] = s.refs.on.bounds();
      assert.equal(s.refs['on-thumb'].hasAttribute('data-checked'), true);
      // The thumb of one that is on has slid to the end: a transform, so it is the pixels that show it.
      const start = luma(at(pixels, nx + 7, ny + nh / 2));
      const end = luma(at(pixels, nx + nw - 8, ny + nh / 2));
      assert.ok(Math.abs(start - end) > 90, `on: the thumb is at the end (${start} vs ${end})`);

      // The track of one that is on is the ink and the other is not: the contrast is the state.
      const on = start;
      const off = luma(at(pixels, ox + ow - 4, ny + nh / 2));
      assert.ok(Math.abs(on - off) > 90, `on and off tracks differ (${on} vs ${off})`);
      // A checked box is filled with the ink, and an unchecked one is not.
      const [cx, cy] = s.refs.checked.bounds();
      const [ex, ey] = s.refs.unchecked.bounds();
      assert.ok(Math.abs(luma(at(pixels, cx + 2, cy + 2)) - luma(at(pixels, ex + 2, ey + 2))) > 90);
      // The indicator is under the chosen tab, and not the other.
      const [ax, ay, aw, ah] = s.refs.overview.bounds();
      const [bx, by, bw] = s.refs.api.bounds();
      const rule = luma(at(pixels, ax + aw / 2, ay + ah - 1));
      const none = luma(at(pixels, bx + bw / 2, by + ah - 1));
      assert.ok(Math.abs(rule - none) > 60, `the chosen tab is underlined (${rule} vs ${none})`);

      // Choosing another moves it: it eases there, so it is between at first, and under it after.
      s.tab.set('api');
      host.flush();
      host.compute(W, H);
      host.layout.tickMotion((clock += 1));
      host.layout.tickMotion((clock += 60));
      const between = await draw();
      const under = (pixelsOf) => luma(at(pixelsOf, bx + bw / 2, by + ah - 1));
      settle();
      const after = await draw();
      assert.ok(Math.abs(under(after) - none) > 60, 'it moved under the other tab');
      assert.ok(!Buffer.from(between).equals(Buffer.from(after)), 'it was still on its way');
      assert.ok(!Buffer.from(between).equals(Buffer.from(pixels)), 'and had left where it was');
      // What is only a place to press lies flat, whatever the user-agent sheet gives a button: the
      // pixel under it is the one over it, where a shadow would have darkened it.
      for (const name of ['off', 'unchecked', 'first']) {
        const [ex, ey, ew, eh] = s.refs[name].bounds();
        const under = at(pixels, ex + ew / 2, ey + eh + 1);
        const over = at(pixels, ex + ew / 2, ey - 2);
        assert.deepEqual(under, over, `${scheme}: ${name} stands on no shadow`);
      }
      // A line of tabs is flat as well: nothing beside an inactive one but the bar's ground.
      {
        const [ex, ey, , eh] = s.refs.api.bounds();
        assert.deepEqual(
          at(pixels, ex - 2, ey + eh / 2),
          at(pixels, ex + 4, ey - 2),
          `${scheme}: an inactive tab has no shadow or corner of its own`,
        );
      }
      // Hover and press change a part a little and never turn it into something else: what a pointer
      // over it shows is its own fill, not the user-agent's for a button. A tab has none to change,
      // since what slides under the chosen one is what marks it.
      {
        const sampleAt = (frame, element) => {
          const [ex, ey, , eh] = element.bounds();
          return luma(at(frame, ex + 4, ey + eh / 2));
        };
        const mostly = new Map([
          ['first', 3],
          ['api', 3],
          ['bold', 90],
          ['details', 90],
          ['styled', 90],
          ['off', 110],
          ['unchecked', 90],
        ]);
        const away = () => host.input.pointerMove(W - 2, H - 2);
        for (const [name, allowed] of mostly) {
          away();
          settle();
          const rest = sampleAt(await draw(), s.refs[name]);
          const [ex, ey, ew, eh] = s.refs[name].bounds();
          host.input.pointerMove(ex + ew / 2, ey + eh / 2);
          settle();
          const hovered = sampleAt(await draw(), s.refs[name]);
          host.input.pointerDown();
          settle();
          const pressed = sampleAt(await draw(), s.refs[name]);
          host.input.pointerUp();
          assert.ok(
            Math.abs(hovered - rest) <= allowed,
            `${scheme}: ${name} hovered goes from ${rest} to ${hovered}`,
          );
          assert.ok(
            Math.abs(pressed - rest) <= allowed,
            `${scheme}: ${name} pressed goes from ${rest} to ${pressed}`,
          );
        }
        away();
        settle();
      }
      // The theme's shape reaches the parts: with smoothing off, an accordion's corner is a circle's.
      const [gx, gy] = s.refs.accordion.bounds();
      const corner = (frame) => {
        const patch = [];
        for (let dy = 0; dy < 6; dy++) {
          for (let dx = 0; dx < 6; dx++) {
            patch.push(luma(at(frame, gx + dx, gy + dy)));
          }
        }
        return patch;
      };
      const smooth = corner(await draw());
      state.override({ shape: { cornerSmoothing: 0 } });
      settle();
      const round = corner(await draw());
      assert.notDeepEqual(smooth, round, `${scheme}: smoothing changes a part's corner`);
      state.override({ shape: {} });
      assert.deepEqual(errors, [], String(errors));
      unmount();
      state.dispose();
    } finally {
      host.dispose();
      context.dispose();
    }
  }
} finally {
  target.dispose();
}
console.log('Base UI showcase: both schemes, switch thumbs, checks and tab underline passed');
