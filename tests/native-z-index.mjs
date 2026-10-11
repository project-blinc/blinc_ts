// z-index: overlapping siblings are drawn, and pressed, in z-index order; auto goes back to tree
// order; a change restyles; an invalid value is reported.
import assert from 'node:assert/strict';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative();
const W = 120;
const H = 120;
const host = Host.create(native);
const errors = [];
host.onStyleErrors((e) => errors.push(...e));
host.layout.addStyleSheet(`
  .b { position: absolute; left: 20px; top: 20px; width: 60px; height: 60px; }
  #r { background: #ff0000; } #g { background: #00ff00; } #u { background: #0000ff; }
  .up { z-index: 3; } .down { z-index: -1; } .zero { z-index: 0; }
`);
host.root.setAttribute('style', 'background: #000000');
const box = (id) => {
  const e = host.createElement('div');
  e.setAttribute('id', id);
  e.setAttribute('class', 'b');
  host.root.appendChild(e);
  return e;
};
const [r, g, u] = [box('r'), box('g'), box('u')];
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const renderer = new SceneRenderer(target.device, host.layout);
const px = new Uint8Array(W * H * 4);
/** Which colour is on top at the boxes' common middle. */
const top = async () => {
  host.compute(W, H);
  await target.captureCommandsInto(
    px,
    (encoder, view) =>
      renderer.encode(encoder, host.root.layoutNode, view, { width: W, height: H, scale: 1 })
        .drawCalls,
  );
  const i = (50 * W + 50) * 4;
  return px[i] > 200 ? 'red' : px[i + 1] > 200 ? 'green' : px[i + 2] > 200 ? 'blue' : '?';
};
try {
  assert.equal(await top(), 'blue', 'no z-index: the last in tree order is on top');
  r.classList.add('up');
  assert.equal(await top(), 'red', 'a positive z-index is above the rest');
  assert.equal(host.elementAt(50, 50), r, 'and is what a press reaches');
  r.classList.remove('up');
  u.classList.add('down');
  g.classList.add('zero');
  assert.equal(await top(), 'green', 'zero is with the positioned, above the rest, below a higher');
  assert.equal(host.elementAt(50, 50), g);
  u.classList.remove('down');
  g.classList.remove('zero');
  assert.equal(await top(), 'blue', 'removed, tree order again');
  g.setAttribute('style', 'z-index: 2');
  assert.equal(await top(), 'green', 'an inline z-index');
  g.setAttribute('style', 'z-index: auto');
  assert.equal(await top(), 'blue', 'auto');
  assert.deepEqual(errors, []);
  g.setAttribute('style', 'z-index: 1.5');
  host.compute(W, H);
  assert.equal(errors.length, 1, `a fraction is reported: ${errors}`);
} finally {
  renderer.dispose();
  target.dispose();
  host.dispose();
}
console.log('Native z-index: drawn and pressed in stacking order, auto, and invalid values passed');
