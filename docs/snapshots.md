# Offscreen snapshots and motion inspection

Capture through the native GPU backend without opening a window. The initial
scenes exercise a pipeline gradient and an animated disc. Full UI scenes will
use this tool as the renderer, layout and motion APIs land.

Build the [native addon](native.md) and SDK first:

```sh
npm run build
npm run snapshot -- probe --width 640 --height 420
npm run snapshot -- motion --frames 31 --fps 30
```

Output defaults to `.blinc/snapshots/<scene>/`:

| File                        | Content                                                          |
| --------------------------- | ---------------------------------------------------------------- |
| `frame-0000.png`, ...       | Clean native RGBA frames, used for pixel baselines               |
| `debug-frame-0000.png`, ... | Colored bounds, dotted trails, progress bars and geometry deltas |
| `filmstrip-plain.png`       | Clean frames with frame/time captions                            |
| `filmstrip.png`             | The same frames with debug highlights                            |
| `curves.png`                | Declared and sampled curves for every element/property track     |
| `curves/<hash>.png`         | A curve sheet per element; the manifest maps ids to files        |
| `motion-diff-0001.png`, ... | Changed pixels relative to the previous captured frame           |
| `trace.json`, `report.txt`  | Actual samples, declared curves, timing and motion checks        |
| `capture.json`              | Frame times, artifacts, shader hash, platform and GPU metadata   |
| `index.html`                | Offline playback, scrubbing, overlay toggles and artifact links  |
| `diff-0000.png`, ...        | Pixels that failed a baseline comparison                         |

Open `index.html` directly in a browser; no server is needed. Toggle bounds,
trails, geometry changes, curves and pixel motion diffs independently. The
viewer shows up to three small curve panels over a frame; the exported sheets
include **all tracks**. Dot spacing on trails shows observed movement over time.
Progress bars show sampled progress with a tick for the declared value.

Filmstrips evenly select up to 12 frames, including the first and last. Captions
include frame index and time. Their PNGs and curve sheets are generated offline
with a bundled font, without a browser or system font discovery. Diagnostic
overlays do not alter native frames or baseline comparisons.

Motion uses simulation timestamps instead of elapsed wall time. `--at 500`
captures at 500 ms; 31 frames at 30 fps cover 0 through 1000 ms. GPU/readback
timings are recorded separately; they are **not** onscreen frame-rate measurements.

## Motion checks

Tracks declare their target, property, endpoints, delay, duration and easing.
Samples come from the values actually submitted to rendering, not from the
declared curve. Stable element ids keep trails and geometry deltas correct
when layer ordering changes.

The checker flags deviations over 2% of the declared move, unexpected jumps
over 25%, missing samples, and incorrect endpoints when the capture reaches the
end. Overshoot and partial captures are annotated. A constant property's
tolerance is measured in its original units. Motion issues exit with status 1.

Linear, cubic-in, cubic-out and cubic-in-out curves are supported. This is an
opt-in tracing API; it does not implement the forthcoming animation/FLIP engine
or claim to validate spring motion.

```ts
import { MotionTrace } from 'blinc_ts/debug/motion';

const trace = new MotionTrace([
  {
    id: 'card-x',
    targetId: 'card',
    label: 'Card',
    property: 'translate-x',
    kind: 'layout',
    from: 0,
    to: 200,
    startMs: 0,
    durationMs: 400,
    easing: 'cubic-out',
  },
]);

// Call from the capture loop with the actual value and simulation clock.
trace.sample('card-x', frameIndex, timeMs, renderedX);
const report = trace.snapshot();
```

## Compare with a reviewed baseline

Keep baselines outside the output directory:

```sh
npm run snapshot -- motion --frames 31 --fps 30 --output baselines/motion
npm run snapshot -- motion --frames 31 --fps 30 \
  --baseline baselines/motion --output .blinc/snapshots/motion-check
```

Single captures can compare against a PNG; sequences compare against a
directory. Width, height, timestamps, shaders and scene inputs should match.
Comparison considers all RGBA channels. Default `--tolerance 2` allows
per-channel differences up to two byte values; `--max-diff 0` allows no pixels
above that tolerance. Failures produce diff PNGs and exit with status 1.
Inspect changes before approving baselines; the checker never updates them.

## Recapture while editing

```sh
npm run snapshot -- motion --frames 31 --fps 30 --watch
```

Watch mode coalesces edits, rebuilds shaders/TypeScript and starts a fresh capture
process. Native source changes also rebuild the addon. It logs successful
captures and build/render failures in `.blinc/snapshots/events.jsonl`, then keeps
watching so corrections recover automatically. Captures have a timeout.
Restart the watcher after changing its orchestration code.

## Adding scenes

Register a scene in `tools/snapshot/run.mjs`. A scene provides shader metadata and
`create(renderer)`, which returns:

- `tracks`: motion definitions; omit for a static scene.
- `frame(timeMs)`: bind groups and a serializable `debug` object.
- `dispose()`: releases scene-owned resources.

`debug.layers` contains stable `id`, display `name` and `bounds` in normalized
top-left coordinates. `debug.motion` contains `{ id, value }` samples referencing
declared track ids. Each declared track needs samples. Trace layout bounds and
rendered properties after updating the frame.

The renderer owns its GPU device, texture and reusable readback allocation.
The scene owns uniforms and bind groups. Pixel comparisons reuse a diff buffer;
captures keep one previous RGBA frame instead of retaining the whole sequence.

`npm run check` covers motion faults, identity tracking, per-element curve
coverage and filmstrip selection. `npm run test:native` checks actual GPU
readback, geometry/trace agreement, diagnostic PNGs, repeated baselines,
intentional mismatches, watch recovery, windows and native HMR.
