/**
 * What is copied and pasted: text, or data of any MIME type (HTML, an image
 * as `image/png`, files as `text/uri-list`). One copy can hold several
 * representations of one thing, so a paste takes the best it understands.
 * A host uses the system clipboard once it is mounted in a window, and a
 * clipboard held in the process before that, as tests and offscreen hosts do.
 */
import type { window as win } from './index.js';
import { HostEvent } from './events.js';

export const TEXT = 'text/plain';

export interface ClipboardEntry {
  readonly type: string;
  readonly data: Uint8Array;
}

export interface Clipboard {
  /** The clipboard's text; empty when it holds none. */
  text(): string;
  /** Put `text` on the clipboard, in place of everything there. */
  setText(text: string): void;
  /** The MIME types on the clipboard, the best first. */
  types(): string[];
  /** The clipboard's data as `type`, or undefined when it has none of that type. */
  data(type: string): Uint8Array | undefined;
  /** Put several representations of one thing on the clipboard. False if the system refused it. */
  write(entries: readonly ClipboardEntry[]): boolean;
}

/** A clipboard held in this process. */
export class MemoryClipboard implements Clipboard {
  #entries: ClipboardEntry[] = [];
  text(): string {
    const data = this.data(TEXT);
    return data ? new TextDecoder().decode(data) : '';
  }
  setText(text: string): void {
    this.#entries = [{ type: TEXT, data: new TextEncoder().encode(text) }];
  }
  types(): string[] {
    return this.#entries.map((entry) => entry.type);
  }
  data(type: string): Uint8Array | undefined {
    return this.#entries.find((entry) => entry.type === type)?.data;
  }
  write(entries: readonly ClipboardEntry[]): boolean {
    this.#entries = entries.map((entry) => ({ type: entry.type, data: entry.data.slice() }));
    return true;
  }
}

/** The system clipboard, through the window bindings. */
export class SystemClipboard implements Clipboard {
  readonly #window: win.Bindings;
  constructor(bindings: win.Bindings) {
    this.#window = bindings;
  }
  text(): string {
    const text = this.#window.Window.clipboardText();
    return text.kind === 'Some' ? text.text : '';
  }
  setText(text: string): void {
    this.#window.Window.setClipboardText(text);
  }
  types(): string[] {
    const count = this.#window.Window.clipboardTypeCount();
    const types: string[] = [];
    for (let i = 0; i < count; i++) {
      const type = this.#window.Window.clipboardType(i);
      if (type !== null) {
        types.push(type);
      }
    }
    return types;
  }
  data(type: string): Uint8Array | undefined {
    const data = this.#window.Window.clipboardData(type);
    return data.kind === 'Some' ? data.bytes : undefined;
  }
  write(entries: readonly ClipboardEntry[]): boolean {
    const items = this.#window.ClipboardItems.create();
    for (const entry of entries) {
      items.add(entry.type, entry.data);
    }
    return items.write();
  }
}

/**
 * `copy`, `cut` and `paste`, sent to the focused element for the platform's
 * shortcuts. A copy or cut listener puts data on the clipboard itself; a
 * paste listener reads it.
 */
export class HostClipboardEvent extends HostEvent {
  readonly clipboard: Clipboard;
  constructor(type: 'copy' | 'cut' | 'paste', clipboard: Clipboard) {
    super(type, { bubbles: true, cancelable: true });
    this.clipboard = clipboard;
  }
}
