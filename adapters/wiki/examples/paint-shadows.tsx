import { useSheet } from '../kit.js';
import { Tile, tileCss } from './paint-kit.js';

const css = `
.s-stage { gap: 28px; padding: 28px; border-radius: var(--radius-2xl); background: #e9edf3; }
.s-tile { background: #ffffff; color: #475569; font-weight: 600; }
.s-stage .wiki-mono { color: #475569; }
.s-soft { box-shadow: 0 4px 12px -2px rgba(0, 0, 0, 0.18); }
.s-deep { box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.45); }
.s-layers { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12), 0 12px 32px -8px rgba(0, 0, 0, 0.3); }
.s-glow { background: #6366f1; color: #ffffff; box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.25), 0 10px 40px rgba(99, 102, 241, 0.6); }
.s-inset { background: var(--input-bg-hover); box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.25); }
.s-lift {
  box-shadow: var(--shadow-sm);
  transition: transform var(--duration-normal) var(--ease-spring), box-shadow var(--duration-normal) var(--ease-out);
}
.s-lift:hover { transform: translateY(-6px); box-shadow: 0 18px 36px -10px rgba(0, 0, 0, 0.4); }
`;

export default function PaintShadows() {
  useSheet(tileCss + css, 'shadows.css');
  return (
    <div class="wiki-grid s-stage">
      <Tile class="s-tile s-soft" css="soft" />
      <Tile class="s-tile s-deep" css="deep" />
      <Tile class="s-tile s-layers" css="two layers" />
      <Tile class="s-tile s-glow" css="a coloured glow" />
      <Tile class="s-tile s-inset" css="inset" />
      <Tile class="s-tile s-lift" css="the theme's sm, then a lift">
        Hover
      </Tile>
    </div>
  );
}
