/** A host owns persistent resources: its window, GPU device and renderer. */
export interface DisposableHost {
  dispose(): void;
}

export type Cleanup = () => void;

/** Lifetime of one mounted UI root, independent of its persistent native host. */
export class Scope {
  #cleanups: Cleanup[] = [];
  #disposed = false;

  get disposed(): boolean {
    return this.#disposed;
  }

  onCleanup(cleanup: Cleanup): void {
    if (this.#disposed) {
      cleanup();
    } else {
      this.#cleanups.push(cleanup);
    }
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    const errors: unknown[] = [];
    for (const cleanup of this.#cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) {
      throw new AggregateError(errors, 'UI scope cleanup failed');
    }
  }
}

export type RootFactory<Host extends DisposableHost, Root> = (host: Host, scope: Scope) => Root;

/** Keeps a host alive while replacing UI roots and releasing their resources. */
export class AppSession<Host extends DisposableHost> {
  readonly host: Host;
  #scope: Scope | undefined;
  #disposed = false;

  constructor(host: Host) {
    this.host = host;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  mount<Root>(factory: RootFactory<Host, Root>): Root {
    if (this.#disposed) {
      throw new Error('Cannot mount a disposed application');
    }
    this.unmount();
    const scope = new Scope();
    this.#scope = scope;
    try {
      return factory(this.host, scope);
    } catch (error) {
      this.#scope = undefined;
      try {
        scope.dispose();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Mount and cleanup failed', {
          cause: cleanupError,
        });
      }
      throw error;
    }
  }

  unmount(): void {
    const scope = this.#scope;
    this.#scope = undefined;
    scope?.dispose();
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    const errors: unknown[] = [];
    try {
      this.unmount();
    } catch (error) {
      errors.push(error);
    }
    try {
      this.host.dispose();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) {
      throw new AggregateError(errors, 'Application cleanup failed');
    }
  }
}

/**
 * Structural subset of the Vite HMR API. Other bundlers can adapt their hot
 * contexts to this interface; this module has no runtime dependency on Vite.
 */
export interface HotContext {
  readonly data: Record<string, unknown>;
  dispose(callback: (data: Record<string, unknown>) => void): void;
  prune?(callback: (data: Record<string, unknown>) => void): void;
  on?(event: 'vite:beforeFullReload', callback: () => void): void;
  off?(event: 'vite:beforeFullReload', callback: () => void): void;
}

const SESSION_KEY = 'blinc_ts.session';

/**
 * Reuses the persistent host through hot.data. The entry must contain a literal
 * import.meta.hot.accept() call so Vite recognizes the HMR boundary.
 */
export function createHmrSession<Host extends DisposableHost>(
  hot: HotContext | undefined,
  createHost: () => Host,
): AppSession<Host> {
  let session = hot?.data[SESSION_KEY] as AppSession<Host> | undefined;
  if (!session || session.disposed) {
    session = new AppSession(createHost());
    if (hot) {
      hot.data[SESSION_KEY] = session;
    }
  }
  const current = session;
  if (hot) {
    const close = () => {
      try {
        current.dispose();
      } finally {
        if (hot.data[SESSION_KEY] === current) {
          delete hot.data[SESSION_KEY];
        }
      }
    };
    hot.on?.('vite:beforeFullReload', close);
    hot.dispose(() => {
      hot.off?.('vite:beforeFullReload', close);
      current.unmount();
    });
    hot.prune?.(close);
  }
  return current;
}
