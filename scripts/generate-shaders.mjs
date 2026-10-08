import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { compileProbeShader } from '../.shader-build/probe.mjs';
import { compileLayoutBenchShader } from '../.shader-build/layout-bench.mjs';
import { compileMotionShader } from '../.shader-build/motion.mjs';
import { compileSceneProbeShader } from '../.shader-build/scene-probe.mjs';
const generated = new URL('../src/renderer/generated/', import.meta.url);
await mkdir(generated, { recursive: true });
async function changed(path, content) {
  try {
    if ((await readFile(path, 'utf8')) === content) {
      return;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  await writeFile(path, content);
}
for (const [name, shader] of [
  ['probe', compileProbeShader()],
  ['motion', compileMotionShader()],
  ['layoutBench', compileLayoutBenchShader()],
  ['sceneProbe', compileSceneProbeShader()],
]) {
  await changed(
    new URL(name + '.ts', generated),
    '// Generated from shaders/' +
      (name === 'layoutBench' ? 'layout-bench' : name === 'sceneProbe' ? 'scene-probe' : name) +
      '.ts. Do not edit.\nexport const ' +
      name +
      'Shader = ' +
      JSON.stringify(shader, null, 2) +
      ' as const;\n',
  );
  await changed(new URL(name + '.wgsl', generated), shader.code);
}
console.log('Generated TypeGPU WGSL and shader entry-point metadata.');
