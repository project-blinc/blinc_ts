/** Fonts owned by a host's active stylesheets, with one load per source. */
import { dirname, isAbsolute, resolve } from 'node:path';
import type { NativeBindings } from './index.js';
import type { FontResource } from './font.js';
import type { FontFaceRule, Layout } from './layout.js';
import type { TextStyle } from './scene.js';
import { defaultImageLoader, type ImageLoader } from './image-source.js';

export interface FontEntry {
  readonly rule: FontFaceRule;
  status: 'loading' | 'loaded' | 'error';
  source?: string;
  error?: string;
}
interface Face {
  entry: FontEntry;
  resource?: FontResource;
  release?: () => void;
}
interface Source {
  users: number;
  resource?: FontResource;
  promise: Promise<FontResource>;
}

export class HostFonts {
  /** Relative URLs without a stylesheet file are from here, as for images. */
  base = process.cwd();
  /** The same file/data/HTTP URL loader images use; replace to load from elsewhere. */
  loader: ImageLoader = (source) => defaultImageLoader(this.base)(source);
  readonly #native: NativeBindings;
  readonly #changed: () => void;
  readonly #report: (error: string) => void;
  readonly #release: () => void;
  readonly #faces = new Map<string, Face>();
  readonly #sources = new Map<string, Source>();
  readonly #resolved = new Map<string, string>();
  #order: Face[] = [];
  #disposed = false;
  #loading = 0;
  #idle: (() => void)[] = [];

  constructor(
    native: NativeBindings,
    layout: Layout,
    changed: () => void,
    report: (error: string) => void,
  ) {
    this.#native = native;
    this.#changed = changed;
    this.#report = report;
    this.#release = layout.onFonts((rules) => this.#sync(rules));
  }
  get entries(): readonly FontEntry[] {
    return this.#order.map((face) => face.entry);
  }
  #sync(rules: readonly FontFaceRule[]): void {
    const keys = new Set(rules.map((rule) => rule.key));
    let changed = false;
    for (const [key, face] of this.#faces) {
      if (!keys.has(key)) {
        this.#faces.delete(key);
        face.release?.();
        changed ||= face.entry.status === 'loaded';
      }
    }
    const order = rules.map((rule) => {
      let face = this.#faces.get(rule.key);
      if (!face) {
        face = { entry: { rule, status: 'loading' } };
        this.#faces.set(rule.key, face);
        this.#loading++;
        void this.#load(face);
      }
      return face;
    });
    changed ||= order.some((face, i) => face !== this.#order[i] && face.entry.status === 'loaded');
    this.#order = order;
    if (changed) {
      this.#notify();
    }
  }
  #notify(): void {
    this.#resolved.clear();
    this.#changed();
  }

  #url(source: string, file: string | null | undefined): string {
    if (/^[a-z][a-z\d+.-]*:/i.test(source) || isAbsolute(source)) {
      return source;
    }
    if (!file) {
      return resolve(this.base, source);
    }
    if (/^(?:https?|file):/i.test(file)) {
      return new URL(source, file).href;
    }
    return resolve(this.base, dirname(file), source);
  }
  #use(
    key: string,
    load: () => Promise<FontResource>,
  ): { promise: Promise<FontResource>; release: () => void } {
    let source = this.#sources.get(key);
    if (!source) {
      const slot: Source = { users: 0, promise: Promise.resolve().then(load) };
      source = slot;
      this.#sources.set(key, slot);
      slot.promise = slot.promise.then((resource) => {
        slot.resource = resource;
        if (slot.users === 0) {
          resource.dispose();
        }
        return resource;
      });
    }
    source.users++;
    const slot = source;
    let released = false;
    return {
      promise: slot.promise,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        if (--slot.users === 0) {
          if (this.#sources.get(key) === slot) {
            this.#sources.delete(key);
          }
          slot.resource?.dispose();
        }
      },
    };
  }
  #live(face: Face): boolean {
    return !this.#disposed && this.#faces.get(face.entry.rule.key) === face;
  }
  async #load(face: Face): Promise<void> {
    const { entry } = face;
    const { rule } = entry;
    const errors: string[] = [];
    try {
      for (const source of rule.sources) {
        if (!this.#live(face)) {
          return;
        }
        if (source.format && !['truetype', 'opentype', 'woff2'].includes(source.format)) {
          errors.push(`${source.name}: unsupported format ${source.format}`);
          continue;
        }
        let url = source.name;
        try {
          url = source.local ? source.name : this.#url(source.name, rule.file);
          const weight = rule.weight[0]!;
          const key = source.local ? `local:${url}:${weight}:${rule.italic}` : url;
          const use = this.#use(
            key,
            source.local
              ? () => Promise.resolve(this.#native.loadLocalFont(url, weight, rule.italic))
              : async () => this.#native.loadFont((await this.loader(url)).bytes),
          );
          face.release = use.release;
          const resource = await use.promise;
          if (!this.#live(face)) {
            return;
          }
          face.resource = resource;
          entry.source = url;
          entry.status = 'loaded';
          this.#notify();
          return;
        } catch (error) {
          face.release?.();
          delete face.release;
          errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (this.#live(face)) {
        entry.status = 'error';
        entry.error = errors.join('; ');
        this.#report(
          `@font-face ${rule.family} (${rule.file ?? '<stylesheet>'}:${rule.line}:${rule.column}): ${entry.error}`,
        );
      }
    } finally {
      if (--this.#loading === 0) {
        for (const resolve of this.#idle.splice(0)) {
          resolve();
        }
      }
    }
  }

  /** A private family for the matching loaded face; pending families keep their fallback. */
  resolve(style: TextStyle): TextStyle {
    if (this.#order.length === 0 || !style.fontFamily) {
      return style;
    }
    const weight = style.fontWeight ?? 400;
    const key = JSON.stringify([style.fontFamily, weight, style.italic ?? false]);
    const cached = this.#resolved.get(key);
    if (cached !== undefined) {
      return { ...style, fontFamily: cached };
    }
    const names = this.#native.fontFamilies(style.fontFamily);
    for (let i = 0; i < names.length; i++) {
      const name = names[i]!;
      const faces = this.#order.filter(
        (face) => face.entry.rule.family.toLowerCase() === name.toLowerCase() && face.resource,
      );
      if (faces.length === 0) {
        continue;
      }
      const matched = this.#native.matchFontFace(
        faces.flatMap((face) => [...face.entry.rule.weight]),
        faces.map((face) => face.entry.rule.italic),
        weight,
        style.italic ?? false,
      );
      if (matched === null) {
        continue;
      }
      const face = faces[matched]!;
      const selected = Math.max(
        face.entry.rule.weight[0]!,
        Math.min(face.entry.rule.weight[1]!, weight),
      );
      names[i] = face.resource!.family(selected);
      // Keep installed families before the custom family in the stack, and quoted names intact.
      const family = names.map((family) => JSON.stringify(family)).join(', ');
      if (this.#resolved.size >= 256) {
        this.#resolved.clear();
      }
      this.#resolved.set(key, family);
      return { ...style, fontFamily: family };
    }
    if (this.#resolved.size >= 256) {
      this.#resolved.clear();
    }
    this.#resolved.set(key, style.fontFamily);
    return style;
  }
  /** All requested faces have loaded or failed. Compute again afterward to obtain their metrics. */
  idle(): Promise<void> {
    return this.#loading === 0
      ? Promise.resolve()
      : new Promise((resolve) => this.#idle.push(resolve));
  }
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#release();
    for (const face of this.#faces.values()) {
      face.release?.();
    }
    this.#faces.clear();
    this.#order = [];
    this.#resolved.clear();
  }
}
