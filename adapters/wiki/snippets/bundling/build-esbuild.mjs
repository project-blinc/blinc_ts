import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { compileCss } from 'blinc_ts/native';

const blincCss = {
  name: 'blinc-css',
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async ({ path }) => {
      const compiled = compileCss(await readFile(path, 'utf8'), { file: path });
      const errors = compiled.diagnostics.filter((d) => d.severity === 'error');
      if (errors.length > 0) {
        return {
          errors: errors.map((d) => ({
            text: d.message,
            location: { file: path, line: d.line, column: d.column - 1 },
          })),
        };
      }
      const base64 = Buffer.from(compiled.bytes).toString('base64');
      return {
        loader: 'js',
        contents: [
          `export default Uint8Array.from(Buffer.from(${JSON.stringify(base64)}, 'base64'));`,
          `export const classes = Object.freeze(${JSON.stringify(Object.fromEntries(compiled.classes.map((n) => [n, n])))});`,
        ].join('\n'),
      };
    });
  },
};
await build({
  entryPoints: ['src/app.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'out/esbuild/app.js',
  external: ['blinc_ts', 'blinc_ts/*'],
  plugins: [blincCss],
});
