// Both reference adapters render the same scene: same tree, geometry, pixels and event order.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { nextTick } from '@vue/runtime-core';
import { PNG } from 'pngjs';
import { loadNative } from 'blinc_ts/native';
import { Host, HostElement, HostText } from 'blinc_ts/native/host';
import { OffscreenRenderer } from 'blinc_ts/native/offscreen';
import { SceneRenderer } from 'blinc_ts/native/renderer';
import { probeShader } from 'blinc_ts/shaders';
import { jsxScene } from '../dist/scene/jsx-scene.js';
import { vueScene } from '../dist/scene/vue-scene.js';

const WIDTH = 480;
const HEIGHT = 320;
const update = process.argv.includes('--update');
const native = loadNative();
const output = new URL('../../.blinc/adapters/', import.meta.url);
await mkdir(output, { recursive: true });
const fixture = new URL('./scene.json', import.meta.url);

function dump(node) {
  const [x, y, width, height] = node.bounds().map((v) => Math.round(v * 100) / 100);
  if (node instanceof HostText) {
    return { text: node.data, bounds: [x, y, width, height] };
  }
  return {
    tag: node.tag,
    ...(node.id ? { id: node.id } : {}),
    ...(node.className ? { class: node.className } : {}),
    bounds: [x, y, width, height],
    children: node.childNodes
      // Empty text nodes are framework anchors and draw nothing.
      .filter((child) => child instanceof HostElement || (child instanceof HostText && child.data))
      .map(dump),
  };
}
function find(node, id) {
  if (node instanceof HostElement) {
    if (node.id === id) {
      return node;
    }
    for (const child of node.childNodes) {
      const found = find(child, id);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}
async function capture(host) {
  host.compute(WIDTH, HEIGHT);
  const target = await OffscreenRenderer.create(native, WIDTH, HEIGHT, probeShader);
  const renderer = new SceneRenderer(target.device, host.layout);
  try {
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    await target.captureCommandsInto(pixels, (encoder, view) => {
      return renderer.encode(encoder, host.root.layoutNode, view, {
        width: WIDTH,
        height: HEIGHT,
        scale: 1,
      }).drawCalls;
    });
    return pixels;
  } finally {
    renderer.dispose();
    target.dispose();
  }
}
async function click(host, element, settle) {
  const [x, y, w, h] = element.bounds();
  host.dispatchPointer('pointerdown', { x: x + w / 2, y: y + h / 2, button: 0 });
  host.dispatchPointer('pointerup', { x: x + w / 2, y: y + h / 2, button: 0 });
  await settle();
}

const results = {};
for (const [name, build, settle] of [
  ['jsx', jsxScene, async () => {}],
  ['vue', vueScene, () => nextTick()],
]) {
  const host = Host.create(native);
  try {
    const log = [];
    const unmount = build(host, log);
    await settle();
    host.compute(WIDTH, HEIGHT);
    const tree = dump(host.root);
    const before = await capture(host);
    const button = find(host.root, 'counter');
    assert(button, `${name}: the counter button exists`);
    await click(host, button, settle);
    assert.equal(button.textContent, 'Clicks: 1', `${name}: the click handler ran once`);
    await click(host, button, settle);
    assert.equal(button.textContent, 'Clicks: 2');
    const after = await capture(host);
    assert.notDeepEqual(after, before, `${name}: the label change is drawn`);
    // A click on the header's own area bubbles to it without reaching the button.
    const header = button.parentNode;
    const [hx, hy] = header.bounds();
    host.dispatchPointer('pointerdown', { x: hx + 4, y: hy + 4, button: 0 });
    host.dispatchPointer('pointerup', { x: hx + 4, y: hy + 4, button: 0 });
    await settle();
    results[name] = { tree, log, before, after };
    await writeFile(
      new URL(`${name}.png`, output),
      PNG.sync.write({ width: WIDTH, height: HEIGHT, data: Buffer.from(before) }),
    );
    if (typeof unmount === 'function') {
      unmount();
      host.flush();
      assert.equal(host.root.firstChild, null, `${name}: unmount empties the root`);
    }
  } finally {
    host.dispose();
  }
}

const { jsx, vue } = results;
assert.deepEqual(vue.tree, jsx.tree, 'Both adapters build the same tree and geometry');
assert.deepEqual(jsx.log, [
  'app-capture',
  'button',
  'header',
  'app-capture',
  'button',
  'header',
  'app-capture',
  'header',
]);
assert.deepEqual(vue.log, jsx.log, 'Both adapters see the same events in the same order');
assert(
  Buffer.from(vue.before).equals(Buffer.from(jsx.before)),
  'Both adapters draw the same pixels',
);
assert(
  Buffer.from(vue.after).equals(Buffer.from(jsx.after)),
  'Both adapters redraw the same pixels',
);
// The fixture holds the structure; text metrics differ between platforms' fonts.
const structure = (node) => {
  const { children, ...rest } = node;
  delete rest.bounds;
  return children ? { ...rest, children: children.map(structure) } : rest;
};
if (update) {
  await writeFile(fixture, JSON.stringify(structure(jsx.tree), null, 2) + '\n');
} else {
  assert.deepEqual(
    structure(jsx.tree),
    JSON.parse(await readFile(fixture, 'utf8')),
    'The tree matches the fixture',
  );
}
// Boxes whose geometry does not depend on fonts: the header, the grid columns
// (C first, by order) and the absolutely positioned badge.
const [app] = jsx.tree.children;
const [header, cards] = app.children;
assert.deepEqual(header.bounds, [16, 16, 448, 48]);
assert.deepEqual(
  cards.children.map((card) => card.bounds[0]),
  [169, 323, 16],
);
assert.deepEqual(cards.children[1].children[1].bounds, [444, 84, 12, 12]);
console.log(
  JSON.stringify({
    test: 'Reference adapters',
    adapters: Object.keys(results),
    output: output.pathname,
  }),
);
