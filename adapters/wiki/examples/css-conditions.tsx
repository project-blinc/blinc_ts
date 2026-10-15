import { signal } from '#jsx/owner';
import { useSheet } from '../kit.js';

const css = `
.condition-container {
  container: example-card / inline-size;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
}
.condition-card { width: 100%; flex-direction: column; gap: 8px; }
.condition-part { width: 100px; height: 36px; border-radius: 6px; background: var(--primary); }
.condition-part-alt { background: var(--success); }
.condition-feature { color: var(--text-secondary); font-family: var(--font-mono); font-size: var(--text-xs); }
@supports (display: flex) and (width: calc(100% - 1rem)) {
  .condition-feature { color: var(--text-primary); }
}
@container example-card (width > 280px) {
  .condition-card { flex-direction: row; }
}
`;

export default function CssConditions() {
  useSheet(css, 'conditions.css');
  const width = signal(240);
  return (
    <div class="wiki-col">
      <div class="wiki-chips">
        {[240, 360].map((value) => (
          <button
            class="wiki-chip"
            data-active={() => (width.get() === value ? '' : undefined)}
            onClick={() => width.set(value)}
          >
            {`${value}px container`}
          </button>
        ))}
      </div>
      <div class="condition-container" style={{ width: () => `${width.get()}px` }}>
        <div class="condition-card">
          <div class="condition-part" />
          <div class="condition-part condition-part-alt" />
        </div>
      </div>
      <span class="condition-feature">
        @supports (display: flex) and (width: calc(100% - 1rem))
      </span>
      <p>
        The card changes direction above 280px of container content width. The viewport stays the
        same.
      </p>
    </div>
  );
}
