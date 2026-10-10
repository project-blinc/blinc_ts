/**
 * The theme of Blinc's own wiki and demos, after base-ui.com: pure neutrals,
 * hairline borders on panels, ink as the one accent, and colour only for
 * links, code and status. Surfaces are squircles, enforced by the theme's
 * shape tokens. It is an internal fixture, not part of the SDK's surface; a
 * bundle with the same token names would restyle everything built on it.
 *
 * Light and dark share every scale and differ in colour and shadow, so a
 * scheme switch restyles in place.
 */
import {
  animationScale,
  defineTheme,
  hex,
  radiusScale,
  shapeTokens,
  spacingScale,
  typographyScale,
  type ColorTokens,
  type ShadowLayer,
  type ShadowTokens,
  type ThemeBundle,
} from 'blinc_ts/theme';

const light: ColorTokens = {
  primary: hex(0x0a0a0a),
  primaryHover: hex(0x262626),
  primaryActive: hex(0x404040),
  secondary: hex(0x595959),
  secondaryHover: hex(0x2e2e2e),
  secondaryActive: hex(0x0a0a0a),
  success: hex(0x0f6a31),
  successBg: hex(0xe8fbeb),
  warning: hex(0x754b00),
  warningBg: hex(0xfff4d7),
  error: hex(0xc10000),
  errorBg: hex(0xffebe6),
  info: hex(0x1745c2),
  infoBg: hex(0xebf7ff),
  background: hex(0xffffff),
  surface: hex(0xfcfcfc),
  surfaceElevated: hex(0xffffff),
  surfaceOverlay: hex(0x000000, 0.1),
  textPrimary: hex(0x2e2e2e),
  textSecondary: hex(0x595959),
  textTertiary: hex(0x717171),
  textInverse: hex(0xffffff),
  textLink: hex(0x1745c2),
  border: hex('#00000014'),
  borderSecondary: hex('#0000000a'),
  borderHover: hex(0xe0e0e0),
  borderFocus: hex(0x2e2e2e),
  borderError: hex(0xc10000),
  inputBg: hex(0xffffff),
  inputBgHover: hex(0xf5f5f5),
  inputBgFocus: hex(0xffffff),
  inputBgDisabled: hex(0xf0f0f0),
  selection: hex(0xebebeb),
  selectionText: hex(0x2e2e2e),
  accent: hex(0x1745c2),
  accentSubtle: hex(0xebf7ff),
  tooltipBg: hex(0xffffff),
  tooltipText: hex(0x2e2e2e),
};

const dark: ColorTokens = {
  primary: hex(0xffffff),
  primaryHover: hex(0xe6e6e6),
  primaryActive: hex(0xcccccc),
  secondary: hex(0xb3b3b3),
  secondaryHover: hex(0xe6e6e6),
  secondaryActive: hex(0xffffff),
  success: hex(0x7fc08c),
  successBg: hex(0x0b2612),
  warning: hex(0xe8be62),
  warningBg: hex(0x2d1f01),
  error: hex(0xff7a5e),
  errorBg: hex(0x3d110b),
  info: hex(0x5a93ff),
  infoBg: hex(0x11212c),
  background: hex(0x000000),
  surface: hex(0x131313),
  surfaceElevated: hex(0x1a1a1a),
  surfaceOverlay: hex(0x000000, 0.4),
  textPrimary: hex(0xe6e6e6),
  textSecondary: hex(0xb3b3b3),
  textTertiary: hex(0x999999),
  textInverse: hex(0x0a0a0a),
  textLink: hex(0x5a93ff),
  border: hex('#ffffff3d'),
  borderSecondary: hex('#ffffff1f'),
  borderHover: hex(0x525252),
  borderFocus: hex(0xffffff),
  borderError: hex(0xff7a5e),
  inputBg: hex(0x0a0a0a),
  inputBgHover: hex(0x262626),
  inputBgFocus: hex(0x0a0a0a),
  inputBgDisabled: hex(0x1a1a1a),
  selection: hex(0x2e2e2e),
  selectionText: hex(0xe6e6e6),
  accent: hex(0x5a93ff),
  accentSubtle: hex(0x11212c),
  tooltipBg: hex(0x1a1a1a),
  tooltipText: hex(0xe6e6e6),
};

const ink = (alpha: string) => hex(`#000000${alpha}`);
const shadow = (y: number, blur: number, spread: number, alpha: string): ShadowLayer => ({
  x: 0,
  y,
  blur,
  spread,
  color: ink(alpha),
});

/** Soft stacked shadows in light; dark separates by border and has none. */
const lightShadows: ShadowTokens = Object.freeze({
  sm: [shadow(1, 1, 0, '0a'), shadow(2, 1, -1, '0a'), shadow(1, 3, 0, '0a')],
  default: [shadow(1, 1, 0, '0a'), shadow(2, 1, -1, '0a'), shadow(1, 3, 0, '0a')],
  md: [shadow(1, 1, 0, '0a'), shadow(1, 3, -1, '0a'), shadow(4, 8, -2, '0a')],
  lg: [
    shadow(1, 1, 0, '0a'),
    shadow(2, 6, -1, '0a'),
    shadow(6, 12, -3, '0a'),
    shadow(8, 16, -4, '0a'),
  ],
  xl: [
    shadow(1, 1, 0, '0a'),
    shadow(2, 4, -1, '0a'),
    shadow(4, 8, -2, '0a'),
    shadow(12, 32, -6, '1f'),
    shadow(20, 48, -10, '0a'),
  ],
  '2xl': [
    shadow(10, 32, 0, '3d'),
    shadow(1, 1, 0, '0a'),
    shadow(4, 6, 0, '14'),
    shadow(1, 1, 0, '14'),
    shadow(24, 68, 0, '29'),
  ],
  inner: [{ ...shadow(1, 2, 0, '14'), inset: true }],
  none: [],
});
const darkShadows: ShadowTokens = Object.freeze({
  sm: [],
  default: [],
  md: [],
  lg: [],
  xl: [],
  '2xl': [],
  inner: [],
  none: [],
});

const shared = {
  typography: typographyScale({
    fonts: {
      sans: 'Inter, system-ui, sans-serif',
      mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    },
    sizes: {
      xs: 13,
      sm: 14,
      base: 16,
      lg: 18,
      xl: 21,
      '2xl': 24,
      '3xl': 34,
      '4xl': 42,
      '5xl': 48,
    },
  }),
  spacing: spacingScale(4),
  // `default` sits at the smoothing threshold, so unmarked surfaces are squircles;
  // `md` and below stay circular, which keeps controls to Base UI's 6px.
  radii: radiusScale({ sm: 4, md: 6, default: 12, lg: 14, xl: 18, '2xl': 24, '3xl': 32 }),
  shape: shapeTokens(0.4, 3.3, 12),
  animations: animationScale(),
};

export const baseUiTheme: ThemeBundle = Object.freeze({
  name: 'Blinc Base UI',
  light: defineTheme({
    name: 'Blinc Base UI',
    scheme: 'light',
    colors: light,
    shadows: lightShadows,
    ...shared,
  }),
  dark: defineTheme({
    name: 'Blinc Base UI',
    scheme: 'dark',
    colors: dark,
    shadows: darkShadows,
    ...shared,
  }),
});
