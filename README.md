# blinc_ts

Framework agnostic TypeScript SDK for native UI rendering, layout and reactivity.
Use it directly from TypeScript or JavaScript, or connect a framework to its
primitives. Components and styling belong to the TypeScript layer.

## Development

Requires Node.js 22.13+.

```sh
npm ci
npm run check
npm run dev
```

The headless Vite example demonstrates HMR. Edit `examples/hmr/app.ts` to replace
the UI scope while keeping its host alive. The [native example](docs/native.md)
opens a real window and preserves its window and GPU device through accepted
updates.

## Current status

Working foundations include x-idl generated Node/TypeScript bindings for xgpu and
xwindow, [owned layout trees](docs/native.md#owned-layout-trees),
[native reactivity](docs/native.md#reactive-contexts),
[scene encoding, text and images](docs/native.md#owned-scenes-and-images),
[a native scene renderer](docs/native.md#drawing-a-scene) with gradients, clipping,
shadows, group filters and masks, blur and liquid glass,
[custom GPU canvases](docs/native.md#gpu-canvases), [native scene windows](docs/native.md#native-scene-windows),
[TypeScript shaders](docs/shaders.md), Vite HMR,
and [offscreen visual and motion inspection](docs/snapshots.md): clean/debug
filmstrips, dotted trails, pixel/geometry diffs and per-element curve sheets.

The package is private. Native scenes render in windows and offscreen;
[Full-scene renderer benchmarks](docs/performance.md#full-scene-renderer-benchmark)
cover text lists, image cards and layered glass. CSS, themes, components and
comparative framework measurements remain in progress.
Native rendering is tested on macOS with Metal and in CI on Linux with software Vulkan, under X11 and Wayland.

## Architecture

| Layer                                                   | Responsibility                                             |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| [blinc_abi](https://github.com/project-blinc/blinc_abi) | Native graph, layout, text, display lists and hit testing  |
| [x-idl](https://github.com/rayzor-blade/x-idl)          | Shared API model and generated runtime bindings            |
| [xgpu](https://github.com/rayzor-blade/xgpu)            | GPU resources and execution                                |
| [xwindow](https://github.com/rayzor-blade/xwindow)      | Windows, input and platform events                         |
| TypeScript                                              | Renderer orchestration, CSS, themes, motion and components |
| [TypeGPU](https://github.com/software-mansion/TypeGPU)  | Typed shaders compiled to WGSL                             |

See [architecture](docs/architecture.md), [Vite and HMR](docs/tooling.md),
[code conventions](docs/contributing.md), and [performance](docs/performance.md).

Apache-2.0.
