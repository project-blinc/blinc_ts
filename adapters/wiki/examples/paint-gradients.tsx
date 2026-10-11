import { useSheet } from '../kit.js';
import { Tile, tileCss } from './paint-kit.js';

const css = `
.g-linear { background: linear-gradient(90deg, #6366f1, #ec4899); }
.g-angle { background: linear-gradient(135deg, #f59e0b, #ef4444 50%, #7c3aed); }
.g-fade { background: linear-gradient(180deg, #0891b2, transparent); border: 1px solid var(--border); }
.g-radial { background: radial-gradient(circle at 30% 30%, #fde68a, #f97316 50%, #7f1d1d); }
.g-ellipse { background: radial-gradient(ellipse at 50% 100%, #a7f3d0, #0f766e 60%, #022c22); }
.g-mix { background: color-mix(in srgb, var(--info) 40%, var(--success)); }
`;

export default function PaintGradients() {
  useSheet(tileCss + css, 'gradients.css');
  return (
    <div class="wiki-grid" style={{ gap: 20 }}>
      <Tile class="g-linear" css="linear, 90deg" />
      <Tile class="g-angle" css="linear, 135deg, 3 stops" />
      <Tile class="g-fade" css="to transparent" />
      <Tile class="g-radial" css="radial, circle" />
      <Tile class="g-ellipse" css="radial, ellipse" />
      <Tile class="g-mix" css="color-mix()" />
    </div>
  );
}
