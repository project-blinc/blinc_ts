import type { Host, HostElement } from 'blinc_ts/native/host';
import { useHost } from '#jsx/owner';

/** A view as data: what a server or a file could send, with handlers named, not written. */
interface Spec {
  tag: string;
  class?: string;
  text?: string;
  on?: Record<string, string>;
  children?: Spec[];
}

/** An adapter for that data: one function from a spec to host elements, and a way to ask again. */
function render(host: Host, spec: Spec, actions: Record<string, () => void>): HostElement {
  const element = host.createElement(spec.tag);
  if (spec.class) {
    element.className = spec.class;
  }
  for (const [event, action] of Object.entries(spec.on ?? {})) {
    element.addEventListener(event, () => actions[action]?.());
  }
  if (spec.text !== undefined) {
    element.appendChild(host.createTextNode(spec.text));
  }
  for (const child of spec.children ?? []) {
    element.appendChild(render(host, child, actions));
  }
  return element;
}

export default function FromData() {
  const host = useHost();
  const build = (into: HostElement) => {
    let items = ['Write a spec', 'Render it'];
    const draw = () => {
      // The simplest way to update: throw the old tree away and render the new spec in its place.
      while (into.firstChild) {
        into.firstChild.destroy();
      }
      into.appendChild(
        render(
          host,
          {
            tag: 'div',
            class: 'wiki-col',
            children: [
              { tag: 'button', text: 'Add a step', on: { click: 'add' } },
              { tag: 'ul', children: items.map((text) => ({ tag: 'li', text })) },
            ],
          },
          {
            add: () => {
              items = [...items, `Step ${items.length + 1}`];
              draw();
            },
          },
        ),
      );
    };
    draw();
  };
  return <div ref={build} />;
}
