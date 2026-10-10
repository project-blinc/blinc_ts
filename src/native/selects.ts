/**
 * What a `select` does: it shows the label of the option chosen, with a chevron, and opens the
 * options as a list in the top layer under it. The `option`s stay in the tree, hidden, for a
 * framework to own; the list is made from them when it opens, its rows being the elements the
 * keys move among. A `select` that is `multiple` or has a `size` is not supported.
 */
import { HostEvent } from './events.js';
import type { Host, HostElement, HostNode } from './host.js';
import { HostElement as ElementClass, HostText } from './host.js';
import type { HostKeyboardEvent, HostTextEvent } from './input.js';
import { placement } from './placement.js';
import { TopLayer, type TopLayerEntry } from './top-layer.js';

const CHEVRON = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5.5 7 9.5l4-4"/></svg>',
)}`;

/** An option as the list shows it. */
interface Choice {
  readonly element: HostElement;
  readonly group: string | null;
  readonly value: string;
  readonly label: string;
  readonly disabled: boolean;
}

interface Popup {
  readonly entry: TopLayerEntry;
  readonly rows: { row: HostElement; choice: Choice }[];
}

interface Control {
  /** The option chosen: chosen by the user or a script, else the one `selected` names, else the first. */
  chosen: HostElement | null;
  chosenByUser: boolean;
  /** A script chose no option at all: a value that matched none, or an index out of range. */
  none: boolean;
  readonly text: HostText;
  popup: Popup | null;
  typed: string;
  typedAt: number;
}

/** How long a pause ends what has been typed to find an option. */
const TYPING_MS = 1000;

export class Selects {
  readonly host: Host;
  readonly #controls = new WeakMap<HostElement, Control>();
  /** The select each open list belongs to. */
  readonly #owners = new WeakMap<HostElement, HostElement>();
  /** Selects whose label may be wrong now. */
  readonly #dirty = new Set<HostElement>();

  constructor(host: Host) {
    this.host = host;
  }

  /** Once the host has its root. */
  attach(): void {
    this.host.root.addEventListener('click', (event) => {
      const select = this.#selectAt(event.target as HostNode | null);
      if (select && !event.defaultPrevented) {
        const control = this.#controls.get(select);
        if (control?.popup) {
          void control.popup.entry.close();
        } else {
          this.open(select);
        }
      }
    });
    this.host.root.addEventListener('keydown', (event) =>
      this.#keyDown(event as HostKeyboardEvent),
    );
    this.host.root.addEventListener('textinput', (event) => this.#typed(event as HostTextEvent));
  }

  created(element: HostElement): void {
    if (element.tag !== 'select') {
      return;
    }
    const label = this.host.ownedElement(element, 'span', ['value']);
    const text = this.host.createTextNode('');
    label.appendChild(text);
    this.host.ownedElement(element, 'img', ['chevron']).setAttribute('src', CHEVRON);
    this.#controls.set(element, {
      chosen: null,
      chosenByUser: false,
      none: false,
      text,
      popup: null,
      typed: '',
      typedAt: 0,
    });
    this.#dirty.add(element);
  }

  #selectAt(node: HostNode | null): HostElement | null {
    for (let n = node; n; n = n.composedParent) {
      if (n instanceof ElementClass && n.tag === 'select') {
        return n;
      }
    }
    return null;
  }

  // --- options --------------------------------------------------------------------------

  /** The options of `select`, in order, those in an `optgroup` with its label. */
  choices(select: HostElement): Choice[] {
    const out: Choice[] = [];
    const add = (option: HostElement, group: HostElement | null): void => {
      const text = this.#textOf(option);
      out.push({
        element: option,
        group: group?.getAttribute('label') ?? null,
        value: option.getAttribute('value') ?? text,
        label: option.getAttribute('label') ?? text,
        disabled: option.hasAttribute('disabled') || (group?.hasAttribute('disabled') ?? false),
      });
    };
    for (let child = select.firstChild; child; child = child.nextSibling) {
      if (!(child instanceof ElementClass)) {
        continue;
      }
      if (child.tag === 'option') {
        add(child, null);
      } else if (child.tag === 'optgroup') {
        for (let o = child.firstChild; o; o = o.nextSibling) {
          if (o instanceof ElementClass && o.tag === 'option') {
            add(o, child);
          }
        }
      }
    }
    return out;
  }

  /** An option's text, as HTML has it: its text nodes joined, trimmed, whitespace collapsed. */
  #textOf(option: HostElement): string {
    let text = '';
    for (let n = option.firstChild; n; n = n.nextSibling) {
      if (n instanceof HostText) {
        text += n.data;
      }
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * The option that is chosen: the user's or a script's, else, until one has chosen, the one
   * `selected` names, else the first that is enabled.
   */
  #chosen(select: HostElement, control: Control): Choice | null {
    const all = this.choices(select);
    const own = all.find((c) => c.element === control.chosen);
    if (own) {
      return own;
    }
    if (control.none) {
      return null;
    }
    // Once the user or a script has chosen, the `selected` attributes no longer count.
    const named = control.chosenByUser
      ? undefined
      : all.find((c) => c.element.hasAttribute('selected'));
    return named ?? all.find((c) => !c.disabled) ?? all[0] ?? null;
  }

  // --- properties -----------------------------------------------------------------------

  /** The value of the chosen option, or `''` for a select with none. */
  value(select: HostElement): string {
    const control = this.#controls.get(select);
    return (control && this.#chosen(select, control)?.value) ?? '';
  }

  /** Choose the option with this value; none matching leaves the select showing nothing chosen. */
  setValue(select: HostElement, value: string): void {
    const control = this.#controls.get(select);
    if (!control) {
      return;
    }
    const match = this.choices(select).find((c) => c.value === value);
    control.chosen = match?.element ?? null;
    control.none = !match;
    control.chosenByUser = true;
    this.#dirty.add(select);
    this.host.wake();
  }

  /** The text a select shows: the label of the option chosen. */
  label(select: HostElement): string {
    const control = this.#controls.get(select);
    return (control && this.#chosen(select, control)?.label) ?? '';
  }

  /** The index of the chosen option among the options, or -1. */
  selectedIndex(select: HostElement): number {
    const control = this.#controls.get(select);
    const chosen = control && this.#chosen(select, control);
    return chosen ? this.choices(select).findIndex((c) => c.element === chosen.element) : -1;
  }

  setSelectedIndex(select: HostElement, index: number): void {
    const control = this.#controls.get(select);
    const choice = this.choices(select)[index];
    if (control) {
      control.chosen = choice?.element ?? null;
      control.none = !choice;
      control.chosenByUser = true;
      this.#dirty.add(select);
      this.host.wake();
    }
  }

  /** The options, as elements. */
  options(select: HostElement): HostElement[] {
    return this.choices(select).map((c) => c.element);
  }

  /** Put it back as it began: the option `selected` names, else the first. */
  reset(select: HostElement): void {
    const control = this.#controls.get(select);
    if (control) {
      control.chosen = null;
      control.none = false;
      control.chosenByUser = false;
      this.#dirty.add(select);
      this.host.wake();
    }
  }

  /** Whether `element` is a select this module made. */
  has(element: HostElement): boolean {
    return this.#controls.has(element);
  }

  // --- the label ------------------------------------------------------------------------

  /** Something about `select` or its options changed: its label may be wrong. */
  changed(node: HostNode | null): void {
    for (let n: HostNode | null = node; n; n = n.composedParent) {
      if (n instanceof ElementClass && n.tag === 'select' && this.#controls.has(n)) {
        this.#dirty.add(n);
        return;
      }
    }
  }

  /** Before the tick's writes: show what each select has chosen. */
  flush(): void {
    if (this.#dirty.size === 0) {
      return;
    }
    const selects = [...this.#dirty];
    this.#dirty.clear();
    for (const select of selects) {
      const control = this.#controls.get(select);
      if (control && !select.destroyed) {
        const label = this.#chosen(select, control)?.label ?? '';
        if (control.text.data !== label) {
          control.text.data = label;
        }
      }
    }
  }

  forget(node: HostNode): void {
    if (node instanceof ElementClass) {
      const control = this.#controls.get(node);
      if (control?.popup) {
        void control.popup.entry.close();
      }
      this.#controls.delete(node);
      this.#dirty.delete(node);
    }
  }

  // --- the list -------------------------------------------------------------------------

  /** Open the options as a list under the select, the chosen one focused. */
  open(select: HostElement): void {
    const control = this.#controls.get(select);
    if (!control || control.popup || this.host.input.isDisabled(select)) {
      return;
    }
    const choices = this.choices(select);
    const chosen = this.#chosen(select, control);
    const list = this.host.createElement('listbox');
    const rows: Popup['rows'] = [];
    let heading: string | null = null;
    for (const choice of choices) {
      if (choice.group !== null && choice.group !== heading) {
        heading = choice.group;
        const title = this.host.createElement('optgroup');
        title.appendChild(this.host.createTextNode(heading));
        list.appendChild(title);
      }
      const row = this.host.createElement('option');
      row.className = choice.element.className;
      row.setAttribute('tabindex', '-1');
      if (choice.disabled) {
        row.setAttribute('disabled', '');
      }
      row.appendChild(this.host.createTextNode(choice.label));
      row.setState('checked', choice.element === chosen?.element);
      row.addEventListener('click', () => {
        if (!choice.disabled) {
          this.#choose(select, control, choice);
        }
      });
      row.addEventListener('pointerenter', () => {
        if (!choice.disabled) {
          this.host.input.focus(row, false);
        }
      });
      list.appendChild(row);
      rows.push({ row, choice });
    }
    // As tall as the room below the select or above it, whichever is more; past that it scrolls.
    const [, y, , h] = select.bounds();
    const [, , , rootHeight = 0] = this.host.root.bounds();
    list.setProperty('max-height', Math.max(0, Math.max(rootHeight - y - h, y) - 8));
    list.setProperty('overflow-y', 'auto');
    list.addEventListener('keydown', (event) =>
      this.#listKey(event as HostKeyboardEvent, select, control),
    );
    const entry = TopLayer.of(this.host).open(list, {
      placement: placement.below(select, { gap: 4 }),
      focus: false,
      onClose: () => {
        control.popup = null;
        // What was typed to find a row is not part of what is typed next.
        control.typed = '';
        select.removeAttribute('open');
      },
    });
    control.popup = { entry, rows };
    this.#owners.set(list, select);
    select.setAttribute('open', '');
    const target =
      rows.find((r) => r.choice.element === chosen?.element && !r.choice.disabled) ??
      rows.find((r) => !r.choice.disabled);
    if (target) {
      this.host.input.focus(target.row, true);
      target.row.scrollIntoView({ block: 'nearest' });
    }
  }

  /** The user chose `choice`: announce it if it is a change, and shut the list. */
  #choose(select: HostElement, control: Control, choice: Choice): void {
    const changed = this.#chosen(select, control)?.element !== choice.element;
    control.chosen = choice.element;
    control.none = false;
    control.chosenByUser = true;
    this.#dirty.add(select);
    this.host.wake();
    void control.popup?.entry.close();
    if (changed) {
      select.dispatchEvent(new HostEvent('input', { bubbles: true }));
      select.dispatchEvent(new HostEvent('change', { bubbles: true }));
    }
  }

  /** The row to move to from the focused one: `step` along the enabled rows, or an end. */
  #move(popup: Popup, step: number | 'first' | 'last'): void {
    const enabled = popup.rows.filter((r) => !r.choice.disabled);
    if (enabled.length === 0) {
      return;
    }
    const at = enabled.findIndex((r) => r.row === this.host.input.focused);
    const to =
      step === 'first'
        ? 0
        : step === 'last'
          ? enabled.length - 1
          : Math.min(Math.max(at < 0 ? 0 : at + step, 0), enabled.length - 1);
    const row = enabled[to]?.row;
    if (row) {
      this.host.input.focus(row, true);
      row.scrollIntoView({ block: 'nearest' });
    }
  }

  #listKey(event: HostKeyboardEvent, select: HostElement, control: Control): void {
    const popup = control.popup;
    if (!popup) {
      return;
    }
    const focused = popup.rows.find((r) => r.row === this.host.input.focused);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.#move(popup, 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.#move(popup, -1);
        break;
      case 'Home':
        event.preventDefault();
        this.#move(popup, 'first');
        break;
      case 'End':
        event.preventDefault();
        this.#move(popup, 'last');
        break;
      case 'Enter':
        event.preventDefault();
        if (focused) {
          this.#choose(select, control, focused.choice);
        }
        break;
      case ' ':
        // A space is part of what is being typed, once something has been.
        if (control.typed === '' || Date.now() - control.typedAt > TYPING_MS) {
          event.preventDefault();
          if (focused) {
            this.#choose(select, control, focused.choice);
          }
        }
        break;
      case 'Tab':
        event.preventDefault();
        void popup.entry.close();
        break;
    }
  }

  #keyDown(event: HostKeyboardEvent): void {
    const target = event.target instanceof ElementClass ? event.target : null;
    const control = target && this.#controls.get(target);
    if (!target || !control || control.popup || this.host.input.isDisabled(target)) {
      return;
    }
    // Closed and focused, the arrows open it. Enter and Space click it, which opens it too.
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.open(target);
    }
  }

  /** Typing finds the option whose label starts with what was typed in the last second. */
  #typed(event: HostTextEvent): void {
    const target = event.target instanceof ElementClass ? event.target : null;
    let select: HostElement | null = null;
    if (target && this.#controls.has(target)) {
      select = target;
    } else {
      // From a row of an open list.
      for (let n: HostElement | null = target; n && !select; n = n.composedParent) {
        select = this.#owners.get(n) ?? null;
      }
    }
    const control = select && this.#controls.get(select);
    if (!select || !control || this.host.input.isDisabled(select)) {
      return;
    }
    const popup = control.popup;
    const now = Date.now();
    control.typed =
      (now - control.typedAt > TYPING_MS ? '' : control.typed) + event.data.toLowerCase();
    control.typedAt = now;
    const wanted = control.typed;
    const match = this.choices(select).find(
      (c) => !c.disabled && c.label.toLowerCase().startsWith(wanted),
    );
    if (!match) {
      return;
    }
    event.preventDefault();
    if (popup) {
      const row = popup.rows.find((r) => r.choice.element === match.element)?.row;
      if (row) {
        this.host.input.focus(row, true);
        row.scrollIntoView({ block: 'nearest' });
      }
    } else if (this.#chosen(select, control)?.element !== match.element) {
      control.chosen = match.element;
      control.none = false;
      control.chosenByUser = true;
      this.#dirty.add(select);
      this.host.wake();
      select.dispatchEvent(new HostEvent('input', { bubbles: true }));
      select.dispatchEvent(new HostEvent('change', { bubbles: true }));
    }
  }
}
