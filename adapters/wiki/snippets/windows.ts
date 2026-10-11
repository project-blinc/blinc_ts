/** A window's lifecycle: open, wait for its device, show a host, watch it, and close. */
import type { NativeBindings } from 'blinc_ts/native';
import type { Host } from 'blinc_ts/native/host';
import { NativeWindowHost } from 'blinc_ts/native/window';

export async function showInAWindow(native: NativeBindings, host: Host): Promise<void> {
  const window = new NativeWindowHost(native, {
    title: 'Blinc',
    width: 720,
    height: 480,
    minWidth: 360,
    // A frameless window that shows the desktop through it, blurred, where nothing is drawn.
    decorations: false,
    transparent: true,
    blur: true,
  });
  await window.ready; // the surface and the GPU device
  host.mount(window); // the host's root, laid out at the window's size, and its input
  window.onEvent((event) => {
    if (event.kind === 'Resized') {
      console.log('resized', window.window.width(), window.window.height());
    }
  });
  // Every presented frame read back, for tests and tools; it costs a second pass.
  const stop = window.captureFrames((frame) => console.log(frame.index, frame.time));
  stop();
  console.log(window.frames, window.stats?.drawCalls, window.presentable);
  await window.closed;
}
