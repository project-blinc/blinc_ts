import { asset } from '../assets.js';
import { useSheet } from '../kit.js';

// What paint does to a photograph: filters, clips, masks and shapes, each easing back under the
// pointer.
const css = `
.fx { width: 132px; height: 132px; flex-shrink: 0; object-fit: cover; border-radius: var(--radius-xl);
  transition: filter var(--duration-slow) var(--ease-out), transform var(--duration-slow) var(--ease-spring); }
.fx:hover { filter: none; transform: scale(1.04); }
.fx-grey { filter: grayscale(1); }
.fx-sepia { filter: sepia(0.9) contrast(1.1); }
.fx-hue { filter: hue-rotate(140deg) saturate(1.6); }
.fx-blur { filter: blur(4px); }
.fx-circle { clip-path: circle(46%); }
.fx-hex { clip-path: polygon(25% 4%, 75% 4%, 100% 50%, 75% 96%, 25% 96%, 0 50%); }
.fx-fade { mask-image: linear-gradient(180deg, #000000 40%, transparent); }
.fx-squircle { border-radius: 44px; corner-shape: squircle; }
.fx-scoop { border-radius: 28px; corner-shape: scoop; }
.fx-shadow { box-shadow: 0 18px 30px -8px rgba(0, 0, 0, 0.45); }
`;

const effects = [
  ['fx-grey', 'grayscale(1)'],
  ['fx-sepia', 'sepia contrast'],
  ['fx-hue', 'hue-rotate saturate'],
  ['fx-blur', 'blur(4px)'],
  ['fx-circle', 'clip-path: circle'],
  ['fx-hex', 'clip-path: polygon'],
  ['fx-fade', 'mask-image'],
  ['fx-squircle fx-shadow', 'squircle, shadow'],
  ['fx-scoop', 'corner-shape: scoop'],
] as const;

export default function ImagesEffects() {
  useSheet(css, 'effects.css');
  return (
    <div class="wiki-grid" style={{ gap: 18 }}>
      {effects.map(([name, what], i) => (
        <div class="wiki-col" style={{ width: 132, gap: 6, alignItems: 'center' }}>
          <img class={`fx ${name}`} src={asset(i % 2 ? 'avatar.jpg' : 'album.webp')} alt="" />
          <span class="wiki-mono">{what}</span>
        </div>
      ))}
    </div>
  );
}
