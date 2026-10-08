import { defineConfig } from 'vite';
import typegpu from 'unplugin-typegpu/vite';

export default defineConfig({
  plugins: [typegpu()],
  build: {
    target: 'node22',
    outDir: '.shader-build',
    lib: {
      entry: {
        probe: 'shaders/probe.ts',
        motion: 'shaders/motion.ts',
        'layout-bench': 'shaders/layout-bench.ts',
        'scene-probe': 'shaders/scene-probe.ts',
      },
      formats: ['es'],
      fileName: (_format, name) => name + '.mjs',
    },
    rollupOptions: { external: ['typegpu'] },
  },
});
