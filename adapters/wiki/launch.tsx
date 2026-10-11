/** What running the wiki takes, apart from how the window it is shown in comes to be. */
import type { NativeBindings } from 'blinc_ts/native';
import type { DisposableHost, Scope } from 'blinc_ts/hmr';
import { Host } from 'blinc_ts/native/host';
import { NativeWindowHost } from 'blinc_ts/native/window';
import { ThemeState } from 'blinc_ts/theme';
import { addUserAgent } from 'blinc_ts/theme/user-agent';
import { addUtilities } from 'blinc_ts/theme/utilities';
import { effect } from '#jsx/owner';
import { jsx, mount } from '#jsx/jsx-runtime';
import { addBaseUi } from '../base-ui/sheet.js';
import { baseUiTheme } from '../base-ui/theme.js';
import { pages as allPages, type WikiPage } from './pages.js';
import { addWikiSheet } from './sheet.js';
import { Wiki } from './wiki.js';
import type { PerfSample, PerfSource } from './hud.js';

/** What outlives a hot reload: where the reader is, and the scheme they chose. */
export interface WikiState {
  page: string;
  scheme: 'light' | 'dark';
  /** Whether the performance panel shows. */
  hud: boolean;
}

/** The persistent part of a running wiki: what a reload keeps and where the tree is shown. */
export interface Shell extends DisposableHost {
  readonly native: NativeBindings;
  readonly state: WikiState;
  /** Show `host`'s tree until `scope` ends. */
  show(host: Host, scope: Scope): void;
  /** What the window that shows the wiki has drawn, for the performance panel. */
  frames?(): Pick<PerfSample, 'textures' | 'frameTime' | 'drawCalls' | 'frames'>;
}

export interface WindowShell extends Shell {
  readonly window: NativeWindowHost;
}

/** A shell that shows the wiki in a window of its own. */
export function windowShell(native: NativeBindings): WindowShell {
  const window = new NativeWindowHost(native, {
    title: 'blinc_ts wiki',
    width: 1120,
    height: 780,
    minWidth: 760,
    minHeight: 480,
  });
  return {
    native,
    window,
    state: { page: allPages[0]!.id, scheme: 'light', hud: false },
    show: (host, scope) => {
      host.mount(window, { scope });
    },
    frames: () => ({
      textures: window.stats?.textureBytes,
      frameTime: window.frameTime,
      drawCalls: window.stats?.drawCalls,
      frames: window.frames,
    }),
    dispose: () => window.dispose(),
  };
}

/** Build the wiki on a new host, show it through `shell`, and release it all with `scope`. */
export function mountWiki(shell: Shell, scope: Scope, pages: readonly WikiPage[] = allPages): void {
  const { native, state } = shell;
  const context = native.createReactive(scope);
  const host = Host.create(native, scope);
  const theme = new ThemeState(context, baseUiTheme, { scheme: state.scheme, scope });
  theme.attach(host.layout);
  addUserAgent(host.layout);
  addBaseUi(host.layout);
  addWikiSheet(host.layout);
  addUtilities(host.layout);
  host.onStyleErrors((errors) => {
    for (const error of errors) {
      console.error(error);
    }
  });
  const page = context.signal(pages.some((p) => p.id === state.page) ? state.page : pages[0]!.id);
  const hud = context.signal(state.hud);
  const perf: PerfSource = () => ({
    footprint: native.memoryFootprint(),
    heap: process.memoryUsage().heapUsed,
    nodes: host.layout.disposed ? 0 : host.layout.size,
    ...shell.frames?.(),
  });
  const Remembered = () => {
    effect(() => {
      state.page = page.get();
      state.hud = hud.get();
      state.scheme = theme.preference === 'dark' ? 'dark' : 'light';
    });
    return jsx(Wiki, { theme, page, pages, perf, hud });
  };
  mount(host, jsx(Remembered, {}), { context, scope });
  shell.show(host, scope);
}
