import { fields } from '../../src/renderer/records.js';
import { tgpu, d, std } from 'typegpu';
import { inputs, field, shapeCoverage, scene, textures } from './shared.js';
import {
  quadCorner,
  placed,
  pixelToClip,
  boxDistance,
  clipCoverage,
  localClipCoverage,
  fadeCoverage,
  halfPixel,
} from './sdf.js';
import { noise, rimLine, rimLens, glassEnvironment } from './glass.js';

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
    const pixel = placed(b.xy, m, local);
    const packedPlace = d.vec4f(local, pixel);
    const position = pixelToClip(pixel, scene.$.viewport.xy);
    return { position, place: packedPlace, record: input.instanceIndex };
  })
  .$name('backdropVertex');
const fragment = tgpu
  .fragmentFn({ in: inputs, out: d.vec4f })((input) => {
    const place = input.place;
    const local = place.xy;
    const aa = halfPixel(local);
    const clips = field(input.record, fields.typeInfo).z;
    const n = field(input.record, fields.typeInfo).w;
    const box = field(input.record, fields.bounds).zw;
    const radius = field(input.record, fields.cornerRadius);
    const shape = field(input.record, fields.cornerShape);
    const nc = field(input.record, fields.notchCorners);
    const nt = field(input.record, fields.notchTop);
    const nb = field(input.record, fields.notchBottom);
    const distance = boxDistance(local, box, radius, shape, nc, nt, nb);
    const cover =
      (1 - std.smoothstep(-aa, aa, distance)) *
      clipCoverage(
        place.zw,
        field(input.record, fields.clipBounds),
        field(input.record, fields.clipRadius),
        clips,
        n,
      ) *
      localClipCoverage(
        local,
        field(input.record, fields.shadow),
        field(input.record, fields.shadowColor),
        clips,
        n,
        aa,
      ) *
      fadeCoverage(
        place.zw,
        field(input.record, fields.fadeBounds),
        field(input.record, fields.fade),
      ) *
      shapeCoverage(input.record, place.zw);
    if (cover < 0.001) {
      std.discard();
    }
    const size = d.vec2f(std.textureDimensions(textures.$.layer));
    // Bend the accumulated backdrop along the transformed SDF normal.
    const liquid = field(input.record, fields.gradient).x > 0.5;
    const inner = std.max(0, -distance);
    let normal = d.vec2f(0, 0);
    let localNormal = d.vec2f(0, 0);
    let offset = d.vec2f(0, 0);
    let lens = d.f32(0);
    const bevel = std.clamp(std.abs(field(input.record, fields.gradient).y), 0, 1);
    const rim = std.max(0.0001, std.min(25, std.min(box.x, box.y) * 0.2) * bevel);
    if (liquid) {
      const e = 0.5;
      const gx =
        boxDistance(std.add(local, d.vec2f(e, 0)), box, radius, shape, nc, nt, nb) -
        boxDistance(std.sub(local, d.vec2f(e, 0)), box, radius, shape, nc, nt, nb);
      const gy =
        boxDistance(std.add(local, d.vec2f(0, e)), box, radius, shape, nc, nt, nb) -
        boxDistance(std.sub(local, d.vec2f(0, e)), box, radius, shape, nc, nt, nb);
      localNormal = std.div(d.vec2f(gx, gy), std.max(std.length(d.vec2f(gx, gy)), 0.0001));
      const m = field(input.record, fields.affine);
      const g = d.vec2f(m.x * gx + m.z * gy, m.y * gx + m.w * gy);
      normal = std.div(g, std.max(std.length(g), 0.0001));
      lens = rimLens(inner, rim);
      const k = (size.x / scene.$.viewport.x) * std.length(m.xy);
      offset = std.mul(
        std.mul(std.mul(std.mul(normal, lens), 60), field(input.record, fields.gradient).y),
        k,
      );
    }
    const sigma = std.max(field(input.record, fields.color).x, 0.0001);
    const aberration = field(input.record, fields.stops).x;
    const emphasis = aberration * aberration * aberration;
    const dispersion = aberration * 0.12 + emphasis * 0.38;
    // Dispersion retains its strength when bevel is reduced; it does not widen the rim.
    const split = std.mul(offset, dispersion / std.max(bevel, 0.0001));
    const disperse = std.dot(split, split) > 0.000001;
    // A filtered read between each pair of texels yields their weighted Gaussian sum.
    const reach = std.ceil(sigma * 3);
    let sum = d.vec4f(0, 0, 0, 0);
    let red = d.vec2f(0, 0);
    let blue = d.vec2f(0, 0);
    let weights = d.f32(0);
    let i = -reach;
    while (i <= reach) {
      const w0 = std.exp((-i * i) / (2 * sigma * sigma));
      const w1 = std.exp((-(i + 1) * (i + 1)) / (2 * sigma * sigma));
      const w = w0 + w1;
      const at = d.vec2f(
        input.position.x + offset.x,
        input.position.y + offset.y + i + w1 / std.max(w, 1e-30),
      );
      sum = std.add(
        sum,
        std.mul(
          std.textureSampleLevel(textures.$.layer, textures.$.linearSampler, std.div(at, size), 0),
          w,
        ),
      );
      if (disperse) {
        const r = std.textureSampleLevel(
          textures.$.layer,
          textures.$.linearSampler,
          std.div(std.add(at, split), size),
          0,
        );
        const b = std.textureSampleLevel(
          textures.$.layer,
          textures.$.linearSampler,
          std.div(std.sub(at, split), size),
          0,
        );
        red = std.add(red, std.mul(d.vec2f(r.r, r.a), w));
        blue = std.add(blue, std.mul(d.vec2f(b.b, b.a), w));
      }
      weights += w;
      i += 2;
    }
    let texel = std.div(sum, weights);
    if (disperse) {
      texel = std.div(
        d.vec4f(red.x, sum.g, blue.x, std.max(sum.a, std.max(red.y, blue.y))),
        weights,
      );
    }
    // Render targets contain premultiplied color; filters and tint operate on straight RGB.
    let rgb = d.vec3f(0, 0, 0);
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
      d.vec3f(0, 0, 0),
      d.vec3f(1, 1, 1),
    );
    let tint = std.clamp(
      d.vec3f(
        field(input.record, fields.color2).w,
        field(input.record, fields.border).w,
        field(input.record, fields.borderColor).w,
      ),
      d.vec3f(0, 0, 0),
      d.vec3f(1, 1, 1),
    );
    let tintAlpha = std.clamp(
      1 -
        (field(input.record, fields.color2).x +
          field(input.record, fields.border).y +
          field(input.record, fields.borderColor).z) /
          3,
      0,
      1,
    );
    if (liquid) {
      const width = field(input.record, fields.gradient).z;
      const line = rimLine(inner, width) * bevel;
      const lightShift = aberration * width * 0.75;
      const light = std.mul(
        d.vec2f(
          std.cos(field(input.record, fields.gradient).w),
          std.sin(field(input.record, fields.gradient).w),
        ),
        field(input.record, fields.gradient).y < 0 ? -1 : 1,
      );
      const litRgb = std.mul(
        d.vec3f(
          rimLine(inner + lightShift, width) * bevel,
          line,
          rimLine(inner - lightShift, width) * bevel,
        ),
        0.6 * (0.2 + 0.8 * std.max(0, std.dot(normal, std.neg(light)))),
      );
      const lit = std.max(litRgb.r, std.max(litRgb.g, litRgb.b));
      const edge = field(input.record, fields.borderTop);
      const s0 = width * 2.5;
      const s1 = width * 8;
      const shade =
        std.smoothstep(s0, s1, inner) * (1 - std.smoothstep(s1, s1 * 3, inner)) * 0.04 * bevel;
      const via = std.clamp(field(input.record, fields.via).a, 0, 1);
      if (edge.a > 0.001) {
        rgb = std.mix(rgb, edge.rgb, line * edge.a);
        const k = line * edge.a;
        tint = std.add(std.mul(tint, 1 - k), std.mul(edge.rgb, k));
        tintAlpha = k + tintAlpha * (1 - k);
      } else {
        tint = std.add(std.mul(tint, 1 - lit), litRgb);
        tintAlpha = lit + tintAlpha * (1 - lit);
      }
      rgb = std.sub(rgb, d.vec3f(shade, shade, shade));
      rgb = std.clamp(
        std.mix(rgb, field(input.record, fields.via).rgb, via),
        d.vec3f(0, 0, 0),
        d.vec3f(1, 1, 1),
      );
      if (edge.a <= 0.001) {
        rgb = std.clamp(std.add(std.mul(rgb, 1 - lit), litRgb), d.vec3f(0, 0, 0), d.vec3f(1, 1, 1));
      }
      tint = std.add(
        std.mul(std.mul(tint, 1 - shade), 1 - via),
        std.mul(field(input.record, fields.via).rgb, via),
      );
      tintAlpha = via + (shade + tintAlpha * (1 - shade)) * (1 - via);
      // On a transparent target, refract a neutral light field where no backdrop was drawn.
      if (texel.a < 0.999 && lens > 0) {
        const span = std.max(std.min(box.x, box.y), 1);
        const bend = std.mul(
          std.mul(std.mul(localNormal, lens), 60 / span),
          field(input.record, fields.gradient).y,
        );
        const point = std.add(std.div(std.sub(local, std.mul(box, 0.5)), span), bend);
        const separation = std.mul(bend, dispersion / std.max(bevel, 0.0001));
        const middle = glassEnvironment(point);
        let environment = d.vec3f(
          glassEnvironment(std.add(point, separation)),
          middle,
          glassEnvironment(std.sub(point, separation)),
        );
        environment = std.mix(d.vec3f(middle, middle, middle), environment, 0.35);
        const strength = (lens * (1 - lens) * 4 * 0.18 + lens * 0.06) * bevel;
        const environmentAlpha =
          std.max(environment.r, std.max(environment.g, environment.b)) * strength;
        tint = std.add(std.mul(tint, 1 - environmentAlpha), std.mul(environment, strength));
        tintAlpha = environmentAlpha + tintAlpha * (1 - environmentAlpha);
      }
      const band = lens * (1 - lens) * 4 * 0.12 * bevel;
      tint = std.mul(tint, 1 - band);
      tintAlpha = band + tintAlpha * (1 - band);
      const specShift = field(input.record, fields.stops).x * 0.6;
      const spectrum = d.vec3f(
        rimLens(inner + specShift, rim),
        lens,
        rimLens(inner - specShift, rim),
      );
      const reflected =
        0.85 * std.max(0, std.dot(normal, std.neg(light))) +
        0.35 * std.max(0, std.dot(normal, light));
      const neutralSpec = lens * lens * reflected;
      const specRgb = std.mul(
        std.mix(
          d.vec3f(neutralSpec, neutralSpec, neutralSpec),
          std.mul(std.mul(spectrum, spectrum), reflected),
          0.35,
        ),
        bevel,
      );
      const spec = std.max(specRgb.r, std.max(specRgb.g, specRgb.b));
      tint = std.add(std.mul(tint, 1 - spec), specRgb);
      tintAlpha = spec + tintAlpha * (1 - spec);
      tintAlpha = std.max(tintAlpha, 0.04);
    }
    const under = texel.a;
    const alpha = under + tintAlpha * (1 - under);
    if (alpha > 0.0001) {
      rgb = std.div(std.add(std.mul(rgb, under), std.mul(tint, 1 - under)), alpha);
    }
    if (field(input.record, fields.color).z > 0) {
      const grain =
        (noise(std.mul(place.zw, 0.3)) - 0.5) *
        field(input.record, fields.color).z *
        (liquid ? 0.005 : 0.02);
      rgb = std.clamp(
        std.add(rgb, d.vec3f(grain, grain, grain)),
        d.vec3f(0, 0, 0),
        d.vec3f(1, 1, 1),
      );
    }
    return d.vec4f(rgb, alpha * cover * field(input.record, fields.color).w);
  })
  .$name('backdropFragment');
export function compileBackdropShader() {
  const code = tgpu.resolve([vertex, fragment]);
  const vertexEntryPoint = /@vertex\s+fn\s+(\w+)/.exec(code)?.[1];
  const fragmentEntryPoint = /@fragment\s+fn\s+(\w+)/.exec(code)?.[1];
  if (!vertexEntryPoint || !fragmentEntryPoint) {
    throw new Error('Missing backdrop shader entries');
  }
  return { code, vertexEntryPoint, fragmentEntryPoint, vertexCount: 6, alphaBlend: true };
}
