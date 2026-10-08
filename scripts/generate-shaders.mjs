import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { compileProbeShader } from '../.shader-build/probe.mjs';
import { compileMotionShader } from '../.shader-build/motion.mjs';
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
]) {
  await changed(
    new URL(name + '.ts', generated),
    '// Generated from shaders/' +
      name +
      '.ts. Do not edit.\nexport const ' +
      name +
      'Shader = ' +
      JSON.stringify(shader, null, 2) +
      ' as const;\n',
  );
  await changed(new URL(name + '.wgsl', generated), shader.code);
}
console.log('Generated TypeGPU WGSL and shader entry-point metadata.');
