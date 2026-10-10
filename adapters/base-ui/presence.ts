import type { HostElement } from 'blinc_ts/native/host';
import { effect, signal, untrack } from '#jsx/owner';

/**
 * Whether something that opens and closes is still there: it is while it is open, and while the
 * motion of its closing plays, so it can be seen going. Ask it of the element that moves.
 */
export function presence(
  open: () => boolean,
  element: () => HostElement | undefined,
): () => boolean {
  const leaving = signal(false);
  let was = untrack(open);
  effect(() => {
    const now = open();
    if (was && !now) {
      const moving = element();
      if (moving) {
        leaving.set(true);
        void moving.animationsFinished().then(() => {
          if (!open()) {
            leaving.set(false);
          }
        });
      }
    } else if (now) {
      leaving.set(false);
    }
    was = now;
  });
  return () => open() || leaving.get();
}
