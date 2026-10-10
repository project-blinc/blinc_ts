/**
 * A popover: `Popover.Root` holds `open` (shared as `open`/`defaultOpen` with `onOpenChange`),
 * `Trigger` toggles it and `Popup` shows beside the trigger in the top layer, with focus moved
 * into it, until Escape, a press outside or a `Close`. Focus goes back to the trigger.
 */
import type { HostElement } from 'blinc_ts/native/host';
import { placement } from 'blinc_ts/native/placement';
import { createContext } from '#jsx/flow';
import { direct } from '#jsx/build';
import { useContext, type Source } from '#jsx/owner';
import type { JsxNode } from '#jsx/jsx-runtime';
import { floating } from './floating.js';
import { flag, merge, type PartProps } from './props.js';
import { held } from './state.js';
import type { PopupPlacement } from './tooltip.js';

interface Popover {
  open(): boolean;
  set(open: boolean): void;
  trigger(): HostElement | undefined;
  setTrigger(element: HostElement): void;
}
const PopoverContext = createContext<Popover>();

export interface PopoverRootProps {
  open?: Source<boolean>;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: unknown;
}

function Root(props: PopoverRootProps): JsxNode {
  const state = held(props.open, props.defaultOpen ?? false, props.onOpenChange);
  let trigger: HostElement | undefined;
  const context: Popover = {
    open: () => state.get(),
    set: (open) => state.set(open),
    trigger: () => trigger,
    setTrigger: (element) => {
      trigger = element;
    },
  };
  return (
    <PopoverContext.Provider value={context}>{props.children as never}</PopoverContext.Provider>
  );
}

function Trigger(props: PartProps): JsxNode {
  const popover = useContext(PopoverContext);
  return (
    <button
      {...merge(
        {
          class: 'bui-popover-trigger',
          type: 'button',
          'aria-expanded': popover.open,
          'aria-haspopup': 'dialog',
          'data-popup-open': flag(popover.open),
          ref: popover.setTrigger,
          onClick: () => popover.set(!popover.open()),
        },
        props,
      )}
    />
  );
}

function Popup(props: PartProps & PopupPlacement): JsxNode {
  const { side, align, sideOffset, alignOffset, ...rest } = props;
  const popover = useContext(PopoverContext);
  return direct(({ host, owner }) => {
    floating(host, owner, {
      open: popover.open,
      closed: () => popover.set(false),
      options: () => {
        const anchor = popover.trigger();
        return {
          ...(anchor
            ? {
                placement: placement.beside(anchor, side ?? 'bottom', {
                  align: align ?? 'center',
                  gap: sideOffset ?? 8,
                  offset: alignOffset ?? 0,
                }),
              }
            : {}),
          focus: true,
        };
      },
      view: () => (
        <div
          {...merge(
            { class: 'bui-popover-popup', role: 'dialog', tabindex: -1, 'data-open': '' },
            rest,
          )}
        />
      ),
    });
  });
}

function Close(props: PartProps): JsxNode {
  const popover = useContext(PopoverContext);
  return (
    <button
      {...merge(
        { class: 'bui-popover-close', type: 'button', onClick: () => popover.set(false) },
        props,
      )}
    />
  );
}

function Title(props: PartProps): JsxNode {
  return <h2 {...merge({ class: 'bui-popover-title' }, props)} />;
}

function Description(props: PartProps): JsxNode {
  return <p {...merge({ class: 'bui-popover-description' }, props)} />;
}

export const Popover = { Root, Trigger, Popup, Close, Title, Description };
