import { tgpu, d, std } from 'typegpu';

export const hash = tgpu
  .fn(
    [d.vec2f],
    d.f32,
  )((p) => {
    return std.fract(std.sin(std.dot(p, d.vec2f(127.1, 311.7))) * 43758.5453123);
  })
  .$name('hash');
export const noise = tgpu
  .fn(
    [d.vec2f],
    d.f32,
  )((p) => {
    const i = std.floor(p);
    const f = std.fract(p);
    const u = std.mul(std.mul(f, f), std.sub(d.vec2f(3), std.mul(2, f)));
    return std.mix(
      std.mix(hash(i), hash(std.add(i, d.vec2f(1, 0))), u.x),
      std.mix(hash(std.add(i, d.vec2f(0, 1))), hash(std.add(i, d.vec2f(1, 1))), u.x),
      u.y,
    );
  })
  .$name('noise');
export const rimLine = tgpu
  .fn(
    [d.f32, d.f32],
    d.f32,
  )((inner, width) => {
    return std.smoothstep(0, width * 0.3, inner) * (1 - std.smoothstep(width, width * 1.5, inner));
  })
  .$name('rimLine');
/** Curved refraction falloff confined to the bevel width. */
export const rimLens = tgpu
  .fn(
    [d.f32, d.f32],
    d.f32,
  )((inner, rim) => {
    const bevel = 1 - std.clamp(inner / rim, 0, 1);
    return bevel * bevel;
  })
  .$name('rimLens');
/** Neutral light field for a transparent target, where the desktop cannot be sampled. */
export const glassEnvironment = tgpu
  .fn(
    [d.vec2f],
    d.f32,
  )((p) => {
    const direction = std.dot(p, d.vec2f(0.55, 0.83));
    const broad = 0.5 + 0.5 * std.sin(direction * 7 + 0.8);
    const streak = 0.5 + 0.5 * std.sin(direction * 18 - 1.2);
    return 0.25 + broad * broad * 0.55 + std.pow(streak, 6) * 0.2;
  })
  .$name('glassEnvironment');
