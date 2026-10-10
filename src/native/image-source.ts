/**
 * Where an image's bytes come from, and what is known of them before they are drawn: a
 * `data:` URL, an `http:` or `https:` URL, a `file:` URL or a path. The host loads a source
 * once for every element that names it.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isAbsolute, resolve } from 'node:path';

/** An image file as loaded. What kind it is, the native loader says from the bytes. */
export interface LoadedImage {
  bytes: Uint8Array;
}

/** Loads `source`, as `<img src>` or `url()` names it; rejects when it cannot. */
export type ImageLoader = (source: string) => Promise<LoadedImage>;

/** The loader a host uses unless it is given another: relative paths are from `base`. */
export function defaultImageLoader(base: string = process.cwd()): ImageLoader {
  return async (source) => {
    const url = source.trim();
    if (/^data:/i.test(url)) {
      return dataUrl(url);
    }
    if (/^https?:/i.test(url)) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`${url}: ${response.status} ${response.statusText}`);
      }
      return { bytes: new Uint8Array(await response.arrayBuffer()) };
    }
    const path = /^file:/i.test(url)
      ? fileURLToPath(url)
      : isAbsolute(url)
        ? url
        : resolve(base, url);
    return { bytes: new Uint8Array(await readFile(path)) };
  };
}

function dataUrl(url: string): LoadedImage {
  const comma = url.indexOf(',');
  if (comma < 0) {
    throw new Error('not a data URL: no comma');
  }
  const base64 = url
    .slice(5, comma)
    .split(';')
    .some((flag) => flag.toLowerCase() === 'base64');
  const body = decodeURIComponent(url.slice(comma + 1));
  return { bytes: new Uint8Array(Buffer.from(body, base64 ? 'base64' : 'utf8')) };
}
