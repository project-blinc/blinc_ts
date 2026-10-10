import { tgpu, d, std } from 'typegpu';

// The established SDF, border and glass equations, expressed as typed shader functions.
export const quadCorner = tgpu
  .fn(
    [d.i32],
    d.vec2f,
  )((i) => {
    let c = d.vec2f(0, 0);
    if (i === 1 || i === 3) {
      c = d.vec2f(1, 0);
    }
    if (i === 2 || i === 5) {
      c = d.vec2f(0, 1);
    }
    if (i === 4) {
      c = d.vec2f(1, 1);
    }
    return c;
  })
  .$name('quadCorner');
export const placed = tgpu
  .fn(
    [d.vec2f, d.vec4f, d.vec2f],
    d.vec2f,
  )((at, m, rel) => {
    return std.add(at, d.vec2f(m.x * rel.x + m.z * rel.y, m.y * rel.x + m.w * rel.y));
  })
  .$name('placed');
export const pixelToClip = tgpu
  .fn(
    [d.vec2f, d.vec2f],
    d.vec4f,
  )((pos, size) => {
    return d.vec4f((pos.x / size.x) * 2 - 1, 1 - (pos.y / size.y) * 2, 0, 1);
  })
  .$name('pixelToClip');
export const sdRoundedRect = tgpu
  .fn(
    [d.vec2f, d.vec2f, d.vec2f, d.vec4f],
    d.f32,
  )((p, origin, size, radius) => {
    const halfSize = std.mul(size, 0.5);
    const rel = std.sub(p, std.add(origin, halfSize));
    const q = std.sub(std.abs(rel), halfSize);
    let r = radius.w;
    if (rel.y < 0) {
      r = radius.x;
      if (rel.x > 0) {
        r = radius.y;
      }
    } else if (rel.x > 0) {
      r = radius.z;
    }
    r = std.min(r, std.min(halfSize.x, halfSize.y));
    const qa = std.add(q, d.vec2f(r, r));
    return std.length(std.max(qa, d.vec2f(0, 0))) + std.min(std.max(qa.x, qa.y), 0) - r;
  })
  .$name('sdRoundedRect');
/** Per-corner superellipse: 1 round, 2 squircle, 0 bevel, negative scoop; ±100 square/notch. */
export const sdShapedRect = tgpu
  .fn(
    [d.vec2f, d.vec2f, d.vec2f, d.vec4f, d.vec4f],
    d.f32,
  )((p, origin, size, radius, shape) => {
    const halfSize = std.mul(size, 0.5);
    const rel = std.sub(p, std.add(origin, halfSize));
    const q = std.sub(std.abs(rel), halfSize);
    let r = radius.w;
    let n = shape.w;
    if (rel.y < 0) {
      r = radius.x;
      n = shape.x;
      if (rel.x > 0) {
        r = radius.y;
        n = shape.y;
      }
    } else if (rel.x > 0) {
      r = radius.z;
      n = shape.z;
    }
    r = std.min(r, std.min(halfSize.x, halfSize.y));
    const qa = std.add(q, d.vec2f(r, r));
    const box = std.length(std.max(q, d.vec2f(0, 0))) + std.min(std.max(q.x, q.y), 0);
    // eslint-disable-next-line no-useless-assignment -- The initializer establishes the WGSL storage type.
    let distance = d.f32(0);
    if (r <= 0) {
      distance = box;
    } else if (n <= -100) {
      const cut =
        std.length(std.max(std.neg(qa), d.vec2f(0, 0))) + std.min(std.max(-qa.x, -qa.y), 0);
      distance = std.max(box, -cut);
    } else if (std.abs(n - 1) < 0.01) {
      distance = std.length(std.max(qa, d.vec2f(0, 0))) + std.min(std.max(qa.x, qa.y), 0) - r;
    } else if (n < 0) {
      distance = std.max(box, -superellipse(std.neg(q), r, n));
    } else if (n >= 100) {
      distance = box;
    } else if (std.abs(n) < 0.01) {
      distance = std.max(box, (qa.x + qa.y - r) * 0.70710678);
    } else {
      distance = std.max(box, superellipse(qa, r, n));
    }
    return distance;
  })
  .$name('sdShapedRect');
export const boxDistance = tgpu
  .fn(
    [d.vec2f, d.vec2f, d.vec4f, d.vec4f, d.vec4f, d.vec4f, d.vec4f],
    d.f32,
  )((p, size, radius, shape, corners, top, bottom) => {
    // eslint-disable-next-line no-useless-assignment -- The initializer establishes the WGSL storage type.
    let distance = d.f32(0);
    if (isNotch(corners, top, bottom)) {
      distance = sdNotch(p, size, corners, top, bottom);
    } else {
      distance = sdShapedRect(p, d.vec2f(0, 0), size, radius, shape);
    }
    return distance;
  })
  .$name('boxDistance');
export const sdEllipseAt = tgpu
  .fn(
    [d.vec2f, d.vec2f, d.vec2f],
    d.f32,
  )((p, c, radii) => {
    return (
      (std.length(std.div(std.sub(p, c), std.max(radii, d.vec2f(0.001, 0.001)))) - 1) *
      std.min(radii.x, radii.y)
    );
  })
  .$name('sdEllipseAt');
export const sdTriangle = tgpu
  .fn(
    [d.vec2f, d.vec2f, d.vec2f, d.vec2f],
    d.f32,
  )((p, a, b, c) => {
    const e0 = std.sub(b, a);
    const e1 = std.sub(c, b);
    const e2 = std.sub(a, c);
    const v0 = std.sub(p, a);
    const v1 = std.sub(p, b);
    const v2 = std.sub(p, c);
    const pq0 = std.sub(
      v0,
      std.mul(e0, std.clamp(std.dot(v0, e0) / std.max(std.dot(e0, e0), 0.000001), 0, 1)),
    );
    const pq1 = std.sub(
      v1,
      std.mul(e1, std.clamp(std.dot(v1, e1) / std.max(std.dot(e1, e1), 0.000001), 0, 1)),
    );
    const pq2 = std.sub(
      v2,
      std.mul(e2, std.clamp(std.dot(v2, e2) / std.max(std.dot(e2, e2), 0.000001), 0, 1)),
    );
    const s = std.sign(e0.x * e2.y - e0.y * e2.x);
    const distance = std.min(
      std.min(
        d.vec2f(std.dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
        d.vec2f(std.dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x)),
      ),
      d.vec2f(std.dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)),
    );
    return -std.sqrt(distance.x) * std.sign(distance.y);
  })
  .$name('sdTriangle');
export const smin = tgpu
  .fn(
    [d.f32, d.f32, d.f32],
    d.f32,
  )((a, b, k) => {
    const h = std.clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
    return std.mix(b, a, h) - k * h * (1 - h);
  })
  .$name('smin');
export const smax = tgpu
  .fn(
    [d.f32, d.f32, d.f32],
    d.f32,
  )((a, b, k) => {
    return -smin(-a, -b, k);
  })
  .$name('smax');
export const isNotch = tgpu
  .fn(
    [d.vec4f, d.vec4f, d.vec4f],
    d.bool,
  )((corners, top, bottom) => {
    return std.dot(std.abs(corners), d.vec4f(1, 1, 1, 1)) + top.x + bottom.x > 0;
  })
  .$name('isNotch');
/** Rounded body with concave corner flares and optional top/bottom scoop, bulge, cut or peak. */
export const sdNotch = tgpu
  .fn(
    [d.vec2f, d.vec2f, d.vec4f, d.vec4f, d.vec4f],
    d.f32,
  )((p, size, corners, top, bottom) => {
    const r = std.abs(corners);
    const tlC = corners.x < 0;
    const trC = corners.y < 0;
    const brC = corners.z < 0;
    const blC = corners.w < 0;
    let topH = d.f32(0);
    if ((top.x > 1.5 && top.x < 2.5) || (top.x > 3.5 && top.x < 4.5)) {
      topH = top.z;
    }
    let botH = d.f32(0);
    if ((bottom.x > 1.5 && bottom.x < 2.5) || (bottom.x > 3.5 && bottom.x < 4.5)) {
      botH = bottom.z;
    }
    let tl = d.f32(0);
    if (tlC) {
      tl = r.x;
    }
    let tr = d.f32(0);
    if (trC) {
      tr = r.y;
    }
    let br = d.f32(0);
    if (brC) {
      br = r.z;
    }
    let bl = d.f32(0);
    if (blC) {
      bl = r.w;
    }
    const left = std.max(tl, bl);
    const right = std.max(tr, br);
    const topOffset = std.max(std.max(tl, tr), topH);
    const bottomOffset = std.max(std.max(bl, br), botH);
    const innerOrigin = d.vec2f(left, topOffset);
    const innerSize = d.vec2f(
      std.max(size.x - left - right, 0.001),
      std.max(size.y - topOffset - bottomOffset, 0.001),
    );
    const innerRadii = d.vec4f(r);
    if (tlC) {
      innerRadii.x = 0;
    }
    if (trC) {
      innerRadii.y = 0;
    }
    if (brC) {
      innerRadii.z = 0;
    }
    if (blC) {
      innerRadii.w = 0;
    }
    let distance = sdShapedRect(p, innerOrigin, innerSize, innerRadii, d.vec4f(1, 1, 1, 1));
    const innerRight = innerOrigin.x + innerSize.x;
    const innerBottom = innerOrigin.y + innerSize.y;
    const into = std.min(innerSize.x, innerSize.y) * 0.5;
    // A flare reaches a little way into the body: further, and its far edge shows in the distance
    // gradient that glass refracts along. A bulge or peak reaches all the way.
    const flareInto = std.min(8, into);
    const room = std.max(size.y - topOffset - bottomOffset, 0);
    const sharp = d.vec4f(0, 0, 0, 0);
    const round = d.vec4f(1, 1, 1, 1);
    if (tlC) {
      const ry = std.min(r.x, room);
      const flare = std.max(
        sdShapedRect(p, d.vec2f(0, innerOrigin.y), d.vec2f(left + flareInto, ry), sharp, round),
        -sdEllipseAt(p, d.vec2f(0, innerOrigin.y + ry), d.vec2f(left, ry)),
      );
      distance = std.min(distance, flare);
    }
    if (trC) {
      const ry = std.min(r.y, room);
      const w = size.x - innerRight;
      const flare = std.max(
        sdShapedRect(
          p,
          d.vec2f(innerRight - flareInto, innerOrigin.y),
          d.vec2f(w + flareInto, ry),
          sharp,
          round,
        ),
        -sdEllipseAt(p, d.vec2f(size.x, innerOrigin.y + ry), d.vec2f(w, ry)),
      );
      distance = std.min(distance, flare);
    }
    if (brC) {
      const ry = std.min(r.z, room);
      const w = size.x - innerRight;
      const flare = std.max(
        sdShapedRect(
          p,
          d.vec2f(innerRight - flareInto, innerBottom - ry),
          d.vec2f(w + flareInto, ry),
          sharp,
          round,
        ),
        -sdEllipseAt(p, d.vec2f(size.x, innerBottom - ry), d.vec2f(w, ry)),
      );
      distance = std.min(distance, flare);
    }
    if (blC) {
      const ry = std.min(r.w, room);
      const flare = std.max(
        sdShapedRect(p, d.vec2f(0, innerBottom - ry), d.vec2f(left + flareInto, ry), sharp, round),
        -sdEllipseAt(p, d.vec2f(0, innerBottom - ry), d.vec2f(left, ry)),
      );
      distance = std.min(distance, flare);
    }
    distance = notchEdge(p, distance, size.x * 0.5, innerOrigin.y, top, 1, into);
    distance = notchEdge(p, distance, size.x * 0.5, innerBottom, bottom, -1, into);
    return distance;
  })
  .$name('sdNotch');
export const notchEdge = tgpu
  .fn(
    [d.vec2f, d.f32, d.f32, d.f32, d.vec4f, d.f32, d.f32],
    d.f32,
  )((p, distance, cx, baseY, m, dir, into) => {
    let result = distance;
    const w = m.y;
    const h = m.z;
    if (m.x > 0.5 && w > 0.001 && h > 0.001) {
      const halfW = w * 0.5;
      const q = d.vec2f(p.x, (p.y - baseY) * dir);
      if (m.x < 1.5) {
        const diskR = std.min(halfW, h);
        const diskY = h - diskR;
        const disk = std.max(std.length(std.sub(q, d.vec2f(cx, diskY))) - diskR, diskY - q.y);
        let hollow = disk;
        if (diskY > 0.001) {
          hollow = std.min(
            sdShapedRect(
              q,
              d.vec2f(cx - halfW, 0),
              d.vec2f(w, diskY),
              d.vec4f(0, 0, 0, 0),
              d.vec4f(1, 1, 1, 1),
            ),
            disk,
          );
        }
        result = smax(distance, -hollow, std.max(m.w, 0.001));
      } else if (m.x < 2.5) {
        const rb = (halfW * halfW + h * h) / std.max(2 * h, 0.001);
        const cap = std.max(
          std.max(std.length(std.sub(q, d.vec2f(cx, rb - h))) - rb, q.y - into),
          std.abs(q.x - cx) - halfW,
        );
        result = smin(distance, cap, std.max(m.w, 0.001));
      } else if (m.x < 3.5) {
        result = smax(
          distance,
          -sdTriangle(q, d.vec2f(cx - halfW, 0), d.vec2f(cx, h), d.vec2f(cx + halfW, 0)),
          1.5,
        );
      } else {
        const spread = (halfW * (h + into)) / h;
        const peak = std.max(
          sdTriangle(q, d.vec2f(cx - spread, into), d.vec2f(cx, -h), d.vec2f(cx + spread, into)),
          std.abs(q.x - cx) - halfW,
        );
        result = smin(distance, peak, 1.5);
      }
    }
    return result;
  })
  .$name('notchEdge');
/** Distance normalized by the gradient length, so edge coverage and border widths stay even. */
export const superellipse = tgpu
  .fn(
    [d.vec2f, d.f32, d.f32],
    d.f32,
  )((v, r, n) => {
    const e = std.pow(2, std.min(std.abs(n), 5));
    const t = std.max(std.div(v, std.max(r, 0.001)), d.vec2f(0.000001, 0.000001));
    const m = std.max(t.x, t.y);
    const u = std.div(t, m);
    const norm = m * std.pow(std.pow(u.x, e) + std.pow(u.y, e), 1 / e);
    const grad = d.vec2f(
      std.pow(std.min(t.x / norm, 1), e - 1),
      std.pow(std.min(t.y / norm, 1), e - 1),
    );
    return ((norm - 1) * r) / std.max(std.length(grad), 0.0001);
  })
  .$name('superellipse');
export const quarterEllipseSdf = tgpu
  .fn(
    [d.vec2f, d.vec2f],
    d.f32,
  )((point, radii) => {
    const safe = std.max(radii, d.vec2f(0.001, 0.001));
    return (std.length(std.div(point, safe)) - 1) * (safe.x + safe.y) * -0.5;
  })
  .$name('quarterEllipseSdf');
/** Gaussian error function (Abramowitz and Stegun 7.1.26), for analytic box shadows. */
export const erf = tgpu
  .fn(
    [d.f32],
    d.f32,
  )((x) => {
    const a = std.abs(x);
    const t = 1 / (1 + 0.3275911 * a);
    const y =
      1 -
      ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
        t *
        std.exp(-a * a);
    return std.sign(x) * y;
  })
  .$name('erf');
/** Rounded screen-space clip; the low bit of clips enables it. */
export const clipCoverage = tgpu
  .fn(
    [d.vec2f, d.vec4f, d.vec4f, d.f32, d.f32],
    d.f32,
  )((p, bounds, radii, clips, n) => {
    let alpha = d.f32(1);
    if (clips - 2 * std.floor(clips * 0.5) > 0.5) {
      alpha =
        1 -
        std.smoothstep(
          -0.75,
          0.75,
          sdShapedRect(p, bounds.xy, bounds.zw, radii, d.vec4f(n, n, n, n)),
        );
    }
    return alpha;
  })
  .$name('clipCoverage');
/** Local rounded clip, used when an affine transform rotates or scales the parent. */
export const localClipCoverage = tgpu
  .fn(
    [d.vec2f, d.vec4f, d.vec4f, d.f32, d.f32, d.f32],
    d.f32,
  )((p, bounds, radii, clips, n, aa) => {
    let alpha = d.f32(1);
    if (clips > 1.5) {
      alpha =
        1 -
        std.smoothstep(-aa, aa, sdShapedRect(p, bounds.xy, bounds.zw, radii, d.vec4f(n, n, n, n)));
    }
    return alpha;
  })
  .$name('localClipCoverage');
export const fadeCoverage = tgpu
  .fn(
    [d.vec2f, d.vec4f, d.vec4f],
    d.f32,
  )((p, bounds, fade) => {
    let alpha = d.f32(1);
    if (fade.x > 0) {
      alpha *= std.clamp((p.y - bounds.y) / fade.x, 0, 1);
    }
    if (fade.y > 0) {
      alpha *= std.clamp((bounds.x + bounds.z - p.x) / fade.y, 0, 1);
    }
    if (fade.z > 0) {
      alpha *= std.clamp((bounds.y + bounds.w - p.y) / fade.z, 0, 1);
    }
    if (fade.w > 0) {
      alpha *= std.clamp((p.x - bounds.x) / fade.w, 0, 1);
    }
    return alpha;
  })
  .$name('fadeCoverage');
/** Half a device pixel in local coordinates; evaluate before discarding fragments. */
export const halfPixel = tgpu
  .fn(
    [d.vec2f],
    d.f32,
  )((p) => {
    return 0.25 * (std.length(std.dpdx(p)) + std.length(std.dpdy(p)));
  })
  .$name('halfPixel');
