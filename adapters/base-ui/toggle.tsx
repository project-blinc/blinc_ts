/**
 * Two-state buttons: `Toggle`, `Switch` and `Checkbox`. Each is a `button`, so focus, Enter and
 * Space come with it, that holds its state, shared with the user as `checked` or `pressed`
 * (see ./state) and shown as `data-checked`/`data-unchecked`, `data-pressed`, `data-disabled`.
 */
import { createContext, Show } from '#jsx/flow';
import { read, useContext, type Source } from '#jsx/owner';
import type { Child, JsxNode } from '#jsx/jsx-runtime';
import { flag, merge, type PartProps } from './props.js';
import { held } from './state.js';

/** What the parts of one control read of it. */
interface Control {
  checked(): boolean;
  indeterminate(): boolean;
  disabled(): boolean;
}

export interface ToggleProps extends PartProps {
  pressed?: Source<boolean>;
  defaultPressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
  disabled?: Source<boolean>;
}

/** A button that stays pressed or not. */
export function Toggle(props: ToggleProps): JsxNode {
  const { pressed, defaultPressed, onPressedChange, disabled, ...rest } = props;
  const state = held(pressed, defaultPressed ?? false, onPressedChange);
  const off = () => Boolean(read(disabled));
  return (
    <button
      {...merge(
        {
          class: 'bui-toggle',
          type: 'button',
          'aria-pressed': () => state.get(),
          'data-pressed': flag(() => state.get()),
          'data-disabled': flag(off),
          disabled: off,
          onClick: () => {
            if (!off()) {
              state.set(!state.get());
            }
          },
        },
        rest,
      )}
    />
  );
}

interface CheckedProps extends PartProps {
  checked?: Source<boolean>;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: Source<boolean>;
  readOnly?: Source<boolean>;
}

function control(
  props: CheckedProps,
  role: string,
  base: string,
  extra: { indeterminate?: Source<boolean> } = {},
): { context: Control; element: (children: Child) => JsxNode } {
  const { checked, defaultChecked, onCheckedChange, disabled, readOnly, ...rest } = props;
  const state = held(checked, defaultChecked ?? false, onCheckedChange);
  const off = () => Boolean(read(disabled));
  const mixed = () => Boolean(read(extra.indeterminate));
  const context: Control = { checked: () => state.get(), indeterminate: mixed, disabled: off };
  return {
    context,
    element: (children) => (
      <button
        {...merge(
          {
            class: base,
            type: 'button',
            role,
            'aria-checked': () => (mixed() ? 'mixed' : state.get()),
            'data-checked': flag(() => state.get() && !mixed()),
            'data-unchecked': flag(() => !state.get() && !mixed()),
            'data-indeterminate': flag(mixed),
            'data-disabled': flag(off),
            disabled: off,
            onClick: () => {
              if (!off() && !read(readOnly)) {
                state.set(!state.get());
              }
            },
          },
          rest,
        )}
      >
        {children}
      </button>
    ),
  };
}

const SwitchContext = createContext<Control>();

export interface SwitchRootProps extends CheckedProps {
  children?: Child;
}

function SwitchRoot(props: SwitchRootProps): JsxNode {
  const { children, ...rest } = props;
  const { context, element } = control(rest, 'switch', 'bui-switch');
  return <SwitchContext.Provider value={context}>{element(children)}</SwitchContext.Provider>;
}

function SwitchThumb(props: PartProps): JsxNode {
  const state = useContext(SwitchContext);
  return (
    <span
      {...merge(
        {
          class: 'bui-switch-thumb',
          'data-checked': flag(state.checked),
          'data-unchecked': flag(() => !state.checked()),
          'data-disabled': flag(state.disabled),
        },
        props,
      )}
    />
  );
}

/** An on and off switch: `Switch.Root` holds the state and `Switch.Thumb` slides with it. */
export const Switch = { Root: SwitchRoot, Thumb: SwitchThumb };

const CheckboxContext = createContext<Control>();

export interface CheckboxRootProps extends CheckedProps {
  indeterminate?: Source<boolean>;
  children?: Child;
}

function CheckboxRoot(props: CheckboxRootProps): JsxNode {
  const { children, indeterminate, ...rest } = props;
  const { context, element } = control(rest, 'checkbox', 'bui-checkbox', {
    ...(indeterminate !== undefined ? { indeterminate } : {}),
  });
  return <CheckboxContext.Provider value={context}>{element(children)}</CheckboxContext.Provider>;
}

function CheckboxIndicator(props: PartProps & { keepMounted?: boolean }): JsxNode {
  const { keepMounted, children, ...rest } = props;
  const state = useContext(CheckboxContext);
  const shown = () => state.checked() || state.indeterminate();
  return (
    <span
      {...merge(
        {
          class: 'bui-checkbox-indicator',
          'data-checked': flag(() => state.checked() && !state.indeterminate()),
          'data-unchecked': flag(() => !shown()),
          'data-indeterminate': flag(state.indeterminate),
          'data-disabled': flag(state.disabled),
        },
        rest,
      )}
    >
      {keepMounted ? children : <Show when={shown}>{children}</Show>}
    </span>
  );
}

/** A box that is checked, or neither, with an `Indicator` shown while it is. */
export const Checkbox = { Root: CheckboxRoot, Indicator: CheckboxIndicator };
