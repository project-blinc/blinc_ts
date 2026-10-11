import { existsSync, readFileSync } from 'node:fs';

/** The text of the example `name`, from its file beside the pages: what a reader is shown. */
export function sourceOf(name: string): string {
  const base = `../../wiki/examples/${name}`;
  const file = new URL(`${base}.tsx`, import.meta.url);
  const found = existsSync(file) ? file : new URL(`${base}.ts`, import.meta.url);
  return readFileSync(found, 'utf8').replace(/\n+$/, '');
}

/**
 * Lines `from` to `to` (counted from 1) of a file of the adapters, by its path from `adapters/`:
 * what a page quotes of an adapter, which is the real file and cannot drift from it.
 */
export function sourceOfFile(path: string, from = 1, to = Infinity): string {
  const file = new URL(`../../${path}`, import.meta.url);
  return readFileSync(file, 'utf8')
    .split('\n')
    .slice(from - 1, to)
    .join('\n')
    .replace(/\n+$/, '');
}
