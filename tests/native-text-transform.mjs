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
const W = 520;
const H = 600;
const output = new URL('../.blinc/text-transform/', import.meta.url);
await mkdir(output, { recursive: true });
const fixtures = [
  { tag: 'p', mode: 'uppercase', raw: ['Hello Straße'], shown: ['HELLO STRASSE'] },
  { tag: 'button', mode: 'capitalize', raw: ['save my FILE'], shown: ['Save My FILE'] },
  { tag: 'p', mode: 'lowercase', raw: ['HELLO ΟΣ İ'], shown: ['hello ος i\u0307'] },
  {
    tag: 'p',
    mode: 'capitalize',
    raw: ['hello', 'world ', 'another WORD'],
    shown: ['Hello', 'world ', 'Another WORD'],
  },
  { tag: 'p', mode: 'lowercase', raw: ['Ο', 'Σ'], shown: ['ο', 'ς'] },
  {
    tag: 'p',
    mode: 'capitalize',
    raw: ['alphabeticalsupercalifragilistic'],
    shown: ['Alphabeticalsupercalifragilistic'],
    width: 85,
  },
  {
    tag: 'div',
    mode: 'uppercase',
    raw: ['inherited through boxes'],
    shown: ['INHERITED THROUGH BOXES'],
    nested: true,
  },
  {
    tag: 'div',
    mode: 'uppercase',
    raw: ['Keep my Case'],
    shown: ['Keep my Case'],
    nested: true,
    reset: true,
  },
  { tag: 'button', mode: 'capitalize', raw: ['hello', 'world'], shown: ['Hello', 'world'] },
  {
    tag: 'p',
    mode: 'capitalize',
    raw: ['hello', 'world', 'again'],
    shown: ['Hello', 'world', 'again'],
    code: true,
  },
  { tag: 'button', mode: 'uppercase', raw: ['save Straße'], shown: ['SAVE STRASSE'] },
];
const css = (literal) => `
  :root { background:black; color:white; font-size:16px; }
  ${fixtures
    .map(
      (f, i) => `.f${i} {position:absolute;left:20px;top:${12 + i * 56}px;width:${f.width ?? 470}px;
    overflow-wrap:anywhere;${literal ? '' : `text-transform:${f.mode};`}}`,
    )
    .join('\n')}
  .reset {text-transform:none;}
  .late {text-transform:lowercase;}
`;

function scene(compiled, literal = false, first = undefined) {
  const host = Host.create(native);
  const errors = [];
  host.onStyleErrors((items) => errors.push(...items));
  const sheet = host.layout.addStyleSheet(compiled ? compileCss(css(literal)).bytes : css(literal));
  assert.deepEqual(sheet.diagnostics, []);
  const boxes = [];
  for (const [i, f] of fixtures.entries()) {
    const box = host.createElement(f.tag);
    box.className = `f${i}`;
    boxes.push(box);
    let parent = box;
    if (f.nested) {
      parent = host.createElement('div');
      if (f.reset) {
        parent.className = 'reset';
      }
      box.appendChild(parent);
    }
    for (const [j, data] of (literal ? (i === 0 && first ? [first] : f.shown) : f.raw).entries()) {
      let owner = parent;
      if (j > 0) {
        owner = host.createElement(f.code && j === 1 ? 'code' : 'span');
        parent.appendChild(owner);
      }
      owner.appendChild(host.createTextNode(data));
    }
    host.root.appendChild(box);
  }
  return { host, boxes, errors };
}

async function capture(target, host, scale) {
  host.compute(W, H);
  const renderer = new SceneRenderer(target.device, host.layout);
  try {
    const pixels = new Uint8Array(W * H * scale * scale * 4);
    await target.captureCommandsInto(
      pixels,
      (e, v) =>
        renderer.encode(e, host.root.layoutNode, v, {
          width: W * scale,
          height: H * scale,
          scale,
        }).drawCalls,
    );
    return pixels;
  } finally {
    renderer.dispose();
  }
}

for (const scale of [1, 2]) {
  const target = await OffscreenRenderer.create(native, W * scale, H * scale, probeShader);
  const expected = scene(false, true);
  try {
    const literal = await capture(target, expected.host, scale);
    for (const compiled of [false, true]) {
      const actual = scene(compiled);
      try {
        const pixels = await capture(target, actual.host, scale);
        await writeFile(
          new URL(`${compiled ? 'compiled' : 'runtime'}-${scale}x.png`, output),
          PNG.sync.write({ width: W * scale, height: H * scale, data: Buffer.from(pixels) }),
        );
        assert.deepEqual(
          pixels,
          literal,
          'casing before shaping/wrapping matches literal text pixels',
        );
        assert.deepEqual(
          actual.boxes.map((box) => box.bounds()),
          expected.boxes.map((box) => box.bounds()),
        );
        for (const [i, fixture] of fixtures.entries()) {
          assert.equal(
            actual.boxes[i].textContent,
            fixture.raw.join(''),
            'authored text keeps its case',
          );
        }
        assert.deepEqual(actual.errors, []);
        const button = actual.boxes[8];
        button.firstChild.data = '';
        const changed = scene(false, true);
        changed.boxes[8].firstChild.data = '';
        changed.boxes[8].lastChild.firstChild.data = 'World';
        try {
          assert.deepEqual(
            await capture(target, actual.host, scale),
            await capture(target, changed.host, scale),
            'editing a preceding inline run refreshes the next word start',
          );
        } finally {
          changed.host.dispose();
        }
        button.firstChild.data = 'hello';
        assert.deepEqual(await capture(target, actual.host, scale), pixels);
        button.firstChild.destroy();
        const removed = scene(false, true);
        removed.boxes[8].firstChild.destroy();
        removed.boxes[8].lastChild.firstChild.data = 'World';
        try {
          assert.deepEqual(
            await capture(target, actual.host, scale),
            await capture(target, removed.host, scale),
            'destroying a preceding text refreshes surviving inline word starts',
          );
        } finally {
          removed.host.dispose();
        }
        button.insertBefore(actual.host.createTextNode('hello'), button.firstChild);
        assert.deepEqual(await capture(target, actual.host, scale), pixels);
        for (const [value, shown] of [
          ['none', 'Hello Straße'],
          ['lowercase', 'hello straße'],
        ]) {
          actual.boxes[0].setProperty('text-transform', value);
          const reference = scene(false, true, shown);
          try {
            assert.deepEqual(
              await capture(target, actual.host, scale),
              await capture(target, reference.host, scale),
              'late inherited casing changes pixels and layout',
            );
          } finally {
            reference.host.dispose();
          }
        }
        actual.boxes[0].setProperty('text-transform', null);
        assert.deepEqual(
          await capture(target, actual.host, scale),
          pixels,
          'removal restores stylesheet casing',
        );
        actual.boxes[0].classList.add('late');
        const reference = scene(false, true, 'hello straße');
        try {
          assert.deepEqual(
            await capture(target, actual.host, scale),
            await capture(target, reference.host, scale),
            'class restyle refreshes descendants',
          );
        } finally {
          reference.host.dispose();
        }
      } finally {
        actual.host.dispose();
      }
    }
  } finally {
    expected.host.dispose();
    target.dispose();
  }
}

// Editing and copying use source indices even when one letter becomes two visible glyphs.
const moved = Host.create(native);
try {
  moved.layout.addStyleSheet(
    '.upper {text-transform:uppercase;} .lower {text-transform:lowercase;} div {align-items:flex-start;}',
  );
  const upper = moved.createElement('div');
  const lower = moved.createElement('div');
  upper.className = 'upper';
  lower.className = 'lower';
  moved.root.appendChild(upper);
  moved.root.appendChild(lower);
  const text = moved.createTextNode('mmmm');
  for (const [parent, shown] of [
    [upper, 'MMMM'],
    [lower, 'mmmm'],
    [upper, 'MMMM'],
  ]) {
    parent.appendChild(text);
    moved.compute(W, H);
    assert(
      Math.abs(text.bounds()[2] - native.measureText(shown, moved.textStyleOf(text)).width) <= 1,
      'moving text between equally styled parents refreshes inherited presentation',
    );
    assert.equal(text.data, 'mmmm');
  }
} finally {
  moved.dispose();
}

const host = Host.create(native);
const context = native.createReactive();
try {
  new ThemeState(context, neutralTheme, { scheme: 'light' }).attach(host.layout);
  addUserAgent(host.layout);
  const input = host.createElement('input');
  input.setAttribute('style', 'width:300px;text-transform:uppercase;transition:none');
  input.value = 'straße';
  host.root.appendChild(input);
  host.compute(W, H);
  host.input.focus(input);
  input.setSelectionRange(4, 5);
  host.compute(W, H);
  const fields = host.behaviours.textFields;
  const [x] = fields.part(input, 'text').bounds();
  const [caretX] = fields.part(input, 'caret').bounds();
  const text = fields.part(input, 'text').firstChild;
  const expected = native.measureText('STRASSE', host.textStyleOf(text));
  assert(Math.abs(caretX - x - expected.caretAt(6).x) <= 1, 'caret after ß follows both S glyphs');
  host.input.keyDown({
    key: 'c',
    modifiers: {
      shift: false,
      alt: false,
      control: process.platform !== 'darwin',
      meta: process.platform === 'darwin',
    },
  });
  assert.equal(host.clipboard.text(), 'ß', 'copy keeps the source character');
  assert.equal(input.value, 'straße');
  assert.deepEqual([input.selectionStart, input.selectionEnd], [4, 5]);
  input.setProperty('text-transform', 'none');
  host.compute(W, H);
  const [plainX] = fields.part(input, 'caret').bounds();
  const plain = native.measureText('straße', host.textStyleOf(text));
  assert(Math.abs(plainX - x - plain.caretAt(5).x) <= 1, 'reset remeasures the source caret');
} finally {
  host.dispose();
  context.dispose();
}
console.log(
  'Native text-transform: runtime/compiled, inheritance/reset, inline words/wrapping, Unicode carets and source clipboard at 1x/2x passed',
);
