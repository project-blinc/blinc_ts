import { defineConfig } from 'rolldown';
import { blincCss } from 'blinc_ts/vite';

export default defineConfig({
  input: 'src/app.ts',
  platform: 'node',
  output: { file: 'out/rolldown/app.js', format: 'esm' },
  external: [/^blinc_ts(\/|$)/],
  plugins: [blincCss({ declarations: false })],
});
