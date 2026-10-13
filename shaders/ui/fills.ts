import { tgpu, d, std } from 'typegpu';

import { scene } from '../../src/renderer/gpu/shared.js';
import { quarterEllipseSdf } from '../../src/renderer/gpu/sdf.js';

/** Sample complete stop data in the shared scene tail. */
export const gradientColor = tgpu
  .fn(
    [d.f32, d.f32],
    d.vec4f,
  )((position, marker) => {
    const first = d.u32(marker - 2);
    const header = scene.$.records[first]!;
    const count = d.u32(header.x);
    const start = scene.$.records[first + 3]!.x;
    const end = scene.$.records[first + 1 + 2 * count]!.x;
    let t = d.f32(position);
    if (header.y > 0.5) {
      const period = end - start;
      if (period <= std.fwidth(position)) {
        return scene.$.records[first + 1]!;
      }
      let phase = (t - start) / period;
      if (header.y > 1.5) {
        phase = 1 - std.abs(2 * std.fract(phase * 0.5) - 1);
      } else {
        phase = std.fract(phase);
      }
      t = start + phase * period;
    }
    let color = d.vec4f(scene.$.records[first + 2]!);
    let offset = d.f32(start);
    let i = d.u32(1);
    while (i < count) {
      const next = scene.$.records[first + 2 + 2 * i]!;
      const at = scene.$.records[first + 3 + 2 * i]!.x;
      if (t < at) {
        const mix = std.clamp((t - offset) / std.max(at - offset, 1e-20), 0, 1);
        const premult = std.mix(
          d.vec4f(std.mul(color.rgb, color.a), color.a),
          d.vec4f(std.mul(next.rgb, next.a), next.a),
          mix,
        );
        if (premult.a > 0) {
          return d.vec4f(std.div(premult.rgb, premult.a), premult.a);
        }
        return d.vec4f(0);
      }
      color = d.vec4f(next);
      offset = at;
      i++;
    }
    return color;
  })
  .$name('gradientColor');

/** Solid, linear, radial or clockwise conic fill. */
export const fillAt = tgpu
  .fn(
    [d.vec2f, d.vec4f, d.vec4f, d.vec4f, d.vec4f, d.vec4f, d.f32],
    d.vec4f,
  )((p, c1, c2, via, stops, g, fillType) => {
    let c = d.vec4f(c1);
    if (fillType > 0.5) {
      // eslint-disable-next-line no-useless-assignment -- The initializer establishes the WGSL storage type.
      let t = d.f32(0);
      if (fillType < 1.5) {
        const dir = std.sub(g.zw, g.xy);
        t = std.dot(std.sub(p, g.xy), dir) / std.max(std.dot(dir, dir), 1e-20);
      } else if (fillType < 2.5) {
        t = std.length(std.sub(p, g.xy)) / std.max(g.z, 1e-20);
      } else {
        const delta = std.sub(p, g.xy);
        t = std.fract((std.atan2(delta.x, -delta.y) - g.z) / (2 * Math.PI));
      }
      if (stops.w >= 2) {
        return gradientColor(t, stops.w);
      }
      if (stops.w > 0.5) {
        if (t <= stops.y) {
          c = std.mix(c1, via, std.clamp((t - stops.x) / std.max(stops.y - stops.x, 0.0001), 0, 1));
        } else {
          c = std.mix(via, c2, std.clamp((t - stops.y) / std.max(stops.z - stops.y, 0.0001), 0, 1));
        }
      } else {
        c = std.mix(c1, c2, std.clamp((t - stops.x) / std.max(stops.z - stops.x, 0.0001), 0, 1));
      }
    }
    return c;
  })
  .$name('fillAt');
/** Composite the per-side border over the fill, preserving straight alpha. */
export const withBorder = tgpu
  .fn(
    [
      d.vec2f,
      d.vec2f,
      d.vec2f,
      d.vec4f,
      d.vec4f,
      d.f32,
      d.f32,
      d.vec4f,
      d.vec4f,
      d.vec4f,
      d.vec4f,
      d.vec4f,
      d.vec4f,
      d.f32,
    ],
    d.vec4f,
  )(
    (
      p,
      origin,
      size,
      radii,
      shape,
      distance,
      coverage,
      fill,
      border,
      topColor,
      rightColor,
      bottomColor,
      leftColor,
      aa,
    ) => {
      let result = d.vec4f(fill);
      if (std.max(std.max(border.x, border.y), std.max(border.z, border.w)) > 0) {
        const top = border.x;
        const right = border.y;
        const bottom = border.z;
        const left = border.w;
        const halfSize = std.mul(size, 0.5);
        const rel = std.sub(p, std.add(origin, halfSize));
        let borderColor = d.vec4f(topColor);
        let nearest = (rel.y + halfSize.y) / std.max(top, 0.0001);
        const toRight = (halfSize.x - rel.x) / std.max(right, 0.0001);
        if (toRight < nearest) {
          nearest = toRight;
          borderColor = d.vec4f(rightColor);
        }
        const toBottom = (halfSize.y - rel.y) / std.max(bottom, 0.0001);
        if (toBottom < nearest) {
          nearest = toBottom;
          borderColor = d.vec4f(bottomColor);
        }
        if ((rel.x + halfSize.x) / std.max(left, 0.0001) < nearest) {
          borderColor = d.vec4f(leftColor);
        }
        let r = radii.w;
        let n = shape.w;
        if (rel.y < 0) {
          r = radii.x;
          n = shape.x;
          if (rel.x > 0) {
            r = radii.y;
            n = shape.y;
          }
        } else if (rel.x > 0) {
          r = radii.z;
          n = shape.z;
        }
        r = std.min(r, std.min(halfSize.x, halfSize.y));
        let bx = right;
        if (rel.x < 0) {
          bx = left;
        }
        let by = bottom;
        if (rel.y < 0) {
          by = top;
        }
        if (bx === 0) {
          bx = -aa;
        }
        if (by === 0) {
          by = -aa;
        }
        const reduced = d.vec2f(bx, by);
        const cornerToPoint = std.sub(std.abs(rel), halfSize);
        const cornerCenterToPoint = std.add(cornerToPoint, d.vec2f(r, r));
        const nearCorner = cornerCenterToPoint.x >= 0 && cornerCenterToPoint.y >= 0;
        const straightInner = std.add(cornerToPoint, reduced);
        const insideStraight = straightInner.x < -aa && straightInner.y < -aa;
        const concave = n < 0;
        if (nearCorner || !insideStraight || concave) {
          // eslint-disable-next-line no-useless-assignment -- The initializer establishes the WGSL storage type.
          let innerSdf = d.f32(0);
          if (std.abs(reduced.x - reduced.y) < 0.001 || concave) {
            innerSdf = -(distance + reduced.x);
          } else if (cornerCenterToPoint.x <= 0 || cornerCenterToPoint.y <= 0) {
            innerSdf = -std.max(straightInner.x, straightInner.y);
          } else if (std.abs(n - 1) < 0.01) {
            innerSdf = quarterEllipseSdf(
              cornerCenterToPoint,
              std.max(d.vec2f(0, 0), std.sub(d.vec2f(r, r), reduced)),
            );
          } else {
            const innerRadii = std.max(d.vec2f(0, 0), std.sub(d.vec2f(r, r), reduced));
            const e = std.pow(2, std.min(std.abs(n), 5));
            if (std.min(innerRadii.x, innerRadii.y) < 0.001) {
              innerSdf = -std.length(std.max(d.vec2f(0, 0), cornerCenterToPoint));
            } else {
              const it = std.div(cornerCenterToPoint, innerRadii);
              const se = std.pow(std.max(it.x, 0), e) + std.pow(std.max(it.y, 0), e);
              innerSdf = -((std.pow(se, 1 / e) - 1) * std.sqrt(innerRadii.x * innerRadii.y));
            }
          }
          const borderA =
            borderColor.a * std.smoothstep(-aa, aa, -innerSdf) * std.step(0.001, coverage);
          const outA = borderA + fill.a * (1 - borderA);
          let rgb = d.vec3f(0, 0, 0);
          if (outA >= 0.0001) {
            rgb = std.div(
              std.add(
                std.mul(borderColor.rgb, borderA),
                std.mul(std.mul(fill.rgb, fill.a), 1 - borderA),
              ),
              outA,
            );
          }
          result = d.vec4f(rgb, outA);
        }
      }
      return result;
    },
  )
  .$name('withBorder');
