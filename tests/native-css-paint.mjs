import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { loadNative } from '../dist/native/index.js';
import { Brush } from '../dist/native/brush.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative();
const W = 400;
const H = 420;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../.blinc/css-paint/', import.meta.url);
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
const near = (actual, expected, tolerance = 3) =>
  actual.every((c, i) => Math.abs(c - expected[i]) <= tolerance);

const GROUND = [0x20, 0x20, 0x20];
const sheet = `
.lin { background: linear-gradient(to right, #ff0000, #0000ff) }
.rad { background: radial-gradient(circle, #ffffff, #000000) }
.hsl { background: hsl(120 100% 25%) }
.named { background: rebeccapurple }
.glass { background: glass }
.scaled { background: #ffffff; transform: scale(0.5) }
.gray { background: #ff0000; filter: grayscale(1) }
.masked { background: #ffffff; mask-image: linear-gradient(to right, #000000, transparent) }
.current { color: #00ff00; background: linear-gradient(currentcolor, #000000) }
.faded { background: #ffffff; opacity: 0.5 }
.shadowed { background: #ffffff; box-shadow: 0 0 0 6px #ff0000 }
.round { background: #ffffff; border-radius: 12px }
.bad { background: conic-gradient(red, blue); opacity: 0.5 }
.green { background: #00ff00 }
.through { pointer-events: none }
.bordered { background: #ffffff; border: 4px solid #ff0000 }
.leftborder { background: #ffffff; border-left: 6px solid #00ff00 }
.sides { background: #ffffff; border: 4px solid; border-color: #ff0000 #0000ff }
.noborder { background: #ffffff; border: 4px solid #ff0000; border-style: none }
.outlined { background: #ffffff; outline: 4px solid #0000ff; outline-offset: 2px }
.thick { background: #ffffff; border: thick solid #ff0000 }
`;

const context = native.createReactive();
const host = Host.create(native);
try {
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  host.layout.addStyleSheet(sheet);
  host.root.setAttribute('style', `background: #202020`);

  const cells = {};
  const names = [
    'lin',
    'rad',
    'hsl',
    'named',
    'scaled',
    'gray',
    'masked',
    'current',
    'faded',
    'shadowed',
    'round',
    'green',
    'through',
    'bad',
    'bordered',
    'leftborder',
    'sides',
    'noborder',
    'outlined',
    'thick',
  ];
  const place = (name, i, extra = '') => {
    const box = host.createElement('div');
    box.className = name;
    box.setAttribute(
      'style',
      `position: absolute; left: ${20 + (i % 5) * 76}px; top: ${20 + Math.floor(i / 5) * 76}px; width: 60px; height: 60px; ${extra}`,
    );
    const dot = host.createElement('div');
    dot.setAttribute('style', 'width: 6px; height: 6px');
    box.appendChild(dot);
    box.dot = dot;
    host.root.appendChild(box);
    cells[name] = box;
    return box;
  };
  names.forEach((name, i) => place(name, i));

  // Glass over a backdrop of two colours, straddling where they meet.
  const left = host.createElement('div');
  left.setAttribute(
    'style',
    'position: absolute; left: 20px; top: 342px; width: 60px; height: 60px; background: #ff0000',
  );
  const right = host.createElement('div');
  right.setAttribute(
    'style',
    'position: absolute; left: 80px; top: 342px; width: 60px; height: 60px; background: #0000ff',
  );
  const glass = host.createElement('div');
  glass.className = 'glass';
  glass.setAttribute(
    'style',
    'position: absolute; left: 50px; top: 352px; width: 60px; height: 40px',
  );
  for (const e of [left, right, glass]) {
    host.root.appendChild(e);
  }

  const pixels = await capture(host, 'paint');
  const at = (name, dx, dy) => {
    const [x, y] = cells[name].bounds();
    return pixel(pixels, x + dx, y + dy);
  };

  // Gradients run edge to edge along their line, over the box and not the viewport.
  assert.ok(near(at('lin', 2, 30), [255, 0, 0], 12), `gradient start ${at('lin', 2, 30)}`);
  assert.ok(near(at('lin', 57, 30), [0, 0, 255], 12), `gradient end ${at('lin', 57, 30)}`);
  const middle = at('lin', 30, 30);
  assert.ok(
    middle[0] > 90 && middle[0] < 170 && middle[2] > 90 && middle[2] < 170,
    `middle ${middle}`,
  );
  assert.ok(at('rad', 30, 30)[0] > 235, 'a radial gradient is bright at its centre');
  assert.ok(at('rad', 1, 1)[0] < 25, 'and dark at the corner');

  // Colour syntax the old parser did not read.
  assert.ok(near(at('hsl', 30, 30), [0, 128, 0]), `hsl ${at('hsl', 30, 30)}`);
  assert.ok(near(at('named', 30, 30), [0x66, 0x33, 0x99]), 'a named colour');

  // currentcolor is the node's own colour.
  assert.ok(near(at('current', 30, 1), [0, 255, 0], 12), `currentcolor ${at('current', 30, 1)}`);

  // A transform scales about the centre; opacity and a shadow ring draw.
  assert.ok(near(at('scaled', 30, 30), [255, 255, 255]), 'the scaled box keeps its centre');
  assert.ok(near(at('scaled', 3, 3), GROUND), 'and leaves its corner bare');
  const faded = at('faded', 30, 30);
  assert.ok(faded[0] > 130 && faded[0] < 150, `half opacity over the ground: ${faded}`);
  assert.ok(near(at('shadowed', -3, 30), [255, 0, 0], 8), 'a spread shadow draws a ring');

  // A filter acts on the node as drawn.
  const gray = at('gray', 30, 30);
  assert.ok(
    Math.abs(gray[0] - gray[1]) < 8 && Math.abs(gray[1] - gray[2]) < 8,
    `grayscale ${gray}`,
  );

  // A mask fades what it covers from opaque to nothing.
  assert.ok(at('masked', 3, 30)[0] > 200, 'the mask is opaque where it starts');
  assert.ok(
    near(at('masked', 57, 30), GROUND, 25),
    `and clear where it ends ${at('masked', 57, 30)}`,
  );

  // Glass blurs what is behind it: the seam of two colours is a mix, not one of them.
  const [gx, gy] = glass.bounds();
  const seam = pixel(pixels, gx + 30, gy + 20);
  assert.ok(seam[0] > 40 && seam[2] > 40, `glass blurs the seam: ${seam}`);

  // A value that cannot be read is reported with its reason; the rest of its rule applies.
  assert.ok(
    errors.some((e) => e.startsWith('background: conic-gradient(red, blue):')),
    String(errors),
  );
  const bad = at('bad', 30, 30);
  assert.ok(near(bad, [0x20, 0x20, 0x20], 3), `the bad background draws nothing ${bad}`);

  // Borders: the shorthand paints and takes layout space, a side stands over it, and a style of
  // none takes it away.
  const inset = (name) => {
    const [x, y] = cells[name].bounds();
    const [dx, dy] = cells[name].dot.bounds();
    return [dx - x, dy - y];
  };
  assert.ok(near(at('bordered', 1, 30), [255, 0, 0]), `border ${at('bordered', 1, 30)}`);
  assert.ok(near(at('bordered', 30, 30), [255, 255, 255]), 'inside the border is the fill');
  assert.deepEqual(inset('bordered'), [4, 4], 'a border insets its content');
  assert.ok(near(at('leftborder', 1, 30), [0, 255, 0]), 'a left border draws on the left');
  assert.ok(near(at('leftborder', 58, 30), [255, 255, 255]), 'and nowhere else');
  assert.deepEqual(inset('leftborder'), [6, 0]);
  assert.ok(near(at('sides', 30, 1), [255, 0, 0]), 'two colours: the top is the first');
  assert.ok(near(at('sides', 1, 30), [0, 0, 255]), 'the left is the second');
  assert.ok(near(at('noborder', 1, 30), [255, 255, 255]), 'border-style: none draws none');
  assert.deepEqual(inset('noborder'), [0, 0], 'and takes no space');
  assert.ok(near(at('thick', 4, 30), [255, 0, 0]), 'thick is five pixels');
  assert.ok(near(at('thick', 6, 30), [255, 255, 255]));
  assert.deepEqual(inset('thick'), [5, 5]);
  assert.ok(near(at('outlined', -4, 30), [0, 0, 255]), 'an outline rings the box, offset from it');
  assert.ok(near(at('outlined', -1, 30), GROUND, 8), 'with the offset left bare');
  assert.deepEqual(inset('outlined'), [0, 0], 'and takes no space');

  // Pointer events: a node that lets them through is not hit.
  const hit = (name) => {
    const [x, y, w, h] = cells[name].bounds();
    return host.layout
      .hitTest(host.root.layoutNode, x + w / 2, y + h / 2)
      .some((h2) => h2.nodeId === cells[name].layoutNode.id);
  };
  assert.equal(hit('green'), true, 'a node takes the pointer');
  assert.equal(hit('through'), false, 'unless pointer-events is none');

  // What a node loses is unset.
  cells.scaled.className = '';
  cells.lin.className = '';
  const after = await capture(host, 'after');
  const [sx, sy] = cells.scaled.bounds();
  assert.ok(near(pixel(after, sx + 30, sy + 30), GROUND), 'a node with no class has no fill');
  const [lx, ly] = cells.lin.bounds();
  assert.ok(near(pixel(after, lx + 2, ly + 30), GROUND), 'and no gradient');

  // A brush set directly stays over the cascade, and survives it restyling the node.
  const [rx, ry] = cells.round.bounds();
  cells.round.setProperty('background', Brush.solid([1, 0, 0, 1]));
  assert.ok(
    near(pixel(await capture(host), rx + 30, ry + 30), [255, 0, 0]),
    'a direct brush draws',
  );
  cells.round.className = 'round green';
  assert.ok(
    near(pixel(await capture(host), rx + 30, ry + 30), [255, 0, 0]),
    'and is not undone by a restyle',
  );
  cells.round.setProperty('background', null);
  assert.ok(
    near(pixel(await capture(host), rx + 30, ry + 30), [0, 255, 0]),
    'cleared, the cascade shows through',
  );
} finally {
  host.dispose();
  context.dispose();
  target.dispose();
}
console.log(
  'Native CSS paint: gradients, colours, transform, filter, mask, glass, borders, outlines, pointer-events, unset and overrides passed',
);
