import { signal } from '#jsx/owner';
import { useSheet } from '../kit.js';

const css = `
.math-bar {
  width: clamp(64px, calc(1rem * var(--math-step)), 160px);
  height: calc(1rem + 8px);
  border-radius: min(12px, 1rem);
  background: var(--primary);
}
.math-caption { font-family: var(--font-mono); font-size: var(--text-xs); }
`;

export default function CssMath() {
  useSheet(css, 'math.css');
  const step = signal(8);
  return (
    <div class="wiki-col">
      <div class="wiki-chips">
        {[4, 8, 12].map((value) => (
          <button
            class="wiki-chip"
            data-active={() => (step.get() === value ? '' : undefined)}
            onClick={() => step.set(value)}
          >
            {`${value}rem`}
          </button>
        ))}
      </div>
      <div class="math-bar" style={{ '--math-step': () => String(step.get()) }} />
      <span class="math-caption">clamp(64px, calc(1rem * var(--math-step)), 160px)</span>
      <p>The variable changes the length; the bar stays between its two bounds.</p>
    </div>
  );
}
