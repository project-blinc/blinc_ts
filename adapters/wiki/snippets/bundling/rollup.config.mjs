import typescript from '@rollup/plugin-typescript';
import { blincCss } from 'blinc_ts/vite';

export default {
  input: 'src/app.ts',
  output: { file: 'out/rollup/app.js', format: 'es' },
  external: (id) => id === 'blinc_ts' || id.startsWith('blinc_ts/') || id.startsWith('node:'),
  plugins: [
    blincCss({ declarations: false }),
    typescript({ outDir: 'out/rollup', noEmitOnError: true }),
  ],
};
