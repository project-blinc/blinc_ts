/**
 * What a text `input` (text, password, search, email, tel, url or number) and a `textarea` do:
 * they are edited in place. The text, the selection behind it, the caret and the placeholder are
 * parts the host owns, which the user-agent sheet styles. Typing, the arrows and the other
 * editing keys, the clipboard, an input method, and the pointer (a press, a drag, a double and a
 * triple click) edit through `TextEditing`; this shows what it holds.
 */
import { HostEvent, type HostPointerEvent } from './events.js';
import type { HostClipboardEvent } from './clipboard.js';
import type { Host, HostElement, HostNode } from './host.js';
import { HostElement as ElementClass, HostText } from './host.js';
import type { HostCompositionEvent, HostKeyboardEvent, HostTextEvent } from './input.js';
import type { TextStyle } from './scene.js';
import { TextEditing, type Measured } from './text-editing.js';

/** The `input` types that are not edited as text. */
const NOT_TEXT: ReadonlySet<string> = new Set([
  'checkbox',
  'radio',
  'range',
  'button',
  'submit',
  'reset',
  'file',
  'color',
  'date',
  'datetime-local',
  'time',
  'month',
  'week',
  'hidden',
  'image',
]);

/** Space kept between the clipped text and the field's inner edge, so a glyph or the caret at the end is not cut. */
const INSET = 2;
/** Milliseconds the caret shows, then hides, while the field has focus. */
const BLINK_MS = 530;
/** A press this soon after another, this near, is the next click of a double or triple click. */
const CLICK_MS = 500;
const CLICK_PX = 4;

const STEP_UP = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.5 5 4l2.5 2.5"/></svg>',
)}`;
const STEP_DOWN = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5 5 6l2.5-2.5"/></svg>',
)}`;

interface Parts {
  readonly clip: HostElement;
  readonly strip: HostElement;
  readonly line: HostElement;
  readonly text: HostElement;
  readonly shown: HostText;
  readonly composition: HostElement;
  readonly placeholder: HostElement;
  readonly placeholderText: HostText;
  readonly caret: HostElement;
  readonly selections: HostElement[];
  readonly steppers: HostElement[];
}

interface Field {
  readonly element: HostElement;
  readonly area: boolean;
  readonly editing: TextEditing;
  parts: Parts | null;
  type: string;
  /** Whether the user or a script has set the value, after which the attribute no longer does. */
  dirty: boolean;
  /** The value when it last took focus or was announced as changed, for `change`. */
  committed: string;
  /** How far the text is scrolled along a line, for a single line field. */
  scroll: number;
  style: TextStyle;
  styleKey: string;
  /** Whether what it shows may be wrong now, and whether the caret is to be brought into view. */
  stale: boolean;
  reveal: boolean;
  caretOn: boolean;
  blink: ReturnType<typeof setTimeout> | null;
  /** The last press, for counting clicks. */
  press: { at: number; x: number; y: number; count: number } | null;
}

export class TextFields {
  readonly host: Host;
  readonly #fields = new WeakMap<HostElement, Field>();
  readonly #live = new Set<Field>();
  #release: (() => void) | null = null;
  /** When Tab last went down, so a focus that follows is one by keyboard. */
  #tabbedAt = -Infinity;

  constructor(host: Host) {
    this.host = host;
  }

  /** Once the host has its root. */
  attach(): void {
    const root = this.host.root;
    root.addEventListener('keydown', (event) => this.#keyDown(event as HostKeyboardEvent));
    root.addEventListener('keyup', (event) => this.#keyUp(event as HostKeyboardEvent));
    root.addEventListener('textinput', (event) => this.#textInput(event as HostTextEvent));
    root.addEventListener('compositionupdate', (event) =>
      this.#compose(event as HostCompositionEvent),
    );
    root.addEventListener('compositionend', (event) =>
      this.#compose(event as HostCompositionEvent),
    );
    for (const type of ['copy', 'cut', 'paste']) {
      root.addEventListener(type, (event) => this.#clipboard(event as HostClipboardEvent));
    }
    root.addEventListener('pointerdown', (event) => this.#pointerDown(event as HostPointerEvent));
    root.addEventListener('pointermove', (event) => this.#pointerMove(event as HostPointerEvent));
    root.addEventListener('pointerup', (event) => this.#pointerUp(event as HostPointerEvent));
    root.addEventListener('focusin', (event) => this.#focused(event.target, true));
    root.addEventListener('focusout', (event) => this.#focused(event.target, false));
    // After layout, which says how wide each field is: bring a caret into view and wrap to it.
    this.#release = this.host.layout.onLaidOut(() => this.#laidOut());
  }

  created(element: HostElement): void {
    if (element.tag !== 'textarea' && element.tag !== 'input') {
      return;
    }
    const area = element.tag === 'textarea';
    const editing: TextEditing = new TextEditing({
      multiline: area,
      measure: (shown) => this.#measure(field, shown),
      clipboard: () => this.host.clipboard,
      disabled: () => this.host.input.isDisabled(element),
      readOnly: () => element.hasAttribute('readonly'),
    });
    const field: Field = {
      element,
      area,
      editing,
      parts: null,
      type: 'text',
      dirty: false,
      committed: '',
      scroll: 0,
      style: {},
      styleKey: '',
      stale: true,
      reveal: false,
      caretOn: true,
      blink: null,
      press: null,
    };
    editing.onChange = () => this.#touch(field);
    editing.onInput = () => {
      // The user has set it, so its attribute no longer does.
      field.dirty = true;
      element.dispatchEvent(new HostEvent('input', { bubbles: true }));
    };
    editing.onSubmit = () => this.#submit(field);
    editing.onEscape = () => this.#escape(field);
    editing.pageLines = () => {
      const visible = field.parts?.clip.bounds()[3] ?? 0;
      const line = editing.measured().lineHeight;
      return line > 0 ? Math.max(1, Math.floor(visible / line) - 1) : 10;
    };
    this.#fields.set(element, field);
    this.#live.add(field);
    if (area || this.#isText(element)) {
      this.#build(field);
    }
    this.#configure(field);
  }

  /** The part a field made for itself, by class: `clip`, `strip`, `line`, `text`, `placeholder`, `caret` or `composition`. */
  part(element: HostElement, name: string): HostElement | undefined {
    const parts = this.#fields.get(element)?.parts;
    return parts ? (parts as unknown as Record<string, HostElement | undefined>)[name] : undefined;
  }

  /** The selection's rectangles, one for each line it covers. */
  selections(element: HostElement): readonly HostElement[] {
    return this.#fields.get(element)?.parts?.selections ?? [];
  }

  /** The text a field shows, which is its value masked for a password and with any composition in it. */
  shown(element: HostElement): string {
    return this.#fields.get(element)?.parts?.shown.data ?? '';
  }

  /** Whether `element` is edited as text. */
  has(element: HostElement): boolean {
    return (this.#fields.get(element)?.parts ?? null) !== null;
  }

  #isText(element: HostElement): boolean {
    return !NOT_TEXT.has(element.getAttribute('type')?.trim().toLowerCase() ?? '');
  }

  // --- parts ------------------------------------------------------------------------------

  #build(field: Field): void {
    const host = this.host;
    const el = field.element;
    const own = (parent: HostElement, tag: string, name: string, before: HostNode | null = null) =>
      host.ownedElement(parent, tag, [name], before);
    const clip = own(el, 'div', 'clip');
    const strip = own(clip, 'div', 'strip');
    const line = own(strip, 'div', 'line');
    const text = own(line, 'span', 'text');
    const shown = host.createTextNode('');
    text.appendChild(shown);
    const composition = own(line, 'div', 'composition');
    const placeholder = own(line, 'span', 'placeholder');
    const placeholderText = host.createTextNode('');
    placeholder.appendChild(placeholderText);
    const caret = own(line, 'div', 'caret');
    field.parts = {
      clip,
      strip,
      line,
      text,
      shown,
      composition,
      placeholder,
      placeholderText,
      caret,
      selections: [],
      steppers: [],
    };
    text.setProperty('white-space', field.area ? 'pre-wrap' : 'pre');
    this.#touch(field);
  }

  #unbuild(field: Field): void {
    this.#stopBlink(field);
    const parts = field.parts;
    if (parts) {
      this.host.destroyNode(parts.clip);
      for (const stepper of parts.steppers) {
        this.host.destroyNode(stepper);
      }
      field.parts = null;
    }
    for (const state of ['placeholder-shown', 'required', 'optional']) {
      field.element.setState(state, false);
    }
  }

  /** What a field is now, from its attributes: its type, mask, filter and steppers. */
  #configure(field: Field): void {
    const el = field.element;
    if (!field.area) {
      const text = this.#isText(el);
      if (text && !field.parts) {
        this.#build(field);
      } else if (!text && field.parts) {
        this.#unbuild(field);
        return;
      }
    }
    const e = field.editing;
    field.type = field.area
      ? 'textarea'
      : (el.getAttribute('type')?.trim().toLowerCase() ?? 'text');
    e.mask = field.type === 'password' ? '•' : null;
    e.accept = field.type === 'number' ? (text) => text.replace(/[^0-9eE+\-.]/g, '') : null;
    const max = Number.parseInt(el.getAttribute('maxlength') ?? '', 10);
    e.maxLength = max >= 0 ? max : null;
    const parts = field.parts;
    if (parts) {
      parts.placeholderText.data = el.getAttribute('placeholder') ?? '';
      // A number has steppers after its text; no other field does.
      const wanted = field.type === 'number';
      if (wanted && parts.steppers.length === 0) {
        this.#addSteppers(field, parts);
      } else if (!wanted && parts.steppers.length > 0) {
        for (const s of parts.steppers) {
          this.host.destroyNode(s);
        }
        parts.steppers.length = 0;
      }
    }
    if (!field.dirty) {
      e.setValue(this.#default(field));
    }
    this.#touch(field);
  }

  #addSteppers(field: Field, parts: Parts): void {
    const host = this.host;
    const group = host.ownedElement(field.element, 'div', ['steppers']);
    const make = (name: string, direction: 1 | -1, src: string): void => {
      const button = host.ownedElement(group, 'div', [name]);
      host.ownedElement(button, 'img', ['arrow']).setAttribute('src', src);
      button.addEventListener('click', () => {
        if (!host.input.isDisabled(field.element) && !field.element.hasAttribute('readonly')) {
          this.#stepBy(field, direction);
        }
      });
    };
    make('step-up', 1, STEP_UP);
    make('step-down', -1, STEP_DOWN);
    parts.steppers.push(group);
  }

  /** The value an unchanged field starts with: its `value` attribute, or a textarea's text. */
  #default(field: Field): string {
    const el = field.element;
    if (!field.area) {
      return el.getAttribute('value') ?? '';
    }
    let text = '';
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n instanceof HostText) {
        text += n.data;
      }
    }
    return text.replace(/^\r?\n/, '');
  }

  // --- the host's hooks -------------------------------------------------------------------

  attributeChanged(element: HostElement, name: string): void {
    const field = this.#fields.get(element);
    if (!field) {
      return;
    }
    switch (name) {
      case 'type':
      case 'value':
      case 'placeholder':
      case 'maxlength':
      case 'required':
        this.#configure(field);
        break;
      case 'readonly':
      case 'disabled':
        this.#touch(field);
        break;
    }
  }

  /** A textarea's text children are its default value, and are not drawn. */
  childrenChanged(parent: HostNode | null): void {
    if (!(parent instanceof ElementClass) || parent.tag !== 'textarea') {
      return;
    }
    const field = this.#fields.get(parent);
    if (!field) {
      return;
    }
    for (let n = parent.firstChild; n; n = n.nextSibling) {
      if (n instanceof HostText) {
        n.layoutNode.setLayoutProperty('display', 'none');
      }
    }
    if (!field.dirty) {
      field.editing.setValue(this.#default(field));
    }
  }

  forget(node: HostNode): void {
    if (node instanceof ElementClass) {
      const field = this.#fields.get(node);
      if (field) {
        this.#stopBlink(field);
        this.#live.delete(field);
        this.#fields.delete(node);
      }
    }
  }

  /** The host is going: nothing may fire after it. */
  dispose(): void {
    for (const field of this.#live) {
      this.#stopBlink(field);
    }
    this.#live.clear();
    this.#release?.();
    this.#release = null;
  }

  // --- properties -------------------------------------------------------------------------

  value(element: HostElement): string | undefined {
    const field = this.#fields.get(element);
    return field?.parts ? field.editing.value : undefined;
  }

  /** Set the value as a script does: the caret goes to its end, and nothing is announced. */
  setValue(element: HostElement, value: string): void {
    const field = this.#fields.get(element);
    if (field?.parts) {
      field.dirty = true;
      field.editing.setValue(this.#clean(field, value));
      field.reveal = true;
    }
  }

  #clean(field: Field, value: string): string {
    let text = field.area ? value.replace(/\r\n|\r/g, '\n') : value.replace(/\r\n|\r|\n/g, ' ');
    const max = field.editing.maxLength;
    if (max !== null) {
      text = text.slice(0, max);
    }
    return text;
  }

  selectionStart(element: HostElement): number {
    const field = this.#fields.get(element);
    return field ? field.editing.selectionRange().from : 0;
  }

  selectionEnd(element: HostElement): number {
    const field = this.#fields.get(element);
    return field ? field.editing.selectionRange().to : 0;
  }

  select(element: HostElement, from?: number, to?: number): void {
    const field = this.#fields.get(element);
    if (field?.parts) {
      field.editing.select(from ?? 0, to ?? field.editing.value.length);
      field.reveal = true;
    }
  }

  /** A number field's value as a number, NaN when it is empty or not one. */
  valueAsNumber(element: HostElement): number {
    const field = this.#fields.get(element);
    if (field?.type !== 'number') {
      return Number.NaN;
    }
    const text = field.editing.value.trim();
    return text === '' ? Number.NaN : Number(text);
  }

  /** Put it back as it began: its attribute's value, or a textarea's text. */
  reset(element: HostElement): void {
    const field = this.#fields.get(element);
    if (field?.parts) {
      field.dirty = false;
      field.editing.setValue(this.#default(field));
      field.committed = field.editing.value;
    }
  }

  // --- number -----------------------------------------------------------------------------

  /** Move a number field's value a step up or down, within its bounds, and announce it. */
  #stepBy(field: Field, direction: 1 | -1): void {
    const el = field.element;
    const number = (name: string): number | undefined => {
      const v = Number.parseFloat(el.getAttribute(name) ?? '');
      return Number.isFinite(v) ? v : undefined;
    };
    const rawStep = number('step');
    const step = rawStep !== undefined && rawStep > 0 ? rawStep : 1;
    const min = number('min');
    const max = number('max');
    const current = this.valueAsNumber(el);
    // An empty field starts from zero, or from the minimum when that is above it.
    const base = Number.isFinite(current) ? current : Math.max(min ?? 0, Math.min(max ?? 0, 0));
    const from = min ?? 0;
    // Land on the step counted from the minimum, whichever way it moves.
    const steps = (base - from) / step;
    const aligned = Math.abs(steps - Math.round(steps)) < 1e-9;
    const target = aligned
      ? base + direction * step
      : from + (direction > 0 ? Math.ceil(steps) : Math.floor(steps)) * step;
    let next = target;
    if (max !== undefined) {
      next = Math.min(next, max);
    }
    if (min !== undefined) {
      next = Math.max(next, min);
    }
    const decimals = Math.max(
      0,
      ...[step, from].map((n) => (String(n).split('.')[1] ?? '').length),
    );
    const text = String(Number(next.toFixed(decimals)));
    if (text !== field.editing.value) {
      field.dirty = true;
      field.editing.setValue(text);
      field.reveal = true;
      el.dispatchEvent(new HostEvent('input', { bubbles: true }));
      this.#commit(field);
    }
  }

  // --- measuring --------------------------------------------------------------------------

  #measure(field: Field, shown: string): Measured {
    const native = this.host.native;
    if (!native) {
      return { stops: [{ index: 0, x: 0, line: 0 }], lineHeight: 16, lines: 1 };
    }
    const wrap = field.area && field.editing.wrapWidth > 0 ? field.editing.wrapWidth : undefined;
    const measured = native.measureText(shown, field.style, wrap);
    return { stops: measured.carets, lineHeight: measured.lineHeight, lines: measured.lineCount };
  }

  // --- showing it -------------------------------------------------------------------------

  #touch(field: Field): void {
    field.stale = true;
    this.host.wake();
  }

  /** Before the tick's writes: show what each field holds. */
  flush(): void {
    for (const field of this.#live) {
      if (field.stale && field.parts && !field.element.destroyed) {
        field.stale = false;
        this.#render(field, field.parts);
      }
    }
  }

  #render(field: Field, parts: Parts): void {
    const e = field.editing;
    // The text is measured as it is drawn: in the style it has now.
    field.style = this.host.textStyleOf(parts.shown);
    const style = field.style;
    const key = `${style.fontSize}|${style.fontWeight}|${style.italic}|${style.fontFamily}|${style.letterSpacing}|${style.lineHeight}`;
    if (key !== field.styleKey) {
      field.styleKey = key;
      e.remeasure();
    }
    const shown = e.display();
    if (parts.shown.data !== shown) {
      parts.shown.data = shown;
    }
    const placeholding = shown === '' && (field.element.getAttribute('placeholder') ?? '') !== '';
    parts.placeholder.setProperty('display', placeholding ? 'flex' : 'none');
    field.element.setState('placeholder-shown', placeholding);
    const { lineHeight } = e.measured();
    // An empty line still has the height of one, for the caret and the placeholder to stand in.
    parts.line.setProperty('min-height', lineHeight);
    const caret = e.stopAt(e.displayCaret());
    parts.caret.setProperty('left', caret.x);
    if (field.area) {
      parts.caret.setProperty('top', caret.line * lineHeight);
      parts.caret.setProperty('height', lineHeight);
    }
    // The selection hides while an input method composes in its place.
    const rects: { left: number; width: number; top: number }[] = [];
    const range = e.selectionRange();
    if (e.composing === '' && range.from !== range.to) {
      const from = e.stopAt(range.from);
      const to = e.stopAt(range.to);
      for (let line = from.line; line <= to.line; line++) {
        const left = line === from.line ? from.x : 0;
        const right = line === to.line ? to.x : this.#lineWidth(e, line);
        rects.push({
          left,
          width: Math.max(right - left, line === to.line ? 0 : 4),
          top: line * lineHeight,
        });
      }
    }
    while (parts.selections.length < rects.length) {
      const rect = this.host.ownedElement(parts.line, 'div', ['selection'], parts.text);
      parts.selections.push(rect);
    }
    while (parts.selections.length > rects.length) {
      const extra = parts.selections.pop();
      if (extra) {
        this.host.destroyNode(extra);
      }
    }
    rects.forEach((r, i) => {
      const rect = parts.selections[i]!;
      rect.setProperty('left', r.left);
      rect.setProperty('width', r.width);
      if (field.area) {
        rect.setProperty('top', r.top);
        rect.setProperty('height', lineHeight);
      }
    });
    // A composition is underlined, as input methods mark it.
    const composed = e.composedRange();
    parts.composition.setProperty('display', composed ? 'flex' : 'none');
    if (composed) {
      const a = e.stopAt(composed.from);
      const b = e.stopAt(composed.to);
      parts.composition.setProperty('left', a.x);
      parts.composition.setProperty('width', Math.max(b.x - a.x, 0));
      if (field.area) {
        parts.composition.setProperty('top', a.line * lineHeight + lineHeight - 1);
      }
    }
    field.reveal = field.reveal || this.host.input.focused === field.element;
    this.#restartBlink(field);
  }

  #lineWidth(e: TextEditing, line: number): number {
    let width = 0;
    for (const stop of e.measured().stops) {
      if (stop.line === line) {
        width = Math.max(width, stop.x);
      }
    }
    return width;
  }

  /**
   * After layout: wrap a text area to the width it has, and bring a caret into view. Everything is
   * read before anything is written, since a write makes the bounds unreadable until layout runs.
   */
  #laidOut(): boolean {
    const reads: { field: Field; width: number; height: number; top: number }[] = [];
    for (const field of this.#live) {
      const parts = field.parts;
      if (!parts || field.element.destroyed || (!field.reveal && !field.area)) {
        continue;
      }
      const [, , width = 0, height = 0] = parts.clip.bounds();
      reads.push({ field, width, height, top: field.area ? parts.clip.scrollTop : 0 });
    }
    let moved = false;
    for (const { field, width, height, top } of reads) {
      const parts = field.parts!;
      const e = field.editing;
      if (field.area && Math.abs(e.wrapWidth - width) > 0.5 && width > 0) {
        e.wrapWidth = width;
        e.remeasure();
        this.#touch(field);
        moved = true;
        continue;
      }
      if (!field.reveal) {
        continue;
      }
      field.reveal = false;
      const caret = e.stopAt(e.displayCaret());
      if (field.area) {
        const lineHeight = e.measured().lineHeight;
        const caretTop = caret.line * lineHeight;
        let next = top;
        if (caretTop < top) {
          next = caretTop;
        } else if (caretTop + lineHeight > top + height) {
          next = caretTop + lineHeight - height;
        }
        if (Math.abs(next - top) > 0.5) {
          parts.clip.scrollTo(0, Math.max(0, next));
          moved = true;
        }
        continue;
      }
      const visible = width - 2 * INSET;
      if (visible <= 0) {
        continue;
      }
      let s = field.scroll;
      if (caret.x - s > visible) {
        s = caret.x - visible;
      } else if (caret.x < s) {
        s = caret.x;
      }
      // Never past the start, nor further than the text overflows.
      const end = e.stopAt(e.display().length).x;
      s = Math.max(0, Math.min(s, Math.max(0, end - visible)));
      if (s !== field.scroll) {
        field.scroll = s;
        parts.strip.setProperty('left', INSET - s);
        moved = true;
      }
    }
    return moved;
  }

  // --- the caret --------------------------------------------------------------------------

  #restartBlink(field: Field): void {
    this.#stopBlink(field);
    const parts = field.parts;
    if (!parts || this.host.input.focused !== field.element) {
      parts?.caret.setProperty('opacity', 0);
      return;
    }
    // Typing or moving shows the caret at once.
    field.caretOn = true;
    parts.caret.setProperty('opacity', 1);
    const tick = (): void => {
      if (field.element.destroyed || this.host.layout.disposed) {
        return;
      }
      field.caretOn = !field.caretOn;
      field.parts?.caret.setProperty('opacity', field.caretOn ? 1 : 0);
      this.host.wake();
      field.blink = setTimeout(tick, BLINK_MS);
      field.blink.unref();
    };
    field.blink = setTimeout(tick, BLINK_MS);
    field.blink.unref();
  }

  #stopBlink(field: Field): void {
    if (field.blink) {
      clearTimeout(field.blink);
      field.blink = null;
    }
  }

  // --- events -----------------------------------------------------------------------------

  /** The text field `node` is, or is a part of. */
  #fieldAt(node: HostNode | null): Field | null {
    for (let n = node; n; n = n.composedParent) {
      const field = n instanceof ElementClass ? this.#fields.get(n) : undefined;
      if (field?.parts) {
        return field;
      }
    }
    return null;
  }

  #focusedField(event: { target: unknown }): Field | null {
    const target = event.target instanceof ElementClass ? event.target : null;
    const field = target && this.#fields.get(target);
    return field?.parts ? field : null;
  }

  #keyDown(event: HostKeyboardEvent): void {
    if (event.key === 'Tab') {
      this.#tabbedAt = performance.now();
    }
    const field = this.#focusedField(event);
    if (!field || event.defaultPrevented) {
      return;
    }
    if (field.type === 'number' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      if (!this.host.input.isDisabled(field.element) && !field.element.hasAttribute('readonly')) {
        this.#stepBy(field, event.key === 'ArrowUp' ? 1 : -1);
      }
      event.preventDefault();
      return;
    }
    if (field.editing.key(event)) {
      event.preventDefault();
    }
  }

  /** Space and Enter coming up must not click the field. */
  #keyUp(event: HostKeyboardEvent): void {
    if (this.#focusedField(event) && (event.key === ' ' || event.key === 'Enter')) {
      event.preventDefault();
    }
  }

  #textInput(event: HostTextEvent): void {
    const field = this.#focusedField(event);
    if (field) {
      event.preventDefault();
      field.editing.type(event.data);
      field.reveal = true;
    }
  }

  #compose(event: HostCompositionEvent): void {
    const field = this.#focusedField(event);
    if (!field) {
      return;
    }
    // The commit comes as text next; the composition is over when it ends.
    field.editing.compose(event.type === 'compositionend' ? '' : event.data, event.cursor);
    field.reveal = true;
  }

  #clipboard(event: HostClipboardEvent): void {
    const field = this.#focusedField(event);
    if (!field) {
      return;
    }
    if (event.type === 'paste') {
      field.editing.paste(event.clipboard.text());
      field.reveal = true;
      event.preventDefault();
    } else if (event.type === 'copy' ? field.editing.copy() : field.editing.cut()) {
      field.reveal = true;
      event.preventDefault();
    }
  }

  /** The point `event` is at, from the text's top left. */
  #local(field: Field, event: HostPointerEvent): [number, number] {
    const parts = field.parts!;
    // Where it shows, which has a text area's scroll in it: how far its text has moved up.
    const [x = 0, y = 0] = parts.line.viewBounds();
    return [event.x - x, event.y - y];
  }

  #pointerDown(event: HostPointerEvent): void {
    const field = this.#fieldAt(event.target as HostNode | null);
    if (!field || event.button !== 0 || this.host.input.isDisabled(field.element)) {
      return;
    }
    // A press near the last one is the next click of a double or a triple.
    const now = performance.now();
    const last = field.press;
    const count =
      last && now - last.at < CLICK_MS && Math.hypot(event.x - last.x, event.y - last.y) < CLICK_PX
        ? last.count + 1
        : 1;
    field.press = { at: now, x: event.x, y: event.y, count };
    const [x, y] = this.#local(field, event);
    field.editing.press(x, field.area ? y : 0, event.shiftKey, count);
    field.reveal = true;
    field.element.setPointerCapture();
  }

  #pointerMove(event: HostPointerEvent): void {
    const captured = this.host.input.pointerCapture;
    const field = captured && this.#fields.get(captured);
    if (field?.parts) {
      const [x, y] = this.#local(field, event);
      field.editing.drag(x, field.area ? y : 0);
      field.reveal = true;
    }
  }

  #pointerUp(event: HostPointerEvent): void {
    const captured = this.host.input.pointerCapture;
    const field = captured && this.#fields.get(captured);
    if (field?.parts) {
      field.editing.release();
      field.element.releasePointerCapture();
      void event;
    }
  }

  #focused(target: unknown, on: boolean): void {
    const field = this.#focusedField({ target });
    if (!field) {
      return;
    }
    if (on) {
      field.committed = field.editing.value;
      // Tab into a field selects what is in it; a press puts the caret where it was pressed, and a
      // script's focus leaves the selection as it was.
      if (performance.now() - this.#tabbedAt < 100 && field.editing.value !== '') {
        field.editing.select(0, field.editing.value.length);
      }
      field.reveal = true;
    } else {
      field.editing.blur();
      this.#commit(field);
    }
    this.#touch(field);
  }

  /** The value is settled: announce `change` if it is not what it was. */
  #commit(field: Field): void {
    if (field.editing.value !== field.committed) {
      field.committed = field.editing.value;
      field.element.dispatchEvent(new HostEvent('change', { bubbles: true }));
    }
  }

  /** Enter in a single line field settles it, and submits the form it is in. */
  #submit(field: Field): void {
    this.#commit(field);
    const form = this.host.behaviours.forms.ownerOf(field.element);
    if (form) {
      this.host.behaviours.forms.implicitSubmit(form);
    }
  }

  /** Escape empties a search field. */
  #escape(field: Field): void {
    if (field.type === 'search' && field.editing.value !== '') {
      field.dirty = true;
      field.editing.setValue('');
      field.element.dispatchEvent(new HostEvent('input', { bubbles: true }));
    }
  }
}
