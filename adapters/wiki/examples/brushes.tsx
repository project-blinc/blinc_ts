import { Brush } from 'blinc_ts/native';
import { asset } from '../assets.js';

// Paint set from code: a Brush is what CSS's backgrounds become, made once and given to
// setProperty or a style object, with no CSS text to read.
const tile = { width: 150, height: 100, flexShrink: 0, borderRadius: 16 } as const;

const brushes: [string, Brush][] = [
  ['Brush.solid', Brush.solid(0x0ea5e9)],
  [
    'Brush.linear, 3 stops',
    Brush.linear(0, 0, 1, 1, true).stop(0, 0xf59e0b).stop(0.5, 0xef4444).stop(1, 0x7c3aed),
  ],
  ['Brush.radial', Brush.radial(0.3, 0.3, 0.9, true).stop(0, 0xfde68a).stop(1, 0x0f766e)],
  ['Brush.image', Brush.image(asset('planet.webp'))],
];

export default function Brushes() {
  return (
    <div class="wiki-grid" style={{ gap: 20 }}>
      {brushes.map(([code, brush]) => (
        <div class="wiki-col" style={{ width: 150, gap: 8 }}>
          <div style={{ ...tile, background: brush }} />
          <span class="wiki-mono" style={{ width: '100%' }}>
            {code}
          </span>
        </div>
      ))}
    </div>
  );
}
