import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { loadNative } from '../dist/native/index.js';
import { Host, HostElement } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';
import {
  ThemeState,
  extendBundle,
  hex,
  neutralTheme,
  shapeOff,
  shapeTokens,
} from '../dist/theme/index.js';
import { addUtilities, classes } from '../dist/theme/utilities.js';

const native = loadNative();
const W = 360;
const H = 300;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../.blinc/theme/', import.meta.url);
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
  const [x, y, w, h] = node.bounds();
  return {
    bounds: [x, y, w, h].map((v) => Math.round(v * 100) / 100),
    children: node instanceof HostElement ? node.childNodes.map(geometry) : undefined,
  };
}
/** The pixels of a rectangle, row by row. */
function region(pixels, [x, y, w, h]) {
  const rows = [];
  for (let row = Math.floor(y); row < Math.ceil(y + h); row++) {
    rows.push(pixels.subarray((row * W + Math.floor(x)) * 4, (row * W + Math.ceil(x + w)) * 4));
  }
  return Buffer.concat(rows);
}
function pixel(pixels, x, y) {
  const at = (Math.round(y) * W + Math.round(x)) * 4;
  return [...pixels.subarray(at, at + 4)];
}
function near(actual, expected, tolerance = 2) {
  return actual.every((c, i) => Math.abs(c - expected[i]) <= tolerance);
}
const rgb8 = (color) => [...color.slice(0, 3).map((c) => Math.round(c * 255)), 255];

const context = native.createReactive();
try {
  // A theme switch restyles in place: the pixels change and the geometry does not.
  {
    const host = Host.create(native);
    const errors = [];
    host.onStyleErrors((e) => errors.push(...e));
    addUtilities(host.layout);
    const state = new ThemeState(context, neutralTheme, { scheme: 'light' });
    state.attach(host.layout);
    const el = (tag, className, style, children = []) => {
      const element = host.createElement(tag);
      element.className = className;
      if (style) {
        element.setAttribute('style', style);
      }
      for (const child of children) {
        element.appendChild(child);
      }
      return element;
    };
    const title = host.createTextNode('Themed');
    const card = el(
      'div',
      classes('bg-surface', 'rounded-lg', 'shadow-md', 'p-4', 'border-border'),
      'border-width: 1px; width: 200px',
      [
        el(
          'span',
          classes('text-text-primary', 'text-lg', 'font-semibold', 'tracking-wide'),
          null,
          [title],
        ),
      ],
    );
    const app = el(
      'div',
      classes('bg-background', 'p-6', 'gap-2'),
      'display: flex; flex-direction: column; width: 100%; height: 100%',
      [card],
    );
    host.root.appendChild(app);

    const light = await capture(host, 'light');
    const layout = geometry(host.root);
    assert.deepEqual(errors, []);
    assert.ok(
      near(pixel(light, 4, 4), rgb8(neutralTheme.light.colors.background)),
      'light background',
    );
    const [cx, cy] = card.bounds();
    assert.ok(
      near(pixel(light, cx + 4, cy + 30), rgb8(neutralTheme.light.colors.surface)),
      'light card',
    );

    state.setScheme('dark');
    assert.equal(state.scheme.get(), 'dark');
    const dark = await capture(host, 'dark');
    assert.deepEqual(geometry(host.root), layout, 'a scheme switch keeps the geometry');
    assert.ok(!dark.equals(light), 'a scheme switch changes the pixels');
    assert.ok(
      near(pixel(dark, 4, 4), rgb8(neutralTheme.dark.colors.background)),
      'dark background',
    );
    assert.ok(
      near(pixel(dark, cx + 4, cy + 30), rgb8(neutralTheme.dark.colors.surface)),
      'dark card',
    );

    // An override applies in both schemes until cleared.
    state.override({ colors: { surface: hex(0xcc2222) } });
    assert.ok(
      near(pixel(await capture(host), cx + 4, cy + 30), [0xcc, 0x22, 0x22, 255]),
      'override',
    );
    state.setScheme('light');
    assert.ok(
      near(pixel(await capture(host), cx + 4, cy + 30), [0xcc, 0x22, 0x22, 255]),
      'override survives the scheme',
    );
    state.clearOverrides();
    assert.ok((await capture(host)).equals(light), 'cleared overrides restore the bundle');

    // A spacing token change relayouts through the cascade.
    state.override({ spacing: { 6: 40 } });
    host.compute(W, H);
    assert.equal(card.bounds()[0], 40);
    state.clearOverrides();
    host.compute(W, H);
    assert.equal(card.bounds()[0], 24);

    // The system scheme is followed from a window's events.
    const listeners = [];
    const source = {
      window: { theme: () => 1 },
      onEvent(listener) {
        listeners.push(listener);
        return () => listeners.splice(listeners.indexOf(listener), 1);
      },
    };
    state.setScheme('system');
    const off = state.followSystem(source);
    assert.equal(state.scheme.get(), 'dark');
    assert.ok((await capture(host)).equals(dark), 'system dark');
    for (const listener of listeners) {
      listener({ kind: 'ThemeChanged', theme: 0 });
    }
    assert.equal(state.scheme.get(), 'light');
    assert.ok((await capture(host)).equals(light), 'system light');
    off();
    assert.equal(listeners.length, 0);

    // A bundle's sheets are added with it and removed when another is installed.
    const branded = extendBundle(neutralTheme, { name: 'Branded' });
    state.setBundle({ ...branded, css: ['.bg-surface { background: var(--primary); }'] });
    const brandedPixels = await capture(host);
    assert.ok(
      near(pixel(brandedPixels, cx + 4, cy + 30), rgb8(neutralTheme.light.colors.primary)),
      'bundle css',
    );
    state.setBundle(neutralTheme);
    assert.ok((await capture(host)).equals(light), 'the previous bundle css is removed');
    state.dispose();
    host.dispose();
  }

  // The theme's corner smoothing reaches fills, borders, shadows and clips;
  // thresholds, pills and locked shapes stay round.
  {
    const host = Host.create(native);
    const errors = [];
    host.onStyleErrors((e) => errors.push(...e));
    const box = (style) => {
      const element = host.createElement('div');
      element.setAttribute('style', `position: absolute; ${style}`);
      host.root.appendChild(element);
      return element;
    };
    const fill = box(
      'left: 10px; top: 10px; width: 100px; height: 80px; border-radius: 28px; background: #2050c0',
    );
    const border = box(
      'left: 130px; top: 10px; width: 100px; height: 80px; border-radius: 28px; border-width: 4px; border-color: #c02050',
    );
    const shadow = box(
      'left: 250px; top: 20px; width: 90px; height: 70px; border-radius: 28px; background: #ffffff; box-shadow: 0 0 0 8px #20a050',
    );
    const small = box(
      'left: 10px; top: 120px; width: 60px; height: 60px; border-radius: 8px; background: #2050c0',
    );
    const pill = box(
      'left: 90px; top: 130px; width: 120px; height: 40px; border-radius: 9999px; background: #2050c0',
    );
    const locked = box(
      'left: 230px; top: 120px; width: 100px; height: 80px; border-radius: 28px; background: #2050c0; corner-shape: round locked',
    );
    const clip = box(
      'left: 10px; top: 200px; width: 100px; height: 90px; border-radius: 28px; overflow: hidden',
    );
    const inner = host.createElement('div');
    inner.setAttribute('style', 'width: 100%; height: 100%; background: #c08020');
    clip.appendChild(inner);
    const squircle = box(
      'left: 130px; top: 200px; width: 100px; height: 90px; border-radius: 28px; background: #2050c0; corner-shape: squircle',
    );

    const smooth = shapeTokens(0.4, 3.3, 12);
    const bundle = (shape) => extendBundle(neutralTheme, { shape });
    const state = new ThemeState(context, bundle(shapeOff), { scheme: 'light' });
    state.attach(host.layout);
    const round = await capture(host, 'shape-off');
    const layout = geometry(host.root);
    assert.equal(host.layout.shape.cornerShape, 0);
    const corner = (element, inset = 0) => {
      const [x, y] = element.bounds();
      return [x - inset, y - inset, 28 + inset, 28 + inset];
    };
    const squircleOff = region(round, corner(squircle));

    state.setBundle(bundle(smooth));
    assert.equal(host.layout.shape.cornerShape, 1.3334237337112427, 'renderer n, not rounded');
    assert.equal(host.layout.shape.smoothingThreshold, 12);
    const smoothed = await capture(host, 'shape-hybrid');
    assert.deepEqual(errors, []);
    assert.deepEqual(geometry(host.root), layout, 'shape changes keep the geometry');
    const differs = (rect) => !region(round, rect).equals(region(smoothed, rect));
    assert.ok(differs(corner(fill)), 'fills follow the theme shape');
    assert.ok(differs(corner(border)), 'borders follow the theme shape');
    assert.ok(differs(corner(shadow, 8)), 'shadows follow the theme shape');
    assert.ok(differs([10, 200, 28, 28]), 'clips follow the theme shape');
    assert.ok(!differs(corner(small)), 'radii under the threshold stay round');
    assert.ok(!differs(pill.bounds()), 'pills stay round');
    assert.ok(!differs(corner(locked)), 'a locked round shape stays round');
    assert.ok(region(smoothed, corner(squircle)).equals(squircleOff), 'an explicit shape wins');

    // Stronger smoothing changes the pixels again, through the same nodes.
    state.override({ shape: { cornerSmoothing: 1, cornerExponent: 4 } });
    assert.equal(host.layout.shape.cornerShape, 2);
    const strong = await capture(host, 'shape-strong');
    assert.ok(!strong.equals(smoothed));

    // A stylesheet's root declarations stand over the theme's shape.
    const sheet = host.layout.addStyleSheet(':root { corner-smoothing: 0; }');
    host.compute(W, H);
    assert.equal(host.layout.shape.cornerShape, 0);
    assert.ok((await capture(host)).equals(round), 'CSS turns smoothing off');
    host.layout.removeStyleSheet(sheet);
    host.compute(W, H);
    assert.equal(host.layout.shape.cornerShape, 2);

    // Smoothing off again restores the first frame exactly.
    state.clearOverrides();
    state.setBundle(bundle(shapeOff));
    assert.ok((await capture(host)).equals(round), 'smoothing off restores round corners');

    // Values the host cannot draw are reported, not thrown.
    fill.setProperty('corner-shape', 'wobble');
    host.compute(W, H);
    assert.ok(
      errors.some((e) => e.startsWith('corner-shape: wobble')),
      errors.join('\n'),
    );
    state.dispose();
    host.dispose();
  }
} finally {
  context.dispose();
  target.dispose();
}
console.log(
  'Native theme: scheme switches, overrides, system scheme, bundle css and corner smoothing passed',
);
