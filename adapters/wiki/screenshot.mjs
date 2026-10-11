// Captures the wiki's window as macOS draws it, for the README: the system cuts the window at its
// own corner radius, leaving the corners transparent, with no shadow around it. macOS only, with
// the display awake and the screen unlocked. Run with:
// npm run wiki:screenshot -- [page] [light|dark] [out.png] [scroll, in pixels]
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadNative } from 'blinc_ts/native';
import { AppSession } from 'blinc_ts/hmr';
import { mountWiki, windowShell } from '../dist/wiki/launch.js';

if (process.platform !== 'darwin') {
  throw new Error('The screenshot is taken with macOS screencapture');
}
const [page = 'glass', scheme = 'light', out = '../docs/assets/wiki.png', scroll = '0'] =
  process.argv.slice(2);
const shell = windowShell(loadNative());
shell.state.page = page;
shell.state.scheme = scheme === 'dark' ? 'dark' : 'light';
await shell.window.ready;
let host;
const app = new AppSession({
  ...shell,
  show: (shown, scope) => {
    host = shown;
    shell.show(shown, scope);
  },
  dispose: () => shell.dispose(),
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  app.mount((s, scope) => mountWiki(s, scope));
  shell.window.window.focus();
  // A window the system does not show draws nothing: wait for frames, and for images and motion
  // to settle once they come.
  const started = shell.window.frames;
  for (let i = 0; i < 100 && shell.window.frames - started < 2; i++) {
    await wait(100);
  }
  if (shell.window.frames - started < 2) {
    throw new Error('The window drew nothing: wake the display, unlock the screen and try again');
  }
  // The page scrolled to where the shot should look.
  const main = (function find(node) {
    if (node.className === 'wiki-main') {
      return node;
    }
    for (let child = node.firstChild; child; child = child.nextSibling) {
      const found = child.className !== undefined && find(child);
      if (found) {
        return found;
      }
    }
    return null;
  })(host.root);
  main?.scrollBy(0, Number(scroll));
  await wait(2500);
  const windows = JSON.parse(
    execFileSync('osascript', [
      '-l',
      'JavaScript',
      '-e',
      'ObjC.import("CoreGraphics"); JSON.stringify(ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID))))',
    ]).toString(),
  );
  const own = windows.find((w) => w.kCGWindowOwnerPID === process.pid && w.kCGWindowLayer === 0);
  if (!own) {
    throw new Error('The wiki window is not on screen');
  }
  const path = resolve(out);
  execFileSync('screencapture', [`-l${own.kCGWindowNumber}`, '-o', '-x', path]);
  console.log(`Captured ${page} (${scheme}) to ${path}`);
} finally {
  app.dispose();
}
process.exit(0);
