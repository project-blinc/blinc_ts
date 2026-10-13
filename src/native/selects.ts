/**
 * What a `select` does: it shows the label of the option chosen, with a chevron, and opens the
 * options as a list in the top layer under it. The `option`s stay in the tree, hidden, for a
 * framework to own; the list is made from them when it opens, its rows being the elements the
 * keys move among. With `multiple` or `size > 1`, an owned scrolling list stays in place.
 */
import { HostEvent, type HostPointerEvent } from './events.js';
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

interface OptionState {
  selected: boolean;
  dirty: boolean;
}

interface InlineList {
  readonly element: HostElement;
  readonly rows: Map<HostElement, { row: HostElement; text: HostText }>;
  readonly headings: HostElement[];
}

interface Control {
  /** A script explicitly selected nothing; do not automatically choose the first option. */
  none: boolean;
  readonly label: HostElement;
  readonly text: HostText;
  readonly chevron: HostElement;
  popup: Popup | null;
  list: InlineList | null;
  active: HostElement | null;
  anchor: HostElement | null;
  /** Selection before a Shift range, so shrinking a range removes its former tail. */
  rangeBase: Set<HostElement> | null;
  typed: string;
  typedAt: number;
}

/** How long a pause ends what has been typed to find an option. */
const TYPING_MS = 1000;

export class Selects {
  readonly host: Host;
  readonly #controls = new WeakMap<HostElement, Control>();
  readonly #options = new WeakMap<HostElement, OptionState>();
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
      if (select && !event.defaultPrevented && !this.isList(select)) {
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
    this.host.root.addEventListener('keyup', (event) => {
      const target = event.target;
      if (
        target instanceof ElementClass &&
        this.#controls.has(target) &&
        this.isList(target) &&
        (event as HostKeyboardEvent).key === ' '
      ) {
        event.preventDefault();
      }
    });
    this.host.root.addEventListener('textinput', (event) => this.#typed(event as HostTextEvent));
  }

  created(element: HostElement): void {
    if (element.tag !== 'select') {
      return;
    }
    const label = this.host.ownedElement(element, 'span', ['value']);
    const text = this.host.createTextNode('');
    label.appendChild(text);
    const chevron = this.host.ownedElement(element, 'img', ['chevron']);
    chevron.setAttribute('src', CHEVRON);
    this.#controls.set(element, {
      none: false,
      label,
      text,
      chevron,
      popup: null,
      list: null,
      active: null,
      anchor: null,
      rangeBase: null,
      typed: '',
      typedAt: 0,
    });
    this.#dirty.add(element);
  }

  /** The part a select made for itself: its `chevron`. */
  part(select: HostElement, name: string): HostElement | undefined {
    const control = this.#controls.get(select);
    return name === 'chevron'
      ? control?.chevron
      : name === 'options'
        ? control?.list?.element
        : undefined;
  }

  /** The owned in-place row for an authored option, available after layout. */
  row(select: HostElement, option: HostElement): HostElement | undefined {
    return this.#controls.get(select)?.list?.rows.get(option)?.row;
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

  /** The reflected size defaults to zero; the displayed list defaults to four rows. */
  size(select: HostElement): number {
    const match = /^\s*\+?(\d+)/.exec(select.getAttribute('size') ?? '');
    return match ? Math.min(Number(match[1]), 0xffffffff) : 0;
  }

  isList(select: HostElement): boolean {
    return select.hasAttribute('multiple') || this.size(select) > 1;
  }

  #state(option: HostElement): OptionState {
    let state = this.#options.get(option);
    if (!state) {
      state = { selected: option.hasAttribute('selected'), dirty: false };
      this.#options.set(option, state);
    }
    return state;
  }

  #selection(select: HostElement, control: Control): Choice[] {
    const all = this.choices(select);
    let selected = all.filter((c) => this.#state(c.element).selected);
    if (!select.hasAttribute('multiple')) {
      const last = selected.at(-1);
      for (const choice of selected.slice(0, -1)) {
        this.#state(choice.element).selected = false;
      }
      selected = last ? [last] : [];
      if (!last && !control.none && !this.isList(select)) {
        const first = all.find((c) => !c.disabled);
        if (first) {
          this.#state(first.element).selected = true;
          selected = [first];
        }
      }
    }
    return selected;
  }

  #chosen(select: HostElement, control: Control): Choice | null {
    return this.#selection(select, control)[0] ?? null;
  }

  #setSelection(
    select: HostElement,
    control: Control,
    selected: Set<HostElement>,
    user = false,
  ): void {
    const previous = new Set(this.#selection(select, control).map((c) => c.element));
    for (const choice of this.choices(select)) {
      const state = this.#state(choice.element);
      const on = selected.has(choice.element);
      if (state.selected !== on || on) {
        state.dirty = true;
      }
      state.selected = on;
    }
    control.none = selected.size === 0;
    this.#syncChecked(select, control);
    this.#dirty.add(select);
    this.host.behaviours.validity.changed(select);
    this.host.wake();
    if (user && (previous.size !== selected.size || [...previous].some((c) => !selected.has(c)))) {
      select.dispatchEvent(new HostEvent('input', { bubbles: true }));
      select.dispatchEvent(new HostEvent('change', { bubbles: true }));
    }
  }

  #syncChecked(select: HostElement, control: Control): void {
    const selected = new Set(this.#selection(select, control).map((c) => c.element));
    for (const choice of this.choices(select)) {
      const on = selected.has(choice.element);
      choice.element.setState('checked', on);
      control.list?.rows.get(choice.element)?.row.setState('checked', on);
    }
    for (const { row, choice } of control.popup?.rows ?? []) {
      row.setState('checked', selected.has(choice.element));
    }
  }

  selectedOptions(select: HostElement): HostElement[] {
    const control = this.#controls.get(select);
    return control ? this.#selection(select, control).map((c) => c.element) : [];
  }

  /** Successful options, including every selected value, in authored order. */
  values(select: HostElement): string[] {
    const control = this.#controls.get(select);
    return control
      ? this.#selection(select, control)
          .filter((c) => !c.disabled)
          .map((c) => c.value)
      : [];
  }

  selected(option: HostElement): boolean {
    const select = this.#selectAt(option.parentNode);
    if (select) {
      return this.selectedOptions(select).includes(option);
    }
    return this.#state(option).selected;
  }

  setSelected(option: HostElement, on: boolean): void {
    const select = this.#selectAt(option.parentNode);
    const control = select && this.#controls.get(select);
    if (select && control) {
      const selected = new Set(this.selectedOptions(select));
      if (on) {
        if (!select.hasAttribute('multiple')) {
          selected.clear();
        }
        selected.add(option);
      } else {
        selected.delete(option);
      }
      this.#setSelection(select, control, selected);
    }
    this.#options.set(option, { selected: on, dirty: true });
  }

  /** A single-row placeholder is missing; an empty-valued option in a list is a real choice. */
  valueMissing(select: HostElement): boolean {
    const selected = this.selectedOptions(select);
    const first = this.choices(select)[0];
    return (
      selected.length === 0 ||
      (!this.isList(select) &&
        selected.length === 1 &&
        first !== undefined &&
        selected[0] === first.element &&
        first.value === '' &&
        first.element.parentNode === select)
    );
  }

  attributeChanged(element: HostElement, name: string): void {
    if (element.tag === 'option' && name === 'selected') {
      const state = this.#state(element);
      if (!state.dirty) {
        state.selected = element.hasAttribute('selected');
        const select = this.#selectAt(element.parentNode);
        const control = select && this.#controls.get(select);
        if (select && control) {
          control.none = false;
          if (state.selected && !select.hasAttribute('multiple')) {
            for (const choice of this.choices(select)) {
              if (choice.element !== element) {
                this.#state(choice.element).selected = false;
              }
            }
          }
        }
      }
    }
    this.changed(element);
  }

  // --- properties -----------------------------------------------------------------------

  /** The value of the chosen option, or `''` for a select with none. */
  value(select: HostElement): string {
    const control = this.#controls.get(select);
    return (control && this.#chosen(select, control)?.value) ?? '';
  }

  /** An option's submission value defaults to its collapsed text. */
  optionValue(option: HostElement): string {
    return option.getAttribute('value') ?? this.#textOf(option);
  }

  /** Choose the option with this value; none matching leaves the select showing nothing chosen. */
  setValue(select: HostElement, value: string): void {
    const control = this.#controls.get(select);
    if (!control) {
      return;
    }
    const match = this.choices(select).find((c) => c.value === value);
    this.#setSelection(select, control, new Set(match ? [match.element] : []));
    control.active = match?.element ?? null;
    control.anchor = control.active;
    control.rangeBase = null;
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
      this.#setSelection(select, control, new Set(choice ? [choice.element] : []));
      control.active = choice?.element ?? null;
      control.anchor = control.active;
      control.rangeBase = null;
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
      for (const option of this.options(select)) {
        this.#options.set(option, { selected: option.hasAttribute('selected'), dirty: false });
      }
      control.none = false;
      control.active = null;
      control.anchor = null;
      control.rangeBase = null;
      this.#syncChecked(select, control);
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
        this.#syncList(select, control);
        this.#syncChecked(select, control);
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

  // --- the in-place list ----------------------------------------------------------------

  #syncList(select: HostElement, control: Control): void {
    const inline = this.isList(select);
    if (select.hasAttribute('data-listbox') !== inline) {
      if (inline) {
        select.setAttribute('data-listbox', '');
      } else {
        select.removeAttribute('data-listbox');
      }
    }
    const display = inline ? 'none' : null;
    if (control.label.style.get('display') !== (display ?? undefined)) {
      control.label.setProperty('display', display);
      control.chevron.setProperty('display', display);
    }
    if (!inline) {
      control.list?.element.destroy();
      control.list = null;
      return;
    }
    if (control.popup) {
      void control.popup.entry.close();
    }
    control.list ??= {
      element: this.host.ownedElement(select, 'div', ['options']),
      rows: new Map(),
      headings: [],
    };
    const list = control.list;
    const choices = this.choices(select);
    const live = new Set(choices.map((c) => c.element));
    for (const [option, { row }] of list.rows) {
      if (!live.has(option)) {
        row.destroy();
        list.rows.delete(option);
      }
    }
    const groups = choices.filter((c, i) => c.group !== null && c.group !== choices[i - 1]?.group);
    while (list.headings.length > groups.length) {
      list.headings.pop()!.destroy();
    }
    let heading = 0;
    for (let i = 0; i < choices.length; i++) {
      const choice = choices[i]!;
      if (choice.group !== null && choice.group !== choices[i - 1]?.group) {
        let title = list.headings[heading];
        if (!title) {
          title = this.host.ownedElement(list.element, 'optgroup');
          title.appendChild(this.host.createTextNode(choice.group));
          list.headings.push(title);
        } else if (title.firstChild instanceof HostText && title.firstChild.data !== choice.group) {
          title.firstChild.data = choice.group;
        }
        list.element.layoutNode.queueInsertBefore(title.layoutNode, null);
        heading++;
      }
      let own = list.rows.get(choice.element);
      if (!own) {
        const row = this.host.ownedElement(list.element, 'option');
        const text = this.host.createTextNode(choice.label);
        row.appendChild(text);
        row.addEventListener('click', (event) => {
          if (event.defaultPrevented || this.host.input.isDisabled(select)) {
            return;
          }
          const current = this.choices(select).find((c) => c.element === choice.element);
          if (current && !current.disabled) {
            const pointer = event as HostPointerEvent;
            this.#interact(
              select,
              control,
              current,
              pointer.shiftKey,
              pointer.ctrlKey || pointer.metaKey,
            );
            this.host.input.focus(select, false);
          }
        });
        own = { row, text };
        list.rows.set(choice.element, own);
      }
      const { row, text } = own;
      if (row.className !== choice.element.className) {
        row.className = choice.element.className;
      }
      if (row.hasAttribute('disabled') !== choice.disabled) {
        if (choice.disabled) {
          row.setAttribute('disabled', '');
        } else {
          row.removeAttribute('disabled');
        }
      }
      if (text.data !== choice.label) {
        text.data = choice.label;
      }
      list.element.layoutNode.queueInsertBefore(row.layoutNode, null);
    }
    if (!choices.some((c) => c.element === control.active && !c.disabled)) {
      control.active = this.#selection(select, control).find((c) => !c.disabled)?.element ?? null;
    }
    if (!choices.some((c) => c.element === control.anchor && !c.disabled)) {
      control.anchor = control.active;
      control.rangeBase = null;
    }
    // Relative units follow the inherited font. Padding adds twelve pixels per option row.
    const count = this.size(select) || (select.hasAttribute('multiple') ? 4 : 1);
    const height = `calc(${count * 1.2}em + ${count * 12}px)`;
    if (list.element.style.get('height') !== height) {
      list.element.setProperty('height', height);
    }
    this.#showActive(control, false);
  }

  #showActive(control: Control, scroll = true): void {
    for (const [option, { row }] of control.list?.rows ?? []) {
      if (row.destroyed) {
        continue;
      }
      const active = option === control.active;
      if (row.hasAttribute('data-active') !== active) {
        if (active) {
          row.setAttribute('data-active', '');
        } else {
          row.removeAttribute('data-active');
        }
      }
      if (active && scroll) {
        row.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  #interact(
    select: HostElement,
    control: Control,
    choice: Choice,
    shift: boolean,
    toggle: boolean,
  ): void {
    const multiple = select.hasAttribute('multiple');
    let selected = new Set(this.selectedOptions(select));
    if (multiple && shift) {
      control.anchor ??= control.active ?? choice.element;
      control.rangeBase ??= toggle ? new Set(selected) : new Set();
      const all = this.choices(select);
      const from = all.findIndex((c) => c.element === control.anchor);
      const to = all.findIndex((c) => c.element === choice.element);
      selected = new Set(control.rangeBase);
      for (const c of all.slice(Math.min(from, to), Math.max(from, to) + 1)) {
        if (!c.disabled) {
          selected.add(c.element);
        }
      }
    } else {
      control.rangeBase = null;
      control.anchor = choice.element;
      if (toggle && (multiple || this.isList(select))) {
        if (selected.has(choice.element)) {
          selected.delete(choice.element);
        } else {
          if (!multiple) {
            selected.clear();
          }
          selected.add(choice.element);
        }
      } else {
        selected = new Set([choice.element]);
      }
    }
    control.active = choice.element;
    this.#setSelection(select, control, selected, true);
    this.#showActive(control, false);
  }

  #inlineKey(event: HostKeyboardEvent, select: HostElement, control: Control): void {
    const enabled = this.choices(select).filter((c) => !c.disabled);
    if (enabled.length === 0) {
      return;
    }
    const at = enabled.findIndex((c) => c.element === control.active);
    const toggle = event.ctrlKey || event.metaKey;
    let to: number;
    switch (event.key) {
      case 'ArrowDown':
        to = at < 0 ? 0 : at + 1;
        break;
      case 'ArrowUp':
        to = at < 0 ? enabled.length - 1 : at - 1;
        break;
      case 'Home':
        to = 0;
        break;
      case 'End':
        to = enabled.length - 1;
        break;
      case 'PageDown':
        to = at + Math.max(1, (this.size(select) || 4) - 1);
        break;
      case 'PageUp':
        to = at - Math.max(1, (this.size(select) || 4) - 1);
        break;
      case ' ':
      case 'Enter': {
        event.preventDefault();
        const choice = enabled[at < 0 ? 0 : at];
        if (choice) {
          this.#interact(
            select,
            control,
            choice,
            event.shiftKey,
            select.hasAttribute('multiple') || toggle,
          );
          this.#showActive(control);
        }
        return;
      }
      case 'a':
      case 'A':
        if (toggle && select.hasAttribute('multiple')) {
          event.preventDefault();
          control.rangeBase = null;
          this.#setSelection(select, control, new Set(enabled.map((c) => c.element)), true);
        }
        return;
      default:
        return;
    }
    event.preventDefault();
    const choice = enabled[Math.max(0, Math.min(to, enabled.length - 1))]!;
    if (toggle && !event.shiftKey && select.hasAttribute('multiple')) {
      control.active = choice.element;
      control.rangeBase = null;
    } else {
      this.#interact(select, control, choice, event.shiftKey, toggle && event.shiftKey);
    }
    this.#showActive(control);
  }

  // --- the list -------------------------------------------------------------------------

  /** Open the options as a list under the select, the chosen one focused. */
  open(select: HostElement): void {
    const control = this.#controls.get(select);
    if (!control || control.popup || this.isList(select) || this.host.input.isDisabled(select)) {
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
    const [, y, , h] = select.viewBounds();
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
    void control.popup?.entry.close();
    this.#setSelection(select, control, new Set([choice.element]), true);
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
    if (
      !target ||
      !control ||
      event.defaultPrevented ||
      control.popup ||
      this.host.input.isDisabled(target)
    ) {
      return;
    }
    if (this.isList(target)) {
      this.#inlineKey(event, target, control);
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
    } else if (this.isList(select)) {
      this.#interact(select, control, match, false, false);
      this.#showActive(control);
    } else if (this.#chosen(select, control)?.element !== match.element) {
      this.#setSelection(select, control, new Set([match.element]), true);
    }
  }
}
