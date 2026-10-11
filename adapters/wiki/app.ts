/// <reference types="vite/client" />
/**
 * The wiki under a dev server: an edit to any page or part mounts the wiki again in the same
 * window, on the page the reader was reading. Run with `npm run wiki:dev` in `adapters`.
 */
import { createHmrSession } from 'blinc_ts/hmr';
import { loadNative } from 'blinc_ts/native';
import { mountWiki, windowShell } from './launch.js';

export const session = createHmrSession(import.meta.hot, () => windowShell(loadNative()));
await session.host.window.ready;
session.mount(mountWiki);

if (import.meta.hot) {
  import.meta.hot.accept();
}
