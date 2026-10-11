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
import { addUtilities } from 'blinc_ts/theme/utilities';
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
  addUtilities(host.layout);
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
    const detach = host.canvases.attach(renderer);
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
      detach();
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
  // The calculator example changes a custom property and clamps the resulting width.
  {
    const wiki = await open('light');
    try {
      const { host } = wiki;
      wiki.page.set('css');
      await wiki.settle();
      const bar = findAll(host.root, 'math-bar')[0];
      assert.equal(bar.bounds()[2], 128);
      const { frame, press } = windowed(host, target, W, H);
      for (const [label, width] of [
        ['4rem', 64],
        ['12rem', 160],
        ['8rem', 128],
      ]) {
        const button = buttonNamed(host.root, label);
        const main = findAll(host.root, 'wiki-main')[0];
        main.scrollBy(0, button.viewBounds()[1] - 160);
        await frame();
        await press(button);
        assert.equal(bar.bounds()[2], width, `${label}: the expression updates and clamps`);
      }
      assert.deepEqual(wiki.errors, []);
    } finally {
      wiki.close();
    }
  }
  // Generated content follows reactive attributes and leaves authored JSX children intact.
  {
    const wiki = await open('light');
    try {
      wiki.page.set('css');
      await wiki.settle();
      const owner = findAll(wiki.host.root, 'generated-label')[0];
      const authored = owner.childNodes[0];
      assert.equal([...wiki.host.contentNodes(owner)][0].textContent, '[Ready]');
      findAll(wiki.host.root, 'generated-change')[0].click();
      await wiki.settle();
      assert.equal([...wiki.host.contentNodes(owner)][0].textContent, '[Done]');
      findAll(wiki.host.root, 'generated-hide')[0].click();
      await wiki.settle();
      assert.deepEqual([...wiki.host.contentNodes(owner)], [authored]);
      findAll(wiki.host.root, 'generated-hide')[0].click();
      await wiki.settle();
      assert.equal([...wiki.host.contentNodes(owner)].length, 3);
      assert.deepEqual(owner.childNodes, [authored]);
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
      const [track] = findAll(host.root, 'bui-switch');
      const luma = (x, y) => {
        const i = (Math.round(y) * W + Math.round(x)) * 4;
        return pixels[i] + pixels[i + 1] + pixels[i + 2];
      };
      // That switch is on: its knob is drawn at the right end, light on the dark track at the left.
      const [rx, ry, rw, rh] = track.bounds();
      const middle = ry + rh / 2;
      assert.ok(
        luma(rx + rw - rh / 2, middle) > luma(rx + rh / 2, middle) + 300,
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
      // Pressed, a knob slides across while its track's colour eases, frame by frame, and is not
      // drawn at its end at once.
      const first = () => Number(knobs().split(' ')[0]);
      const from = first();
      const [sx, sy, sw, sh] = findAll(host.root, 'bui-switch')[0].viewBounds();
      host.input.pointerMove(sx + sw / 2, sy + sh / 2);
      await frame();
      host.input.pointerDown();
      await frame();
      host.input.pointerUp();
      const drawn = [];
      for (let n = 0; n < 30; n++) {
        await frame();
        drawn.push(first());
      }
      const to = drawn.at(-1);
      assert.ok(Math.abs(to - from) > 10, `the knob went to the other end: ${from} to ${to}`);
      assert.ok(
        drawn.some((x) => Math.min(from, to) + 2 < x && x < Math.max(from, to) - 2),
        `and was drawn on its way: ${drawn.join(' ')}`,
      );
    } finally {
      wiki.close();
    }
  }
  // Closed in a window, a panel folds away with its content in it, frame by frame: the move starts
  // at the frame's layout, after the click, and what waits for it to end waits for it to begin.
  {
    const wiki = await open('light');
    try {
      const { host } = wiki;
      const { frame, settle, press } = windowed(host, target, W, H);
      await frame();
      wiki.page.set('disclosure');
      await settle();
      const panel = () => findAll(host.root, 'bui-collapsible-panel')[0];
      await press(buttonNamed(host.root, 'Show more'));
      assert.match(panel().textContent, /builds it only while it is open/, 'opened');
      const open = panel().bounds()[3];
      assert.ok(open > 0, 'with a height');
      const [x, y, w, h] = buttonNamed(host.root, 'Show more').viewBounds();
      host.input.pointerMove(x + w / 2, y + h / 2);
      await frame();
      host.input.pointerDown();
      await frame();
      host.input.pointerUp();
      await frame();
      await frame();
      assert.match(panel().textContent, /builds it only/, 'two frames into closing, it is there');
      await settle();
      assert.equal(panel().textContent, '', 'and once folded it is let go');
      assert.equal(panel().bounds()[3], 0, 'laid out at no height');
    } finally {
      wiki.close();
    }
  }
  // A dial changes what it shows and nothing else: the subject and the dials stay where they are
  // as the values, and the text of their readouts, change.
  {
    const wiki = await open('light');
    try {
      const { host } = wiki;
      const { frame, settle } = windowed(host, target, W, H);
      await frame();
      wiki.page.set('shape');
      await settle();
      const ranges = findAll(host.root, 'wiki-field').map((f) =>
        [...f.childNodes].find((n) => n.tag === 'input'),
      );
      assert.equal(ranges.length, 2, 'two dials');
      const subject = ranges[0].parentNode.parentNode.previousSibling;
      const boxes = () =>
        [subject, ...ranges].map((e) => e.viewBounds().map(Math.round).join(',')).join(' ');
      const before = boxes();
      for (const range of ranges) {
        const [x, y, w, h] = range.viewBounds();
        for (const at of [0.1, 0.37, 0.5, 0.83, 1]) {
          host.input.pointerMove(x + w * at, y + h / 2);
          host.input.pointerDown();
          host.input.pointerUp();
          await settle();
          assert.equal(boxes(), before, `nothing moved with the dial at ${at}`);
        }
      }
    } finally {
      wiki.close();
    }
  }
  // Code scrolled across keeps its line numbers where they are; the lines scroll under nothing.
  {
    const wiki = await open('light');
    try {
      const { host } = wiki;
      const { frame, settle } = windowed(host, target, W, H);
      await frame();
      wiki.page.set('theme');
      await settle();
      const lines = findAll(host.root, 'wiki-code-lines').at(-1);
      const gutter = lines.previousSibling;
      lines.scrollIntoView({ block: 'center' });
      await settle();
      const [lx, ly, , lh] = lines.viewBounds();
      const numbers = () => gutter.viewBounds().map(Math.round).join(',');
      const before = numbers();
      host.input.pointerMove(lx + 40, ly + lh / 2);
      host.input.wheel(240, 0);
      await settle();
      assert.ok(lines.scrollLeft > 0, `the lines scrolled across: ${lines.scrollLeft}`);
      assert.equal(numbers(), before, 'the line numbers did not');
      assert.ok(lines.scrollWidth > lines.clientWidth, 'and there was more to see');
    } finally {
      wiki.close();
    }
  }
  // Images: three fits of one photograph differ, and contain leaves the frame showing.
  {
    const wiki = await open('light');
    try {
      const { host } = wiki;
      const { frame, settle, pixels } = windowed(host, target, W, H);
      await frame();
      wiki.page.set('images');
      await settle();
      await host.images.idle();
      await settle();
      const imgs = [];
      const walk = (n) => {
        for (let c = n.firstChild; c; c = c.nextSibling) {
          if (c.tag === 'img') imgs.push(c);
          walk(c);
        }
      };
      walk(findAll(host.root, 'wiki-example-preview')[0]);
      assert.equal(imgs.length, 3, 'three fits');
      const patch = (e, fx = 0.5, fy = 0.5) => {
        const [x, y, w, h] = e.viewBounds();
        const out = [];
        for (let dy = -6; dy <= 6; dy += 3) {
          for (let dx = -6; dx <= 6; dx += 3) {
            const i = (Math.round(y + h * fy + dy) * W + Math.round(x + w * fx + dx)) * 4;
            out.push(pixels[i], pixels[i + 1], pixels[i + 2]);
          }
        }
        return out;
      };
      const differ = (a, b) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
      const [fill, contain, cover] = imgs.map((e) => patch(e, 0.5, 0.35));
      assert.ok(differ(fill, cover) > 8, `fill and cover draw differently: ${differ(fill, cover)}`);
      assert.ok(differ(fill, contain) > 8, 'fill and contain');
      assert.ok(differ(contain, cover) > 8, 'contain and cover');
      // Above a landscape photograph contained in a portrait frame is the frame itself.
      const top = patch(imgs[1], 0.5, 0.06);
      const plain = top.every((v, i) => Math.abs(v - top[i % 3]) <= 2);
      assert.ok(plain, 'contain leaves the frame plain above the photograph');
    } finally {
      wiki.close();
    }
  }
  // The lens follows the pointer, and its dials move nothing but the glass.
  {
    const wiki = await open('light');
    try {
      const { host } = wiki;
      const { frame, settle } = windowed(host, target, W, H);
      await frame();
      wiki.page.set('glass');
      await settle();
      const lens = findAll(host.root, 'lens')[0];
      const stage = findAll(host.root, 'lens-stage')[0];
      lens.scrollIntoView({ block: 'center' });
      await settle();
      const [x, y, w, h] = lens.viewBounds();
      host.input.pointerMove(x + w / 2, y + h / 2);
      host.input.pointerDown();
      await frame();
      host.input.pointerMove(x + w / 2 + 120, y + h / 2 + 40);
      await frame();
      host.input.pointerUp();
      await settle();
      const [x2, y2] = lens.viewBounds();
      assert.ok(
        Math.abs(x2 - x - 120) <= 1 && Math.abs(y2 - y - 40) <= 1,
        `dragged: ${x},${y} to ${x2},${y2}`,
      );
      const boxes = () =>
        [stage, lens].map((e) => e.viewBounds().map(Math.round).join(',')).join(' ');
      const before = boxes();
      const dials = findAll(host.root, 'lens-dials')[0];
      for (const range of [...dials.childNodes].filter((n) => n.tag === 'input')) {
        const [rx, ry, rw, rh] = range.viewBounds();
        for (const at of [0.05, 0.6, 1]) {
          host.input.pointerMove(rx + rw * at, ry + rh / 2);
          host.input.pointerDown();
          host.input.pointerUp();
          await settle();
          assert.equal(boxes(), before, 'a dial moved nothing');
        }
      }
      assert.deepEqual(wiki.errors, []);
    } finally {
      wiki.close();
    }
  }
  // A canvas element draws its shader, frame after frame while it plays, and holds when paused.
  {
    const wiki = await open('light');
    try {
      const { host } = wiki;
      const { frame, press, pixels } = windowed(host, target, W, H);
      await frame();
      wiki.page.set('canvas');
      await frame();
      await frame();
      const canvas = [];
      const walk = (n) => {
        for (let c = n.firstChild; c; c = c.nextSibling) {
          if (c.tag === 'canvas') canvas.push(c);
          walk(c);
        }
      };
      walk(host.root);
      const [x, y, w, h] = canvas[0].viewBounds();
      const at = () => {
        const i = (Math.round(y + h / 2) * W + Math.round(x + w / 2)) * 4;
        return [pixels[i], pixels[i + 1], pixels[i + 2]];
      };
      const first = at();
      assert.ok(Math.max(...first) - Math.min(...first) > 40, `the shader is drawn: ${first}`);
      // A frame's paint that asks for the next one says so as a paint change, as a window hears it.
      let asked = 0;
      host.layout.onChange((change) => {
        if (change === 'paint') {
          asked++;
        }
      });
      await new Promise((r) => setTimeout(r, 120));
      asked = 0;
      await frame();
      assert.ok(asked > 0, 'it asks for the next frame while it plays');
      const later = at();
      assert.notDeepEqual(later, first, 'and moves');
      await press(buttonNamed(host.root, 'Pause'));
      const held = at();
      await new Promise((r) => setTimeout(r, 120));
      asked = 0;
      await frame();
      assert.deepEqual(at(), held, 'paused, it holds still');
      assert.equal(asked, 0, 'and asks for no frames');
      assert.deepEqual(wiki.errors, []);
    } finally {
      wiki.close();
    }
  }
  // Motion: the race's lanes are apart part of the way and together at the end; added cards push
  // the others along, drawn on their way; a dismissed toast is seen leaving, then is gone.
  {
    const wiki = await open('light');
    try {
      const { host } = wiki;
      const { frame, settle, pixels } = windowed(host, target, W, H);
      await frame();
      wiki.page.set('motion');
      await settle();
      // A press where an element is, scrolled into view first.
      const tap = async (element) => {
        element.scrollIntoView({ block: 'center' });
        await settle();
        const [x, y, w, h] = element.viewBounds();
        host.input.pointerMove(x + w / 2, y + h / 2);
        host.input.pointerDown();
        host.input.pointerUp();
      };
      // Where each lane's dot is drawn: the middle of the dark pixels along its track.
      const tracks = findAll(host.root, 'track');
      assert.equal(tracks.length, 7, 'seven lanes');
      const drawn = () =>
        tracks.map((track) => {
          const [x, y, w, h] = track.viewBounds();
          const row = Math.round(y + h / 2);
          let sum = 0;
          let n = 0;
          for (let px = Math.round(x); px < x + w; px++) {
            const i = (row * W + px) * 4;
            if (pixels[i] + pixels[i + 1] + pixels[i + 2] < 200) {
              sum += px - x;
              n++;
            }
          }
          return n ? Math.round(sum / n) : -1;
        });
      await tap(buttonNamed(host.root, 'Go'));
      for (let i = 0; i < 18; i++) {
        await frame();
      }
      const partway = drawn();
      assert.ok(new Set(partway).size >= 5, `the lanes part ways: ${partway}`);
      await settle();
      const ended = drawn();
      assert.ok(
        ended.every((x) => x > 310),
        `and all arrive: ${ended}`,
      );
      // Layout: adding a card pushes Card 1, the pink one, along: drawn on its way, between where it
      // was and where it goes.
      const cards = () => findAll(host.root, 'card');
      const count = cards().length;
      const pink = () => {
        const [x, y, w, h] = findAll(host.root, 'cards')[0].viewBounds();
        let sx = 0;
        let sy = 0;
        let n = 0;
        for (let py = Math.round(y); py < y + h; py += 2) {
          for (let px = Math.round(x); px < x + w; px += 2) {
            const i = (py * W + px) * 4;
            if (pixels[i] > 200 && pixels[i + 1] < 110 && pixels[i + 2] > 120) {
              sx += px;
              sy += py;
              n++;
            }
          }
        }
        return [Math.round(sx / n), Math.round(sy / n)];
      };
      const add = buttonNamed(host.root, 'Add first');
      add.scrollIntoView({ block: 'center' });
      await settle();
      const was = pink();
      await tap(add);
      await frame();
      await frame();
      const between = pink();
      await settle();
      const now = pink();
      assert.equal(cards().length, count + 1, 'a card is added');
      assert.ok(String(now) !== String(was), `Card 1 moved: ${was} to ${now}`);
      assert.ok(
        String(between) !== String(was) && String(between) !== String(now),
        `and was drawn on its way: ${was}, ${between}, ${now}`,
      );
      // Exit: a toast closing is still there two frames on, and gone once it has played.
      await tap(buttonNamed(host.root, 'Notify'));
      await settle();
      assert.equal(findAll(host.root, 'toast').length, 1, 'a toast');
      await tap(buttonNamed(host.root, 'Dismiss'));
      await frame();
      await frame();
      assert.equal(findAll(host.root, 'toast').length, 1, 'still there, leaving');
      await settle();
      await new Promise((r) => setTimeout(r, 0));
      await frame();
      assert.equal(findAll(host.root, 'toast').length, 0, 'then gone');
      assert.deepEqual(wiki.errors, []);
    } finally {
      wiki.close();
    }
  }
  // The Elements pages' examples do what they say.
  {
    const wiki = await open('light');
    try {
      const { host } = wiki;
      const { frame, settle } = windowed(host, target, W, H);
      await frame();
      const tap = async (element, fx = 0.5, fy = 0.5) => {
        element.scrollIntoView({ block: 'center' });
        await settle();
        const [x, y, w, h] = element.viewBounds();
        host.input.pointerMove(x + w * fx, y + h * fy);
        host.input.pointerDown();
        host.input.pointerUp();
        await settle();
      };
      const text = (name) => findAll(host.root, name).map((e) => e.textContent);
      // Events: a press is captured at the outer box before it reaches the inner one.
      wiki.page.set('events');
      await settle();
      await tap(findAll(host.root, 'ev-inner')[0]);
      const log = findAll(host.root, 'ev-log')[0].textContent;
      const outer = log.lastIndexOf('pointerdown outer, captured');
      const inner = log.lastIndexOf('pointerdown inner');
      assert.ok(outer >= 0 && inner >= 0, `both heard it: ${log}`);
      assert.ok(outer > inner, 'the capture first, so lower in a newest-first log');
      // Controls: a checkbox made indeterminate says so; the range moves its readouts.
      wiki.page.set('controls');
      await settle();
      await tap(buttonNamed(host.root, 'Make it indeterminate'));
      assert.ok(
        text('wiki-readout').includes('checkbox: indeterminate'),
        String(text('wiki-readout')),
      );
      const range = findAll(host.root, 'wiki-example-preview')[0];
      const ranges = [];
      const walk = (n) => {
        for (let c = n.firstChild; c; c = c.nextSibling) {
          if (c.tag === 'input' && c.getAttribute('type') === 'range') ranges.push(c);
          walk(c);
        }
      };
      walk(range);
      await tap(ranges[0], 0.95);
      assert.ok(
        text('wiki-readout').some((t) => /level: (9\d|100)/.test(t)),
        String(text('wiki-readout')),
      );
      // Scrolling: into view, and back to the top.
      wiki.page.set('scrolling');
      await settle();
      const box = findAll(host.root, 'sc-box')[0];
      await tap(buttonNamed(host.root, 'center'));
      assert.ok(box.scrollTop > 200, `scrolled to the item: ${box.scrollTop}`);
      await tap(buttonNamed(host.root, 'top'));
      assert.equal(box.scrollTop, 0, 'and back');
      // Top layer: a popover opens beside its button.
      wiki.page.set('top-layer');
      await settle();
      await tap(buttonNamed(host.root, 'Open a popover'));
      const pop = findAll(host.root, 'tl-pop')[0];
      assert.ok(pop, 'a popover is open');
      const [, py] = pop.viewBounds();
      const [, by, , bh] = buttonNamed(host.root, 'Open a popover').viewBounds();
      assert.ok(py >= by + bh, 'below its button');
      host.input.keyDown({ key: 'Escape', code: 'Escape' });
      await settle();
      // Inline text: the link counts its presses.
      wiki.page.set('inline');
      await settle();
      const links = [];
      const findLinks = (n) => {
        for (let c = n.firstChild; c; c = c.nextSibling) {
          if (c.tag === 'a') links.push(c);
          findLinks(c);
        }
      };
      findLinks(findAll(host.root, 'wiki-example-preview')[0]);
      links[0].click();
      await settle();
      assert.ok(text('wiki-readout').includes('link pressed: 1'), String(text('wiki-readout')));
      // The tree: list markers are reported, and a select's parts are not among its children.
      wiki.page.set('tree');
      await settle();
      await tap(buttonNamed(host.root, 'Walk childNodes'));
      const walked = findAll(host.root, 'wiki-example-preview')[0].textContent;
      assert.match(walked, /<li>\s+marker: 3\./, 'the first item counts from 3');
      assert.doesNotMatch(walked, /chevron/, "the select's chevron is owned, not a child");
      assert.deepEqual(wiki.errors, []);
    } finally {
      wiki.close();
    }
  }
  // Drawing: a batch runs an effect once; a narrower width measures more lines; grid moves boxes.
  {
    const wiki = await open('light');
    try {
      const { host } = wiki;
      const { frame, settle } = windowed(host, target, W, H);
      await frame();
      const readouts = () => findAll(host.root, 'wiki-readout').map((e) => e.textContent);
      wiki.page.set('reactive-contexts');
      await settle();
      await new Promise((r) => setTimeout(r, 0));
      buttonNamed(host.root, 'Add two').click();
      await settle();
      assert.deepEqual(readouts(), ['count 2, doubled 4', 'the effect has run 3 times'], 'twice');
      buttonNamed(host.root, 'Add two in a batch').click();
      await settle();
      assert.deepEqual(readouts(), ['count 4, doubled 8', 'the effect has run 4 times'], 'once');
      wiki.page.set('measure');
      await settle();
      const lines = () => Number(/^(\d+) lines/.exec(readouts()[0])[1]);
      const wide = lines();
      const range = [];
      const walk = (n) => {
        for (let c = n.firstChild; c; c = c.nextSibling) {
          if (c.tag === 'input' && c.getAttribute('type') === 'range') range.push(c);
          walk(c);
        }
      };
      walk(findAll(host.root, 'wiki-example-preview')[0]);
      range[0].value = '120';
      range[0].dispatchEvent(
        new (await import('blinc_ts/native/host')).HostEvent('input', { bubbles: true }),
      );
      await settle();
      assert.ok(lines() > wide, `narrower, more lines: ${wide} then ${lines()}`);
      wiki.page.set('layout');
      await settle();
      const first = findAll(host.root, 'lab-item')[3];
      const before = first.bounds().map(Math.round).join(',');
      buttonNamed(host.root, 'grid').click();
      await settle();
      assert.notEqual(
        first.bounds().map(Math.round).join(','),
        before,
        'grid places the boxes anew',
      );
      assert.deepEqual(wiki.errors, []);
    } finally {
      wiki.close();
    }
  }
  // The Testing page's example is a test, and it passes.
  {
    const { buttonTurnsRed } = await import('../dist/wiki/snippets/testing.js');
    await buttonTurnsRed();
  }
} finally {
  target.dispose();
}
console.log('Wiki: pages rendered');
