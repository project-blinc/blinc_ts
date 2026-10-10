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
import { TopLayer } from '../dist/native/top-layer.js';

const native = loadNative();
const W = 500;
const H = 360;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../.blinc/dialogs/', import.meta.url);
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
const pixel = (pixels, x, y) => {
  const at = (Math.round(y) * W + Math.round(x)) * 4;
  return [...pixels.subarray(at, at + 3)];
};

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
  const centre = (e) => {
    const [x, y, w, h] = e.bounds();
    return [x + w / 2, y + h / 2];
  };
  const pressAt = (x, y) => {
    host.input.pointerMove(x, y);
    host.input.pointerDown();
    host.input.pointerUp();
    host.input.pointerMove(W - 1, H - 1);
  };
  const press = (e) => pressAt(...centre(e));
  const tap = (key) => {
    host.input.keyDown({ key });
    host.input.keyUp({ key });
  };
  let clock = 0;
  const settle = async () => {
    host.compute(W, H);
    host.layout.tickMotion((clock += 1));
    host.layout.tickMotion((clock += 2000));
    host.compute(W, H);
    await Promise.resolve();
  };
  const stack = TopLayer.of(host);

  // A page with a dialog among its children, and the button that opens it.
  const open = el('button', {}, ['Open']);
  const ok = el('button', { value: 'ok' }, ['OK']);
  const dialog = el('dialog', { id: 'd' }, [el('p', {}, ['Are you sure?']), ok]);
  const after = el('div', {}, ['after']);
  const page = el('div', { style: 'position: absolute; left: 10px; top: 10px; width: 300px' }, [
    open,
    dialog,
    after,
  ]);
  host.root.appendChild(page);
  host.root.setAttribute('style', 'background: #ffffff');
  await settle();
  assert.equal(dialog.open, false);
  assert.equal(dialog.returnValue, '');
  const quiet = await capture(host);
  const events = [];
  for (const type of ['cancel', 'close']) {
    dialog.addEventListener(type, () => events.push(type));
  }

  // showModal: open, in the top layer, over a dimmed page, with focus inside it.
  open.focus();
  dialog.showModal();
  assert.equal(dialog.open, true);
  assert.equal(dialog.hasAttribute('open'), true);
  assert.equal(stack.entries.length, 1);
  assert.equal(stack.entries[0].content, dialog);
  assert.ok(host.input.focused && host.input.focused !== open, 'focus moved into the dialog');
  await settle();
  const shown = await capture(host, 'modal');
  const [dx, dy, dw, dh] = dialog.bounds();
  assert.ok(dw >= 280 && dh > 40, `a panel: ${dw} by ${dh}`);
  assert.ok(Math.abs(dx + dw / 2 - W / 2) < 2 && Math.abs(dy + dh / 2 - H / 2) < 2, 'centred');
  const dimmed = pixel(shown, 480, 340);
  assert.ok(dimmed[0] < pixel(quiet, 480, 340)[0] - 20, `the page is dimmed: ${dimmed}`);
  assert.ok(pixel(shown, dx + 8, dy + 8)[0] > dimmed[0] + 20, 'and the panel is drawn over it');
  assert.throws(() => dialog.showModal(), /already open/);
  assert.throws(() => el('div').showModal(), /for a dialog/);

  // Escape asks it to close: a cancel a listener may refuse.
  const refuse = (event) => event.preventDefault();
  dialog.addEventListener('cancel', refuse);
  tap('Escape');
  assert.deepEqual(events, ['cancel']);
  assert.equal(dialog.open, true, 'a cancelled cancel keeps it open');
  dialog.removeEventListener('cancel', refuse);
  events.length = 0;
  tap('Escape');
  assert.deepEqual(events, ['cancel', 'close'], 'otherwise cancel, then close');
  assert.equal(dialog.open, false);
  assert.equal(dialog.hasAttribute('open'), false);
  assert.equal(stack.entries.length, 0, 'it has left the top layer');
  assert.equal(host.input.focused, open, 'focus goes back to what had it');
  // After its closing animation the dialog is back among its siblings, in its place.
  for (let i = 0; i < 20 && dialog.parentNode !== page; i++) {
    await settle();
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(dialog.parentNode, page, 'back where it was');
  assert.equal(dialog.previousSibling, open);
  assert.equal(dialog.nextSibling, after, 'between the same two');

  // Closing with a value; closing again does nothing.
  events.length = 0;
  dialog.showModal();
  dialog.close('done');
  assert.equal(dialog.returnValue, 'done');
  assert.deepEqual(events, ['close']);
  dialog.close('again');
  assert.deepEqual(events, ['close'], 'a closed dialog says nothing');
  assert.equal(dialog.returnValue, 'done');
  for (let i = 0; i < 20 && dialog.parentNode !== page; i++) {
    await settle();
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(dialog.parentNode, page);

  // It opens again, and a script removing open closes it.
  events.length = 0;
  dialog.showModal();
  assert.equal(stack.entries.length, 1, 'opened again');
  dialog.open = false;
  assert.deepEqual(events, ['close'], 'taking open away closes it');
  for (let i = 0; i < 20 && dialog.parentNode !== page; i++) {
    await settle();
    await new Promise((r) => setTimeout(r, 5));
  }

  // A press on the backdrop closes only a dialog that says closedby any.
  dialog.showModal();
  await settle();
  pressAt(480, 340);
  assert.equal(dialog.open, true, 'a modal ignores the backdrop by default');
  dialog.setAttribute('closedby', 'any');
  pressAt(480, 340);
  assert.equal(dialog.open, false, 'closedby any closes on a press outside');
  for (let i = 0; i < 20 && dialog.parentNode !== page; i++) {
    await settle();
    await new Promise((r) => setTimeout(r, 5));
  }
  dialog.setAttribute('closedby', 'none');
  dialog.showModal();
  await settle();
  tap('Escape');
  assert.equal(dialog.open, true, 'closedby none ignores Escape too');
  dialog.close();
  for (let i = 0; i < 20 && dialog.parentNode !== page; i++) {
    await settle();
    await new Promise((r) => setTimeout(r, 5));
  }
  dialog.removeAttribute('closedby');

  // requestClose is a close that can be refused; a form of method dialog closes its dialog.
  events.length = 0;
  dialog.showModal();
  dialog.addEventListener('cancel', refuse);
  dialog.requestClose();
  assert.equal(dialog.open, true);
  dialog.removeEventListener('cancel', refuse);
  const inner = el('form', { method: 'dialog' }, [el('button', { value: 'yes' }, ['Yes'])]);
  dialog.appendChild(inner);
  await settle();
  const hold = (event) => event.preventDefault();
  inner.addEventListener('submit', hold);
  press(inner.elements[0]);
  assert.equal(dialog.open, true, 'a cancelled submission keeps it open');
  inner.removeEventListener('submit', hold);
  press(inner.elements[0]);
  assert.equal(dialog.open, false, 'submitting a method dialog form closes it');
  assert.equal(dialog.returnValue, 'yes', "with the submitter's value");
  for (let i = 0; i < 20 && dialog.parentNode !== page; i++) {
    await settle();
    await new Promise((r) => setTimeout(r, 5));
  }

  // show opens it in place, not in the top layer, and close shuts it.
  events.length = 0;
  dialog.show();
  assert.equal(dialog.open, true);
  assert.equal(stack.entries.length, 0);
  assert.equal(dialog.parentNode, page, 'where it is');
  dialog.show();
  assert.equal(dialog.open, true, 'showing one that is shown changes nothing');
  dialog.close();
  assert.deepEqual(events, ['close']);
  assert.deepEqual(errors, [], String(errors));
  state.dispose();
} finally {
  host.dispose();
  context.dispose();
  target.dispose();
}
console.log('Native dialogs: modal, cancel, close, backdrop, form method dialog and show passed');
