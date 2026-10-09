/**
 * Compiling stylesheets ahead of time, with the same native engine that
 * loads them: what a build step runs to check a sheet and embed its bytes.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { CssDiagnostic } from './layout.js';

/** @internal */
export type CompileCss = (
  source: string,
  file: string | undefined,
  load:
    | ((request: [path: string, from: string | null]) => [text: string, file: string] | null)
    | undefined,
) => CompiledCss;

export interface CompiledCss {
  /** The compiled sheet, which `Layout.addStyleSheet` loads without parsing. */
  readonly bytes: Uint8Array;
  readonly diagnostics: readonly CssDiagnostic[];
  /** The class names its selectors use. */
  readonly classes: readonly string[];
  /** The custom properties its `:root` rules declare, without `--`. */
  readonly variables: readonly string[];
  readonly keyframes: readonly string[];
}

/**
 * Compile `source`. `load` resolves an `@import` (its path, and the file
 * importing it) to its text and file name; without it imports are not read.
 * Errors are diagnostics, not exceptions: the caller decides whether they fail.
 */
export function compileCss(
  source: string,
  options: {
    file?: string;
    load?: (path: string, from: string | null) => [text: string, file: string] | null;
    /** The addon to compile with; the package's own by default. */
    addon?: string | URL;
  } = {},
): CompiledCss {
  const path = options.addon ?? new URL('../../native/blinc_ts.node', import.meta.url);
  const addon = createRequire(import.meta.url)(
    path instanceof URL ? fileURLToPath(path) : path,
  ) as { compileCss: CompileCss };
  const load = options.load;
  return addon.compileCss(
    source,
    options.file,
    load && (([path, from]) => load(path, from ?? null)),
  );
}
