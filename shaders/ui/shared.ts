import { sceneSchema } from '../../src/native/scene.js';
import { fields } from '../../src/renderer/records.js';
import { tgpu, d, std } from 'typegpu';
import { sdShapedRect, halfPixel } from './sdf.js';
export const scene = tgpu
  .bindGroupLayout({
    viewport: { uniform: d.vec4f },
    records: { storage: d.arrayOf(d.vec4f), access: 'readonly' },
  })
  .$idx(0);
export const textures = tgpu
  .bindGroupLayout({
    atlas: { texture: d.texture2d() },
    colorAtlas: { texture: d.texture2d() },
    images: { texture: d.texture2d() },
    layer: { texture: d.texture2d() },
    linearSampler: { sampler: 'filtering' },
    shadow: { texture: d.texture2d() },
  })
  .$idx(1);
export const field = tgpu.fn(
  [d.u32, d.u32],
  d.vec4f,
)((record, row) => scene.$.records[record * sceneSchema.recordRows + row]!);
export const crossing = tgpu
  .fn(
    [d.vec2f, d.vec2f, d.vec2f],
    d.i32,
  )((a, b, q) => {
    const side = (b.x - a.x) * (q.y - a.y) - (q.x - a.x) * (b.y - a.y);
    let w = 0;
    if (a.y <= q.y) {
      if (b.y > q.y && side > 0) {
        w = 1;
      }
    } else if (b.y <= q.y && side < 0) {
      w = -1;
    }
    return w;
  })
  .$name('crossing');
export const polygonCoverage = tgpu
  .fn(
    [d.vec2f, d.i32, d.i32, d.f32],
    d.f32,
  )((q, first, count, aa) => {
    let distance = d.f32(1e20);
    const s = aa * 0.7;
    let w0 = 0;
    let w1 = 0;
    let w2 = 0;
    let w3 = 0;
    let w4 = 0;
    let prev = d.vec2f(0, 0);
    let i = 0;
    while (i < count) {
      const t = scene.$.records[d.u32(first + std.floor(i / 2))]!;
      let v = d.vec2f(t.xy);
      if (i % 2 === 1) {
        v = d.vec2f(t.zw);
      }
      if (i > 0 && v.x < 1e29 && prev.x < 1e29) {
        const e = std.sub(prev, v);
        const w = std.sub(q, v);
        const b = std.sub(
          w,
          std.mul(e, std.clamp(std.dot(w, e) / std.max(std.dot(e, e), 1e-12), 0, 1)),
        );
        distance = std.min(distance, std.dot(b, b));
        w0 += crossing(prev, v, q);
        w1 += crossing(prev, v, std.add(q, d.vec2f(s, s)));
        w2 += crossing(prev, v, std.add(q, d.vec2f(-s, s)));
        w3 += crossing(prev, v, std.add(q, d.vec2f(s, -s)));
        w4 += crossing(prev, v, std.add(q, d.vec2f(-s, -s)));
      }
      prev = d.vec2f(v);
      i++;
    }
    let inside = 0;
    if (w1 !== 0) {
      inside++;
    }
    if (w2 !== 0) {
      inside++;
    }
    if (w3 !== 0) {
      inside++;
    }
    if (w4 !== 0) {
      inside++;
    }
    let dist = std.sqrt(distance);
    if (w0 !== 0) {
      dist = -dist;
    }
    let cover = 1 - std.smoothstep(-aa, aa, dist);
    if (inside === 4) {
      cover = 1;
    }
    if (inside === 0) {
      cover = 0;
    }
    return cover;
  })
  .$name('polygonCoverage');
export const shapeCoverage = tgpu
  .fn(
    [d.u32, d.vec2f],
    d.f32,
  )((record, p) => {
    const frame = field(record, fields.shapeFrame);
    const rest = field(record, fields.shapeRest);
    const shape = field(record, fields.shape);
    const q = d.vec2f(
      frame.x * p.x + frame.z * p.y + rest.x,
      frame.y * p.x + frame.w * p.y + rest.y,
    );
    const aa = halfPixel(q);
    let alpha = d.f32(1);
    if (rest.z > 2.5) {
      alpha = polygonCoverage(q, d.i32(shape.x), d.i32(shape.y), aa);
    } else if (rest.z > 1.5) {
      alpha =
        1 -
        std.smoothstep(
          -aa,
          aa,
          sdShapedRect(
            q,
            shape.xy,
            shape.zw,
            d.vec4f(rest.w, rest.w, rest.w, rest.w),
            d.vec4f(1, 1, 1, 1),
          ),
        );
    } else if (rest.z > 0.5) {
      const r = std.max(shape.zw, d.vec2f(0.0001, 0.0001));
      const u = std.div(std.sub(q, shape.xy), r);
      const lu = std.length(u);
      alpha =
        1 - std.smoothstep(-aa, aa, ((lu - 1) * lu) / std.max(std.length(std.div(u, r)), 0.0001));
    }
    return alpha;
  })
  .$name('shapeCoverage');
export const inputs = {
  position: d.builtin.position,
  place: d.vec4f,
  record: d.interpolate('flat', d.u32),
};
