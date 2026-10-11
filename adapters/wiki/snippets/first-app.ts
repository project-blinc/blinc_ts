/** A first app: a window, a host, a theme, and a button that counts. */
import { Scope } from 'blinc_ts/hmr';
import { loadNative } from 'blinc_ts/native';
import { Host } from 'blinc_ts/native/host';
import { NativeWindowHost } from 'blinc_ts/native/window';
import { ThemeState, neutralTheme } from 'blinc_ts/theme';
import { addUserAgent } from 'blinc_ts/theme/user-agent';

export async function firstApp(): Promise<void> {
  // The addon, on Node's main thread, and a window with its GPU device.
  const native = loadNative();
  const window = new NativeWindowHost(native, { title: 'Hello', width: 480, height: 320 });
  await window.ready;

  // Everything below is released with this scope.
  const scope = new Scope();
  const host = Host.create(native, scope);
  const theme = new ThemeState(native.createReactive(scope), neutralTheme, { scope });
  theme.attach(host.layout);
  theme.followSystem(window, scope);
  addUserAgent(host.layout);

  // Elements, as a document has them; the user-agent sheet gives them their looks.
  const row = host.createElement('div');
  row.setAttribute('style', 'flex-direction: row; align-items: center; gap: 12px; padding: 24px');
  const button = host.createElement('button');
  button.appendChild(host.createTextNode('Count'));
  const count = host.createTextNode('0');
  button.addEventListener('click', () => {
    count.data = String(Number(count.data) + 1);
  });
  row.appendChild(button);
  row.appendChild(count);
  host.root.appendChild(row);

  // Shown in the window until it closes.
  host.mount(window, { scope });
  await window.closed;
  scope.dispose();
}
