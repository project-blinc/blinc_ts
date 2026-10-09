import type { Scope } from '../hmr.js';
import type { Layout, StyleSheet } from '../native/layout.js';
import type { Computed, Disposable, ReactiveContext, Signal } from '../native/reactive.js';
import type { Color } from './color.js';
import type { ShapeTokens } from './shape.js';
import {
  extendTheme,
  themeFor,
  themeVariables,
  type ColorScheme,
  type Theme,
  type ThemeBundle,
  type ThemePatch,
} from './theme.js';
import type { ColorToken, RadiusToken, SpacingToken } from './tokens.js';

/** A scheme, or `system` to follow the system's light or dark mode. */
export type SchemePreference = ColorScheme | 'system';

/**
 * Where the system's light or dark mode comes from: a native window host,
 * whose `ThemeChanged` events report changes as they happen.
 */
export interface SchemeSource {
  readonly window: { theme(): number };
  onEvent(listener: (event: { readonly kind: string }) => void, scope?: Scope): () => void;
}

export interface ThemeStateOptions {
  /** `system` by default. */
  readonly scheme?: SchemePreference;
  /** The system's scheme until a source reports one; light by default. */
  readonly system?: ColorScheme;
  readonly scope?: Scope;
}

/**
 * The theme in use: its bundle, the scheme, and overrides of single tokens,
 * held in signals of a reactive context. `theme` and `variables` are
 * computeds over them, so effects that read a token run again when it
 * changes. `attach` keeps a layout's CSS variables, colour scheme and corner
 * smoothing equal to the theme, so the native cascade restyles in place.
 */
export class ThemeState implements Disposable {
  readonly #context: ReactiveContext;
  readonly #bundle: Signal<ThemeBundle>;
  readonly #preference: Signal<SchemePreference>;
  readonly #system: Signal<ColorScheme>;
  readonly #overrides: Signal<ThemePatch>;
  readonly #owned: Disposable[] = [];
  /** The scheme in use: the preference, or the system's when it is `system`. */
  readonly scheme: Computed<ColorScheme>;
  /** The scheme's theme with the overrides applied. */
  readonly theme: Computed<Theme>;
  /** `theme` as CSS custom properties, as `themeVariables` gives them. */
  readonly variables: Computed<Readonly<Record<string, string>>>;

  constructor(context: ReactiveContext, bundle: ThemeBundle, options: ThemeStateOptions = {}) {
    const own = <T extends Disposable>(value: T): T => {
      this.#owned.push(value);
      return value;
    };
    this.#context = context;
    this.#bundle = own(context.signal(bundle));
    this.#preference = own(context.signal<SchemePreference>(options.scheme ?? 'system'));
    this.#system = own(context.signal<ColorScheme>(options.system ?? 'light'));
    this.#overrides = own(context.signal<ThemePatch>({}));
    this.scheme = own(
      context.computed(() => {
        const preference = this.#preference.get();
        return preference === 'system' ? this.#system.get() : preference;
      }),
    );
    this.theme = own(
      context.computed(() => {
        const theme = themeFor(this.#bundle.get(), this.scheme.get());
        const overrides = this.#overrides.get();
        return Object.keys(overrides).length === 0 ? theme : extendTheme(theme, overrides);
      }),
    );
    this.variables = own(context.computed(() => themeVariables(this.theme.get())));
    options.scope?.onCleanup(() => this.dispose());
  }

  /** The installed bundle. */
  get bundle(): ThemeBundle {
    return this.#bundle.get();
  }
  /** The scheme preference: light, dark or system. */
  get preference(): SchemePreference {
    return this.#preference.get();
  }

  /** Install `bundle`, keeping the scheme. Clears every override. */
  setBundle(bundle: ThemeBundle): void {
    this.#context.batch(() => {
      this.#overrides.set({});
      this.#bundle.set(bundle);
    });
  }
  /** Use `scheme`, or follow the system with `system`. */
  setScheme(scheme: SchemePreference): void {
    this.#preference.set(scheme);
  }
  /** Switch to the other scheme from the one in use. */
  toggleScheme(): void {
    this.#preference.set(this.scheme.get() === 'dark' ? 'light' : 'dark');
  }
  /** What the system's scheme is now; `followSystem` sets it from a window. */
  setSystemScheme(scheme: ColorScheme): void {
    this.#system.set(scheme);
  }

  /**
   * Give single tokens values over the bundle's, in both schemes, until they
   * are cleared or a bundle is installed. Later overrides merge over earlier.
   */
  override(patch: ThemePatch): void {
    this.#overrides.set(mergePatch(this.#overrides.peek(), patch));
  }
  /** Drop every override, so each token is the bundle's again. */
  clearOverrides(): void {
    this.#overrides.set({});
  }

  /** A colour token's value. Read in an effect or computed, it follows the theme. */
  color(token: ColorToken): Color {
    return this.theme.get().colors[token];
  }
  /** A spacing step in pixels. */
  spacing(token: SpacingToken): number {
    return this.theme.get().spacing[token];
  }
  /** A radius in pixels. */
  radius(token: RadiusToken): number {
    return this.theme.get().radii[token];
  }
  /** The corner smoothing. */
  shape(): ShapeTokens {
    return this.theme.get().shape;
  }

  /**
   * Keep `layout` styled by the theme: its CSS variables, the colour scheme
   * `prefers-color-scheme` reads, and the corner smoothing paint uses, and
   * the bundle's stylesheets, swapped when the bundle changes. Ends when the
   * handle is disposed, `scope` ends, or this state is disposed.
   */
  attach(layout: Layout, scope?: Scope): Disposable {
    const styling = this.#context.effect(() => {
      const theme = this.theme.get();
      layout.setTheme(this.variables.get());
      layout.setColorScheme(this.scheme.get());
      layout.setShape(theme.shape, theme.radii.full);
    });
    let sheets: StyleSheet[] = [];
    const removeSheets = () => {
      if (!layout.disposed) {
        for (const sheet of sheets) {
          layout.removeStyleSheet(sheet);
        }
      }
      sheets = [];
    };
    const css = this.#context.effect(() => {
      const bundle = this.#bundle.get();
      removeSheets();
      sheets = (bundle.css ?? []).map((source) => {
        const sheet = layout.addStyleSheet(source, { file: `${bundle.name}.css` });
        for (const d of sheet.diagnostics) {
          if (d.severity === 'error') {
            console.warn(`${bundle.name}.css:${d.line}:${d.column}: ${d.message}`);
          }
        }
        return sheet;
      });
    });
    let disposed = false;
    const handle: Disposable = {
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        styling.dispose();
        css.dispose();
        removeSheets();
        if (!layout.disposed) {
          layout.setShape(null);
        }
      },
    };
    this.#owned.push(handle);
    scope?.onCleanup(() => handle.dispose());
    return handle;
  }

  /**
   * Take the system's scheme from `source`, a window host, now and on each
   * change it reports. Only a `system` preference uses it.
   */
  followSystem(source: SchemeSource, scope?: Scope): () => void {
    const read = (theme: number) => this.setSystemScheme(theme === 1 ? 'dark' : 'light');
    read(source.window.theme());
    const off = source.onEvent((event) => {
      if (event.kind === 'ThemeChanged' && 'theme' in event) {
        read(Number(event.theme));
      }
    }, scope);
    this.#owned.push({ dispose: off });
    return off;
  }

  dispose(): void {
    const owned = this.#owned.splice(0).reverse();
    if (this.#context.disposed) {
      return;
    }
    for (const value of owned) {
      value.dispose();
    }
  }
}

/** `b` merged over `a`, family by family. */
function mergePatch(a: ThemePatch, b: ThemePatch): ThemePatch {
  const merged: Record<string, unknown> = { ...a };
  for (const [key, value] of Object.entries(b)) {
    const before = (a as Record<string, unknown>)[key];
    if (key === 'typography' || key === 'animations') {
      const groups: Record<string, unknown> = { ...(before as object) };
      for (const [group, tokens] of Object.entries(value as object)) {
        groups[group] = { ...(groups[group] as object), ...(tokens as object) };
      }
      merged[key] = groups;
    } else if (typeof value === 'object' && value !== null) {
      merged[key] = { ...(before as object), ...value };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}
