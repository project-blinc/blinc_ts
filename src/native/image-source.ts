/**
 * Where an image's bytes come from, and what is known of them before they are drawn: a
 * `data:` URL, an `http:` or `https:` URL, a `file:` URL or a path. The host loads a source
 * once for every element that names it.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isAbsolute, resolve } from 'node:path';

/** An image as loaded: its bytes, and the media type its source gave them if it did. */
export interface LoadedImage {
  bytes: Uint8Array;
  type?: string | undefined;
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
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        type: response.headers.get('content-type') ?? undefined,
      };
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
  const head = url.slice(5, comma);
  const [type, ...flags] = head.split(';');
  const body = url.slice(comma + 1);
  const bytes = flags.some((f) => f.toLowerCase() === 'base64')
    ? Buffer.from(decodeURIComponent(body), 'base64')
    : Buffer.from(decodeURIComponent(body), 'utf8');
  return { bytes: new Uint8Array(bytes), type: type === '' ? undefined : type };
}

/** Whether `image` is SVG markup rather than a raster image. */
export function isSvg(image: LoadedImage, source: string): boolean {
  if (image.type && /svg/i.test(image.type)) {
    return true;
  }
  if (image.type && /^image\/(png|jpe?g|webp|gif)/i.test(image.type)) {
    return false;
  }
  if (/\.svg([?#].*)?$/i.test(source)) {
    return true;
  }
  // A raster image starts with a signature byte that is not text.
  const head = new TextDecoder().decode(image.bytes.subarray(0, 256)).trimStart();
  return /^(<\?xml|<svg|<!doctype svg)/i.test(head);
}

/** What an SVG's root says its size is: its `width` and `height`, else its `viewBox`, else CSS's 300 by 150. */
export function svgSize(markup: string): { width: number; height: number } {
  const root = /<svg\b[^>]*>/i.exec(markup)?.[0] ?? '';
  const attribute = (name: string): string | undefined =>
    new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(root)?.slice(2).find(Boolean);
  const length = (value: string | undefined): number | undefined => {
    const match = /^\s*(-?[\d.]+)\s*(px)?\s*$/i.exec(value ?? '');
    const v = match ? Number(match[1]) : NaN;
    return v > 0 ? v : undefined;
  };
  const box = attribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const [viewWidth, viewHeight] =
    box?.length === 4 && box[2]! > 0 && box[3]! > 0 ? [box[2]!, box[3]!] : [undefined, undefined];
  let width = length(attribute('width'));
  let height = length(attribute('height'));
  // With one side given, the other follows the viewBox's shape.
  if (width !== undefined && height === undefined && viewWidth && viewHeight) {
    height = (width * viewHeight) / viewWidth;
  } else if (height !== undefined && width === undefined && viewWidth && viewHeight) {
    width = (height * viewWidth) / viewHeight;
  }
  return {
    width: width ?? viewWidth ?? 300,
    height: height ?? viewHeight ?? 150,
  };
}
