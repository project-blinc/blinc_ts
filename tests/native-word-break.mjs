// overflow-wrap (and word-wrap) and word-break: a word longer than its line breaks inside it where
// asked, in a plain text and beside inline elements, inherited, and the box takes its lines.
import assert from 'node:assert/strict';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative();
const W = 300;
const H = 200;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const word = 'https://example.com/a/very/long/path/that/never/stops/anywhere';

/** The ink's right edge, and the box's height, of `word` in a 120 wide box given `css` and `html`. */
async function run(css, make) {
  const host = Host.create(native);
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  host.layout
    .addStyleSheet(`.box { position: absolute; left: 20px; top: 20px; width: 120px; font-size: 14px; color: #ffffff; ${css} }
    strong { color: #ffffff; }`);
  host.root.setAttribute('style', 'background: #000000');
  const box = host.createElement('div');
  box.setAttribute('class', 'box');
  make(host, box);
  host.root.appendChild(box);
  host.compute(W, H);
  host.compute(W, H);
  host.compute(W, H);
  const renderer = new SceneRenderer(target.device, host.layout);
  const px = new Uint8Array(W * H * 4);
  try {
    await target.captureCommandsInto(
      px,
      (encoder, view) =>
        renderer.encode(encoder, host.root.layoutNode, view, { width: W, height: H, scale: 1 })
          .drawCalls,
    );
  } finally {
    renderer.dispose();
  }
  let right = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (px[(y * W + x) * 4] > 120) {
        right = Math.max(right, x);
      }
    }
  }
  const height = box.bounds()[3];
  assert.deepEqual(errors, []);
  host.dispose();
  return { right, height };
}
const plain = (host, box) => box.appendChild(host.createTextNode(word));
const mixed = (host, box) => {
  box.appendChild(host.createTextNode('See '));
  const strong = host.createElement('strong');
  strong.appendChild(host.createTextNode(word));
  box.appendChild(strong);
  box.appendChild(host.createTextNode(' now'));
};
try {
  // By default a long word overflows its box on one line.
  const normal = await run('', plain);
  assert.ok(normal.right > 160, `it runs past the box: ${normal.right}`);
  for (const [name, css] of [
    ['overflow-wrap: anywhere', 'overflow-wrap: anywhere'],
    ['overflow-wrap: break-word', 'overflow-wrap: break-word'],
    ['the old name, word-wrap', 'word-wrap: break-word'],
    ['word-break: break-all', 'word-break: break-all'],
  ]) {
    const broken = await run(css, plain);
    assert.ok(broken.right <= 141, `${name}: stays in the box: ${broken.right}`);
    assert.ok(broken.height > 2 * 14, `${name}: on several lines: ${broken.height}`);
  }
  // Beside an inline element, in the same flow.
  const among = await run('overflow-wrap: anywhere', mixed);
  assert.ok(
    among.right <= 141 && among.height > 2 * 14,
    `in a flow: ${among.right}, ${among.height}`,
  );
  assert.ok((await run('', mixed)).right > 141, 'and not without it');
  // Inherited from a parent, and taken back by normal.
  const parent = await run('', (host, box) => {
    box.setAttribute('style', 'overflow-wrap: anywhere');
    const inner = host.createElement('div');
    inner.setAttribute('style', 'width: 100%');
    inner.appendChild(host.createTextNode(word));
    box.appendChild(inner);
  });
  assert.ok(parent.right <= 141, `inherited: ${parent.right}`);
  const back = await run('overflow-wrap: anywhere', (host, box) => {
    const inner = host.createElement('div');
    inner.setAttribute('style', 'overflow-wrap: normal; width: 100%');
    inner.appendChild(host.createTextNode(word));
    box.appendChild(inner);
  });
  assert.ok(back.right > 160, `normal takes it back: ${back.right}`);
  // Set on a parent after the fact, a child that holds the text is a flow from then on.
  const late = await run('', (host, box) => {
    const inner = host.createElement('div');
    inner.setAttribute('style', 'width: 100%');
    inner.appendChild(host.createTextNode(word));
    box.appendChild(inner);
    host.root.appendChild(box);
    host.compute(W, H);
    host.compute(W, H);
    box.setAttribute('style', 'overflow-wrap: anywhere');
  });
  assert.ok(late.right <= 141, `changed later, on a parent: ${late.right}`);
  // A text that fits is unchanged.
  const short = await run('overflow-wrap: anywhere', (host, box) =>
    box.appendChild(host.createTextNode('short words here')),
  );
  assert.ok(short.height < 2 * 20, `short text is one line: ${short.height}`);
} finally {
  target.dispose();
}
console.log(
  'Native word break: overflow-wrap, word-wrap and word-break in text and in flows passed',
);
