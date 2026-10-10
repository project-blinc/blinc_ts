/**
 * A tooltip: `Tooltip.Root` holds `open` (shared as `open`/`defaultOpen` with `onOpenChange`),
 * `Trigger` opens it after `delay` ms of hover, or at once on keyboard focus, and closes it after
 * `closeDelay` ms away, on blur, on a press or on Escape. `Popup` is what shows, in the top
 * layer beside the trigger on `side`, and takes no presses.
 */
import type { HostElement } from 'blinc_ts/native/host';
import { placement, type Alignment, type Side } from 'blinc_ts/native/placement';
import { createContext } from '#jsx/flow';
import { direct } from '#jsx/build';
import { onCleanup, read, useContext, type Source } from '#jsx/owner';
import type { JsxNode } from '#jsx/jsx-runtime';
import { floating } from './floating.js';
import { flag, merge, type PartProps } from './props.js';
import { held } from './state.js';

interface Tooltip {
  open(): boolean;
  /** Pointer or focus came, or went: open, or close, after the delay it has. */
  want(on: boolean, wait: number): void;
  delay: number;
  closeDelay: number;
  disabled(): boolean;
  trigger(): HostElement | undefined;
  setTrigger(element: HostElement): void;
}
const TooltipContext = createContext<Tooltip>();

export interface TooltipRootProps {
  open?: Source<boolean>;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Milliseconds of hover before it opens; 600 by default. */
  delay?: number;
  /** Milliseconds away before it closes; none by default. */
  closeDelay?: number;
  disabled?: Source<boolean>;
  children?: unknown;
}

function Root(props: TooltipRootProps): JsxNode {
  const state = held(props.open, props.defaultOpen ?? false, props.onOpenChange);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let trigger: HostElement | undefined;
  onCleanup(() => clearTimeout(timer));
  const context: Tooltip = {
    open: () => state.get(),
    want: (on, wait) => {
      clearTimeout(timer);
      if (on && read(props.disabled)) {
        return;
      }
      if (wait <= 0) {
        state.set(on);
        return;
      }
      timer = setTimeout(() => state.set(on), wait);
      timer.unref();
    },
    delay: props.delay ?? 600,
    closeDelay: props.closeDelay ?? 0,
    disabled: () => Boolean(read(props.disabled)),
    trigger: () => trigger,
    setTrigger: (element) => {
      trigger = element;
    },
  };
  return (
    <TooltipContext.Provider value={context}>{props.children as never}</TooltipContext.Provider>
  );
}

function Trigger(props: PartProps): JsxNode {
  const tip = useContext(TooltipContext);
  return (
    <button
      {...merge(
        {
          class: 'bui-tooltip-trigger',
          type: 'button',
          'data-popup-open': flag(tip.open),
          ref: tip.setTrigger,
          onPointerEnter: () => tip.want(true, tip.delay),
          onPointerLeave: () => tip.want(false, tip.closeDelay),
          onFocus: (event: { visible: boolean }) => {
            // Only focus the keyboard brought, as the focus ring is: a press focuses too.
            if (event.visible) {
              tip.want(true, 0);
            }
          },
          onBlur: () => tip.want(false, 0),
          onPointerDown: () => tip.want(false, 0),
        },
        props,
      )}
    />
  );
}

export interface PopupPlacement {
  side?: Side;
  align?: Alignment;
  /** Distance from the trigger. */
  sideOffset?: number;
  /** Distance along it from the alignment. */
  alignOffset?: number;
}

function Popup(props: PartProps & PopupPlacement): JsxNode {
  const { side, align, sideOffset, alignOffset, ...rest } = props;
  const tip = useContext(TooltipContext);
  return direct(({ host, owner }) => {
    floating(host, owner, {
      open: () => tip.open() && !tip.disabled(),
      closed: () => tip.want(false, 0),
      options: () => {
        const anchor = tip.trigger();
        return {
          ...(anchor
            ? {
                placement: placement.beside(anchor, side ?? 'top', {
                  align: align ?? 'center',
                  gap: sideOffset ?? 6,
                  offset: alignOffset ?? 0,
                }),
              }
            : {}),
          passThrough: true,
          focus: false,
          restoreFocus: false,
        };
      },
      view: () => (
        <div {...merge({ class: 'bui-tooltip-popup', role: 'tooltip', 'data-open': '' }, rest)} />
      ),
    });
  });
}

export const Tooltip = { Root, Trigger, Popup };
