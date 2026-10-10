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
import { onCleanup, read, signal, useContext, type Source } from '#jsx/owner';
import type { Child, JsxNode } from '#jsx/jsx-runtime';
import { descendants, step } from './dom.js';
import { flag, merge, type PartProps } from './props.js';
import { held } from './state.js';

interface Tabs {
  /** The value of the tab chosen, or of the first enabled one when none is chosen. */
  current(): string | undefined;
  choose(value: string): void;
  orientation(): 'horizontal' | 'vertical';
  register(value: string, disabled: () => boolean): () => void;
}
const TabsContext = createContext<Tabs>();

export interface TabsRootProps extends PartProps {
  value?: Source<string>;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  orientation?: Source<'horizontal' | 'vertical'>;
}

function Root(props: TabsRootProps): JsxNode {
  const { value, defaultValue, onValueChange, orientation, ...rest } = props;
  const chosen = held<string | undefined>(
    value as Source<string | undefined> | undefined,
    defaultValue,
    (next) => onValueChange?.(next as string),
  );
  const tabs: Signal<readonly { value: string; disabled: () => boolean }[]> = signal([]);
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
    register: (v, disabled) => {
      const entry = { value: v, disabled };
      tabs.set([...tabs.peek(), entry]);
      return () => tabs.set(tabs.peek().filter((t) => t !== entry));
    },
  };
  return (
    <TabsContext.Provider value={context}>
      <div {...merge({ class: 'bui-tabs', 'data-orientation': along }, rest)} />
    </TabsContext.Provider>
  );
}

function List(props: PartProps & { activateOnFocus?: boolean; loop?: boolean }): JsxNode {
  const { activateOnFocus, loop, ...rest } = props;
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
          onKeyDown: key,
          ref: (e: HostElement) => {
            list = e;
          },
        },
        rest,
      )}
    />
  );
}

function Tab(props: PartProps & { value: string; disabled?: Source<boolean> }): JsxNode {
  const { value, disabled, ...rest } = props;
  const tabs = useContext(TabsContext);
  const off = () => Boolean(read(disabled));
  onCleanup(tabs.register(value, off));
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

export const Tabs = { Root, List, Tab, Panel };
