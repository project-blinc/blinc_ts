// Feature and container guards settle before the first painted frame, in both sheet formats.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { compileCss, loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative(process.env.BLINC_CONDITIONAL_ADDON);
const W = 600;
const H = 300;
const output = new URL('../.blinc/css-conditions/', import.meta.url);
await mkdir(output, { recursive: true });

const base = `
  :root { background: #101722; color: white; }
  .panel { position: absolute; left: 20px; top: 20px; width: 224px;
    padding: 10px; border: 2px solid #778899; background: #203040;
    flex-direction: column; font-size: 20px; }
  .card { width: 100%; flex-direction: column; gap: 4px; }
  .chip { width: 80px; height: 24px; flex-shrink: 0; background: #4488ff; }
  .second { background: #44cc88; }
  .label { width: 100%; font-size: 16px; line-height: 1.2; }
  .support { position: absolute; left: 20px; top: 200px; width: 10px; height: 10px; background: red; }
`;
const guards = `
  .panel { container: Panel / inline-size; }
  @supports (display: grid) and (width: calc(100% - 1rem)) and (font-size: calc(120% + 1px)) and (content: attr(data-label)) {
    .support { width: 40px; background: #ffaa44; }
    @media (min-width: 500px) { .support { height: 20px; } }
  }
  @supports (display: made-up) { .support { width: 90px; } }
  @supports (unknown-property: 1) { .support { height: 90px; } }
  @supports (width: inherit) { .support { width: 90px; } }
  @supports not (display: made-up) { .support { border-radius: 4px; } }
  @container Panel (width > 300px) { .card { flex-direction: row; } }
  @container future(foo) { .support { width: 90px; } }
`;

function make(compiled, conditional) {
  const host = Host.create(native);
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  const add = (source) => {
    const input = compiled ? compileCss(source) : { bytes: source, diagnostics: [] };
    assert.deepEqual(input.diagnostics, []);
    const result = host.layout.addStyleSheet(input.bytes);
    assert.deepEqual(result.diagnostics, []);
    return result;
  };
  add(base);
  const guardSheet = add(
    conditional
      ? guards
      : '.support { width: 40px; height: 20px; background: #ffaa44; border-radius: 4px; }',
  );
  const element = (classes) => {
    const node = host.createElement('div');
    node.className = classes;
    return node;
  };
  const panel = element('panel');
  const card = element('card');
  const first = element('chip');
  const second = element('chip second');
  first.appendChild(host.createTextNode('One'));
  second.appendChild(host.createTextNode('Two'));
  card.appendChild(first);
  card.appendChild(second);
  panel.appendChild(card);
  const label = element('label');
  label.appendChild(host.createTextNode('Container width decides how these words wrap.'));
  panel.appendChild(label);
  host.root.appendChild(panel);
  const support = element('support');
  host.root.appendChild(support);
  return { host, errors, panel, card, first, second, support, guardSheet };
}

for (const scale of [1, 2]) {
  const target = await OffscreenRenderer.create(native, W * scale, H * scale, probeShader);
  const capture = async (scene) => {
    scene.host.compute(W, H);
    const renderer = new SceneRenderer(target.device, scene.host.layout);
    const pixels = new Uint8Array(W * H * scale * scale * 4);
    try {
      await target.captureCommandsInto(
        pixels,
        (encoder, view) =>
          renderer.encode(encoder, scene.host.root.layoutNode, view, {
            width: W * scale,
            height: H * scale,
            scale,
          }).drawCalls,
      );
      assert.deepEqual(scene.errors, []);
      return pixels;
    } finally {
      renderer.dispose();
    }
  };
  try {
    for (const compiled of [false, true]) {
      const actual = make(compiled, true);
      const expected = make(compiled, false);
      try {
        const compare = async (name, width, horizontal, extra = '') => {
          for (const scene of [actual, expected]) {
            scene.panel.setAttribute('style', `width: ${width}px; ${extra}`);
          }
          expected.card.setAttribute('style', `flex-direction: ${horizontal ? 'row' : 'column'}`);
          const pixels = await capture(actual);
          const reference = await capture(expected);
          assert.deepEqual(actual.first.bounds(), expected.first.bounds(), `${name}: first box`);
          assert.deepEqual(actual.second.bounds(), expected.second.bounds(), `${name}: second box`);
          for (const [label, data] of [
            ['actual', pixels],
            ['expected', reference],
          ]) {
            await writeFile(
              new URL(
                `${name}-${compiled ? 'compiled' : 'runtime'}-${scale}x-${label}.png`,
                output,
              ),
              PNG.sync.write({ width: W * scale, height: H * scale, data: Buffer.from(data) }),
            );
          }
          assert.ok(
            Buffer.from(pixels).equals(Buffer.from(reference)),
            `${name}: exact ${scale}x pixels`,
          );
          assert.deepEqual(
            actual.support.bounds(),
            [20, 200, 40, 20],
            'feature and nested media guards',
          );
        };
        await compare('narrow', 224, false);
        await compare('wide', 424, true);
        await compare('narrow-again', 224, false);
        await compare('fractional-threshold', 324.25, true);
        await compare('exact-threshold', 324, false);
        await compare('renamed', 424, false, 'container-name: Other');
        await compare('name-restored', 424, true);
        await compare('type-reset', 424, false, 'container-type: normal');
        await compare('type-restored', 424, true);
        actual.host.layout.removeStyleSheet(actual.guardSheet);
        actual.host.compute(W, H);
        assert.equal(
          actual.second.bounds()[0],
          actual.first.bounds()[0],
          'removing the guarded sheet restores a column',
        );
        assert.deepEqual(actual.support.bounds(), [20, 200, 10, 10]);
        assert.deepEqual(actual.errors, []);
      } finally {
        actual.host.dispose();
        expected.host.dispose();
      }
    }
  } finally {
    target.dispose();
  }
}

// Names, required axes, fonts and reparenting all affect native ancestor selection.
for (const compiled of [false, true]) {
  const host = Host.create(native);
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  const css = `
    .outer { container: Panel / size; width: 400px; height: 180px; font-size: 20px; align-items: start; }
    .inner { container: Other / inline-size; width: 100px; height: 50px; align-items: start; }
    .metric { width: 1px; height: 1px; }
    @container Panel (width >= 20em) { .metric { width: 10px; } }
    @container (height > 100px) { .metric { height: 10px; } }
    @container Panel (width > 0px) { .outer { min-width: 500px; } }
  `;
  host.layout.addStyleSheet(compiled ? compileCss(css).bytes : css);
  const outer = host.createElement('div');
  outer.className = 'outer';
  const inner = host.createElement('div');
  inner.className = 'inner';
  const metric = host.createElement('div');
  metric.className = 'metric';
  host.root.appendChild(outer);
  outer.appendChild(inner);
  inner.appendChild(metric);
  const size = () => {
    host.compute(W, H);
    return metric.bounds().slice(2);
  };
  assert.deepEqual(
    size(),
    [10, 10],
    'named query skips Other; height skips an inline-size container',
  );
  assert.equal(outer.bounds()[2], 400, 'a container cannot select itself');
  outer.setProperty('font-size', '21px');
  assert.deepEqual(size(), [1, 10], 'em follows the container font, with no size change');
  outer.setProperty('font-size', null);
  assert.deepEqual(size(), [10, 10]);
  host.root.appendChild(metric);
  assert.deepEqual(size(), [1, 1], 'moving outside the container removes both guards');
  inner.appendChild(metric);
  assert.deepEqual(size(), [10, 10], 'moving back restores the eligible ancestor');
  outer.setProperty('container-type', 'inline-size');
  assert.deepEqual(size(), [10, 1], 'height queries require size containment');
  outer.setProperty('display', 'none');
  assert.deepEqual(size(), [0, 0]);
  outer.setProperty('display', null);
  assert.deepEqual(size(), [10, 1], 'a newly visible principal box is queried again');
  assert.deepEqual(errors, []);
  host.dispose();
}

// Detached retained nodes belong to a different root until they are reinserted.
{
  const host = Host.create(native);
  host.layout.addStyleSheet(`
    .panel { position: absolute; container-type: inline-size; width: 400px; height: 50px; align-items: start; }
    .box { width: 10px; height: 10px; }
    @container (width > 50vw) { .box { height: 20px; } }
  `);
  const panels = [],
    boxes = [];
  for (let i = 0; i < 2; i++) {
    const panel = host.createElement('div');
    panel.className = 'panel';
    const box = host.createElement('div');
    box.className = 'box';
    panel.appendChild(box);
    host.root.appendChild(panel);
    panels.push(panel);
    boxes.push(box);
  }
  host.compute(600, H);
  assert.deepEqual(
    boxes.map((box) => box.bounds()[3]),
    [20, 20],
  );
  host.root.removeChild(panels[1]);
  host.compute(1000, H);
  assert.equal(
    boxes[0].bounds()[3],
    10,
    'a detached pending query cannot keep the visible root settling',
  );
  host.root.appendChild(panels[1]);
  host.compute(1000, H);
  assert.deepEqual(
    boxes.map((box) => box.bounds()[3]),
    [10, 10],
  );
  host.compute(600, H);
  assert.deepEqual(
    boxes.map((box) => box.bounds()[3]),
    [20, 20],
  );
  host.dispose();
}

// More query levels than the independent host-listener limit must settle in one compute.
{
  const host = Host.create(native);
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  host.layout.addStyleSheet(`
    .outer { container-type: inline-size; width: 200px; height: 200px; align-items: start; }
    .level { container-type: inline-size; width: 20px; height: 20px; flex-shrink: 0; align-items: start; }
    @container (width >= 100px) { .level { width: 200px; } }
  `);
  const outer = host.createElement('div');
  outer.className = 'outer';
  host.root.appendChild(outer);
  let parent = outer;
  const levels = [];
  for (let i = 0; i < 12; i++) {
    const child = host.createElement('div');
    child.className = 'level';
    parent.appendChild(child);
    levels.push(child);
    parent = child;
  }
  host.compute(W, H);
  assert.ok(
    levels.every((node) => node.bounds()[2] === 200),
    'all nested queries settle before paint',
  );
  assert.deepEqual(errors, []);
  host.dispose();
}
console.log(
  'Native conditional CSS: features, nested media, container thresholds, resets, settling and runtime/compiled 1x/2x pixels passed',
);
