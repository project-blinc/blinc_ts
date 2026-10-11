import type { HostElement } from 'blinc_ts/native/host';
import { placement } from 'blinc_ts/native/placement';
import { TopLayer, type TopLayerEntry } from 'blinc_ts/native/top-layer';
import { signal, useHost } from '#jsx/owner';
import { useSheet } from '../kit.js';

// What floats over the page goes in the top layer: drawn over everything, hit first, clipped by
// nothing. Its content here is made with the host itself.
const css = `
.tl-pop { gap: 6px; padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--radius-lg);
  background: var(--surface); box-shadow: var(--shadow-lg); }
.tl-pop[data-side="top"] { border-color: var(--info); }
.tl-menu { padding: 6px; gap: 2px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-xl); }
.tl-menu > div { padding: 6px 12px; border-radius: var(--radius-md); }
.tl-menu > div:hover { background: var(--input-bg-hover); }
.tl-area { width: 300px; height: 120px; flex-shrink: 0; align-items: center; justify-content: center;
  border: 1px dashed var(--border-hover); border-radius: var(--radius-lg); color: var(--text-tertiary); }
.tl-sheet { width: 300px; height: 100%; gap: 10px; padding: 24px; background: var(--surface); box-shadow: var(--shadow-2xl); }
`;

const sides = ['top', 'right', 'bottom', 'left'] as const;

export default function TopLayerExample() {
  useSheet(css, 'top-layer.css');
  const host = useHost();
  const layer = TopLayer.of(host);
  const side = signal<(typeof sides)[number]>('bottom');
  const text = (tag: string, words: string, className = '') => {
    const e = host.createElement(tag);
    e.className = className;
    e.appendChild(host.createTextNode(words));
    return e;
  };
  let anchor: HostElement | undefined;
  let open: TopLayerEntry | undefined;
  const popover = () => {
    open?.close();
    const content = host.createElement('div');
    content.className = 'tl-pop';
    content.appendChild(text('b', `Placed ${side.get()} of the button`));
    content.appendChild(text('span', 'It flips where there is no room. Press outside or Escape.'));
    open = layer.open(content, {
      placement: placement.beside(anchor!, side.get(), { gap: 8 }),
      modeless: true,
    });
  };
  const menu = (x: number, y: number) => {
    const content = host.createElement('div');
    content.className = 'tl-menu';
    for (const item of ['Copy', 'Paste', 'Rename']) {
      const row = text('div', item);
      row.addEventListener('click', () => void entry.close());
      content.appendChild(row);
    }
    const entry = layer.open(content, { placement: placement.at(x, y) });
  };
  const sheet = () => {
    const content = host.createElement('div');
    content.className = 'tl-sheet';
    content.appendChild(text('h3', 'A sheet, at the right edge'));
    content.appendChild(text('p', 'Modal: the page is dimmed, Tab stays here, Escape closes it.'));
    const close = text('button', 'Close');
    content.appendChild(close);
    const entry = layer.open(content, { placement: placement.edge('right'), modal: true });
    close.addEventListener('click', () => void entry.close());
  };
  return (
    <div class="wiki-col" style={{ gap: 16 }}>
      <div class="wiki-row">
        <div class="wiki-chips">
          {sides.map((s) => (
            <button
              class="wiki-chip"
              data-active={() => (side.get() === s ? '' : undefined)}
              onClick={() => side.set(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          ref={(e: HostElement) => {
            anchor = e;
          }}
          onClick={popover}
        >
          Open a popover
        </button>
        <button onClick={sheet}>Open a sheet</button>
      </div>
      <div class="tl-area" onClick={(e: { x: number; y: number }) => menu(e.x, e.y)}>
        Press here for a menu where you pressed
      </div>
    </div>
  );
}
