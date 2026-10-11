import { defineConfig } from 'vite';
import { blinc, blincCss } from 'blinc_ts/vite';

export default defineConfig({
  plugins: [blinc(), blincCss({ declarations: false })],
  environments: {
    blinc: {
      build: { outDir: 'out/vite', rollupOptions: { input: 'src/app.ts' } },
    },
  },
  builder: {
    buildApp: (builder) => builder.build(builder.environments.blinc),
  },
});
