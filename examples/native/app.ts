import { createHmrSession } from 'blinc_ts/hmr';
import { loadNative, window } from 'blinc_ts/native';
import { NativeWindowHost } from 'blinc_ts/native/window';
import { createScene } from './scene.js';

const native = loadNative();
// UI input comes from the window; raw device motion is unnecessary here.
native.window.Window.listenDeviceEvents(window.DeviceEvents.Never);
export const session = createHmrSession(
  import.meta.hot,
  () => new NativeWindowHost(native, { minWidth: 480 }),
);
await session.host.ready;
session.mount((host, scope) => {
  const { layout, root, glass, toggle } = createScene(native, scope);
  host.attachScene(layout, root, { cornerShape: 2 }, scope);
  let x = 0,
    y = 0;
  host.onEvent((event) => {
    if (event.kind === 'CursorMoved') {
      const ratio = host.window.scaleFactor();
      x = event.x / ratio;
      y = event.y / ratio;
    } else if (
      event.kind === 'MouseInput' &&
      host.stats !== undefined &&
      event.state === window.MouseElementState.Pressed
    ) {
      if (layout.hitTest(root, x, y).some((hit) => hit.nodeId === glass.id)) {
        toggle();
      }
    }
  }, scope);
});

if (import.meta.hot) {
  import.meta.hot.accept();
}
