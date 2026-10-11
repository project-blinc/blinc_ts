// display: inline-block, inline-flex, inline and block, in a paragraph: a box that sits in a line of
// text with the words around it, wraps with them, is as big as its own layout makes it, and one
// that says block starts a line of its own.
import assert from 'node:assert/strict';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative();
const target = await OffscreenRenderer.create(native, 400, 300, probeShader);
const host = Host.create(native);
const errors = [];
host.onStyleErrors((e) => errors.push(...e));
host.layout.addStyleSheet(`
  p { position: absolute; left: 10px; top: 10px; width: 300px; font-size: 16px; }
  .badge { display: inline-block; padding: 2px 10px; background: #2255ff; color: #ffffff; border-radius: 8px; }
  .chip { display: inline-flex; flex-direction: row; gap: 6px; align-items: center; background: #ddd; padding: 2px 8px; }
  .chip i { width: 10px; height: 10px; background: #f00; }
  .blocky { display: block; background: #eee; }
  .plain { display: inline; }
`);
const make = (tag, cls, parent, text) => {
  const e = host.createElement(tag);
  if (cls) {
    e.setAttribute('class', cls);
  }
  if (text) {
    e.appendChild(host.createTextNode(text));
  }
  parent.appendChild(e);
  return e;
};
/** Where pixels near `colour` are, as a box in layout units, once the host has drawn: boxes in a line are moved, not laid out. */
async function find(colour) {
  host.compute(400, 300);
  const renderer = new SceneRenderer(target.device, host.layout);
  const px = new Uint8Array(400 * 300 * 4);
  try {
    await target.captureCommandsInto(
      px,
      (encoder, view) =>
        renderer.encode(encoder, host.root.layoutNode, view, { width: 400, height: 300, scale: 1 })
          .drawCalls,
    );
  } finally {
    renderer.dispose();
  }
  let [x0, y0, x1, y1] = [Infinity, Infinity, -1, -1];
  for (let y = 0; y < 300; y++) {
    for (let x = 0; x < 400; x++) {
      const i = (y * 400 + x) * 4;
      if (colour.every((c, k) => Math.abs(px[i + k] - c) < 30)) {
        [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      }
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}
const paragraph = (build) => {
  const p = make('p', '', host.root);
  const made = build(p);
  host.compute(400, 300);
  host.compute(400, 300);
  host.compute(400, 300);
  return { p, ...made };
};
try {
  // A badge between words sits on their line, a box of its own size: its text, plus its padding.
  const one = paragraph((p) => {
    p.appendChild(host.createTextNode('Status: '));
    const badge = make('span', 'badge', p, 'new');
    p.appendChild(host.createTextNode(' since monday'));
    return { badge };
  });
  const [bw, bh] = one.badge.bounds().slice(2);
  const [px, , , ph] = one.p.bounds();
  const [bx] = await find([0x22, 0x55, 0xff]);
  assert.ok(bw > 20 + 16, `the badge is its text and its padding wide: ${bw}`);
  assert.ok(bh > 16 && bh < 40, `and as tall as a line and its padding: ${bh}`);
  assert.ok(bx > px + 40, `after the words before it: ${bx}`);
  assert.ok(ph < 2 * bh + 10, `all on one line: the paragraph is ${ph} tall, the badge ${bh}`);
  one.p.destroy();

  // Wraps with the words: with no room left on the line, it goes to the next.
  const wrapped = paragraph((p) => {
    p.setAttribute('style', 'width: 150px');
    p.appendChild(host.createTextNode('A fairly long start of text '));
    const badge = make('span', 'badge', p, 'new badge');
    return { badge };
  });
  assert.ok(
    (await find([0x22, 0x55, 0xff]))[1] > wrapped.p.bounds()[1] + 14,
    'the badge wrapped to a second line',
  );
  wrapped.p.destroy();

  // inline-flex: its children laid out as flex, the box in the line.
  const chip = paragraph((p) => {
    p.appendChild(host.createTextNode('Tag '));
    const c = make('span', 'chip', p);
    make('i', '', c);
    make('span', '', c, 'beta');
    p.appendChild(host.createTextNode(' here'));
    return { c };
  });
  const [, , cw, ch] = chip.c.bounds();
  assert.ok(cw > 10 + 6 + 20 + 16, `the chip holds its icon, gap and text: ${cw}`);
  assert.ok(ch < 40 && chip.p.bounds()[3] < ch + 12, 'on a line of its own height');
  chip.p.destroy();

  // block on a span: a line of its own, as wide as the paragraph.
  const block = paragraph((p) => {
    p.appendChild(host.createTextNode('before '));
    const b = make('span', 'blocky', p, 'a block');
    p.appendChild(host.createTextNode(' after'));
    return { b };
  });
  const blw = block.b.bounds()[2];
  assert.ok(Math.abs(blw - 300) < 2, `as wide as the paragraph: ${blw}`);
  assert.ok(
    (await find([0xee, 0xee, 0xee]))[1] > block.p.bounds()[1] + 14,
    'below the words before it',
  );
  block.p.destroy();

  // display: inline on a div makes it part of the line, as a span is.
  const plain = paragraph((p) => {
    p.appendChild(host.createTextNode('one '));
    make('div', 'plain', p, 'two');
    p.appendChild(host.createTextNode(' three'));
    return {};
  });
  assert.ok(
    plain.p.bounds()[3] < 30,
    `a div with display: inline stays in the line: ${plain.p.bounds()[3]}`,
  );
  plain.p.destroy();

  // Taken away, it is laid out by its tag again.
  const back = paragraph((p) => {
    p.appendChild(host.createTextNode('x '));
    const badge = make('span', 'badge', p, 'new');
    p.appendChild(host.createTextNode(' y'));
    return { badge };
  });
  back.badge.setAttribute('class', '');
  host.compute(400, 300);
  host.compute(400, 300);
  assert.ok(back.p.bounds()[3] < 30, 'a plain span is in the line too');
  assert.deepEqual(errors, []);
} finally {
  host.dispose();
  target.dispose();
}
console.log(
  'Native inline-block: boxes in a line, wrapping, flex insides, block and inline displays passed',
);
