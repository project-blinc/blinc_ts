import { signal } from '#jsx/owner';
import { valueOf } from '../kit.js';

// A paragraph with inline elements wraps them with its text at its width, on one baseline,
// however its pieces are styled; a link is pressed wherever it wraps.
export default function InlineFlow() {
  const width = signal(520);
  const align = signal<'left' | 'center' | 'right' | 'justify'>('left');
  const presses = signal(0);
  return (
    <div class="wiki-col" style={{ width: '100%' }}>
      <div class="wiki-row">
        <div class="wiki-chips">
          {(['left', 'center', 'right', 'justify'] as const).map((a) => (
            <button
              class="wiki-chip"
              data-active={() => (align.get() === a ? '' : undefined)}
              onClick={() => align.set(a)}
            >
              {a}
            </button>
          ))}
        </div>
        <input
          type="range"
          min="200"
          max="640"
          value="520"
          aria-label="Width"
          onInput={(e: { target: unknown }) => width.set(Number(valueOf(e)))}
        />
        <span class="wiki-readout" style={{ width: 150 }}>
          {() => `width: ${width.get()}px`}
        </span>
      </div>
      <p
        style={{
          width: () => `${width.get()}px`,
          textAlign: align,
          padding: 'var(--space-3)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
        }}
      >
        Text with <strong>strong</strong> and <em>emphasised</em> words, <code>inline code</code>, a
        key like <kbd>Esc</kbd>, a <mark>highlight</mark>,{' '}
        <span style={{ fontSize: 22, fontWeight: 700 }}>larger type</span> on the same baseline, and{' '}
        <a
          href="#text"
          onClick={(e: { preventDefault(): void }) => (
            e.preventDefault(),
            presses.set(presses.get() + 1)
          )}
        >
          a link long enough to wrap across a line
        </a>{' '}
        that takes a press on any of its pieces.
      </p>
      <span class="wiki-readout" style={{ width: 160 }}>
        {() => `link pressed: ${presses.get()}`}
      </span>
    </div>
  );
}
