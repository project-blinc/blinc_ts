/**
 * What an `input` does beyond what CSS says of it: a checkbox or a radio is checked by a click,
 * Space or its label, radios of one name in one form are a set the arrow keys move through, and a
 * range is a slider dragged or stepped with the keys. What an input shows of itself is a part the
 * host owns (a check mark, a dot, a thumb), which the user-agent sheet styles.
 */
import { HostEvent, type HostPointerEvent } from './events.js';
import type { Host, HostElement, HostNode } from './host.js';
import { HostElement as ElementClass } from './host.js';
import type { HostKeyboardEvent } from './input.js';

type Kind = 'checkbox' | 'radio' | 'range';

/** A check mark and a dash, drawn in the control's own colour. */
const mark = (path: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`,
  )}`;
const CHECK = mark('M2.5 6.5 5 9l4.5-5.5');
const DASH = mark('M3 6h6');

interface Control {
  kind: Kind | null;
  /** Whether it is checked now; the `checked` attribute is only where it starts. */
  checked: boolean;
  /** Whether the user, or a script, has set it, after which the attribute no longer does. */
  dirty: boolean;
  indeterminate: boolean;
  /** A range's value, once set; otherwise it is the attribute's, or the middle. */
  value: number | null;
  parts: Map<string, HostElement>;
  dragging: boolean;
  /** The value when it was last announced as changed, for `change`. */
  announced: number | null;
}

export class Inputs {
  readonly host: Host;
  readonly #controls = new WeakMap<HostElement, Control>();

  constructor(host: Host) {
    this.host = host;
  }

  /** Once the host has its root. */
  attach(): void {
    const root = this.host.root;
    root.addEventListener('keydown', (event) => this.#keyDown(event as HostKeyboardEvent));
    root.addEventListener('pointerdown', (event) => this.#pointerDown(event as HostPointerEvent));
    root.addEventListener('pointermove', (event) => this.#pointerMove(event as HostPointerEvent));
    root.addEventListener('pointerup', (event) => this.#pointerUp(event as HostPointerEvent));
  }

  created(element: HostElement): void {
    if (element.tag === 'input') {
      this.#controls.set(element, {
        kind: null,
        checked: false,
        dirty: false,
        indeterminate: false,
        value: null,
        parts: new Map(),
        dragging: false,
        announced: null,
      });
    }
  }

  /** An input's attribute changed. */
  attributeChanged(element: HostElement, name: string): void {
    const control = this.#controls.get(element);
    if (!control) {
      return;
    }
    switch (name) {
      case 'type':
        this.#retype(element, control);
        break;
      case 'checked':
        if (!control.dirty && control.kind !== 'range') {
          this.#setChecked(element, control, element.hasAttribute('checked'));
        }
        break;
      case 'value':
      case 'min':
      case 'max':
      case 'step':
        if (control.kind === 'range') {
          this.#render(element, control);
        }
        break;
      case 'data-orientation':
        break;
    }
  }

  /** Put an input back as it began: its `checked` or `value` attribute, as if the user had not touched it. */
  reset(element: HostElement): void {
    const control = this.#controls.get(element);
    if (!control?.kind) {
      return;
    }
    control.dirty = false;
    control.value = null;
    control.announced = null;
    if (control.kind === 'range') {
      this.#render(element, control);
      return;
    }
    this.setIndeterminate(element, false);
    this.#setChecked(element, control, element.hasAttribute('checked'));
  }

  forget(node: HostNode): void {
    if (node instanceof ElementClass) {
      this.#controls.delete(node);
    }
  }

  // --- properties ------------------------------------------------------------------------

  /** Whether a checkbox or a radio is checked. */
  checked(element: HostElement): boolean {
    return this.#controls.get(element)?.checked ?? false;
  }

  /** Check or uncheck a checkbox or a radio, as a script does: no event, and a radio's set follows. */
  setChecked(element: HostElement, on: boolean): void {
    const control = this.#controls.get(element);
    if (control && (control.kind === 'checkbox' || control.kind === 'radio')) {
      control.dirty = true;
      this.#setChecked(element, control, on);
    }
  }

  indeterminate(element: HostElement): boolean {
    return this.#controls.get(element)?.indeterminate ?? false;
  }

  setIndeterminate(element: HostElement, on: boolean): void {
    const control = this.#controls.get(element);
    if (control?.kind === 'checkbox' && control.indeterminate !== on) {
      control.indeterminate = on;
      element.setState('indeterminate', on);
    }
  }

  /** A range's value as a number, NaN for any other input. */
  valueAsNumber(element: HostElement): number {
    const control = this.#controls.get(element);
    return control?.kind === 'range' ? this.#valueOf(element, control) : Number.NaN;
  }

  /** A range's value as a number, snapped to its step and kept within its bounds, as a script sets it. */
  setValueAsNumber(element: HostElement, value: number): void {
    const control = this.#controls.get(element);
    if (control?.kind === 'range' && Number.isFinite(value)) {
      control.value = this.#snap(element, value);
      this.#render(element, control);
    }
  }

  /** What `element.value` is: a range's number as text, a checkbox's or a radio's `value`, or `on`. */
  value(element: HostElement): string | undefined {
    const control = this.#controls.get(element);
    if (!control?.kind) {
      return undefined;
    }
    return control.kind === 'range'
      ? String(this.#valueOf(element, control))
      : (element.getAttribute('value') ?? 'on');
  }

  setValue(element: HostElement, value: string): void {
    const control = this.#controls.get(element);
    if (control?.kind === 'range') {
      this.setValueAsNumber(element, Number(value));
    } else if (control) {
      element.setAttribute('value', value);
    }
  }

  // --- parts -----------------------------------------------------------------------------

  /** The part an input made for itself, by class: `check`, `dash`, `dot`, `fill`, `thumb` or `rest`. */
  part(element: HostElement, name: string): HostElement | undefined {
    return this.#controls.get(element)?.parts.get(name);
  }

  #retype(element: HostElement, control: Control): void {
    const type = element.getAttribute('type')?.trim().toLowerCase();
    const kind: Kind | null =
      type === 'checkbox' || type === 'radio' || type === 'range' ? type : null;
    if (kind === control.kind) {
      return;
    }
    for (const part of control.parts.values()) {
      this.host.destroyNode(part);
    }
    control.parts.clear();
    for (const state of ['checked', 'indeterminate']) {
      element.setState(state, false);
    }
    control.kind = kind;
    control.checked = false;
    control.indeterminate = false;
    const own = (name: string, tag = 'div'): HostElement => {
      const part = this.host.ownedElement(element, tag, [name]);
      control.parts.set(name, part);
      return part;
    };
    if (kind === 'checkbox') {
      own('check', 'img').setAttribute('src', CHECK);
      own('dash', 'img').setAttribute('src', DASH);
    } else if (kind === 'radio') {
      own('dot');
    } else if (kind === 'range') {
      own('fill');
      own('thumb');
      own('rest');
      this.#render(element, control);
    }
    if (kind === 'checkbox' || kind === 'radio') {
      this.#setChecked(element, control, !control.dirty && element.hasAttribute('checked'));
    }
  }

  // --- checkboxes and radios ---------------------------------------------------------------

  #setChecked(element: HostElement, control: Control, on: boolean): void {
    if (control.kind === 'radio' && on) {
      for (const other of this.#group(element)) {
        const state = this.#controls.get(other);
        if (other !== element && state?.checked) {
          state.checked = false;
          other.setState('checked', false);
        }
      }
    }
    if (control.checked !== on) {
      control.checked = on;
      element.setState('checked', on);
    }
  }

  /** The radios `element` is set with: those of its name under its form, or in the tree. */
  #group(element: HostElement): HostElement[] {
    const name = element.getAttribute('name');
    if (!name) {
      return [element];
    }
    let scope: HostElement = this.host.root;
    for (let n = element.parentNode; n; n = n.parentNode) {
      if (n instanceof ElementClass && n.tag === 'form') {
        scope = n;
        break;
      }
    }
    const found: HostElement[] = [];
    const walk = (parent: HostElement): void => {
      for (let child = parent.firstChild; child; child = child.nextSibling) {
        if (child instanceof ElementClass) {
          const state = this.#controls.get(child);
          if (state?.kind === 'radio' && child.getAttribute('name') === name) {
            found.push(child);
          }
          walk(child);
        }
      }
    };
    walk(scope);
    return found;
  }

  #announce(element: HostElement, types: readonly string[]): void {
    for (const type of types) {
      element.dispatchEvent(new HostEvent(type, { bubbles: true }));
    }
  }

  /** A click reached `element`, an input: what it does to it. */
  clicked(element: HostElement): boolean {
    const control = this.#controls.get(element);
    if (!control?.kind || control.kind === 'range' || this.host.input.isDisabled(element)) {
      return false;
    }
    control.dirty = true;
    if (control.kind === 'checkbox') {
      this.setIndeterminate(element, false);
      this.#setChecked(element, control, !control.checked);
    } else if (control.checked) {
      // A radio that is checked stays so, and announces nothing.
      return true;
    } else {
      this.#setChecked(element, control, true);
    }
    this.#announce(element, ['input', 'change']);
    return true;
  }

  #keyDown(event: HostKeyboardEvent): void {
    const target = event.target instanceof ElementClass ? event.target : null;
    const control = target && this.#controls.get(target);
    if (!target || !control?.kind || this.host.input.isDisabled(target)) {
      return;
    }
    if (control.kind === 'range') {
      this.#rangeKey(event, target, control);
      return;
    }
    // Space checks a box or a radio and Enter does not.
    if (event.key === 'Enter') {
      event.preventDefault();
      return;
    }
    if (control.kind !== 'radio') {
      return;
    }
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) {
      return;
    }
    const set = this.#group(target).filter((r) => !this.host.input.isDisabled(r));
    const at = set.indexOf(target);
    const next = set[(at + step + set.length) % set.length];
    event.preventDefault();
    if (next && next !== target) {
      next.focus();
      this.clicked(next);
    }
  }

  // --- ranges ----------------------------------------------------------------------------

  #number(element: HostElement, name: string, fallback: number): number {
    const v = Number.parseFloat(element.getAttribute(name) ?? '');
    return Number.isFinite(v) ? v : fallback;
  }

  #bounds(element: HostElement): { min: number; max: number; step: number } {
    const min = this.#number(element, 'min', 0);
    const max = Math.max(this.#number(element, 'max', 100), min);
    const step = this.#number(element, 'step', 1);
    return { min, max, step: step > 0 ? step : 1 };
  }

  /** `value` made one a range may have: within its bounds, on a step counted from the minimum. */
  #snap(element: HostElement, value: number): number {
    const { min, max, step } = this.#bounds(element);
    const snapped = min + Math.round((value - min) / step) * step;
    // A step may not divide the range: the last whole one, not past the maximum.
    const last = min + Math.floor((max - min) / step + 1e-9) * step;
    const clamped = Math.min(Math.max(snapped, min), Math.min(max, last));
    return Math.round(clamped * 1e9) / 1e9;
  }

  #valueOf(element: HostElement, control: Control): number {
    if (control.value !== null) {
      return this.#snap(element, control.value);
    }
    const { min, max } = this.#bounds(element);
    return this.#snap(element, this.#number(element, 'value', min + (max - min) / 2));
  }

  /** Size a range's fill and the rest of its track to its value. */
  #render(element: HostElement, control: Control): void {
    const fill = control.parts.get('fill');
    const rest = control.parts.get('rest');
    if (!fill || !rest) {
      return;
    }
    const { min, max } = this.#bounds(element);
    const fraction = max > min ? (this.#valueOf(element, control) - min) / (max - min) : 0;
    fill.setProperty('flex-grow', String(Math.round(fraction * 1e6) / 1e3));
    rest.setProperty('flex-grow', String(Math.round((1 - fraction) * 1e6) / 1e3));
  }

  /** Set a range from the user: announce `input` when it moved, and `change` when `commit`. */
  #move(element: HostElement, control: Control, value: number, commit: boolean): void {
    const before = this.#valueOf(element, control);
    control.value = this.#snap(element, value);
    this.#render(element, control);
    if (this.#valueOf(element, control) !== before) {
      this.#announce(element, ['input']);
    }
    if (commit && this.#valueOf(element, control) !== control.announced) {
      control.announced = this.#valueOf(element, control);
      this.#announce(element, ['change']);
    }
  }

  #rangeKey(event: HostKeyboardEvent, element: HostElement, control: Control): void {
    const { min, max, step } = this.#bounds(element);
    const value = this.#valueOf(element, control);
    const page = Math.max(step, (max - min) / 10);
    const to: Record<string, number> = {
      ArrowRight: value + step,
      ArrowUp: value + step,
      ArrowLeft: value - step,
      ArrowDown: value - step,
      PageUp: value + page,
      PageDown: value - page,
      Home: min,
      End: max,
    };
    const next = to[event.key];
    if (next !== undefined) {
      event.preventDefault();
      control.announced ??= value;
      this.#move(element, control, next, true);
    }
  }

  /** The range under `event`, or one of whose parts it is. */
  #rangeAt(event: HostPointerEvent): { element: HostElement; control: Control } | null {
    for (let n = event.target as HostNode | null; n; n = n.composedParent) {
      const control = n instanceof ElementClass ? this.#controls.get(n) : undefined;
      if (control?.kind === 'range' && n instanceof ElementClass) {
        return { element: n, control };
      }
    }
    return null;
  }

  /** What value a pointer at `event` asks of a range: along its track, clear of the thumb's ends. */
  #valueAt(element: HostElement, control: Control, event: HostPointerEvent): number {
    const [x, y, width, height] = element.bounds();
    const vertical = element.getAttribute('data-orientation') === 'vertical';
    const thumb = control.parts.get('thumb')?.bounds();
    const size = (vertical ? thumb?.[3] : thumb?.[2]) ?? 0;
    const length = vertical ? height : width;
    const along = vertical ? event.y - y : event.x - x;
    const span = Math.max(length - size, 1);
    const raw = Math.min(Math.max((along - size / 2) / span, 0), 1);
    const fraction = vertical ? 1 - raw : raw;
    const { min, max } = this.#bounds(element);
    return min + fraction * (max - min);
  }

  #pointerDown(event: HostPointerEvent): void {
    const hit = this.#rangeAt(event);
    if (!hit || event.button !== 0 || this.host.input.isDisabled(hit.element)) {
      return;
    }
    hit.control.dragging = true;
    hit.control.announced ??= this.#valueOf(hit.element, hit.control);
    hit.element.setPointerCapture();
    this.#move(hit.element, hit.control, this.#valueAt(hit.element, hit.control, event), false);
  }

  #pointerMove(event: HostPointerEvent): void {
    const dragged = this.#dragged();
    if (dragged) {
      this.#move(
        dragged.element,
        dragged.control,
        this.#valueAt(dragged.element, dragged.control, event),
        false,
      );
    }
  }

  #pointerUp(event: HostPointerEvent): void {
    const dragged = this.#dragged();
    if (dragged) {
      dragged.control.dragging = false;
      dragged.element.releasePointerCapture();
      this.#move(
        dragged.element,
        dragged.control,
        this.#valueAt(dragged.element, dragged.control, event),
        true,
      );
    }
  }

  /** The range being dragged: the focused element's, or the last pressed. */
  #dragged(): { element: HostElement; control: Control } | null {
    const captured = this.host.input.pointerCapture;
    const control = captured && this.#controls.get(captured);
    return captured && control?.dragging ? { element: captured, control } : null;
  }
}
