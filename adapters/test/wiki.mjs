// The wiki: every page renders, the navigation and the examples work, in both schemes.
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
import { jsx, mount } from '../dist/jsx/jsx-runtime.js';
import { baseUiTheme } from '../dist/base-ui/theme.js';
import { addBaseUi } from '../dist/base-ui/sheet.js';
import { addWikiSheet } from '../dist/wiki/sheet.js';
import { pages } from '../dist/wiki/pages.js';
import { Wiki } from '../dist/wiki/wiki.js';
import { buttonNamed, findAll, windowed } from './wiki-driver.mjs';

const native = loadNative();
const W = 1100;
const H = 760;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../../.blinc/wiki/', import.meta.url);
await mkdir(output, { recursive: true });

async function open(scheme) {
  const context = native.createReactive();
  const host = Host.create(native);
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e.map(String)));
  const theme = new ThemeState(context, baseUiTheme, { scheme });
  theme.attach(host.layout);
  addUserAgent(host.layout);
  addBaseUi(host.layout);
  addWikiSheet(host.layout);
  const page = context.signal(pages[0].id);
  const unmount = mount(host, jsx(Wiki, { theme, page }), { context });
  let clock = 0;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      host.flush();
      host.compute(W, H);
      host.layout.tickMotion((clock += 1));
      host.layout.tickMotion((clock += 2000));
      host.compute(W, H);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await host.images.idle();
    host.flush();
    host.compute(W, H);
  };
  const draw = async (name) => {
    await settle();
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
      if (name) {
        await writeFile(
          new URL(`${name}.png`, output),
          PNG.sync.write({ width: W, height: H, data: Buffer.from(pixels) }),
        );
      }
      return pixels;
    } finally {
      renderer.dispose();
    }
  };
  const close = () => {
    unmount();
    theme.dispose();
    host.dispose();
    context.dispose();
  };
  return { context, host, theme, page, errors, settle, draw, close };
}

try {
  // Every page renders, in light, with nothing the stylesheet could not read.
  {
    const wiki = await open('light');
    try {
      for (const entry of pages) {
        wiki.page.set(entry.id);
        const pixels = await wiki.draw(`page-${entry.id}`);
        const main = wiki.host.root.firstChild?.nextSibling;
        assert.ok(main, 'the wiki is mounted');
        // A link that is not the page shown is flat: the pixel under it is the one over it.
        const links = [...wiki.host.root.childNodes].length && findAll(wiki.host.root, 'wiki-link');
        const inactive = links.find((l) => !l.hasAttribute('data-active') && l.bounds()[1] > 60);
        const [lx, ly, lw, lh] = inactive.bounds();
        const at = (x, y) => [
          ...pixels.subarray(
            (Math.round(y) * W + Math.round(x)) * 4,
            (Math.round(y) * W + Math.round(x)) * 4 + 3,
          ),
        ];
        assert.deepEqual(
          at(lx + lw / 2, ly + lh + 1),
          at(lx + lw / 2, ly - 1),
          `${entry.id}: a link beside the page stands on no shadow`,
        );
      }
      assert.deepEqual(wiki.errors, []);
    } finally {
      wiki.close();
    }
  }
  // The header is fixed with the theme switch in it, whatever the page does under it.
  {
    const wiki = await open('light');
    try {
      const { host } = wiki;
      wiki.page.set('forms');
      await wiki.draw();
      const header = findAll(host.root, 'wiki-header')[0];
      const main = findAll(host.root, 'wiki-main')[0];
      const toggle = findAll(host.root, 'bui-switch')[0];
      assert.ok(header && toggle, 'the wiki has a header with a switch in it');
      const [, hy, hw, hh] = header.viewBounds();
      assert.equal(hy, 0, 'the header is at the top');
      assert.equal(hw, W, 'across the window');
      const [, ty] = toggle.viewBounds();
      assert.ok(ty >= 0 && ty + toggle.bounds()[3] <= hh, 'and the theme switch is in it');
      main.scrollBy(0, 300);
      await wiki.draw();
      assert.ok(main.scrollTop > 0, 'the page scrolled');
      assert.equal(header.viewBounds()[1], 0, 'the header did not');
      assert.ok(toggle.viewBounds()[1] >= 0, 'nor the switch');
      // A press on the switch changes the scheme, and the window with it.
      const luma = (pixels, x, y) => {
        const i = (Math.round(y) * W + Math.round(x)) * 4;
        return pixels[i] + pixels[i + 1] + pixels[i + 2];
      };
      const light = await wiki.draw();
      const [sx, sy, sw, sh] = toggle.viewBounds();
      host.input.pointerMove(sx + sw / 2, sy + sh / 2);
      host.input.pointerDown();
      host.input.pointerUp();
      assert.equal(wiki.theme.preference, 'dark', 'the switch set the dark scheme');
      const dark = await wiki.draw();
      assert.ok(luma(light, W - 40, 400) > luma(dark, W - 40, 400) + 300, 'and the page went dark');
    } finally {
      wiki.close();
    }
  }

  // A user's session, frame by frame as a window runs them: a frame follows each event at once, so
  // what an event changed is still queued when it begins. Clicking through the reactive page is
  // what crashed a window.
  {
    const wiki = await open('light');
    try {
      const { host } = wiki;
      const { frame, press } = windowed(host, target, W, H);
      const named = (text) => buttonNamed(host.root, text);
      await frame();
      await press(named('The JSX adapter'));
      assert.equal(wiki.page.get(), 'jsx-adapter');
      const readout = () => findAll(host.root, 'wiki-readout')[0].textContent;
      assert.equal(readout(), '0 doubled is 0');
      for (let n = 1; n <= 4; n++) {
        await press(named('Count'));
        assert.equal(readout(), `${n} doubled is ${n * 2}`);
      }
      await press(named('Add'));
      await press(named('Reverse'));
      await press(named('Remove first'));
      const list = findAll(host.root, 'wiki-page')[0];
      // Two items were added and reversed and one removed: the first of what is left is first.
      assert.match(list.textContent, /Two, number 1One, number 2/);
      // The pages of adapters work: one written by hand, one from data, and Vue's, on the same host.
      wiki.page.set('writing');
      await frame();
      const readouts = () => findAll(host.root, 'wiki-readout').map((e) => e.textContent);
      assert.deepEqual(readouts(), ['0 clicks']);
      await press(named('Click me'));
      await press(named('Click me'));
      assert.deepEqual(readouts(), ['2 clicks'], 'hyperscript, updated by hand');
      const steps = () => findAll(host.root, 'wiki-col')[0].textContent;
      assert.match(steps(), /Add a stepWrite a specRender it$/);
      await press(named('Add a step'));
      assert.match(
        steps(),
        /Add a stepWrite a specRender itStep 3$/,
        'a view from data, drawn again',
      );
      wiki.page.set('vue-adapter');
      await frame();
      assert.deepEqual(readouts(), ['count = 0']);
      for (let i = 0; i < 3; i++) {
        await press(named('Count in Vue'));
      }
      assert.deepEqual(readouts(), ['count = 3'], "Vue's renderer, driving this host");
      assert.deepEqual(wiki.errors, []);
    } finally {
      wiki.close();
    }
  }
  // Knobs are where they belong the moment a page is built, and do not fly in from where layout had
  // them while the page settled.
  {
    const wiki = await open('light');
    try {
      const { host } = wiki;
      const { frame, pixels } = windowed(host, target, W, H);
      await frame();
      wiki.page.set('toggles');
      await frame();
      const [thumb] = findAll(host.root, 'bui-switch-thumb');
      const [track] = findAll(host.root, 'bui-switch');
      const luma = (x, y) => {
        const i = (Math.round(y) * W + Math.round(x)) * 4;
        return pixels[i] + pixels[i + 1] + pixels[i + 2];
      };
      const [tx, ty, tw, th] = thumb.bounds();
      // That switch is on: its knob is at the right end, light on the dark track that shows at the left.
      const [rx, ,] = track.bounds();
      assert.ok(
        luma(tx + tw / 2, ty + th / 2) > luma(rx + 5, ty + th / 2) + 300,
        'the knob is drawn where it is, in the first frame of its page',
      );
    } finally {
      wiki.close();
    }
  }
  // Back from the source tab, the knobs are where they were and do not fly in from the panel's
  // hiding, a frame at a time as a window draws them.
  {
    const wiki = await open('light');
    try {
      const { host } = wiki;
      const { frame, settle, pixels } = windowed(host, target, W, H);
      await frame();
      wiki.page.set('toggles');
      await settle();
      const knobs = () =>
        findAll(host.root, 'bui-switch')
          .slice(0, 2)
          .map((track) => {
            const [tx, ty, tw, th] = track.viewBounds();
            let sum = 0;
            let count = 0;
            for (let y = Math.round(ty) + 2; y < Math.round(ty + th) - 2; y++) {
              for (let x = Math.round(tx) + 2; x < Math.round(tx + tw) - 2; x++) {
                const i = (y * W + x) * 4;
                if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 650) {
                  sum += x - tx;
                  count++;
                }
              }
            }
            return count ? (sum / count).toFixed(1) : 'none';
          })
          .join(' ');
      const rest = knobs();
      assert.ok(!rest.includes('none'), `the knobs are drawn: ${rest}`);
      const click = async (name) => {
        const [x, y, w, h] = buttonNamed(host.root, name).viewBounds();
        host.input.pointerMove(x + w / 2, y + h / 2);
        await frame();
        host.input.pointerDown();
        await frame();
        host.input.pointerUp();
      };
      for (let round = 0; round < 2; round++) {
        await click('Source');
        await settle();
        await click('Preview');
        for (let n = 0; n < 40; n++) {
          await frame();
          assert.equal(knobs(), rest, `round ${round}, frame ${n}: the knobs are at rest`);
        }
      }
    } finally {
      wiki.close();
    }
  }
} finally {
  target.dispose();
}
console.log('Wiki: pages rendered');
