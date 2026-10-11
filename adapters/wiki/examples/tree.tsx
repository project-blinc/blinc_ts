import { HostElement, HostText, type HostNode } from 'blinc_ts/native/host';
import { signal, useHost } from '#jsx/owner';

// The host's tree as a framework sees it, and the parts the host made for its elements, which
// are in the cascade and drawn but are not among childNodes.
export default function Tree() {
  const host = useHost();
  const lines = signal<string[]>([]);
  let sample: HostElement | undefined;
  const inspect = () => {
    const out: string[] = [];
    const walk = (node: HostNode, depth: number) => {
      const pad = '  '.repeat(depth);
      if (node instanceof HostText) {
        out.push(`${pad}"${node.data}"`);
        return;
      }
      if (!(node instanceof HostElement)) {
        return;
      }
      const e = node;
      const marker = e.tag === 'li' ? host.behaviours.markerOf(e) : null;
      out.push(
        `${pad}<${e.tag}${e.className ? ` class="${e.className}"` : ''}>${marker ? `   marker: ${marker}` : ''}`,
      );
      for (const child of e.childNodes) {
        walk(child, depth + 1);
      }
    };
    walk(sample!, 0);
    lines.set(out);
  };
  return (
    <div class="wiki-row" style={{ alignItems: 'flex-start', gap: 24, flexWrap: 'nowrap' }}>
      <div
        class="wiki-col"
        style={{ width: 220, flexShrink: 0 }}
        ref={(e: HostElement) => {
          sample = e;
        }}
      >
        <ol start="3">
          <li>Third</li>
          <li>Fourth</li>
        </ol>
        <select aria-label="A select">
          <option>One</option>
          <option>Two</option>
        </select>
      </div>
      <div class="wiki-col" style={{ width: 360, flexShrink: 0 }}>
        <button onClick={inspect}>Walk childNodes</button>
        <pre style={{ alignSelf: 'stretch', minHeight: 180 }}>
          {() => lines.get().join('\n') || ' '}
        </pre>
      </div>
    </div>
  );
}
