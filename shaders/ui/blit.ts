import { tgpu, d, std } from 'typegpu';
import { textures } from './shared.js';
const vertex = tgpu
  .vertexFn({
    in: { vertexIndex: d.builtin.vertexIndex },
    out: { position: d.builtin.position },
  })((input) => {
    const x = d.f32((input.vertexIndex << 1) & 2);
    const y = d.f32(input.vertexIndex & 2);
    return { position: d.vec4f(x * 2 - 1, 1 - y * 2, 0, 1) };
  })
  .$name('blitVertex');
const fragment = tgpu
  .fragmentFn({
    in: { position: d.builtin.position },
    out: d.vec4f,
  })((input) => std.textureLoad(textures.$.layer, d.vec2i(input.position.xy), 0))
  .$name('blitFragment');
export function compileBlitShader() {
  const code = tgpu.resolve([vertex, fragment]);
  const vertexEntryPoint = /@vertex\s+fn\s+(\w+)/.exec(code)?.[1];
  const fragmentEntryPoint = /@fragment\s+fn\s+(\w+)/.exec(code)?.[1];
  if (!vertexEntryPoint || !fragmentEntryPoint) {
    throw new Error('Missing blit shader entries');
  }
  return { code, vertexEntryPoint, fragmentEntryPoint, vertexCount: 3 };
}
