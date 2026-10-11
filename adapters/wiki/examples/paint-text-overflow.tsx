import { signal } from '#jsx/owner';
import { useSheet } from '../kit.js';

const css = `
.to-col { gap: 18px; }
.to-box { flex-shrink: 0; overflow: hidden; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-lg);
  background: var(--surface); transition: width var(--duration-normal) var(--ease-out); }
.to-line { white-space: nowrap; text-overflow: ellipsis; }
.to-two { line-clamp: 2; flex-direction: column; }
.to-three { line-clamp: 3; flex-direction: column; }
.to-label { font-size: 11px; font-family: var(--font-mono); color: var(--text-tertiary); }
`;

const text =
  'Liquid glass bends what is behind it, most at its rim, and a long title has to end somewhere: the line runs out of room and says so.';

const widths = [180, 280, 420] as const;

export default function PaintTextOverflow() {
  useSheet(css, 'text-overflow.css');
  const width = signal<(typeof widths)[number]>(280);
  return (
    <div class="wiki-col to-col">
      <div class="wiki-chips">
        {widths.map((w) => (
          <button
            class="wiki-chip"
            data-active={() => (width.get() === w ? '' : undefined)}
            onClick={() => width.set(w)}
          >
            {`${w}px wide`}
          </button>
        ))}
      </div>
      <span class="to-label">text-overflow: ellipsis, on one line</span>
      <div class="to-box to-line" style={{ width: () => width.get() }}>
        {text}
      </div>
      <span class="to-label">line-clamp: 2</span>
      <div class="to-box to-two" style={{ width: () => width.get() }}>
        {text}
      </div>
      <span class="to-label">line-clamp: 3</span>
      <div class="to-box to-three" style={{ width: () => width.get() }}>
        {text}
      </div>
    </div>
  );
}
