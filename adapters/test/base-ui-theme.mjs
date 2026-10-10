// The Base UI theme: complete in both schemes, readable, and restyling in place.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { loadNative } from 'blinc_ts/native';
import { Host, HostElement } from 'blinc_ts/native/host';
import { OffscreenRenderer } from 'blinc_ts/native/offscreen';
import { SceneRenderer } from 'blinc_ts/native/renderer';
import { probeShader } from 'blinc_ts/shaders';
import { ThemeState, colorTokens, isShapeOff, themeVariables } from 'blinc_ts/theme';
import { addUserAgent } from 'blinc_ts/theme/user-agent';
import { addUtilities, utilityClasses } from 'blinc_ts/theme/utilities';
import { baseUiTheme } from '../dist/base-ui/theme.js';

const { light, dark } = baseUiTheme;

// Tokens.
for (const theme of [light, dark]) {
  assert.deepEqual(Object.keys(theme.colors).sort(), [...colorTokens].sort(), theme.scheme);
  assert.equal(theme.name, baseUiTheme.name);
}
assert.equal(light.scheme, 'light');
assert.equal(dark.scheme, 'dark');

// WCAG 2.x contrast of the pairings components use: text 4.5, strong text 7, UI parts 3.
const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
/** `color` over an opaque `ground`, as it is drawn. */
const over = (color, ground) =>
  color[3] >= 1
    ? color
    : color.slice(0, 3).map((c, i) => c * color[3] + ground[i] * (1 - color[3]));
function contrast(foreground, ground) {
  const [hi, lo] = [luminance(over(foreground, ground)), luminance(ground)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const pairings = [
  ['textPrimary', 'background', 7],
  ['textPrimary', 'surface', 7],
  ['textPrimary', 'surfaceElevated', 7],
  ['textSecondary', 'background', 4.5],
  ['textSecondary', 'surface', 4.5],
  ['textSecondary', 'surfaceElevated', 4.5],
  ['textTertiary', 'background', 4.5],
  ['textTertiary', 'surface', 4.5],
  ['textTertiary', 'inputBg', 4.5],
  ['textInverse', 'primary', 4.5],
  ['textInverse', 'primaryHover', 4.5],
  ['textInverse', 'primaryActive', 4.5],
  ['textLink', 'background', 4.5],
  ['textLink', 'surface', 4.5],
  ['secondary', 'surface', 4.5],
  ['borderFocus', 'background', 3],
  ['borderFocus', 'surface', 3],
  ['borderError', 'surface', 3],
  ['success', 'successBg', 4.5],
  ['warning', 'warningBg', 4.5],
  ['error', 'errorBg', 4.5],
  ['info', 'infoBg', 4.5],
  ['success', 'surface', 4.5],
  ['warning', 'surface', 4.5],
  ['error', 'surface', 4.5],
  ['info', 'surface', 4.5],
  ['accent', 'accentSubtle', 4.5],
  ['accent', 'surface', 4.5],
  ['tooltipText', 'tooltipBg', 7],
  ['border', 'background', 1.15],
  ['border', 'surface', 1.15],
];
for (const theme of [light, dark]) {
  for (const [foreground, background, minimum] of pairings) {
    const ratio = contrast(theme.colors[foreground], theme.colors[background]);
    assert.ok(
      ratio >= minimum,
      `${theme.scheme}: ${foreground} on ${background} is ${ratio.toFixed(2)}, under ${minimum}`,
    );
  }
}
assert.ok(
  luminance(dark.colors.background) < luminance(dark.colors.textPrimary) &&
    luminance(light.colors.background) > luminance(light.colors.textPrimary),
  'text is lighter than its ground in dark and darker in light',
);
assert.ok(
  luminance(dark.colors.surfaceElevated) > luminance(dark.colors.surface) &&
    luminance(dark.colors.surface) > luminance(dark.colors.background),
  'dark surfaces rise toward the viewer',
);

// The look: neutrals with no tint, ink as the accent, squircle surfaces, borders over shadows in dark.
for (const theme of [light, dark]) {
  for (const token of [
    'primary',
    'secondary',
    'background',
    'surface',
    'surfaceElevated',
    'textPrimary',
    'textSecondary',
    'textTertiary',
    'textInverse',
    'borderHover',
    'borderFocus',
    'inputBg',
  ]) {
    const [r, g, b] = theme.colors[token];
    assert.ok(r === g && g === b, `${theme.scheme}: ${token} is a pure neutral`);
  }
  assert.ok(!isShapeOff(theme.shape), `${theme.scheme}: corners are smoothed`);
  assert.ok(
    theme.radii.default >= theme.shape.smoothingThreshold,
    `${theme.scheme}: unmarked surfaces reach the smoothing threshold`,
  );
  assert.ok(
    theme.radii.md < theme.shape.smoothingThreshold,
    `${theme.scheme}: controls stay circular`,
  );
}
assert.ok(
  luminance(light.colors.primary) < luminance(light.colors.background) &&
    luminance(dark.colors.primary) > luminance(dark.colors.background),
  'primary is ink: dark on light, light on dark',
);
for (const [elevation, layers] of Object.entries(dark.shadows)) {
  assert.equal(layers.length, 0, `dark has no ${elevation} shadow`);
}
assert.ok(light.shadows.lg.length > 1, 'light shadows are stacks of soft layers');

// Variables the stylesheets read.
const vars = { light: themeVariables(light), dark: themeVariables(dark) };
assert.notEqual(vars.light['--background'], vars.dark['--background']);
assert.equal(vars.light['--radius-md'], '6px');
assert.equal(vars.light['--radius-default'], '12px');
assert.equal(vars.light['--radius-lg'], '14px');
assert.equal(vars.light['--text-base'], '16px');
assert.match(vars.light['--font-mono'], /JetBrains Mono/);
assert.equal(vars.light['--corner-n'], '1.3334237');
assert.deepEqual(light.shape, dark.shape, 'both schemes share the shape');
assert.notEqual(vars.light['--shadow-md'], 'none');
assert.equal(vars.dark['--shadow-md'], 'none');

// Rendering.
const W = 640;
const H = 460;
const native = loadNative();
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../../.blinc/base-ui-theme/', import.meta.url);
await mkdir(output, { recursive: true });
const context = native.createReactive();

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
/** The colour in `box` farthest from `ground`: the ink of text drawn there. */
function ink(pixels, [x, y, w, h], ground) {
  let best = ground;
  let far = 0;
  for (let row = Math.ceil(y); row < Math.floor(y + h); row++) {
    for (let col = Math.ceil(x); col < Math.floor(x + w); col++) {
      const c = pixel(pixels, col, row);
      const d = c.slice(0, 3).reduce((sum, v, i) => sum + Math.abs(v - ground[i]), 0);
      if (d > far) {
        far = d;
        best = c;
      }
    }
  }
  return best;
}

try {
  // The core defaults load clean.
  {
    const probe = Host.create(native);
    assert.deepEqual(addUserAgent(probe.layout).diagnostics, []);
    probe.dispose();
  }

  const host = Host.create(native);
  try {
    const errors = [];
    host.onStyleErrors((e) => errors.push(...e));
    addUserAgent(host.layout);
    addUtilities(host.layout);
    const state = new ThemeState(context, baseUiTheme, { scheme: 'light' });
    state.attach(host.layout);

    // Only classes that exist; a misspelt one would silently style nothing.
    const cls = (...names) => {
      for (const name of names) {
        assert.ok(utilityClasses.includes(name), `unknown utility class ${name}`);
      }
      return names.join(' ');
    };
    const el = (tag, className, style, children = []) => {
      const element = host.createElement(tag);
      element.className = className;
      if (style) {
        element.setAttribute('style', style);
      }
      for (const child of children) {
        element.appendChild(typeof child === 'string' ? host.createTextNode(child) : child);
      }
      return element;
    };
    const row = (gap, children) =>
      el('div', cls(gap), 'display: flex; flex-direction: row; align-items: flex-start', children);
    const box = 'border-width: 1px';

    const heading = el('span', cls('text-lg', 'font-semibold', 'text-text-primary'), null, [
      'Primary text',
    ]);
    const card = el(
      'div',
      cls('bg-surface', 'rounded-xl', 'p-4', 'border-border', 'gap-1'),
      `${box}; width: 200px; display: flex; flex-direction: column`,
      [
        heading,
        el('span', cls('text-sm', 'text-text-secondary'), null, ['Secondary text']),
        el('span', cls('text-sm', 'text-text-tertiary'), null, ['Tertiary text']),
      ],
    );
    const popover = el(
      'div',
      cls('bg-surface-elevated', 'rounded-xl', 'shadow-lg', 'p-4', 'border-border-secondary'),
      `${box}; width: 160px`,
      [el('span', cls('text-sm', 'text-text-primary'), null, ['Popover'])],
    );
    const input = el(
      'div',
      cls('bg-input-bg', 'rounded-md', 'px-3', 'py-2', 'border-border-hover'),
      `${box}; width: 150px`,
      [el('span', cls('text-sm', 'text-text-tertiary'), null, ['Placeholder'])],
    );
    const button = (label, className, style = '') =>
      el('div', className, `${style}; display: flex`, [
        el('span', cls('text-sm', 'font-medium'), null, [label]),
      ]);
    const primary = button(
      'Primary',
      cls('bg-primary', 'text-text-inverse', 'rounded-md', 'px-4', 'py-2'),
    );
    const outline = button(
      'Secondary',
      cls('text-text-primary', 'rounded-md', 'px-4', 'py-2', 'border-border-hover'),
      box,
    );
    const chip = button(
      'Accent',
      cls('bg-accent-subtle', 'text-accent', 'rounded-full', 'px-3', 'py-1'),
    );
    const focused = button(
      'Focused',
      cls('bg-primary', 'text-text-inverse', 'rounded-md', 'px-4', 'py-2'),
      'box-shadow: 0 0 0 2px var(--border-focus)',
    );
    const disabled = button(
      'Disabled',
      cls('bg-input-bg-disabled', 'text-text-tertiary', 'rounded-md', 'px-4', 'py-2'),
    );
    const badge = (label, background, ink) =>
      el('div', cls(background, ink, 'rounded-md', 'px-3', 'py-1.5'), 'display: flex', [
        el('span', cls('text-xs', 'font-medium'), null, [label]),
      ]);
    const badges = [
      badge('Success', 'bg-success-bg', 'text-success'),
      badge('Warning', 'bg-warning-bg', 'text-warning'),
      badge('Error', 'bg-error-bg', 'text-error'),
      badge('Info', 'bg-info-bg', 'text-info'),
    ];
    const code = el(
      'div',
      cls('bg-surface-elevated', 'rounded-lg', 'p-3', 'border-border'),
      `${box}; width: 480px`,
      [
        el('span', cls('font-mono', 'text-sm', 'text-text-primary'), null, [
          'const theme = new ThemeState(context, baseUiTheme);',
        ]),
      ],
    );
    const tooltip = el(
      'div',
      cls('bg-tooltip-bg', 'text-tooltip-text', 'rounded-md', 'px-2', 'py-1', 'border-border'),
      `${box}; width: 90px; display: flex`,
      [el('span', cls('text-xs'), null, ['Tooltip'])],
    );
    // A solid box at whole pixels; its corner pixel tells a squircle from a circle.
    const corner = el(
      'div',
      cls('bg-primary', 'rounded-3xl'),
      'position: absolute; left: 536px; top: 356px; width: 80px; height: 80px',
    );
    // No ground of its own: the user-agent sheet paints the root.
    const app = el(
      'div',
      cls('p-6', 'gap-5'),
      'position: relative; display: flex; flex-direction: column; width: 100%; height: 100%',
      [
        row('gap-4', [card, popover, input]),
        row('gap-3', [primary, outline, chip, focused, disabled]),
        row('gap-3', badges),
        code,
        tooltip,
        corner,
      ],
    );
    host.root.appendChild(app);

    // [element, token] pairs: the top edge of each, inside its border, is that colour.
    const fills = [
      [card, 'surface'],
      [popover, 'surfaceElevated'],
      [input, 'inputBg'],
      [primary, 'primary'],
      [chip, 'accentSubtle'],
      [disabled, 'inputBgDisabled'],
      [badges[0], 'successBg'],
      [badges[1], 'warningBg'],
      [badges[2], 'errorBg'],
      [badges[3], 'infoBg'],
      [code, 'surfaceElevated'],
      [tooltip, 'tooltipBg'],
    ];
    const edge = (element) => {
      const [x, y, w] = element.bounds();
      return [x + w / 2, y + 3];
    };
    const [cornerX, cornerY] = corner.bounds();
    assert.ok(
      Number.isInteger(cornerX) && Number.isInteger(cornerY),
      'the probe sits on whole pixels',
    );
    const cornerPixel = (pixels) => pixel(pixels, cornerX + 8, cornerY + 8);
    function check(pixels, theme) {
      assert.ok(
        near(pixel(pixels, W - 4, H - 4), rgb8(theme.colors.background)),
        `${theme.scheme}: the root is the background`,
      );
      for (const [element, token] of fills) {
        assert.ok(
          near(pixel(pixels, ...edge(element)), rgb8(theme.colors[token])),
          `${theme.scheme}: ${token}`,
        );
      }
      // 8px in from a 32px corner: inside a squircle's curve, outside a circle's.
      assert.ok(
        near(cornerPixel(pixels), rgb8(theme.colors.primary)),
        `${theme.scheme}: the shape tokens smooth the corner`,
      );
      const strongest = ink(pixels, heading.bounds(), rgb8(theme.colors.surface));
      assert.ok(
        near(strongest, rgb8(theme.colors.textPrimary), 24),
        `${theme.scheme}: text inherits its ink, got ${strongest}`,
      );
    }

    const lightPixels = await capture(host, 'light');
    const layout = geometry(host.root);
    check(lightPixels, light);

    // With smoothing off, the same corner is a circle's and leaves that pixel bare.
    state.override({ shape: { cornerSmoothing: 0 } });
    assert.ok(
      near(cornerPixel(await capture(host)), rgb8(light.colors.background)),
      'without smoothing the corner is circular',
    );
    state.clearOverrides();

    state.setScheme('dark');
    const darkPixels = await capture(host, 'dark');
    assert.deepEqual(geometry(host.root), layout, 'a scheme switch keeps the geometry');
    assert.ok(!darkPixels.equals(lightPixels), 'a scheme switch changes the pixels');
    check(darkPixels, dark);

    state.setScheme('light');
    assert.ok((await capture(host)).equals(lightPixels), 'switching back restores the pixels');
    assert.deepEqual(errors, [], 'no declaration was refused');
    state.dispose();
  } finally {
    host.dispose();
  }
} finally {
  context.dispose();
  target.dispose();
}
console.log(
  JSON.stringify({
    test: 'Base UI theme',
    tokens: colorTokens.length,
    contrastPairings: pairings.length * 2,
    output: output.pathname,
  }),
);
