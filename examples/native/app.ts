import { createHmrSession } from '../../src/hmr.js';
import { loadNative } from '../../src/native/index.js';
import { NativeProbeHost } from '../../src/native/probe.js';

export const session = createHmrSession(import.meta.hot, () => new NativeProbeHost(loadNative()));
await session.host.ready;
session.mount((host, scope) => {
  scope.onCleanup(
    host.onEvent((event) => {
      if (event.kind === 'KeyboardInput') {
        host.requestFrame();
      }
    }),
  );
  host.requestFrame();
  console.log('Native root mounted; edit this file to test HMR.');
});

if (import.meta.hot) {
  import.meta.hot.accept();
}
