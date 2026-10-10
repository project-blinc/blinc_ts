import type { Signal } from 'blinc_ts/native';
import type { HostElement } from 'blinc_ts/native/host';
import type { Child } from '#jsx/jsx-runtime';
import { For, Match, Show, Switch, createContext } from '#jsx/flow';
import { computed, effect, onCleanup, signal, useContext } from '#jsx/owner';

/** What the views below read and the test writes. */
export interface State {
  on: Signal<boolean>;
  color: Signal<string>;
  width: Signal<number>;
  label: Signal<string | undefined>;
  count: Signal<number>;
  items: Signal<readonly string[]>;
  mode: Signal<string>;
  log: string[];
  refs: Record<string, HostElement>;
}

const remember = (state: State, name: string) => (e: HostElement) => {
  state.refs[name] = e;
};

/** Props that follow a source: attributes, class, style properties and a whole style. */
export const props = (s: State): Child => (
  <div
    id="box"
    ref={remember(s, 'box')}
    class={() => (s.on.get() ? 'on' : 'off')}
    data-state={s.color}
    data-flag={() => s.on.get()}
    hidden={() => s.on.get()}
    title={s.label}
    style={{ width: s.width, height: 20, background: () => s.color.get() }}
  />
);

export const wholeStyle = (s: State): Child => (
  <div
    id="whole"
    ref={remember(s, 'whole')}
    style={() => (s.on.get() ? { width: 30, height: 10 } : { height: 12, opacity: 0.5 })}
  />
);

/** Text that follows a source is rewritten in place. */
export const text = (s: State): Child => (
  <div id="text" ref={remember(s, 'text')}>
    Count: {s.count}
    {() => (s.on.get() ? <b>yes</b> : 'no')}
  </div>
);

/** A component with its own state, and cleanups that end with it. */
function Counter(p: { name: string }): Child {
  const own = signal(0);
  effect(() => {
    s_log?.push(`${p.name}:${own.get()}`);
  });
  onCleanup(() => s_log?.push(`${p.name}:cleanup`));
  return <i id={p.name} onClick={() => own.set(own.get() + 1)} />;
}
let s_log: string[] | undefined;

export const show = (s: State): Child => {
  s_log = s.log;
  return (
    <div id="show" ref={remember(s, 'show')}>
      <Show when={s.on} fallback={<em id="off" />}>
        <Counter name="a" />
      </Show>
      <Show when={() => s.count.get()}>{(n: number) => <u id="keyed">{`n=${n}`}</u>}</Show>
      <Show when={s.count}>
        <p id="plain" />
      </Show>
    </div>
  );
};

export const list = (s: State): Child => (
  <ul id="list" ref={remember(s, 'list')}>
    <For each={s.items} fallback={<li id="none" />}>
      {(item: string, index: () => number) => (
        <li
          data-item={item}
          data-at={index}
          ref={(e: HostElement) => {
            s.refs[item] = e;
          }}
        >
          {item}
        </li>
      )}
    </For>
  </ul>
);

/** A list under a `Show`: ending the show must end the items. */
export const nested = (s: State): Child => (
  <div id="nested" ref={remember(s, 'nested')}>
    <Show when={s.on}>
      <For each={s.items}>
        {(item: string) => {
          onCleanup(() => s.log.push(`end:${item}`));
          return <span>{() => (s.on.get() ? item : item)}</span>;
        }}
      </For>
    </Show>
  </div>
);

export const choose = (s: State): Child => (
  <div id="choose" ref={remember(s, 'choose')}>
    <Switch fallback={<i id="other" />}>
      <Match when={() => s.mode.get().startsWith('a')}>
        <b id="a" />
      </Match>
      <Match when={() => s.mode.get() === 'b'}>
        <b id="b" />
      </Match>
    </Switch>
  </div>
);

const Theme = createContext('plain');
function Leaf(): Child {
  const theme = useContext(Theme);
  return <span data-theme={theme} />;
}
export const context = (s: State): Child => (
  <div id="context" ref={remember(s, 'context')}>
    <Leaf />
    <Theme.Provider value="dark">
      <Leaf />
      <Theme.Provider value="warm">
        <Leaf />
      </Theme.Provider>
    </Theme.Provider>
  </div>
);

function Derived(p: { s: State }): Child {
  const double = computed(() => p.s.count.get() * 2);
  return <div id="derived" data-double={double} ref={remember(p.s, 'derived')} />;
}
export const derived = (s: State): Child => <Derived s={s} />;

/** A function child is run in a fresh scope each time, and a scope it does not build in ends at once. */
export const fresh = (s: State): Child => (
  <div id="fresh" ref={remember(s, 'fresh')}>
    {() => {
      const n = s.count.get();
      onCleanup(() => s.log.push(`end:${n}`));
      return n;
    }}
  </div>
);
