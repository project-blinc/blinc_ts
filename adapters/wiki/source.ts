import { existsSync, readFileSync } from 'node:fs';
import { adaptersDir, wikiDir } from './home.js';

/** The text of the example `name`, from its file beside the pages: what a reader is shown. */
export function sourceOf(name: string): string {
  const file = new URL(`examples/${name}.tsx`, wikiDir);
  const found = existsSync(file) ? file : new URL(`examples/${name}.ts`, wikiDir);
  return readFileSync(found, 'utf8').replace(/\n+$/, '');
}

/**
 * Lines `from` to `to` (counted from 1) of a file of the adapters, by its path from `adapters/`:
 * what a page quotes of an adapter, which is the real file and cannot drift from it.
 */
export function sourceOfFile(path: string, from = 1, to = Infinity): string {
  return readFileSync(new URL(path, adaptersDir), 'utf8')
    .split('\n')
    .slice(from - 1, to)
    .join('\n')
    .replace(/\n+$/, '');
}
