/**
 * A panel that opens and closes: `Collapsible.Root` holds `open` (shared as `open`/`defaultOpen`
 * with `onOpenChange`), `Trigger` toggles it and `Panel` shows while it is open, unmounted
 * otherwise unless `keepMounted`. They show it as `data-open`/`data-closed`.
 */
import type { HostElement } from 'blinc_ts/native/host';
import { createContext, Show } from '#jsx/flow';
import { read, useContext, type Source } from '#jsx/owner';
import type { Child, JsxNode } from '#jsx/jsx-runtime';
import { Chevron } from './icons.js';
import { presence } from './presence.js';
import { flag, merge, type PartProps } from './props.js';
import { held } from './state.js';

export interface CollapsibleState {
  open(): boolean;
  disabled(): boolean;
  toggle(): void;
}

export const CollapsibleContext = createContext<CollapsibleState>();

export interface CollapsibleRootProps extends PartProps {
  open?: Source<boolean>;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: Source<boolean>;
}

function Root(props: CollapsibleRootProps): JsxNode {
  const { open, defaultOpen, onOpenChange, disabled, ...rest } = props;
  const state = held(open, defaultOpen ?? false, onOpenChange);
  const off = () => Boolean(read(disabled));
  const context: CollapsibleState = {
    open: () => state.get(),
    disabled: off,
    toggle: () => {
      if (!off()) {
        state.set(!state.get());
      }
    },
  };
  return (
    <CollapsibleContext.Provider value={context}>
      <div
        {...merge(
          {
            class: 'bui-collapsible',
            'data-open': flag(context.open),
            'data-closed': flag(() => !context.open()),
            'data-disabled': flag(off),
            // What opens is revealed by the size easing, not stretched.
            ref: (e: HostElement) => e.animateLayout({ position: false }),
          },
          rest,
        )}
      />
    </CollapsibleContext.Provider>
  );
}

function Trigger(props: PartProps & { chevron?: boolean }): JsxNode {
  const { chevron, children, ...rest } = props;
  const state = useContext(CollapsibleContext);
  return (
    <button
      {...merge(
        {
          class: 'bui-collapsible-trigger',
          type: 'button',
          'aria-expanded': () => state.open(),
          'data-panel-open': flag(state.open),
          'data-disabled': flag(state.disabled),
          disabled: state.disabled,
          onClick: state.toggle,
        },
        rest,
      )}
    >
      {children}
      {chevron === false ? null : <Chevron />}
    </button>
  );
}

function Panel(props: PartProps & { keepMounted?: boolean }): JsxNode {
  const { keepMounted, children, ...rest } = props;
  const state = useContext(CollapsibleContext);
  let panel: HostElement | undefined;
  // Built while open and while it closes, so the content is seen folding away.
  const present = presence(state.open, () => panel);
  return (
    <div
      {...merge(
        {
          class: 'bui-collapsible-panel',
          hidden: () => !present(),
          'data-open': flag(state.open),
          'data-closed': flag(() => !state.open()),
          // Its height eases between none and its own, the content clipped to it.
          ref: (e: HostElement) => {
            panel = e;
            e.animateLayout({ position: false });
          },
        },
        rest,
      )}
    >
      {keepMounted ? children : <Show when={present}>{children as Child}</Show>}
    </div>
  );
}

export const Collapsible = { Root, Trigger, Panel };
