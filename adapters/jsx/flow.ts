/**
 * Control flow for views: what shows, which of several shows, and a list that keeps what it
 * built for an item as the list changes. Each is a component that builds itself in place, so a
 * change rebuilds only its own part of the tree.
 */
import type { Signal } from 'blinc_ts/native';
import type { HostElement, HostNode } from 'blinc_ts/native/host';
import { Owner, memoOf, read, runWithOwner, type Context, type Source } from './owner.js';
import { build, direct, region, removeBetween, type Child, type JsxNode } from './build.js';

/** Shows `children` while `when` is truthy, else `fallback`. A function child is given the value. */
export function Show<T>(props: {
  when: Source<T>;
  fallback?: Child;
  children?: Child | ((value: NonNullable<T>) => Child);
}): JsxNode {
  return direct(({ host, place, owner }) => {
    // What shows follows whether `when` is truthy, so a change that leaves that alone rebuilds nothing.
    const shown = memoOf(owner, () => Boolean(read(props.when)));
    const render = props.children;
    region(
      host,
      () => {
        if (!shown.get()) {
          return props.fallback;
        }
        return typeof render === 'function' ? render(read(props.when) as NonNullable<T>) : render;
      },
      place,
      owner,
    );
  });
}

/** One case of a `Switch`: its children while `when` is truthy. */
export function Match<T>(props: {
  when: Source<T>;
  children?: Child | ((value: NonNullable<T>) => Child);
}): JsxNode {
  return Show(props);
}

function matches(children: Child): JsxNode[] {
  if (Array.isArray(children)) {
    return (children as readonly Child[]).flatMap(matches);
  }
  const node = children as JsxNode | null;
  return node && typeof node === 'object' && node.type === Match ? [node] : [];
}

/** Shows the first `Match` whose `when` is truthy, else `fallback`. */
export function Switch(props: { fallback?: Child; children?: Child }): JsxNode {
  return direct(({ host, place, owner }) => {
    const cases = matches(props.children);
    const chosen = memoOf(owner, () =>
      cases.findIndex((c) => Boolean(read(c.props.when as Source<unknown>))),
    );
    region(
      host,
      () => {
        const at = chosen.get();
        if (at < 0) {
          return props.fallback;
        }
        const { when, children } = cases[at]!.props;
        return typeof children === 'function'
          ? (children as (value: unknown) => Child)(read(when as Source<unknown>))
          : (children as Child);
      },
      place,
      owner,
    );
  });
}

/** What a list built for one item. */
interface Entry<T> {
  readonly item: T;
  readonly owner: Owner;
  readonly index: Signal<number> | null;
  /** Its anchors, which hold what it built between them. */
  first: HostNode | null;
  last: HostNode | null;
}

/**
 * A list of `each`: `children(item, index)` is built once for an item, and kept, moved and
 * not rebuilt, while the item stays in the list, found by identity. `index` is a function that
 * reads the item's place. `fallback` shows while the list is empty.
 */
export function For<T>(props: {
  each: Source<readonly T[] | null | undefined>;
  fallback?: Child;
  children: (item: T, index: () => number) => Child;
}): JsxNode {
  return direct(({ host, place, owner }) => {
    const context = owner.reactive();
    const start = host.createComment('[');
    const end = host.createComment(']');
    place(start);
    place(end);
    let entries: Entry<T>[] = [];
    let empty: Owner | null = null;

    const drop = (entry: Entry<T>): void => {
      entry.owner.dispose();
      if (entry.first && entry.last) {
        // Its anchors and what is between them.
        const stop = entry.last.nextSibling;
        for (let node: HostNode | null = entry.first; node && node !== stop;) {
          const next: HostNode | null = node.nextSibling;
          node.destroy();
          node = next;
        }
      }
    };
    owner.scope.onCleanup(() => {
      for (const entry of entries) {
        entry.owner.dispose();
      }
      empty?.dispose();
    });

    const make = (item: T, at: number, parent: HostElement, ref: HostNode): Entry<T> => {
      const entryOwner = new Owner(context, owner, false);
      // A function of one argument has no use for the index, so no signal is kept for it.
      const index = props.children.length > 1 ? context.signal(at, entryOwner.scope) : null;
      const first = host.createComment('<');
      const last = host.createComment('>');
      parent.insertBefore(first, ref);
      parent.insertBefore(last, ref);
      const entry: Entry<T> = { item, owner: entryOwner, index, first, last };
      runWithOwner(entryOwner, () =>
        build(
          host,
          props.children(item, () => index?.get() ?? -1),
          (node) => parent.insertBefore(node, last),
          entryOwner,
        ),
      );
      return entry;
    };

    const move = (entry: Entry<T>, parent: HostElement, ref: HostNode): void => {
      const stop = entry.last!.nextSibling;
      const nodes: HostNode[] = [];
      for (
        let node: HostNode | null = entry.first;
        node && node !== stop;
        node = node.nextSibling
      ) {
        nodes.push(node);
      }
      for (const node of nodes) {
        parent.insertBefore(node, ref);
      }
    };

    const reconcile = (list: readonly T[]): void => {
      const parent = end.parentNode;
      if (!parent) {
        return;
      }
      if (list.length === 0) {
        for (const entry of entries) {
          drop(entry);
        }
        entries = [];
        if (!empty && props.fallback !== undefined && props.fallback !== null) {
          const fallback = new Owner(context, owner, false);
          empty = fallback;
          runWithOwner(fallback, () =>
            build(host, props.fallback, (node) => parent.insertBefore(node, end), fallback),
          );
        }
        return;
      }
      if (empty) {
        empty.dispose();
        empty = null;
        removeBetween(start, end);
      }
      // What is kept is found by item; an item twice in the list is kept twice, in order.
      const pool = new Map<T, Entry<T>[]>();
      for (const entry of entries) {
        const same = pool.get(entry.item);
        if (same) {
          same.push(entry);
        } else {
          pool.set(entry.item, [entry]);
        }
      }
      const next: (Entry<T> | undefined)[] = list.map((item) => pool.get(item)?.shift());
      for (const left of pool.values()) {
        for (const entry of left) {
          drop(entry);
        }
      }
      // From the end, so each is placed before what follows it; one already there is not touched.
      let ref: HostNode = end;
      for (let at = list.length - 1; at >= 0; at--) {
        let entry = next[at];
        if (!entry) {
          entry = make(list[at] as T, at, parent as HostElement, ref);
          next[at] = entry;
        } else if (entry.last!.nextSibling !== ref) {
          move(entry, parent as HostElement, ref);
        }
        entry.index?.set(at);
        ref = entry.first!;
      }
      entries = next as Entry<T>[];
    };

    context.effect(() => {
      const list = read(props.each) ?? [];
      context.untrack(() => reconcile(list));
    }, owner.scope);
  });
}

/** A context's `Provider` gives `value` to what is built under it. */
export interface ProviderContext<T> extends Context<T> {
  Provider(props: { value: T; children?: Child }): JsxNode;
}

export function createContext<T>(defaultValue?: T): ProviderContext<T> {
  const id = Symbol('context');
  return {
    id,
    defaultValue,
    Provider: (props) =>
      direct(({ host, place, owner }) => {
        const scoped = new Owner(owner.context, owner);
        scoped.provide(id, props.value);
        runWithOwner(scoped, () => build(host, props.children, place, scoped));
      }),
  };
}
