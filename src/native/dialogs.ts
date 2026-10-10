/**
 * What a `dialog` does: `show` opens it in place, `showModal` in the top layer over a dimmed
 * backdrop with focus kept inside it, and `close` shuts it, saying why in `returnValue`. Escape
 * asks it to close with a `cancel` event a listener may refuse; with `closedby="any"` so does a
 * press on the backdrop. A `form` whose `method` is `dialog` closes the dialog it is in when it
 * is submitted.
 */
import { HostEvent } from './events.js';
import type { Host, HostElement } from './host.js';
import { HostElement as ElementClass } from './host.js';
import type { HostKeyboardEvent } from './input.js';
import { TopLayer, type TopLayerEntry } from './top-layer.js';

interface Modal {
  readonly entry: TopLayerEntry;
  /** Where it was in the tree, to be put back when it has closed. */
  readonly parent: HostElement | null;
  readonly before: HostElement | null;
}

export class Dialogs {
  readonly host: Host;
  /** The dialogs open as modals, and the return value each has. */
  readonly #modals = new Map<HostElement, Modal>();
  readonly #returned = new WeakMap<HostElement, string>();

  constructor(host: Host) {
    this.host = host;
  }

  /** Once the host has its root. */
  attach(): void {
    // Escape asks the topmost modal dialog to close, unless something inside took the key.
    this.host.root.addEventListener('keydown', (event) => {
      const key = event as HostKeyboardEvent;
      if (key.key !== 'Escape' || key.defaultPrevented) {
        return;
      }
      const top = TopLayer.of(this.host).entries.at(-1);
      const dialog = top && this.#dialogOf(top);
      if (dialog) {
        key.preventDefault();
        if (this.#closedby(dialog) !== 'none') {
          this.requestClose(dialog);
        }
      }
    });
  }

  #dialogOf(entry: TopLayerEntry): HostElement | undefined {
    return this.#modals.has(entry.content) ? entry.content : undefined;
  }

  #check(dialog: HostElement, what: string): void {
    if (dialog.tag !== 'dialog') {
      throw new TypeError(`${what} is for a dialog`);
    }
  }

  /** Whether `dialog` is open, however it was opened. */
  isOpen(dialog: HostElement): boolean {
    return dialog.hasAttribute('open');
  }

  /** Whether it is open as a modal. */
  isModal(dialog: HostElement): boolean {
    return this.#modals.has(dialog);
  }

  /** What closing it last said, or `''`. */
  returnValue(dialog: HostElement): string {
    return this.#returned.get(dialog) ?? '';
  }

  setReturnValue(dialog: HostElement, value: string): void {
    this.#returned.set(dialog, value);
  }

  /** Open it where it is. */
  show(dialog: HostElement): void {
    this.#check(dialog, 'show');
    if (this.isOpen(dialog)) {
      if (this.isModal(dialog)) {
        throw new Error('The dialog is already open as a modal');
      }
      return;
    }
    dialog.setAttribute('open', '');
  }

  /** Open it in the top layer, over a dimmed backdrop, with focus inside it. */
  showModal(dialog: HostElement): void {
    this.#check(dialog, 'showModal');
    if (this.isOpen(dialog)) {
      throw new Error('The dialog is already open');
    }
    const parent = dialog.parentNode;
    let before: HostElement | null = null;
    for (let n = dialog.nextSibling; n; n = n.nextSibling) {
      if (n instanceof ElementClass) {
        before = n;
        break;
      }
    }
    dialog.setAttribute('open', '');
    // Escape and the backdrop are this module's to answer, since a `cancel` may be refused.
    const entry = TopLayer.of(this.host).open(dialog, { modal: true, dismissible: false });
    this.#modals.set(dialog, { entry, parent, before });
    entry.layer.addEventListener('pointerdown', (event) => {
      const target = event.target as HostElement | null;
      if (
        (target === entry.layer || target?.tag === 'backdrop') &&
        this.#closedby(dialog) === 'any' &&
        this.#modals.get(dialog)?.entry === entry
      ) {
        event.preventDefault();
        this.requestClose(dialog);
      }
    });
  }

  #closedby(dialog: HostElement): 'any' | 'closerequest' | 'none' {
    const value = dialog.getAttribute('closedby')?.trim().toLowerCase();
    return value === 'any' || value === 'none' ? value : 'closerequest';
  }

  /** Ask it to close: a `cancel` event, which a listener may cancel, then `close`. */
  requestClose(dialog: HostElement, returnValue?: string): void {
    this.#check(dialog, 'requestClose');
    if (!this.isOpen(dialog)) {
      return;
    }
    if (dialog.dispatchEvent(new HostEvent('cancel', { cancelable: true }))) {
      this.close(dialog, returnValue);
    }
  }

  /** Close it, with `returnValue` if one is given. */
  close(dialog: HostElement, returnValue?: string): void {
    this.#check(dialog, 'close');
    if (!this.isOpen(dialog)) {
      return;
    }
    if (returnValue !== undefined) {
      this.#returned.set(dialog, returnValue);
    }
    // Whatever takes `open` away, this is what closes it: see `attributeChanged`.
    dialog.removeAttribute('open');
  }

  #restore(dialog: HostElement, modal: Modal): void {
    if (
      dialog.destroyed ||
      this.#modals.has(dialog) ||
      dialog.parentNode ||
      !modal.parent ||
      modal.parent.destroyed
    ) {
      return;
    }
    const before =
      modal.before && !modal.before.destroyed && modal.before.parentNode === modal.parent
        ? modal.before
        : null;
    modal.parent.insertBefore(dialog, before);
  }

  /** The dialog a form is in, closed by submitting it when its `method` is `dialog`. */
  submitted(form: HostElement, submitter: HostElement | null): void {
    if (form.getAttribute('method')?.trim().toLowerCase() !== 'dialog') {
      return;
    }
    for (let n: HostElement | null = form.composedParent; n; n = n.composedParent) {
      if (n.tag === 'dialog') {
        if (this.isOpen(n)) {
          this.close(n, submitter?.getAttribute('value') ?? undefined);
        }
        return;
      }
    }
  }

  /** `open` came off a dialog, by `close` or a script: it is closed, and says so. */
  attributeChanged(dialog: HostElement, name: string): void {
    if (dialog.tag !== 'dialog' || name !== 'open' || dialog.hasAttribute('open')) {
      return;
    }
    const modal = this.#modals.get(dialog);
    this.#modals.delete(dialog);
    if (modal) {
      // It animates away in the top layer, then goes back where it was in the tree.
      void modal.entry.close().then(() => this.#restore(dialog, modal));
    }
    dialog.dispatchEvent(new HostEvent('close'));
  }

  forget(element: HostElement): void {
    const modal = this.#modals.get(element);
    if (modal) {
      this.#modals.delete(element);
      void modal.entry.close();
    }
  }
}
