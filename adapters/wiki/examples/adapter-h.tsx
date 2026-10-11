import type { Host, HostElement, HostNode } from 'blinc_ts/native/host';
import { useHost } from '#jsx/owner';

/**
 * An adapter in one function: it makes a host element from a tag, its props and its children.
 * Attributes, a class and listeners are what the host takes; everything else it does itself.
 */
function h(
  host: Host,
  tag: string,
  props: Record<string, unknown> = {},
  ...children: (HostNode | string)[]
): HostElement {
  const element = host.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (name.startsWith('on')) {
      element.addEventListener(name.slice(2).toLowerCase(), value as never);
    } else if (name === 'class') {
      element.className = String(value);
    } else {
      element.setAttribute(name, String(value));
    }
  }
  for (const child of children) {
    element.appendChild(typeof child === 'string' ? host.createTextNode(child) : child);
  }
  return element;
}

export default function HandWritten() {
  const host = useHost();
  // The view is made once with plain calls. What changes later is changed by hand: a text node's
  // data is all the host needs to show the new count.
  const build = (into: HostElement) => {
    let count = 0;
    const label = host.createTextNode('0 clicks');
    const click = () => {
      count++;
      label.data = `${count} click${count === 1 ? '' : 's'}`;
    };
    into.appendChild(
      h(
        host,
        'div',
        { class: 'wiki-row' },
        h(host, 'button', { onClick: click }, 'Click me'),
        h(host, 'span', { class: 'wiki-readout' }, label),
      ),
    );
  };
  return <div ref={build} />;
}
