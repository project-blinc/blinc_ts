import { tgpu, d, std } from 'typegpu';
import { fields } from '../../src/renderer/records.js';
import { inputs, field, textures } from '../../src/renderer/gpu/shared.js';
import { layerVertex, gaussian } from './layerShared.js';

const fragment = tgpu
  .fragmentFn({ in: inputs, out: d.vec4f })((input) => {
    const sigma = field(input.record, fields.gradient).z;
    let alpha = std.textureLoad(textures.$.layer, d.vec2i(input.position.xy), 0).a;
    if (sigma > 0.25) {
      alpha = gaussian(textures.$.layer, input.position.xy, d.vec2f(1, 0), sigma).a;
    }
    return d.vec4f(0, 0, 0, alpha);
  })
  .$name('layerShadowFragment');

export function compileLayerShadowShader() {
  const code = tgpu.resolve([layerVertex, fragment]);
  const vertexEntryPoint = /@vertex\s+fn\s+(\w+)/.exec(code)?.[1];
  const fragmentEntryPoint = /@fragment\s+fn\s+(\w+)/.exec(code)?.[1];
  if (!vertexEntryPoint || !fragmentEntryPoint) {
    throw new Error('Missing layerShadow shader entries');
  }
  return { code, vertexEntryPoint, fragmentEntryPoint, vertexCount: 6, alphaBlend: false };
}
