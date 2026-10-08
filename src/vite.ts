import { createRunnableDevEnvironment } from 'vite';
import type { Plugin } from 'vite';

export interface BlincViteOptions {
  /** Environment that runs native app modules in the Node main thread. */
  environment?: string;
}

/**
 * Uses Vite's Module Runner and in-process HMR transport. App modules execute
 * in Node, where xgpu/xwindow addons share the main thread.
 */
export function blinc(options: BlincViteOptions = {}): Plugin {
  const environment = options.environment ?? 'blinc';
  if (environment === 'client' || environment === 'ssr') {
    throw new Error('Choose a dedicated Blinc environment name');
  }
  return {
    name: 'blinc_ts',
    config() {
      return {
        server: {
          watch: {
            ignored: [
              '**/.blinc/**',
              '**/.shader-build/**',
              '**/native/target/**',
              '**/native/*.node',
            ],
          },
        },
        environments: {
          [environment]: {
            consumer: 'server',
            resolve: { conditions: ['node'] },
            dev: {
              createEnvironment(name, config) {
                return createRunnableDevEnvironment(name, config);
              },
            },
            build: { ssr: true, target: 'node22', outDir: 'dist/native' },
          },
        },
      };
    },
  };
}
