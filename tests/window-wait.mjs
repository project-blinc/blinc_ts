// Waiting on native window frames in tests.
//
// The system holds frames back from a window it reports occluded, hidden or
// minimized, for example when another application's window covers a test
// window. Time spent that way is not the host's: the deadline counts only
// time the window could present. A wait that fails reports the window state.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { window as win } from '../dist/native/index.js';

/** Window attributes for test windows: above other applications' windows, so they are not covered. */
export const testWindow = { windowLevel: win.WindowLevel.AlwaysOnTop };

export async function waitForWindow(
  host,
  condition,
  message,
  { budgetMs = 5000, capMs = 60000 } = {},
) {
  const started = performance.now();
  let presentableMs = 0;
  let last = started;
  while (!condition()) {
    assert.equal(host.error, undefined);
    const now = performance.now();
    if (host.disposed || host.presentable) {
      presentableMs += now - last;
    }
    last = now;
    if (presentableMs > budgetMs || now - started > capMs) {
      assert.fail(
        `${message}: ${JSON.stringify({
          frames: host.frames,
          framePending: host.disposed ? null : host.framePending,
          presentable: host.disposed ? null : host.presentable,
          visible: host.disposed ? null : host.window.isVisible(),
          minimized: host.disposed ? null : host.window.isMinimized(),
          focused: host.disposed ? null : host.window.hasFocus(),
          presentableMs: Math.round(presentableMs),
          waitedMs: Math.round(now - started),
          ...(host.disposed ? {} : host.diagnostics),
        })}`,
      );
    }
    await delay(16);
  }
}
