// Destroying a subtree lets go of everything in it: every element deep inside becomes collectable,
// with the paragraphs' flows, an image's picture, a list's markers and a text field's parts, and
// whatever the host or a behaviour kept for them. Run with --expose-gc.
import assert from 'node:assert/strict';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { addUserAgent } from '../dist/theme/user-agent.js';
import { ThemeState, neutralTheme } from '../dist/theme/index.js';

assert.ok(globalThis.gc, 'run with --expose-gc');
const native = loadNative();
const context = native.createReactive();
const host = Host.create(native);
try {
  new ThemeState(context, neutralTheme, { scheme: 'light' }).attach(host.layout);
  addUserAgent(host.layout);
  const pixel = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="red"/></svg>')}`;
  const el = (tag, children = [], attributes = {}) => {
    const e = host.createElement(tag);
    for (const [k, v] of Object.entries(attributes)) {
      e.setAttribute(k, v);
    }
    for (const c of children) {
      e.appendChild(typeof c === 'string' ? host.createTextNode(c) : c);
    }
    return e;
  };
  /** A page of what keeps state: paragraphs that flow, an image, a list, a field, a table. */
  const page = () =>
    el('div', [
      el('section', [
        el('p', ['Text with ', el('strong', ['bold']), ' and ', el('code', ['code']), ' in it.']),
        el('div', [el('img', [], { src: pixel })]),
        el('ol', [el('li', ['One']), el('li', ['Two'])]),
        el('label', ['Name ', el('input', [], { type: 'text', value: 'kept?' })]),
        el('table', [el('tr', [el('td', ['A ', el('em', ['cell'])]), el('td', ['B'])])]),
      ]),
    ]);
  const settle = async () => {
    host.compute(400, 400);
    await host.images.idle();
    host.compute(400, 400);
    host.compute(400, 400);
  };
  const collected = async (refs) => {
    for (let i = 0; i < 6; i++) {
      globalThis.gc();
      await new Promise((r) => setTimeout(r, 10));
    }
    return refs.filter((r) => r.deref() !== undefined).length;
  };
  // Build and destroy pages, keeping only weak references to what was inside them. Each is made in
  // a function of its own, so no variable of the test holds it once it returns.
  const refs = [];
  const round = async () => {
    const root = page();
    host.root.appendChild(root);
    await settle();
    const walk = (n) => {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        refs.push(new WeakRef(c));
        walk(c);
      }
    };
    walk(root);
    root.destroy();
    await settle();
  };
  for (let i = 0; i < 3; i++) {
    await round();
  }
  assert.ok(refs.length > 60, `a page has many nodes: ${refs.length}`);
  const kept = await collected(refs);
  assert.equal(
    kept,
    0,
    `every node of a destroyed page is collectable: ${kept} of ${refs.length} kept`,
  );
  assert.equal(host.layout.size, 1, 'and no native node is left but the root');
} finally {
  host.dispose();
  context.dispose();
}
console.log(
  'Native destroy: a destroyed subtree, flows, pictures, markers and fields let go passed',
);
