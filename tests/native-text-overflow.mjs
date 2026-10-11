// text-overflow: ellipsis and line-clamp: a line that overflows its container ends with an
// ellipsis, a clamped text is held to its lines, in the pixels and the layout, at 1x and 2x.
import assert from 'node:assert/strict';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative(process.env.BLINC_CALC_ADDON);
let deferred = false;
const W = 260;
const H = 200;

/** Renders `css` over the html `[tag, class, text]`, giving the ink, in layout units, `ink(box)` counts. */
async function render(css, parts, scale) {
  const host = Host.create(native);
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  host.layout
    .addStyleSheet(`.box { position: absolute; left: 20px; top: 20px; width: 120px; overflow: hidden; }
    .t { font-size: 16px; font-weight: 700; color: #ffffff; } ${css}`);
  host.root.setAttribute(
    'style',
    `background: #000000; ${deferred ? 'width: max(100%, 1px)' : ''}`,
  );
  const made = {};
  for (const [name, cls, parent, text] of parts) {
    const e = host.createElement('div');
    e.setAttribute('class', cls);
    if (text) {
      e.appendChild(host.createTextNode(text));
    }
    (parent ? made[parent] : host.root).appendChild(e);
    made[name] = e;
  }
  host.compute(W, H);
  const w = W * scale;
  const h = H * scale;
  const target = await OffscreenRenderer.create(native, w, h, probeShader);
  const renderer = new SceneRenderer(target.device, host.layout);
  const px = new Uint8Array(w * h * 4);
  try {
    await target.captureCommandsInto(
      px,
      (encoder, view) =>
        renderer.encode(encoder, host.root.layoutNode, view, { width: w, height: h, scale })
          .drawCalls,
    );
  } finally {
    renderer.dispose();
    target.dispose();
  }
  const bounds = (n) => made[n].bounds();
  const ink = ([x0, y0, x1, y1]) => {
    let n = 0;
    for (let y = Math.floor(y0 * scale); y < Math.ceil(y1 * scale); y++) {
      for (let x = Math.floor(x0 * scale); x < Math.ceil(x1 * scale); x++) {
        if (px[(y * w + x) * 4] > 100) {
          n++;
        }
      }
    }
    return n / (scale * scale);
  };
  assert.deepEqual(errors, []);
  /** How many rows of ink are in the last `width` columns of ink in `box`. */
  const tail = ([x0, y0, x1, y1], width) => {
    let right = -1;
    for (let x = x1 * scale - 1; x >= x0 * scale && right < 0; x--) {
      for (let y = y0 * scale; y < y1 * scale; y++) {
        if (px[(y * w + x) * 4] > 100) {
          right = x;
          break;
        }
      }
    }
    const rows = new Set();
    for (let x = right; x > right - width * scale; x--) {
      for (let y = y0 * scale; y < y1 * scale; y++) {
        if (px[(y * w + x) * 4] > 100) {
          rows.add(y);
        }
      }
    }
    return rows.size / scale;
  };
  const finish = () => host.dispose();
  return { ink, tail, bounds, finish };
}

const long = 'WWWWWWWWWWWWWWWWWWWW';
for (const math of [false, true]) {
  deferred = math;
  for (const scale of [1, 2]) {
    const s = `at ${scale}x (${math ? 'deferred' : 'ordinary'} layout)`;
    const lone = [
      ['box', 'box', null, null],
      ['text', 't', 'box', long],
    ];
    const nowrap = '.box { white-space: nowrap; height: 24px; }';
    // Clipped, the letters are cut at the box's edge, tall to the last column; with an ellipsis the
    // line ends in dots, which are a few rows high, and the start of the text is before them.
    let r = await render(nowrap, lone, scale);
    const clipped = r.tail([20, 20, 140, 44], 6);
    r.finish();
    r = await render(`${nowrap} .box { text-overflow: ellipsis; }`, lone, scale);
    const dotted = r.tail([20, 20, 140, 44], 6);
    const whole = r.ink([20, 20, 140, 44]);
    r.finish();
    assert.ok(clipped >= 9, `${s}: clipped text is tall at the box's edge: ${clipped}`);
    assert.ok(dotted > 0 && dotted <= 5, `${s}: an ellipsis ends the line: ${dotted} rows`);
    assert.ok(whole > 200, `${s}: with the start of the text before it: ${whole}`);

    // A line that fits is left alone, ellipsis or not.
    r = await render(
      `${nowrap} .box { text-overflow: ellipsis; }`,
      [
        ['box', 'box', null, null],
        ['text', 't', 'box', 'WW'],
      ],
      scale,
    );
    const same = r.ink([20, 20, 140, 44]);
    r.finish();
    r = await render(
      nowrap,
      [
        ['box', 'box', null, null],
        ['text', 't', 'box', 'WW'],
      ],
      scale,
    );
    assert.equal(same, r.ink([20, 20, 140, 44]), `${s}: a fitting line is untouched`);
    r.finish();

    // A clamp holds the text to its lines: the box is two lines tall and nothing is below.
    const para = Array(4)
      .fill('one two three four five six seven eight nine ten eleven twelve thirteen')
      .join(' ');
    const wrapped = [
      ['box', 'box', null, null],
      ['text', 't', 'box', para],
    ];
    r = await render('.box { flex-direction: column; }', wrapped, scale);
    const natural = r.bounds('box')[3];
    const rows = r.ink([20, 20 + 2 * 19.2 + 2, 140, 140]);
    r.finish();
    assert.ok(rows > 100, `${s}: unclamped, the text goes on below two lines: ${rows}`);
    r = await render('.box { flex-direction: column; line-clamp: 2; }', wrapped, scale);
    const held = r.bounds('box')[3];
    assert.ok(Math.abs(held - 2 * 19.2) < 1.5, `${s}: two lines tall: ${held} of ${natural}`);
    assert.equal(r.ink([20, 20 + 2 * 19.2 + 2, 140, 140]), 0, `${s}: nothing below them`);
    assert.ok(r.ink([20, 20, 140, 20 + 2 * 19.2]) > 100, `${s}: the two lines are drawn`);
    r.finish();
    r = await render('.box { flex-direction: column; -webkit-line-clamp: 1; }', wrapped, scale);
    assert.ok(Math.abs(r.bounds('box')[3] - 19.2) < 1.5, `${s}: the prefixed name, one line`);
    r.finish();
  }
}
console.log(
  'Native text overflow: ellipsis and line-clamp, in layout and pixels, at 1x and 2x passed',
);
