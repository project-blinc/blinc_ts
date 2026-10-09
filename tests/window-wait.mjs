// Waiting on native window frames in tests.
//
// The system holds frames back from a window it reports occluded, hidden or
// minimized, for example when another application's window covers a test
// window. Time spent that way is not the host's: the deadline counts only
// time the window could present. A wait that fails reports the window state.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Window attributes for test windows. They stay at the normal level: on
 * macOS a floating (always-on-top) window of a background process was at
 * times never put on screen while normal windows opened at the same moment
 * were, and covered time is not counted against a wait anyway.
 */
export const testWindow = {};

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
