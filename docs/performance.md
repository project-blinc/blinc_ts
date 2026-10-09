# Performance

Performance decisions require repeatable measurements alongside visual checks.
Keep native calls coarse, reuse buffers and render resources, and process dirty
work rather than walking the full UI every frame.

## Current bridge benchmark

```sh
npm run build:native
npm run build
npm run bench:native -- --output .blinc/bridge-benchmark.json
```

The benchmark requires a release addon, warms the bridge and records multiple
samples. It reports a trivial native resource query, including JavaScript handle
lookup, numeric dispatch, Node-API conversion and backend locking. This isolates
one boundary cost; it does not measure layout or a complete UI frame.

On the local Apple M1 Pro with Node 24.2.0, the first release measurement was
approximately **201 ns per call** at the median. Compare like-for-like hardware,
runtime, build profile and workloads before drawing conclusions.

## Native layout benchmark

```sh
npm run bench:layout -- --output .blinc/layout-benchmark.json
```

Uses the release addon and 100, 1,000 and 10,000-node column trees. It measures
resize/layout calculation, one batched bounds read into reusable storage, and
bulk reparenting separately. Each operation has five warm-up iterations and 31
recorded samples, with median/p95 and raw data. Includes the TypeScript facade
and native conversions; no renderer or GPU readback is involved.

Absolute bounds are resolved once after layout and cached for subsequent reads.
Bulk moves update each old parent's child list once. Styles and tree edits
invalidate bounds until layout is recomputed.

## Large-tree mutation and frame benchmark

```sh
npm run build
npm run bench:layout:pipeline -- --output .blinc/layout-pipeline.json
npm run bench:layout:pipeline -- --gpu --captures .blinc/layout-captures \
  --output .blinc/layout-frames.json
```

The same 100, 1,000 and 10,000-node targets run as flat lists and nested cards
(one container with four children). Each tree includes one extra root. Each
frame changes four enum properties and height on 1%, 10% or 100% of the **style
targets**: all list rows or all card containers. Changed targets are distributed
through the tree; nested 10,000-node cases therefore change 20, 200 or 2,000
containers. Both alternating states change computed geometry.

The harness reuses style objects, geometry storage and GPU resources. Construction,
pipeline compilation and snapshot readback are outside timed frames. Each case
has 10 warm-up frames and 41 timed samples by default. Reports retain every sample
and median/p95/p99 timings for style submission, layout and bounds transfer. With
41 samples p99 is the maximum; use `--samples 201` for more tail observations.

`--gpu` uploads the measured bounds and submits **one instanced rectangle draw**
to the existing offscreen target. It records CPU submission and serialized queue
completion separately. Completion wait includes driver polling and promise
delivery: it is wall-clock latency, not an isolated GPU timestamp or interactive
frame rate. The workload has no text, UI display-list encoding, clipping/effects,
virtualization or window presentation. Offscreen nodes are still submitted and
clipped by the GPU. It does not stand in for the complete UI renderer.

Before timing, each geometry state is checked and captured. Representative pixels
are checked against the topmost rectangle at the corresponding layout position.
Geometry and pixel hashes allow comparisons to reject visually different results.

For a controlled enum-transport comparison, retain otherwise matching release
builds with the previous string boundary and the current numeric boundary.
Use separate Cargo target directories for comparison builds so one library cannot
replace another build's staged artifact:

```sh
npm run bench:layout:compare -- \
  --baseline /path/to/string-transport.node \
  --candidate /path/to/numeric-transport.node \
  --output .blinc/benchmarks/layout-comparison
```

The driver runs both CPU and GPU cases in separate processes, alternating build
order over three runs. It verifies matching workloads, GPU configuration,
geometry and pixels, and writes raw JSON files, binary hashes and a summary.
The string adapter mode is confined to the comparison harness; the public API
uses numeric enums. Reports use the median of the per-run medians. Avoid other
CPU/GPU work during collection, and inspect the individual runs for noise.

### Local measurement, 2026-10-08

Apple M1 Pro, macOS arm64, Node 24.2.0, release builds, Metal, 1024 × 768 target.
All compared geometry and capture hashes matched.
[Raw samples, run medians and binary hashes](../benchmarks/results/2026-10-08-layout-enums.json.gz)
are archived as gzipped JSON keyed by run filename. Each row below uses 10,000
content nodes plus a root, with all style targets updated each frame:

| Shape        | Changed targets | Work measured                      |   Strings |   Numeric | Time saved |
| ------------ | --------------: | ---------------------------------- | --------: | --------: | ---------: |
| Flat list    |          10,000 | Style + layout + bounds            | 21.531 ms | 18.766 ms |      12.8% |
| Flat list    |          10,000 | Through rectangle queue completion | 22.194 ms | 20.149 ms |       9.2% |
| Nested cards |           2,000 | Style + layout + bounds            |  9.582 ms |  9.138 ms |       4.6% |
| Nested cards |           2,000 | Through rectangle queue completion | 10.575 ms | 10.092 ms |       4.6% |

At 1% changed targets, full-frame savings were only about 1.5% for flat lists
and 0.5% for nested cards, within normal run variation for this experiment.
Removing enum string allocation reduces mutation cost; the layout engine's own
cost is substantially unchanged. It does not compound into a uniform 19%
reduction across every stage.

In the fully dirty flat-list CPU workload, numeric style submission still costs
14.088 ms, versus 3.163 ms for layout and 1.507 ms for bounds transfer. These
separate medians do not necessarily sum to the combined median. The next target
is coalescing queued property writes at a frame flush, then measuring batched
native submission with the same geometry and image checks. The full-scene
renderer baseline below covers the rendering stages separately.

## Full-scene renderer benchmark

```sh
npm run build:native
npm run build
npm run bench:renderer -- --output .blinc/renderer-run1.json \
  --captures .blinc/renderer-captures
npm run bench:renderer -- --output .blinc/renderer-run2.json \
  --verify .blinc/renderer-run1.json
```

This harness uses `SceneRenderer` and the shared offscreen target. It exercises
text shaping/cache lookup, display-list generation and transfer, glyph and image
atlases, rounded clipping, fractional corner shapes, gradients, shadows, masks,
group opacity, Gaussian blur and liquid glass. The scenes use raw SDK primitives;
CSS, application components and virtualization are outside this measurement.

| Workload                                                     | Change between frames                                                 |
| ------------------------------------------------------------ | --------------------------------------------------------------------- |
| 30, 300 or 3,000 text rows in a clipped viewport             | Scroll by 28 logical pixels; paint only                               |
| 12 image cards with borders, shadows and gradients           | Change the layout gap by 8 logical pixels                             |
| Six glass cards with masked, blurred groups and drop shadows | Change aberration at fixed bevel; half the cards have zero glass blur |

Each case runs at 1024 × 768 logical pixels at both 1x and 2x. The default is
20 warm-up frames and 101 recorded samples per mode. `--counts`, `--scales`,
`--cases`, `--warmup` and `--samples` select a smaller or longer run. Static mode
forces repeated unchanged draws to measure cache reuse; the real window host
skips those draws when idle. Changed mode alternates two deterministic states.

The report separates mutation, layout when needed, CPU encode, queue submission
and serialized queue completion, and retains p50/p95/p99 plus every sample.
Encoding includes native display-list preparation and transfer. Completion is
wall-clock latency with GPU work, driver polling and promise delivery; it is
not an isolated GPU timestamp or a presented-window frame rate. Each frame
completes before the next starts. Construction, pipeline compilation and image
preparation are outside samples. First-render timings are reported separately;
they are cache-fill diagnostics after construction/layout, not cold app startup.

Before timing, both states are captured and replayed. Checks require text and
expected image/layer/glass records, changed pixels between states, identical
pixels on replay, no warm glyph uploads and no new textures, buffers or bind
groups. Resource instrumentation is removed before timing. `--verify` also
requires matching workload/viewport/GPU metadata and pixel hashes from an earlier
run. Reports include runtime/OS/GPU metadata and native binary, SDK and fixture
hashes. Use separate processes for repeated runs and avoid concurrent GPU work.

### Local renderer baseline, 2026-10-08

Apple M1 Pro, macOS arm64, Node 24.2.0, release addon, Metal. Three sequential
processes, 20 warm-up frames and 101 samples per mode. Both scene states matched
pixel-for-pixel between runs; warm captures allocated no textures, buffers or
bind groups and uploaded no glyph bytes. Captures were also inspected visually.
The table uses the median of the three changed-mode medians:

| Workload            | Scale |  CPU frame | Through queue completion | Draws |
| ------------------- | ----: | ---------: | -----------------------: | ----: |
| 30 text rows        |    1x |   0.936 ms |                 3.522 ms |    63 |
| 300 text rows       |    1x |  11.042 ms |                15.124 ms |   603 |
| 3,000 text rows     |    1x | 109.921 ms |               121.745 ms | 6,003 |
| 12 image cards      |    1x |   0.412 ms |                 2.489 ms |    63 |
| 6 glass/layer cards |    1x |   1.193 ms |                 4.487 ms |    52 |
| 30 text rows        |    2x |   0.966 ms |                 3.438 ms |    63 |
| 300 text rows       |    2x |  10.911 ms |                15.915 ms |   603 |
| 3,000 text rows     |    2x | 111.622 ms |               126.870 ms | 6,003 |
| 12 image cards      |    2x |   0.459 ms |                 4.206 ms |    63 |
| 6 glass/layer cards |    2x |   1.267 ms |                12.023 ms |    52 |

These are baseline measurements, not a speedup or framework comparison. Run
variation is visible: the 1x 30-row changed CPU median ranges from 0.854 to
2.160 ms, and the 2x 3,000-row case from 111.518 to 140.098 ms. Queue completion
also varies. [All raw samples, frame counts and build hashes](../benchmarks/results/2026-10-08-ui-renderer.json.gz)
are retained so comparisons can examine that spread.

The list exposes a concrete scaling problem: all three sizes have identical
visible pixels, but 30/300/3,000 rows encode 2,237/22,217/222,017 primitives.
In that baseline, invisible rows were still traversed and submitted. The shared
paint walk now culls primitives outside explicit screen clips before packing.
It retains the antialiasing fringe and transformed shadow reach; layout bounds
and the viewport never become implicit clips. Canvas records and compositing
layer contents are preserved. Local transformed clips and clip paths still use
the shader. Virtualization remains a separate concern.

### Comparing clipping builds

Keep the baseline addon before rebuilding the candidate, then run:

```sh
npm run bench:renderer:compare -- \
  --baseline /path/to/baseline.node --candidate /path/to/candidate.node \
  --output .blinc/benchmarks/renderer-comparison
```

The driver alternates fresh processes for three runs per build, with the same
SDK, fixtures, machine, GPU and viewport. Each state must match the baseline's
pixel hash; the number of records may change. The summary retains individual
run medians and record/draw/upload ranges; companion reports retain all samples.
Use `--counts`, `--scales`, `--cases`, `--samples`, `--warmup` or `--runs` to select
the experiment. The single-run harness also accepts `--addon`.

`tests/native-clipping.mjs` covers scrolling italic text, fractional corners,
overflow descendants, offset shadows, transformed clips, filtered/masked groups,
glass and retained canvas records. Run it with `--addon` and `--output` to capture
an unchanged producer, then use `--verify` with that directory to require exact
pixel equality from the candidate on the same machine. Its default run asserts
that clipped rows no longer produce their box and glyph records.

### Clipping measurement, 2026-10-08

Apple M1 Pro, macOS arm64, Node 24.2.0, Metal, release builds. Three alternating
runs per build, 20 warm-up frames and 101 samples per mode. Values below are
medians of changed-mode run medians; every captured state matched the baseline.

| Text rows | Scale | CPU before | CPU after | Reduction | Completion before | Completion after |
| --------: | ----: | ---------: | --------: | --------: | ----------------: | ---------------: |
|        30 |    1x |   0.840 ms |  0.516 ms |     38.6% |          1.829 ms |         1.465 ms |
|       300 |    1x |  10.919 ms |  6.062 ms |     44.5% |         14.604 ms |         8.290 ms |
|     3,000 |    1x | 111.100 ms | 60.965 ms |     45.1% |        122.484 ms |        63.804 ms |
|        30 |    2x |   0.984 ms |  0.659 ms |     33.1% |          4.238 ms |         4.006 ms |
|       300 |    2x |  11.052 ms |  6.145 ms |     44.4% |         16.670 ms |         9.996 ms |
|     3,000 |    2x | 111.440 ms | 61.118 ms |     45.2% |        125.901 ms |        68.748 ms |

All list sizes now submit 905–909 primitives in 27–29 draws, depending on scroll
position, instead of 2,237–222,017 primitives in 63–6,003 draws. The 3,000-row
record upload fell from 99.5 MB to about 0.4 MB per frame. Warm captures still
allocated no GPU textures, buffers or bind groups and uploaded no glyph bytes.

Small-scene end-to-end timings remain inconclusive: for example, mixed-run 2x
image cards measured 0.444 ms before and 0.495 ms after. A separate cards/effects
experiment with 201 samples showed wide variation across processes. Their
records and pixels are identical between builds. Isolating native paint
preparation and transfer (three runs, 200 warm-up iterations and 1,001 samples)
measured 14–21% less time; this excludes layout, GPU submission and completion.

CPU cost still grows with retained rows because the walk visits every text node
and prepares its glyphs before culling their records. Safely reusing actual ink
bounds and text preparation is the next target; layout boxes alone cannot
bound italic or overflowing text. Layer contents and transformed local clips
also remain conservative.

[Raw reports, run medians, binary hashes and the native-only diagnostic source](../benchmarks/results/2026-10-08-ui-clipping.json.gz)
include both the mixed and isolated experiments, plus hashes of the six clipping
regression captures. These measurements cover this renderer on this machine.
They do not compare frameworks or establish interactive frame rates.

## Native window idle benchmark

After building the SDK and release addon, compile the example and measure the
same scene with and without the development server:

```sh
npm run build:example
npm run bench:window -- --mode runtime --output .blinc/idle-runtime.json
npm run bench:window -- --mode dev --output .blinc/idle-dev.json
```

The default run warms up for five seconds and takes three five-second samples.
Use `--warmup 10`, `--seconds 10` and `--samples 5` for longer runs.
`--keep-open` leaves the window interactive after measurement. Run one window
benchmark at a time, keep its size and focus consistent, and leave the pointer
outside it. The recorded event kinds reveal input that contaminated a sample.

The report records CPU time as a percentage of one core, presented frames,
native poll count and wall time, JS heap/external memory, RSS, viewport/scale,
addon hash and machine metadata. On macOS it also records `vmmap` physical
footprint after the timed samples. Footprint includes compressed private memory;
RSS is a different measure. Neither is just the JS heap. Do not compare an
Activity Monitor footprint directly with Node's RSS, or development-mode memory
with a runtime-only application.

The macOS host now waits through xwindow and wakes for native events, Node I/O,
or a real timer deadline. It does not run `uv_run` recursively. Quiet samples
should contain zero window polls as well as zero presented frames. The native
wake test verifies timer/worker/socket progress, explicit redraws, multiple
windows and disposal; Vite HMR is verified separately. Linux uses the same
backend-descriptor integration; Windows retains the bounded timer pump.

The helper watches libuv's backend descriptor using the documented
[embedding facilities](https://docs.libuv.org/en/v1.x/loop.html#c.uv_backend_fd).
Both platform handling and JavaScript callbacks stay on the main thread.

### Initial macOS measurements, 2026-10-08

Apple M1 Pro, Node 24.2.0, release addon, the native scene example.
The final development run measured a 138.4 MB physical footprint; the standalone
run measured 71.1 MB. Their CPU samples were 2.6–3.2% and 5.1–5.6% respectively,
with zero frames presented in both. Earlier samples varied from 2.3–6.6% CPU.

These are diagnostic runs, not a controlled speedup claim. Focus was not recorded
in the initial samples (the harness now records it), and compression/GC change
memory readings. The large development-mode heap is real, but neither the memory
policy nor the launch-status cache has a reliable isolated savings figure yet.
These measurements predate the event-driven macOS pump.
[Raw samples and binary hashes](../benchmarks/results/2026-10-08-window-idle.json.gz)
include the earlier runs and their measurement limitations.

### Event-driven macOS host, 2026-10-08

After replacing the polling timer, a ten-second warmup followed by three
five-second samples gave:

| Mode       | Window polls | Presented frames |  CPU samples | Physical footprint |
| ---------- | -----------: | ---------------: | -----------: | -----------------: |
| Standalone |            0 |                0 | 0.059–0.124% |            68.1 MB |
| Vite       |            0 |                0 | 0.065–0.154% |           141.9 MB |

Both windows were visible, unfocused and not minimized, at the same viewport and
scale. CPU includes the benchmark's own timer/diagnostic work and runtime/system
housekeeping. Development tools still account for substantial memory, but they
no longer require a repeating window-poll timer.
[Raw samples](../benchmarks/results/2026-10-08-window-event-wake.json.gz)
retain focus, event counts, machine metadata and the addon hash.

A separate standalone run with no in-process sampling timer reported **0.0% CPU**
in both measured five-second macOS `top` intervals, with approximately **62 MB**
memory. Its external samples and command are included in the same archive.

## Renderer measurement plan

Use shared reference workloads and fixed inputs:

| Workload                 | What to measure                                             |
| ------------------------ | ----------------------------------------------------------- |
| Static UI                | Startup, first frame, idle CPU and retained memory          |
| Large scrolling list     | Frame latency, allocation/GC and visible item scaling       |
| Layout and FLIP          | Layout cost, interrupted motion, clipping and input latency |
| Text-heavy UI            | Shaping, atlas uploads, cache reuse and draw batching       |
| Blur and layered effects | CPU encode time, GPU time and texture memory                |
| Repeated HMR             | Resource counts, cleanup cost and memory growth             |

Record warm-up, viewport, scale factor, theme, content, compiler settings and
machine/backend metadata. Report p50/p95/p99 frame and input latency with CPU/GPU
work separated; use repeated runs and retain raw data.

Typed display lists and batched uploads should cross the native boundary without
per-element descriptor walks. Synchronous byte views are borrowed; asynchronous
roots own their data. Validate correctness and ownership before replacing a
copy with a borrowed view.

Offscreen captures force readback synchronization. Use them to verify pixels,
geometry and motion traces. Measure interactive rendering separately, with
capture and debug overlays disabled.

## Resource and input audit, 2026-10-09

| Area                    | Current SDK behavior                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shader compilation      | Generated WGSL is a module constant. Scene pipelines compile once on first use: zero at construction, two for a solid-box scene.                                                           |
| GPU allocation policy   | Both window and offscreen devices request `MemoryHints.MemoryUsage`.                                                                                                                       |
| Image and glyph atlases | Unused GPU slots are 1×1 pixels. Image storage grows directly to the required power of two, starting at 256 pixels on first use.                                                           |
| Effect targets          | Blur rows and shadow scratch are allocated only when required and shared across nested groups. Only simultaneously active group contents need separate textures.                           |
| Temporary GPU handles   | Shader modules and pipeline builders are released after construction, including canvas and snapshot pipelines. Encoders and acquired surface views are released after every frame.         |
| Text and glyph caching  | Shaping and raster caches use the shared native encoder's bounded LRU caches. Uploads use atlas revisions and dirty rectangles; unchanged atlases upload zero bytes.                       |
| Image ownership         | Image resampling is cached per image/size/fit. The packed GPU atlas retains its peak size until renderer disposal; removing a node does not shrink it.                                     |
| Layout and scene work   | Owned edits coalesce presentation; paint-only changes skip layout. Display-list and GPU buffers retain capacity; clipping culls invisible scene work.                                      |
| Hit queries             | `Layout.createHitCache(root)` reuses native conservative hit regions and invalidates on edits and layout computation. 100,000 queries inside one region make zero additional native walks. |
| Pointer input           | GUI hosts disable raw device events by default; `deviceEvents` opts back in. Generated xwindow bindings expose native quiet-movement coalescing.                                           |
| Idle windows            | macOS and Linux use the native/libuv pump with input, I/O and timer deadlines. Windows currently uses the bounded timer fallback.                                                          |
| Runtime caches and GC   | JavaScript uses V8. AIR/JIT tier thresholds and the application preset are runtime-specific and have no equivalent SDK setting.                                                            |

`tests/renderer-resources.test.mjs` enforces zero unused shader compilation,
small placeholder textures, zero new GPU resources over 1,000 unchanged frames,
and deterministic release after failed compilation and disposal. Native GPU
tests compare saved geometry, clipping, layers and custom canvas references;
zero-blur glass retains refraction and chromatic separation.

### Quiet pointer regions

`HitCache.pathAt(x, y)` returns the geometric path's node IDs. Its `bounds` use
logical layout pixels; repeated queries return the same array. Curved clipping
and rotated boundaries conservatively fall back to exact native hit testing.
Use `layout.hitTest(root, x, y)` for fresh local coordinates when dispatching an
actual event. Geometric hit eligibility alone does not identify event handlers.

Framework adapters may pass safe bounds, multiplied by the window's scale,
to `host.window.coalesceCursorMoves(left, top, right, bottom)`. Only enable this
when movement within the region has no observable effect. Disable it for drag
operations, continuous move handlers and global pointer hooks. On scene or
handler changes, consume `host.window.takeCursorMove()` before processing new
work and recompute eligibility. Native button and wheel delivery flushes the
retained position first. X11's duplicate X/Y valuators stay quiet when raw
input is disabled; other axes and raw-input subscribers keep normal delivery.

The SDK exposes these primitives; framework-specific event routing must supply
its own handler policy. A debug hit map should visualize the same native hit
paths and quiet bounds, including ancestor routing, rather than infer eligibility
from component names.

CI runs the native suite on software Vulkan under both X11 and Wayland, with
pinned binding dependencies. These jobs include snapshots, resource ownership,
idle wake/deadline delivery, multiple windows, snapshot watch recovery and HMR.

The common reference tolerance remains two channel levels. The layered 2×
software-Vulkan capture additionally permits one pixel at delta three, while
reporting that pixel in its saved diff. Larger deltas or more outlying pixels
still fail. CI uploads the captures and motion/debug diagnostics on failure.
