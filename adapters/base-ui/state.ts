/**
 * The state a component holds, shared with its user as Base UI's `value` and `defaultValue` do.
 * A signal given as the controlled value is read and written, so the component and the code
 * around it share it; a computed value or a function is read, and the component only reports
 * what the user asked for; a constant is the value held; none, and the component holds its own,
 * from the default.
 */
import { Signal } from 'blinc_ts/native';
import { read, signal, type Source } from '#jsx/owner';

export interface Held<T> {
  /** The value; read in an effect or a region, it is a dependency. */
  get(): T;
  /** Ask for `next`: held and reported if it is ours to hold, reported alone if the user's. */
  set(next: T): void;
}

export function held<T>(
  controlled: Source<T> | undefined,
  initial: T,
  onChange?: (next: T) => void,
): Held<T> {
  if (controlled instanceof Signal) {
    return {
      get: () => controlled.get() as T,
      set: (next) => {
        if (!Object.is(controlled.peek(), next)) {
          controlled.set(next);
          onChange?.(next);
        }
      },
    };
  }
  if (controlled !== undefined) {
    return {
      get: () => read(controlled),
      set: (next) => onChange?.(next),
    };
  }
  const own = signal(initial);
  return {
    get: () => own.get(),
    set: (next) => {
      if (!Object.is(own.peek(), next)) {
        own.set(next);
        onChange?.(next);
      }
    },
  };
}
