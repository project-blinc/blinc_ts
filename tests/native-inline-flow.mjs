import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative();
const W = 400;
const H = 300;
const targets = {
  1: await OffscreenRenderer.create(native, W, H, probeShader),
  2: await OffscreenRenderer.create(native, W * 2, H * 2, probeShader),
};
const output = new URL('../.blinc/inline-flow/', import.meta.url);
await mkdir(output, { recursive: true });

/** The frame at `scale`, as {pixels, width}. */
async function capture(host, name, scale = 1) {
  host.compute(W, H);
  const target = targets[scale];
  const renderer = new SceneRenderer(target.device, host.layout);
  try {
    const width = W * scale;
    const height = H * scale;
    const pixels = new Uint8Array(width * height * 4);
    await target.captureCommandsInto(
      pixels,
      (encoder, view) =>
        renderer.encode(encoder, host.root.layoutNode, view, { width, height, scale }).drawCalls,
    );
    if (name) {
      await writeFile(
        new URL(`${name}.png`, output),
        PNG.sync.write({ width, height, data: Buffer.from(pixels) }),
      );
    }
    return { pixels: Buffer.from(pixels), width, height, scale };
  } finally {
    renderer.dispose();
  }
}
/** Where pixels of `colour` are, within `area`, in layout units: their bounding box, or null. */
function find(frame, colour, area = [0, 0, W, H], tolerance = 40) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -1,
    y1 = -1;
  const s = frame.scale;
  for (
    let y = Math.floor(area[1] * s);
    y < Math.min(frame.height, Math.ceil((area[1] + area[3]) * s));
    y++
  ) {
    for (
      let x = Math.floor(area[0] * s);
      x < Math.min(frame.width, Math.ceil((area[0] + area[2]) * s));
      x++
    ) {
      const at = (y * frame.width + x) * 4;
      if (
        Math.abs(frame.pixels[at] - colour[0]) <= tolerance &&
        Math.abs(frame.pixels[at + 1] - colour[1]) <= tolerance &&
        Math.abs(frame.pixels[at + 2] - colour[2]) <= tolerance
      ) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  return x1 < 0 ? null : [x0 / s, y0 / s, (x1 + 1) / s, (y1 + 1) / s];
}
const WHITE = [255, 255, 255];
const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [80, 120, 255];
const YELLOW = [255, 255, 0];

const host = Host.create(native);
try {
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  host.root.setAttribute('style', 'background: #000000');
  host.layout.addStyleSheet(`
    p { position: absolute; width: 140px; font-size: 16px; color: #ffffff; line-height: 1.5; }
    a { color: #00ff00; }
    strong { color: #ff0000; font-weight: 700; }
    .big { font-size: 32px; color: #ff0000; }
    .small { font-size: 13px; font-weight: 700; color: #5078ff; }
    code { background: #333333; padding: 0 4px; color: #ffff00; font-size: 12px; }
    em { font-style: italic; }
  `);
  const text = (data) => host.createTextNode(data);
  const el = (tag, className, children = []) => {
    const e = host.createElement(tag);
    if (className) {
      e.setAttribute('class', className);
    }
    for (const c of children) {
      e.appendChild(typeof c === 'string' ? text(c) : c);
    }
    return e;
  };
  let nextLeft = 10;
  const para = (children, style = '') => {
    const p = el('p', '', children);
    p.setAttribute('style', `left: ${nextLeft}px; top: 10px;${style}`);
    nextLeft += 150;
    host.root.appendChild(p);
    return p;
  };
  const words =
    'The quick brown fox jumps over the lazy dog and keeps running far across the wide field';

  // Wrapping as one paragraph: the same text with an element in the middle takes the lines plain text does.
  const plain = para([words]);
  const split = para([
    'The quick brown fox jumps over ',
    el('span', '', ['the lazy dog and keeps']),
    ' running far across the wide field',
  ]);
  host.compute(W, H);
  assert.equal(host.inlineFlows.active, true);
  assert.equal(plain.bounds()[3], split.bounds()[3], 'as many lines as plain text');
  assert.ok(split.bounds()[3] > 24 * 3, `wrapped over several lines: ${split.bounds()[3]}`);
  assert.equal(split.childNodes.length, 3, 'the tree is as it was made');
  let frame = await capture(host, 'wrapped');
  // Each text's part of a line is drawn: the plain paragraph's ink and the split one's reach alike.
  const inkA = find(frame, WHITE, [10, 0, 140, 200]);
  const inkB = find(frame, WHITE, [160, 0, 140, 200]);
  assert.ok(inkA && inkB, 'both are drawn');
  assert.ok(
    Math.abs(inkA[3] - inkB[3]) <= 1.5,
    `down to the same line: ${inkA[3]} against ${inkB[3]}`,
  );
  assert.ok(inkB[2] - 160 <= 140.5 && inkB[0] >= 160 - 0.5, 'and inside its width');
  host.root.removeChild(plain);
  host.root.removeChild(split);
  nextLeft = 10;

  // Every line on one baseline, whatever the font: flat-bottomed letters of three sizes meet at one row.
  const mixed = para([
    'H',
    el('span', 'big', ['H']),
    'H',
    el('span', 'small', ['H']),
    el('strong', '', ['H']),
  ]);
  frame = await capture(host, 'baseline');
  const bottoms = [WHITE, RED, BLUE].map((c) => find(frame, c, [10, 0, 140, 100], 30)?.[3]);
  assert.ok(
    bottoms.every((b) => b !== undefined),
    `all three are drawn: ${bottoms}`,
  );
  assert.ok(
    Math.max(...bottoms) - Math.min(...bottoms) <= 1.1,
    `one baseline: ${bottoms} (white, big red, small blue)`,
  );
  const big = find(frame, RED, [10, 0, 140, 100], 30);
  const bluePx = find(frame, BLUE, [10, 0, 140, 100], 30);
  assert.ok(big[3] - big[1] > (bluePx[3] - bluePx[1]) * 2, 'the fonts really differ');
  host.root.removeChild(mixed);
  nextLeft = 10;

  // A link that wraps: a press on either line's piece is a press on the link, and elsewhere is not.
  const link = el('a', '', ['a link long enough to run over a second line']);
  const strong = el('strong', '', ['bold']);
  const q = para(['See ', link, ' then ', strong, ' ends.']);
  frame = await capture(host, 'link');
  const lines = [];
  for (let y = 0; y < 120; y += 2) {
    const row = find(frame, GREEN, [10, y, 140, 2], 60);
    if (row && !lines.some((l) => Math.abs(l[1] - row[1]) < 8)) {
      lines.push(row);
    }
  }
  assert.ok(lines.length >= 2, `the link is on ${lines.length} lines`);
  for (const [x0, y0, x1, y1] of lines) {
    const at = host.elementAt((x0 + x1) / 2, (y0 + y1) / 2);
    assert.equal(at, link, `a press at (${(x0 + x1) / 2}, ${(y0 + y1) / 2}) reaches the link`);
  }
  const bold = find(frame, RED, [10, 0, 140, 120], 60);
  assert.equal(host.elementAt((bold[0] + bold[2]) / 2, (bold[1] + bold[3]) / 2), strong);
  const see = find(frame, WHITE, [10, 0, 140, 22], 60);
  assert.equal(
    host.elementAt((see[0] + see[2]) / 2, (see[1] + see[3]) / 2),
    q,
    'plain text is the paragraph',
  );
  // And a real click, through input, reaches it.
  let clicked = null;
  link.addEventListener('click', () => {
    clicked = 'link';
  });
  const [lx0, ly0, lx1, ly1] = lines.at(-1);
  host.input.pointerMove((lx0 + lx1) / 2, (ly0 + ly1) / 2);
  host.input.pointerDown();
  host.input.pointerUp();
  assert.equal(clicked, 'link', 'a click on the wrapped piece reaches the link');
  host.input.pointerMove(390, 290);

  // The same at twice the scale: laid out in layout units, so nothing moves.
  const retina = await capture(host, 'link-2x', 2);
  const linkTwice = find(retina, GREEN, [10, 0, 140, 120], 60);
  const linkOnce = find(frame, GREEN, [10, 0, 140, 120], 60);
  assert.ok(
    linkTwice.every((v, i) => Math.abs(v - linkOnce[i]) <= 1.5),
    `the link is where it was: ${linkTwice} against ${linkOnce}`,
  );
  assert.equal(host.elementAt((lx0 + lx1) / 2, (ly0 + ly1) / 2), link);

  // A change reflows it: more text, a narrower paragraph, an element gone.
  const before = q.bounds()[3];
  // A text changed on its own reflows it, and back.
  const lead = q.firstChild;
  const leadWas = lead.data;
  lead.data = 'A much longer lead-in sentence for the paragraph, ';
  host.compute(W, H);
  assert.ok(
    q.bounds()[3] > before,
    `a longer text, more lines: ${q.bounds()[3]} against ${before}`,
  );
  lead.data = leadWas;
  host.compute(W, H);
  assert.equal(q.bounds()[3], before, 'and back again');
  link.appendChild(text(' and then a good deal more words to wrap'));
  host.compute(W, H);
  assert.ok(q.bounds()[3] > before, 'more text, more lines');
  q.setAttribute('style', 'left: 10px; top: 10px; width: 100px');
  host.compute(W, H);
  const narrow = q.bounds()[3];
  assert.ok(narrow > q.bounds()[3] - 1 && narrow > before, 'narrower, taller');
  q.setAttribute('style', 'left: 10px; top: 10px;');
  host.compute(W, H);
  link.firstChild.data = 'link';
  link.removeChild(link.lastChild);
  host.compute(W, H);
  assert.ok(q.bounds()[3] <= before + 0.5, `back to the lines it had: ${q.bounds()[3]}`);
  host.root.removeChild(q);
  nextLeft = 10;

  // An element that holds only text is no flow; one that comes to hold an element is, and goes back.
  const onlyText = para(['just words, wrapped as a text']);
  host.compute(W, H);
  const flows = host.inlineFlows;
  assert.equal(flows.active, false, 'only text: nothing to flow');
  const strongLater = el('strong', '', ['bold']);
  onlyText.appendChild(strongLater);
  frame = await capture(host);
  assert.equal(flows.active, true, 'now it holds an element');
  assert.ok(find(frame, RED, [10, 0, 140, 100], 60), 'and its bold text is drawn');
  onlyText.removeChild(strongLater);
  frame = await capture(host);
  assert.ok(find(frame, WHITE, [10, 0, 140, 100], 60), 'plain text is drawn again');
  assert.equal(find(frame, RED, [10, 0, 140, 100], 60), null, 'and the bold text is gone');
  const heightPlain = onlyText.bounds()[3];
  const wrapped = host.createElement('p');
  wrapped.appendChild(text('just words, wrapped as a text'));
  wrapped.setAttribute('style', 'left: 160px; top: 10px');
  host.root.appendChild(wrapped);
  host.compute(W, H);
  assert.equal(wrapped.bounds()[3], heightPlain, 'it is laid out as plain text is');
  host.root.removeChild(wrapped);
  host.root.removeChild(onlyText);
  nextLeft = 10;

  // Alignment: where each line starts across the width.
  const aligned = {};
  for (const align of ['left', 'center', 'right']) {
    const p = para(
      [el('span', '', ['one two three four five six seven eight nine ten'])],
      ` text-align: ${align}; width: 200px;`,
    );
    nextLeft = 10;
    aligned[align] = p;
    p.setAttribute(
      'style',
      `left: 10px; top: ${10 + Object.keys(aligned).length * 70 - 70}px; text-align: ${align}; width: 200px;`,
    );
  }
  frame = await capture(host, 'aligned');
  const lastLine = (name) => {
    const top = aligned[name].bounds()[1];
    const rows = [];
    for (let y = top; y < top + 70; y += 1) {
      const row = find(frame, WHITE, [0, y, W, 1], 60);
      if (row) {
        rows.push(row);
      }
    }
    return rows;
  };
  const start = (name) => Math.min(...lastLine(name).map((r) => r[0]));
  const end = (name) => Math.max(...lastLine(name).map((r) => r[2]));
  assert.ok(start('left') < 12, `left: lines start at the left: ${start('left')}`);
  assert.ok(end('right') > 205, `right: they end at the right: ${end('right')}`);
  assert.ok(Math.abs(start('center') - (210 - end('center'))) < 60, 'centre: they sit between');
  for (const p of Object.values(aligned)) {
    host.root.removeChild(p);
  }
  nextLeft = 10;

  // A box kept whole sits on the baseline of the line it is on, and a break starts a new line.
  const withCode = para(['See ', el('code', '', ['H']), ' H and H', el('br'), 'second']);
  frame = await capture(host, 'code');
  const codeBox = find(frame, [51, 51, 51], [10, 0, 140, 100], 6);
  assert.ok(codeBox, 'the code box is drawn');
  const codeGlyph = find(frame, YELLOW, [10, 0, 140, 100], 60);
  const bodyGlyph = find(frame, WHITE, [60, 0, 90, 34], 60);
  assert.ok(
    Math.abs(codeGlyph[3] - bodyGlyph[3]) <= 1.5,
    `one baseline: ${codeGlyph[3]} against ${bodyGlyph[3]}`,
  );
  // What follows the box starts after it: past the code's glyph, the box's 4px of padding and a space.
  const afterBox = find(frame, WHITE, [codeGlyph[0], 0, 140, 34], 60);
  assert.ok(
    afterBox[0] >= codeGlyph[2] + 8,
    `text clears the box: ${afterBox[0]} against ${codeGlyph[2] + 8}`,
  );
  const second = find(frame, WHITE, [10, 34, 140, 60], 60);
  assert.ok(second && second[1] > bodyGlyph[3], 'a break starts a new line');
  host.root.removeChild(withCode);

  // Structural selectors still count the elements, not what the flow adds.
  host.layout.addStyleSheet('em:first-child { color: #ff0000; } em:last-child { color: #00ff00; }');
  nextLeft = 10;
  const counted = para(['x ', el('em', '', ['H']), ' y ', el('em', '', ['H'])]);
  frame = await capture(host);
  assert.ok(find(frame, RED, [10, 0, 140, 40], 60), 'the first element is :first-child');
  assert.ok(find(frame, GREEN, [10, 0, 140, 40], 60), 'the last is :last-child');
  host.root.removeChild(counted);

  // Taking elements out of the tree takes their pieces with them.
  const gone = el('strong', '', ['bold text']);
  nextLeft = 10;
  const holder = para(['before ', gone, ' after']);
  host.compute(W, H);
  gone.destroy();
  frame = await capture(host);
  assert.equal(find(frame, RED, [10, 0, 140, 100], 60), null, 'no piece of it is left drawn');
  holder.destroy();
  host.compute(W, H);

  assert.deepEqual(errors, []);
} finally {
  host.dispose();
  targets[1].dispose();
  targets[2].dispose();
}
console.log(
  'Native inline flow: wrapping, baselines, hits, scale, reflow, alignment, boxes and structure passed',
);
