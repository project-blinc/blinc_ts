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

- [SDF and coverage](../src/renderer/gpu/sdf.ts): rounded and shaped corners, notches,
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

## Canvas shaders

The `blinc_ts/shaders/canvas` entry exposes the renderer's TypeGPU helpers for
application shaders. Install `typegpu` and `unplugin-typegpu`, and add the latter's
Vite plugin to the application build. The helper package retains its compiled
TypeGPU metadata; your shader functions are compiled by that same plugin.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import typegpu from 'unplugin-typegpu/vite';

export default defineConfig({ plugins: [typegpu()] });
```

A six-vertex content quad already follows the canvas transform. Multiply output
alpha by `canvasClip` to preserve shape, ancestor clips, fades and opacity:

```ts
import { tgpu, d } from 'typegpu';
import { canvasVertex, canvasVaryings, canvasClip } from 'blinc_ts/shaders/canvas';

const fragment = tgpu.fragmentFn({ in: canvasVaryings, out: d.vec4f })((input) => {
  return d.vec4f(input.uv.x, input.uv.y, 0.8, canvasClip(input.record, input.pixel));
});

const code = tgpu.resolve([canvasVertex, fragment]);
const vertexEntryPoint = /@vertex\s+fn\s+(\w+)/.exec(code)?.[1];
const fragmentEntryPoint = /@fragment\s+fn\s+(\w+)/.exec(code)?.[1];
if (!vertexEntryPoint || !fragmentEntryPoint) {
  throw new Error('Missing canvas shader entry points');
}
export const shader = {
  code,
  vertexEntryPoint,
  fragmentEntryPoint,
  vertexCount: 6,
  alphaBlend: true,
};
```

Resolve once when loading the module, or emit this result during the build.
[Register the shader](native.md#gpu-canvases) with a retained native canvas pipeline.
`frame.draw` supplies the canvas record through `instanceIndex`. Custom vertex
functions can use the exported `field`, `fields`, `scene`, `placed` and
`pixelToClip` helpers, passing the record and scene position into `canvasClip`.
The [canvas probe](../shaders/canvas-probe.ts) adds a uniform in bind group 2.
