import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { Scope } from '../dist/hmr.js';
import { compileCss, loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { addUserAgent } from '../dist/theme/user-agent.js';
import { ThemeState, neutralTheme } from '../dist/theme/index.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative();
const fixture = new URL('./fixtures/fonts/', import.meta.url);
const file = fileURLToPath(new URL('sheet.css', fixture));
const output = new URL('../.blinc/font-face/', import.meta.url);
await mkdir(output, { recursive: true });
const bytes = Object.fromEntries(
  await Promise.all(
    ['regular.ttf', 'regular.woff2', 'bold.ttf', 'italic.ttf'].map(async (name) => [
      name,
      await readFile(new URL(name, fixture)),
    ]),
  ),
);
const W = 460;
const H = 290;
const text = 'Mmmmm W';
const rules = `
@font-face { font-family: 'Bundled Test'; src: url(missing.ttf), url(regular.ttf) format('truetype'); }
@font-face { font-family: 'Bundled Test'; font-weight: 700; src: url(bold.ttf); }
@font-face { font-family: 'Bundled Test'; font-style: italic; src: url(italic.ttf); }
@font-face { font-family: 'Web Test'; src: url(regular.woff2) format('woff2'); }
@font-face { font-family: 'Shared Bytes'; src: url(regular.ttf); }
`;
const css = `
:root { background:black; color:white; font-size:24px; }
.normal, .bold, .italic, .web, .wrap {position:absolute;left:20px;font-family:'Bundled Test', monospace;}
.normal {top:12px;} .bold {top:52px;font-weight:700;} .italic {top:92px;font-style:italic;}
.web {top:132px;font-family:'Web Test', monospace;}
.wrap {top:172px;width:115px;}
`;
function scene(source, compiled = false, loader) {
  const host = Host.create(native);
  const errors = [];
  host.onStyleErrors((items) => errors.push(...items));
  if (loader) {
    host.fonts.loader = loader;
  }
  const added = host.layout.addStyleSheet(compiled ? compileCss(source, { file }).bytes : source, {
    file,
  });
  assert.deepEqual(added.diagnostics, []);
  const boxes = [];
  for (const name of ['normal', 'bold', 'italic', 'web', 'wrap']) {
    const box = host.createElement(name === 'wrap' ? 'p' : 'div');
    box.className = name;
    box.appendChild(host.createTextNode(name === 'wrap' ? `${text} ${text}` : text));
    if (name === 'wrap') {
      const span = host.createElement('span');
      span.appendChild(host.createTextNode(` ${text}`));
      box.appendChild(span);
    }
    host.root.appendChild(box);
    boxes.push(box);
  }
  return { host, boxes, errors, added };
}
async function capture(target, host, scale) {
  host.compute(W, H);
  const renderer = new SceneRenderer(target.device, host.layout);
  try {
    const pixels = new Uint8Array(W * H * scale * scale * 4);
    await target.captureCommandsInto(
      pixels,
      (e, v) =>
        renderer.encode(e, host.root.layoutNode, v, { width: W * scale, height: H * scale, scale })
          .drawCalls,
    );
    return pixels;
  } finally {
    renderer.dispose();
  }
}
const resources = await Promise.all(
  ['regular.ttf', 'bold.ttf', 'italic.ttf', 'regular.woff2'].map((name) =>
    native.loadFont(bytes[name]),
  ),
);
const families = resources.map((font, i) => font.family(i === 1 ? 700 : 400));
assert(
  Math.abs(native.measureText(text, { fontFamily: families[0], fontSize: 24 }).width - 79.2) <
    0.001,
);
assert(
  Math.abs(
    native.measureText(text, { fontFamily: families[1], fontSize: 24, fontWeight: 700 }).width -
      108,
  ) < 0.001,
);
assert.deepEqual(
  native.measureText(text, { fontFamily: families[3], fontSize: 24 }).carets,
  native.measureText(text, { fontFamily: families[0], fontSize: 24 }).carets,
);
for (const scale of [1, 2]) {
  const target = await OffscreenRenderer.create(native, W * scale, H * scale, probeShader);
  const oracle = scene(
    `${css}\n.normal,.wrap {font-family:'${families[0]}';}.bold {font-family:'${families[1]}';}.italic {font-family:'${families[2]}';}.web {font-family:'${families[3]}';}`,
  );
  try {
    const expected = await capture(target, oracle.host, scale);
    for (const compiled of [false, true]) {
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const calls = new Map();
      const loaded = scene(`${rules}${css}`, compiled, async (source) => {
        await gate;
        calls.set(source, (calls.get(source) ?? 0) + 1);
        return { bytes: await readFile(source) };
      });
      try {
        const pending = await capture(target, loaded.host, scale);
        assert.notEqual(
          Buffer.compare(pending, expected),
          0,
          'fallback is rendered while sources are pending',
        );
        release();
        await loaded.host.fonts.idle();
        assert(loaded.host.fonts.entries.every((entry) => entry.status === 'loaded'));
        assert.equal(
          calls.get(fileURLToPath(new URL('regular.ttf', fixture))),
          1,
          'two descriptors share a source load',
        );
        const actual = await capture(target, loaded.host, scale);
        for (const top of [12, 52, 92, 132]) {
          let ink = 0;
          for (let y = top * scale; y < (top + 35) * scale; y++) {
            for (let x = 20 * scale; x < 160 * scale; x++) {
              if (actual[(y * W * scale + x) * 4] > 50) {
                ink++;
              }
            }
          }
          assert(ink > 100 * scale * scale, `glyph ink at ${top}: ${ink}`);
        }
        await writeFile(
          new URL(`actual-${compiled ? 'compiled' : 'runtime'}-${scale}x.png`, output),
          PNG.sync.write({ width: W * scale, height: H * scale, data: Buffer.from(actual) }),
        );
        await writeFile(
          new URL(`expected-${scale}x.png`, output),
          PNG.sync.write({ width: W * scale, height: H * scale, data: Buffer.from(expected) }),
        );
        assert.equal(
          Buffer.compare(actual, expected),
          0,
          'CSS aliases, weights, italic and WOFF2 use the literal faces',
        );
        assert.deepEqual(
          loaded.boxes.map((box) => box.bounds()),
          oracle.boxes.map((box) => box.bounds()),
          'late loading remeasures boxes and wrapped inline runs',
        );
        assert.deepEqual(
          loaded.errors,
          [],
          'a successful fallback URL suppresses earlier source failures',
        );
        await writeFile(
          new URL(`${compiled ? 'compiled' : 'runtime'}-${scale}x.png`, output),
          PNG.sync.write({ width: W * scale, height: H * scale, data: Buffer.from(actual) }),
        );
        assert(loaded.host.layout.removeStyleSheet(loaded.added));
        loaded.host.layout.addStyleSheet(css);
        const removed = await capture(target, loaded.host, scale);
        const fallback = scene(css);
        try {
          assert.equal(
            Buffer.compare(removed, await capture(target, fallback.host, scale)),
            0,
            'sheet removal restores fallback and invalidates prepared text',
          );
        } finally {
          fallback.host.dispose();
        }
        assert.equal(loaded.host.fonts.entries.length, 0);
      } finally {
        release();
        loaded.host.dispose();
      }
    }
  } finally {
    oracle.host.dispose();
    target.dispose();
  }
}

// A family in another host cannot leak into this one; each owns immutable private names.
const first = scene(`${rules}${css}`);
const second = scene(`${css}@font-face {font-family:'Bundled Test';src:url(bold.ttf);}`);
const bare = scene(css);
try {
  first.host.compute(W, H);
  second.host.compute(W, H);
  bare.host.compute(W, H);
  const fallback = bare.boxes[0].bounds()[2];
  await Promise.all([first.host.fonts.idle(), second.host.fonts.idle()]);
  first.host.compute(W, H);
  second.host.compute(W, H);
  bare.host.compute(W, H);
  assert.equal(first.boxes[0].bounds()[2], 79);
  assert.equal(second.boxes[0].bounds()[2], 108);
  assert.equal(bare.boxes[0].bounds()[2], fallback);
  first.host.dispose();
  second.host.compute(W, H);
  assert.equal(second.boxes[0].bounds()[2], 108);
} finally {
  first.host.dispose();
  second.host.dispose();
  bare.host.dispose();
}

// Later matching declarations replace a face; removal restores the earlier loaded face.
const ordered = scene(`${rules}${css}`);
try {
  await ordered.host.fonts.idle();
  ordered.host.compute(W, H);
  assert.equal(ordered.boxes[0].bounds()[2], 79);
  const later = ordered.host.layout.addStyleSheet(
    "@font-face {font-family:'Bundled Test';src:url(bold.ttf);}",
    { file },
  );
  await ordered.host.fonts.idle();
  ordered.host.compute(W, H);
  assert.equal(ordered.boxes[0].bounds()[2], 108);
  ordered.host.layout.removeStyleSheet(later);
  ordered.host.compute(W, H);
  assert.equal(ordered.boxes[0].bounds()[2], 79);
} finally {
  ordered.host.dispose();
}

// Data URLs and local registry faces share the same owned-font path as file sources.
const encoded = `data:font/ttf;base64,${bytes['regular.ttf'].toString('base64')}`;
for (const source of [`url('${encoded}')`, `local('${families[0]}')`]) {
  const loaded = scene(`${css}@font-face {font-family:'Bundled Test';src:${source};}`);
  try {
    await loaded.host.fonts.idle();
    loaded.host.compute(W, H);
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.boxes[0].bounds()[2], 79);
  } finally {
    loaded.host.dispose();
  }
}

// Failed and unsupported sources report errors; removing a pending sheet cannot resurrect it.
const broken = scene(
  `${css}@font-face {font-family:Lost;src:url(no-font.ttf);} @font-face {font-family:Unsupported;src:url(regular.woff2) format(woff);}`,
);
await broken.host.fonts.idle();
assert.equal(broken.errors.length, 2);
assert(broken.errors.some((error) => error.includes('Lost') && error.includes('no-font.ttf')));
assert(broken.host.fonts.entries.every((entry) => entry.status === 'error'));
broken.host.dispose();
let finish;
const pendingFont = new Promise((resolve) => {
  finish = resolve;
});
const doomed = scene(`${rules}${css}`, false, async () => {
  await pendingFont;
  return { bytes: bytes['regular.ttf'] };
});
await new Promise((resolve) => setImmediate(resolve));
doomed.host.dispose();
finish();
await doomed.host.fonts.idle();
assert.deepEqual(doomed.errors, []);

// Compiled imports resolve URLs against their defining sheet, and media changes release faces.
const imported = Host.create(native);
const compiled = compileCss("@import 'fonts.css';", {
  file,
  load: () => [
    '@media (min-width:300px) { @font-face {font-family:Imported;src:url(regular.woff2);} }',
    fileURLToPath(new URL('fonts.css', fixture)),
  ],
});
assert.deepEqual(compiled.diagnostics, []);
imported.layout.addStyleSheet(compiled.bytes);
imported.compute(200, 100);
assert.equal(imported.fonts.entries.length, 0);
imported.compute(400, 100);
await imported.fonts.idle();
assert.equal(imported.fonts.entries[0].status, 'loaded');
imported.compute(200, 100);
assert.equal(imported.fonts.entries.length, 0);
imported.dispose();

// Editable carets follow loaded metrics without changing value or selection indices.
const fieldHost = Host.create(native);
const graph = native.createReactive();
new ThemeState(graph, neutralTheme, { scheme: 'light' }).attach(fieldHost.layout);
addUserAgent(fieldHost.layout);
fieldHost.layout.addStyleSheet(
  `@font-face {font-family:FieldFont;src:url(regular.ttf);} input {font-family:FieldFont; font-size:24px;width:300px;}`,
  { file },
);
const field = fieldHost.createElement('input');
field.value = text;
fieldHost.root.appendChild(field);
fieldHost.compute(400, 100);
await fieldHost.fonts.idle();
field.focus();
field.setSelectionRange(3, 3);
fieldHost.compute(400, 100);
assert.equal(field.value, text);
assert.equal(field.selectionStart, 3);
const fields = fieldHost.behaviours.textFields;
const [textX] = fields.part(field, 'text').bounds();
const [caretX] = fields.part(field, 'caret').bounds();
assert(Math.abs(caretX - textX - 36) <= 1, 'caret is remeasured at three 12px fixture advances');
fieldHost.dispose();
graph.dispose();
const scope = new Scope();
const scoped = await native.loadFont(bytes['regular.ttf'], scope);
assert.equal(typeof scoped.family(), 'string');
scope.dispose();
assert.throws(() => scoped.family(), /disposed/);
for (const resource of resources) {
  resource.dispose();
  resource.dispose();
  assert.throws(() => resource.family(), /disposed/);
}
await assert.rejects(native.loadFont(new Uint8Array([1, 2, 3])));
console.log(
  'native font-face: runtime/compiled TTF/WOFF2 pixels, matching, async reflow, isolation, disposal and media passed',
);
process.exit(0);
