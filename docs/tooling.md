# Vite and HMR

The SDK exports ESM and TypeScript declarations. Importing its portable modules
does not load a native addon. `loadNative()` loads it explicitly on the Node main
thread.

`blinc_ts/vite` creates a Vite environment backed by the Node Module Runner.
App modules receive `import.meta.hot` while executing outside a browser.

```ts
import { defineConfig } from 'vite';
import { blinc } from 'blinc_ts/vite';

export default defineConfig({
  plugins: [blinc()],
});
```

Import the app through `server.environments.blinc.runner`; see the
[headless runner](../examples/hmr/dev.mjs) and
[native runner](../examples/native/dev.mjs).

## Keeping the native host through reloads

`createHmrSession` retains the host in `hot.data`. Each UI mount gets a fresh
scope. Register subscriptions, nodes, timers and animation cleanup on that scope.

```ts
import { createHmrSession } from 'blinc_ts/hmr';
import { Brush, loadNative } from 'blinc_ts/native';
import { NativeWindowHost } from 'blinc_ts/native/window';

const native = loadNative();
export const app = createHmrSession(import.meta.hot, () => new NativeWindowHost(native));

await app.host.ready;
app.mount((host, scope) => {
  const layout = native.createLayout(scope);
  const root = layout.createNode({ width: '100%', height: '100%', padding: 24 });
  root.setPaint({ background: Brush.solid(0x142535), textColor: [1, 1, 1, 1] });
  root.setChildren([layout.createText('Edit me', { fontSize: 24 })]);
  host.attachScene(layout, root, { cornerShape: 2 }, scope);
});

if (import.meta.hot) {
  import.meta.hot.accept();
}
```

The entry needs a literal `import.meta.hot.accept()` so Vite can recognize the
acceptance boundary. Accepted updates retain the native window and GPU device;
the previous root's cleanup runs before the new root mounts. Failed mounts
release partial resources. Pruning, full reloads and `app.dispose()` destroy
the host. Native addon changes require a process restart.

The [native scene example](../examples/native/app.ts) uses this lifecycle for
text, gradients and interactive glass. See [scene windows](native.md#native-scene-windows)
for invalidation, scale, input and renderer ownership.

## Running without the development server

Compile the native example once, then run its JavaScript directly:

```sh
npm run build:native
npm run build
npm run build:example
npm run start:native
```

This opens the same interactive scene without loading Vite, its watcher or its
module runner into the application process. It does not hot-reload; use
`npm run dev:native` for development. Compare application memory in this mode,
and report development-server overhead separately. See the
[idle benchmark](performance.md#native-window-idle-benchmark).

## Other tooling

`blinc_ts/hmr` has no Vite runtime dependency. Its structural `HotContext`
interface can adapt another bundler's module data and dispose/prune hooks.
Register the acceptance boundary using that bundler's API.

WGSL is generated during the build and imported as strings with entry point
metadata. Consumers do not need TypeGPU to load the generated shaders.

For automatic offscreen recapture and motion inspection, see
[snapshots](snapshots.md).

## References

- [Vite runtime environments](https://vite.dev/guide/api-environment-runtimes)
- [Vite HMR API](https://vite.dev/guide/api-hmr)
- [TypeGPU build plugin](https://github.com/software-mansion/TypeGPU/blob/main/apps/typegpu-docs/src/content/docs/tooling/unplugin-typegpu.mdx)
