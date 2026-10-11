// CSS length expressions must agree with explicit lengths in geometry and pixels.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { compileCss, loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative(process.env.BLINC_CALC_ADDON);
const W = 320;
const H = 220;
const output = new URL('../.blinc/css-calc/', import.meta.url);
await mkdir(output, { recursive: true });

function sheet(math, width, pad) {
  return `
    :root { background: #101722; color: #ffffff; font-size: 16px; }
    .app { position: absolute; left: 16px; top: 16px; display: flex;
      flex-direction: column; width: ${math ? 'calc(100vw - 2rem)' : `${width - 32}px`};
      padding: ${math ? 'calc(var(--pad) / 1)' : `${pad}px`};
      gap: ${math ? 'max(2px, calc(1rem / 2))' : '8px'};
      font-size: ${math ? 'calc(1em + 2px)' : '18px'}; }
    .card { display: flex; flex-direction: column; flex-shrink: 0;
      width: ${math ? 'calc(100% / 2)' : '50%'};
      height: ${math ? 'min(80px, calc(3rem + 12px))' : '60px'};
      border: ${math ? 'calc(1px + 2px)' : '3px'} solid #4488ff;
      border-radius: ${math ? 'min(12px, 1rem)' : '12px'};
      padding: ${math ? 'calc(1px + 2px) calc(1rem / 4)' : '3px 4px'};
      background: #243447; }
    .label { font-size: ${math ? 'calc(150% + 1px)' : '28px'}; }
    .own text { font-size: ${math ? 'clamp(14px, 5vw, 20px)' : `${Math.max(14, Math.min(20, width * 0.05))}px`}; }
    @media (max-width: ${math ? 'calc(20rem - 20px)' : '300px'}) {
      .card { background: #336633; }
    }
  `;
}

function build(css, pad) {
  const host = Host.create(native);
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  const added = host.layout.addStyleSheet(css);
  assert.deepEqual(added.diagnostics, []);
  host.layout.setTheme({ '--pad': `${pad}px` });
  const app = host.createElement('div');
  app.className = 'app';
  const card = host.createElement('div');
  card.className = 'card';
  const label = host.createElement('div');
  label.className = 'label';
  label.appendChild(host.createTextNode('Calc'));
  const own = host.createElement('div');
  own.className = 'own';
  own.appendChild(host.createTextNode('own text rule'));
  card.appendChild(label);
  app.appendChild(card);
  app.appendChild(own);
  host.root.appendChild(app);
  return { host, errors, app, card, label, own, added };
}

function geometry(node) {
  return {
    bounds: node.bounds(),
    children: node.childNodes?.map(geometry),
  };
}

for (const scale of [1, 2]) {
  const target = await OffscreenRenderer.create(native, W * scale, H * scale, probeShader);
  async function capture(scene, width) {
    scene.host.compute(width, H);
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
  }
  try {
    for (const width of [320, 280]) {
      for (const compiled of [false, true]) {
        const css = sheet(true, width, 8);
        const bytes = compileCss(css, { addon: process.env.BLINC_CALC_ADDON });
        assert.deepEqual(bytes.diagnostics, []);
        const actual = build(compiled ? bytes.bytes : css, 8);
        const expected = build(sheet(false, width, 8), 8);
        try {
          const pixels = await capture(actual, width);
          const reference = await capture(expected, width);
          assert.deepEqual(geometry(actual.host.root), geometry(expected.host.root));
          assert.deepEqual(pixels, reference, `Expressions match explicit lengths at ${scale}x`);
          assert.equal(actual.host.textStyleOf(actual.label.firstChild).fontSize, 28);
          assert.equal(actual.host.textStyleOf(actual.own.firstChild).fontSize, width * 0.05);
          if (!compiled && width === 320) {
            await writeFile(
              new URL(`expressions-${scale}x.png`, output),
              PNG.sync.write({ width: W * scale, height: H * scale, data: Buffer.from(pixels) }),
            );
          }
          // Changing a variable re-evaluates the expression without rebuilding the tree.
          actual.host.layout.setTheme({ '--pad': '12px' });
          expected.host.layout.removeStyleSheet(expected.added);
          expected.host.layout.addStyleSheet(sheet(false, width, 12));
          assert.deepEqual(await capture(actual, width), await capture(expected, width));
          assert.deepEqual(geometry(actual.host.root), geometry(expected.host.root));
        } finally {
          actual.host.dispose();
          expected.host.dispose();
        }
      }
    }
  } finally {
    target.dispose();
  }
}

// A bad expression is reported, and other declarations still apply.
for (const [property, value] of [
  ['width', 'calc(1px / 0)'],
  ['width', 'calc(1e308px * 1e308)'],
  ['width', 'calc(100% - 32px)'],
  ['width', 'min(50%, 20px)'],
  ['font-size', 'calc(1px / 0)'],
  ['font-size', 'calc(-1px)'],
  ['font-size', 'calc(1px) extra'],
]) {
  const host = Host.create(native);
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  try {
    host.layout.addStyleSheet(`.bad { ${property}: ${value}; height: 24px; background: red; }`);
    const bad = host.createElement('div');
    bad.className = 'bad';
    host.root.appendChild(bad);
    host.compute(W, H);
    assert(
      errors.some((e) => e.includes(property) && e.includes(value)),
      errors.join('\n'),
    );
    assert.equal(bad.bounds()[3], 24);
  } finally {
    host.dispose();
  }
}

console.log(
  'Native CSS math: runtime/compiled sheets, font inheritance, theme, media, errors and 1x/2x pixels passed',
);
