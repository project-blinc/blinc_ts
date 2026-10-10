/**
 * What a `form` does: its controls, what they hold as `FormData`, and the default actions of a
 * `button`, which submits or resets the form it belongs to. There is nowhere for a submission to
 * go; the `submit` event is where an app takes what the form holds.
 */
import { HostEvent } from './events.js';
import type { Host, HostElement } from './host.js';
import { HostElement as ElementClass } from './host.js';

/** The elements a form owns: its controls. */
const LISTED: ReadonlySet<string> = new Set(['input', 'button', 'select', 'textarea']);

/** The event a form fires when it is submitted, which says what submitted it. */
export class HostSubmitEvent extends HostEvent {
  readonly submitter: HostElement | null;
  constructor(submitter: HostElement | null) {
    super('submit', { bubbles: true, cancelable: true });
    this.submitter = submitter;
  }
}

export class Forms {
  readonly host: Host;

  constructor(host: Host) {
    this.host = host;
  }

  /** The `type` of a button, as HTML defaults it. */
  buttonType(button: HostElement): 'submit' | 'reset' | 'button' {
    const type = button.getAttribute('type')?.trim().toLowerCase();
    return type === 'reset' || type === 'button' ? type : 'submit';
  }

  /** The form `control` belongs to: the one its `form` attribute names, else the one around it. */
  ownerOf(control: HostElement): HostElement | null {
    const named = control.getAttribute('form')?.trim();
    if (named) {
      const found = this.#byId(named);
      return found?.tag === 'form' ? found : null;
    }
    for (let n = control.parentNode; n; n = n.parentNode) {
      if (n.tag === 'form') {
        return n;
      }
    }
    return null;
  }

  /** A form's controls, in tree order: those inside it, and those anywhere that name it. */
  elements(form: HostElement): HostElement[] {
    const found: HostElement[] = [];
    const walk = (parent: HostElement): void => {
      for (let child = parent.firstChild; child; child = child.nextSibling) {
        if (child instanceof ElementClass) {
          if (LISTED.has(child.tag) && this.ownerOf(child) === form) {
            found.push(child);
          }
          walk(child);
        }
      }
    };
    walk(this.host.root);
    return found;
  }

  /** What the form holds: each named control that is not disabled, a box or a radio only when checked. */
  formData(form: HostElement): FormData {
    const data = new FormData();
    for (const control of this.elements(form)) {
      const name = control.getAttribute('name');
      if (!name || control.tag !== 'input' || this.host.input.isDisabled(control)) {
        continue;
      }
      const type = control.getAttribute('type')?.trim().toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        if (control.checked) {
          data.append(name, control.value);
        }
      } else if (type === 'range') {
        data.append(name, control.value);
      }
    }
    return data;
  }

  /**
   * Submit `form` as `submitter` asks: the `submit` event, which a listener may cancel. Nothing
   * is sent anywhere. False when it was cancelled.
   */
  requestSubmit(form: HostElement, submitter: HostElement | null = null): boolean {
    if (form.tag !== 'form') {
      throw new TypeError('requestSubmit is for a form');
    }
    if (
      submitter &&
      !(
        submitter.tag === 'button' &&
        this.buttonType(submitter) === 'submit' &&
        this.ownerOf(submitter) === form
      )
    ) {
      throw new TypeError('The submitter is not a submit button of this form');
    }
    const allowed = form.dispatchEvent(new HostSubmitEvent(submitter));
    if (allowed) {
      // A form of method dialog closes the dialog it is in.
      this.host.behaviours.dialogs.submitted(form, submitter);
    }
    return allowed;
  }

  /** Put every control back as it began, unless a listener cancels the `reset` event. */
  reset(form: HostElement): boolean {
    if (form.tag !== 'form') {
      throw new TypeError('reset is for a form');
    }
    if (!form.dispatchEvent(new HostEvent('reset', { bubbles: true, cancelable: true }))) {
      return false;
    }
    for (const control of this.elements(form)) {
      this.host.behaviours.inputs.reset(control);
    }
    return true;
  }

  /** A click reached `button`: submit or reset its form. */
  clicked(button: HostElement): boolean {
    if (this.host.input.isDisabled(button)) {
      return false;
    }
    const form = this.ownerOf(button);
    const type = this.buttonType(button);
    if (!form || type === 'button') {
      return false;
    }
    if (type === 'submit') {
      this.requestSubmit(form, button);
    } else {
      this.reset(form);
    }
    return true;
  }

  #byId(id: string): HostElement | null {
    const find = (parent: HostElement): HostElement | null => {
      for (let child = parent.firstChild; child; child = child.nextSibling) {
        if (child instanceof ElementClass) {
          if (child.id === id) {
            return child;
          }
          const found = find(child);
          if (found) {
            return found;
          }
        }
      }
      return null;
    };
    return find(this.host.root);
  }
}
