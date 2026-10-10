import { readFileSync } from 'node:fs';

/** The text of the example `name`, from its file beside the pages: what a reader is shown. */
export function sourceOf(name: string): string {
  const file = new URL(`../../wiki/examples/${name}.tsx`, import.meta.url);
  return readFileSync(file, 'utf8').replace(/\n+$/, '');
}
