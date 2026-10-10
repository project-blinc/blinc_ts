/**
 * Whether the controls of a page hold what they must: `required`, `pattern`, `minlength`, an
 * email or a URL that is well formed, a number within its `min`, `max` and `step`, a message a
 * script sets. CSS reads it as `:valid` and `:invalid`, and as `:user-valid` and `:user-invalid`
 * once the user has changed a control and left it, or a form it is in failed to submit. A form
 * checks its controls before it submits, unless it is `novalidate`.
 */
import { HostEvent } from './events.js';
import type { Host, HostElement, HostNode } from './host.js';
import { HostElement as ElementClass } from './host.js';

/** What a control's constraints say of it, as HTML's `ValidityState` does. */
export interface ValidityFlags {
  readonly valueMissing: boolean;
  readonly typeMismatch: boolean;
  readonly patternMismatch: boolean;
  readonly tooLong: boolean;
  readonly tooShort: boolean;
  readonly rangeUnderflow: boolean;
  readonly rangeOverflow: boolean;
  readonly stepMismatch: boolean;
  readonly badInput: boolean;
  readonly customError: boolean;
  readonly valid: boolean;
}

/** One broken constraint: which, and what a browser would say of it. */
interface Problem {
  readonly flag: keyof Omit<ValidityFlags, 'valid'>;
  readonly message: string;
}

const CONTROLS: ReadonlySet<string> = new Set(['input', 'select', 'textarea']);
const NUMBER = /^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$/;
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*$/;
const URL_FORM = /^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]+$/;

/** A number the way a message writes it. */
const written = (n: number): string => String(Number(n.toFixed(10)));

export class Validity {
  readonly host: Host;
  readonly #custom = new Map<HostElement, string>();
  /** Controls the user has changed since they last took focus. */
  readonly #edited = new WeakSet<HostElement>();
  /** Controls the user has typed into, which is when a value can be too short. */
  readonly #typed = new WeakSet<HostElement>();
  /** Controls whose `:user-invalid` may show: changed and left, or their form failed to submit. */
  readonly #touched = new WeakSet<HostElement>();
  /** What each control was last shown as, so a state is written only when it changes. */
  readonly #shown = new WeakMap<HostElement, string>();
  readonly #dirty = new Set<HostElement>();

  constructor(host: Host) {
    this.host = host;
  }

  /** Once the host has its root. */
  attach(): void {
    const root = this.host.root;
    const control = (event: HostEvent): HostElement | null =>
      event.target instanceof ElementClass && CONTROLS.has(event.target.tag) ? event.target : null;
    root.addEventListener('input', (event) => {
      const target = control(event);
      if (target) {
        this.#edited.add(target);
        this.#typed.add(target);
        this.changed(target);
      }
    });
    // A box, a radio or a select is settled when it changes; text when it is left.
    root.addEventListener('change', (event) => {
      const target = control(event);
      if (target && !this.host.behaviours.textFields.has(target)) {
        for (const each of this.#setOf(target)) {
          this.#touched.add(each);
          this.changed(each);
        }
      }
    });
    root.addEventListener('focusin', (event) => {
      const target = control(event);
      if (target) {
        this.#edited.delete(target);
      }
    });
    root.addEventListener('focusout', (event) => {
      const target = control(event);
      if (target && this.#edited.has(target)) {
        this.#touched.add(target);
        this.changed(target);
      }
    });
  }

  /** `element` and the controls that go with it: the radios of its set. */
  #setOf(element: HostElement): HostElement[] {
    return element.tag === 'input' && this.#typeOf(element) === 'radio'
      ? this.host.behaviours.inputs.group(element)
      : [element];
  }

  #typeOf(control: HostElement): string {
    return control.tag === 'input'
      ? (control.getAttribute('type')?.trim().toLowerCase() ?? 'text')
      : control.tag;
  }

  /** A control may be valid or invalid now when it was not; the radios of its set go with it. */
  changed(element: HostElement): void {
    if (!CONTROLS.has(element.tag) || element.destroyed) {
      return;
    }
    for (const each of this.#setOf(element)) {
      this.#dirty.add(each);
    }
    this.host.wake();
  }

  /** A subtree came or went: every control in it may be valid or invalid now. */
  subtreeChanged(node: HostNode | null): void {
    if (!(node instanceof ElementClass) || node.destroyed) {
      return;
    }
    this.changed(node);
    for (let child = node.firstChild; child; child = child.nextSibling) {
      this.subtreeChanged(child);
    }
  }

  forget(node: HostNode): void {
    if (node instanceof ElementClass) {
      this.#dirty.delete(node);
      this.#custom.delete(node);
    }
  }

  /** Before the tick's writes: give each control that may have changed the states it has now. */
  flush(): void {
    if (this.#dirty.size === 0) {
      return;
    }
    const controls = [...this.#dirty];
    this.#dirty.clear();
    for (const control of controls) {
      if (!control.destroyed) {
        this.#show(control);
      }
    }
  }

  #show(control: HostElement): void {
    const barred = !this.willValidate(control);
    const bad = !barred && this.#problems(control).length > 0;
    const user = this.#touched.has(control);
    const applies = this.#canRequire(control);
    const required = applies && control.hasAttribute('required');
    const key = `${barred}|${bad}|${user}|${applies}|${required}`;
    if (this.#shown.get(control) === key) {
      return;
    }
    this.#shown.set(control, key);
    control.setState('required', required);
    control.setState('optional', applies && !required);
    control.setState('invalid', bad);
    control.setState('valid', !barred && !bad);
    control.setState('user-invalid', bad && user);
    control.setState('user-valid', !barred && !bad && user);
  }

  // --- the constraints --------------------------------------------------------------------

  /** Whether `required` means something to `control`. */
  #canRequire(control: HostElement): boolean {
    const type = this.#typeOf(control);
    return (
      control.tag === 'select' ||
      type === 'checkbox' ||
      type === 'radio' ||
      this.host.behaviours.textFields.has(control)
    );
  }

  /**
   * Whether `control` is checked for its constraints: a field the user can fill in or choose,
   * that is neither disabled nor read-only.
   */
  willValidate(control: HostElement): boolean {
    if (!CONTROLS.has(control.tag) || this.host.input.isDisabled(control)) {
      return false;
    }
    if (!this.#canRequire(control)) {
      return false;
    }
    return !(this.host.behaviours.textFields.has(control) && control.hasAttribute('readonly'));
  }

  #problems(control: HostElement): Problem[] {
    const found: Problem[] = [];
    const custom = this.#custom.get(control);
    if (custom) {
      found.push({ flag: 'customError', message: custom });
    }
    if (!this.willValidate(control)) {
      return found;
    }
    const required = control.hasAttribute('required');
    const type = this.#typeOf(control);
    if (type === 'checkbox') {
      if (required && !control.checked) {
        found.push({
          flag: 'valueMissing',
          message: 'Please tick this box if you want to proceed.',
        });
      }
      return found;
    }
    if (type === 'radio') {
      if (required && !this.#setOf(control).some((r) => r.checked)) {
        found.push({ flag: 'valueMissing', message: 'Please select one of these options.' });
      }
      return found;
    }
    const value = control.value;
    if (control.tag === 'select') {
      if (required && value === '') {
        found.push({ flag: 'valueMissing', message: 'Please select an item in the list.' });
      }
      return found;
    }
    if (value === '') {
      if (required) {
        found.push({ flag: 'valueMissing', message: 'Please fill in this field.' });
      }
      return found;
    }
    if (type === 'number') {
      this.#numberProblems(control, value, found);
      return found;
    }
    if (type === 'email' && !EMAIL.test(value)) {
      found.push({
        flag: 'typeMismatch',
        message: value.includes('@')
          ? 'Please enter an email address.'
          : 'Please include an "@" in the email address.',
      });
    }
    if (type === 'url' && !URL_FORM.test(value)) {
      found.push({ flag: 'typeMismatch', message: 'Please enter a URL.' });
    }
    const pattern = control.getAttribute('pattern');
    if (pattern && control.tag === 'input') {
      let matches = true;
      try {
        matches = new RegExp(`^(?:${pattern})$`, 'v').test(value);
      } catch {
        // A pattern that is not an expression constrains nothing.
      }
      if (!matches) {
        found.push({ flag: 'patternMismatch', message: 'Please match the requested format.' });
      }
    }
    const min = Number.parseInt(control.getAttribute('minlength') ?? '', 10);
    // As a browser has it, too short only once the user has typed in it.
    if (min > 0 && value.length < min && this.#typed.has(control)) {
      found.push({
        flag: 'tooShort',
        message: `Please lengthen this text to ${min} characters or more.`,
      });
    }
    const max = Number.parseInt(control.getAttribute('maxlength') ?? '', 10);
    if (max >= 0 && value.length > max) {
      found.push({
        flag: 'tooLong',
        message: `Please shorten this text to ${max} characters or less.`,
      });
    }
    return found;
  }

  #numberProblems(control: HostElement, value: string, found: Problem[]): void {
    const text = value.trim();
    if (!NUMBER.test(text)) {
      found.push({ flag: 'badInput', message: 'Please enter a number.' });
      return;
    }
    const n = Number(text);
    const attribute = (name: string): number | undefined => {
      const v = Number.parseFloat(control.getAttribute(name) ?? '');
      return Number.isFinite(v) ? v : undefined;
    };
    const min = attribute('min');
    const max = attribute('max');
    const step = attribute('step');
    if (min !== undefined && n < min) {
      found.push({
        flag: 'rangeUnderflow',
        message: `Value must be greater than or equal to ${written(min)}.`,
      });
    }
    if (max !== undefined && n > max) {
      found.push({
        flag: 'rangeOverflow',
        message: `Value must be less than or equal to ${written(max)}.`,
      });
    }
    if (step !== undefined && step > 0) {
      const steps = (n - (min ?? 0)) / step;
      if (Math.abs(steps - Math.round(steps)) > 1e-9) {
        found.push({ flag: 'stepMismatch', message: 'Please enter a valid value.' });
      }
    }
  }

  // --- what a script reads ----------------------------------------------------------------

  /** Why `control` is invalid, as a browser says it; empty when it is valid or not checked. */
  validationMessage(control: HostElement): string {
    return this.#problems(control)[0]?.message ?? '';
  }

  /** What `control`'s constraints say, as `ValidityState` does. */
  validity(control: HostElement): ValidityFlags {
    const problems = this.#problems(control);
    const has = (flag: Problem['flag']): boolean => problems.some((p) => p.flag === flag);
    return {
      valueMissing: has('valueMissing'),
      typeMismatch: has('typeMismatch'),
      patternMismatch: has('patternMismatch'),
      tooLong: has('tooLong'),
      tooShort: has('tooShort'),
      rangeUnderflow: has('rangeUnderflow'),
      rangeOverflow: has('rangeOverflow'),
      stepMismatch: has('stepMismatch'),
      badInput: has('badInput'),
      customError: has('customError'),
      valid: problems.length === 0,
    };
  }

  /** A message of a script's: the control is invalid while it is not empty. */
  setCustomValidity(control: HostElement, message: string): void {
    if (message === '') {
      this.#custom.delete(control);
    } else {
      this.#custom.set(control, message);
    }
    this.changed(control);
  }

  /**
   * Whether `control`, or every control of a form, holds what it must. Each that does not
   * fires `invalid`.
   */
  checkValidity(element: HostElement): boolean {
    if (element.tag === 'form') {
      return this.#checkForm(element, false);
    }
    if (this.#problems(element).length === 0) {
      return true;
    }
    element.dispatchEvent(new HostEvent('invalid', { cancelable: true }));
    return false;
  }

  /** As `checkValidity`; what is not valid shows as `:user-invalid`, and the first such control takes focus. */
  reportValidity(element: HostElement): boolean {
    if (element.tag === 'form') {
      return this.#checkForm(element, true);
    }
    const valid = this.checkValidity(element);
    if (!valid) {
      this.#touched.add(element);
      this.changed(element);
      element.focus();
    }
    return valid;
  }

  #checkForm(form: HostElement, report: boolean): boolean {
    const controls = this.host.behaviours.forms.elements(form).filter((c) => CONTROLS.has(c.tag));
    const invalid = controls.filter((c) => !this.checkValidity(c));
    if (report && invalid.length > 0) {
      for (const c of controls) {
        this.#touched.add(c);
        this.changed(c);
      }
      invalid[0]?.focus();
    }
    return invalid.length === 0;
  }

  /** Whether `form` may be submitted by `submitter`: its controls hold what they must, or it is not checked. */
  allowsSubmit(form: HostElement, submitter: HostElement | null): boolean {
    if (form.hasAttribute('novalidate') || submitter?.hasAttribute('formnovalidate')) {
      return true;
    }
    return this.#checkForm(form, true);
  }

  /** Put `control` back as untouched, as a form's reset does. */
  reset(control: HostElement): void {
    if (CONTROLS.has(control.tag)) {
      this.#touched.delete(control);
      this.#edited.delete(control);
      this.#typed.delete(control);
      this.changed(control);
    }
  }
}
