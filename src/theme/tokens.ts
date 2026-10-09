/**
 * The token families a theme supplies. A token is a named design value,
 * a colour, a spacing step, a radius, that UI code refers to by name; the
 * theme gives the values, so changing the theme restyles what uses them.
 * Each family's names are listed once here, and the types, the CSS
 * variables and the utility classes are all derived from these lists.
 */
import type { Color } from './color.js';
import type { Easing } from './easing.js';

/** The semantic colours. */
export const colorTokens = [
  'primary',
  'primaryHover',
  'primaryActive',
  'secondary',
  'secondaryHover',
  'secondaryActive',
  'success',
  'successBg',
  'warning',
  'warningBg',
  'error',
  'errorBg',
  'info',
  'infoBg',
  'background',
  'surface',
  'surfaceElevated',
  'surfaceOverlay',
  'textPrimary',
  'textSecondary',
  'textTertiary',
  'textInverse',
  'textLink',
  'border',
  'borderSecondary',
  'borderHover',
  'borderFocus',
  'borderError',
  'inputBg',
  'inputBgHover',
  'inputBgFocus',
  'inputBgDisabled',
  'selection',
  'selectionText',
  'accent',
  'accentSubtle',
  'tooltipBg',
  'tooltipText',
] as const;
export type ColorToken = (typeof colorTokens)[number];
export type ColorTokens = Readonly<Record<ColorToken, Color>>;

/** The spacing steps, named by their multiple of the base unit. */
export const spacingTokens = [
  '0',
  '0.5',
  '1',
  '1.5',
  '2',
  '2.5',
  '3',
  '3.5',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '14',
  '16',
  '20',
  '24',
  '28',
  '32',
] as const;
export type SpacingToken = (typeof spacingTokens)[number];
/** Pixels per step. */
export type SpacingTokens = Readonly<Record<SpacingToken, number>>;

/** The corner radii. `default` is what an unmarked surface gets. */
export const radiusTokens = [
  'none',
  'sm',
  'default',
  'md',
  'lg',
  'xl',
  '2xl',
  '3xl',
  'full',
] as const;
export type RadiusToken = (typeof radiusTokens)[number];
/** Pixels per radius. */
export type RadiusTokens = Readonly<Record<RadiusToken, number>>;

/** One layer of a shadow, outside the box or, `inset`, inside it. */
export interface ShadowLayer {
  readonly x: number;
  readonly y: number;
  readonly blur: number;
  readonly spread: number;
  readonly color: Color;
  readonly inset?: boolean;
}
/** The shadow stacks, by elevation. */
export const shadowTokens = ['sm', 'default', 'md', 'lg', 'xl', '2xl', 'inner', 'none'] as const;
export type ShadowToken = (typeof shadowTokens)[number];
export type ShadowTokens = Readonly<Record<ShadowToken, readonly ShadowLayer[]>>;

export const textSizes = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'] as const;
export type TextSize = (typeof textSizes)[number];
export const fontWeights = [
  'thin',
  'light',
  'normal',
  'medium',
  'semibold',
  'bold',
  'black',
] as const;
export type FontWeightName = (typeof fontWeights)[number];
export const lineHeights = ['none', 'tight', 'snug', 'normal', 'relaxed', 'loose'] as const;
export type LineHeightName = (typeof lineHeights)[number];
export const letterSpacings = ['tighter', 'tight', 'normal', 'wide', 'wider'] as const;
export type LetterSpacingName = (typeof letterSpacings)[number];
export const fontFamilies = ['sans', 'serif', 'mono'] as const;
export type FontFamilyName = (typeof fontFamilies)[number];

/** The theme's type. */
export interface TypographyTokens {
  /** CSS family stacks, such as `Inter, system-ui, sans-serif`. */
  readonly fonts: Readonly<Record<FontFamilyName, string>>;
  /** Font sizes in pixels. */
  readonly sizes: Readonly<Record<TextSize, number>>;
  /** Weights, 1 to 1000. */
  readonly weights: Readonly<Record<FontWeightName, number>>;
  /** Line heights as multiples of the font size. */
  readonly leading: Readonly<Record<LineHeightName, number>>;
  /** Letter spacing in ems. */
  readonly tracking: Readonly<Record<LetterSpacingName, number>>;
}

export const durations = [
  'fastest',
  'faster',
  'fast',
  'normal',
  'slow',
  'slower',
  'slowest',
] as const;
export type DurationName = (typeof durations)[number];
/**
 * The curves: `default`, `in`, `out` and `in-out`; `state` for hover, press
 * and other state changes; `nav` for navigation; `spring` for popovers and
 * badges, which may overshoot; `sheet` for sheets and drawers.
 */
export const easings = [
  'default',
  'in',
  'out',
  'in-out',
  'state',
  'nav',
  'spring',
  'sheet',
] as const;
export type EasingName = (typeof easings)[number];

/** The theme's motion. */
export interface AnimationTokens {
  /** Milliseconds. */
  readonly durations: Readonly<Record<DurationName, number>>;
  readonly easings: Readonly<Record<EasingName, Easing>>;
}
