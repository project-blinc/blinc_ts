import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  colorTokens,
  cornerN,
  cssColor,
  cssEasing,
  cubicBezier,
  ease,
  effectiveExponent,
  extendBundle,
  extendTheme,
  hex,
  isShapeOff,
  lerpShape,
  neutralTheme,
  shapeOff,
  shapeOptions,
  shapeTokens,
  spacingScale,
  themeVariables,
} from '../dist/theme/index.js';
import { classes, utilityClasses, utilityCss } from '../dist/theme/utilities.js';
import { userAgentCss } from '../dist/theme/user-agent.js';

test('the reference smoothing resolves to a fractional corner n', () => {
  const hybrid = shapeTokens(0.4, 3.3, 12);
  assert.equal(effectiveExponent(hybrid), Math.fround(2.52));
  assert.equal(cornerN(hybrid), 1.3334237337112427);
  assert.ok(Math.abs(cornerN(hybrid) - 1.3334237) < 1e-7);
  assert.notEqual(cornerN(hybrid), Math.round(cornerN(hybrid)));
  assert.deepEqual(shapeOptions(hybrid, 9999), {
    cornerShape: 1.3334237337112427,
    smoothingThreshold: 12,
    fullRadius: 9999,
  });
});

test('the effective exponent clamps smoothing and the exponent', () => {
  assert.equal(effectiveExponent(shapeTokens(1, 4, 0)), 4);
  assert.equal(cornerN(shapeTokens(1, 4, 0)), 2);
  assert.equal(effectiveExponent(shapeTokens(2, 4, 0)), 4, 'smoothing clamps to 1');
  assert.equal(effectiveExponent(shapeTokens(0.5, 1, 0)), 2, 'an exponent under 2 is a circle');
  assert.equal(effectiveExponent(shapeTokens(-1, 4, 0)), 2, 'negative smoothing is none');
});

test('smoothing off gives the renderer n = 0', () => {
  assert.ok(isShapeOff(shapeOff));
  assert.equal(cornerN(shapeOff), 0);
  assert.ok(isShapeOff(shapeTokens(0, 4, 8)));
  assert.ok(isShapeOff(shapeTokens(0.6, 4, Infinity)));
  assert.deepEqual(shapeOptions(shapeOff), {
    cornerShape: 0,
    smoothingThreshold: 0,
    fullRadius: 9999,
  });
});

test('shape tokens interpolate and keep a finite threshold', () => {
  const a = shapeTokens(0, 2, Infinity);
  const b = shapeTokens(0.6, 4, 10);
  const mid = lerpShape(a, b, 0.5);
  assert.equal(mid.cornerSmoothing, Math.fround(0.3));
  assert.equal(mid.cornerExponent, 3);
  assert.equal(mid.smoothingThreshold, 10);
  assert.deepEqual(lerpShape(a, b, 2), b);
});

test('colours read and write as CSS', () => {
  assert.deepEqual(hex('#ff8000'), [1, 128 / 255, 0, 1]);
  assert.deepEqual(hex(0x00ff00, 0.5), [0, 1, 0, 0.5]);
  assert.deepEqual(hex('#0f08'), [0, 1, 0, 0x88 / 255]);
  assert.equal(cssColor(hex(0x3f5f8f)), '#3f5f8f');
  assert.equal(cssColor(hex(0x000000, 0.4)), 'rgba(0,0,0,0.4)');
  assert.throws(() => hex('nope'));
});

test('easings evaluate as CSS curves', () => {
  assert.equal(cssEasing('linear'), 'linear');
  assert.equal(cssEasing('ease-out'), 'cubic-bezier(0, 0, 0.2, 1)');
  assert.equal(cssEasing(cubicBezier(0.34, 1.56, 0.64, 1)), 'cubic-bezier(0.34, 1.56, 0.64, 1)');
  assert.equal(cssEasing({ steps: 4 }), 'steps(4, jump-end)');
  assert.equal(ease('linear', 0.3), 0.3);
  assert.equal(ease('ease-in-out', 0), 0);
  assert.ok(Math.abs(ease('ease-in-out', 1) - 1) < 1e-6);
  assert.ok(Math.abs(ease(cubicBezier(0.42, 0, 0.58, 1), 0.5) - 0.5) < 1e-4, 'symmetric curve');
  const overshoot = Math.max(
    ...[0.5, 0.6, 0.7, 0.8].map((t) => ease(cubicBezier(0.34, 1.56, 0.64, 1), t)),
  );
  assert.ok(overshoot > 1, 'a spring curve overshoots');
  assert.equal(ease({ steps: 4 }, 0.3), 0.25);
  assert.equal(ease({ steps: 4, jumpStart: true }, 0.3), 0.5);
});

test('every token becomes a CSS variable', () => {
  const vars = themeVariables(neutralTheme.light);
  for (const token of colorTokens) {
    const name = `--${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    assert.match(vars[name], /^(#[0-9a-f]{6}|rgba\()/, name);
  }
  assert.equal(vars['--surface-elevated'], '#ffffff');
  assert.equal(vars['--space-4'], '16px');
  assert.equal(vars['--space-0-5'], '2px');
  assert.equal(vars['--radius-lg'], '8px');
  assert.equal(vars['--radius-full'], '9999px');
  assert.equal(vars['--text-lg'], '18px');
  assert.equal(vars['--font-semibold'], '600');
  assert.equal(vars['--leading-snug'], '1.375');
  assert.equal(vars['--tracking-wide'], '0.025em');
  assert.equal(vars['--shadow-md'], '0px 4px 6px -1px rgba(0,0,0,0.1)');
  assert.equal(vars['--shadow-inner'], 'inset 0px 2px 4px 0px rgba(0,0,0,0.05)');
  assert.equal(vars['--shadow-none'], 'none');
  assert.equal(vars['--duration-normal'], '200ms');
  assert.equal(vars['--ease-in-out'], 'cubic-bezier(0.4, 0, 0.2, 1)');
  assert.equal(vars['--corner-smoothing'], '0');
  assert.equal(vars['--smoothing-threshold'], 'infinity');
  assert.equal(vars['--corner-n'], '0');
  assert.equal(vars['--focus-ring'], 'rgba(63,95,143,0.35)');
});

test('the shape reaches CSS variables as f32 values', () => {
  const theme = extendTheme(neutralTheme.light, {
    shape: { cornerSmoothing: 0.4, cornerExponent: 3.3, smoothingThreshold: 12 },
  });
  const vars = themeVariables(theme);
  assert.equal(vars['--corner-smoothing'], '0.4');
  assert.equal(vars['--corner-exponent'], '3.3');
  assert.equal(vars['--smoothing-threshold'], '12px');
  assert.equal(vars['--corner-n'], '1.3334237');
  assert.equal(theme.shape.cornerSmoothing, Math.fround(0.4));
});

test('variants keep the tokens they do not change', () => {
  const variant = extendBundle(neutralTheme, {
    name: 'Roomy',
    spacing: spacingScale(5),
    radii: { default: 12 },
    typography: { sizes: { base: 17 } },
  });
  assert.equal(variant.name, 'Roomy');
  for (const theme of [variant.light, variant.dark]) {
    assert.equal(theme.spacing['4'], 20);
    assert.equal(theme.radii.default, 12);
    assert.equal(theme.radii.lg, 8);
    assert.equal(theme.typography.sizes.base, 17);
    assert.equal(theme.typography.sizes.lg, 18);
  }
  assert.deepEqual(variant.light.colors, neutralTheme.light.colors);
  assert.deepEqual(variant.dark.colors, neutralTheme.dark.colors);
  const split = extendBundle(neutralTheme, { dark: { colors: { primary: hex(0xff0000) } } });
  assert.deepEqual(split.dark.colors.primary, hex(0xff0000));
  assert.deepEqual(split.light.colors.primary, neutralTheme.light.colors.primary);
});

test('the neutral theme defines every token in both schemes', () => {
  for (const theme of [neutralTheme.light, neutralTheme.dark]) {
    assert.deepEqual(Object.keys(theme.colors).sort(), [...colorTokens].sort());
    assert.ok(Object.values(themeVariables(theme)).every((v) => typeof v === 'string' && v));
  }
  assert.equal(neutralTheme.light.scheme, 'light');
  assert.equal(neutralTheme.dark.scheme, 'dark');
});

test('utility classes are generated from the token names', () => {
  const css = utilityCss();
  assert.ok(utilityClasses.includes('bg-surface-elevated'));
  assert.ok(utilityClasses.includes('p-0.5'));
  assert.ok(utilityClasses.includes('rounded'));
  assert.ok(utilityClasses.includes('shadow-inner'));
  assert.match(css, /^\.shadow-inner \{ box-shadow: var\(--shadow-inner\); \}$/m);
  assert.equal(new Set(utilityClasses).size, utilityClasses.length, 'names are unique');
  assert.match(css, /^\.bg-surface-elevated \{ background: var\(--surface-elevated\); \}$/m);
  assert.match(css, /^\.p-0\\\.5 \{ padding: var\(--space-0-5\); \}$/m);
  assert.match(
    css,
    /^\.px-4 \{ padding-left: var\(--space-4\); padding-right: var\(--space-4\); \}$/m,
  );
  assert.match(css, /^\.rounded-lg \{ border-radius: var\(--radius-lg\); \}$/m);
  assert.match(css, /^\.shadow \{ box-shadow: var\(--shadow\); \}$/m);
  assert.match(css, /^\.tracking-wide \{ letter-spacing: var\(--tracking-wide\); \}$/m);
  assert.match(css, /^\.corner-round-locked \{ corner-shape: round locked; \}$/m);
  assert.equal(classes('p-4', false, 'bg-surface', undefined), 'p-4 bg-surface');
});

test('the user-agent sheet reads only variables a theme defines', () => {
  const css = userAgentCss();
  const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)[,)]/g)].map((m) => m[1]));
  assert.ok(used.size > 10, 'it is themed');
  for (const theme of [neutralTheme.light, neutralTheme.dark]) {
    const defined = themeVariables(theme);
    for (const name of used) {
      assert.ok(name in defined, `${theme.scheme}: ${name} is not a theme variable`);
    }
  }
});

test('the user-agent sheet declares nothing the host drops', () => {
  // These parse without an error and then do nothing.
  const dropped = /(?:^|[;{\s])(transition|animation|clip-path|text-decoration|text-align)\s*:/gm;
  assert.deepEqual(
    [...userAgentCss().matchAll(dropped)].map((m) => m[1]),
    [],
  );
});
