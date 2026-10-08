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
import { loadNative } from 'blinc_ts/native';

const layout = loadNative().createLayout();
try {
  const root = layout.createNode({ width: '100%', height: '100%', gap: 12, padding: 16 });
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
gaps, uniform padding and pixel/percentage/auto sizes with min/max constraints.
`setStyle` merges fields. `setChildren` reorders or reparents existing nodes;
removing a node removes its descendants. Handles are checked for context and
generation, and cyclic or duplicate-child edits are rejected atomically.

Compute again after edits before reading bounds. `readBounds` accepts a reusable
`Float32Array`, including subarray views, and fills four numbers per node in one
native call. Shared, detached and undersized storage is rejected. No native
pointer escapes to JavaScript. Layout contexts use `blinc_abi` without its
HashLink feature; the Node addon does not link the HashLink runtime.

`tests/native-layout.mjs` covers geometry, edits, invalid handles/buffers and HMR
scope disposal against the compiled addon. Text measurement and display-list
production are still pending Node integration.

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
