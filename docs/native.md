# Native development

The Node addon binds xgpu and xwindow through x-idl's shared API model.
It uses their existing native backend templates; it does not maintain a second
copy of those APIs.

## Contributor setup

During development, place these repositories beside one another:

```text
workspace/
  blinc_ts/
  blinc_abi/
  x-idl/
  xgpu/
  xwindow/
```

Use the x-idl revision containing the Node target and `xidl-node` runtime.
The local Cargo patch makes both backends use that generator. Native contributor
builds require a Rust toolchain and each backend's platform dependencies.

From `blinc_ts`:

```sh
npm ci
npm run build:native
npm run build
npm run test:native
npm run dev:native
```

The native build defaults to an optimized release addon. Use
`npm run build:native -- --debug` for native debugging. It regenerates and formats
the checked-in TypeScript bindings, then stages `native/blinc_ts.node`.

Prebuilt npm distribution is still pending. These commands are contributor
instructions; the package is not yet a published SDK installation.

## Binding contracts

- Numeric operation dispatch and schema-specific descriptor conversion.
- Opaque resources validated by the owning binding and by native type.
- Native handles and 64-bit values use `bigint`.
- Synchronous byte views are borrowed without a data copy. Retained buffers
  become owned before asynchronous work.
- Futures settle on the owning JavaScript thread; callbacks never execute
  from native workers.
- Shared/detached byte buffers, reentrant native calls and worker access are
  rejected.
- Generated TypeScript and native code exchange a schema fingerprint at load.
  Rebuild both when the native API changes.

The probe host pumps bounded event batches and draws when dirty. GPU surfaces
are destroyed before their windows. macOS/Metal is verified locally; Windows
and Linux execution still require platform validation.

## Owned layout trees

`createLayout(scope)` creates a native Blinc layout context. The optional mounted
UI `Scope` disposes it during HMR; otherwise call `dispose()` explicitly.

```ts
import { LayoutAlign, LayoutDirection, loadNative } from 'blinc_ts/native';

const layout = loadNative().createLayout();
try {
  const root = layout.createNode({
    width: '100%',
    height: '100%',
    gap: 12,
    padding: 16,
    direction: LayoutDirection.Row,
    align: LayoutAlign.Stretch,
  });
  const sidebar = layout.createNode({ width: 180, shrink: 0 });
  const content = layout.createNode({ grow: 1 });
  root.setChildren([sidebar, content]);
  layout.compute(root, 960, 640);

  const bounds = new Float32Array(8);
  layout.readBounds([sidebar, content], bounds);
  // Absolute x, y, width, height for each node, in logical pixels.
} finally {
  layout.dispose();
}
```

Styles currently cover flex direction, alignment, justification, grow/shrink,
gaps, uniform padding, overflow and pixel/percentage/auto sizes with min/max constraints.
Use `LayoutDirection`, `LayoutAlign`, `LayoutJustify` and `LayoutOverflow` for
categorical styles, for example `align: LayoutAlign.Center`. These constants are
numbers generated for TypeScript and Rust from `native/api/layout.rs` through
x-idl. Native calls validate numeric enum values without allocating or comparing
strings; loading checks the schema fingerprint. Unknown codes, fractions and
non-finite values are rejected before edits are applied. Size values still accept
numbers, percentages such as `'100%'`, and `'auto'`.
`setStyle` merges fields. `setChildren` reorders or reparents existing nodes;
removing a node removes its descendants. Handles are checked for context and
generation, and cyclic or duplicate-child edits are rejected atomically.

Compute again after edits before reading bounds. `readBounds` accepts a reusable
`Float32Array`, including subarray views, and fills four numbers per node in one
native call. Shared, detached and undersized storage is rejected. No native
pointer escapes to JavaScript. Layout contexts use `blinc_abi` without its
HashLink feature; the Node addon does not link the HashLink runtime.

`tests/native-layout.mjs` covers geometry, edits, invalid handles/buffers and HMR
scope disposal against the compiled addon.

## Owned scenes and images

The same `Layout` owns text and paint properties. Encoding reuses the native
paint walk, text measurement, glyph atlases and hit testing.

```ts
import { Brush, LayoutDirection, loadNative } from 'blinc_ts/native';

const native = loadNative();
const scene = native.createLayout(); // Pass a mounted Scope for HMR cleanup.
try {
  const root = scene.createNode({
    width: 360,
    height: 180,
    padding: 20,
    direction: LayoutDirection.Column,
  });
  root.setPaint({ background: Brush.solid(0x0d141f) });
  const label = scene.createText('Native scenes', { fontSize: 26, fontWeight: 600 });
  label.setPaint({ textColor: [0.9, 0.95, 1, 1] });
  root.setChildren([label]);
  scene.compute(root, 360, 180);

  const info = scene.prepareDisplayList(root, { scale: 1 });
  const records = new Float32Array(info.floats);
  scene.readDisplayList(records); // Renderer-owned upload storage; reuse on later frames.
  const hits = scene.hitTest(root, 24, 28); // nodeId matches LayoutNode.id.
} finally {
  scene.dispose();
}
```

`setText` merges text metrics and invalidates layout. `setPaint` merges background brushes, radius, border, shadow, visibility, opacity
and affine transform fields;
`clearPaint` resets them. Child order determines paint order. Colors are
straight-alpha RGBA in 0..1, and sizes are logical pixels. `setVisual` supplies
layout-animation offsets and optional drawn sizes; `setPointerEvents` and
`setScroll` affect hit testing through the shared engine. Clear a visual override
with `setVisual(null)`.

Compute after layout/text edits, then prepare once and copy the display list.
Paint edits also invalidate prepared records. `sceneSchema` describes the wire
version and record size; `loadNative()` rejects an incompatible producer before
rendering. `info.count` counts primitives, while `info.floats` also includes any
trailing polygon data. This API produces renderer input; the complete UI renderer
is still in progress.

Backgrounds are Blinc `Brush` values. Constructors follow the existing brush
model, including effects:

```ts
const solid = Brush.solid(0x243244);
const gradient = Brush.linear(0, 0, 1, 1, true).stop(0, 0x4488ff).stop(1, 0x44ddcc);
const radial = Brush.radial(0.5, 0.5, 0.5, true).stop(0, 0xffffff).stop(1, 0x4488ff);
const frost = Brush.blur(12, 0xffffff, 0.08);
const glass = Brush.glass(2, 0xffffff, 0.1, {
  aberration: 0.3,
  bevel: 0.2,
  inset: true,
});
label.setPaint({ background: glass });
```

Brushes construct native Blinc values once per context and reuse them on
assignment. Gradient stops are added before assignment. The current shared
encoder represents the first, middle and last stops; additional-stop and conic
rendering remain renderer work. Glass carries blur, tint, noise, saturation,
brightness, border and liquid rim settings through the existing backdrop records.
The offscreen probe does not render those effects yet.

`Brush.image(source, ImageFit.Contain)` retains Blinc's image source/fit model.
The host registers a prepared image with
`scene.setImageSource(source, ImageFit.Contain, slot)` before encoding, and removes
it with a null slot. Asset loading and GPU uploads belong to the renderer.

Glyph atlas uploads use `atlasInfo(color, seenRevision)` and
`readAtlas(color, seenRevision, target)`. `false` selects one-byte glyph masks;
`true` selects RGBA color glyphs. Start with revision 0. Upload the returned
rectangle, then remember its revision. Unchanged atlases return `null`; missed
history or resized atlases require a full upload. Reuse output buffers and
acknowledge the revision only after a successful upload.

`native.decodeImage(bytes, scope?)` decodes PNG, JPEG or WebP.
`native.rasterizeSvg(markup, width, height, scope?)` creates an SVG image resource.
Both expose `width`, `height`, `readPixels(target)` and
`resample(width, height, ImageFit.Contain, target)`. `ImageFit.Cover`, `Contain`
and `Fill` are numeric enums generated through x-idl. Pixels are straight RGBA;
SVG rasterization/resampling accepts integer dimensions up to 16384 per side and
64M pixels. Dispose resources explicitly or let the mounted scope release them.
`node.setResource(slot)` references an image slot owned by the renderer;
`node.setResource(slot, true)` references a canvas. Pass `null` to clear it.

`tests/native-scene.mjs` exercises native records, fonts, atlases, images, invalid
edits, buffers and disposal. `tests/native-scene-facade.mjs` tests load-time schema
rejection and HMR cleanup, then uploads real records, glyph masks and image pixels
through `OffscreenRenderer`. Its captures go to `.blinc/scene-adapter/` and compare
thousands of rendered glyph pixels against their native atlas samples. The probe
covers solid rectangles, mask text and one image; clips, effects, color glyphs
and resource batching are gates for the complete renderer.

## Reactive contexts

Each `createReactive(scope)` owns an isolated native dependency graph. Signal
values stay in JavaScript, preserving object identity and avoiding value copies
across the native boundary. Call `dispose()` when not using a mounted scope.

```ts
const graph = loadNative().createReactive();
const count = graph.signal(0);
const doubled = graph.computed(() => count.get() * 2);
const effect = graph.effect((scope) => {
  console.log(doubled.get());
  scope.onCleanup(() => {
    /* Runs before the next effect or on disposal. */
  });
});
graph.batch(() => {
  count.set(1);
  count.set(2); // One effect run after the batch, with doubled = 4.
});
effect.dispose();
graph.dispose();
```

Signals use `Object.is` equality. Computeds are lazy and cached, track dynamic
dependencies, and cannot mutate the graph. Effects run synchronously after writes
or the outer batch; writes inside an effect run in a subsequent flush wave.
Nested effects belong to the enclosing effect's scope and are cleaned up on rerun.

Use `signal.peek()` or `graph.untrack(fn)` to avoid subscribing the surrounding
computation. An untracked computed read evaluates its pure callback without
changing its tracked cache. Dependencies cannot cross contexts. Callback errors
preserve the original thrown value; other scheduled effects still run.

`tests/native-reactive.mjs` exercises these contracts against the compiled addon.
