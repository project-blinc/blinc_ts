import { tgpu, d, std } from 'typegpu';
import { canvasVertex, canvasVaryings, canvasClip, field, fields } from '../src/renderer/canvas.js';
const extra = tgpu.bindGroupLayout({ tint: { uniform: d.vec4f } }).$idx(2);
const fragment = tgpu
  .fragmentFn({ in: canvasVaryings, out: d.vec4f })((input) => {
    const color = std.mul(
      field(input.record, fields.color).rgb,
      std.mul(extra.$.tint.rgb, std.mix(0.65, 1, input.uv.x)),
    );
    return d.vec4f(color, extra.$.tint.a * canvasClip(input.record, input.pixel));
  })
  .$name('canvasProbeFragment');
export function compileCanvasProbeShader() {
  const code = tgpu.resolve([canvasVertex, fragment]);
  const vertexEntryPoint = /@vertex\s+fn\s+(\w+)/.exec(code)?.[1];
  const fragmentEntryPoint = /@fragment\s+fn\s+(\w+)/.exec(code)?.[1];
  if (!vertexEntryPoint || !fragmentEntryPoint) {
    throw new Error('Missing canvas probe shader entries');
  }
  return { code, vertexEntryPoint, fragmentEntryPoint, vertexCount: 6, alphaBlend: true };
}
