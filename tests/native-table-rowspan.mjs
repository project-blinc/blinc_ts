import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { compileCss, loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { ThemeState, neutralTheme } from '../dist/theme/index.js';
import { addUserAgent } from '../dist/theme/user-agent.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative();
const W = 420;
const H = 320;
const output = new URL('../.blinc/table-rowspan/', import.meta.url);
await mkdir(output, { recursive: true });
const css = `
:root {background:black;}
table {position:absolute;left:20px;top:20px;width:280px;border:0;border-radius:0;overflow:visible;}
tr {background:#00ff00;border:0;min-height:24px;}
td,th {padding:4px;} td {background:#0000ff;}
.a {background:#ff0000;min-height:120px;} .b {min-height:32px;}
.c {background:#00ffff;min-height:70px;} .e {background:#ff8000;}
tbody > tr:hover {background:#ff00ff;}
tbody > tr > td:first-child {text-transform:uppercase;}
`;
const near = (a, b, label) => assert(Math.abs(a - b) <= 1, `${label}: ${a} vs ${b}`);
const bottom = (element) => element.bounds()[1] + element.bounds()[3];
function scene(compiled = false) {
  const host = Host.create(native);
  const graph = native.createReactive();
  new ThemeState(graph, neutralTheme, { scheme: 'light' }).attach(host.layout);
  addUserAgent(host.layout);
  const errors = [];
  host.onStyleErrors((items) => errors.push(...items));
  host.layout.addStyleSheet(compiled ? compileCss(css).bytes : css);
  const el = (tag, attrs = {}, children = []) => {
    const element = host.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      element.setAttribute(key, value);
    }
    for (const child of children) {
      element.appendChild(typeof child === 'string' ? host.createTextNode(child) : child);
    }
    return element;
  };
  const a = el('td', { class: 'a', rowspan: '3' });
  const b = el('td', { class: 'b', colspan: '2' });
  const c = el('td', { class: 'c', rowspan: '2' });
  const d = el('td');
  const e = el('td', { class: 'e' });
  const rows = [el('tr', {}, [a, b]), el('tr', {}, [c, d]), el('tr', {}, [e])];
  const body = el('tbody', {}, rows);
  const table = el('table', {}, [
    el('colgroup', {}, [
      el('col', { width: '80' }),
      el('col', { width: '90' }),
      el('col', { width: '110' }),
    ]),
    body,
  ]);
  host.root.appendChild(table);
  const compute = (width = W) => host.compute(width, H);
  const dispose = () => {
    host.dispose();
    graph.dispose();
  };
  return { host, errors, el, table, body, rows, a, b, c, d, e, compute, dispose };
}
for (const scale of [1, 2]) {
  const target = await OffscreenRenderer.create(native, W * scale, H * scale, probeShader);
  let reference;
  try {
    for (const compiled of [false, true]) {
      const s = scene(compiled);
      const renderer = new SceneRenderer(target.device, s.host.layout);
      const draw = async (name) => {
        s.compute();
        const pixels = new Uint8Array(W * H * scale * scale * 4);
        await target.captureCommandsInto(
          pixels,
          (encoder, view) =>
            renderer.encode(encoder, s.host.root.layoutNode, view, {
              width: W * scale,
              height: H * scale,
              scale,
            }).drawCalls,
        );
        await writeFile(
          new URL(`${name}-${compiled ? 'compiled' : 'runtime'}-${scale}x.png`, output),
          PNG.sync.write({ width: W * scale, height: H * scale, data: Buffer.from(pixels) }),
        );
        return pixels;
      };
      const pixel = (pixels, x, y) => {
        const i = (Math.floor(y * scale) * W * scale + Math.floor(x * scale)) * 4;
        return [...pixels.slice(i, i + 4)];
      };
      try {
        s.compute();
        const [ax, ay, aw, ah] = s.a.bounds();
        near(aw, 80, 'first column width');
        near(s.c.bounds()[0], ax + 80, 'second row skips an occupied column');
        near(s.e.bounds()[0], ax + 170, 'third row skips both occupied columns');
        near(s.b.bounds()[2], 200, 'colspan keeps both column widths');
        near(ah, bottom(s.rows[2]) - ay, 'rowspan 3 covers all tracks');
        near(s.c.bounds()[3], bottom(s.rows[2]) - s.c.bounds()[1], 'rowspan 2 covers its tracks');
        assert(ah >= 120, 'span content contributes its minimum height');
        const snapshot = await draw('spans');
        if (reference) {
          assert.equal(Buffer.compare(snapshot, reference), 0, 'runtime/compiled pixels match');
        } else {
          reference = snapshot;
        }
        const y = s.rows[2].bounds()[1] + s.rows[2].bounds()[3] / 2;
        assert.deepEqual(
          pixel(snapshot, ax + 20, y),
          [255, 0, 0, 255],
          'later backgrounds stay below spans',
        );
        assert.equal(s.host.elementAt(ax + 20, y), s.a, 'a press reaches the span');
        const hits = s.host.layout.hitTest(s.host.root.layoutNode, ax + 20, y);
        assert.equal(hits[0].nodeId, s.a.layoutNode.id);
        assert.equal(
          hits[1].nodeId,
          s.rows[0].layoutNode.id,
          'hit ancestry keeps the original row',
        );
        assert.equal(s.a.parentNode, s.rows[0]);
        assert.equal(s.rows[0].firstChild, s.a);
        assert.equal(
          s.host.declaredOf(s.a).get('text-transform'),
          'uppercase',
          'structural selectors match',
        );
        s.host.input.pointerMove(s.e.bounds()[0] + 10, y);
        assert(s.rows[2].interaction.hover, 'hover follows the hit row');
        assert.deepEqual(pixel(await draw('hover'), ax + 20, y), [255, 0, 0, 255]);
        let clicked = false;
        s.rows[0].addEventListener('click', (event) => {
          clicked = event.target === s.a;
        });
        s.host.input.pointerMove(ax + 20, y);
        s.host.input.pointerDown();
        s.host.input.pointerUp();
        assert(clicked, 'span clicks bubble through their authored row');
        s.rows[0].setProperty('transform', 'translateX(10px)');
        assert.deepEqual(pixel(await draw('transformed'), ax + 30, y), [255, 0, 0, 255]);
        assert.equal(s.host.elementAt(ax + 30, y), s.a, 'row transforms reach spanning cells');
        assert.notEqual(s.host.elementAt(ax + 5, y), s.a, 'transformed hit edges move');
        s.rows[0].setProperty('transform', null);
        s.rows[0].setProperty('overflow', 'hidden');
        assert.notDeepEqual(pixel(await draw('clipped'), ax + 20, y), [255, 0, 0, 255]);
        assert.notEqual(s.host.elementAt(ax + 20, y), s.a, 'authored row clips still apply');
        s.rows[0].setProperty('overflow', 'visible');
        s.rows[0].setProperty('opacity', '0.5');
        const faded = pixel(await draw('opacity'), ax + 20, y);
        assert(
          faded[0] >= 126 && faded[0] <= 129 && faded[1] >= 126 && faded[1] <= 129,
          `row opacity composites its spanning content once: ${faded}`,
        );
        s.rows[0].setProperty('opacity', null);
        s.a.setAttribute('rowspan', '1');
        s.c.removeAttribute('rowspan');
        s.compute();
        near(s.c.bounds()[0], ax, 'span reset releases its slot');
        near(s.e.bounds()[0], ax, 'ordinary row placement is restored');
        s.a.setAttribute('rowspan', '0');
        s.c.setAttribute('rowspan', '2');
        s.compute();
        near(s.a.bounds()[3], bottom(s.rows[2]) - s.a.bounds()[1], 'zero reaches the group end');
        s.rows[1].setAttribute('hidden', '');
        s.compute();
        assert.equal(s.rows[1].bounds()[3], 0);
        near(s.e.bounds()[0], ax + 80, 'hidden cells leave no occupied columns');
        s.rows[1].removeAttribute('hidden');
        s.compute();
        near(s.e.bounds()[0], ax + 170, 'unhiding restores slots');
        s.c.setAttribute('hidden', '');
        s.compute();
        near(s.e.bounds()[0], ax + 80, 'hidden spanning cells release their slots');
        s.c.removeAttribute('hidden');
        s.compute();
        near(s.e.bounds()[0], ax + 170, 'visible spanning cells reclaim their slots');
        s.body.setAttribute('hidden', '');
        s.compute();
        assert.equal(s.body.bounds()[3], 0, 'hidden row groups keep their subtree hidden');
        assert.equal(s.a.bounds()[3], 0);
        s.body.removeAttribute('hidden');
        s.compute();
        near(s.e.bounds()[0], ax + 170, 'visible row groups restore placement');
        const extra = s.el('td', { class: 'e' });
        const extraRow = s.el('tr', {}, [extra]);
        s.body.appendChild(extraRow);
        s.compute();
        near(extra.bounds()[0], ax + 80, 'zero extends to an appended row');
        near(extra.bounds()[2], 90, 'new row gets the existing template');
        extraRow.destroy();
        s.compute();
        assert.deepEqual(s.errors, []);
        s.table.destroy();
        s.compute();
        assert.equal(s.host.layout.size, 1, 'grid resources leave with the table');
      } finally {
        renderer.dispose();
        s.dispose();
      }
    }
  } finally {
    target.dispose();
  }
}
const s = scene();
try {
  s.table.destroy();
  const spanning = s.el('td', { rowspan: '20' }, ['left']);
  const last = s.el('td', {}, ['wide words beside the span']);
  const middle = s.el('td', {}, ['a']);
  const body = s.el('tbody', {}, [s.el('tr', {}, [spanning, middle]), s.el('tr', {}, [last])]);
  const footCell = s.el('td', {}, ['footer']);
  const foot = s.el('tfoot', {}, [s.el('tr', {}, [footCell, s.el('td', {}, ['x'])])]);
  const table = s.el('table', {}, [body, foot]);
  s.host.root.appendChild(table);
  s.compute();
  near(last.bounds()[0], middle.bounds()[0], 'content sizing follows occupied slots');
  near(last.bounds()[2], middle.bounds()[2], 'content columns still align');
  near(spanning.bounds()[3], body.bounds()[3], 'oversized spans stop at sections');
  near(footCell.bounds()[0], spanning.bounds()[0], 'footer starts a new group');
  const oldHeight = table.bounds()[3];
  last.firstChild.data = Array(10).fill('a much longer wrapping run').join(' ');
  s.compute();
  assert(table.bounds()[3] > oldHeight, 'text changes reflow shared rows');
  const settled = table.bounds();
  s.compute();
  assert.deepEqual(table.bounds(), settled, 'quiet layout stays stable');
  s.compute(350);
  table.setProperty('width', '80%');
  s.compute(350);
  const smaller = table.bounds()[2];
  s.compute(420);
  assert(table.bounds()[2] > smaller, 'shared groups follow viewport percentage resizing');
  near(last.bounds()[0], middle.bounds()[0], 'resized content columns still align');
  assert.deepEqual(s.errors, []);
} finally {
  s.dispose();
}
console.log(
  'Native table rowspan: tracks, colspan, pixels/hits, visibility, edits, groups and cleanup passed',
);
process.exit(0);
