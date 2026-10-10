/**
 * Input on a host tree: pointer hover, presses, clicks and pointer capture;
 * focus and tab order; keys, typed text and input-method composition; and
 * wheel scrolling. It keeps each element's interaction state (hover,
 * active, focus, focus-visible, focus-within) for the CSS cascade, and
 * dispatches events through the capture, target and bubble phases.
 */
import { HostEvent, HostPointerEvent, type HostEventInit } from './events.js';
import type { Host, HostElement } from './host.js';
import { HostClipboardEvent } from './clipboard.js';

export interface KeyModifiers {
  shift: boolean;
  control: boolean;
  alt: boolean;
  /** Command on macOS, the Windows key elsewhere. */
  meta: boolean;
}
const NO_MODIFIERS: KeyModifiers = Object.freeze({
  shift: false,
  control: false,
  alt: false,
  meta: false,
});

export interface HostKeyboardEventInit extends HostEventInit {
  /** What the key means under the current layout, as the DOM names it: `a`, `Enter`, `ArrowLeft`, ` `. */
  key: string;
  /** Which key it is on the keyboard, whatever the layout: `KeyA`, `Enter`. */
  code?: string;
  /** 0 standard, 1 left, 2 right, 3 numpad. */
  location?: number;
  repeat?: boolean;
  modifiers?: KeyModifiers;
}
export class HostKeyboardEvent extends HostEvent {
  readonly key: string;
  readonly code: string;
  readonly location: number;
  readonly repeat: boolean;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  constructor(type: string, init: HostKeyboardEventInit) {
    super(type, { bubbles: init.bubbles ?? true, cancelable: init.cancelable ?? true });
    const m = init.modifiers ?? NO_MODIFIERS;
    this.key = init.key;
    this.code = init.code ?? '';
    this.location = init.location ?? 0;
    this.repeat = init.repeat ?? false;
    this.shiftKey = m.shift;
    this.ctrlKey = m.control;
    this.altKey = m.alt;
    this.metaKey = m.meta;
  }
}

/** Text typed, or committed by an input method, for the focused element. */
export class HostTextEvent extends HostEvent {
  readonly data: string;
  constructor(type: string, data: string) {
    super(type, { bubbles: true, cancelable: true });
    this.data = data;
  }
}

/**
 * An input method's text being composed, not yet typed. `cursor` is the
 * caret's offset in `data`, or -1 for none. `compositionend` carries the
 * committed text, or none when composing was cancelled.
 */
export class HostCompositionEvent extends HostEvent {
  readonly data: string;
  readonly cursor: number;
  constructor(type: string, data: string, cursor = -1) {
    super(type, { bubbles: true, cancelable: false });
    this.data = data;
    this.cursor = cursor;
  }
}

/** Focus moving. `focus` and `blur` do not bubble; `focusin` and `focusout` do. */
export class HostFocusEvent extends HostEvent {
  /** The element losing focus for `focus`/`focusin`, gaining it for `blur`/`focusout`. */
  readonly relatedTarget: HostElement | null;
  /** True when the keyboard moved focus, the case `:focus-visible` styles. */
  readonly visible: boolean;
  constructor(type: string, relatedTarget: HostElement | null, visible: boolean) {
    super(type, { bubbles: type === 'focusin' || type === 'focusout' });
    this.relatedTarget = relatedTarget;
    this.visible = visible;
  }
}

/** An element's interaction state, which CSS pseudo-classes match. */
export interface InteractionState {
  hover: boolean;
  active: boolean;
  focus: boolean;
  focusVisible: boolean;
  focusWithin: boolean;
  /** The element has a `disabled` attribute: it takes no presses, clicks or focus. */
  disabled: boolean;
}
export type InteractionChange = (element: HostElement, state: Readonly<InteractionState>) => void;

/** Elements that take focus without a `tabindex`, unless disabled. */
const focusableTags = new Set(['button', 'input', 'textarea', 'select', 'summary']);
/** The elements a disabled fieldset disables. */
const controlTags = new Set(['button', 'input', 'textarea', 'select']);
/** Presses in quick succession at about the same place count as one double- or triple-click. */
const MULTI_CLICK_MS = 500;
const MULTI_CLICK_SLOP = 4;
/** How far one wheel line scrolls, in layout units. */
export const WHEEL_LINE = 40;

function chainOf(element: HostElement | null): HostElement[] {
  const chain: HostElement[] = [];
  for (let node = element; node; node = node.parentNode) {
    chain.push(node);
  }
  return chain;
}
function buttonBit(button: number): number {
  return button === 1 ? 4 : button === 2 ? 2 : 1 << button;
}

export class Input {
  readonly #host: Host;
  readonly #states = new Map<HostElement, InteractionState>();
  readonly #listeners = new Set<InteractionChange>();
  readonly #cursorListeners = new Set<(cursor: string) => void>();
  #cursor = 'default';
  #x = 0;
  #y = 0;
  #inside = false;
  #buttons = 0;
  #modifiers: KeyModifiers = NO_MODIFIERS;
  /** The hovered element and its ancestors, innermost first. */
  #chain: HostElement[] = [];
  #pressChain: HostElement[] = [];
  #capture: HostElement | null = null;
  #focused: HostElement | null = null;
  #byKeyboard = false;
  #within: HostElement[] = [];
  readonly #scopes: HostElement[] = [];
  #composing = false;
  #lastPress = { time: -Infinity, x: 0, y: 0, count: 0 };

  /** @internal Use host.input. */
  constructor(host: Host) {
    this.#host = host;
  }

  get x(): number {
    return this.#x;
  }
  get y(): number {
    return this.#y;
  }
  /** Whether the pointer is over the window. */
  get inside(): boolean {
    return this.#inside;
  }
  /** Bit mask of held buttons: 1 primary, 2 secondary, 4 auxiliary. */
  get buttons(): number {
    return this.#buttons;
  }
  get modifiers(): KeyModifiers {
    return this.#modifiers;
  }
  /** The element under the pointer, or the capturing element during a capture. */
  get hovered(): HostElement | null {
    return this.#chain[0] ?? null;
  }
  get focused(): HostElement | null {
    return this.#focused;
  }
  get pointerCapture(): HostElement | null {
    return this.#capture;
  }

  /** The element's interaction state; all false for one never interacted with. */
  stateOf(element: HostElement): Readonly<InteractionState> {
    return (
      this.#states.get(element) ?? {
        hover: false,
        active: false,
        focus: false,
        focusVisible: false,
        focusWithin: false,
        disabled: false,
      }
    );
  }
  /** Called after an element's interaction state changes, as the cascade needs. */
  onInteraction(listener: InteractionChange): () => void {
    const callback: InteractionChange = (element, state) => listener(element, state);
    this.#listeners.add(callback);
    return () => {
      this.#listeners.delete(callback);
    };
  }
  #set(element: HostElement, key: keyof InteractionState, value: boolean): void {
    const state = this.#states.get(element) ?? {
      hover: false,
      active: false,
      focus: false,
      focusVisible: false,
      focusWithin: false,
      disabled: false,
    };
    if (state[key] === value) {
      return;
    }
    state[key] = value;
    if (Object.values(state).some(Boolean)) {
      this.#states.set(element, state);
    } else {
      this.#states.delete(element);
    }
    for (const listener of this.#listeners) {
      listener(element, state);
    }
  }

  /** The CSS cursor of the element under the pointer, or its nearest ancestor that sets one. */
  get cursor(): string {
    return this.#cursor;
  }
  /** Called when the cursor changes; a mounted host shows it in its window. */
  onCursor(listener: (cursor: string) => void): () => void {
    const callback = (cursor: string) => listener(cursor);
    this.#cursorListeners.add(callback);
    return () => {
      this.#cursorListeners.delete(callback);
    };
  }
  /** @internal Work out the cursor again, after hover or an element's `cursor` changed. */
  updateCursor(): void {
    let cursor = 'default';
    for (const element of this.#chain) {
      const own = this.#host.cursorOf(element);
      if (own !== undefined && own !== 'auto') {
        cursor = own;
        break;
      }
    }
    if (cursor !== this.#cursor) {
      this.#cursor = cursor;
      for (const listener of this.#cursorListeners) {
        listener(cursor);
      }
    }
  }
  /** @internal An attribute changed: `disabled` changes interaction state and drops focus. */
  attributeChanged(element: HostElement, name: string): void {
    if (name !== 'disabled') {
      return;
    }
    const disabled = element.hasAttribute('disabled');
    this.#set(element, 'disabled', disabled);
    if (element.tag === 'fieldset') {
      this.refreshDisabled(element);
    }
    if (disabled && this.#focused && chainOf(this.#focused).includes(element)) {
      this.blur();
    }
  }

  /** Whether `element`, or an element it is in, is disabled. */
  isDisabled(element: HostElement): boolean {
    return disabledIn(chainOf(element));
  }

  /**
   * The controls under `root` take their `:disabled` from the elements around
   * them, as those in a disabled fieldset do: the state follows the fieldset,
   * and a control's own attribute still disables it.
   */
  refreshDisabled(root: HostElement): void {
    const walk = (element: HostElement) => {
      if (element !== root && controlTags.has(element.tag)) {
        this.#set(element, 'disabled', disabledIn(chainOf(element)));
      }
      for (const child of element.childNodes) {
        if ('tag' in child) {
          walk(child as HostElement);
        }
      }
    };
    walk(root);
  }

  setModifiers(modifiers: KeyModifiers): void {
    this.#modifiers = modifiers;
  }

  #pointerEvent(
    type: string,
    init: { button?: number; deltaX?: number; deltaY?: number; detail?: number; bubbles?: boolean },
  ): HostPointerEvent {
    return new HostPointerEvent(type, {
      x: this.#x,
      y: this.#y,
      buttons: this.#buttons,
      modifiers: this.#modifiers,
      ...init,
      ...(init.bubbles === false ? { cancelable: false } : {}),
    });
  }

  /** Hit-test again where the pointer is, for when layout moved things under it. */
  refresh(): void {
    if (this.#inside && !this.#capture) {
      this.#retarget(chainOf(this.#host.elementAt(this.#x, this.#y)));
    }
  }

  /** Move hover to `chain`: leave events innermost first, enter events outermost first. */
  #retarget(chain: HostElement[]): void {
    const before = this.#chain;
    if (before[0] === chain[0] && before.length === chain.length) {
      return;
    }
    this.#chain = chain;
    const oldTarget = before[0];
    const newTarget = chain[0];
    if (oldTarget && oldTarget !== newTarget && !oldTarget.destroyed) {
      oldTarget.dispatchEvent(this.#pointerEvent('pointerout', {}));
    }
    for (const element of before) {
      if (!chain.includes(element) && !element.destroyed) {
        this.#set(element, 'hover', false);
        element.dispatchEvent(this.#pointerEvent('pointerleave', { bubbles: false }));
      }
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      const element = chain[i]!;
      if (!before.includes(element)) {
        this.#set(element, 'hover', true);
        element.dispatchEvent(this.#pointerEvent('pointerenter', { bubbles: false }));
      }
    }
    if (newTarget && newTarget !== oldTarget) {
      newTarget.dispatchEvent(this.#pointerEvent('pointerover', {}));
    }
    this.updateCursor();
  }

  /** The pointer moved to (x, y), in layout units. */
  pointerMove(x: number, y: number): boolean {
    this.#x = x;
    this.#y = y;
    this.#inside = true;
    if (!this.#capture) {
      this.#retarget(chainOf(this.#host.elementAt(x, y)));
    }
    const target = this.#capture ?? this.#chain[0] ?? this.#host.root;
    return target.dispatchEvent(this.#pointerEvent('pointermove', {}));
  }

  /** The pointer left the window: nothing is hovered. */
  pointerLeave(): void {
    this.#inside = false;
    if (!this.#capture) {
      this.#retarget([]);
    }
  }

  /** `button` went down where the pointer is: 0 primary, 1 auxiliary, 2 secondary. */
  pointerDown(button = 0): boolean {
    this.refresh();
    this.#byKeyboard = false;
    this.#buttons |= buttonBit(button);
    const chain = this.#capture ? chainOf(this.#capture) : this.#chain;
    const target = chain[0] ?? this.#host.root;
    if (disabledIn(chain)) {
      return false;
    }
    if (button === 0) {
      const now = performance.now();
      const last = this.#lastPress;
      const near =
        Math.abs(this.#x - last.x) <= MULTI_CLICK_SLOP &&
        Math.abs(this.#y - last.y) <= MULTI_CLICK_SLOP;
      const count = now - last.time <= MULTI_CLICK_MS && near ? last.count + 1 : 1;
      this.#lastPress = { time: now, x: this.#x, y: this.#y, count };
      this.#pressChain = [...chain];
      for (const element of chain) {
        this.#set(element, 'active', true);
      }
    }
    const allowed = target.dispatchEvent(this.#pointerEvent('pointerdown', { button }));
    // Pressing focuses the nearest focusable element, or takes focus away.
    if (allowed && button === 0) {
      const focusable = chain.find((element) => this.isFocusable(element, false));
      if (focusable) {
        this.focus(focusable, false);
      } else {
        this.blur();
      }
    }
    return allowed;
  }

  /**
   * `button` came up. The deepest element both the press and the release
   * were over is clicked, and pointer capture ends.
   */
  pointerUp(button = 0): boolean {
    this.refresh();
    this.#buttons &= ~buttonBit(button);
    const chain = this.#capture ? chainOf(this.#capture) : this.#chain;
    const target = chain[0] ?? this.#host.root;
    const blocked = disabledIn(chain);
    const allowed = !blocked && target.dispatchEvent(this.#pointerEvent('pointerup', { button }));
    if (this.#capture) {
      this.releasePointerCapture(this.#capture);
    }
    if (button !== 0) {
      return allowed;
    }
    const pressed = this.#pressChain;
    this.#pressChain = [];
    for (const element of pressed) {
      if (!element.destroyed) {
        this.#set(element, 'active', false);
      }
    }
    if (blocked || disabledIn(pressed)) {
      return allowed;
    }
    const clicked = chain.find((element) => pressed.includes(element));
    if (clicked) {
      const detail = this.#lastPress.count;
      clicked.dispatchEvent(this.#pointerEvent('click', { button, detail }));
      if (detail === 2 && !clicked.destroyed) {
        clicked.dispatchEvent(this.#pointerEvent('dblclick', { button, detail }));
      }
    }
    return allowed;
  }

  /**
   * A wheel or trackpad scrolled by (dx, dy) layout units where the pointer
   * is. Unless a listener cancels it, the innermost scroll container that can
   * still move that way scrolls, and the rest passes on at its edge.
   */
  wheel(deltaX: number, deltaY: number): boolean {
    this.refresh();
    const target = this.#chain[0] ?? this.#host.root;
    const allowed = target.dispatchEvent(this.#pointerEvent('wheel', { deltaX, deltaY }));
    if (allowed) {
      let dx = deltaX,
        dy = deltaY;
      for (const element of this.#chain) {
        if (dx === 0 && dy === 0) {
          break;
        }
        [dx, dy] = this.#host.scrollBy(element, dx, dy);
      }
    }
    return allowed;
  }

  /** Route later pointer events to `element` until release, whatever is under the pointer. */
  setPointerCapture(element: HostElement): void {
    if (this.#capture === element) {
      return;
    }
    if (this.#capture) {
      this.releasePointerCapture(this.#capture);
    }
    this.#capture = element;
    this.#retarget(chainOf(element));
    element.dispatchEvent(this.#pointerEvent('gotpointercapture', {}));
  }
  releasePointerCapture(element: HostElement): void {
    if (this.#capture !== element) {
      return;
    }
    this.#capture = null;
    if (!element.destroyed) {
      element.dispatchEvent(this.#pointerEvent('lostpointercapture', {}));
    }
    this.refresh();
  }

  /**
   * Whether `element` takes focus: a `tabindex` of 0 or more, or a built-in
   * control, unless disabled. With `byTab` false, a negative `tabindex`
   * also counts, as it does for a press or a script.
   */
  isFocusable(element: HostElement, byTab = true): boolean {
    if (element.destroyed || disabledIn(chainOf(element))) {
      return false;
    }
    const index = element.getAttribute('tabindex');
    if (index !== null && index.trim() !== '' && Number.isInteger(Number(index))) {
      return byTab ? Number(index) >= 0 : true;
    }
    return focusableTags.has(element.tag) || (element.tag === 'a' && element.hasAttribute('href'));
  }

  /** Focus `element`; `visible` when the keyboard moved focus there. False if it cannot take focus. */
  focus(element: HostElement, visible = this.#byKeyboard): boolean {
    if (!this.isFocusable(element, false)) {
      return false;
    }
    const before = this.#focused;
    if (before === element) {
      this.#set(element, 'focusVisible', visible);
      return true;
    }
    if (before) {
      this.#blur(before, element);
    }
    this.#focused = element;
    this.#set(element, 'focus', true);
    this.#set(element, 'focusVisible', visible);
    this.#updateWithin();
    element.dispatchEvent(new HostFocusEvent('focus', before, visible));
    if (this.#focused === element) {
      element.dispatchEvent(new HostFocusEvent('focusin', before, visible));
    }
    return true;
  }
  /** Take focus from whatever has it. */
  blur(): void {
    const before = this.#focused;
    if (before) {
      this.#blur(before, null);
      this.#updateWithin();
    }
  }
  #blur(element: HostElement, next: HostElement | null): void {
    this.#focused = null;
    this.#set(element, 'focus', false);
    this.#set(element, 'focusVisible', false);
    if (!element.destroyed) {
      element.dispatchEvent(new HostFocusEvent('blur', next, false));
      element.dispatchEvent(new HostFocusEvent('focusout', next, false));
    }
  }
  #updateWithin(): void {
    const next = chainOf(this.#focused);
    for (const element of this.#within) {
      if (!next.includes(element)) {
        this.#set(element, 'focusWithin', false);
      }
    }
    for (const element of next) {
      this.#set(element, 'focusWithin', true);
    }
    this.#within = next;
  }

  /**
   * Keep Tab and Shift+Tab inside `element` until the returned function
   * releases it, as a modal dialog keeps focus in itself. Scopes nest.
   */
  trapFocus(element: HostElement): () => void {
    this.#scopes.push(element);
    return () => {
      const index = this.#scopes.lastIndexOf(element);
      if (index >= 0) {
        this.#scopes.splice(index, 1);
      }
    };
  }

  /** Focus the next focusable element in document order, or the previous, wrapping. */
  moveFocus(backward = false): void {
    const scope = this.#scopes.at(-1) ?? this.#host.root;
    const order: HostElement[] = [];
    const walk = (element: HostElement) => {
      if (this.isFocusable(element)) {
        order.push(element);
      }
      for (const child of element.childNodes) {
        if ('tag' in child) {
          walk(child as HostElement);
        }
      }
    };
    walk(scope);
    if (order.length === 0) {
      return;
    }
    // Positive tabindex values come first, in their order; then document order.
    const index = (element: HostElement) => Number(element.getAttribute('tabindex') ?? 0) || 0;
    const positive = order.filter((element) => index(element) > 0);
    positive.sort((a, b) => index(a) - index(b));
    const sorted = [...positive, ...order.filter((element) => index(element) <= 0)];
    const at = this.#focused ? sorted.indexOf(this.#focused) : -1;
    const next =
      at < 0
        ? backward
          ? sorted.length - 1
          : 0
        : (at + (backward ? sorted.length - 1 : 1)) % sorted.length;
    this.focus(sorted[next]!, true);
  }

  /**
   * A key went down. It goes to the focused element, or the root, and
   * bubbles. Unless a listener cancels it, Tab and Shift+Tab move focus and
   * Enter clicks the focused element.
   */
  keyDown(init: HostKeyboardEventInit): boolean {
    this.#byKeyboard = true;
    const allowed = this.#key('keydown', init);
    const m = init.modifiers ?? this.#modifiers;
    const shortcut = process.platform === 'darwin' ? m.meta : m.control;
    const clipboard =
      shortcut && !m.alt
        ? ({ c: 'copy', x: 'cut', v: 'paste' } as const)[init.key.toLowerCase()]
        : undefined;
    if (allowed && clipboard) {
      (this.#focused ?? this.#host.root).dispatchEvent(
        new HostClipboardEvent(clipboard, this.#host.clipboard),
      );
    } else if (allowed && init.key === 'Tab') {
      this.moveFocus(init.modifiers?.shift ?? this.#modifiers.shift);
    } else if (allowed && init.key === 'Enter') {
      this.#activate();
    }
    return allowed;
  }
  /** A key came up. Unless a listener cancels it, Space clicks the focused element. */
  keyUp(init: HostKeyboardEventInit): boolean {
    const allowed = this.#key('keyup', init);
    if (allowed && init.key === ' ') {
      this.#activate();
    }
    return allowed;
  }
  #key(type: string, init: HostKeyboardEventInit): boolean {
    const target = this.#focused ?? this.#host.root;
    return target.dispatchEvent(
      new HostKeyboardEvent(type, { modifiers: this.#modifiers, ...init }),
    );
  }
  #activate(): void {
    const focused = this.#focused;
    if (focused && !disabledIn(chainOf(focused))) {
      focused.dispatchEvent(this.#pointerEvent('click', { button: 0, detail: 1 }));
    }
  }

  /** Text was typed or committed: a `textinput` event at the focused element. */
  text(data: string): boolean {
    if (data === '') {
      return true;
    }
    if (this.#composing) {
      this.#composing = false;
      (this.#focused ?? this.#host.root).dispatchEvent(
        new HostCompositionEvent('compositionend', data),
      );
    }
    return (this.#focused ?? this.#host.root).dispatchEvent(new HostTextEvent('textinput', data));
  }

  /**
   * The input method's composition is now `data`, its caret at `cursor`.
   * Empty text ends composing without committing anything.
   */
  composition(data: string, cursor = -1): void {
    const target = this.#focused ?? this.#host.root;
    if (data === '') {
      if (this.#composing) {
        this.#composing = false;
        target.dispatchEvent(new HostCompositionEvent('compositionend', ''));
      }
      return;
    }
    if (!this.#composing) {
      this.#composing = true;
      target.dispatchEvent(new HostCompositionEvent('compositionstart', ''));
    }
    target.dispatchEvent(new HostCompositionEvent('compositionupdate', data, cursor));
  }

  /** @internal An element left the tree for good; drop any state that names it. */
  forget(element: HostElement): void {
    if (this.#focused === element) {
      this.#focused = null;
      this.#updateWithin();
    }
    if (this.#capture === element) {
      this.#capture = null;
    }
    this.#chain = this.#chain.filter((e) => e !== element);
    this.#pressChain = this.#pressChain.filter((e) => e !== element);
    this.#within = this.#within.filter((e) => e !== element);
    const scope = this.#scopes.indexOf(element);
    if (scope >= 0) {
      this.#scopes.splice(scope, 1);
    }
    this.#states.delete(element);
  }
}

function disabledIn(chain: readonly HostElement[]): boolean {
  return chain.some((element) => element.hasAttribute('disabled'));
}
