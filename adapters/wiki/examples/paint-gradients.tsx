import { useSheet } from '../kit.js';
import { Tile, tileCss } from './paint-kit.js';

const css = `
.g-linear { background: linear-gradient(90deg, #6366f1, #ec4899); }
.g-angle { background: linear-gradient(135deg, #f59e0b, #ef4444 50%, #7c3aed); }
.g-fade { background: linear-gradient(180deg, #0891b2, transparent); border: 1px solid var(--border); }
.g-radial { background: radial-gradient(circle at 30% 30%, #fde68a, #f97316 50%, #7f1d1d); }
.g-ellipse { background: radial-gradient(ellipse at 50% 100%, #a7f3d0, #0f766e 60%, #022c22); }
.g-wheel { background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red); }
.g-pie { background: conic-gradient(from 15deg, #6366f1 0% 40%, #ec4899 40% 75%, #f59e0b 75% 100%); }
.g-stripes { background: repeating-linear-gradient(135deg, #6366f1 0% 10%, #312e81 10% 20%); }
.g-rings { background: repeating-radial-gradient(circle, #ec4899 0% 10%, #500724 10% 20%); }
.g-sectors { background: repeating-conic-gradient(#f59e0b 0deg 30deg, #78350f 30deg 60deg); }
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
      <Tile class="g-wheel" css="conic, 7 stops" />
      <Tile class="g-pie" css="conic, hard edges" />
      <Tile class="g-stripes" css="repeating linear" />
      <Tile class="g-rings" css="repeating radial" />
      <Tile class="g-sectors" css="repeating conic" />
      <Tile class="g-mix" css="color-mix()" />
    </div>
  );
}
