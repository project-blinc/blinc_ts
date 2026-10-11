import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { loadNative } from 'blinc_ts/native';
import { Host } from 'blinc_ts/native/host';
import { OffscreenRenderer } from 'blinc_ts/native/offscreen';
import { probeShader } from 'blinc_ts/shaders';
import { ThemeState } from 'blinc_ts/theme';
import { addUserAgent } from 'blinc_ts/theme/user-agent';
import { addUtilities } from 'blinc_ts/theme/utilities';
import { jsx, mount } from '../dist/jsx/jsx-runtime.js';
import { baseUiTheme } from '../dist/base-ui/theme.js';
import { addBaseUi } from '../dist/base-ui/sheet.js';
import { addWikiSheet } from '../dist/wiki/sheet.js';
import { Wiki } from '../dist/wiki/wiki.js';
import { findAll, windowed } from './wiki-driver.mjs';

const [, , id, scheme = 'light'] = process.argv;
const native = loadNative();
const W = 1120,
  H = 780;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const context = native.createReactive();
const host = Host.create(native);
const errors = [];
host.onStyleErrors((e) => errors.push(...e));
const theme = new ThemeState(context, baseUiTheme, { scheme });
theme.attach(host.layout);
addUserAgent(host.layout);
addBaseUi(host.layout);
addWikiSheet(host.layout);
addUtilities(host.layout);
mount(host, jsx(Wiki, { theme, page: context.signal(id) }), { context });
const { frame, settle, pixels } = windowed(host, target, W, H);
await frame();
await settle();
await host.images.idle();
await settle();
const out = new URL('../../.blinc/wiki-shots/', import.meta.url);
await mkdir(out, { recursive: true });
const main = findAll(host.root, 'wiki-main')[0];
for (let i = 0; i < 8; i++) {
  await settle();
  await writeFile(
    new URL(`${id}-${scheme}-${i}.png`, out),
    PNG.sync.write({ width: W, height: H, data: Buffer.from(pixels) }),
  );
  const before = main.scrollTop;
  main.scrollBy(0, H - 120);
  await frame();
  if (main.scrollTop === before) break;
}
console.log(id, 'errors', errors);
target.dispose();
