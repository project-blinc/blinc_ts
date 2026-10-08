import { fields } from '../../src/renderer/records.js';
import { tgpu, d, std } from 'typegpu';
import { inputs, field, shapeCoverage, scene, textures } from './shared.js';
import {
  quadCorner,
  placed,
  pixelToClip,
  clipCoverage,
  localClipCoverage,
  fadeCoverage,
  halfPixel,
} from './sdf.js';

const vertex = tgpu
  .vertexFn({
    in: { vertexIndex: d.builtin.vertexIndex, instanceIndex: d.builtin.instanceIndex },
    out: inputs,
  })((input) => {
    const b = field(input.instanceIndex, fields.bounds);
    const uv = quadCorner(d.i32(input.vertexIndex));
    const pixel = placed(b.xy, field(input.instanceIndex, fields.affine), std.mul(uv, b.zw));
    const position = pixelToClip(pixel, scene.$.viewport.xy);
    const packedPlace = d.vec4f(uv, pixel);
    return { position, place: packedPlace, record: input.instanceIndex };
  })
  .$name('textVertex');
const fragment = tgpu
  .fragmentFn({ in: inputs, out: d.vec4f })((input) => {
    const uv = input.place.xy;
    const pixel = input.place.zw;
    const local = std.mul(uv, field(input.record, fields.bounds).zw);
    const aa = halfPixel(local);
    const clip =
      clipCoverage(
        pixel,
        field(input.record, fields.clipBounds),
        field(input.record, fields.clipRadius),
        field(input.record, fields.typeInfo).z,
        field(input.record, fields.typeInfo).w,
      ) *
      localClipCoverage(
        local,
        field(input.record, fields.shadow),
        field(input.record, fields.shadowColor),
        field(input.record, fields.typeInfo).z,
        field(input.record, fields.typeInfo).w,
        aa,
      ) *
      fadeCoverage(
        pixel,
        field(input.record, fields.fadeBounds),
        field(input.record, fields.fade),
      ) *
      shapeCoverage(input.record, pixel);
    if (clip < 0.001) {
      std.discard();
    }
    const rect = field(input.record, fields.gradient);
    // eslint-disable-next-line no-useless-assignment -- The initializer establishes the WGSL storage type.
    let result = d.vec4f(0, 0, 0, 0);
    if (field(input.record, fields.typeInfo).y > 0.5) {
      const size = d.vec2f(std.textureDimensions(textures.$.colorAtlas));
      result = std.textureSampleLevel(
        textures.$.colorAtlas,
        textures.$.linearSampler,
        std.div(std.mix(rect.xy, rect.zw, uv), size),
        0,
      );
      result.a *= field(input.record, fields.color).a;
    } else {
      const size = d.vec2f(std.textureDimensions(textures.$.atlas));
      const coverage = std.textureSampleLevel(
        textures.$.atlas,
        textures.$.linearSampler,
        std.div(std.mix(rect.xy, rect.zw, uv), size),
        0,
      ).r;
      result = d.vec4f(
        field(input.record, fields.color).rgb,
        field(input.record, fields.color).a * std.pow(coverage, 0.7),
      );
    }
    return d.vec4f(result.rgb, result.a * clip);
  })
  .$name('textFragment');
export function compileTextShader() {
  const code = tgpu.resolve([vertex, fragment]);
  const vertexEntryPoint = /@vertex\s+fn\s+(\w+)/.exec(code)?.[1];
  const fragmentEntryPoint = /@fragment\s+fn\s+(\w+)/.exec(code)?.[1];
  if (!vertexEntryPoint || !fragmentEntryPoint) {
    throw new Error('Missing text shader entries');
  }
  return { code, vertexEntryPoint, fragmentEntryPoint, vertexCount: 6, alphaBlend: true };
}
