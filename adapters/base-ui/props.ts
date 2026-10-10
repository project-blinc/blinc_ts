/**
 * What every part of a component does with the props its user gives it: the user's `class` is
 * added to the part's own, a handler the user gives runs after the part's, and `ref` is called
 * for both. Anything else the user gives wins over what the part set.
 */
import type { HostElement } from 'blinc_ts/native/host';
import { isSource, read, type Source } from '#jsx/owner';
import type { Child } from '#jsx/jsx-runtime';

export type Props = Record<string, unknown>;

/** The props every part takes, over its element's own. */
export interface PartProps {
  class?: Source<string | undefined>;
  style?: unknown;
  ref?: (element: HostElement) => void;
  children?: Child;
  [prop: string]: unknown;
}

const isHandler = (name: string): boolean => /^on[A-Z]/.test(name);

function joined(own: unknown, given: unknown): unknown {
  if (given === undefined || given === null || given === false) {
    return own;
  }
  if (isSource(own) || isSource(given)) {
    return () =>
      [read(own as Source<string>), read(given as Source<string>)].filter(Boolean).join(' ');
  }
  return [own, given].filter(Boolean).join(' ');
}

/** The part's `own` props with the user's `given` laid over them. */
export function merge(own: Props, given: Props): Props {
  const out: Props = { ...own };
  for (const [name, value] of Object.entries(given)) {
    if (value === undefined) {
      continue;
    }
    if (name === 'class' || name === 'className') {
      out.class = joined(out.class, value);
    } else if (isHandler(name) && typeof out[name] === 'function') {
      const first = out[name] as (event: unknown) => void;
      out[name] = (event: unknown) => {
        first(event);
        (value as (event: unknown) => void)(event);
      };
    } else if (name === 'ref' && typeof out.ref === 'function') {
      const first = out.ref as (element: HostElement) => void;
      out.ref = (element: HostElement) => {
        first(element);
        (value as (element: HostElement) => void)(element);
      };
    } else {
      out[name] = value;
    }
  }
  return out;
}

/** A boolean as a `data-` flag: present and empty when true, absent when false. */
export function flag(on: Source<boolean | undefined>): () => '' | undefined {
  return () => (read(on) ? '' : undefined);
}
