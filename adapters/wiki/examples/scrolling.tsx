import type { HostElement } from 'blinc_ts/native/host';
import { signal } from '#jsx/owner';
import { useSheet } from '../kit.js';

// A scrolling box, its thumb shown as each scrollbar-visibility says, and an item scrolled into
// view at the start, the centre, the end, or the least that shows it.
const css = `
.sc { flex-direction: row; gap: 24px; align-items: flex-start; }
.sc-box { width: 260px; height: 220px; flex-shrink: 0; overflow-y: auto; border: 1px solid var(--border);
  border-radius: var(--radius-lg); background: var(--surface); }
.sc-item { flex-shrink: 0; padding: 9px 14px; border-bottom: 1px solid var(--border); }
.sc-item[data-target] { background: var(--accent-subtle); font-weight: 700; }
`;

const modes = ['always', 'auto', 'hover', 'hidden'] as const;
const blocks = ['start', 'center', 'end', 'nearest'] as const;

export default function Scrolling() {
  useSheet(css, 'scrolling.css');
  const mode = signal<(typeof modes)[number]>('auto');
  const top = signal(0);
  let box: HostElement | undefined;
  let target: HostElement | undefined;
  return (
    <div class="sc">
      <div
        class="sc-box"
        style={{ scrollbarVisibility: mode }}
        ref={(e: HostElement) => {
          box = e;
        }}
        onScroll={() => top.set(Math.round(box!.scrollTop))}
      >
        {Array.from({ length: 40 }, (_, i) => (
          <div
            class="sc-item"
            data-target={i === 27 ? '' : undefined}
            ref={(e: HostElement) => {
              if (i === 27) {
                target = e;
              }
            }}
          >
            {i === 27 ? 'Item 28, the one to find' : `Item ${i + 1}`}
          </div>
        ))}
      </div>
      <div class="wiki-col" style={{ width: 300, flexShrink: 0 }}>
        <span class="wiki-chip-label">scrollbar-visibility</span>
        <div class="wiki-chips">
          {modes.map((m) => (
            <button
              class="wiki-chip"
              data-active={() => (mode.get() === m ? '' : undefined)}
              onClick={() => mode.set(m)}
            >
              {m}
            </button>
          ))}
        </div>
        <span class="wiki-chip-label" style={{ width: 240 }}>
          scrollIntoView, Item 28
        </span>
        <div class="wiki-chips">
          {blocks.map((block) => (
            <button class="wiki-chip" onClick={() => target!.scrollIntoView({ block })}>
              {block}
            </button>
          ))}
          <button class="wiki-chip" onClick={() => box!.scrollTo(0, 0)}>
            top
          </button>
        </div>
        <span class="wiki-readout" style={{ width: 160 }}>
          {() => `scrollTop: ${top.get()}`}
        </span>
      </div>
    </div>
  );
}
