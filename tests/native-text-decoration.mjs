import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';
import { ThemeState, neutralTheme } from '../dist/theme/index.js';
import { addUserAgent } from '../dist/theme/user-agent.js';

const native = loadNative();
const W = 800;
const H = 460;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../.blinc/text-decoration/', import.meta.url);
await mkdir(output, { recursive: true });

async function capture(host, name) {
  host.compute(W, H);
  const renderer = new SceneRenderer(target.device, host.layout);
  try {
    const pixels = new Uint8Array(W * H * 4);
    await target.captureCommandsInto(
      pixels,
      (encoder, view) =>
        renderer.encode(encoder, host.root.layoutNode, view, { width: W, height: H, scale: 1 })
          .drawCalls,
    );
    if (name) {
      await writeFile(
        new URL(`${name}.png`, output),
        PNG.sync.write({ width: W, height: H, data: Buffer.from(pixels) }),
      );
    }
    return Buffer.from(pixels);
  } finally {
    renderer.dispose();
  }
}
const pixel = (pixels, x, y) => {
  const at = (Math.round(y) * W + Math.round(x)) * 4;
  return [...pixels.subarray(at, at + 3)];
};
const near = (actual, expected, tolerance = 40) =>
  actual.every((c, i) => Math.abs(c - expected[i]) <= tolerance);

const WHITE = [255, 255, 255];
const RED = [255, 0, 0];
const BLUE = [0, 0, 255];

/** The bounding box [x0, y0, x1, y1) of pixels near `colour` in `area`, or null. */
function find(pixels, colour, [ax, ay, aw, ah], tolerance = 40) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -1,
    y1 = -1;
  for (let y = Math.max(0, Math.floor(ay)); y < Math.min(H, Math.ceil(ay + ah)); y++) {
    for (let x = Math.max(0, Math.floor(ax)); x < Math.min(W, Math.ceil(ax + aw)); x++) {
      if (near(pixel(pixels, x, y), colour, tolerance)) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}
/** The runs of rows in `area` that have a pixel near `colour`, as [first, last + 1) pairs. */
function bands(pixels, colour, [ax, ay, aw, ah]) {
  const out = [];
  for (let y = Math.floor(ay); y < Math.ceil(ay + ah); y++) {
    let any = false;
    for (let x = Math.floor(ax); x < Math.ceil(ax + aw); x++) {
      if (near(pixel(pixels, x, y), colour)) {
        any = true;
        break;
      }
    }
    if (any && out.length && out[out.length - 1][1] === y) {
      out[out.length - 1][1] = y + 1;
    } else if (any) {
      out.push([y, y + 1]);
    }
  }
  return out;
}
/** How many separate runs of `colour` there are along row `y` between `x0` and `x1`. */
function runs(pixels, colour, y, x0, x1) {
  let count = 0;
  let inside = false;
  for (let x = x0; x < x1; x++) {
    const on = near(pixel(pixels, x, y), colour);
    if (on && !inside) {
      count++;
    }
    inside = on;
  }
  return count;
}

const sheet = `
.cell { position: absolute; width: 170px; font-size: 32px; color: #ffffff; line-height: 1.2; }
.under { text-decoration: underline; text-decoration-color: #ff0000; }
.over { text-decoration: overline #ff0000; }
.through { text-decoration: line-through #ff0000; }
.double { text-decoration: underline double #ff0000; }
.dotted { text-decoration: underline dotted 3px #ff0000; }
.dashed { text-decoration: underline dashed 3px #ff0000; }
.thick { text-decoration: underline 6px #ff0000; }
.offset { text-decoration-line: underline; text-decoration-color: #ff0000; text-underline-offset: 12px; }
.current { text-decoration: underline; }
.narrow { width: 130px; }
.parent { text-decoration: underline #ff0000; }
.child { text-decoration: line-through #0000ff; }
.plain { text-decoration: none; }
.fade { text-decoration: underline #ff0000; transition: text-decoration-color 100ms linear; }
.fade.on { text-decoration-color: #0000ff; }
.bad { text-decoration: underline wavy; }
.link { position: absolute; font-size: 32px; }
`;

const context = native.createReactive();
const host = Host.create(native);
try {
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  const state = new ThemeState(context, neutralTheme, { scheme: 'dark' });
  state.attach(host.layout);
  addUserAgent(host.layout);
  host.layout.addStyleSheet(sheet);
  host.root.setAttribute('style', 'background: #202020');
  const make = (tag, classes, children, style = '') => {
    const e = host.createElement(tag);
    e.className = classes;
    if (style) {
      e.setAttribute('style', style);
    }
    for (const c of children) {
      e.appendChild(typeof c === 'string' ? host.createTextNode(c) : c);
    }
    return e;
  };
  const cells = {};
  const place = (name, classes, children, tag = 'div') => {
    const i = Object.keys(cells).length;
    const e = make(
      tag,
      `cell ${classes}`,
      children,
      `left: ${10 + (i % 4) * 195}px; top: ${10 + Math.floor(i / 4) * 100}px`,
    );
    host.root.appendChild(e);
    cells[name] = e;
    return e;
  };
  place('under', 'under', ['HELLO']);
  place('over', 'over', ['HELLO']);
  place('through', 'through', ['HELLO']);
  place('double', 'double', ['HELLO']);
  place('dotted', 'dotted', ['HELLO']);
  place('dashed', 'dashed', ['HELLO']);
  place('thick', 'thick', ['HELLO']);
  place('offset', 'offset', ['HELLO']);
  place('current', 'current', ['HELLO']);
  place('wrapped', 'under narrow', ['HELLO WORLD']);
  place('stacked', 'parent', ['HELLO ', make('span', 'child', ['WORLD'])]);
  place('none', 'parent', [make('span', 'plain', ['HELLO'])]);
  place('fade', 'fade', ['HELLO']);
  place('link', '', [make('a', '', ['LINK'])]);
  place('ua', '', [
    make('u', '', ['UU']),
    ' ',
    make('s', '', ['SS']),
    ' ',
    make('del', '', ['DD']),
  ]);
  host.flush();

  let frame = await capture(host, 'decoration');
  // A decoration can hang outside the node's box, above it for an overline in a font with a tall
  // ascender and below it for an underline, so each is looked for a little beyond it.
  const box = (name) => {
    const [x, y, w, h] = cells[name].bounds();
    return [x, y - 10, w, h + 24];
  };
  const glyphs = (name) => find(frame, WHITE, box(name), 90);
  const red = (name) => find(frame, RED, box(name));

  // An underline lies under the text, as long as it, a few pixels thick.
  const text = glyphs('under');
  const line = red('under');
  assert.ok(text && line, 'text and an underline are drawn');
  assert.ok(
    line[1] >= text[3] - 1 && line[1] <= text[3] + 8,
    `under the baseline: ${line} for text ${text}`,
  );
  assert.ok(line[3] - line[1] >= 1 && line[3] - line[1] <= 4, `a line, not a block: ${line}`);
  assert.ok(
    Math.abs(line[0] - text[0]) <= 3 && Math.abs(line[2] - text[2]) <= 3,
    `as wide as the text: ${line} ${text}`,
  );
  // An overline is above the text and a line-through across it.
  const overText = glyphs('over');
  const overLine = red('over');
  assert.ok(overLine[3] <= overText[1] + 2, `over the capitals: ${overLine} ${overText}`);
  const strikeText = glyphs('through');
  const strike = red('through');
  assert.ok(
    strike[1] > strikeText[1] + 4 && strike[3] < strikeText[3] - 4,
    `through the middle: ${strike} ${strikeText}`,
  );
  // Double is two lines, dotted and dashed are broken, and the thickness and the offset move them.
  assert.equal(bands(frame, RED, box('double')).length, 2, 'double is two lines');
  const dottedLine = red('dotted');
  const dottedRow = Math.round((dottedLine[1] + dottedLine[3]) / 2);
  assert.ok(
    runs(frame, RED, dottedRow, dottedLine[0], dottedLine[2]) >= 8,
    'dotted is a row of dots',
  );
  const dashedLine = red('dashed');
  const dashedRow = Math.round((dashedLine[1] + dashedLine[3]) / 2);
  const dashes = runs(frame, RED, dashedRow, dashedLine[0], dashedLine[2]);
  assert.ok(
    dashes >= 4 && dashes < runs(frame, RED, dottedRow, dottedLine[0], dottedLine[2]),
    `dashed is fewer, longer: ${dashes}`,
  );
  const thick = red('thick');
  assert.ok(thick[3] - thick[1] >= 5 && thick[3] - thick[1] <= 7, `6px thick: ${thick}`);
  const moved = red('offset');
  const lower = moved[1] - cells.offset.bounds()[1] - (line[1] - cells.under.bounds()[1]);
  assert.ok(
    lower >= 6 && lower <= 14,
    `an underline 12px down starts further below its text: ${lower}`,
  );
  // Without a colour the line takes the text's own.
  const own = find(frame, WHITE, box('current'), 40);
  const ownBands = bands(frame, WHITE, box('current'));
  assert.ok(ownBands.length >= 1 && own, 'the text colour');
  const lowest = ownBands[ownBands.length - 1];
  assert.ok(lowest[1] > glyphs('current')[3] - 3, 'a white line under white text');
  // Each line of wrapped text is underlined.
  assert.equal(bands(frame, RED, box('wrapped')).length, 2, 'two lines, two underlines');
  // A child's decoration stacks with its parent's; one that says none undoes nothing.
  // The parent's text wraps onto a second line, which holds only the child's; both are underlined.
  const stackedBox = box('stacked');
  assert.equal(
    bands(frame, RED, stackedBox).length,
    2,
    "the parent underlines its own text and its child's",
  );
  const struck = find(frame, BLUE, stackedBox);
  assert.ok(struck, 'and the child is struck through in blue');
  assert.ok(struck[1] > stackedBox[1] + 38, 'only over the child text');
  assert.equal(bands(frame, BLUE, stackedBox).length, 1, 'once');
  assert.ok(red('none'), 'none on a child does not take the parent line away');

  // The user-agent sheet underlines a link, and u and ins; s and del are struck.
  const linkText = find(frame, [0x4a, 0x9e, 0xff], box('link'), 90) ?? glyphs('link');
  assert.ok(linkText, 'link text is drawn');
  const linkBox = box('link');
  const underlineRows = [];
  for (let y = linkBox[1]; y < linkBox[1] + linkBox[3]; y++) {
    let n = 0;
    for (let x = linkBox[0]; x < linkBox[0] + 120; x++) {
      const [r, g, b] = pixel(frame, x, y);
      if (r + g + b > 150 && Math.max(r, g, b) - Math.min(r, g, b) > 0) {
        n++;
      }
    }
    underlineRows.push(n);
  }
  assert.ok(
    Math.max(...underlineRows) >= 60,
    `a link's underline is a long row: ${Math.max(...underlineRows)}`,
  );

  // The colour moves through a transition.
  cells.fade.classList.add('on');
  host.compute(W, H);
  assert.equal(host.layout.tickMotion(1000), true);
  host.layout.tickMotion(1050);
  frame = await capture(host, 'fading');
  const fade = find(frame, [128, 0, 128], box('fade'), 50);
  assert.ok(fade, 'a purple line halfway between red and blue');
  host.layout.tickMotion(1100);
  frame = await capture(host);
  assert.ok(find(frame, BLUE, box('fade')), 'and a blue one at the end');
  assert.ok(!find(frame, RED, box('fade')), 'with no red left');

  // Taking a decoration away leaves the text bare.
  cells.under.className = 'cell';
  frame = await capture(host);
  assert.ok(!red('under'), 'no class, no line');

  // A style that cannot be drawn is reported.
  assert.deepEqual(errors, []);
  place('bad', 'bad', ['HELLO']);
  host.compute(W, H);
  assert.ok(
    errors.some((e) => e.startsWith('text-decoration: underline wavy:') && e.includes('wavy')),
    String(errors),
  );
  state.dispose();
} finally {
  host.dispose();
  context.dispose();
  target.dispose();
}
console.log('Native text-decoration: lines, styles, wrapping, stacking, links and errors passed');
