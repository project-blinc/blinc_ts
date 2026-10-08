# Shaders in TypeScript

Shader logic is authored as TypeScript functions using TypeGPU. Vite's TypeGPU
plugin compiles those functions to WGSL; application code never assembles shader
source strings.

```ts
import { tgpu, d, std } from 'typegpu';

const rimLens = tgpu.fn(
  [d.f32, d.f32],
  d.f32,
)((inner, rim) => {
  const bend = 1 - std.clamp(inner / rim, 0, 1);
  return bend * bend;
});
```

`d` provides GPU data types and constructors. `std` provides vector arithmetic,
shader math, derivatives and texture reads. Scalar expressions use ordinary
TypeScript operators; vector expressions use functions such as `std.add` and
`std.mul`. Initialize mutable floating-point accumulators with `d.f32(0)` so
an integer-looking zero does not establish an integer GPU variable. Copy a
vector with `d.vec4f(value)` when it must be independently mutable.

The renderer's shader sources are organized by purpose:

- [SDF and coverage](../shaders/ui/sdf.ts): rounded and shaped corners, notches,
  clips, fades and analytic shadow math.
- [Fills and borders](../shaders/ui/fills.ts), used by the
  [box pass](../shaders/ui/box.ts).
- [Text](../shaders/ui/text.ts) and [images](../shaders/ui/image.ts): shared
  clipping, mask/color glyph atlases and the image atlas.
- [Layers](../shaders/ui/layer.ts): group opacity, color filters and gradient masks,
  with paired Gaussian passes for blur and alpha drop shadows.
- [Backdrop](../shaders/ui/backdrop.ts), [row blur](../shaders/ui/backdropRows.ts)
  and [glass math](../shaders/ui/glass.ts): separable blur, refraction and dispersion.

`field(record, fields.bounds)` reads a named row of the native display list.
Each shader loads only the rows it uses. A flat record index and the local/screen
position cross the vertex-to-fragment boundary; the whole record is not copied
through interpolators.

Run `npm run build:shaders` to generate WGSL and entry-point metadata. Generated
files under `src/renderer/generated` are build outputs. `npm run check` checks the
TypeScript sources; after `npm run build:native && npm run build`, run
`node tests/native-renderer.mjs` for native GPU captures and pixel assertions.
