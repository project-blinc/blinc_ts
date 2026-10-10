import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { loadNative } from '../dist/native/index.js';
import { Host, HostElement } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';
import { ThemeState, neutralTheme } from '../dist/theme/index.js';
import { addUserAgent } from '../dist/theme/user-agent.js';

const native = loadNative();
const W = 360;
const H = 420;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../.blinc/user-agent/', import.meta.url);
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
function geometry(node) {
  return {
    bounds: node.bounds().map((v) => Math.round(v * 100) / 100),
    children: node instanceof HostElement ? node.childNodes.map(geometry) : undefined,
  };
}
const pixel = (pixels, x, y) => {
  const at = (Math.round(y) * W + Math.round(x)) * 4;
  return [...pixels.subarray(at, at + 4)];
};
const near = (actual, expected, tolerance = 2) =>
  actual.every((c, i) => Math.abs(c - expected[i]) <= tolerance);
const rgb8 = (color) => [...color.slice(0, 3).map((c) => Math.round(c * 255)), 255];

function el(host, tag, children = [], style) {
  const element = host.createElement(tag);
  if (style) {
    element.setAttribute('style', style);
  }
  for (const child of children) {
    element.appendChild(typeof child === 'string' ? host.createTextNode(child) : child);
  }
  return element;
}

const context = native.createReactive();
try {
  const host = Host.create(native);
  try {
    const errors = [];
    host.onStyleErrors((e) => errors.push(...e));
    const state = new ThemeState(context, neutralTheme, { scheme: 'light' });
    state.attach(host.layout);
    const sheet = addUserAgent(host.layout);
    assert.deepEqual(sheet.diagnostics, [], 'the sheet parses without a diagnostic');

    const title = el(host, 'h1', ['Title']);
    const para = el(host, 'p', ['Paragraph text']);
    const rule = el(host, 'hr');
    const quote = el(host, 'blockquote', [el(host, 'p', ['Quoted'])]);
    const code = el(host, 'pre', [el(host, 'code', ['host.compute(w, h)'])]);
    const button = el(host, 'button', ['Press']);
    const link = el(host, 'a', ['A link']);
    const doc = el(host, 'div', [title, para, rule, quote, code, el(host, 'div', [button, link])]);
    host.root.appendChild(doc);

    const light = await capture(host, 'light');
    const layout = geometry(host.root);
    assert.deepEqual(errors, [], 'no declaration was refused');

    // Containers stack; a tag with no sheet is a row.
    const tops = [title, para, rule, quote, code].map((e) => e.bounds()[1]);
    assert.deepEqual(
      tops,
      [...tops].sort((a, b) => a - b),
      'blocks stack top to bottom',
    );
    assert.ok(new Set(tops).size === tops.length, 'and do not overlap');
    assert.ok(title.bounds()[3] > para.bounds()[3] * 1.5, 'a heading is set in larger type');

    // The window takes the theme's ground and ink, and a scheme switch restyles in place.
    const colors = (theme) => theme.colors;
    assert.ok(
      near(pixel(light, W - 4, H - 4), rgb8(colors(neutralTheme.light).background)),
      'light ground',
    );
    const [rx, ry, rw] = rule.bounds();
    assert.equal(rule.bounds()[3], 1, 'a rule is a pixel tall');
    assert.ok(
      near(pixel(light, rx + rw / 2, ry), rgb8(colors(neutralTheme.light).border)),
      'a rule is drawn in the border colour',
    );
    const [qx, qy, qw, qh] = quote.bounds();
    assert.ok(
      near(pixel(light, qx + 1, qy + qh / 2), rgb8(colors(neutralTheme.light).border)),
      'a quotation has a rule on its left',
    );
    assert.ok(
      near(pixel(light, qx + qw - 2, qy + qh / 2), rgb8(colors(neutralTheme.light).background)),
      'and only its left',
    );
    const [bx, by, bw] = button.bounds();
    const insideButton = [bx + bw / 2, by + 3];
    assert.ok(
      near(pixel(light, ...insideButton), rgb8(colors(neutralTheme.light).primary)),
      'a button is the primary colour',
    );

    host.input.pointerMove(bx + bw / 2, by + 3);
    assert.ok(
      near(
        pixel(await capture(host), ...insideButton),
        rgb8(colors(neutralTheme.light).primaryHover),
      ),
      'a hovered button takes its hover colour',
    );
    host.input.pointerMove(W - 2, H - 2);

    state.setScheme('dark');
    const dark = await capture(host, 'dark');
    assert.deepEqual(geometry(host.root), layout, 'a scheme switch keeps the geometry');
    assert.ok(near(pixel(dark, W - 4, H - 4), rgb8(colors(neutralTheme.dark).background)));
    assert.ok(near(pixel(dark, ...insideButton), rgb8(colors(neutralTheme.dark).primary)));
    assert.ok(!dark.equals(light), 'a scheme switch changes the pixels');
    state.dispose();
  } finally {
    host.dispose();
  }

  // The sheet is under every other: an app rule wins whichever was added first.
  for (const appFirst of [true, false]) {
    const host = Host.create(native);
    try {
      host.onStyleErrors(() => {}); // no theme here: the ground and ink go unresolved
      const add = () => host.layout.addStyleSheet('p { margin-top: 0; margin-bottom: 0; }');
      const first = el(host, 'p', ['One']);
      const second = el(host, 'p', ['Two']);
      host.root.appendChild(el(host, 'div', [first, second]));
      if (appFirst) {
        add();
        addUserAgent(host.layout);
      } else {
        addUserAgent(host.layout);
        add();
      }
      host.compute(W, H);
      const [, y, , h] = first.bounds();
      assert.equal(
        second.bounds()[1],
        y + h,
        `the app's margin wins, added ${appFirst ? 'before' : 'after'}`,
      );
    } finally {
      host.dispose();
    }
  }
  {
    // Without an app rule the sheet's margins hold the paragraphs apart.
    const host = Host.create(native);
    try {
      host.onStyleErrors(() => {});
      const first = el(host, 'p', ['One']);
      const second = el(host, 'p', ['Two']);
      host.root.appendChild(el(host, 'div', [first, second]));
      addUserAgent(host.layout);
      host.compute(W, H);
      const [, y, , h] = first.bounds();
      assert.ok(second.bounds()[1] > y + h, 'paragraphs are spaced');
    } finally {
      host.dispose();
    }
  }
} finally {
  context.dispose();
  target.dispose();
}
console.log(
  'Native user-agent sheet: stacking, type, theme ground, states, rules and precedence passed',
);
