import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { compileCss, loadNative } from '../dist/native/index.js';
import { Host, HostElement } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative();
const W = 320;
const H = 200;
const sheet = `
:root { --accent: #3d7eff; }
.app { display: flex; flex-direction: column; width: 100%; height: 100%; padding: 1rem; gap: 8px; background: #101722; color: #e8eef5; }
.row { display: flex; flex-direction: row; gap: 0.5em; font-size: 20px; height: 3em; }
.card { flex-grow: 1; padding: 4px 8px; border-radius: 6px; background: var(--card, #243447); }
.card:first-child { background: var(--accent); }
.card.big { font-size: 24px; font-weight: 700; }
.hot:hover { background: #ff6b6b; }
@media (max-width: 200px) { .row { flex-direction: column; } }
`;
// The same scene, its declarations written as properties on each element.
const explicit = {
  app: {
    display: 'flex',
    'flex-direction': 'column',
    width: '100%',
    height: '100%',
    padding: '16px',
    gap: '8px',
    background: '#101722',
    color: '#e8eef5',
  },
  row: {
    display: 'flex',
    'flex-direction': 'row',
    gap: '10px',
    'font-size': '20px',
    height: '60px',
  },
  first: { 'flex-grow': 1, padding: '4px 8px', 'border-radius': '6px', background: '#3d7eff' },
  card: { 'flex-grow': 1, padding: '4px 8px', 'border-radius': '6px', background: '#243447' },
  big: { 'font-size': '24px', 'font-weight': 700 },
};

function build(host, styled) {
  const make = (tag, classes, props, children) => {
    const element = host.createElement(tag);
    if (styled) {
      element.className = classes;
    } else {
      for (const set of props) {
        for (const [name, value] of Object.entries(set)) {
          element.setProperty(name, value);
        }
      }
    }
    for (const child of children) {
      element.appendChild(child);
    }
    return element;
  };
  const text = (data) => host.createTextNode(data);
  const app = make(
    'div',
    'app',
    [explicit.app],
    [
      make(
        'div',
        'row',
        [explicit.row],
        [
          make('div', 'card hot', [explicit.first], [text('One')]),
          make('div', 'card big', [explicit.card, explicit.big], [text('Two')]),
          make('div', 'card', [explicit.card], [text('Three')]),
        ],
      ),
      text('Footer'),
    ],
  );
  host.root.appendChild(app);
  return app;
}
function geometry(node) {
  const [x, y, w, h] = node.bounds();
  return {
    bounds: [x, y, w, h].map((v) => Math.round(v * 100) / 100),
    children:
      node instanceof HostElement ? node.childNodes.map((child) => geometry(child)) : undefined,
  };
}
const target = await OffscreenRenderer.create(native, W, H, probeShader);
async function capture(host) {
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
    return Buffer.from(pixels);
  } finally {
    renderer.dispose();
  }
}
const output = new URL('../.blinc/css/', import.meta.url);
await mkdir(output, { recursive: true });
try {
  // A sheet and explicit properties give the same layout and pixels.
  const plain = Host.create(native);
  build(plain, false);
  const plainPixels = await capture(plain);
  const plainGeometry = geometry(plain.root);

  const styled = Host.create(native);
  const errors = [];
  styled.onStyleErrors((e) => errors.push(...e));
  const added = styled.layout.addStyleSheet(sheet, { file: 'scene.css' });
  assert.deepEqual(added.diagnostics, []);
  const app = build(styled, true);
  const styledPixels = await capture(styled);
  assert.deepEqual(errors, []);
  assert.deepEqual(geometry(styled.root), plainGeometry, 'Same layout');
  await writeFile(
    new URL('sheet.png', output),
    PNG.sync.write({ width: W, height: H, data: styledPixels }),
  );
  await writeFile(
    new URL('explicit.png', output),
    PNG.sync.write({ width: W, height: H, data: plainPixels }),
  );
  assert(styledPixels.equals(plainPixels), 'Same pixels');

  // Compiled bytes load without parsing and style the same.
  const compiled = compileCss(sheet, { file: 'scene.css' });
  assert.deepEqual(compiled.diagnostics, []);
  assert.deepEqual([...compiled.classes].sort(), ['app', 'big', 'card', 'hot', 'row']);
  assert.deepEqual(compiled.variables, ['accent']);
  const fromBytes = Host.create(native);
  fromBytes.layout.addStyleSheet(compiled.bytes);
  build(fromBytes, true);
  assert((await capture(fromBytes)).equals(styledPixels), 'Compiled bytes style the same');

  // Hover restyles only what tested it; the theme answers var() the sheets leave open.
  const [row] = app.childNodes;
  const [first, second] = row.childNodes;
  const [x, y, w, h] = first.bounds();
  styled.input.pointerMove(x + w / 2, y + h / 2);
  const hovered = await capture(styled);
  const red = (pixels, px, py) => pixels[(Math.round(py) * W + Math.round(px)) * 4];
  assert(red(hovered, x + 2, y + h / 2) > 200, 'Hovered card turns red');
  styled.layout.setTheme({ '--card': '#336633' });
  const themed = await capture(styled);
  const [sx, sy] = second.bounds();
  const g = (pixels) => pixels[(Math.round(sy + 2) * W + Math.round(sx + 2)) * 4 + 1];
  assert(g(themed) > g(hovered), 'The theme variable recolors the cards');

  // Media queries follow the viewport; removing the sheet unsets what it gave.
  styled.compute(180, H);
  const [, b] = [first.bounds(), second.bounds()];
  assert.equal(b[0], first.bounds()[0], 'Narrow viewport stacks the row');
  assert(styled.layout.removeStyleSheet(added));
  assert.equal(styled.layout.removeStyleSheet(added), false);
  styled.compute(W, H);
  assert.notDeepEqual(geometry(styled.root), plainGeometry);

  // A sheet with errors reports them with positions; the rest applies.
  const broken = Host.create(native);
  const bad = broken.layout.addStyleSheet('.a { width: 10px }\n.b { color: red\n', {
    file: 'bad.css',
  });
  assert(
    bad.diagnostics.some((d) => d.severity === 'error' && d.line >= 2 && d.column >= 1),
    JSON.stringify(bad.diagnostics),
  );
  const compiledBad = compileCss('.a {\n  width: 10px;\n}\n.b { color', { file: 'bad.css' });
  assert(compiledBad.diagnostics.some((d) => d.severity === 'error'));

  // An element with no class, attribute or inline style is still matched by type, universal and
  // structural selectors.
  {
    const bare = Host.create(native);
    bare.layout.addStyleSheet(
      'section { width: 50px } aside > b { width: 60px } i:first-child { width: 70px }',
    );
    const make = (tag, children = []) => {
      const element = bare.createElement(tag);
      children.forEach((child) => element.appendChild(child));
      return element;
    };
    const section = make('section');
    const inner = make('b');
    const aside = make('aside', [inner]);
    const first = make('i');
    bare.root.appendChild(make('div', [section, aside, make('div', [first])]));
    bare.compute(W, H);
    assert.equal(section.bounds()[2], 50, 'a bare tag matches a type selector');
    assert.equal(inner.bounds()[2], 60, 'and a child combinator');
    assert.equal(first.bounds()[2], 70, 'and a structural pseudo-class');
    bare.dispose();
  }

  // Comments and empty text are placeholders a framework keeps between nodes: they are not
  // siblings a structural selector counts, and they take no room.
  {
    const bare = Host.create(native);
    bare.layout.addStyleSheet(
      '.row { flex-direction: row; gap: 10px } .row > i { width: 20px; height: 10px } .row > i:first-child { width: 50px } .row > i:nth-child(2) { width: 70px } .row > i:last-child { height: 30px }',
    );
    const row = bare.createElement('div');
    row.className = 'row';
    bare.root.appendChild(row);
    row.appendChild(bare.createComment('['));
    const one = row.appendChild(bare.createElement('i'));
    row.appendChild(bare.createComment(']'));
    row.appendChild(bare.createTextNode(''));
    const two = row.appendChild(bare.createElement('i'));
    const three = row.appendChild(bare.createElement('i'));
    bare.compute(W, H);
    assert.equal(one.bounds()[2], 50, 'the first element is :first-child behind a comment');
    assert.equal(two.bounds()[2], 70, 'the second counts only elements');
    assert.equal(three.bounds()[3], 30, 'and the last is :last-child');
    assert.equal(two.bounds()[0] - (one.bounds()[0] + one.bounds()[2]), 10, 'no room is taken');
    bare.dispose();
  }

  for (const host of [plain, styled, fromBytes, broken]) {
    host.dispose();
  }
} finally {
  target.dispose();
}
console.log(
  'Native CSS: sheets match explicit properties, compiled bytes, states, theme, media, bare-element selectors and diagnostics passed',
);
