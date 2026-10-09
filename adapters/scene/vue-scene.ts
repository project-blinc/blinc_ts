import { defineComponent, h, ref } from '@vue/runtime-core';
import type { Host } from 'blinc_ts/native/host';
import { createApp } from '../vue/renderer.js';
import { styles, type EventLog } from './styles.js';

/** The reference scene, built with the Vue renderer. Returns the unmount function. */
export function vueScene(host: Host, log: EventLog): () => void {
  const Card = defineComponent({
    props: { name: { type: String, required: true }, extra: String, tint: Object },
    setup(props, { slots }) {
      return () =>
        h(
          'div',
          {
            class: props.extra ? `card ${props.extra}` : 'card',
            style: { ...styles.card, ...props.tint },
          },
          [`Card ${props.name}`, slots.default?.()],
        );
    },
  });
  const App = defineComponent({
    setup() {
      const clicks = ref(0);
      return () =>
        h(
          'div',
          { id: 'app', style: styles.app, onPointerdownCapture: () => log.push('app-capture') },
          [
            h('div', { class: 'header', style: styles.header, onClick: () => log.push('header') }, [
              'Blinc host',
              h(
                'button',
                {
                  id: 'counter',
                  style: styles.button,
                  onClick: () => {
                    clicks.value++;
                    log.push('button');
                  },
                },
                `Clicks: ${clicks.value}`,
              ),
            ]),
            h('div', { class: 'cards', style: styles.cards }, [
              h(Card, { name: 'A' }),
              h(Card, { name: 'B' }, () => [h('div', { class: 'badge', style: styles.badge })]),
              h(Card, { name: 'C', extra: 'first', tint: styles.first }),
            ]),
            h('div', { class: 'footer', style: styles.footer }, 'footer'),
          ],
        );
    },
  });
  const app = createApp(host, App);
  app.mount();
  return () => app.unmount();
}
