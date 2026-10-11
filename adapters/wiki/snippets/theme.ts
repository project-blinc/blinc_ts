/** A theme for an app: a variant of a bundle, kept on the layout and following the system. */
import type { NativeBindings } from 'blinc_ts/native';
import type { Host } from 'blinc_ts/native/host';
import type { NativeWindowHost } from 'blinc_ts/native/window';
import { ThemeState, extendBundle, hex, neutralTheme, shapeTokens } from 'blinc_ts/theme';

export function themeTheApp(
  native: NativeBindings,
  host: Host,
  window: NativeWindowHost,
): ThemeState {
  // A variant keeps every token it does not change, in both schemes.
  const bundle = extendBundle(neutralTheme, {
    name: 'My app',
    colors: { primary: hex('#2563eb') },
    radii: { default: 10, lg: 14 },
    shape: shapeTokens(0.4, 3.3, 12),
  });
  // It follows the system's scheme until told otherwise.
  const theme = new ThemeState(native.createReactive(), bundle);
  // The layout's variables, its colour scheme and its corner smoothing follow the theme.
  theme.attach(host.layout);
  // The window says whether the system is light or dark, and when that changes.
  theme.followSystem(window);
  theme.setScheme('dark'); // or 'light', or 'system' again
  theme.override({ colors: { accent: hex('#f59e0b') } }); // kept across scheme switches
  return theme;
}
