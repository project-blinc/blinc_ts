# SDK architecture

`blinc_ts` is a framework-agnostic TypeScript SDK, usable directly from
TypeScript and JavaScript. Framework adapters connect their own UI APIs
to the SDK's primitives.

## Native foundation

[blinc_abi](https://github.com/project-blinc/blinc_abi) owns the reactive
dependency graph, layout, text shaping/rasterization, image/SVG primitives,
display-list generation and hit testing.

The owned layout context is now connected to Node, with opaque node handles,
validated tree edits, reusable bounds buffers and deterministic scope cleanup.
It builds without the compatibility adapter or its host runtime. Owned reactive
contexts also connect to Node. JavaScript signal values remain in JavaScript to
preserve identity and avoid repeated marshalling; reads and invalidations cross
into the native dependency graph. Computed and effect callbacks execute on the
owning JavaScript thread. Batches deduplicate effects, and callback mutations
are deferred until the active graph evaluation returns.

[xgpu](https://github.com/rayzor-blade/xgpu) and
[xwindow](https://github.com/rayzor-blade/xwindow) separate runtime adapters from
their native backends. Their shared generator provides TypeScript declarations
and Node-API adapters, keeping one API model. The x-idl Node target now binds
both APIs and checks generated/native schema compatibility at load.

The Node host must coordinate xwindow's event loop and libuv on the platform
main thread. Timers, promises and GPU work must continue during input and
animation. Window handles retain their full pointer precision, and GPU surfaces
must be released before their windows.

## Rendering

The TypeScript renderer manages paint order, batching, atlas updates,
straight-alpha/color behavior, transformed clipping, borders, shadows,
nested layers, filters, backdrop blur, liquid glass, display scaling and
custom canvas passes through xgpu. The shared ABI paint walk rejects primitives
outside explicit screen clips before packing records, preserving shadow reach
and antialiasing. It retains compositing-layer contents and canvas records;
transformed local clips and clip paths remain shader-resolved. This reduces
submission work without treating a layout box as an implicit overflow clip.

Use TypeGPU for shader authoring. During builds, its Vite plugin transforms
shader functions and `tgpu.resolve` generates WGSL. Package WGSL, entry-point
names and binding metadata together. Complete scenes are verified offscreen,
including fractional corner shapes, transformed clipping, layered effects and
custom canvases. Native windows use the same scene renderer with retained GPU
resources and change-driven presentation.

Initially shader generation is independent of the TypeGPU GPU runtime.
A future WebGPU-compatible xgpu JavaScript surface can also support
`tgpu.initFromDevice` after resource and method semantics are verified.

The display-list reader follows the current 112-float ABI records. The SDK
checks the producer's schema version, record size and row count when loading
the addon; incompatible producers are rejected before records reach a shader.

## Styling and components

The SDK will provide CSS parsing, cascade, compiled styles, theme tokens
and utility-class generation.

Implement components in TypeScript using SDK primitives. Keep keyboard/focus
policy, composition and transient state machines there. Theme color, shape,
typography and animation tokens influence styling and component behavior.

Framework adapters map their element trees, reactive state and lifecycle hooks
onto SDK primitives. The SDK exposes node creation, reactive bindings, rendering
and cleanup through framework-independent APIs.

When connecting a framework's state system to the native graph, preserve its
equality rules, scheduling, dynamic dependencies, asynchronous behavior and
disposal contracts.

## Motion

Implement FLIP orchestration, transitions and springs in TypeScript. Native
layout settles before FLIP measures final bounds. Visual offsets and drawn
sizes drive both painting and hit testing. Account for parent/child movement,
continue interrupted animations from the current visual position, clip children
during resizing and use theme durations/easing.

## Development lifecycle

Separate persistent native hosts from mounted UI roots. HMR disposes the root's
reactive scope, listeners, timers, animations and native nodes, then mounts
updated code on the same host. App-level state can live on that host when it
should survive a UI reload. Full reloads and application shutdown dispose the
host. CSS updates should reapply the cascade without recreating the host;
shader updates must validate replacement pipelines before swapping them.

Vite's Node environment uses Module Runner HMR. Framework-specific component
refresh can build on the portable lifecycle later.

## Implementation stages

1. SDK build, TypeGPU shader generation, Vite environment and HMR lifecycle.
2. Extract the ABI and separate its runtime adapters.
3. Bind the ABI graph/layout API to Node. Owned layout, reactive callbacks, xgpu/xwindow adapters and native window rendering are working.
4. Implement the renderer and verify its visual behavior offscreen.
5. Implement reactivity bindings, CSS, themes and motion.
6. Implement TypeScript components and document framework adapter contracts.

Use offscreen snapshots and scripted motion scenes as acceptance tests.
The initial HMR tests verify actual Vite reloads with an instrumented host;
native tests now verify window/device preservation and offscreen pixels.

See [snapshot tooling](snapshots.md), [code conventions](contributing.md) and
[performance measurement](performance.md).

## Source references

- [ABI repository](https://github.com/project-blinc/blinc_abi)
- [xgpu adapter boundary](https://github.com/rayzor-blade/xgpu/blob/71c25d19b99ef9557e56b2ac13cfce2715e582dd/CONTRIBUTING.md)
- [xwindow host integration](https://github.com/rayzor-blade/xwindow/blob/27d4fc611fa5f332324242e9fbd38402886bb724/CONTRIBUTING.md)
- [TypeGPU shader resolution](https://github.com/software-mansion/TypeGPU/blob/main/apps/typegpu-docs/src/content/docs/apis/resolve.mdx)
