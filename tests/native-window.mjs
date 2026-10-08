import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { loadNative } from '../dist/native/index.js';
import { NativeProbeHost } from '../dist/native/probe.js';

const host = new NativeProbeHost(loadNative(), {
  title: 'Blinc native smoke test',
  width: 320,
  height: 240,
});
try {
  await host.ready;
  await delay(100);
  host.window.setSize(400, 300);
  await delay(150);
  assert.equal(host.disposed, false);
  assert(host.window.width() > 0 && host.window.height() > 0);
  assert.equal(host.device.takeError(), null);
  console.log(
    JSON.stringify({
      test: 'native window render and resize',
      platform: host.window.platform(),
      width: host.window.width(),
      height: host.window.height(),
    }),
  );
} finally {
  host.dispose();
  host.dispose();
}
