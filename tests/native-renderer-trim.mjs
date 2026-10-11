// A renderer keeps what recent frames drew with and lets go of the rest: layers and scratch textures
// no frame has needed for a while, and, on trim, what the last frame did not use, the image atlas
// shrinking to what was drawn. What it draws is the same before and after.
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const W = 320;
const H = 240;
const native = loadNative();
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const host = Host.create(native);
const renderer = new SceneRenderer(target.device, host.layout);
renderer.useImages(host.images.library);
const dir = await mkdtemp(join(tmpdir(), 'blinc-trim-'));
const draw = async (into = new Uint8Array(W * H * 4)) => {
  host.compute(W, H);
  let stats;
  await target.captureCommandsInto(into, (encoder, view) => {
    stats = renderer.encode(encoder, host.root.layoutNode, view, { width: W, height: H, scale: 1 });
    return stats.drawCalls;
  });
  return { pixels: into, bytes: stats.textureBytes };
};
const MB = 1024 * 1024;
const element = (style, parent = host.root) => {
  const e = host.createElement('div');
  e.setAttribute('style', style);
  parent.appendChild(e);
  return e;
};
// A 600 by 400 picture of stripes, so a large draw of it is large in the atlas.
const stripes = join(dir, 'stripes.png');
{
  const data = Buffer.alloc(600 * 400 * 4);
  for (let i = 0; i < 600 * 400; i++) {
    data.set([(i % 600) & 0xff, (i / 600) & 0xff, 128, 255], i * 4);
  }
  await writeFile(stripes, PNG.sync.write({ width: 600, height: 400, data }));
}
try {
  host.root.setAttribute('style', 'background: #ffffff');
  const plain = (await draw()).bytes;

  // Groups nested two deep draw through two layers.
  const outer = element(
    'position: absolute; left: 10px; top: 10px; width: 200px; height: 120px; opacity: 0.6; background: #2040ff',
  );
  const inner = element('width: 100px; height: 60px; opacity: 0.5; background: #ff4020', outer);
  element('width: 40px; height: 30px; background: #20c040', inner);
  const nested = await draw();
  const layer = W * H * 4;
  assert.equal(nested.bytes, plain + 2 * layer, 'two layers, each the size of the frame');

  // Gone from the scene, they are kept a while, in case the next frames want them again.
  outer.destroy();
  assert.equal((await draw()).bytes, nested.bytes, 'kept a frame after they were last needed');
  let bytes = 0;
  for (let i = 0; i < 60; i++) {
    bytes = (await draw()).bytes;
  }
  assert.equal(bytes, plain, 'let go once no frame has needed them for a while');

  // Trim lets go of them at once, and the next frame is drawn as it was before.
  const again = element(
    'position: absolute; left: 10px; top: 10px; width: 200px; height: 120px; opacity: 0.6; background: #2040ff',
  );
  element('width: 40px; height: 30px; opacity: 0.5; background: #20c040', again);
  const before = (await draw()).pixels.slice();
  again.destroy();
  await draw();
  renderer.trim();
  assert.equal((await draw()).bytes, plain, 'trim lets go of what the last frame did not use');
  const back = element(
    'position: absolute; left: 10px; top: 10px; width: 200px; height: 120px; opacity: 0.6; background: #2040ff',
  );
  element('width: 40px; height: 30px; opacity: 0.5; background: #20c040', back);
  assert.deepEqual((await draw()).pixels, before, 'a layer made again draws the same');
  back.destroy();

  // A large image fills the atlas; drawn small, trim shrinks the atlas to what it needs.
  const picture = host.createElement('img');
  picture.setAttribute('src', stripes);
  picture.setAttribute(
    'style',
    'position: absolute; left: 0px; top: 0px; width: 600px; height: 400px',
  );
  host.root.appendChild(picture);
  host.compute(W, H);
  await host.images.idle();
  const large = (await draw()).bytes;
  assert.ok(
    large - plain >= 600 * 400 * 4,
    `the atlas holds the large draw: ${(large - plain) / MB} MB`,
  );
  picture.setAttribute(
    'style',
    'position: absolute; left: 20px; top: 20px; width: 60px; height: 40px',
  );
  const small = (await draw()).pixels.slice();
  renderer.trim();
  const trimmed = await draw();
  assert.ok(
    trimmed.bytes < large / 2,
    `trim shrinks the atlas: ${large / MB} MB then ${trimmed.bytes / MB} MB`,
  );
  assert.deepEqual(trimmed.pixels, small, 'and the image is drawn as it was');

  // Trimming a renderer that has drawn nothing new is harmless.
  renderer.trim();
  assert.deepEqual((await draw()).pixels, small, 'a second trim changes nothing drawn');
} finally {
  renderer.dispose();
  host.dispose();
  target.dispose();
  await rm(dir, { recursive: true });
}
console.log(
  'Native renderer trim: idle layers, trimmed scratch and a shrunk atlas, drawn the same, passed',
);
