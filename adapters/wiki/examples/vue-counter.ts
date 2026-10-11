import { defineComponent, h, ref } from '@vue/runtime-core';
import type { HostElement } from 'blinc_ts/native/host';
import { jsx } from '#jsx/jsx-runtime';
import { onCleanup, useHost } from '#jsx/owner';
import { createApp } from '../../vue/renderer.js';

// A Vue component, as Vue is written: Vue's own reactivity decides what to update, and its renderer
// (adapters/vue/renderer.ts) turns each change into calls on the same host the rest of this page uses.
const Counter = defineComponent({
  setup() {
    const count = ref(0);
    return () =>
      h('div', { class: 'wiki-row' }, [
        h('button', { onClick: () => count.value++ }, 'Count in Vue'),
        h('span', { class: 'wiki-readout' }, `count = ${count.value}`),
      ]);
  },
});

export default function VueCounter() {
  const host = useHost();
  let app: ReturnType<typeof createApp> | undefined;
  onCleanup(() => app?.unmount());
  // The app is mounted into an element of this page: a container is all a renderer needs.
  return jsx('div', {
    ref: (container: HostElement) => {
      app = createApp(host, Counter, container);
      app.mount();
    },
  });
}
