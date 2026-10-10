/**
 * What a popup, a tooltip or a dialog is made of: content that is built and shown in the host's
 * top layer while `open`, and gone, with what it made, after it has closed. Closing by Escape or
 * a press outside reports through `onClose`, so the state a component holds follows.
 */
import type { HostElement, HostNode } from 'blinc_ts/native/host';
import { TopLayer, type TopLayerEntry, type TopLayerOptions } from 'blinc_ts/native/top-layer';
import type { Child } from '#jsx/jsx-runtime';
import { build } from '#jsx/build';
import { descendants } from './dom.js';
import type { Host } from 'blinc_ts/native/host';
import { Owner, runWithOwner } from '#jsx/owner';

export interface Floating {
  /** Whether it should be showing now; read in an effect, so it follows what it reads. */
  open(): boolean;
  /** The element that is the popup, as a view; built each time it opens. */
  view(): Child;
  /** The top layer's options, read as it opens. */
  options(): TopLayerOptions;
  /** It was closed from within, by Escape or a press outside: the state is to follow. */
  closed(): void;
}

/** Keep `spec` in step with its `open`, for `parent` and until it ends. */
export function floating(host: Host, parent: Owner, spec: Floating): void {
  const context = parent.reactive();
  const layer = TopLayer.of(host);
  let live: { entry: TopLayerEntry; owner: Owner; element: HostElement } | null = null;

  /** Let go of what a popup made, once its exit has played. */
  const release = (shown: NonNullable<typeof live>): void => {
    shown.owner.dispose();
    if (!shown.element.destroyed) {
      shown.element.destroy();
    }
  };
  const close = (): void => {
    const shown = live;
    if (!shown) {
      return;
    }
    live = null;
    void shown.entry.close().then(() => release(shown));
  };
  parent.scope.onCleanup(() => {
    const shown = live;
    live = null;
    if (shown) {
      void shown.entry.close();
      release(shown);
    }
  });

  context.effect(() => {
    const want = spec.open();
    context.untrack(() => {
      if (!want) {
        close();
        return;
      }
      if (live) {
        return;
      }
      const owner = new Owner(context, parent, false);
      let element: HostElement | undefined;
      runWithOwner(owner, () =>
        build(
          host,
          spec.view(),
          (node: HostNode) => {
            element ??= node as HostElement;
          },
          owner,
        ),
      );
      if (!element) {
        owner.dispose();
        return;
      }
      const options = spec.options();
      const shown = {
        entry: layer.open(element, {
          ...options,
          onClose: () => {
            options.onClose?.();
            // Closed from within, the state follows; closed from here, it already has.
            if (live?.element === element) {
              live = null;
              // Its close is under way; what it made goes when that has played.
              queueMicrotask(() => void shown.entry.close().then(() => release(shown)));
              spec.closed();
            }
          },
        }),
        owner,
        element,
      };
      live = shown;
      if (options.focus ?? options.modal) {
        // The first control in it, else the popup itself.
        const first = descendants(element, (e) => host.input.isFocusable(e, true))[0];
        (first ?? element).focus();
      }
    });
  }, parent.scope);
}
