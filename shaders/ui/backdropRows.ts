import { fields } from '../../src/renderer/records.js';
import { tgpu, d, std } from 'typegpu';
import { inputs, field, scene, textures } from './shared.js';
import { quadCorner, placed, pixelToClip } from './sdf.js';

const vertex = tgpu
  .vertexFn({
    in: { vertexIndex: d.builtin.vertexIndex, instanceIndex: d.builtin.instanceIndex },
    out: inputs,
  })((input) => {
    const b = field(input.instanceIndex, fields.bounds);
    const m = field(input.instanceIndex, fields.affine);
    const c0 = placed(b.xy, m, d.vec2f(0, 0));
    const c1 = placed(b.xy, m, d.vec2f(b.z, 0));
    const c2 = placed(b.xy, m, d.vec2f(0, b.w));
    const c3 = placed(b.xy, m, b.zw);
    const lo = std.sub(
      std.min(std.min(c0, c1), std.min(c2, c3)),
      d.vec2f(
        field(input.instanceIndex, fields.color).y,
        field(input.instanceIndex, fields.color).y,
      ),
    );
    const hi = std.add(
      std.max(std.max(c0, c1), std.max(c2, c3)),
      d.vec2f(
        field(input.instanceIndex, fields.color).y,
        field(input.instanceIndex, fields.color).y,
      ),
    );
    const position = pixelToClip(
      std.mix(lo, hi, quadCorner(d.i32(input.vertexIndex))),
      scene.$.viewport.xy,
    );
    const packedPlace = d.vec4f(0);
    return { position, place: packedPlace, record: input.instanceIndex };
  })
  .$name('backdropRowsVertex');
const fragment = tgpu
  .fragmentFn({ in: inputs, out: d.vec4f })((input) => {
    const size = d.vec2f(std.textureDimensions(textures.$.layer));
    const sigma = std.max(field(input.record, fields.color).x, 0.0001);
    const reach = std.ceil(sigma * 3);
    let sum = d.vec4f(0, 0, 0, 0);
    let weights = d.f32(0);
    let i = -reach;
    while (i <= reach) {
      const w0 = std.exp((-i * i) / (2 * sigma * sigma));
      const w1 = std.exp((-(i + 1) * (i + 1)) / (2 * sigma * sigma));
      const w = w0 + w1;
      sum = std.add(
        sum,
        std.mul(
          std.textureSampleLevel(
            textures.$.layer,
            textures.$.linearSampler,
            std.div(d.vec2f(input.position.x + i + w1 / std.max(w, 1e-30), input.position.y), size),
            0,
          ),
          w,
        ),
      );
      weights += w;
      i += 2;
    }
    return std.div(sum, weights);
  })
  .$name('backdropRowsFragment');
export function compileBackdropRowsShader() {
  const code = tgpu.resolve([vertex, fragment]);
  const vertexEntryPoint = /@vertex\s+fn\s+(\w+)/.exec(code)?.[1];
  const fragmentEntryPoint = /@fragment\s+fn\s+(\w+)/.exec(code)?.[1];
  if (!vertexEntryPoint || !fragmentEntryPoint) {
    throw new Error('Missing backdropRows shader entries');
  }
  return { code, vertexEntryPoint, fragmentEntryPoint, vertexCount: 6, alphaBlend: false };
}
