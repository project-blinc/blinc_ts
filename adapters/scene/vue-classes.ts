import { defineComponent, h, ref } from '@vue/runtime-core';
import type { Host } from 'blinc_ts/native/host';
import { createApp } from '../vue/renderer.js';

/** Three tiles styled by class; the returned function switches the middle one on. */
export function vueClasses(host: Host): () => void {
  const on = ref(false);
  const App = defineComponent({
    setup() {
      return () =>
        h('div', { class: 'panel' }, [
          h('div', { class: 'tile' }),
          h('div', { class: ['tile', { on: on.value }] }),
          h('div', { class: 'tile on' }),
        ]);
    },
  });
  createApp(host, App).mount();
  return () => {
    on.value = true;
  };
}
