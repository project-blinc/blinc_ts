/**
 * A dialog: `Dialog.Root` holds `open` (shared as `open`/`defaultOpen` with `onOpenChange`),
 * `Trigger` opens it and `Popup` shows in the middle of the top layer over a dimmed backdrop,
 * with Tab kept inside and focus moved in, until Escape, a press on the backdrop or a `Close`
 * (not a press outside when not `dismissible`). Focus goes back to the trigger. A `modal` of
 * false leaves the page beneath its presses and its backdrop clear.
 */
import type { HostElement } from 'blinc_ts/native/host';
import { createContext } from '#jsx/flow';
import { direct } from '#jsx/build';
import { read, useContext, type Source } from '#jsx/owner';
import type { JsxNode } from '#jsx/jsx-runtime';
import { floating } from './floating.js';
import { flag, merge, type PartProps } from './props.js';
import { held } from './state.js';

interface Dialog {
  open(): boolean;
  set(open: boolean): void;
  modal(): boolean;
  dismissible(): boolean;
  trigger(): HostElement | undefined;
  setTrigger(element: HostElement): void;
}
const DialogContext = createContext<Dialog>();

export interface DialogRootProps {
  open?: Source<boolean>;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: Source<boolean>;
  /** Whether Escape or a press outside closes it; true by default. */
  dismissible?: Source<boolean>;
  children?: unknown;
}

function Root(props: DialogRootProps): JsxNode {
  const state = held(props.open, props.defaultOpen ?? false, props.onOpenChange);
  let trigger: HostElement | undefined;
  const context: Dialog = {
    open: () => state.get(),
    set: (open) => state.set(open),
    modal: () => read(props.modal) !== false,
    dismissible: () => read(props.dismissible) !== false,
    trigger: () => trigger,
    setTrigger: (element) => {
      trigger = element;
    },
  };
  return <DialogContext.Provider value={context}>{props.children as never}</DialogContext.Provider>;
}

function Trigger(props: PartProps): JsxNode {
  const dialog = useContext(DialogContext);
  return (
    <button
      {...merge(
        {
          class: 'bui-dialog-trigger',
          type: 'button',
          'aria-haspopup': 'dialog',
          'aria-expanded': dialog.open,
          'data-popup-open': flag(dialog.open),
          ref: dialog.setTrigger,
          onClick: () => dialog.set(true),
        },
        props,
      )}
    />
  );
}

function Popup(props: PartProps): JsxNode {
  const dialog = useContext(DialogContext);
  return direct(({ host, owner }) => {
    floating(host, owner, {
      open: dialog.open,
      closed: () => dialog.set(false),
      options: () => ({
        modal: dialog.modal(),
        dismissible: dialog.dismissible(),
        focus: true,
      }),
      view: () => (
        <div
          {...merge(
            {
              class: 'bui-dialog-popup',
              role: 'dialog',
              'aria-modal': () => dialog.modal(),
              tabindex: -1,
              'data-open': '',
            },
            props,
          )}
        />
      ),
    });
  });
}

function Close(props: PartProps): JsxNode {
  const dialog = useContext(DialogContext);
  return (
    <button
      {...merge(
        { class: 'bui-dialog-close', type: 'button', onClick: () => dialog.set(false) },
        props,
      )}
    />
  );
}

function Title(props: PartProps): JsxNode {
  return <h2 {...merge({ class: 'bui-dialog-title' }, props)} />;
}

function Description(props: PartProps): JsxNode {
  return <p {...merge({ class: 'bui-dialog-description' }, props)} />;
}

export const Dialog = { Root, Trigger, Popup, Close, Title, Description };
