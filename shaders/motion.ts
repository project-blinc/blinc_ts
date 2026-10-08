import { tgpu, d, std } from 'typegpu';

const frame = tgpu.bindGroupLayout({ params: { uniform: d.vec4f } }).$idx(0);
const vertex = tgpu
  .vertexFn({
    in: { vertexIndex: d.builtin.vertexIndex },
    out: { position: d.builtin.position, uv: d.vec2f },
  })((input) => {
    const x = d.f32((input.vertexIndex << 1) & 2);
    const y = d.f32(input.vertexIndex & 2);
    return { position: d.vec4f(x * 2 - 1, 1 - y * 2, 0, 1), uv: d.vec2f(x, y) };
  })
  .$name('motionVertex');
const fragment = tgpu
  .fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })((input) => {
    const delta = std.sub(input.uv, d.vec2f(frame.$.params.x, frame.$.params.y));
    const distance = std.length(d.vec2f(delta.x * frame.$.params.z, delta.y));
    const edge = std.fwidth(distance);
    const fill = 1 - std.smoothstep(0.11 - edge, 0.11 + edge, distance);
    const color = std.mix(d.vec3f(0.04, 0.08, 0.12), d.vec3f(0.3, 0.7, 1), fill);
    return d.vec4f(color, 1);
  })
  .$name('motionFragment');

export function compileMotionShader() {
  const code = tgpu.resolve([vertex, fragment]);
  const vertexEntryPoint = /@vertex\s+fn\s+(\w+)/.exec(code)?.[1];
  const fragmentEntryPoint = /@fragment\s+fn\s+(\w+)/.exec(code)?.[1];
  if (!vertexEntryPoint || !fragmentEntryPoint) {
    throw new Error('Missing motion shader entries');
  }
  return {
    code,
    vertexEntryPoint,
    fragmentEntryPoint,
    vertexCount: 3,
    uniformBytes: 16,
    group: 0,
    binding: 0,
  };
}
