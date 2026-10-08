import { readFile } from 'node:fs/promises';

const [template, client, overlay] = await Promise.all([
  readFile(new URL('viewer.html', import.meta.url), 'utf8'),
  readFile(new URL('viewer-client.mjs', import.meta.url), 'utf8'),
  readFile(new URL('motion-overlay.mjs', import.meta.url), 'utf8'),
]);

export function viewer(manifest) {
  const data = JSON.stringify(manifest).replaceAll('<', '\\u003c');
  return template
    .replace('"__BLINC_CAPTURE__"', () => data)
    .replace('__BLINC_CLIENT__', () => overlay + '\n' + client);
}
