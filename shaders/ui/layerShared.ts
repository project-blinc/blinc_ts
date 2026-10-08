import { tgpu, d, std } from 'typegpu';
import { fields } from '../../src/renderer/records.js';
import { inputs, field, scene, textures } from './shared.js';
import { quadCorner, placed, pixelToClip } from './sdf.js';

// The ABI has already expanded these bounds for blur and drop-shadow reach.
export const layerVertex = tgpu
  .vertexFn({
    in: { vertexIndex: d.builtin.vertexIndex, instanceIndex: d.builtin.instanceIndex },
    out: inputs,
  })((input) => {
    const b = field(input.instanceIndex, fields.bounds);
    const pixel = placed(
      b.xy,
      field(input.instanceIndex, fields.affine),
      std.mul(quadCorner(d.i32(input.vertexIndex)), b.zw),
    );
    return {
      position: pixelToClip(pixel, scene.$.viewport.xy),
      place: d.vec4f(0),
      record: input.instanceIndex,
    };
  })
  .$name('layerVertex');

/** Paired Gaussian taps on premultiplied pixels; direction selects rows or columns. */
export const gaussian = tgpu
  .fn(
    [d.texture2d(), d.vec2f, d.vec2f, d.f32],
    d.vec4f,
  )((texture, pixel, direction, deviation) => {
    const size = d.vec2f(std.textureDimensions(texture));
    const sigma = std.max(deviation, 0.0001);
    const reach = std.ceil(sigma * 3);
    let sum = d.vec4f(0);
    let weights = d.f32(0);
    let i = -reach;
    while (i <= reach) {
      const w0 = std.exp((-i * i) / (2 * sigma * sigma));
      const w1 = std.exp((-(i + 1) * (i + 1)) / (2 * sigma * sigma));
      const w = w0 + w1;
      const uv = std.div(std.add(pixel, std.mul(direction, i + w1 / std.max(w, 1e-30))), size);
      sum = std.add(
        sum,
        std.mul(std.textureSampleLevel(texture, textures.$.linearSampler, uv, 0), w),
      );
      weights += w;
      i += 2;
    }
    return std.div(sum, weights);
  })
  .$name('layerGaussian');
