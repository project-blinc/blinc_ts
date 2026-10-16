import { fields } from '../../src/renderer/records.js';
import { tgpu, d, std } from 'typegpu';
import { field, scene, textures } from '../../src/renderer/gpu/shared.js';

/** The blurred rows a compute pass writes. */
export const rowsOut = tgpu
  .bindGroupLayout({
    rows: { storageTexture: d.textureStorage2d('rgba8unorm', 'write-only') },
  })
  .$idx(2);

/**
 * A backdrop's rows, blurred across: a texel is the Gaussian-weighted sum of what is behind it
 * along its row, read as pairs of texels a filtered read apart. In a compute pass, which a tiled
 * GPU runs without the binning a render pass needs. The viewport's `frame` holds the first texel
 * it writes and how many across and down, `offsets.zw` where that is read from, and `steps.x`
 * how many pixels a texel spans; `steps.z` is the backdrop's record.
 */
const main = tgpu
  .computeFn({ in: { gid: d.builtin.globalInvocationId }, workgroupSize: [8, 8] })((input) => {
    const region = scene.$.viewport.frame;
    if (d.f32(input.gid.x) >= region.z || d.f32(input.gid.y) >= region.w) {
      return;
    }
    const texel = d.vec2f(d.f32(input.gid.x) + region.x, d.f32(input.gid.y) + region.y);
    const position = std.add(texel, d.vec2f(0.5, 0.5));
    const record = d.u32(scene.$.viewport.steps.z);
    const size = d.vec2f(std.textureDimensions(textures.$.layer));
    const at = std.add(std.mul(position, scene.$.viewport.steps.x), scene.$.viewport.offsets.zw);
    const sigma = std.max(field(record, fields.color).x, 0.0001);
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
            std.div(d.vec2f(at.x + i + w1 / std.max(w, 1e-30), at.y), size),
            0,
          ),
          w,
        ),
      );
      weights += w;
      i += 2;
    }
    std.textureStore(rowsOut.$.rows, d.vec2u(texel), std.div(sum, weights));
  })
  .$name('backdropRowsCompute');

export function compileBackdropRowsComputeShader() {
  const code = tgpu.resolve([main]);
  const computeEntryPoint = /@compute\s+@workgroup_size\([^)]*\)\s+fn\s+(\w+)/.exec(code)?.[1];
  if (!computeEntryPoint) {
    throw new Error('Missing backdropRowsCompute shader entry');
  }
  return { code, computeEntryPoint };
}
