import { fields } from '../../src/renderer/records.js';
import { tgpu, d, std } from 'typegpu';
import { inputs, field, shapeCoverage, scene } from '../../src/renderer/gpu/shared.js';
import {
  quadCorner,
  placed,
  pixelToClip,
  sdShapedRect,
  boxDistance,
  isNotch,
  sdNotch,
  erf,
  clipCoverage,
  fadeCoverage,
} from '../../src/renderer/gpu/sdf.js';

const vertex = tgpu
  .vertexFn({
    in: { vertexIndex: d.builtin.vertexIndex, instanceIndex: d.builtin.instanceIndex },
    out: inputs,
  })((input) => {
    const s = field(input.instanceIndex, fields.shadow);
    // Room for the blur, the offset and a positive spread, plus a pixel of antialiasing.
    const grow = s.z * 3 + std.abs(s.x) + std.abs(s.y) + std.max(s.w, 0) + 1;
    const b = field(input.instanceIndex, fields.bounds);
    const local = std.sub(
      std.mul(quadCorner(d.i32(input.vertexIndex)), std.add(b.zw, std.mul(d.vec2f(grow, grow), 2))),
      d.vec2f(grow, grow),
    );
    const pixel = placed(b.xy, field(input.instanceIndex, fields.affine), local);
    const position = pixelToClip(pixel, scene.$.viewport.xy);
    const packedPlace = d.vec4f(local, pixel);
    return { position, place: packedPlace, record: input.instanceIndex };
  })
  .$name('shadowVertex');
const fragment = tgpu
  .fragmentFn({ in: inputs, out: d.vec4f })((input) => {
    const local = input.place.xy;
    const pixel = input.place.zw;
    const clip =
      clipCoverage(
        pixel,
        field(input.record, fields.clipBounds),
        field(input.record, fields.clipRadius),
        field(input.record, fields.typeInfo).z,
        field(input.record, fields.typeInfo).w,
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
    const p = local;
    const origin = d.vec2f(0, 0);
    const size = field(input.record, fields.bounds).zw;
    const s = field(input.record, fields.shadow);
    // eslint-disable-next-line no-useless-assignment -- The initializer establishes the WGSL storage type.
    let result = d.vec4f(0, 0, 0, 0);
    let where = std.smoothstep(
      -0.75,
      0.75,
      boxDistance(
        p,
        size,
        field(input.record, fields.cornerRadius),
        field(input.record, fields.cornerShape),
        field(input.record, fields.notchCorners),
        field(input.record, fields.notchTop),
        field(input.record, fields.notchBottom),
      ),
    );
    const notched = isNotch(
      field(input.record, fields.notchCorners),
      field(input.record, fields.notchTop),
      field(input.record, fields.notchBottom),
    );
    if (field(input.record, fields.typeInfo).y > 0.5) {
      const spread = d.vec2f(s.w, s.w);
      // eslint-disable-next-line no-useless-assignment -- The initializer establishes the WGSL storage type.
      let inner = d.f32(0);
      if (notched) {
        inner =
          sdNotch(
            std.sub(p, s.xy),
            size,
            field(input.record, fields.notchCorners),
            field(input.record, fields.notchTop),
            field(input.record, fields.notchBottom),
          ) + s.w;
      } else {
        inner = sdShapedRect(
          p,
          std.add(std.add(origin, s.xy), spread),
          std.max(std.sub(size, std.mul(spread, 2)), d.vec2f(0, 0)),
          std.max(
            std.sub(field(input.record, fields.cornerRadius), d.vec4f(s.w, s.w, s.w, s.w)),
            d.vec4f(0, 0, 0, 0),
          ),
          field(input.record, fields.cornerShape),
        );
      }
      // eslint-disable-next-line no-useless-assignment -- The initializer establishes the WGSL storage type.
      let shade = d.f32(0);
      // No blur: a hard edge, antialiased over a pixel.
      if (s.z < 0.001) {
        shade = std.clamp(0.5 + inner, 0, 1);
      } else {
        shade = 0.5 * (1 + erf(inner / (0.5 * std.sqrt(2) * s.z)));
      }
      result = std.mul(field(input.record, fields.shadowColor), shade);
      where = 1 - where;
    } else {
      const spread = d.vec2f(s.w, s.w);
      // eslint-disable-next-line no-useless-assignment -- The initializer establishes the WGSL storage type.
      let distance = d.f32(0);
      if (notched) {
        distance =
          sdNotch(
            std.sub(p, s.xy),
            size,
            field(input.record, fields.notchCorners),
            field(input.record, fields.notchTop),
            field(input.record, fields.notchBottom),
          ) - s.w;
      } else {
        // CSS's spread radius: a corner grows by the spread as far as it is
        // already round, so a square corner stays square.
        const r = field(input.record, fields.cornerRadius);
        let grown = std.max(std.add(r, d.vec4f(s.w, s.w, s.w, s.w)), d.vec4f(0, 0, 0, 0));
        if (s.w > 0) {
          const u = std.sub(std.min(std.div(r, s.w), d.vec4f(1, 1, 1, 1)), d.vec4f(1, 1, 1, 1));
          grown = std.add(r, std.mul(std.add(d.vec4f(1, 1, 1, 1), std.mul(std.mul(u, u), u)), s.w));
        }
        distance = sdShapedRect(
          p,
          std.sub(std.add(origin, s.xy), spread),
          std.add(size, std.mul(spread, 2)),
          grown,
          field(input.record, fields.cornerShape),
        );
      }
      // eslint-disable-next-line no-useless-assignment -- The initializer establishes the WGSL storage type.
      let alpha = d.f32(0);
      if (s.z < 0.001) {
        alpha = std.clamp(0.5 - distance, 0, 1);
      } else {
        alpha = 0.5 * (1 + erf(-distance / (0.5 * std.sqrt(2) * s.z)));
      }
      result = std.mul(field(input.record, fields.shadowColor), alpha);
    }
    return d.vec4f(result.rgb, result.a * where * clip);
  })
  .$name('shadowFragment');
export function compileShadowShader() {
  const code = tgpu.resolve([vertex, fragment]);
  const vertexEntryPoint = /@vertex\s+fn\s+(\w+)/.exec(code)?.[1];
  const fragmentEntryPoint = /@fragment\s+fn\s+(\w+)/.exec(code)?.[1];
  if (!vertexEntryPoint || !fragmentEntryPoint) {
    throw new Error('Missing shadow shader entries');
  }
  return { code, vertexEntryPoint, fragmentEntryPoint, vertexCount: 6, alphaBlend: true };
}
