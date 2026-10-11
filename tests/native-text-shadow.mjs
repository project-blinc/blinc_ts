// text-shadow: offset under the text in its colour, blurred, layered with the first on top,
// inherited and cleared by none, clipped where its text is, and cast into view by text just
// outside a scroll box. At 1x and 2x.
import assert from 'node:assert/strict';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative();
const W = 320;
const H = 200;

async function render(css, html, scale) {
  const host = Host.create(native);
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  host.layout.addStyleSheet(css);
  host.root.setAttribute('style', 'background: #000000');
  for (const [tag, attrs, text] of html) {
    const e = host.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      e.setAttribute(k, v);
    }
    if (text) {
      e.appendChild(host.createTextNode(text));
    }
    host.root.appendChild(e);
  }
  host.compute(W, H);
  const w = W * scale;
  const h = H * scale;
  const target = await OffscreenRenderer.create(native, w, h, probeShader);
  const renderer = new SceneRenderer(target.device, host.layout);
  const pixels = new Uint8Array(w * h * 4);
  try {
    await target.captureCommandsInto(
      pixels,
      (encoder, view) =>
        renderer.encode(encoder, host.root.layoutNode, view, { width: w, height: h, scale })
          .drawCalls,
    );
  } finally {
    renderer.dispose();
    target.dispose();
    host.dispose();
  }
  assert.deepEqual(errors, []);
  const at = (x, y) => [...pixels.subarray((y * w + x) * 4, (y * w + x) * 4 + 3)];
  /** The centre and count of the pixels `test` picks, in layout units. */
  const where = (test, box = [0, 0, W, H]) => {
    let [sx, sy, n] = [0, 0, 0];
    for (let y = box[1] * scale; y < box[3] * scale; y++) {
      for (let x = box[0] * scale; x < box[2] * scale; x++) {
        if (test(at(x, y))) {
          sx += x;
          sy += y;
          n++;
        }
      }
    }
    return n ? { x: sx / n / scale, y: sy / n / scale, n: n / (scale * scale) } : { n: 0 };
  };
  return { where };
}

const white = ([r, g, b]) => r > 200 && g > 200 && b > 200;
const red = ([r, g, b]) => r > 120 && g < 60 && b < 60;
const blue = ([r, g, b]) => b > 120 && r < 60 && g < 60;
const faint = ([r, g, b]) => r > 8 && r < 200 && g < 40 && b < 40;
const text =
  'position: absolute; left: 40px; top: 40px; font-size: 48px; font-weight: 700; color: #ffffff;';

for (const scale of [1, 2]) {
  const s = `at ${scale}x`;
  // A hard shadow sits at its offset, under the text, in its colour.
  let shot = await render(
    `.t { ${text} text-shadow: 8px 6px 0 #ff0000; }`,
    [['div', { class: 't' }, 'HI']],
    scale,
  );
  const glyphs = shot.where(white);
  const shade = shot.where(red);
  assert.ok(
    glyphs.n > 200 && shade.n > 50,
    `${s}: text and its shadow are drawn: ${glyphs.n}, ${shade.n}`,
  );
  // What shows of the shadow is what the text does not cover: its centre is past the text's by
  // less than the offset, in the offset's direction.
  assert.ok(shade.x > glyphs.x && shade.y > glyphs.y, `${s}: the shadow falls right and down`);
  // None, and the same text draws no red.
  shot = await render(`.t { ${text} }`, [['div', { class: 't' }, 'HI']], scale);
  assert.equal(shot.where(red).n, 0, `${s}: no shadow without one`);

  // Blurred, it spreads past the glyphs, softly.
  shot = await render(
    `.t { ${text} text-shadow: 0 0 12px #ff0000; }`,
    [['div', { class: 't' }, 'HI']],
    scale,
  );
  const soft = shot.where(faint, [0, 0, W, 50]);
  assert.ok(soft.n > 20, `${s}: a blurred shadow reaches above the text, faintly: ${soft.n}`);

  // Two: the first is on top. Both at one offset, the first red over the second blue.
  shot = await render(
    `.t { ${text} text-shadow: 10px 10px 0 #ff0000, 10px 10px 0 #0000ff; }`,
    [['div', { class: 't' }, 'HI']],
    scale,
  );
  assert.ok(shot.where(red).n > 50, `${s}: the first shadow shows`);
  assert.equal(shot.where(blue).n, 0, `${s}: the second is under it`);
}

// Inheritance and clipping need nesting, built by hand.
async function nested(build, scale) {
  const host = Host.create(native);
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  host.root.setAttribute('style', 'background: #000000');
  const el = (style, parent, words) => {
    const e = host.createElement('div');
    e.setAttribute('style', style);
    if (words) {
      e.appendChild(host.createTextNode(words));
    }
    parent.appendChild(e);
    return e;
  };
  const after = build(el, host.root);
  host.compute(W, H);
  after?.();
  host.compute(W, H);
  const w = W * scale;
  const h = H * scale;
  const target = await OffscreenRenderer.create(native, w, h, probeShader);
  const renderer = new SceneRenderer(target.device, host.layout);
  const pixels = new Uint8Array(w * h * 4);
  try {
    await target.captureCommandsInto(
      pixels,
      (encoder, view) =>
        renderer.encode(encoder, host.root.layoutNode, view, { width: w, height: h, scale })
          .drawCalls,
    );
  } finally {
    renderer.dispose();
    target.dispose();
    host.dispose();
  }
  assert.deepEqual(errors, []);
  const count = (test, box) => {
    let n = 0;
    for (let y = box[1] * scale; y < box[3] * scale; y++) {
      for (let x = box[0] * scale; x < box[2] * scale; x++) {
        const i = (y * w + x) * 4;
        if (test([pixels[i], pixels[i + 1], pixels[i + 2]])) {
          n++;
        }
      }
    }
    return n;
  };
  return count;
}

for (const scale of [1, 2]) {
  const s = `at ${scale}x`;
  // A child's text takes its parent's shadow; one that says none has none.
  let count = await nested((el, root) => {
    const parent = el(
      'position: absolute; left: 0; top: 0; width: 320px; height: 200px; text-shadow: 8px 6px 0 #ff0000;',
      root,
    );
    el(`${text} top: 20px;`, parent, 'AB');
    el(`${text} top: 110px; text-shadow: none;`, parent, 'AB');
  }, scale);
  assert.ok(count(red, [0, 0, W, 100]) > 50, `${s}: inherited from the parent`);
  assert.equal(count(red, [0, 100, W, H]), 0, `${s}: none takes it away`);

  // A blurred shadow is clipped where its text is: none of it outside a clipping box.
  count = await nested((el, root) => {
    const box = el(
      'position: absolute; left: 40px; top: 40px; width: 200px; height: 60px; overflow: hidden;',
      root,
    );
    el(
      'font-size: 40px; font-weight: 700; color: #ffffff; text-shadow: 0 30px 8px #ff0000;',
      box,
      'Clip',
    );
  }, scale);
  assert.ok(count(red, [40, 40, 240, 100]) > 20, `${s}: the shadow shows inside the box`);
  assert.equal(
    count((p) => p[0] > 8, [0, 104, W, H]),
    0,
    `${s}: and nothing of it below the box`,
  );

  // Text scrolled just out of a box still casts its shadow into it.
  count = await nested((el, root) => {
    const box = el(
      'position: absolute; left: 40px; top: 60px; width: 240px; height: 100px; overflow: scroll; scrollbar-width: none;',
      root,
    );
    const inner = el('width: 240px; height: 400px; flex-shrink: 0; flex-direction: column;', box);
    el('height: 120px; flex-shrink: 0;', inner);
    el(
      'font-size: 40px; font-weight: 700; color: #ffffff; text-shadow: 0 60px 0 #ff0000; flex-shrink: 0;',
      inner,
      'Cast',
    );
    return () => box.scrollBy(0, 168);
  }, scale);
  assert.equal(count(white, [40, 60, 280, 160]), 0, `${s}: the text is out of view`);
  assert.ok(count(red, [40, 60, 280, 160]) > 50, `${s}: its shadow is in view`);
}

console.log(
  'Native text shadow: offset, blur, layers, inheritance, none, clip and cull at 1x and 2x passed',
);
