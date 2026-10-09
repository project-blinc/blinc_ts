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

The native window host pumps bounded event batches and draws when dirty. GPU surfaces
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

The typed style covers the CSS box model: sizes with min/max constraints,
margin, padding and border per side, position and inset, display (flex, grid,
block or none), flex direction, wrap, grow, shrink and basis, every alignment
(`align`, `alignSelf`, `alignContent`, `justify`, `justifyItems`,
`justifySelf`), gaps per axis, `order`, `aspectRatio`, overflow per axis, and
grid templates and placement written as CSS text. Lengths are pixels,
percentages such as `'50%'`, or `'auto'`. Border widths take layout space, as
in CSS. Use `LayoutDirection`, `LayoutAlign`, `LayoutJustify` and `LayoutOverflow` for
categorical styles, for example `align: LayoutAlign.Center`. These constants are
numbers generated for TypeScript and Rust from `native/api/layout.rs` through
x-idl. Native calls validate numeric enum values without allocating or comparing
strings; loading checks the schema fingerprint. Unknown codes, fractions and
non-finite values are rejected before edits are applied. Size values still accept
numbers, percentages such as `'100%'`, and `'auto'`.
`setStyle` merges fields, and null on a box-model field restores a new node's
value. Beyond the original flex fields, a style is written through blinc_abi's
property router, the same native path a CSS cascade writes through. Code that
works with CSS names can call `node.setLayoutProperty('margin', '8px auto')`, or
`node.setProperty(LayoutProperty.Width, 120)` with a router id. These writes are
queued: writes in one tick coalesce, the last write to a field wins, and the
queue is submitted as one native edit at the end of the tick, or earlier when
the layout is computed, read or otherwise edited. `layout.flush()` submits it
at once.

`setChildren` replaces a node's children, reordering or reparenting existing
nodes. For keyed list updates, `insertBefore(child, before)`, `append(child)`,
`removeChild(child)` and `detach()` each make one native edit without
resubmitting the siblings. A removed or detached child stays valid and can be
placed again. `remove()` deletes a node and its descendants. Handles are checked for context and
generation, and cyclic or duplicate-child edits are rejected atomically.

Compute again after edits before reading bounds. `readBounds` accepts a reusable
`Float32Array`, including subarray views, and fills four numbers per node in one
native call. Shared, detached and undersized storage is rejected. No native
pointer escapes to JavaScript. Layout contexts use `blinc_abi` without its
HashLink feature; the Node addon does not link the HashLink runtime.

`tests/native-layout.mjs` covers geometry, edits, invalid handles/buffers and HMR
scope disposal against the compiled addon. `tests/native-box-model.mjs` covers
the box model, the property router and the child operations.

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

`setText` merges text metrics and invalidates layout. `setPaint` merges background brushes, radius, border, shadow, visibility, opacity,
affine transforms, filters and gradient masks;
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
`SceneRenderer` renders these effects with the TypeGPU passes described below.

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
thousands of rendered glyph pixels against their native atlas samples. That probe covers only the native adapter. `tests/native-renderer.mjs` exercises
the actual scene renderer, including clipping, blur, glass dispersion, atlas
updates and deterministic captures at both 1× and 2×. `tests/native-layers.mjs`
checks nested opacity, filters, drop shadows, transformed gradient masks and
backdrops within layers, including clearing effects and resizing targets.

## Drawing a scene

`SceneRenderer` draws an owned layout into a texture view or window surface.
The host keeps its device and renderer alive between frames. Recompute layout
after layout or text edits; paint-only updates need only another draw.

```ts
import { SceneRenderer } from 'blinc_ts/native/renderer';

// device, scene and root belong to the host; target is its texture/surface view.
const renderer = new SceneRenderer(device, scene, targetFormat);
const encoder = device.encoder();
try {
  const stats = renderer.encode(encoder, root, target, {
    width: 1280,
    height: 720,
    scale: 2, // A 640 × 360 logical viewport.
  });
  encoder.submit(device.queue());
} finally {
  encoder.destroy();
}
// On host teardown: renderer.dispose(), then release the layout and device.
```

The renderer batches consecutive primitives in paint order, retains its GPU
buffers and textures, and uploads only changed glyph rectangles. Image slots
are packed into one growing atlas; call
`renderer.setImage(slot, image, pixelWidth, pixelHeight, ImageFit.Contain)`
before drawing a registered image brush. The atlas preserves entries when it
grows, up to 4096 × 4096; an individual entry must leave room for its one-pixel gap.

Backdrops use two Gaussian passes over the accumulated content in the current layer. Liquid glass
adds refraction, tint, grain and adjustable chromatic separation. Rounded and
shaped boxes, gradients, borders, analytic shadows, clipping, text and RGBA images
use the same packed records. Set `cornerShape: 2` in render options for squircle
smoothing, with `smoothingThreshold` and `fullRadius` controlling which corners
remain circular. Fill, border, shadow, child clipping and glass refraction all
follow the resolved corner shape. The output is premultiplied RGBA; use an unorm target
without automatic sRGB encoding.

For snapshots, `OffscreenRenderer.captureCommandsInto(pixels, callback)` supplies
an encoder and target view; return `renderer.encode(...).drawCalls` from the
callback. It handles submission and readback. Submit each encoded frame before
encoding another, since the renderer reuses its upload buffers.

Groups with opacity are composited once after their children, so overlapping
children do not become individually translucent. Filters and masks also operate
on the complete group:

```ts
card.setPaint({
  opacity: 0.85,
  filter: {
    brightness: 1.1,
    blur: 1.5,
    dropShadow: { x: 0, y: 6, blur: 12, color: [0, 0, 0, 0.35] },
  },
  maskImage: Brush.linear(0, 0, 1, 0, true)
    .stop(0, 0xffffff, 0)
    .stop(0.25, 0xffffff, 1)
    .stop(1, 0xffffff, 1),
});
card.setPaint({ filter: null, maskImage: null }); // Preserve the other paint fields.
```

A filter value replaces the previous filter; omitted members use identity values.
Supported fields are brightness, contrast, grayscale, hueRotate (degrees), invert,
saturate, sepia, blur and dropShadow. Masks take the alpha of a linear or radial
Brush gradient in the element's transformed box. As with displayed gradients,
the current record format samples the first, middle and last stops.
Content textures are pooled by nesting depth; sequential blur and shadow passes
share scratch textures, allocated only when needed.

Full-render benchmarks remain in progress. CSS, themes
and the component layer are separate work. See [shader authoring](shaders.md) for
the TypeScript sources and their build path.

## Native scene windows

`NativeWindowHost` keeps the window, surface and GPU device alive while scenes are
replaced. Await `ready`, build an owned layout, then attach its root:

```ts
import { Brush, loadNative } from 'blinc_ts/native';
import { NativeWindowHost } from 'blinc_ts/native/window';

const native = loadNative();
const host = new NativeWindowHost(native, { title: 'Hello', width: 640, height: 360 });
await host.ready;
const layout = native.createLayout();
const root = layout.createNode({ width: '100%', height: '100%', padding: 24 });
root.setPaint({ background: Brush.solid(0x142535), textColor: [1, 1, 1, 1] });
root.setChildren([layout.createText('Native pixels', { fontSize: 28 })]);
const renderer = host.attachScene(layout, root, { cornerShape: 2 });
// renderer.setImage(...) and renderer.registerCanvas(...) use this same device.
// On teardown: host.dispose(); layout.dispose();
```

The window supplies physical target dimensions and display scale. Layout uses
logical pixels; glyphs rasterize at the actual display scale. Surface formats
prefer BGRA8/RGBA8 unorm to avoid encoding UI colors twice. A transparent window
requires a surface supporting premultiplied alpha. Unsupported formats fail
explicitly during initialization. Local execution is verified on macOS/Metal.

Successful node edits automatically request a frame. Synchronous edits coalesce;
paint-only edits skip layout, while geometry/text changes and viewport changes
recompute it. `Layout.onChange` exposes `'paint'`, `'layout'` and `'disposed'`
notifications for other hosts. Failed native edits emit nothing. Unattached node
creation does not trigger a frame; attaching it to the tree does.

The GPU device requests the memory-saving allocation policy for small UI textures.
Shader construction handles are released after pipelines are built.

The host draws only when dirty. Hidden, minimized or occluded windows defer work;
a temporarily unavailable surface is retried on a later event pump. The pump
processes at most 64 events per turn and leaves Node free to run timers and Vite.
On macOS, xwindow waits on the main thread while a helper watches Node's I/O
readiness; timers and async completions interrupt that wait. Quiet windows have
no repeating event-poll timer. Other native backends currently retain the 16 ms
fallback pump. New edit bursts wake immediately; continuous painting yields
between frames and lets FIFO pace the GPU. A temporarily unavailable surface
uses a bounded retry while a visible frame is still pending.
Call `host.requestFrame()` for changes outside the layout, such as canvas buffers
or image uploads. Requests made during painting survive for the next frame.
`host.frames` counts successful presentations and `host.stats` reports the last
scene render. `host.render()` attempts a pending frame synchronously. An encoding
or presentation failure releases the host and is available through `host.error`.

The shared xwindow backend's external pump also passes the Linux NUC's
GNOME 50.1 Wayland desktop suite: idle blocking, proxy wakes, input routing,
clipboard and frame-paced redraws. Linux Node/libuv integration remains
unvalidated, so the TypeScript host still uses the fallback there.

`host.onEvent(listener, scope?)` exposes native input; pointer coordinates are
physical pixels, so divide by `host.window.scaleFactor()` for layout hit testing.
The SDK does not prescribe a component event system here. The UI example disables
raw device events with `Window.listenDeviceEvents(DeviceEvents.Never)`; normal
window pointer and keyboard events still arrive. Await `host.closed` for shutdown
instead of checking `host.disposed` on a repeating timer.

`attachScene(layout, root, options, scope?)` owns the returned renderer. Replacing
or detaching the scene disposes its renderer; the layout remains caller-owned.
A supplied `Scope` releases it during HMR while retaining the last presented
frame until the replacement attaches, avoiding a blank flash during module
evaluation. Stale cleanup cannot detach the replacement. Disposing the layout also detaches it. See the
[native example](../examples/native/app.ts) and [HMR setup](tooling.md).

`tests/native-scene-window.mjs` verifies real presentation, resize, idle behavior,
paint/layout invalidation and replacement, and captures the same demo offscreen.
`tests/native-hmr.mjs` verifies scene replacement through actual Vite updates while
the window and device survive. The lower-level `NativeProbeHost` uses the same
surface lifecycle for the GPU smoke test.

## Host interface for frameworks

`blinc_ts/native/host` is the layer a framework renders through: a JSX
runtime, a Vue custom renderer, a Solid or Svelte renderer, or a hand-written
DSL. It follows the DOM operations those renderers already target, and it
knows nothing about any framework.

```ts
import { loadNative } from 'blinc_ts/native';
import { Host } from 'blinc_ts/native/host';

const host = Host.create(loadNative(), scope);
const button = host.createElement('button');
button.setProperty('padding', '6px 12px');
button.setProperty('background', '#3d7eff');
button.appendChild(host.createTextNode('Save'));
button.addEventListener('click', () => save());
host.root.appendChild(button);
host.mount(windowHost, { scope });
```

- **Nodes.** `createElement(tag)` makes an element; `builtinTags` lists the
  built-in names, and other valid names make plain boxes. `createTextNode`
  makes text, and `createComment` makes a placeholder that takes no space.
  Empty text nodes take no space either, so renderers can use them as anchors.
- **Tree.** `insertBefore`, `appendChild`, `removeChild` and `remove` keep
  `parentNode`, `firstChild`, `nextSibling` and the other links, and each makes
  one native edit. A removed node can be inserted again. `destroy()` releases a
  node and its subtree, with their listeners and bindings.
- **Properties.** `setProperty(name, value)` takes a CSS property name. Layout
  properties go through the property router, paint properties (`background`,
  `color`, `opacity`, `border-radius`, `border-color`, `visibility`) set the
  node's paint, and text properties (`font-size`, `font-family`, `font-weight`,
  `font-style`, `line-height`, `letter-spacing`, `white-space`) are inherited
  by the text nodes inside. Numbers are pixels, and null restores the default.
  The `style` attribute is parsed the same way.
- **Attributes.** `setAttribute`, `id` and `classList` are kept on the node for
  the CSS cascade.
- **Events.** `addEventListener` and `removeEventListener` take `capture`,
  `once`, `passive` and `signal`. `dispatchEvent` runs the capture, target and
  bubble phases. `host.dispatchPointer` sends a pointer event to the element
  under a point, and a press and release over one element also send `click`.
  A mounted host routes the window's pointer and wheel input this way.
- **Reading back.** `node.bounds()` lays out if an edit is pending and returns
  absolute bounds. `host.elementAt(x, y)` hit-tests.
- **Batching.** Writes in one tick coalesce: paint and text per node, and layout
  properties in one native edit. Text equal to what a node already shows is not
  sent again. `host.flush()` submits at once.

The host does not need the SDK's reactive graph, since Vue and Solid bring their
own. `element.bindProperty(name, signal, context)` is an optional fast path
that keeps a property equal to an SDK signal without the framework handling
each change.

Two reference adapters live outside the SDK, in `adapters/`: a JSX runtime for
TypeScript's `react-jsx` transform and a Vue custom renderer built on
`createRenderer` from `@vue/runtime-core`. Both render the same scene, and
`npm run test:adapters` checks that their trees, pixels and event order match.

## GPU canvases

A canvas inserts synchronous custom drawing into the scene's paint order. It
inherits transforms, clips, group opacity, filters and masks. Create a pipeline
once, then register a callback for the node's canvas slot:

```ts
// shader is compiled by TypeGPU; see the canvas shader example in shaders.md.
const program = renderer.createCanvasPipeline(shader, [], scope);
const node = scene.createNode({ width: 320, height: 180 });
node.setPaint({ radius: [24, 24, 24, 24] });
node.setResource(0, true);
renderer.registerCanvas(
  0,
  (frame) => {
    frame.draw(program);
  },
  scope,
);
// Attach node to the scene and compute layout before rendering.
```

`frame.width` and `height` are the local content size. `transform` maps content
coordinates into the scene; `pixelRatio` is the target scale, and `scale` also
includes the transform's determinant. `scissor` is the clipped rectangle in target
pixels. The frame and its tuples are borrowed for the callback; copy values you
need to retain. Invisible, singular and unregistered canvases are skipped.

The renderer sets a rectangular GPU scissor. Use
[`canvasVertex` and `canvasClip`](shaders.md#canvas-shaders) for exact rounded and
shaped clipping, fades and inherited opacity. Canvas output uses straight alpha
blending into the renderer's RGBA8 unorm layer, exposed by `frame.format`.

For custom resources, pass additional bind group layouts to
`createCanvasPipeline`. Shared frame/record data occupies group 0 and renderer
textures occupy group 1; your groups start at 2. Inside the callback, call
`frame.bind(program)`, set your groups through `frame.encoder`, then
`frame.draw(program)`. Upload reusable buffers before encoding the scene.

Use `frame.suspend(encoder => { ... })` for auxiliary compute/render passes into
your own targets. End every auxiliary render pass before returning. The renderer
resumes the same UI layer with its content and scissor preserved; bind pipelines
and resources again before drawing. Frame drawing methods are unavailable during
the suspension. Callbacks must be synchronous and must not reenter or dispose the
renderer while it is encoding.

`frame.draw` counts its draws automatically. Return the number of any raw draws
from the paint or suspension callback so `SceneRenderStats.drawCalls` includes
them; `canvasCalls` counts invoked paint callbacks. The host submits the encoder.

The optional `Scope` removes callbacks and disposes pipelines during HMR. Stale
cleanup cannot remove a newer registration for the same slot. Without a scope,
use the function returned by `registerCanvas` to unregister, and call
`program.dispose()` when finished. Disposing the renderer releases its remaining
pipelines. Caller-created buffers, bind groups and extra layouts remain caller-owned.

`tests/native-canvas.mjs` checks paint order, transformed clipping, layers,
state restoration, suspension, callback failures and replacement/disposal, with
independent reference captures at 1× and 2×.

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
