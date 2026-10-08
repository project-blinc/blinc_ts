import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'vite';
import typegpu from 'unplugin-typegpu/vite';

test('public canvas helpers retain TypeGPU metadata for consumer shaders', async () => {
  const fixtures = new URL('../.test-fixtures/', import.meta.url);
  await mkdir(fixtures, { recursive: true });
  const directory = await mkdtemp(fileURLToPath(new URL('canvas-shader-', fixtures)));
  try {
    const entry = directory + '/shader.ts';
    await writeFile(
      entry,
      `
import { tgpu, d } from 'typegpu';
import { canvasVertex, canvasVaryings, canvasClip } from 'blinc_ts/shaders/canvas';
const fragment = tgpu.fragmentFn({ in: canvasVaryings, out: d.vec4f })((input) => {
  return d.vec4f(input.uv.x, input.uv.y, 0.8, canvasClip(input.record, input.pixel));
});
export const code = tgpu.resolve([canvasVertex, fragment]);
`,
    );
    await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [typegpu()],
      build: {
        target: 'node22',
        outDir: directory + '/dist',
        lib: { entry, formats: ['es'], fileName: () => 'shader.mjs' },
        rollupOptions: { external: ['typegpu', 'blinc_ts/shaders/canvas'] },
      },
    });
    const { code } = await import(pathToFileURL(directory + '/dist/shader.mjs').href);
    assert.match(code, /@vertex/);
    assert.match(code, /@fragment/);
    assert.match(code, /fn canvasClip/);
    assert.match(code, /fn shapeCoverage/);
    assert.match(code, /fn localClipCoverage/);
    assert.match(code, /fn fadeCoverage/);
    assert.match(code, /@group\(0\)/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
