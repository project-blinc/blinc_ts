import { writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { loadNative } from 'blinc_ts/native';
import { Host } from 'blinc_ts/native/host';
import { OffscreenRenderer } from 'blinc_ts/native/offscreen';
import { SceneRenderer } from 'blinc_ts/native/renderer';
import { probeShader } from 'blinc_ts/shaders';
import { asset } from '../dist/wiki/assets.js';
const S = Number(process.argv[2] ?? 1);
const W = 400,
  H = 140;
const native = loadNative();
const target = await OffscreenRenderer.create(native, W * S, H * S, probeShader);
const host = Host.create(native);
host.layout
  .addStyleSheet(`.row { flex-direction: row; gap: 20px; padding: 20px; background: #3355ff; width: 400px; height: 140px; }
.a { width: 72px; height: 72px; border-radius: 9999px; border: 4px solid #ffffff; object-fit: cover; }
.b { width: 72px; height: 72px; border-radius: 9999px; object-fit: cover; }
.c { width: 72px; height: 72px; border-radius: 16px; border: 4px solid #ffffff; object-fit: cover; }
.w { width: 72px; height: 72px; border-radius: 9999px; border: 4px solid #ffffff; overflow: hidden; } .w > img { width: 100%; height: 100%; object-fit: cover; }`);
const row = host.createElement('div');
row.className = 'row';
host.root.appendChild(row);
for (const c of ['a', 'b', 'c']) {
  const i = host.createElement('img');
  i.className = c;
  i.setAttribute('src', asset('avatar.jpg'));
  row.appendChild(i);
}
const wrap = host.createElement('div');
wrap.className = 'w';
const wi = host.createElement('img');
wi.setAttribute('src', asset('avatar.jpg'));
wrap.appendChild(wi);
row.appendChild(wrap);
host.compute(W, H);
await host.images.idle();
host.compute(W, H);
const r = new SceneRenderer(target.device, host.layout);
r.useImages(host.images.library);
const px = new Uint8Array(W * H * S * S * 4);
await target.captureCommandsInto(
  px,
  (e, v) =>
    r.encode(e, host.root.layoutNode, v, { width: W * S, height: H * S, scale: S }).drawCalls,
);
await writeFile(
  `/Users/amaterasu/Vibranium/blinc_ts/.blinc/wiki-shots/img-${S}x.png`,
  PNG.sync.write({ width: W * S, height: H * S, data: Buffer.from(px) }),
);
target.dispose();
