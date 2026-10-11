import { useSheet } from '../kit.js';
import { Tile, tileCss } from './paint-kit.js';

const css = `
.t-tile { background: linear-gradient(135deg, #0ea5e9, #6366f1); transition: transform var(--duration-slow) var(--ease-spring); }
.t-rotate { transform: rotate(-8deg); }
.t-scale { transform: scale(0.8); }
.t-skew { transform: skewX(-12deg); }
.t-move { transform: translate(12px, -8px); }
.t-all { transform: translateY(-4px) rotate(6deg) scale(0.9); }
.t-tile:hover { transform: none; }
`;

export default function PaintTransforms() {
  useSheet(tileCss + css, 'transforms.css');
  return (
    <div class="wiki-grid" style={{ gap: 20 }}>
      <Tile class="t-tile t-rotate" css="rotate(-8deg)" />
      <Tile class="t-tile t-scale" css="scale(0.8)" />
      <Tile class="t-tile t-skew" css="skewX(-12deg)" />
      <Tile class="t-tile t-move" css="translate()" />
      <Tile class="t-tile t-all" css="three at once" />
      <Tile class="t-tile" css="hover any: it eases back">
        None
      </Tile>
    </div>
  );
}
