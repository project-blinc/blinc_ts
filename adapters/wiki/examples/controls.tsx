import type { HostElement } from 'blinc_ts/native/host';
import { signal } from '#jsx/owner';
import { valueOf } from '../kit.js';

// The controls the host makes work: each reports what it holds as the user changes it.
export default function Controls() {
  const ticked = signal('on');
  const size = signal('M');
  const level = signal(40);
  const opened = signal(false);
  let boxes: HostElement | undefined;
  return (
    <div class="wiki-col" style={{ gap: 18 }}>
      <div class="wiki-row" style={{ gap: 20 }}>
        <label>
          <input
            type="checkbox"
            checked
            ref={(e: HostElement) => {
              boxes = e;
            }}
            onChange={(e: { target: unknown }) =>
              ticked.set((e.target as HostElement).checked ? 'on' : 'off')
            }
          />{' '}
          A checkbox
        </label>
        <button
          onClick={() => {
            boxes!.indeterminate = true;
            ticked.set('indeterminate');
          }}
        >
          Make it indeterminate
        </button>
        <span class="wiki-readout" style={{ width: 150 }}>
          {() => `checkbox: ${ticked.get()}`}
        </span>
      </div>
      <div class="wiki-row" style={{ gap: 20 }}>
        {['S', 'M', 'L', 'XL'].map((s) => (
          <label>
            <input
              type="radio"
              name="size"
              value={s}
              checked={s === 'M'}
              onChange={() => size.set(s)}
            />{' '}
            {s}
          </label>
        ))}
        <span class="wiki-hint">arrows move through the set</span>
        <span class="wiki-readout" style={{ width: 90 }}>
          {() => `size: ${size.get()}`}
        </span>
      </div>
      <div class="wiki-row" style={{ gap: 20 }}>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value="40"
          aria-label="Level"
          onInput={(e: { target: unknown }) => level.set(Number(valueOf(e)))}
        />
        <progress max="100" value={() => String(level.get())} />
        <meter
          min="0"
          max="100"
          low="30"
          high="70"
          optimum="90"
          value={() => String(level.get())}
        />
        <span class="wiki-readout" style={{ width: 100 }}>
          {() => `level: ${level.get()}`}
        </span>
      </div>
      <div class="wiki-row" style={{ gap: 20, alignItems: 'flex-start' }}>
        <progress />
        <span class="wiki-hint">a progress with no value is indeterminate</span>
      </div>
      <details
        onToggle={(e: { target: unknown }) =>
          opened.set((e.target as HostElement).hasAttribute('open'))
        }
      >
        <summary>{() => (opened.get() ? 'Details, open' : 'Details, closed')}</summary>
        <p>A summary opens and closes its details by a click, Enter or Space.</p>
      </details>
    </div>
  );
}
