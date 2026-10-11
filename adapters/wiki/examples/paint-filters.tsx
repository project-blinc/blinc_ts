import { useSheet } from '../kit.js';
import { Tile, tileCss } from './paint-kit.js';

const css = `
.f-tile { background: linear-gradient(135deg, #f59e0b, #ec4899 50%, #6366f1); transition: filter var(--duration-slow) var(--ease-out); }
.f-tile:hover { filter: none; }
.f-grey { filter: grayscale(1); }
.f-hue { filter: hue-rotate(120deg); }
.f-dim { filter: brightness(0.6) contrast(1.4); }
.f-blur { filter: blur(6px); }
.f-shadow { background: transparent; filter: drop-shadow(0 8px 10px rgba(0, 0, 0, 0.45)); }
.f-shadow > .f-shape { width: 80px; height: 80px; background: #f59e0b; clip-path: polygon(50% 0, 100% 100%, 0 100%); }
.f-mask { mask-image: linear-gradient(90deg, #000000 30%, transparent); }
`;

export default function PaintFilters() {
  useSheet(tileCss + css, 'filters.css');
  return (
    <div class="wiki-grid" style={{ gap: 20 }}>
      <Tile class="f-tile f-grey" css="grayscale(1)" />
      <Tile class="f-tile f-hue" css="hue-rotate(120deg)" />
      <Tile class="f-tile f-dim" css="brightness contrast" />
      <Tile class="f-tile f-blur" css="blur(6px)" />
      <Tile class="f-shadow" css="drop-shadow()">
        <div class="f-shape" />
      </Tile>
      <Tile class="f-tile f-mask" css="mask-image" />
    </div>
  );
}
