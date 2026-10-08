import { tgpu, d, std } from 'typegpu';
import { sceneSchema } from '../src/native/scene.js';

// Adapter fixture: consume the ABI records directly. This is not the full UI renderer.
// Fixtures use solid rectangles, mask glyphs and one image; effects require the renderer.
const scene = tgpu
  .bindGroupLayout({
    viewport: { uniform: d.vec4f },
    records: { storage: d.arrayOf(d.vec4f), access: 'readonly' },
    atlas: { texture: d.texture2d() },
    image: { texture: d.texture2d() },
  })
  .$idx(0);
const vertex = tgpu
  .vertexFn({
    in: { vertexIndex: d.builtin.vertexIndex, instanceIndex: d.builtin.instanceIndex },
    out: { position: d.builtin.position, uv: d.vec2f, color: d.vec4f, rect: d.vec4f, kind: d.f32 },
  })((input) => {
    const offset = input.instanceIndex * sceneSchema.recordRows;
    const corner = input.vertexIndex;
    const uv = d.vec2f(
      d.f32(corner === 1 || corner === 4 || corner === 5),
      d.f32(corner === 2 || corner === 3 || corner === 5),
    );
    const box = scene.$.records[offset]!;
    const affine = scene.$.records[offset + 15]!;
    const local = std.mul(uv, box.zw);
    const pixel = d.vec2f(
      box.x + affine.x * local.x + affine.z * local.y,
      box.y + affine.y * local.x + affine.w * local.y,
    );
    return {
      position: d.vec4f(
        (pixel.x / scene.$.viewport.x) * 2 - 1,
        1 - (pixel.y / scene.$.viewport.y) * 2,
        0,
        1,
      ),
      uv,
      color: scene.$.records[offset + 2]!,
      rect: scene.$.records[offset + 10]!,
      kind: scene.$.records[offset + 11]!.x,
    };
  })
  .$name('sceneProbeVertex');
const fragment = tgpu
  .fragmentFn({
    in: { uv: d.vec2f, color: d.vec4f, rect: d.vec4f, kind: d.f32 },
    out: d.vec4f,
  })((input) => {
    if (input.kind === 7) {
      const texel = d.vec2i(std.mix(input.rect.xy, input.rect.zw, input.uv));
      const coverage = std.textureLoad(scene.$.atlas, texel, 0).x;
      // Same thin-stroke coverage correction as the native text rendering reference.
      return d.vec4f(input.color.rgb, input.color.a * std.pow(coverage, 0.7));
    }
    if (input.kind === 32) {
      const texel = d.vec2i(std.mul(input.uv, d.vec2f(std.textureDimensions(scene.$.image))));
      return std.textureLoad(scene.$.image, texel, 0);
    }
    return input.color;
  })
  .$name('sceneProbeFragment');
export function compileSceneProbeShader() {
  const code = tgpu.resolve([vertex, fragment]);
  const vertexEntryPoint = /@vertex\s+fn\s+(\w+)/.exec(code)?.[1];
  const fragmentEntryPoint = /@fragment\s+fn\s+(\w+)/.exec(code)?.[1];
  if (!vertexEntryPoint || !fragmentEntryPoint) {
    throw new Error('Missing scene probe shader entries');
  }
  return { code, vertexEntryPoint, fragmentEntryPoint, vertexCount: 6, alphaBlend: true };
}
