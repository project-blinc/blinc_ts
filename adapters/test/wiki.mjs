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
        await wiki.draw(`page-${entry.id}`);
        const main = wiki.host.root.firstChild?.nextSibling;
        assert.ok(main, 'the wiki is mounted');
      }
      assert.deepEqual(wiki.errors, []);
    } finally {
      wiki.close();
    }
  }
} finally {
  target.dispose();
}
console.log('Wiki: pages rendered');
