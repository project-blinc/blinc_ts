import { tgpu, d, std } from 'typegpu';
import { fields } from '../../src/renderer/records.js';
import { inputs, field, textures } from './shared.js';
import { layerVertex, gaussian } from './layerShared.js';

const maskAlpha = tgpu
  .fn(
    [d.u32, d.vec2f],
    d.f32,
  )((record, pixel) => {
    const a = field(record, fields.borderTop);
    let alpha = d.f32(1);
    if (a.x > 0.5) {
      const m = field(record, fields.borderLeft);
      const t = field(record, fields.cornerRadius);
      const q = std.sub(std.div(pixel, std.max(t.z, 0.0001)), t.xy);
      const det = m.x * m.w - m.z * m.y;
      const local = std.div(d.vec2f(m.w * q.x - m.z * q.y, -m.y * q.x + m.x * q.y), det);
      const frame = field(record, fields.borderBottom);
      const uv = std.div(std.sub(local, frame.xy), std.max(frame.zw, d.vec2f(0.0001)));
      const g = field(record, fields.borderRight);
      // The seed establishes floating-point storage for both gradient branches.
      // eslint-disable-next-line no-useless-assignment -- Seed the WGSL variable as f32.
      let f = d.f32(0);
      if (a.x < 1.5) {
        const dir = std.sub(g.zw, g.xy);
        f = std.clamp(std.dot(std.sub(uv, g.xy), dir) / std.max(std.dot(dir, dir), 0.000001), 0, 1);
      } else {
        f = std.clamp(std.length(std.sub(uv, g.xy)) / std.max(g.z, 0.0001), 0, 1);
      }
      const s = field(record, fields.stops);
      if (s.w > 0.5) {
        if (f <= s.y) {
          alpha = std.mix(a.y, a.z, std.clamp((f - s.x) / std.max(s.y - s.x, 0.0001), 0, 1));
        } else {
          alpha = std.mix(a.z, a.w, std.clamp((f - s.y) / std.max(s.z - s.y, 0.0001), 0, 1));
        }
      } else {
        alpha = std.mix(a.y, a.w, std.clamp((f - s.x) / std.max(s.z - s.x, 0.0001), 0, 1));
      }
    }
    return alpha;
  })
  .$name('layerMaskAlpha');

const fragment = tgpu
  .fragmentFn({ in: inputs, out: d.vec4f })((input) => {
    let texel = std.textureLoad(textures.$.layer, d.vec2i(input.position.xy), 0);
    const color = field(input.record, fields.color);
    if (color.x > 0) {
      texel = gaussian(textures.$.layer, input.position.xy, d.vec2f(0, 1), color.x);
    }
    let rgb = d.vec3f(0);
    if (texel.a > 0.0001) {
      rgb = std.div(texel.rgb, texel.a);
    }
    const c = d.vec4f(rgb, 1);
    rgb = std.clamp(
      d.vec3f(
        std.dot(field(input.record, fields.color2), c),
        std.dot(field(input.record, fields.border), c),
        std.dot(field(input.record, fields.borderColor), c),
      ),
      d.vec3f(0),
      d.vec3f(1),
    );
    let alpha = texel.a;
    const tint = field(input.record, fields.via);
    if (tint.a > 0) {
      const offset = field(input.record, fields.gradient);
      const source = std.sub(
        std.floor(input.position.xy),
        std.floor(std.add(offset.xy, d.vec2f(0.5))),
      );
      const size = d.vec2f(std.textureDimensions(textures.$.shadow));
      let fallen = d.f32(0);
      if (source.x >= 0 && source.x < size.x) {
        fallen = gaussian(
          textures.$.shadow,
          std.add(source, d.vec2f(0.5)),
          d.vec2f(0, 1),
          offset.z,
        ).a;
      }
      const sa = fallen * tint.a;
      const outAlpha = alpha + sa * (1 - alpha);
      const premult = std.add(std.mul(rgb, alpha), std.mul(tint.rgb, sa * (1 - alpha)));
      rgb = d.vec3f(0);
      if (outAlpha > 0.0001) {
        rgb = std.div(premult, outAlpha);
      }
      alpha = outAlpha;
    }
    return d.vec4f(rgb, alpha * color.a * maskAlpha(input.record, input.position.xy));
  })
  .$name('layerFragment');

export function compileLayerShader() {
  const code = tgpu.resolve([layerVertex, fragment]);
  const vertexEntryPoint = /@vertex\s+fn\s+(\w+)/.exec(code)?.[1];
  const fragmentEntryPoint = /@fragment\s+fn\s+(\w+)/.exec(code)?.[1];
  if (!vertexEntryPoint || !fragmentEntryPoint) {
    throw new Error('Missing layer shader entries');
  }
  return { code, vertexEntryPoint, fragmentEntryPoint, vertexCount: 6, alphaBlend: true };
}
