import { existsSync } from 'node:fs';

/** The wiki's folder of sources, whether this module runs from there or from the build. */
export const wikiDir: URL = existsSync(new URL('./home.ts', import.meta.url))
  ? new URL('./', import.meta.url)
  : new URL('../../wiki/', import.meta.url);

/** The folder of the adapters, which pages quote from. */
export const adaptersDir: URL = new URL('../', wikiDir);
