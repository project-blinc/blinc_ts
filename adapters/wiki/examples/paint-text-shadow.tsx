import { useSheet } from '../kit.js';

const css = `
.ts-grid { flex-direction: row; flex-wrap: wrap; gap: 18px; }
.ts-tile { width: 196px; height: 92px; flex-shrink: 0; align-items: center; justify-content: center;
  border-radius: var(--radius-lg); background: var(--surface); border: 1px solid var(--border); }
.ts-tile > span:first-child { font-size: 30px; font-weight: 800; color: var(--text-primary); }
.ts-tile > .ts-label { position: absolute; left: 10px; bottom: 6px; font-size: 11px; font-family: var(--font-mono); color: var(--text-tertiary); }
.ts-hard { text-shadow: 3px 3px 0 #f59e0b; }
.ts-soft { text-shadow: 0 4px 12px rgba(99, 102, 241, 0.75); }
.ts-layers { text-shadow: 2px 2px 0 #ec4899, 4px 4px 0 #6366f1, 6px 6px 0 #0ea5e9; }
.ts-dark { background: #0b1020; border-color: #0b1020; }
.ts-dark > span:first-child { color: #ffffff; }
.ts-neon { text-shadow: 0 0 4px #ffffff, 0 0 12px #22d3ee, 0 0 24px #0ea5e9; }
.ts-emoji { font-size: 34px; text-shadow: 4px 5px 0 rgba(0, 0, 0, 0.35); }
.ts-utilities { gap: 14px; flex-direction: row; }
.ts-utilities > span { font-size: 22px; font-weight: 700; color: var(--text-primary); }
.ts-parent { text-shadow: 2px 2px 0 #ef4444; gap: 10px; flex-direction: row; font-size: 20px; font-weight: 700; }
.ts-parent > .ts-off { text-shadow: none; }
.ts-ease { transition: text-shadow var(--duration-normal) var(--ease-out); text-shadow: 0 0 0 rgba(99, 102, 241, 0); }
.ts-ease:hover { text-shadow: 6px 8px 10px rgba(99, 102, 241, 0.8); }
`;

export default function PaintTextShadow() {
  useSheet(css, 'text-shadow.css');
  const tile = (className: string, words: string, label: string, dark = false) => (
    <div class={dark ? 'ts-tile ts-dark' : 'ts-tile'}>
      <span class={className}>{words}</span>
      <span class="ts-label">{label}</span>
    </div>
  );
  return (
    <div class="wiki-col" style={{ gap: 18 }}>
      <div class="ts-grid">
        {tile('ts-hard', 'Offset', '3px 3px 0')}
        {tile('ts-soft', 'Soft', '0 4px 12px')}
        {tile('ts-layers', 'Layers', 'three, first on top')}
        {tile('ts-neon', 'Neon', 'blurred, in layers', true)}
        {tile('ts-emoji', 'Hi 👋🌈', 'emoji cast their shape')}
        {tile('ts-ease', 'Hover me', 'transition: text-shadow')}
      </div>
      <div class="ts-utilities">
        <span class="text-shadow-sm">text-shadow-sm</span>
        <span class="text-shadow-md">text-shadow-md</span>
        <span class="text-shadow-lg">text-shadow-lg</span>
      </div>
      <div class="ts-parent">
        <span>Set on the parent,</span>
        <span>inherited here,</span>
        <span class="ts-off">and none here.</span>
      </div>
    </div>
  );
}
