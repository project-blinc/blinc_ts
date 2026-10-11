import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { compileCss, loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative(process.env.BLINC_GENERATED_ADDON);
const W = 260;
const H = 130;
const output = new URL('../.blinc/generated-content/', import.meta.url);
await mkdir(output, { recursive: true });
const icon = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><rect width="12" height="8" fill="#00ff00"/></svg>')}`;
const css = `
  :root { background: #101722; }
  .subject { position: absolute; left: 20px; top: 20px; width: 200px; height: 40px;
    flex-direction: row; align-items: center; gap: 4px; color: #ffffff; font-size: 18px; }
  span { color: #ff0000; font-size: 40px; }
  .subject::before { content: "[" attr(title) "]"; }
  .subject::after { content: url("${icon}"); }
  .subject:hover::before { content: "Hover"; color: #4488ff; }
  .subject:hover::after { content: none; }
  .subject.off::before, .subject.off::after { content: none !important; }
  .subject:has(> span) { height: 99px; }
  .subject > div:first-child { width: 10px; height: 12px; background: #ff8800; }
  .subject > div:last-child { background: #4488ff; }
`;
function build(generated, source) {
  const host = Host.create(native);
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  const sheet = host.layout.addStyleSheet(source);
  assert.deepEqual(sheet.diagnostics, []);
  const owner = host.createElement('div');
  owner.className = 'subject';
  owner.setAttribute('title', 'Hi');
  const authored = host.createElement('div');
  owner.appendChild(authored);
  host.root.appendChild(owner);
  if (!generated) {
    const before = host.ownedElement(owner, 'part', [], authored);
    before.setAttribute('style', 'font-size:18px;color:#ffffff');
    before.appendChild(host.createTextNode('[Hi]'));
    const after = host.ownedElement(owner, 'img');
    after.setAttribute('src', icon);
  }
  return { host, owner, authored, errors };
}
async function settle(host) {
  host.compute(W, H);
  await host.images.idle();
  host.compute(W, H);
}
async function capture(host, target, scale, name) {
  await settle(host);
  const renderer = new SceneRenderer(target.device, host.layout);
  renderer.useImages(host.images.library);
  try {
    const pixels = new Uint8Array(W * H * scale * scale * 4);
    await target.captureCommandsInto(
      pixels,
      (e, v) =>
        renderer.encode(e, host.root.layoutNode, v, { width: W * scale, height: H * scale, scale })
          .drawCalls,
    );
    if (name) {
      await writeFile(
        new URL(`${name}.png`, output),
        PNG.sync.write({ width: W * scale, height: H * scale, data: Buffer.from(pixels) }),
      );
    }
    return pixels;
  } finally {
    renderer.dispose();
  }
}
for (const scale of [1, 2]) {
  const target = await OffscreenRenderer.create(native, W * scale, H * scale, probeShader);
  try {
    for (const compiled of [false, true]) {
      const source = compiled
        ? compileCss(css, { addon: process.env.BLINC_GENERATED_ADDON }).bytes
        : css;
      const r = build(true, source);
      const reference = build(
        false,
        css.replace(/\.subject[^{}]*::(?:before|after)[^{}]*\{[^{}]*\}/g, ''),
      );
      try {
        const actual = await capture(
          r.host,
          target,
          scale,
          `generated-${compiled ? 'compiled' : 'runtime'}-${scale}x`,
        );
        const expected = await capture(reference.host, target, scale);
        assert.deepEqual(
          actual,
          expected,
          'generated content matches equivalent owned text/image pixels',
        );
        const parts = [...r.host.contentNodes(r.owner)];
        assert.equal(parts.length, 3);
        assert.deepEqual(r.owner.childNodes, [r.authored]);
        assert.equal(r.owner.textContent, '');
        assert.equal(r.owner.bounds()[3], 40, ':has does not see a generated span');
        assert.equal(parts[0].textContent, '[Hi]');
        assert.equal(parts[2].tag, 'img');
        assert.deepEqual(
          parts[2].bounds().slice(2),
          [12, 8],
          'url content takes intrinsic dimensions',
        );
        assert.equal(r.host.textStyleOf(parts[0].firstChild).fontSize, 18);
        assert.equal(r.authored.bounds()[2], 10, 'first-child ignores before');
        r.owner.setAttribute('title', 'Bye');
        await settle(r.host);
        assert.equal(parts[0].textContent, '[Bye]', 'attr follows the owner');
        const appended = r.host.createElement('div');
        r.owner.appendChild(appended);
        await settle(r.host);
        const ordered = [...r.host.contentNodes(r.owner)];
        assert.deepEqual(ordered, [parts[0], r.authored, appended, parts[2]]);
        assert(ordered[3].bounds()[0] >= ordered[2].bounds()[0], 'appends stay before after');
        assert.equal(r.host.elementAt(24, 35), r.owner, 'generated hits target their origin');
        let clicked;
        r.owner.addEventListener('click', (event) => {
          clicked = event.target;
        });
        r.host.input.pointerMove(24, 35);
        r.host.input.pointerDown();
        r.host.input.pointerUp();
        assert.equal(clicked, r.owner, 'generated content dispatches clicks to its origin');
        await capture(r.host, target, scale);
        assert.equal(
          parts[0].textContent,
          'Hover',
          'hover on the origin updates generated content',
        );
        assert(parts[2].destroyed, 'content:none destroys the image part');
        r.host.input.pointerMove(250, 120);
        await settle(r.host);
        r.owner.classList.add('off');
        await settle(r.host);
        assert.deepEqual([...r.host.contentNodes(r.owner)], [r.authored, appended]);
        assert(parts[0].destroyed, 'content:none destroys the text part');
        assert.deepEqual(r.errors, []);
        assert.deepEqual(reference.errors, []);
        r.owner.destroy();
        await settle(r.host);
        assert.equal(r.host.layout.size, 1, 'owner removal releases every native generated node');
      } finally {
        r.host.dispose();
        reference.host.dispose();
      }
    }
  } finally {
    target.dispose();
  }
}
// Inline generated text joins authored prose in order, rather than becoming separate lines.
{
  const host = Host.create(native);
  try {
    host.layout.addStyleSheet(
      'p {width:200px;font-size:16px;align-self:flex-start} p::before {content:"Before "} p::after {content:" after"}',
    );
    const p = host.createElement('p');
    p.appendChild(host.createTextNode('middle'));
    host.root.appendChild(p);
    host.compute(W, H);
    const [before, text, after] = [...host.contentNodes(p)];
    assert.equal(before.textContent, 'Before ');
    assert.equal(text.textContent, 'middle');
    assert.equal(after.textContent, ' after');
    assert(p.bounds()[3] < 30, 'generated prose shares one line');
    const size = host.layout.size;
    for (let i = 0; i < 10; i++) {
      host.compute(W, H);
    }
    assert.equal(host.layout.size, size, 'unchanged computes do not recreate parts');
    host.layout.removeStyleSheet({ id: 0 });
    host.compute(W, H);
    assert(before.destroyed && after.destroyed, 'removing the sheet removes generated content');
  } finally {
    host.dispose();
  }
}
// Quoted CSS syntax is literal text; empty strings generate decoration, and bad content reports.
{
  const host = Host.create(native);
  const errors = [];
  host.onStyleErrors((e) => errors.push(...e));
  try {
    const owner = host.createElement('div');
    owner.className = 'edge';
    host.root.appendChild(owner);
    const sheet = host.layout.addStyleSheet(`
      .edge::before {content: "var(--missing)"}
      .edge::after {content: "";width:12px;height:8px;background:blue}
    `);
    host.compute(W, H);
    const [before, after] = [...host.contentNodes(owner)];
    assert.equal(before.textContent, 'var(--missing)');
    assert.equal(after.textContent, '');
    assert.deepEqual(after.bounds().slice(2), [12, 8], 'empty content generates a styled box');
    host.layout.removeStyleSheet(sheet);
    host.layout.addStyleSheet('.edge::before {content:counter(item)}');
    host.compute(W, H);
    assert.deepEqual([...host.contentNodes(owner)], []);
    assert(errors.some((e) => e.includes('content') && e.includes('counter')));
  } finally {
    host.dispose();
  }
}
console.log(
  'Native generated content: runtime/compiled before/after, attrs, hover, inheritance, images, inline flow, pixels and cleanup passed',
);
