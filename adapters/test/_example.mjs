// Render one wiki example alone at its own size: node test/_example.mjs <name> <width> <height> [scale]
import { writeFile, mkdir } from 'node:fs/promises';
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
import { WikiTheme } from '../dist/wiki/context.js';

const [, , name, w = '700', h = '960', s = '2'] = process.argv;
const W = Number(w),
  H = Number(h),
  S = Number(s);
const native = loadNative();
const target = await OffscreenRenderer.create(native, W * S, H * S, probeShader);
const context = native.createReactive();
const host = Host.create(native);
const errors = [];
host.onStyleErrors((e) => errors.push(...e));
const theme = new ThemeState(context, baseUiTheme, { scheme: 'light' });
theme.attach(host.layout);
addUserAgent(host.layout);
addBaseUi(host.layout);
addWikiSheet(host.layout);
addUtilities(host.layout);
const View = (await import(`../dist/wiki/examples/${name}.js`)).default;
mount(
  host,
  jsx('div', {
    style: { padding: 20, width: '100%', height: '100%' },
    children: jsx(WikiTheme.Provider, { value: theme, children: jsx(View, {}) }),
  }),
  { context },
);
for (let i = 0; i < 6; i++) {
  host.flush();
  host.compute(W, H);
  host.layout.tickMotion(1);
  host.layout.tickMotion(5000);
  await new Promise((r) => setTimeout(r, 0));
}
await host.images.idle();
host.compute(W, H);
const renderer = new SceneRenderer(target.device, host.layout);
renderer.useImages(host.images.library);
host.canvases.attach(renderer);
const pixels = new Uint8Array(W * S * H * S * 4);
await target.captureCommandsInto(
  pixels,
  (encoder, view) =>
    renderer.encode(encoder, host.root.layoutNode, view, { width: W * S, height: H * S, scale: S })
      .drawCalls,
);
renderer.dispose();
const out = new URL('../../.blinc/wiki-shots/', import.meta.url);
await mkdir(out, { recursive: true });
await writeFile(
  new URL(`example-${name}.png`, out),
  PNG.sync.write({ width: W * S, height: H * S, data: Buffer.from(pixels) }),
);
console.log(name, 'errors', errors);
target.dispose();
