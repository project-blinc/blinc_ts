import { createRunnableDevEnvironment } from 'vite';
import type { Plugin } from 'vite';

export interface BlincViteOptions {
  /** Environment that runs native app modules in the Node main thread. */
  environment?: string;
}

/**
 * Uses Vite's Module Runner and in-process HMR transport. App modules execute
 * in Node, where xgpu/xwindow addons share the main thread.
 */
export function blinc(options: BlincViteOptions = {}): Plugin {
  const environment = options.environment ?? 'blinc';
  if (environment === 'client' || environment === 'ssr') {
    throw new Error('Choose a dedicated Blinc environment name');
  }
  return {
    name: 'blinc_ts',
    config() {
      return {
        server: {
          watch: {
            ignored: [
              '**/.blinc/**',
              '**/.shader-build/**',
              '**/native/target/**',
              '**/native/*.node',
            ],
          },
        },
        environments: {
          [environment]: {
            consumer: 'server',
            resolve: { conditions: ['node'] },
            dev: {
              createEnvironment(name, config) {
                return createRunnableDevEnvironment(name, config);
              },
            },
            build: { ssr: true, target: 'node22', outDir: 'dist/native' },
          },
        },
      };
    },
  };
}

export interface BlincCssOptions {
  /** Which `.css` imports to compile; all of them by default. */
  include?: (file: string) => boolean;
  /** Write `<name>.d.css.ts` beside each sheet, for `allowArbitraryExtensions`. Default true. */
  declarations?: boolean;
  /** The addon to compile with; the package's own by default. */
  addon?: string | URL;
}

const VIRTUAL = '\0blinc-css:';

/**
 * Compiles `.css` imports at build time with the native CSS engine. The
 * module's default export is the compiled sheet, which
 * `Layout.addStyleSheet` loads without parsing; `classes`, `vars` and
 * `keyframes` are frozen objects of the names it defines. Errors fail the
 * build at their file, line and column; warnings are reported.
 */
export function blincCss(options: BlincCssOptions = {}): Plugin {
  return {
    name: 'blinc_ts:css',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.endsWith('.css') || !importer || importer.startsWith(VIRTUAL)) {
        return null;
      }
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      if (!resolved || resolved.external || !(options.include?.(resolved.id) ?? true)) {
        return null;
      }
      // A virtual id that does not end in .css, so the bundler's own CSS handling leaves it alone.
      return `${VIRTUAL}${resolved.id}.js`;
    },
    async load(id) {
      if (!id.startsWith(VIRTUAL)) {
        return null;
      }
      const file = id.slice(VIRTUAL.length, -'.js'.length);
      const fs = await import('node:fs');
      const path = await import('node:path');
      const readFileSync = (f: string) => fs.readFileSync(f, 'utf8');
      const { compileCss } = await import('./native/css.js');
      const source = readFileSync(file);
      this.addWatchFile(file);
      const load = (imported: string, from: string | null): [string, string] | null => {
        const target = path.resolve(path.dirname(from ?? file), imported);
        if (!fs.existsSync(target)) {
          return null;
        }
        this.addWatchFile(target);
        return [readFileSync(target), target];
      };
      const compiled = compileCss(source, {
        file,
        load,
        ...(options.addon ? { addon: options.addon } : {}),
      });
      for (const d of compiled.diagnostics) {
        const loc = { file: d.file ?? file, line: d.line, column: Math.max(d.column - 1, 0) };
        if (d.severity === 'error') {
          this.error({ message: d.message, id: d.file ?? file, loc });
        } else {
          this.warn({ message: d.message, id: d.file ?? file, loc });
        }
      }
      if (options.declarations ?? true) {
        const types = declarationsFor(compiled);
        const target = file.replace(/\.css$/, '.d.css.ts');
        if (!fs.existsSync(target) || readFileSync(target) !== types) {
          fs.writeFileSync(target, types);
        }
      }
      const names = (list: readonly string[], value: (name: string) => string) =>
        `Object.freeze({${list.map((n) => `${JSON.stringify(n)}: ${JSON.stringify(value(n))}`).join(', ')}})`;
      const base64 = Buffer.from(compiled.bytes).toString('base64');
      return [
        `const bytes = Uint8Array.from(globalThis.Buffer.from(${JSON.stringify(base64)}, 'base64'));`,
        'export default bytes;',
        `export const classes = ${names(compiled.classes, (n) => n)};`,
        `export const vars = ${names(compiled.variables, (n) => `--${n}`)};`,
        `export const keyframes = ${names(compiled.keyframes, (n) => n)};`,
      ].join('\n');
    },
  };
}

/** TypeScript declarations for a compiled sheet's module, its names as literal types. */
function declarationsFor(compiled: {
  classes: readonly string[];
  variables: readonly string[];
  keyframes: readonly string[];
}): string {
  const object = (list: readonly string[], value: (name: string) => string) =>
    list.length === 0
      ? '{}'
      : `{\n${list.map((n) => `  readonly ${JSON.stringify(n)}: ${JSON.stringify(value(n))};`).join('\n')}\n}`;
  return [
    '// Generated by blinc_ts from the stylesheet beside it; do not edit.',
    'declare const sheet: Uint8Array;',
    'export default sheet;',
    `export declare const classes: ${object(compiled.classes, (n) => n)};`,
    `export declare const vars: ${object(compiled.variables, (n) => `--${n}`)};`,
    `export declare const keyframes: ${object(compiled.keyframes, (n) => n)};`,
    '',
  ].join('\n');
}
