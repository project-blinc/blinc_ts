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
