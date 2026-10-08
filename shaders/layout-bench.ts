import { tgpu, d } from 'typegpu';

// Benchmark geometry only: one vec4 per node, one batched draw, no UI effects.
const scene = tgpu
  .bindGroupLayout({
    viewport: { uniform: d.vec4f },
    bounds: { storage: d.arrayOf(d.vec4f), access: 'readonly' },
  })
  .$idx(0);
const vertex = tgpu
  .vertexFn({
    in: { vertexIndex: d.builtin.vertexIndex, instanceIndex: d.builtin.instanceIndex },
    out: { position: d.builtin.position, color: d.vec3f },
  })((input) => {
    const index = input.instanceIndex;
    const corner = input.vertexIndex;
    const x = d.f32(corner === 1 || corner === 4 || corner === 5);
    const y = d.f32(corner === 2 || corner === 3 || corner === 5);
    const box = scene.$.bounds[index]!;
    const px = box.x + x * box.z;
    const py = box.y + y * box.w;
    const shade = d.f32(index % 7) / 7;
    return {
      position: d.vec4f((px / scene.$.viewport.x) * 2 - 1, 1 - (py / scene.$.viewport.y) * 2, 0, 1),
      color: d.vec3f(0.18 + shade * 0.25, 0.38 + shade * 0.35, 0.65 + shade * 0.25),
    };
  })
  .$name('layoutBenchVertex');
const fragment = tgpu
  .fragmentFn({ in: { color: d.vec3f }, out: d.vec4f })((input) => d.vec4f(input.color, 1))
  .$name('layoutBenchFragment');
export function compileLayoutBenchShader() {
  const code = tgpu.resolve([vertex, fragment]);
  const vertexEntryPoint = /@vertex\s+fn\s+(\w+)/.exec(code)?.[1];
  const fragmentEntryPoint = /@fragment\s+fn\s+(\w+)/.exec(code)?.[1];
  if (!vertexEntryPoint || !fragmentEntryPoint) {
    throw new Error('Missing layout benchmark shader entries');
  }
  return { code, vertexEntryPoint, fragmentEntryPoint, vertexCount: 6 };
}
