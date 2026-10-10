import { HostElement } from 'blinc_ts/native/host';

/** The elements under `root`, in tree order, that `test` accepts. */
export function descendants(
  root: HostElement,
  test: (element: HostElement) => boolean,
): HostElement[] {
  const found: HostElement[] = [];
  const walk = (parent: HostElement): void => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child instanceof HostElement) {
        if (test(child)) {
          found.push(child);
        }
        walk(child);
      }
    }
  };
  walk(root);
  return found;
}

/** The one of `items` after (or before, for -1) `from`, wrapping when `loop`; the first or last with no `from`. */
export function step<T>(
  items: readonly T[],
  from: T | undefined,
  by: 1 | -1,
  loop = true,
): T | undefined {
  if (items.length === 0) {
    return undefined;
  }
  const at = from === undefined ? -1 : items.indexOf(from);
  if (at < 0) {
    return by === 1 ? items[0] : items[items.length - 1];
  }
  const next = at + by;
  if (next < 0 || next >= items.length) {
    return loop ? items[(next + items.length) % items.length] : items[at];
  }
  return items[next];
}
