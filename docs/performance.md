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
native submission with the same geometry and image checks. End-to-end UI renderer
measurements remain a later gate.

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
