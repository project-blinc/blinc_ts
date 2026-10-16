// A rounded clip cut by another, as a scroll view's edge cuts a round avatar: above the cut it is
// the shape it is uncut, its sides still round, not squeezed into one rounded rect. A circle and a
// squircle, at 1x and 2x.
import assert from 'node:assert/strict';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative();
const W = 240;
const H = 160;
const shapes = {
  circle: 'border-radius: 9999px',
  squircle: 'border-radius: 30px; corner-shape: squircle',
};

/** The frame with the shape 100px tall, 10px into a view `view` tall, at `scale`. */
async function draw(shape, view, scale) {
  const host = Host.create(native);
  try {
    host.root.setAttribute('style', 'background: #ffffff');
    const scroll = host.createElement('div');
    scroll.setAttribute(
      'style',
      `position: absolute; left: 20px; top: 20px; width: 200px; height: ${view}px; padding-top: 10px; overflow: hidden`,
    );
    const round = host.createElement('div');
    round.setAttribute(
      'style',
      `width: 100px; height: 100px; flex-shrink: 0; overflow: hidden; ${shapes[shape]}`,
    );
    // Stripes inside, so the clip's edge crosses colour on every row.
    for (let i = 0; i < 5; i++) {
      const stripe = host.createElement('div');
      stripe.setAttribute(
        'style',
        `width: 100px; height: 20px; flex-shrink: 0; background: ${i % 2 ? '#db2777' : '#2563eb'}`,
      );
      round.appendChild(stripe);
    }
    scroll.appendChild(round);
    host.root.appendChild(scroll);
    host.compute(W, H);
    const target = await OffscreenRenderer.create(native, W * scale, H * scale, probeShader);
    const renderer = new SceneRenderer(target.device, host.layout);
    try {
      const pixels = new Uint8Array(W * H * scale * scale * 4);
      await target.captureCommandsInto(
        pixels,
        (encoder, view) =>
          renderer.encode(encoder, host.root.layoutNode, view, {
            width: W * scale,
            height: H * scale,
            scale,
          }).drawCalls,
      );
      return pixels;
    } finally {
      renderer.dispose();
      target.dispose();
    }
  } finally {
    host.dispose();
  }
}

for (const scale of [1, 2]) {
  for (const shape of Object.keys(shapes)) {
    const whole = await draw(shape, 130, scale);
    // The view ends 30px above the shape's bottom: 70 of its 100px show.
    const cut = await draw(shape, 80, scale);
    // Every row above the cut, less the one the cut's antialiasing reaches, matches but for the
    // softness of its edge, which a clip in the record's own space draws a little crisper.
    let off = 0;
    for (let y = 30 * scale; y < (30 + 70 - 1) * scale; y++) {
      for (let x = 20 * scale; x < 120 * scale; x++) {
        const i = (y * W * scale + x) * 4;
        const d = Math.max(...[0, 1, 2].map((c) => Math.abs(whole[i + c] - cut[i + c])));
        if (d > 40) {
          off++;
        }
      }
    }
    assert.equal(off, 0, `${scale}x ${shape}: drawn as it is whole above the cut`);
    // Below the cut, nothing of it.
    const below = ((30 + 75) * scale * W * scale + 70 * scale) * 4;
    assert.deepEqual([...cut.subarray(below, below + 3)], [255, 255, 255], 'and none below it');
  }
}
console.log('Native clip cut: a circle and a squircle cut by a scroll view at 1x and 2x passed');
