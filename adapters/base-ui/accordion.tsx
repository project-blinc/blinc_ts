/**
 * A stack of collapsible items. `Accordion.Root` holds the values of the items open, shared as
 * `value`/`defaultValue` with `onValueChange`, one at a time unless `multiple`; each `Item` has a
 * `value`, a `Header` holding its `Trigger`, and a `Panel`. Up and Down (Left and Right when
 * horizontal), Home and End move focus among the enabled triggers.
 */
import type { HostElement } from 'blinc_ts/native/host';
import { createContext, Show } from '#jsx/flow';
import { read, useContext, type Source } from '#jsx/owner';
import type { Child, JsxNode } from '#jsx/jsx-runtime';
import { descendants, step } from './dom.js';
import { Chevron } from './icons.js';
import { presence } from './presence.js';
import { flag, merge, type PartProps } from './props.js';
import { held } from './state.js';

interface Accordion {
  isOpen(value: string): boolean;
  toggle(value: string): void;
  disabled(): boolean;
  orientation(): 'vertical' | 'horizontal';
}
const AccordionContext = createContext<Accordion>();

interface Item {
  value: string;
  open(): boolean;
  disabled(): boolean;
}
const ItemContext = createContext<Item>();

export interface AccordionRootProps extends PartProps {
  value?: Source<readonly string[]>;
  defaultValue?: readonly string[];
  onValueChange?: (value: readonly string[]) => void;
  multiple?: boolean;
  disabled?: Source<boolean>;
  orientation?: Source<'vertical' | 'horizontal'>;
  /** Whether the arrows wrap from the last trigger to the first; true by default. */
  loop?: boolean;
}

function Root(props: AccordionRootProps): JsxNode {
  const { value, defaultValue, onValueChange, multiple, disabled, orientation, loop, ...rest } =
    props;
  const open = held<readonly string[]>(value, defaultValue ?? [], onValueChange);
  const off = () => Boolean(read(disabled));
  const along = () => read(orientation) ?? 'vertical';
  const context: Accordion = {
    isOpen: (v) => open.get().includes(v),
    toggle: (v) => {
      const now = open.get();
      if (now.includes(v)) {
        open.set(now.filter((x) => x !== v));
      } else {
        open.set(multiple ? [...now, v] : [v]);
      }
    },
    disabled: off,
    orientation: along,
  };
  let root: HostElement | undefined;
  const key = (event: { key: string; target: unknown; preventDefault(): void }) => {
    const forward = along() === 'vertical' ? 'ArrowDown' : 'ArrowRight';
    const back = along() === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    const by = event.key === forward ? 1 : event.key === back ? -1 : 0;
    if (!root || (by === 0 && event.key !== 'Home' && event.key !== 'End')) {
      return;
    }
    const triggers = descendants(
      root,
      (e) => e.classList.contains('bui-accordion-trigger') && !e.hasAttribute('disabled'),
    );
    const from = triggers.find((t) => t === event.target);
    if (!from) {
      return;
    }
    const next =
      event.key === 'Home'
        ? triggers[0]
        : event.key === 'End'
          ? triggers[triggers.length - 1]
          : step(triggers, from, by as 1 | -1, loop !== false);
    event.preventDefault();
    next?.focus();
  };
  return (
    <AccordionContext.Provider value={context}>
      <div
        {...merge(
          {
            class: 'bui-accordion',
            role: 'region',
            'data-orientation': along,
            'data-disabled': flag(off),
            onKeyDown: key,
            ref: (e: HostElement) => {
              root = e;
            },
          },
          rest,
        )}
      />
    </AccordionContext.Provider>
  );
}

let anonymous = 0;

function ItemPart(props: PartProps & { value?: string; disabled?: Source<boolean> }): JsxNode {
  const { value: given, disabled, ...rest } = props;
  const accordion = useContext(AccordionContext);
  const value = given ?? `item-${anonymous++}`;
  const item: Item = {
    value,
    open: () => accordion.isOpen(value),
    disabled: () => accordion.disabled() || Boolean(read(disabled)),
  };
  return (
    <ItemContext.Provider value={item}>
      <div
        {...merge(
          {
            class: 'bui-accordion-item',
            'data-open': flag(item.open),
            'data-closed': flag(() => !item.open()),
            'data-disabled': flag(item.disabled),
            // An item that opens eases to its size, and those below ease out of its way.
            ref: (e: HostElement) => e.animateLayout(),
          },
          rest,
        )}
      />
    </ItemContext.Provider>
  );
}

function Header(props: PartProps): JsxNode {
  return <h3 {...merge({ class: 'bui-accordion-header' }, props)} />;
}

function Trigger(props: PartProps & { chevron?: boolean }): JsxNode {
  const { chevron, children, ...rest } = props;
  const accordion = useContext(AccordionContext);
  const item = useContext(ItemContext);
  return (
    <button
      {...merge(
        {
          class: 'bui-accordion-trigger',
          type: 'button',
          'aria-expanded': item.open,
          'data-panel-open': flag(item.open),
          'data-disabled': flag(item.disabled),
          disabled: item.disabled,
          onClick: () => accordion.toggle(item.value),
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
  const item = useContext(ItemContext);
  let panel: HostElement | undefined;
  const present = presence(item.open, () => panel);
  return (
    <div
      {...merge(
        {
          class: 'bui-accordion-panel',
          role: 'region',
          hidden: () => !present(),
          'data-open': flag(item.open),
          'data-closed': flag(() => !item.open()),
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

export const Accordion = { Root, Item: ItemPart, Header, Trigger, Panel };
