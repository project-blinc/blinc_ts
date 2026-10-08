import { tgpu, d } from 'typegpu';

/** Fullscreen triangle used to verify native surfaces and pipelines. */
const probeVertex = tgpu
  .vertexFn({
    in: { vertexIndex: d.builtin.vertexIndex },
    out: { position: d.builtin.position, uv: d.vec2f },
  })((input) => {
    const x = d.f32((input.vertexIndex << 1) & 2);
    const y = d.f32(input.vertexIndex & 2);
    return {
      position: d.vec4f(x * 2 - 1, 1 - y * 2, 0, 1),
      uv: d.vec2f(x, y),
    };
  })
  .$name('probeVertex');

const probeFragment = tgpu
  .fragmentFn({
    in: { uv: d.vec2f },
    out: d.vec4f,
  })((input) => d.vec4f(input.uv.x, input.uv.y, 0.5, 1))
  .$name('probeFragment');

export function compileProbeShader() {
  const code = tgpu.resolve([probeVertex, probeFragment]);
  const vertexEntryPoint = /@vertex\s+fn\s+(\w+)/.exec(code)?.[1];
  const fragmentEntryPoint = /@fragment\s+fn\s+(\w+)/.exec(code)?.[1];
  if (!vertexEntryPoint || !fragmentEntryPoint) {
    throw new Error('TypeGPU did not emit the expected shader entry points');
  }
  return { code, vertexEntryPoint, fragmentEntryPoint, vertexCount: 3 };
}
