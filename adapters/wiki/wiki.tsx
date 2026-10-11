/** The wiki: a navigation column beside the page it names. */
import type { Signal } from 'blinc_ts/native';
import type { ThemeState } from 'blinc_ts/theme';
import type { HostElement } from 'blinc_ts/native/host';
import type { JsxNode } from '#jsx/jsx-runtime';
import { effect, signal } from '#jsx/owner';
import { Moon, Sun } from '../base-ui/icons.js';
import { Switch, Toggle } from '../base-ui/toggle.js';
import { PerfHud, type PerfSource } from './hud.js';
import { WikiTheme } from './context.js';
import { pages as all, type WikiPage } from './pages.js';

/** The pages grouped by section, in order. */
function sections(pages: readonly WikiPage[]): { name: string; pages: WikiPage[] }[] {
  const out: { name: string; pages: WikiPage[] }[] = [];
  for (const page of pages) {
    let group = out.find((g) => g.name === page.section);
    if (!group) {
      group = { name: page.section, pages: [] };
      out.push(group);
    }
    group.pages.push(page);
  }
  return out;
}

export interface WikiProps {
  theme: ThemeState;
  /** The page shown, by id; shared, so something outside can choose one. */
  page?: Signal<string>;
  pages?: readonly WikiPage[];
  /** Where the performance panel reads from; without it the header offers none. */
  perf?: PerfSource;
  /** Whether the performance panel shows; shared, so it outlives a reload. */
  hud?: Signal<boolean>;
}

export function Wiki(props: WikiProps): JsxNode {
  const pages = props.pages ?? all;
  const page = props.page ?? signal(pages[0]!.id);
  const hud = props.hud ?? signal(false);
  let main: HostElement | undefined;
  // A new page starts at its top.
  effect(() => {
    page.get();
    main?.scrollBy(-main.scrollLeft, -main.scrollTop);
  });
  return (
    <div class="wiki">
      <div class="wiki-body">
        <nav class="wiki-nav">
          {sections(pages).map((group) => (
            <div style={{ gap: 2 }}>
              <div class="wiki-section">{group.name.toUpperCase()}</div>
              {group.pages.map((entry) => (
                <button
                  class="wiki-link"
                  type="button"
                  data-page={entry.id}
                  data-active={() => (page.get() === entry.id ? '' : undefined)}
                  onClick={() => page.set(entry.id)}
                >
                  {entry.title}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <main
          class="wiki-main"
          ref={(element: HostElement) => {
            main = element;
          }}
        >
          <WikiTheme.Provider value={props.theme}>
            {() => pages.find((entry) => entry.id === page.get())?.view()}
          </WikiTheme.Provider>
        </main>
      </div>
      {/* Last, so its shadow is drawn over the page that scrolls under it. */}
      <header class="wiki-header">
        <div class="wiki-brand">blinc_ts</div>
        <div class="wiki-tagline">Live examples, running on Blinc</div>
        <div class="wiki-spacer" />
        {props.perf ? (
          <Toggle class="wiki-hud-toggle" pressed={hud}>
            Performance
          </Toggle>
        ) : null}
        <Switch.Root
          size="lg"
          aria-label="Dark theme"
          defaultChecked={props.theme.preference === 'dark'}
          onCheckedChange={(dark) => props.theme.setScheme(dark ? 'dark' : 'light')}
        >
          <Switch.Thumb>
            <Sun class="bui-thumb-unchecked" />
            <Moon class="bui-thumb-checked" />
          </Switch.Thumb>
        </Switch.Root>
      </header>
      {() => (props.perf && hud.get() ? <PerfHud source={props.perf} page={page} /> : null)}
    </div>
  );
}
