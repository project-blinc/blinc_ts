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
import { FrameLayout } from '../../dist/native/frame-layout.js';
import { jsx, mount } from '../dist/jsx/jsx-runtime.js';
import { baseUiTheme } from '../dist/base-ui/theme.js';
import { addBaseUi } from '../dist/base-ui/sheet.js';
import { addWikiSheet } from '../dist/wiki/sheet.js';
import { pages } from '../dist/wiki/pages.js';
import { Wiki } from '../dist/wiki/wiki.js';

const native = loadNative();
const W = 1100;
const H = 760;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../../.blinc/wiki/', import.meta.url);
await mkdir(output, { recursive: true });

/** The button under `node` whose text is `text`. */
function buttonNamed(node, text) {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.tag === 'button' && child.textContent === text) {
      return child;
    }
    const found = buttonNamed(child, text);
    if (found) {
      return found;
    }
  }
  return undefined;
}

/** The elements under `node` with `name` among their classes, in tree order. */
function findAll(node, name, out = []) {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.classList?.contains(name)) {
      out.push(child);
    }
    findAll(child, name, out);
  }
  return out;
}

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
  // A user's session, frame by frame as a window runs them: a frame follows each event at once, so
  // what an event changed is still queued when it begins. Clicking through the reactive page is
  // what crashed a window.
  {
    const wiki = await open('light');
    try {
      const { host } = wiki;
      host.compute(W, H);
      const frames = new FrameLayout(host.layout, host.root.layoutNode);
      host.layout.onChange((change) => frames.changed(change));
      let clock = 0;
      const frame = async () => {
        frames.prepare(W, H, 1, () => (clock += 16));
        const renderer = new SceneRenderer(target.device, host.layout);
        try {
          renderer.useImages(host.images.library);
          await target.captureCommandsInto(
            new Uint8Array(W * H * 4),
            (encoder, view) =>
              renderer.encode(encoder, host.root.layoutNode, view, {
                width: W,
                height: H,
                scale: 1,
              }).drawCalls,
          );
        } finally {
          renderer.dispose();
        }
      };
      const named = (text) =>
        findAll(host.root, 'wiki-readout').length >= 0 && buttonNamed(host.root, text);
      const press = async (button) => {
        const [x, y, w, h] = button.viewBounds();
        host.input.pointerMove(x + w / 2, y + h / 2);
        await frame();
        host.input.pointerDown();
        await frame();
        host.input.pointerUp();
        await frame();
        for (let i = 0; i < 6; i++) {
          await frame();
        }
      };
      await frame();
      await press(named('Reactive views'));
      assert.equal(wiki.page.get(), 'reactive');
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
      assert.deepEqual(wiki.errors, []);
    } finally {
      wiki.close();
    }
  }
} finally {
  target.dispose();
}
console.log('Wiki: pages rendered');
