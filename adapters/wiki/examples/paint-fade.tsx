import { useSheet } from '../kit.js';

const css = `
.fade-list {
  width: 320px;
  height: 220px;
  flex-shrink: 0;
  overflow-y: auto;
  overflow-fade: 36px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--surface);
}
.fade-item { flex-shrink: 0; padding: 10px 16px; border-bottom: 1px solid var(--border); }
`;

export default function PaintFade() {
  useSheet(css, 'fade.css');
  return (
    <div class="wiki-row" style={{ alignItems: 'flex-start', gap: 24 }}>
      <div class="fade-list">
        {Array.from({ length: 24 }, (_, i) => (
          <div class="fade-item">{`Row ${i + 1}: scroll, and the edges fade`}</div>
        ))}
      </div>
      <span class="wiki-hint" style={{ width: 260 }}>
        overflow-fade: 36px 0 fades the top and bottom 36 pixels of what a clipping box holds to
        nothing, as it scrolls under them.
      </span>
    </div>
  );
}
