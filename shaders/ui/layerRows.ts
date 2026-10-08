import { tgpu, d } from 'typegpu';
import { fields } from '../../src/renderer/records.js';
import { inputs, field, textures } from '../../src/renderer/gpu/shared.js';
import { layerVertex, gaussian } from './layerShared.js';

const fragment = tgpu
  .fragmentFn({ in: inputs, out: d.vec4f })((input) =>
    gaussian(
      textures.$.layer,
      input.position.xy,
      d.vec2f(1, 0),
      field(input.record, fields.color).x,
    ),
  )
  .$name('layerRowsFragment');

export function compileLayerRowsShader() {
  const code = tgpu.resolve([layerVertex, fragment]);
  const vertexEntryPoint = /@vertex\s+fn\s+(\w+)/.exec(code)?.[1];
  const fragmentEntryPoint = /@fragment\s+fn\s+(\w+)/.exec(code)?.[1];
  if (!vertexEntryPoint || !fragmentEntryPoint) {
    throw new Error('Missing layerRows shader entries');
  }
  return { code, vertexEntryPoint, fragmentEntryPoint, vertexCount: 6, alphaBlend: false };
}
