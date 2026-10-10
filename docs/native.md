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

## CSS

Stylesheets are run by blinc_abi's native CSS engine, one cascade per layout
context. `layout.addStyleSheet(source)` adds a sheet from CSS text or from
compiled bytes, last or at a position, and returns its diagnostics with line
and column; `removeStyleSheet` takes it out. `setTheme({ '--accent': '#38f' })`
sets variables `var()` falls back to after the sheets', `setColorScheme('dark')`
answers `prefers-color-scheme`, and `setRootFontSize` sets what `rem` means.
The viewport for media queries and viewport units is the size the layout is
computed at.

The host describes each element to the cascade: its tag, id, classes,
attributes, states (hover, active, focus, focus-visible, focus-within,
disabled, enabled) and its properties, which are its inline declarations.
Names cross to native code as atoms of the context's table. Text nodes are
elements too, so they inherit color and font properties. Each layout restyles
what changed, parents first: layout declarations apply through the property
router, paint declarations are read as typed values and written to the node's
paint, and text, cursor, `pointer-events` and overflow come back to the host,
which draws with them. A value that cannot be read is reported with its
reason to `host.onStyleErrors` listeners, or logged as a warning when there
are none, and the rest of its rule still applies. A property the cascade does
not know is skipped without a report.

### Paint declarations

The paint properties are read by the same engine as the sheet, so a value
means the same in a stylesheet, an inline `style` and a compiled sheet:

- `background`, `background-color` and `background-image` take a colour,
  `none`, `linear-gradient()` or `radial-gradient()` (a circle or ellipse
  reaching the farthest corner), or `glass`, whose settings are `glass-blur`,
  `glass-tint`, `glass-aberration`, `glass-bevel`, `glass-noise`,
  `glass-mode` (`liquid` or `frosted`) and `glass-curvature` (`inset` or
  `outset`). A `url()` background is reported as unsupported.
- Colours are hex, CSS's named colours, `rgb()`, `hsl()`, `color-mix(in srgb, …)`,
  `transparent` and `currentcolor`, which is the node's own `color`.
- `color`, `opacity`, `visibility`, `border-radius` (px, `em`, `rem` and
  viewport units, one to four values), `corner-shape`, `border-color`,
  `box-shadow` (outer and `inset` layers), `transform` (2D functions, about the
  node's centre), `filter` and `mask-image` (a gradient).
- `clip-path` takes `none`, `circle()`, `ellipse()`, `inset()`, `rect()`,
  `xywh()`, `polygon()` and `path()` (SVG path data, curves and arcs cut into
  short steps). The shape is in the node's own coordinates, so it turns and
  scales with the node, and it clips what the node holds and where the pointer
  reaches it. Lengths are px, `em`, `rem`, viewport units or percentages;
  `round` takes one pixel length; a radius left out, or `closest-side`, reaches
  the nearest side. `polygon()` and `path()` take `nonzero` (the default) or
  `evenodd` first. `farthest-side` and offset-style positions
  (`at right 10px bottom 20px`) are reported.
- `overflow-fade` takes `none` or one to four distances, as `margin` takes its
  sides, and fades what a clipping node (`overflow` hidden, scroll or auto)
  holds to nothing over that distance at the matching edge. Percentages are
  reported.
- `backdrop-filter` takes `none`, or `blur()` with the colour filters
  (`brightness()`, `contrast()`, `grayscale()`, `hue-rotate()`, `invert()`,
  `saturate()` and `sepia()`), applied to what is behind the box before its
  background colour is painted over it. A node with no background of its own is
  filled with the filtered backdrop; a gradient or `glass` background keeps its
  own look. `opacity()` and `drop-shadow()` are reported.
- `text-decoration` (and `-line`, `-style`, `-color`, `-thickness`, with
  `text-underline-offset`) draws `underline`, `overline` and `line-through`,
  `solid`, `double`, `dotted` or `dashed`, under every line of the node's text
  and of the text inside it. As CSS has it, a descendant's decoration is drawn
  beside its ancestors' and `none` undoes none of them; the colour is the
  text's own unless given, and a thickness or an offset the font sets is used
  when none is. `wavy`, `blink` and the error lines are reported. A later
  shorthand resets the longhands before it. The user-agent sheet underlines
  `a`, `u` and `ins`, strikes `s` and `del`, and dots `abbr[title]`.

- `border` and `border-top`, `-right`, `-bottom` and `-left` take a width
  (`thin`, `medium`, `thick` or a length), a style and a colour in any order.
  The width takes layout space, as CSS's box model does, and a style of `none`
  or `hidden` takes it away; every other style draws solid. `border-width`,
  `border-style` and `border-color` take one to four values, and
  `border-top-color` and the like set one side. `outline`, `outline-width`,
  `outline-color` and `outline-offset` draw a ring outside the border.

A node that loses a declaration gets that field's default back. Paint set
directly with `element.setProperty('background', brush)` stays over the
cascade until it is cleared with `null`.

`box-shadow` takes any mix of outer and `inset` layers, the first drawn on
top. Inset layers are cast inside the padding box, over the background and
under the border, and follow its radius and corner shape. `setPaint` takes the
same layers as `shadows`, each with `inset: true` for an inner one.

`LayoutNode.setLayoutProperty(name, value)` reads a CSS layout declaration with
the same native parser a sheet's go through.

### Transitions and animations

`transition` and `animation` (the shorthands and their longhands) move paint
and layout properties: colours, `opacity`, `border-radius`, `outline-width`
and `outline-offset`, `box-shadow`, `transform`, `filter` and same-shaped
gradients blend, and so do `clip-path` shapes of one kind (same number of
points for a polygon), a zero length taking the other end's unit, and
`overflow-fade`, edge by edge, `backdrop-filter`, its blur and its colour
filters, and `text-decoration`'s colour, thickness and offset; `visibility`, masks, other gradients and clips that do not line up flip
at the midpoint.
Colours blend premultiplied, transforms by translation, rotation (the short
way round), scale and skew, and shadow lists layer by layer. Lengths such as
`width`, `padding`, `margin`, `gap`, `top` or `flex-basis` blend when both
ends are in pixels or both in percentages, and the box is laid out at each
value between, so what follows it moves with it; `auto`, or pixels against a
percentage, flips at the midpoint, and a size never goes below zero. A
property that is not a quantity, such as `display`, is reported once.

A node's first style is not a change, so nothing runs as it appears. A change
to a transitioned property runs from the value shown, so a hover that ends
halfway turns back from where it is. `@keyframes` read their paint
declarations, with a stop's own `animation-timing-function`, and a property a
block leaves out at `from` or `to` starts or ends at the node's style. Fill
modes, delays, iteration counts, directions and `animation-play-state` work as
CSS has them. A keyframe's `var()`s read the element's values and the theme,
and a running animation follows a theme change.

Timing functions are CSS's keywords, `cubic-bezier()`, `steps()` and
`linear()`, and `spring(mass stiffness damping [velocity])`. A spring
transition runs until the spring settles, whatever duration it is given, and
one turned back mid-flight keeps its momentum: it carries on a little before
it comes round. In a `@keyframes` block a spring is fitted to its segment. The
theme's `--ease-spring` is a spring, `spring(1, 400, 30)` from
`blinc_ts/theme`.

Values are interpolated natively and written to the node, so JavaScript only
supplies the time. A mounted host ticks every frame and asks for another
while anything in view moves; with nothing moving, a frame makes no native
call. Motion out of view, outside the window or a clipping ancestor at its
scroll, keeps its clock but draws nothing and asks for no frames; layout it
moves is still written, since it moves what is in view. Seen again, it is drawn
where its clock has got to, and when it ends out of view its end is written;
`layout.motionWake` says when, and a mounted host wakes for it.
Without a window, advance the clock yourself:

```ts
element.classList.add('open');
host.compute(width, height);
host.layout.tickMotion(performance.now()); // true while anything still moves
```

`element.animateLayout(options?)` animates where layout puts the element
(`LayoutNode.animateLayout` underneath): when its place or size changes,
layout settles at once and the element is drawn where it was, then eases to
where it is, nothing laid out again for it. While its size changes it is drawn
at the size between, its children clipped to it. A move is measured against
the nearest animated element it is in, so a child carried by its parent does
not move twice, and a change mid-move starts from where it is drawn. Options
are `position` and `size` (both on), `duration` (200ms) and `easing` (the
theme's `ease-out`; a spring takes its own time); `null` stops it. Use it for
what layout moves, such as a list making room or a panel opening; a transition
of `height` lays out every frame instead.

`element.animationsFinished()` resolves when the element's transitions and
animations have ended, or at once when it has none; it restyles first, so an
attribute set just before has started its animation. That is how a component
plays an exit: set `closing`, await it, then remove the element. `attachScene`
and `mount` take `now` to run motion on another clock.

### Compile-time CSS

`blincCss()` from `blinc_ts/vite` compiles `.css` imports when the app is
built, with the same engine:

```ts
import sheet, { classes, vars } from './card.css';
layout.addStyleSheet(sheet); // loaded without parsing
element.className = classes.card;
```

The default export is the compiled sheet, and `classes`, `vars` and
`keyframes` are frozen objects of the names the sheet defines. An error fails
the build at its file, line and column. The plugin also writes
`card.d.css.ts` beside the sheet, which TypeScript reads for `./card.css` with
`allowArbitraryExtensions`, so a misspelt class name is a type error.
`compileCss(source, { file, load })` is the same compiler as a function.

## Themes

`blinc_ts/theme` gives a theme typed token sets: colours, typography,
spacing, radii, shadows, animation durations and easing curves, and the
corner shape. A `Theme` is one scheme, light or dark, and a `ThemeBundle`
pairs the two with any stylesheets that come with them. blinc_ts does not
ship a brand's palettes. Apps and add-ons supply their themes, and
`neutralTheme`, a plain grey bundle, serves tests and examples.

`ThemeState` holds the bundle in use, the scheme and any overrides in
signals of a reactive context. `attach(layout)` keeps the layout's CSS
variables, its colour scheme and its corner smoothing equal to the theme, so
a theme change restyles the nodes in place through the native cascade
rather than rebuilding them:

```ts
import { ThemeState, extendBundle, hex, neutralTheme, shapeTokens } from 'blinc_ts/theme';

const app = extendBundle(neutralTheme, {
  name: 'My app',
  radii: { default: 12 },
  shape: shapeTokens(0.4, 3.3, 12),
});
const theme = new ThemeState(native.createReactive(), app); // follows the system scheme
theme.attach(host.layout);
theme.followSystem(windowHost); // reads the window's light or dark mode and its changes

theme.setScheme('dark'); // or 'light', or 'system' again
theme.override({ colors: { primary: hex('#2563eb') } }); // kept across scheme switches
theme.setBundle(otherBundle); // clears overrides
```

Each token becomes a custom property that stylesheets read with `var()`:
colours by name (`--surface-elevated`, `--text-primary`), spacing as
`--space-4`, radii as `--radius-lg`, type as `--text-lg`, `--font-semibold`,
`--font-sans`, `--leading-normal` and `--tracking-wide`, shadows as
`--shadow-md`, motion as `--duration-normal` and `--ease-spring`, and the
corner shape as `--corner-smoothing`, `--corner-exponent`,
`--smoothing-threshold` and `--corner-n`. A sheet's own `:root` variables
stand over the theme's. `theme.theme` and `theme.variables` are computeds, so
an effect that reads a token runs again when it changes. `extendTheme` and
`extendBundle` make a variant that keeps the tokens it does not change.

### Corner shape

`ShapeTokens` turn rounded corners into squircles. `cornerSmoothing`, from 0
to 1, pulls the superellipse exponent from 2, a circle, toward
`cornerExponent`: the exponent is
`2 + (max(cornerExponent, 2) − 2) × clamp(cornerSmoothing, 0, 1)`, and the
renderer draws with `n = log2(exponent)`, kept as a fraction. Smoothing 0.4
and exponent 3.3 give an exponent of 2.52 and `n` of about 1.3334237. Only
corners of at least `smoothingThreshold` pixels are smoothed; corners near the
full radius or half the box's shorter side stay round, so circles and pills
keep their shape. Smoothing is off when `cornerSmoothing` is 0 or the
threshold is infinite, which `shapeOff` is.

The shape applies to fills, borders, outer and inset shadows, glass and the clips children
inherit, and a theme change updates all of them. A node's own `corner-shape`
wins over it: `round`, `squircle`, `bevel`, `scoop`, `notch`, `square` or
`superellipse(n)`, one to four values from the top-left corner. A round
shape is still smoothed by the theme unless it is written `round locked`.
A stylesheet can set the smoothing for the whole tree with
`:root { corner-smoothing: 0.6; corner-exponent: 4; smoothing-threshold: 12px; }`,
over the theme's. Paint options that set `cornerShape` win over both.

### Utility classes

`blinc_ts/theme/utilities` generates utility classes from the token names.
An app that does not import it pays nothing for it. Each class reads its
token through a variable, so one sheet serves every theme:

```ts
import { addUtilities, classes } from 'blinc_ts/theme/utilities';

addUtilities(host.layout); // first among the sheets, so the app's own rules win
card.className = classes('bg-surface', 'rounded-lg', 'shadow-md', 'p-4');
```

They cover colours (`bg-`, `text-` and `border-` with each colour's name),
spacing (`p-`, `px-`, `m-`, `gap-`, `w-`, `h-`, `size-` and the rest with each
step, such as `p-0.5`), radii (`rounded`, `rounded-lg`), shadows (`shadow`,
`shadow-md`, `shadow-inner`), type (`text-lg`, `font-semibold`, `font-mono`,
`leading-snug`, `tracking-wide`) and corner shapes (`corner-squircle`,
`corner-round-locked`). `classes(...)` takes only these names, so a misspelt
one is a type error, and `utilityCss()` returns the sheet as text for a build
step.

### User-agent styles

Built-in elements are flex rows with no look of their own, so a `div` lays its
children side by side and an `h1` is body text. `blinc_ts/theme/user-agent`
gives them defaults, as a browser's stylesheet gives HTML elements theirs:

```ts
import { addUserAgent } from 'blinc_ts/theme/user-agent';

addUserAgent(host.layout); // first among the sheets, so every other rule wins
```

It sets the window's ground, ink and type from the theme, stacks the flow
containers (`div`, `section`, `ul`, `form`, `pre`, …) in columns, sets the
text elements (`p`, `h1` to `h6`, `code`, `kbd`, `mark`, `a`) in a wrapping
baseline row at the browser's relative sizes, and styles quotations, rules,
tables (each row shares its width among its cells, so columns line up),
links, buttons, labels, fieldsets, text fields, checkboxes, radios, ranges,
progress bars, meters, selects and their options, dialogs, backdrops and
`details`. Everything it uses is a theme variable, so a theme change restyles
it, and it only declares what has an effect. Margins are half a browser's
because flex siblings do not collapse them.

Every change it shows eases on the theme's motion tokens: hover and press
colours over `--duration-fast` and `--ease-state`, a focus ring growing out
from no width, a press shrinking a control a little, a check mark popping in
on `--ease-spring`, a dialog growing in and, marked `[closing]`, shrinking
away on `--ease-sheet`. A control's states come from `element.setState`, and
the parts of a list item, a `summary`, a `progress` and a `meter` are made by
the host (see built-in element behaviours); those of the controls it does not
make are children the component supplies: a checkbox's `.check` and `.dash`, a
radio's `.dot`, a range's `.fill`, `.thumb` and `.rest`, and a select's
`.chevron`.

## Built-in element behaviours

Some elements do something a browser's own code does for them, which CSS does
not say. They live in `host.behaviours` and work on any host.

What a behaviour needs inside an element, a list item's marker, is an owned
element: `host.ownedElement(parent, tag, classes)` makes an element in the
native tree and the cascade, so a stylesheet styles it by its classes, that is
not among `parent.childNodes`. A framework that owns an element's children,
and replaces them whenever it renders, never sees it and never removes it. No
structural selector counts it, and it goes when its parent does.

**Lists.** Each `li` of a `ul`, `ol` or `menu` has a marker, an owned
`div.marker` that the user-agent sheet styles in the item's left padding: a
`disc`, `circle` or `square` by depth, or a number. `ol` counts from 1, from
`start`, or down with `reversed`; `type` (`1`, `a`, `A`, `i`, `I`) and the
`list-style-type` property (`none`, `disc`, `circle`, `square`, `decimal`,
`decimal-leading-zero`, `lower-alpha`, `upper-alpha`, `lower-roman`,
`upper-roman`) choose the style, on the list or on one item, and `value`
restarts the count at an item. They are kept right as items come, go and move,
as attributes and styles change, and through whatever a framework does to an
item's children. `host.behaviours.markerOf(li)` reads what a marker shows
(`1.`, `iv.`, `disc`), or null for none.

**Links.** A click on an `a` with an `href` (or Enter on it focused) that no
listener cancelled opens the URL with the system's handler, for `http:`,
`https:`, `mailto:` and `tel:`; any other scheme, and a path with no scheme,
opens nothing. `#id` scrolls to the element with that id instead. Set
`host.behaviours.opener` to receive the URL yourself. An `a` with no `href` is
not focusable.

**Labels.** A click on a `label` focuses its control, named by `for` or the
first control inside, and clicks it, unless the click was on the control
itself or the control is disabled. `HostElement.click()` is that click.

**Details.** A click on a `details`' first `summary`, or Enter or Space on it
focused, opens or closes it, setting `open` and dispatching `toggle`. The
summary has an owned `.marker`, a chevron the user-agent sheet turns as it
opens, and the sheet hides the rest of a closed `details`.

**Progress and meter.** Each has an owned `.bar` sized from `value`, `max`
(and `min`, `low`, `high`, `optimum` for a meter), kept as the attributes
change. A `progress` with no `value` is `:indeterminate`, and the sheet pulses
its bar. A meter's bar is `optimum`, `suboptimum` or `even-less-good` by which
region of the range its value falls in against the optimum's.

**Disabled fieldsets.** A `fieldset` with `disabled` disables the controls in
it: no presses, no focus and `:disabled`, including one added to it later.
`element.setState` gives the other states, `checked` and the like.

## Inline text flow

A `p`, `h1` to `h6`, `dt`, `dd`, `figcaption`, `caption`, `legend`, `li`, `th`
or `td` that holds an inline element (`a`, `strong`, `em`, `span`, `small`,
`sub`, `sup`, `abbr`, `label`, …) or a `br` lays its content out as one
paragraph: text and inline elements wrap together at its width, every line's
pieces on one baseline whatever their font, whitespace collapsing as HTML's
does. One that holds only text is a plain wrapping text, as before, and costs
nothing.

The elements keep their place in the tree, so CSS styles them, `childNodes`
lists what you built, and they take input as before. Underneath, each text is
measured in its own font and hidden, and what each line shows of it is a piece
placed under the element that owns the text, styled by the cascade as the text
is. A press on any piece of a wrapped link is a press on the link:
`host.elementAt` and every pointer event see the `a`. The pieces are not in
the host tree.

- An inline element that paints nothing of its own (`a`, `strong`, `em`) is a
  frame for its pieces: laid out at the paragraph's origin with no size of its
  own, so its text wraps freely across lines. Its own box properties (padding,
  border, background) have nothing to show.
- An element that paints a box (`code`, `kbd`, `mark`), anything that is not
  inline (`img`, `input`, `button`, an element holding a list) is kept whole
  and placed as a box by its laid-out size, on the baseline of its first text.
  A block takes a line of its own, as wide as the paragraph. A box does not
  wrap across lines.
- `text-align` (`left`, `center`, `right`, `justify`) is read from the
  paragraph or its nearest ancestor that sets it.

The flow runs after each layout, with `layout.onLaidOut`, and a window's
layout settles it before the frame that first shows it. Without an addon to
measure with (a `Host` built straight from a layout), nothing flows.
`Paragraph` remains for runs given directly. Not done: hyphenation,
`white-space: pre-wrap` inside a flow, `float`, the raised baseline of `sub`
and `sup`, and a focus ring on a wrapped inline element.

## Scrolling and scroll thumbs

An element with `overflow: auto` or `scroll` scrolls: the wheel scrolls the
nearest container that can, and `element.scrollTo(x, y)` and
`element.scrollBy(dx, dy)` move it, kept within its content, dispatching
`scroll`. `scrollTop`, `scrollLeft`, `scrollWidth`, `scrollHeight`,
`clientWidth` and `clientHeight` read where it is and how far its content
reaches. `element.scrollIntoView({ block, inline })` scrolls the containers
around an element, nearest first, by the least that shows it (`nearest`, the
default), or to the `start`, `center` or `end` of each view.

A container whose content overflows draws a thumb along each axis that does,
as long as the visible part is of the whole and as far along as the scroll is
of the distance it can go. Three properties set it, on the container:

- `scrollbar-color: <thumb> [<track>]` is the thumb's colour. The track is
  not drawn. The user-agent sheet gives containers a mix of the theme's
  `--text-tertiary`; with no value a neutral grey shows on light and dark.
- `scrollbar-width: none` draws no thumb. A transparent colour does too.
- `scrollbar-visibility` is when it shows: `always` (the default), `auto`,
  while scrolling and for a moment after, fading out over a quarter of a
  second; `hover`, while the pointer is over the container; or `hidden`.

The fade is the host's own timer, not CSS, so it asks for the frames it needs
and nothing more: a window draws nothing while a thumb merely stays.
`LayoutNode.setScroll(x, y, thumb)` takes the thumb's colour as red, green,
blue and alpha, from 0 to 1, when a scene is driven without a host.

## Top layer and placement

`TopLayer.of(host).open(content, options)` (`blinc_ts/native/top-layer`) puts
an element above everything else, as HTML's top layer does for a popover, a
menu, a select's list, a tooltip or a modal dialog. The entry goes last under
the root, absolutely positioned, so it is drawn over the rest, hit first and
clipped by no element. Beside the content is a `backdrop` element as large as
the root: clear, or dimmed for a `modal` (the sheet's `backdrop` rule, or a
`backdrop` colour you give).

```ts
import { TopLayer } from 'blinc_ts/native/top-layer';
import { placement } from 'blinc_ts/native/placement';

const entry = TopLayer.of(host).open(menu, {
  placement: placement.beside(button, 'bottom', { gap: 4 }),
  onClose: () => button.focus(),
});
await entry.close(); // resolves once its exit animation has played
```

A press on the backdrop, outside the content, closes a dismissible entry (the
default), and so does Escape; the topmost entry takes it, and one that is not
dismissible keeps Escape from those beneath. `modal` keeps Tab inside the
content, moves focus into it, and focus goes back to what had it as it closes
(`restoreFocus: false` to keep it where it is). `passThrough` makes an entry
take no presses at all, a tooltip's; `modeless` has no backdrop, so the page
keeps its presses while the content takes its own, a hover card's.

Closing puts `closing` on the backdrop and the content so a stylesheet can
animate them away, as the user-agent sheet does for `dialog` and `listbox`,
and presses pass through while they play. The content is kept, to open again.

Placements, in layout units against the root: `placement.center()`;
`below(anchor)`, at least as wide as it and above it where there is no room
below, for a select's list; `beside(anchor, side, { align, gap, offset })`;
`edge(side)`, pinned along an edge of the root and stretched, for a sheet;
`at(x, y)`, flipped left and up where it would run past an edge, for a
context menu. An anchor is a box, or an element whose bounds are read each
time it is placed. A box goes on its side when it fits there and on the
opposite side when it does not and that has more room, and is kept inside the
root. The side it ended on is `data-side` on the content, and `entry.placed`
has its `left`, `top`, `side` and `arrow`, where the anchor's middle falls
along the box.

An anchored entry is placed again after each layout, so it follows its
content's size and its anchor's place, with layout run again before the frame
is drawn. That is `layout.onLaidOut(listener)`: a listener that moves or
resizes something returns true, and layout runs again, up to four more times.
The geometry alone is `place(placement, contentSize, viewportSize)` in
`blinc_ts/native/placement`, which needs no window.

## Measuring text and inline runs

`measureText(text, style, wrapWidth?)` lays text out as the renderer draws
it, without a layout tree: its lines (each a UTF-16 range and a width), the
line height, the font's ascender and descender, and every place a caret can
stand. `caretAt(index)` finds the caret before an index, and
`caretNear(x, y)` the one nearest a point, for hit-testing a click.

```ts
const native = loadNative();
const m = native.measureText('Hello world', { fontSize: 16 }, 80);
m.lineCount; // 2 when the words do not fit on one line of 80
m.caretNear(30, 0); // { index, x, line }
```

`layoutInline(items, width, { align, breakWords })` lays a paragraph of text
runs in different styles, inline boxes and line breaks out as one flow: they
wrap together at the width, each line's pieces sit on one baseline, and lines
are aligned left, centre, right or justified. Whitespace collapses as HTML's
does. A word longer than the line breaks inside only with `breakWords`. The
result gives each line's part of each run as a fragment with its position,
and the paragraph's natural and minimum widths. `Paragraph` shows a layout's
runs as text nodes placed under one layout node, sized to its height.

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

An `ImageLibrary` (`blinc_ts/native/image-library`) holds images by id, a decoded
`ImageResource` with `add` or SVG markup with `addSvg`, and gives the image slot a
record draws one fitted by a given `ImageFit` with `library.slot(id, fit)`. Hand
the library to a renderer with `renderer.useImages(library)`: each image record
that names a library image is resampled, or an SVG rasterized, to the size it
covers on screen, in steps of a twelfth of an octave of scale so a zoom reuses
what it made, up to 2048 pixels a side. When the images on screen outgrow the
atlas it is emptied once and filled with them; a record whose image is not in
the library, or no longer is, draws nothing. An SVG keeps its aspect ratio and is
centred in what it covers; with `{ mask: true }` it is drawn white and tinted by
the node's colour, as an icon is, and without it `currentColor` is the node's.

Backdrops use two Gaussian passes over the accumulated content in the current layer. Liquid glass
adds refraction, tint, grain and adjustable chromatic separation. Rounded and
shaped boxes, gradients, borders, analytic shadows, clipping, text and RGBA images
use the same packed records. Set `cornerShape: 2` in render options for squircle
smoothing, with `smoothingThreshold` and `fullRadius` controlling which corners
remain circular; without it, the layout's theme shape applies (see
[Corner shape](#corner-shape)). Fill, border, shadow, child clipping and glass refraction all
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

### Notches

A notch is a shape a rounded box cannot make, drawn in place of the node's
box: four signed corner radii, where a negative one is a concave corner that
curves out to the box's edge as a menu-bar dropdown meets its bar, and a
modifier at the centre of the top and of the bottom edge.

```ts
import { concaveTop, notch, notchEdge } from 'blinc_ts/native';

menu.setNotch(concaveTop(16, 8)); // flared top corners, round bottom ones
tip.setNotch(notch({ bottom: notchEdge.peak(24, 12) })); // an arrow
island.setNotch(notch({ top: notchEdge.scoop(40, 12, 6) }));
menu.bindNotch(signal, context); // follows a signal or computed; null is a plain box
```

The edges are `scoop(width, depth, radius?)` and `cut(width, depth)`, which
carve into the body, and `bulge(width, height, radius?)` and
`peak(width, height)`, which rise out of the edge. Concave corners, bulges
and peaks lie inside the box, so the body is inset by them and the node needs
padding for its content. A scoop's bowl is a disk of the smaller of half its
width and its depth, with a slot below that. Fills, borders and outer
shadows follow the notch, and a radius animated through zero is continuous.
Inset shadows follow it too, from the border's inner edge. A notch has no CSS property.

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

`host.captureFrames(listener)` reads back every frame the scene presents, for
tests and tools: the scene is drawn a second time into a readable texture in
the frame's own submission, and the listener gets its RGBA pixels, its index
and the clock its motion was sampled at. It costs a second pass and a readback
a frame until the returned function stops it. It is the frame's state, not the
swapchain image, so it does not show what the compositor does after
presentation.

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

`host.presentable` says whether a frame can be presented now: the window is
visible, not minimized, not suspended, and not occluded. On macOS a window
covered by another window is reported occluded, and requested frames wait
until it is uncovered; `host.framePending` says a frame is waiting. The native
tests' waits count only time the window could present
(`tests/window-wait.mjs`).

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
  bubble phases, with `stopPropagation`, `stopImmediatePropagation` and
  `preventDefault`.
- **Input.** `host.input` takes what a window reports and dispatches it. A
  mounted host feeds it from the window; tests and other hosts call it
  directly.
  - Pointer: `pointermove`, with `pointerenter`, `pointerleave`, `pointerover`
    and `pointerout` as hover changes; `pointerdown` and `pointerup`; `click`
    on the deepest element both the press and the release were over, with
    `detail` counting quick presses, and `dblclick`. Elements with a `disabled`
    attribute take no presses. `setPointerCapture` sends later pointer events
    to one element until release.
  - Focus: a press focuses the nearest focusable element (a `tabindex`, or a
    built-in control), and Tab and Shift+Tab move through them, positive
    `tabindex` values first. `focus`, `blur`, `focusin` and `focusout` follow
    the DOM. `input.trapFocus(element)` keeps Tab inside a dialog.
  - Keys: `keydown` and `keyup` go to the focused element, or the root, with
    the DOM's `key` and `code` names and the modifiers. Unless cancelled, Enter
    and Space click the focused element. Typed text arrives as `textinput`, and
    input-method composition as `compositionstart`, `compositionupdate` and
    `compositionend`.
  - Wheel: unless cancelled, the innermost element whose `overflow` is
    `scroll` or `auto` scrolls within its content, and what it cannot take
    passes to the containers around it. Each scroll dispatches `scroll`.
  - State: `element.interaction` holds hover, active, focus, focus-visible,
    focus-within and disabled, and `input.onInteraction` reports each change,
    as the CSS cascade needs for its pseudo-classes. Disabling the focused
    element blurs it. The states the host does not track (`checked`,
    `indeterminate`, `placeholder-shown`, `valid`, `invalid`, `user-valid`,
    `user-invalid`, …) are given by the component that knows them:
    `element.setState('checked', true)` makes `:checked` match.
  - Cursor: the `cursor` property of the element under the pointer, or its
    nearest ancestor that sets one, is `input.cursor`; a mounted host shows it
    in the window.
  - Clipboard: `host.clipboard` reads and writes text or any MIME type. It is
    held in the process until the host is mounted, then it is the system's.
    The platform's copy, cut and paste shortcuts send `copy`, `cut` and
    `paste` to the focused element, and listeners use `event.clipboard`.
  - Hit testing reuses the last hit region while the pointer stays inside it
    and nothing has changed, so quiet movement makes no native call.
- **Reading back.** `node.bounds()` lays out if an edit is pending and returns
  absolute bounds. `host.elementAt(x, y)` hit-tests.
- **Batching.** Tree edits, layout properties, paint, text and scroll offsets
  go into the layout's command buffer, and one native call applies the tick's
  commands at its end, or earlier when something reads layout. Writes coalesce:
  the last write to a property wins, and paint, text and scroll merge per node.
  Text equal to what a node already shows is not sent again. Nodes cross as
  numbers, and solid colors cross without a native brush. `host.flush()` submits
  at once. The host checks tree edits for cycles and parentage before queueing
  them; if a command still fails when applied, the flush throws and the commands
  before it stay applied. `benchmarks/host-frame.mjs` counts native calls per
  frame for a few thousand nodes.

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

Signals, computeds and effects are plain JavaScript objects holding a numeric
key into the native graph; no native object is wrapped per item, and disposing
an item frees its native memory at once rather than at a later finalizer. The
callbacks of computeds stay in a JavaScript table per context, and the native
graph calls one dispatcher function with a computed's id while it evaluates.
Effects hold no native callback: writes, batches and new effects report how
many effects are due, the context takes them in one call, and runs each in
JavaScript between a native begin and end. While an effect runs, each signal
read writes the signal's key into a scratch array the native graph registered
once, with no native call, and the end hands the native graph that list as
the run's reads. Blinc's graph keeps the dependencies, subscriptions,
dirtiness and scheduling; JavaScript keeps only the current run's keys.
`peek()`, and a read outside any computed or effect, make no native call. Writes an effect makes apply when its run ends, so an effect that writes
what it read runs again in the same pass. `benchmarks/reactive-flush.mjs`
measures the cost of running many due effects.
`benchmarks/reactive-memory.mjs` measures process memory per item (macOS).

`tests/native-reactive.mjs` exercises these contracts against the compiled addon.
