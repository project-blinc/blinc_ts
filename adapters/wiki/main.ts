/** Opens the wiki in a window. Run with `npm run wiki` in `adapters`. */
import { AppSession } from 'blinc_ts/hmr';
import { loadNative } from 'blinc_ts/native';
import { mountWiki, windowShell } from './launch.js';

const shell = windowShell(loadNative());
await shell.window.ready;
const app = new AppSession(shell);
app.mount(mountWiki);
await shell.window.closed;
app.dispose();
