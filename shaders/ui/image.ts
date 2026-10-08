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
  .$name('imageVertex');
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
    let at = std.mix(rect.xy, rect.zw, uv);
    if (field(input.record, fields.typeInfo).y > 1.5) {
      at = std.clamp(
        std.mix(rect.xy, rect.zw, std.fract(std.div(local, field(input.record, fields.color2).xy))),
        std.add(rect.xy, d.vec2f(0.5, 0.5)),
        std.sub(rect.zw, d.vec2f(0.5, 0.5)),
      );
    }
    const texel = std.textureSampleLevel(
      textures.$.images,
      textures.$.linearSampler,
      std.div(at, d.vec2f(std.textureDimensions(textures.$.images))),
      0,
    );
    let result = d.vec4f(
      field(input.record, fields.color).rgb,
      field(input.record, fields.color).a * texel.a,
    );
    if (field(input.record, fields.typeInfo).y > 0.5) {
      result = d.vec4f(texel.rgb, texel.a * field(input.record, fields.color2).a);
    }
    return d.vec4f(result.rgb, result.a * clip);
  })
  .$name('imageFragment');
export function compileImageShader() {
  const code = tgpu.resolve([vertex, fragment]);
  const vertexEntryPoint = /@vertex\s+fn\s+(\w+)/.exec(code)?.[1];
  const fragmentEntryPoint = /@fragment\s+fn\s+(\w+)/.exec(code)?.[1];
  if (!vertexEntryPoint || !fragmentEntryPoint) {
    throw new Error('Missing image shader entries');
  }
  return { code, vertexEntryPoint, fragmentEntryPoint, vertexCount: 6, alphaBlend: true };
}
