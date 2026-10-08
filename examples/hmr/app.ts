import { createHmrSession } from '../../src/hmr.js';

/**
 * Headless HMR harness. This host logs its lifetime; it does not open a native
 * window. For a real window and device, use examples/native/app.ts.
 */
export const session = createHmrSession(import.meta.hot, () => {
  console.log('Host created');
  return {
    dispose() {
      console.log('Host disposed');
    },
  };
});

session.mount((_host, scope) => {
  console.log('UI mounted: edit this message to exercise HMR');
  scope.onCleanup(() => console.log('UI scope disposed'));
});

if (import.meta.hot) {
  import.meta.hot.accept();
}
