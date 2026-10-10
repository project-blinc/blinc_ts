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
const W = 500;
const H = 360;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../.blinc/tables/', import.meta.url);
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
    await writeFile(
      new URL(`${name}.png`, output),
      PNG.sync.write({ width: W, height: H, data: Buffer.from(pixels) }),
    );
  } finally {
    renderer.dispose();
  }
}

const context = native.createReactive();
const host = Host.create(native);
try {
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  const state = new ThemeState(context, neutralTheme, { scheme: 'light' });
  state.attach(host.layout);
  addUserAgent(host.layout);
  const el = (tag, attributes = {}, children = []) => {
    const e = host.createElement(tag);
    for (const [k, v] of Object.entries(attributes)) {
      e.setAttribute(k, v);
    }
    for (const c of children) {
      e.appendChild(typeof c === 'string' ? host.createTextNode(c) : c);
    }
    return e;
  };
  const cell = (tag, text, attributes = {}) => el(tag, attributes, [text]);
  const row = (...cells) => el('tr', {}, cells);
  const settle = () => {
    host.flush();
    host.compute(W, H);
  };
  /** A cell's left edge and width, relative to its table. */
  const box = (table, c) => {
    const [tx] = table.bounds();
    const [x, , w] = c.bounds();
    return [Math.round((x - tx) * 10) / 10, Math.round(w * 10) / 10];
  };
  const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance;

  // Cells line up down the table: as many columns as its widest row has.
  const h1 = cell('th', 'Name');
  const h2 = cell('th', 'Qty');
  const h3 = cell('th', 'Price');
  const a1 = cell('td', 'Apple');
  const a2 = cell('td', '3');
  const a3 = cell('td', '1.20');
  const wide = cell('td', 'spans two', { colspan: '2' });
  const w3 = cell('td', 'x');
  const b1 = cell('td', 'one');
  const b2 = cell('td', 'two');
  const b3 = cell('td', 'three');
  const b4 = cell('td', 'four');
  const fourth = row(b1, b2, b3, b4);
  const table = el('table', { style: 'position: absolute; left: 20px; top: 20px; width: 400px' }, [
    el('thead', {}, [row(h1, h2, h3)]),
    el('tbody', {}, [row(a1, a2, a3), row(wide, w3), fourth]),
  ]);
  host.root.appendChild(table);
  settle();
  const quarter = box(table, b1)[1];
  const origin = box(table, h1)[0];
  assert.ok(quarter > 90 && quarter <= 100, `four equal columns: ${quarter}`);
  for (const [c, at] of [
    [h1, 0],
    [h2, 1],
    [h3, 2],
    [a1, 0],
    [a2, 1],
    [a3, 2],
    [b1, 0],
    [b2, 1],
    [b3, 2],
    [b4, 3],
  ]) {
    assert.ok(near(box(table, c)[0] - origin, at * quarter, 1.5), `column ${at}: ${box(table, c)}`);
    assert.ok(near(box(table, c)[1], quarter, 1.5), `a column's width: ${box(table, c)}`);
  }
  assert.ok(
    near(box(table, wide)[1], quarter * 2, 2),
    `a colspan of 2 is two columns: ${box(table, wide)}`,
  );
  assert.ok(near(box(table, w3)[0], box(table, b3)[0], 1), 'and the cell after it is in the third');
  await capture(host, 'table');

  // A row that goes leaves the widest at three, and the columns widen.
  fourth.parentNode.removeChild(fourth);
  settle();
  const third = box(table, a1)[1];
  assert.ok(third > 125 && third <= 134, `three equal columns: ${third}`);
  assert.ok(near(box(table, wide)[1], third * 2, 2));
  // A cell added to a row, or a colspan changed, lays them out again.
  const extra = cell('td', 'more');
  a3.parentNode.appendChild(extra);
  settle();
  assert.ok(near(box(table, a1)[1], quarter, 1.5), 'a fourth column from a fourth cell');
  assert.ok(near(box(table, extra)[0] - origin, 3 * quarter, 1.5));
  a3.parentNode.removeChild(extra);
  wide.setAttribute('colspan', '3');
  settle();
  assert.ok(near(box(table, a1)[1], quarter, 1.5), 'a wider colspan makes more columns');
  assert.ok(near(box(table, wide)[1], quarter * 3, 2));
  wide.removeAttribute('colspan');
  settle();
  assert.ok(near(box(table, wide)[1], third, 1.5), 'a cell of one column again');
  assert.ok(near(box(table, a1)[1], third, 1.5));

  // Columns given widths: pixels, a percentage, a share of what is left.
  const sized = el('table', { style: 'position: absolute; left: 20px; top: 200px; width: 400px' }, [
    el('colgroup', {}, [
      el('col', { width: '120' }),
      el('col', { width: '25%' }),
      el('col', { width: '2*' }),
      el('col', {}),
    ]),
    el('tbody', {}, [
      row(cell('td', 'a'), cell('td', 'b'), cell('td', 'c'), cell('td', 'd')),
      row(cell('td', 'e'), cell('td', 'f')),
    ]),
  ]);
  host.root.appendChild(sized);
  settle();
  const first = sized.firstChild.nextSibling.firstChild.firstChild;
  const cells = [];
  for (let c = first; c; c = c.nextSibling) {
    cells.push(c);
  }
  const widths = cells.map((c) => box(sized, c)[1]);
  const total = box(sized, sized.firstChild.nextSibling.firstChild)[1] + 0;
  void total;
  assert.ok(near(widths[0], 120, 1), `a width in pixels: ${widths}`);
  const rowWidth = widths.reduce((a, b) => a + b, 0);
  assert.ok(
    near(widths[1], rowWidth * 0.25, 2),
    `a percentage of the row: ${widths} in ${rowWidth}`,
  );
  assert.ok(near(widths[2], 2 * widths[3], 2), `a share, twice another: ${widths}`);
  // A short row has the same columns, the cells it has in the first of them.
  const second = sized.firstChild.nextSibling.firstChild.nextSibling.firstChild;
  assert.ok(near(box(sized, second)[0], 0 + box(sized, first)[0], 1));
  assert.ok(near(box(sized, second)[1], widths[0], 1));
  assert.ok(near(box(sized, second.nextSibling)[1], widths[1], 1));
  // A colgroup with a span and no col stands for that many columns.
  const grouped = el(
    'table',
    { style: 'position: absolute; left: 20px; top: 300px; width: 400px' },
    [el('colgroup', { span: '3' }), el('tbody', {}, [row(cell('td', 'a'), cell('td', 'b'))])],
  );
  host.root.appendChild(grouped);
  settle();
  const [g1, g2] = [
    grouped.firstChild.nextSibling.firstChild.firstChild,
    grouped.firstChild.nextSibling.firstChild.firstChild.nextSibling,
  ];
  assert.ok(near(box(grouped, g1)[1], box(grouped, g2)[1], 1));
  assert.ok(
    box(grouped, g1)[1] < 140,
    `three columns though the row has two cells: ${box(grouped, g1)}`,
  );
  await capture(host, 'sized');
  assert.deepEqual(errors, [], String(errors));
  state.dispose();
} finally {
  host.dispose();
  context.dispose();
  target.dispose();
}
console.log('Native tables: columns, colspan, col widths and changing rows passed');
