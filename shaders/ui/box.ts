import { fields } from '../../src/renderer/records.js';
import { tgpu, d, std } from 'typegpu';
import { inputs, field, shapeCoverage, scene } from './shared.js';
import {
  quadCorner,
  placed,
  pixelToClip,
  boxDistance,
  isNotch,
  clipCoverage,
  localClipCoverage,
  fadeCoverage,
  halfPixel,
} from './sdf.js';
import { fillAt, withBorder } from './fills.js';

const vertex = tgpu
  .vertexFn({
    in: { vertexIndex: d.builtin.vertexIndex, instanceIndex: d.builtin.instanceIndex },
    out: inputs,
  })((input) => {
    const b = field(input.instanceIndex, fields.bounds);
    const m = field(input.instanceIndex, fields.affine);
    const grow = std.div(
      d.vec2f(1.5, 1.5),
      std.max(d.vec2f(std.length(m.xy), std.length(m.zw)), d.vec2f(0.01, 0.01)),
    );
    const local = std.sub(
      std.mul(quadCorner(d.i32(input.vertexIndex)), std.add(b.zw, std.mul(grow, 2))),
      grow,
    );
    const pixel = placed(b.xy, field(input.instanceIndex, fields.affine), local);
    const packedPlace = d.vec4f(local, pixel);
    const position = pixelToClip(pixel, scene.$.viewport.xy);
    return { position, place: packedPlace, record: input.instanceIndex };
  })
  .$name('boxVertex');
const fragment = tgpu
  .fragmentFn({ in: inputs, out: d.vec4f })((input) => {
    const box = d.vec4f(
      field(input.record, fields.bounds).zw,
      field(input.record, fields.typeInfo).y + 4 * field(input.record, fields.typeInfo).z,
      field(input.record, fields.typeInfo).w,
    );
    const place = input.place;
    const local = place.xy;
    const aa = halfPixel(local);
    const clips = std.floor(box.z * 0.25);
    const fillType = box.z - 4 * clips;
    const clip =
      clipCoverage(
        place.zw,
        field(input.record, fields.clipBounds),
        field(input.record, fields.clipRadius),
        clips,
        box.w,
      ) *
      localClipCoverage(
        local,
        field(input.record, fields.shadow),
        field(input.record, fields.shadowColor),
        clips,
        box.w,
        aa,
      ) *
      fadeCoverage(
        place.zw,
        field(input.record, fields.fadeBounds),
        field(input.record, fields.fade),
      ) *
      shapeCoverage(input.record, place.zw);
    if (clip < 0.001) {
      std.discard();
    }
    const p = local;
    const origin = d.vec2f(0, 0);
    const size = box.xy;
    const distance = boxDistance(
      p,
      size,
      field(input.record, fields.cornerRadius),
      field(input.record, fields.cornerShape),
      field(input.record, fields.notchCorners),
      field(input.record, fields.notchTop),
      field(input.record, fields.notchBottom),
    );
    const notched = isNotch(
      field(input.record, fields.notchCorners),
      field(input.record, fields.notchTop),
      field(input.record, fields.notchBottom),
    );
    const coverage = 1 - std.smoothstep(-aa, aa, distance);
    if (coverage < 0.001) {
      std.discard();
    }
    let fill = fillAt(
      p,
      field(input.record, fields.color),
      field(input.record, fields.color2),
      field(input.record, fields.via),
      field(input.record, fields.stops),
      field(input.record, fields.gradient),
      fillType,
    );
    if (notched) {
      const width = field(input.record, fields.border).x;
      if (width > 0) {
        const ring = std.smoothstep(-aa, aa, distance + width);
        fill = std.mix(
          fill,
          d.vec4f(
            field(input.record, fields.borderTop).rgb,
            field(input.record, fields.borderTop).a,
          ),
          ring * field(input.record, fields.borderTop).a,
        );
      }
    } else {
      fill = withBorder(
        p,
        origin,
        size,
        field(input.record, fields.cornerRadius),
        field(input.record, fields.cornerShape),
        distance,
        coverage,
        fill,
        field(input.record, fields.border),
        field(input.record, fields.borderTop),
        field(input.record, fields.borderRight),
        field(input.record, fields.borderBottom),
        field(input.record, fields.borderLeft),
        aa,
      );
    }
    return d.vec4f(fill.rgb, fill.a * clip * coverage);
  })
  .$name('boxFragment');
export function compileBoxShader() {
  const code = tgpu.resolve([vertex, fragment]);
  const vertexEntryPoint = /@vertex\s+fn\s+(\w+)/.exec(code)?.[1];
  const fragmentEntryPoint = /@fragment\s+fn\s+(\w+)/.exec(code)?.[1];
  if (!vertexEntryPoint || !fragmentEntryPoint) {
    throw new Error('Missing box shader entries');
  }
  return { code, vertexEntryPoint, fragmentEntryPoint, vertexCount: 6, alphaBlend: true };
}
