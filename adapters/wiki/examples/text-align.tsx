import { signal } from '#jsx/owner';
import { useSheet, valueOf } from '../kit.js';

const css = [
  '.ta-sample { display: block; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-lg); }',
  '.ta-heading { display: block; width: 100%; font-size: var(--text-xl); font-weight: 700; }',
  '.ta-paragraph { display: block; width: 100%; margin-top: var(--space-3); line-height: 1.5; }',
].join('\n');

export default function TextAlign() {
  useSheet(css, 'text-align.css');
  const align = signal<'left' | 'center' | 'right' | 'justify'>('center');
  const width = signal(360);
  return (
    <div class="wiki-col">
      <div class="wiki-row">
        <div class="wiki-chips">
          {(['left', 'center', 'right', 'justify'] as const).map((mode) => (
            <button
              class="wiki-chip"
              data-active={() => (align.get() === mode ? '' : undefined)}
              onClick={() => align.set(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
        <input
          type="range"
          min="200"
          max="520"
          value="360"
          aria-label="Text width"
          onInput={(e: { target: unknown }) => width.set(Number(valueOf(e)))}
        />
      </div>
      <div class="ta-sample" style={{ width: () => width.get() + 'px', textAlign: align }}>
        <h3 class="ta-heading">A plain heading</h3>
        <p class="ta-paragraph">
          Each line follows the alignment inherited from this box. Change its width to wrap the
          paragraph, or justify the words to fill every line except the last.
        </p>
      </div>
    </div>
  );
}
