/**
 * A panel that opens and closes: `Collapsible.Root` holds `open` (shared as `open`/`defaultOpen`
 * with `onOpenChange`), `Trigger` toggles it and `Panel` shows while it is open, unmounted
 * otherwise unless `keepMounted`. They show it as `data-open`/`data-closed`.
 */
import { createContext, Show } from '#jsx/flow';
import { read, useContext, type Source } from '#jsx/owner';
import type { Child, JsxNode } from '#jsx/jsx-runtime';
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
          },
          rest,
        )}
      />
    </CollapsibleContext.Provider>
  );
}

function Trigger(props: PartProps): JsxNode {
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
        props,
      )}
    />
  );
}

function Panel(props: PartProps & { keepMounted?: boolean }): JsxNode {
  const { keepMounted, children, ...rest } = props;
  const state = useContext(CollapsibleContext);
  return (
    <div
      {...merge(
        {
          class: 'bui-collapsible-panel',
          hidden: () => !state.open(),
          'data-open': flag(state.open),
          'data-closed': flag(() => !state.open()),
        },
        rest,
      )}
    >
      {keepMounted ? children : <Show when={state.open}>{children as Child}</Show>}
    </div>
  );
}

export const Collapsible = { Root, Trigger, Panel };
