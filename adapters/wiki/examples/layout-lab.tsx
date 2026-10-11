import { signal } from '#jsx/owner';
import { useSheet } from '../kit.js';

// Flexbox and grid, one property at a time, on boxes of different sizes in a stage that does not
// change size, so only the boxes move.
const css = `
.lab-stage { width: 460px; height: 240px; flex-shrink: 0; padding: 12px; border: 1px dashed var(--border-hover);
  border-radius: var(--radius-lg); background: var(--surface); }
.lab-item { min-width: 44px; min-height: 36px; align-items: center; justify-content: center; border-radius: var(--radius-md);
  color: #ffffff; font-weight: 700; }
.lab-controls { width: 300px; flex-shrink: 0; gap: 10px; }
`;

const choices = {
  display: ['flex', 'grid'],
  'flex-direction': ['row', 'column', 'row-reverse'],
  'flex-wrap': ['nowrap', 'wrap'],
  'justify-content': ['flex-start', 'center', 'space-between', 'space-evenly'],
  'align-items': ['stretch', 'flex-start', 'center', 'flex-end'],
  gap: ['0px', '8px', '20px'],
  'grid-template-columns': ['1fr 1fr 1fr', 'auto 1fr', '80px repeat(3, 1fr)'],
} as const;
type Name = keyof typeof choices;

const items: [number, number, string][] = [
  [60, 40, '#6366f1'],
  [90, 56, '#ec4899'],
  [50, 70, '#f59e0b'],
  [120, 40, '#10b981'],
  [70, 50, '#0ea5e9'],
  [80, 36, '#8b5cf6'],
];

export default function LayoutLab() {
  useSheet(css, 'layout-lab.css');
  const chosen = Object.fromEntries(
    Object.entries(choices).map(([name, values]) => [name, signal<string>(values[0])]),
  ) as Record<Name, ReturnType<typeof signal<string>>>;
  const shown = (name: Name) =>
    name === 'display' ||
    name === 'gap' ||
    name === 'justify-content' ||
    name === 'align-items' ||
    (name === 'grid-template-columns') === (chosen.display.get() === 'grid');
  return (
    <div class="wiki-row" style={{ alignItems: 'flex-start', gap: 20, flexWrap: 'nowrap' }}>
      <div
        class="lab-stage"
        style={{
          display: chosen.display,
          flexDirection: chosen['flex-direction'],
          flexWrap: chosen['flex-wrap'],
          justifyContent: chosen['justify-content'],
          alignItems: chosen['align-items'],
          gap: chosen.gap,
          gridTemplateColumns: chosen['grid-template-columns'],
        }}
      >
        {items.map(([w, h, colour], i) => (
          <div class="lab-item" style={{ width: w, height: h, background: colour }}>
            {String(i + 1)}
          </div>
        ))}
      </div>
      <div class="lab-controls">
        {(Object.keys(choices) as Name[]).map((name) => (
          <div class="wiki-col" style={{ gap: 4, opacity: () => (shown(name) ? 1 : 0.35) }}>
            <span class="wiki-mono">{name}</span>
            <div class="wiki-chips">
              {choices[name].map((value) => (
                <button
                  class="wiki-chip"
                  data-active={() => (chosen[name].get() === value ? '' : undefined)}
                  onClick={() => chosen[name].set(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
