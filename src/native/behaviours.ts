/**
 * What built-in elements do beyond what CSS says of them, as a browser's
 * own code does: a list item has its marker, kept right as items come and
 * go. What an element needs inside it (a marker) is an owned element: in the
 * native tree and the cascade, not among `childNodes`, so a framework that
 * owns an element's children never sees or removes it.
 */
import { spawn } from 'node:child_process';
import { HostEvent, HostPointerEvent } from './events.js';
import type { Host, HostElement, HostNode, HostText } from './host.js';
import { HostElement as ElementClass } from './host.js';

const LISTS: ReadonlySet<string> = new Set(['ul', 'ol', 'menu']);
const BULLETS = ['disc', 'circle', 'square'] as const;

/** The schemes a link may open with the system's handler. */
const OPENABLE: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** Form controls: what a label operates, and what a disabled fieldset disables. */
export const CONTROLS: ReadonlySet<string> = new Set(['input', 'button', 'select', 'textarea']);

/** Open `url` with the system's handler for it. */
function openWithSystem(url: string): void {
  const [command, args]: [string, string[]] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  // No handler is not an error worth stopping for.
  child.on('error', () => undefined);
  child.unref();
}

/** A list item's marker, and what it shows. */
interface Marker {
  readonly element: HostElement;
  kind: string;
  label: string;
  text: HostText | undefined;
}

export class Behaviours {
  readonly host: Host;
  /** Lists whose items' markers may be wrong now. */
  readonly #lists = new Set<HostElement>();
  readonly #markers = new WeakMap<HostElement, Marker>();
  /** The bar a progress or meter draws, which the host owns. */
  readonly #bars = new WeakMap<HostElement, HostElement>();
  /** Opens a link's URL: the system's handler, unless an embedder or a test gives another. */
  opener: (url: string) => void = openWithSystem;

  constructor(host: Host) {
    this.host = host;
  }

  /** Once the host has its root. */
  attach(): void {
    // A click that nothing handled does what the element under it means: follow a link,
    // operate a label's control, open or close a details.
    this.host.root.addEventListener('click', (event) => {
      if (event instanceof HostPointerEvent && !event.defaultPrevented && event.button === 0) {
        this.#clicked(event);
      }
    });
  }

  /** An element was made: the parts its kind has. */
  created(element: HostElement): void {
    switch (element.tag) {
      case 'summary':
        this.host.ownedElement(element, 'div', ['marker']);
        break;
      case 'progress':
      case 'meter':
        this.#bars.set(element, this.host.ownedElement(element, 'div', ['bar']));
        this.#sync(element);
        break;
    }
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

  #clicked(event: HostPointerEvent): void {
    for (let n = event.target as HostNode | null; n; n = n.parentNode) {
      if (!(n instanceof ElementClass)) {
        continue;
      }
      if (n.tag === 'a' && n.hasAttribute('href')) {
        this.#follow(n.getAttribute('href') ?? '');
        return;
      }
      if (
        n.tag === 'summary' &&
        n.parentNode instanceof ElementClass &&
        n.parentNode.tag === 'details'
      ) {
        this.#toggle(n.parentNode, n);
        return;
      }
      if (n.tag === 'label') {
        this.#operate(n, event.target as HostNode | null);
        return;
      }
    }
  }

  /** A link: to an element of the page, or out to the system's handler. */
  #follow(href: string): void {
    if (href.startsWith('#')) {
      this.#byId(decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: 'start' });
      return;
    }
    try {
      if (OPENABLE.has(new URL(href).protocol)) {
        this.opener(href);
      }
    } catch {
      // Not a URL, so nothing to open.
    }
  }

  /** A summary opens or closes the details it begins. */
  #toggle(details: HostElement, summary: HostElement): void {
    let first: HostNode | null = details.firstChild;
    while (first && !(first instanceof ElementClass && first.tag === 'summary')) {
      first = first.nextSibling;
    }
    if (first !== summary) {
      return;
    }
    if (details.hasAttribute('open')) {
      details.removeAttribute('open');
    } else {
      details.setAttribute('open', '');
    }
    details.dispatchEvent(new HostEvent('toggle'));
  }

  /** A click on a label is a click on its control: focused, and clicked unless it was the control that was. */
  #operate(label: HostElement, target: HostNode | null): void {
    const named = label.getAttribute('for');
    let control: HostElement | null = named ? this.#byId(named) : null;
    if (!control && !named) {
      const find = (parent: HostElement): HostElement | null => {
        for (let child = parent.firstChild; child; child = child.nextSibling) {
          if (child instanceof ElementClass) {
            if (CONTROLS.has(child.tag)) {
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
      control = find(label);
    }
    if (!control || !CONTROLS.has(control.tag)) {
      return;
    }
    for (let n = target; n; n = n.parentNode) {
      if (n === control) {
        return;
      }
    }
    control.focus();
    control.click();
  }

  /** A progress bar's width and a meter's colour, from its attributes. */
  #sync(element: HostElement): void {
    const bar = this.#bars.get(element);
    if (!bar || bar.destroyed) {
      return;
    }
    const number = (name: string): number | undefined => {
      const v = Number.parseFloat(element.getAttribute(name) ?? '');
      return Number.isFinite(v) ? v : undefined;
    };
    if (element.tag === 'progress') {
      const value = number('value');
      const max = number('max');
      const total = max !== undefined && max > 0 ? max : 1;
      // No value is a bar that does not know how far along it is.
      element.setState('indeterminate', value === undefined);
      bar.setProperty(
        'width',
        value === undefined
          ? null
          : `${Math.round(Math.min(Math.max(value / total, 0), 1) * 10000) / 100}%`,
      );
      return;
    }
    const min = number('min') ?? 0;
    const max = Math.max(number('max') ?? 1, min);
    const clamp = (v: number) => Math.min(Math.max(v, min), max);
    const value = clamp(number('value') ?? 0);
    const low = clamp(number('low') ?? min);
    const high = clamp(Math.max(number('high') ?? max, low));
    const optimum = clamp(number('optimum') ?? (min + max) / 2);
    const span = max - min;
    bar.setProperty('width', `${span > 0 ? Math.round(((value - min) / span) * 10000) / 100 : 0}%`);
    // Where the optimum is decides which end is good: the value's region against its.
    const region = (v: number) => (v < low ? 0 : v > high ? 2 : 1);
    const distance = Math.abs(region(value) - region(optimum));
    for (const name of ['optimum', 'suboptimum', 'even-less-good']) {
      bar.classList.remove(name);
    }
    bar.classList.add(
      distance === 0 ? 'optimum' : distance === 1 ? 'suboptimum' : 'even-less-good',
    );
  }

  /** The text of `item`'s marker, for a bullet its shape's name: `1.`, `iv.`, `disc`; none without one. */
  markerOf(item: HostElement): string | null {
    const marker = this.#markers.get(item);
    return marker ? (marker.kind === 'number' ? marker.label : marker.kind) : null;
  }

  /** A child came or went under `parent`. */
  childrenChanged(parent: HostNode | null, child?: HostNode): void {
    // A control put into a disabled fieldset is disabled by it.
    if (
      parent instanceof ElementClass &&
      child instanceof ElementClass &&
      this.host.input.isDisabled(parent)
    ) {
      this.host.input.refreshDisabled(child);
      if (CONTROLS.has(child.tag)) {
        this.host.input.refreshDisabled(parent);
      }
    }
    if (parent instanceof ElementClass && LISTS.has(parent.tag)) {
      this.#lists.add(parent);
    }
    if (child instanceof ElementClass && LISTS.has(child.tag)) {
      // Its depth, and so its bullets, depend on where it is.
      this.#lists.add(child);
    }
  }

  attributeChanged(element: HostElement, name: string): void {
    if (element.tag === 'progress' || element.tag === 'meter') {
      this.#sync(element);
    }
    if (LISTS.has(element.tag) && (name === 'start' || name === 'reversed' || name === 'type')) {
      this.#lists.add(element);
    } else if (element.tag === 'li' && (name === 'value' || name === 'type')) {
      const parent = element.parentNode;
      if (parent && LISTS.has(parent.tag)) {
        this.#lists.add(parent);
      }
    }
  }

  /** A style changed at `element`: `list-style-type` may have. */
  restyled(element: HostElement): void {
    if (LISTS.has(element.tag)) {
      this.#lists.add(element);
    } else if (element.tag === 'li' && element.parentNode && LISTS.has(element.parentNode.tag)) {
      this.#lists.add(element.parentNode);
    }
  }

  /** A node is destroyed. */
  forget(node: HostNode): void {
    if (node instanceof ElementClass) {
      this.#lists.delete(node);
      const parent = node.parentNode;
      if (node.tag === 'li' && parent && LISTS.has(parent.tag)) {
        this.#lists.add(parent);
      }
    }
  }

  /** Before the tick's writes go: put right what changed. */
  flush(): void {
    if (this.#lists.size === 0) {
      return;
    }
    const lists = [...this.#lists];
    this.#lists.clear();
    for (const list of lists) {
      if (!list.destroyed) {
        this.#number(list);
      }
    }
  }

  /** `list-style-type` as `element` has it, or its nearest ancestor that sets it. */
  #style(element: HostElement): string | undefined {
    for (let n: HostNode | null = element; n; n = n.parentNode) {
      if (n instanceof ElementClass) {
        const value = this.host.declaredOf(n).get('list-style-type')?.trim();
        if (value) {
          return value;
        }
      }
    }
    return undefined;
  }

  /** Give each item of `list` its marker: a bullet by depth, or its number. */
  #number(list: HostElement): void {
    const items: HostElement[] = [];
    for (let child = list.firstChild; child; child = child.nextSibling) {
      if (child instanceof ElementClass && child.tag === 'li') {
        items.push(child);
      }
    }
    let depth = 0;
    for (let n: HostNode | null = list.parentNode; n; n = n.parentNode) {
      if (n instanceof ElementClass && LISTS.has(n.tag)) {
        depth++;
      }
    }
    const ordered = list.tag === 'ol';
    const reversed = ordered && list.hasAttribute('reversed');
    const first = Number.parseInt(list.getAttribute('start') ?? '', 10);
    let count = Number.isFinite(first) ? first : reversed ? items.length : 1;
    const listStyle = this.#style(list);
    for (const item of items) {
      const value = Number.parseInt(item.getAttribute('value') ?? '', 10);
      if (Number.isFinite(value)) {
        count = value;
      }
      const style = this.#styleOf(item) ?? listStyle;
      const bullet = style !== undefined && (BULLETS as readonly string[]).includes(style);
      let kind: string;
      if (style === 'none') {
        kind = 'none';
      } else if (bullet) {
        kind = style;
      } else if (style || ordered) {
        kind = 'number';
      } else {
        kind = BULLETS[Math.min(depth, BULLETS.length - 1)]!;
      }
      const label = kind === 'number' ? `${counter(count, style ?? typeStyle(list))}.` : '';
      this.#mark(item, kind, label);
      count += reversed ? -1 : 1;
    }
  }

  /** The item's own `list-style-type`, without looking further up. */
  #styleOf(item: HostElement): string | undefined {
    const value = this.host.declaredOf(item).get('list-style-type')?.trim();
    return value === undefined || value === '' ? undefined : value;
  }

  /** Make `item`'s marker `kind` showing `label`, or none. */
  #mark(item: HostElement, kind: string, label: string): void {
    let marker = this.#markers.get(item);
    if (kind === 'none') {
      if (marker) {
        marker.element.destroy();
        this.#markers.delete(item);
      }
      return;
    }
    if (marker && marker.kind !== kind) {
      marker.element.destroy();
      this.#markers.delete(item);
      marker = undefined;
    }
    if (!marker) {
      const element = this.host.ownedElement(item, 'div', ['marker', kind]);
      let text: HostText | undefined;
      if (kind === 'number') {
        text = this.host.createTextNode(label);
        element.appendChild(text);
      } else {
        element.appendChild(this.host.createElement('div')).classList.add('bullet');
      }
      marker = { element, kind, label, text };
      this.#markers.set(item, marker);
      return;
    }
    if (marker.label !== label && marker.text) {
      marker.label = label;
      marker.text.data = label;
    }
  }
}

/** The `type` of an `ol` as the counter style it names. */
function typeStyle(list: HostElement): string {
  const named: Readonly<Record<string, string>> = {
    a: 'lower-alpha',
    A: 'upper-alpha',
    i: 'lower-roman',
    I: 'upper-roman',
  };
  return named[list.getAttribute('type') ?? ''] ?? 'decimal';
}

/** `n` in a counter style: decimal, with a leading zero, in letters or in roman numerals. */
export function counter(n: number, style: string): string {
  const letters = (value: number, base: number) => {
    if (value < 1) {
      return String(value);
    }
    let out = '';
    for (let v = value; v > 0; v = Math.floor((v - 1) / 26)) {
      out = String.fromCharCode(base + ((v - 1) % 26)) + out;
    }
    return out;
  };
  const roman = (value: number) => {
    if (value < 1 || value > 3999) {
      return String(value);
    }
    const table: [number, string][] = [
      [1000, 'm'],
      [900, 'cm'],
      [500, 'd'],
      [400, 'cd'],
      [100, 'c'],
      [90, 'xc'],
      [50, 'l'],
      [40, 'xl'],
      [10, 'x'],
      [9, 'ix'],
      [5, 'v'],
      [4, 'iv'],
      [1, 'i'],
    ];
    let out = '';
    let rest = value;
    for (const [amount, text] of table) {
      while (rest >= amount) {
        out += text;
        rest -= amount;
      }
    }
    return out;
  };
  switch (style) {
    case 'lower-alpha':
    case 'lower-latin':
      return letters(n, 97);
    case 'upper-alpha':
    case 'upper-latin':
      return letters(n, 65);
    case 'lower-roman':
      return roman(n);
    case 'upper-roman':
      return roman(n).toUpperCase();
    case 'decimal-leading-zero':
      return n >= 0 && n < 10 ? `0${n}` : String(n);
    default:
      return String(n);
  }
}
