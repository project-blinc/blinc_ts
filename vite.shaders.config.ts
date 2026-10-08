import { defineConfig } from 'vite';
import typegpu from 'unplugin-typegpu/vite';

export default defineConfig(({ mode }) => ({
  plugins: [typegpu()],
  build: {
    target: 'node22',
    outDir: mode === 'canvas-library' ? 'dist/shader-library' : '.shader-build',
    minify: mode !== 'canvas-library',
    lib: {
      entry:
        mode === 'canvas-library'
          ? { canvas: 'src/renderer/canvas.ts' }
          : {
              probe: 'shaders/probe.ts',
              box: 'shaders/ui/box.ts',
              layer: 'shaders/ui/layer.ts',
              layerRows: 'shaders/ui/layerRows.ts',
              layerShadow: 'shaders/ui/layerShadow.ts',
              blit: 'shaders/ui/blit.ts',
              shadow: 'shaders/ui/shadow.ts',
              text: 'shaders/ui/text.ts',
              image: 'shaders/ui/image.ts',
              backdrop: 'shaders/ui/backdrop.ts',
              backdropRows: 'shaders/ui/backdropRows.ts',

              motion: 'shaders/motion.ts',
              'layout-bench': 'shaders/layout-bench.ts',
              'scene-probe': 'shaders/scene-probe.ts',
              'canvas-probe': 'shaders/canvas-probe.ts',
            },
      formats: ['es'],
      fileName: (_format, name) => name + '.mjs',
    },
    rollupOptions: { external: ['typegpu'] },
  },
}));
