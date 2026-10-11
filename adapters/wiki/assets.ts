import { fileURLToPath } from 'node:url';
import { wikiDir } from './home.js';

/** The path of an image the wiki shows, from the folder of them beside the pages. */
export function asset(name: string): string {
  return fileURLToPath(new URL(`assets/${name}`, wikiDir));
}
