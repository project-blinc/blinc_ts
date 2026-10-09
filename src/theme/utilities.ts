/**
 * Utility classes generated from the token names: `bg-surface`, `p-4`,
 * `rounded-lg`, `shadow-md`, `text-lg`, `font-semibold`. Each reads its
 * token through a CSS variable, so the sheet is the same for every theme
 * and a theme change restyles through the cascade. Importing this module is
 * optional; an app that does not pays nothing for it.
 */
import type { Layout, StyleSheet } from '../native/layout.js';
import { kebab } from './theme.js';
import {
  colorTokens,
  fontFamilies,
  fontWeights,
  letterSpacings,
  lineHeights,
  radiusTokens,
  shadowTokens,
  spacingTokens,
  textSizes,
  type ColorToken,
  type FontFamilyName,
  type FontWeightName,
  type LetterSpacingName,
  type LineHeightName,
  type RadiusToken,
  type ShadowToken,
  type SpacingToken,
  type TextSize,
} from './tokens.js';

type Kebab<S extends string> = S extends `${infer Head}${infer Tail}`
  ? Head extends Lowercase<Head>
    ? `${Head}${Kebab<Tail>}`
    : `-${Lowercase<Head>}${Kebab<Tail>}`
  : S;
type ColorName = Kebab<ColorToken>;
const spacingPrefixes = {
  p: ['padding'],
  px: ['padding-left', 'padding-right'],
  py: ['padding-top', 'padding-bottom'],
  pt: ['padding-top'],
  pr: ['padding-right'],
  pb: ['padding-bottom'],
  pl: ['padding-left'],
  m: ['margin'],
  mx: ['margin-left', 'margin-right'],
  my: ['margin-top', 'margin-bottom'],
  mt: ['margin-top'],
  mr: ['margin-right'],
  mb: ['margin-bottom'],
  ml: ['margin-left'],
  gap: ['gap'],
  'gap-x': ['column-gap'],
  'gap-y': ['row-gap'],
  w: ['width'],
  h: ['height'],
  size: ['width', 'height'],
} as const;
type SpacingPrefix = keyof typeof spacingPrefixes;
const cornerShapes = ['round', 'squircle', 'bevel', 'scoop', 'notch', 'square'] as const;
type CornerShapeName = (typeof cornerShapes)[number];

/** Every utility class name, as a type, so a misspelt class is a compile error. */
export type UtilityClass =
  | `bg-${ColorName}`
  | `text-${ColorName}`
  | `border-${ColorName}`
  | `${SpacingPrefix}-${SpacingToken}`
  | 'rounded'
  | `rounded-${Exclude<RadiusToken, 'default'>}`
  | 'shadow'
  | `shadow-${Exclude<ShadowToken, 'default'>}`
  | `text-${TextSize}`
  | `font-${FontWeightName | FontFamilyName}`
  | `leading-${LineHeightName}`
  | `tracking-${LetterSpacingName}`
  | `corner-${CornerShapeName}`
  | 'corner-round-locked';

/** Space-separated utility classes, checked: `classes('p-4', 'bg-surface')`. */
export function classes(...names: (UtilityClass | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

/** `name` as a class selector, its dots escaped. */
function selector(name: string): string {
  return `.${name.replace(/\./g, '\\.')}`;
}

/** The utility rules, by class name. */
function rules(): [name: string, declarations: string][] {
  const out: [string, string][] = [];
  for (const token of colorTokens) {
    const name = kebab(token);
    out.push([`bg-${name}`, `background: var(--${name})`]);
    out.push([`text-${name}`, `color: var(--${name})`]);
    out.push([`border-${name}`, `border-color: var(--${name})`]);
  }
  for (const [prefix, properties] of Object.entries(spacingPrefixes)) {
    for (const step of spacingTokens) {
      out.push([
        `${prefix}-${step}`,
        properties.map((p) => `${p}: var(--space-${kebab(step)})`).join('; '),
      ]);
    }
  }
  for (const radius of radiusTokens) {
    out.push([
      radius === 'default' ? 'rounded' : `rounded-${radius}`,
      `border-radius: var(--radius-${radius})`,
    ]);
  }
  for (const shadow of shadowTokens) {
    const name = shadow === 'default' ? 'shadow' : `shadow-${shadow}`;
    out.push([name, `box-shadow: var(--${name})`]);
  }
  for (const size of textSizes) {
    out.push([`text-${size}`, `font-size: var(--text-${size})`]);
  }
  for (const weight of fontWeights) {
    out.push([`font-${weight}`, `font-weight: var(--font-${weight})`]);
  }
  for (const family of fontFamilies) {
    out.push([`font-${family}`, `font-family: var(--font-${family})`]);
  }
  for (const leading of lineHeights) {
    out.push([`leading-${leading}`, `line-height: var(--leading-${leading})`]);
  }
  for (const tracking of letterSpacings) {
    out.push([`tracking-${tracking}`, `letter-spacing: var(--tracking-${tracking})`]);
  }
  for (const shape of cornerShapes) {
    out.push([`corner-${shape}`, `corner-shape: ${shape}`]);
  }
  out.push(['corner-round-locked', 'corner-shape: round locked']);
  return out;
}

/** Every utility class name. */
export const utilityClasses: readonly UtilityClass[] = Object.freeze(
  rules().map(([name]) => name as UtilityClass),
);

/** The utility classes as a stylesheet, for `Layout.addStyleSheet` or a build step. */
export function utilityCss(): string {
  return rules()
    .map(([name, declarations]) => `${selector(name)} { ${declarations}; }`)
    .join('\n');
}

/**
 * Add the utility sheet to `layout`, first among its sheets so an app's own
 * rules of equal specificity win. Returns the sheet, for `removeStyleSheet`.
 */
export function addUtilities(layout: Layout): StyleSheet {
  return layout.addStyleSheet(utilityCss(), { at: 0, file: 'utilities.css' });
}
