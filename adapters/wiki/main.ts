/** Opens the wiki in a window. Run with `npm run wiki` in `adapters`. */
import { loadNative } from 'blinc_ts/native';
import { Scope } from 'blinc_ts/hmr';
import { Host } from 'blinc_ts/native/host';
import { NativeWindowHost } from 'blinc_ts/native/window';
import { ThemeState } from 'blinc_ts/theme';
import { addUserAgent } from 'blinc_ts/theme/user-agent';
import { jsx, mount } from '#jsx/jsx-runtime';
import { addBaseUi } from '../base-ui/sheet.js';
import { baseUiTheme } from '../base-ui/theme.js';
import { addWikiSheet } from './sheet.js';
import { Wiki } from './wiki.js';

const native = loadNative();
const window = new NativeWindowHost(native, {
  title: 'blinc_ts wiki',
  width: 1120,
  height: 780,
  minWidth: 760,
  minHeight: 480,
});
await window.ready;
const scope = new Scope();
const context = native.createReactive(scope);
const host = Host.create(native, scope);
const theme = new ThemeState(context, baseUiTheme, { scheme: 'light', scope });
theme.attach(host.layout);
addUserAgent(host.layout);
addBaseUi(host.layout);
addWikiSheet(host.layout);
host.onStyleErrors((errors) => {
  for (const error of errors) {
    console.error(error);
  }
});
mount(host, jsx(Wiki, { theme }), { context, scope });
host.mount(window, { scope });
await window.closed;
scope.dispose();
