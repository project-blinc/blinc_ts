/**
 * Tabs: `Tabs.Root` holds the `value` of the tab chosen (shared as `value`/`defaultValue` with
 * `onValueChange`; the first enabled tab's when none is given), `List` holds the `Tab`s and the
 * `Panel` of each value shows while its tab is chosen. A tab is chosen by a click, Enter or
 * Space; the arrows (Up and Down when vertical), Home and End move focus among the enabled tabs,
 * and choose as they go with `activateOnFocus`. Only the chosen tab is in the tab order.
 */
import type { HostElement } from 'blinc_ts/native/host';
import { Signal } from 'blinc_ts/native';
import { createContext, Show } from '#jsx/flow';
import { onCleanup, read, signal, useContext, useHost, type Source } from '#jsx/owner';
import type { Child, JsxNode } from '#jsx/jsx-runtime';
import { descendants, step } from './dom.js';
import { flag, merge, type PartProps } from './props.js';
import { held } from './state.js';

interface Tabs {
  /** The value of the tab chosen, or of the first enabled one when none is chosen. */
  current(): string | undefined;
  choose(value: string): void;
  orientation(): 'horizontal' | 'vertical';
  variant: 'segmented' | 'underline';
  register(
    value: string,
    disabled: () => boolean,
    element: () => HostElement | undefined,
  ): () => void;
  /** The element of the tab chosen, and of the list that holds the tabs, for what follows it. */
  active(): HostElement | undefined;
  list: HostElement | undefined;
}
const TabsContext = createContext<Tabs>();

export interface TabsRootProps extends PartProps {
  value?: Source<string>;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  orientation?: Source<'horizontal' | 'vertical'>;
  /** `segmented`, a tray with a raised pill under the chosen tab, or `underline`, a bar. */
  variant?: 'segmented' | 'underline';
}

function Root(props: TabsRootProps): JsxNode {
  const { value, defaultValue, onValueChange, orientation, variant, ...rest } = props;
  const chosen = held<string | undefined>(
    value as Source<string | undefined> | undefined,
    defaultValue,
    (next) => onValueChange?.(next as string),
  );
  const tabs: Signal<
    readonly {
      value: string;
      disabled: () => boolean;
      element: () => HostElement | undefined;
    }[]
  > = signal([]);
  const along = () => read(orientation) ?? 'horizontal';
  const context: Tabs = {
    current: () => {
      const now = chosen.get();
      if (now !== undefined) {
        return now;
      }
      return tabs.get().find((t) => !t.disabled())?.value;
    },
    choose: (v) => chosen.set(v),
    orientation: along,
    variant: variant ?? 'segmented',
    active: () => {
      const now = context.current();
      return tabs
        .peek()
        .find((t) => t.value === now)
        ?.element();
    },
    list: undefined,
    register: (v, disabled, element) => {
      const entry = { value: v, disabled, element };
      tabs.set([...tabs.peek(), entry]);
      return () => tabs.set(tabs.peek().filter((t) => t !== entry));
    },
  };
  return (
    <TabsContext.Provider value={context}>
      <div
        {...merge(
          { class: 'bui-tabs', 'data-orientation': along, 'data-variant': context.variant },
          rest,
        )}
      />
    </TabsContext.Provider>
  );
}

function List(
  props: PartProps & { activateOnFocus?: boolean; loop?: boolean; indicator?: boolean },
): JsxNode {
  const { activateOnFocus, loop, indicator, children, ...rest } = props;
  const tabs = useContext(TabsContext);
  let list: HostElement | undefined;
  const key = (event: { key: string; target: unknown; preventDefault(): void }) => {
    const vertical = tabs.orientation() === 'vertical';
    const forward = vertical ? 'ArrowDown' : 'ArrowRight';
    const back = vertical ? 'ArrowUp' : 'ArrowLeft';
    if (!list || ![forward, back, 'Home', 'End'].includes(event.key)) {
      return;
    }
    const enabled = descendants(
      list,
      (e) => e.classList.contains('bui-tabs-tab') && !e.hasAttribute('disabled'),
    );
    const from = enabled.find((t) => t === event.target);
    if (!from) {
      return;
    }
    const next =
      event.key === 'Home'
        ? enabled[0]
        : event.key === 'End'
          ? enabled[enabled.length - 1]
          : step(enabled, from, event.key === forward ? 1 : -1, loop !== false);
    event.preventDefault();
    next?.focus();
    const value = next?.getAttribute('data-value');
    if (activateOnFocus && value !== null && value !== undefined) {
      tabs.choose(value);
    }
  };
  return (
    <div
      {...merge(
        {
          class: 'bui-tabs-list',
          role: 'tablist',
          'aria-orientation': tabs.orientation,
          'data-orientation': tabs.orientation,
          'data-variant': tabs.variant,
          onKeyDown: key,
          ref: (e: HostElement) => {
            list = e;
            tabs.list = e;
          },
        },
        rest,
      )}
    >
      {/* First, so it is drawn under the tabs: what comes later in a parent draws over. */}
      {indicator === false ? null : <Indicator />}
      {children}
    </div>
  );
}

function Tab(props: PartProps & { value: string; disabled?: Source<boolean> }): JsxNode {
  const { value, disabled, ...rest } = props;
  const tabs = useContext(TabsContext);
  const off = () => Boolean(read(disabled));
  let self: HostElement | undefined;
  onCleanup(tabs.register(value, off, () => self));
  const active = () => tabs.current() === value;
  return (
    <button
      {...merge(
        {
          class: 'bui-tabs-tab',
          type: 'button',
          role: 'tab',
          'data-value': value,
          'aria-selected': active,
          tabindex: () => (active() ? 0 : -1),
          'data-active': flag(active),
          'data-disabled': flag(off),
          'data-orientation': tabs.orientation,
          disabled: off,
          ref: (e: HostElement) => {
            self = e;
          },
          onClick: () => {
            if (!off()) {
              tabs.choose(value);
            }
          },
        },
        rest,
      )}
    />
  );
}

function Panel(props: PartProps & { value: string; keepMounted?: boolean }): JsxNode {
  const { value, keepMounted, children, ...rest } = props;
  const tabs = useContext(TabsContext);
  const shown = () => tabs.current() === value;
  return (
    <div
      {...merge(
        {
          class: 'bui-tabs-panel',
          role: 'tabpanel',
          hidden: () => !shown(),
          'data-hidden': flag(() => !shown()),
          'data-orientation': tabs.orientation,
        },
        rest,
      )}
    >
      {keepMounted ? children : <Show when={shown}>{children as Child}</Show>}
    </div>
  );
}

/**
 * What marks the chosen tab, and slides to the next as it is chosen: a raised pill behind it, or
 * a bar under it (beside it when vertical). The list holds it. It is placed after layout, from
 * where the tab is, and eases from then on.
 */
function Indicator(props: PartProps): JsxNode {
  const tabs = useContext(TabsContext);
  const host = useHost();
  let element: HostElement | undefined;
  let placed = '';
  let ready = false;
  const release = host.layout.onLaidOut(() => {
    const list = tabs.list;
    const tab = tabs.active();
    if (!element || element.destroyed || !list || !tab || !tab.isConnected) {
      return false;
    }
    // Read before writing: a write makes the bounds unreadable until layout runs again.
    const [lx = 0, ly = 0] = list.bounds();
    const [tx = 0, ty = 0, tw = 0, th = 0] = tab.bounds();
    const vertical = tabs.orientation() === 'vertical';
    // The pill covers the tab; the bar runs along its edge, so it has only the one axis to follow.
    const box: Record<string, number> =
      tabs.variant === 'segmented'
        ? { left: tx - lx, top: ty - ly, width: tw, height: th }
        : vertical
          ? { top: ty - ly, height: th }
          : { left: tx - lx, width: tw };
    const key = JSON.stringify(box);
    if (key === placed) {
      if (!ready) {
        // Placed once without easing; from now on it eases.
        ready = true;
        element.setAttribute('data-ready', '');
      }
      return false;
    }
    placed = key;
    for (const [name, value] of Object.entries(box)) {
      element.setProperty(name, value);
    }
    return true;
  });
  onCleanup(release);
  return (
    <span
      {...merge(
        {
          class: 'bui-tabs-indicator',
          'data-orientation': tabs.orientation,
          'data-variant': tabs.variant,
          ref: (e: HostElement) => {
            element = e;
          },
        },
        props,
      )}
    />
  );
}

export const Tabs = { Root, List, Tab, Panel };
