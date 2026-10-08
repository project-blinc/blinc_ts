import { tgpu, d, std } from 'typegpu';
import { fields } from './records.js';
import { field, scene, shapeCoverage } from './gpu/shared.js';
import {
  quadCorner,
  placed,
  pixelToClip,
  halfPixel,
  clipCoverage,
  localClipCoverage,
  fadeCoverage,
} from './gpu/sdf.js';

export { field, scene } from './gpu/shared.js';
export { fields } from './records.js';
export { placed, pixelToClip } from './gpu/sdf.js';

/** A content quad transformed to the canvas's place in the UI frame. */
export const canvasVaryings = {
  position: d.builtin.position,
  uv: d.vec2f,
  pixel: d.vec2f,
  record: d.interpolate('flat', d.u32),
};
export const canvasVertex = tgpu
  .vertexFn({
    in: { vertexIndex: d.builtin.vertexIndex, instanceIndex: d.builtin.instanceIndex },
    out: canvasVaryings,
  })((input) => {
    const b = field(input.instanceIndex, fields.bounds);
    const uv = quadCorner(d.i32(input.vertexIndex));
    const pixel = placed(b.xy, field(input.instanceIndex, fields.affine), std.mul(uv, b.zw));
    return {
      position: pixelToClip(pixel, scene.$.viewport.xy),
      uv,
      pixel,
      record: input.instanceIndex,
    };
  })
  .$name('canvasVertex');

/** Multiply straight output alpha by this coverage, including inherited opacity. */
export const canvasClip = tgpu
  .fn(
    [d.u32, d.vec2f],
    d.f32,
  )((record, pixel) => {
    const b = field(record, fields.bounds);
    const m = field(record, fields.affine);
    const delta = std.sub(pixel, b.xy);
    const local = std.div(
      d.vec2f(m.w * delta.x - m.z * delta.y, m.x * delta.y - m.y * delta.x),
      m.x * m.w - m.z * m.y,
    );
    const aa = halfPixel(local);
    const type = field(record, fields.typeInfo);
    return (
      clipCoverage(
        pixel,
        field(record, fields.clipBounds),
        field(record, fields.clipRadius),
        type.z,
        type.w,
      ) *
      localClipCoverage(
        local,
        field(record, fields.shadow),
        field(record, fields.shadowColor),
        type.z,
        type.w,
        aa,
      ) *
      fadeCoverage(pixel, field(record, fields.fadeBounds), field(record, fields.fade)) *
      shapeCoverage(record, pixel) *
      field(record, fields.color2).a
    );
  })
  .$name('canvasClip');
