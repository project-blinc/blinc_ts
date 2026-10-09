import { cssColor, number, px, withAlpha, type Color } from './color.js';
import { cssEasing } from './easing.js';
import { cornerN, shapeOff, shapeTokens, type ShapeTokens } from './shape.js';
import {
  colorTokens,
  durations,
  easings,
  fontFamilies,
  fontWeights,
  letterSpacings,
  lineHeights,
  radiusTokens,
  shadowTokens,
  spacingTokens,
  textSizes,
  type AnimationTokens,
  type ColorToken,
  type ColorTokens,
  type RadiusTokens,
  type ShadowLayer,
  type ShadowTokens,
  type SpacingTokens,
  type TypographyTokens,
} from './tokens.js';

export type ColorScheme = 'light' | 'dark';

/** One scheme of a theme, light or dark: every token family. */
export interface Theme {
  readonly name: string;
  readonly scheme: ColorScheme;
  readonly colors: ColorTokens;
  readonly typography: TypographyTokens;
  readonly spacing: SpacingTokens;
  readonly radii: RadiusTokens;
  readonly shadows: ShadowTokens;
  readonly animations: AnimationTokens;
  /** Corner smoothing; `shapeOff` when the theme keeps corners circular. */
  readonly shape: ShapeTokens;
}

/** A theme's light and dark schemes, and the stylesheets that come with it. */
export interface ThemeBundle {
  readonly name: string;
  readonly light: Theme;
  readonly dark: Theme;
  /** Stylesheets, as CSS text or compiled bytes, added after the theme's variables are set. */
  readonly css?: readonly (string | Uint8Array)[];
}

/** Partial token families, merged over a theme's. */
export interface ThemePatch {
  readonly name?: string;
  readonly colors?: Partial<ColorTokens>;
  readonly typography?: {
    readonly [K in keyof TypographyTokens]?: Partial<TypographyTokens[K]>;
  };
  readonly spacing?: Partial<SpacingTokens>;
  readonly radii?: Partial<RadiusTokens>;
  readonly shadows?: Partial<ShadowTokens>;
  readonly animations?: {
    readonly [K in keyof AnimationTokens]?: Partial<AnimationTokens[K]>;
  };
  readonly shape?: Partial<ShapeTokens>;
}

/** The light or the dark theme of `bundle`. */
export function themeFor(bundle: ThemeBundle, scheme: ColorScheme): Theme {
  return scheme === 'dark' ? bundle.dark : bundle.light;
}

/** `base` with `patch`'s tokens in place of its own. */
export function extendTheme(base: Theme, patch: ThemePatch): Theme {
  const t = patch.typography;
  const a = patch.animations;
  const shape = patch.shape ? { ...base.shape, ...patch.shape } : base.shape;
  return Object.freeze({
    name: patch.name ?? base.name,
    scheme: base.scheme,
    colors: { ...base.colors, ...patch.colors },
    typography: {
      fonts: { ...base.typography.fonts, ...t?.fonts },
      sizes: { ...base.typography.sizes, ...t?.sizes },
      weights: { ...base.typography.weights, ...t?.weights },
      leading: { ...base.typography.leading, ...t?.leading },
      tracking: { ...base.typography.tracking, ...t?.tracking },
    },
    spacing: { ...base.spacing, ...patch.spacing },
    radii: { ...base.radii, ...patch.radii },
    shadows: { ...base.shadows, ...patch.shadows },
    animations: {
      durations: { ...base.animations.durations, ...a?.durations },
      easings: { ...base.animations.easings, ...a?.easings },
    },
    shape: shapeTokens(shape.cornerSmoothing, shape.cornerExponent, shape.smoothingThreshold),
  });
}

/**
 * `bundle` with `patch` applied to both schemes, or `light` and `dark`
 * patches to each, so a variant keeps the base's tokens it does not change.
 */
export function extendBundle(
  bundle: ThemeBundle,
  patch: ThemePatch | { readonly light?: ThemePatch; readonly dark?: ThemePatch; name?: string },
): ThemeBundle {
  const split = 'light' in patch || 'dark' in patch;
  const light = split ? (patch as { light?: ThemePatch }).light : (patch as ThemePatch);
  const dark = split ? (patch as { dark?: ThemePatch }).dark : (patch as ThemePatch);
  return Object.freeze({
    name: patch.name ?? bundle.name,
    light: extendTheme(bundle.light, { ...light, ...(patch.name ? { name: patch.name } : {}) }),
    dark: extendTheme(bundle.dark, { ...dark, ...(patch.name ? { name: patch.name } : {}) }),
    ...(bundle.css ? { css: bundle.css } : {}),
  });
}

/** A theme from its parts; `shape` defaults to `shapeOff`. */
export function defineTheme(theme: Omit<Theme, 'shape'> & { readonly shape?: ShapeTokens }): Theme {
  const s = theme.shape ?? shapeOff;
  return extendTheme(
    { ...theme, shape: shapeTokens(s.cornerSmoothing, s.cornerExponent, s.smoothingThreshold) },
    {},
  );
}

/** Each step as that many multiples of `base` pixels. */
export function spacingScale(base = 4): SpacingTokens {
  return Object.freeze(
    Object.fromEntries(spacingTokens.map((step) => [step, Math.fround(base * Number(step))])),
  ) as SpacingTokens;
}

/** A radius ladder; `default` is what unmarked surfaces get. */
export function radiusScale(radii: Partial<RadiusTokens> = {}): RadiusTokens {
  return Object.freeze({
    none: 0,
    sm: 2,
    default: 4,
    md: 6,
    lg: 8,
    xl: 12,
    '2xl': 16,
    '3xl': 24,
    full: 9999,
    ...radii,
  });
}

/**
 * One layer per elevation in `color`, at the given alphas for sm, default,
 * md, lg, xl, 2xl and inner.
 */
export function shadowScale(
  alphas: readonly [number, number, number, number, number, number, number],
  color: Color = [0, 0, 0, 1],
): ShadowTokens {
  const layer = (y: number, blur: number, spread: number, alpha: number, inset = false) => [
    Object.freeze({
      x: 0,
      y,
      blur,
      spread,
      color: withAlpha(color, alpha),
      ...(inset ? { inset } : {}),
    }),
  ];
  return Object.freeze({
    sm: layer(1, 2, 0, alphas[0]),
    default: layer(1, 3, 0, alphas[1]),
    md: layer(4, 6, -1, alphas[2]),
    lg: layer(10, 15, -3, alphas[3]),
    xl: layer(20, 25, -5, alphas[4]),
    '2xl': layer(25, 50, -12, alphas[5]),
    inner: layer(2, 4, 0, alphas[6], true),
    none: [],
  });
}

/** A type scale on system font stacks. */
export function typographyScale(patch: ThemePatch['typography'] = {}): TypographyTokens {
  return Object.freeze({
    fonts: {
      sans: 'system-ui, sans-serif',
      serif: 'serif',
      mono: 'monospace',
      ...patch.fonts,
    },
    sizes: {
      xs: 12,
      sm: 14,
      base: 16,
      lg: 18,
      xl: 20,
      '2xl': 24,
      '3xl': 30,
      '4xl': 36,
      '5xl': 48,
      ...patch.sizes,
    },
    weights: {
      thin: 100,
      light: 300,
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
      black: 900,
      ...patch.weights,
    },
    leading: {
      none: 1,
      tight: 1.25,
      snug: 1.375,
      normal: 1.5,
      relaxed: 1.625,
      loose: 2,
      ...patch.leading,
    },
    tracking: {
      tighter: -0.05,
      tight: -0.025,
      normal: 0,
      wide: 0.025,
      wider: 0.05,
      ...patch.tracking,
    },
  });
}

/** Durations on a 75 to 500 ms ladder, easing out by default. */
export function animationScale(patch: ThemePatch['animations'] = {}): AnimationTokens {
  const easings: AnimationTokens['easings'] = {
    default: 'ease-out',
    in: 'ease-in',
    out: 'ease-out',
    'in-out': 'ease-in-out',
    state: 'ease-out',
    nav: 'ease-in-out',
    spring: 'ease-out',
    sheet: 'ease-out',
    ...patch.easings,
  };
  return Object.freeze({
    durations: {
      fastest: 75,
      faster: 100,
      fast: 150,
      normal: 200,
      slow: 300,
      slower: 400,
      slowest: 500,
      ...patch.durations,
    },
    easings,
  });
}

/** `primaryHover` as `primary-hover`. */
export function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/\./g, '-');
}

/** The CSS variable a colour token is read through, with `--`. */
export function colorVariable(token: ColorToken): string {
  return `--${kebab(token)}`;
}

/** A shadow stack as `box-shadow` text; `none` for an empty one. */
export function cssShadow(stack: readonly ShadowLayer[]): string {
  const layers = stack
    .filter((l) => l.color[3] > 0 || l.blur > 0 || l.spread !== 0)
    .map(
      (l) =>
        `${l.inset ? 'inset ' : ''}${px(l.x)} ${px(l.y)} ${px(l.blur)} ${px(l.spread)} ${cssColor(l.color)}`,
    );
  return layers.length === 0 ? 'none' : layers.join(', ');
}

/**
 * Every token of `theme` as a CSS custom property, by name with `--`:
 * `--primary`, `--space-4`, `--radius-lg`, `--text-lg`, `--font-semibold`,
 * `--leading-normal`, `--tracking-wide`, `--shadow-md`, `--duration-normal`,
 * `--ease-spring`, and the shape's `--corner-smoothing`,
 * `--corner-exponent`, `--smoothing-threshold` and `--corner-n`.
 */
export function themeVariables(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const token of colorTokens) {
    vars[colorVariable(token)] = cssColor(theme.colors[token]);
  }
  vars['--focus-ring'] = cssColor(withAlpha(theme.colors.borderFocus, 0.35));
  vars['--focus-ring-error'] = cssColor(withAlpha(theme.colors.borderError, 0.35));
  vars['--focus-ring-success'] = cssColor(withAlpha(theme.colors.success, 0.35));
  for (const step of spacingTokens) {
    vars[`--space-${kebab(step)}`] = px(theme.spacing[step]);
  }
  for (const radius of radiusTokens) {
    vars[`--radius-${radius}`] = px(theme.radii[radius]);
  }
  const t = theme.typography;
  for (const family of fontFamilies) {
    vars[`--font-${family}`] = t.fonts[family];
  }
  for (const size of textSizes) {
    vars[`--text-${size}`] = px(t.sizes[size]);
  }
  for (const weight of fontWeights) {
    vars[`--font-${weight}`] = number(t.weights[weight]);
  }
  for (const leading of lineHeights) {
    vars[`--leading-${leading}`] = number(t.leading[leading]);
  }
  for (const tracking of letterSpacings) {
    vars[`--tracking-${tracking}`] = `${number(t.tracking[tracking])}em`;
  }
  for (const shadow of shadowTokens) {
    vars[shadow === 'default' ? '--shadow' : `--shadow-${shadow}`] = cssShadow(
      theme.shadows[shadow],
    );
  }
  const a = theme.animations;
  for (const duration of durations) {
    vars[`--duration-${duration}`] = `${a.durations[duration]}ms`;
  }
  for (const curve of easings) {
    vars[`--ease-${curve}`] = cssEasing(a.easings[curve]);
  }
  const shape = theme.shape;
  vars['--corner-smoothing'] = number(shape.cornerSmoothing);
  vars['--corner-exponent'] = number(shape.cornerExponent);
  vars['--smoothing-threshold'] = Number.isFinite(shape.smoothingThreshold)
    ? px(shape.smoothingThreshold)
    : 'infinity';
  vars['--corner-n'] = number(cornerN(shape));
  return vars;
}
