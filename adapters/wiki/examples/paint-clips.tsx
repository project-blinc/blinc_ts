import { useSheet } from '../kit.js';
import { Tile, tileCss } from './paint-kit.js';

const css = `
.c-tile { background: linear-gradient(135deg, #22c55e, #0ea5e9); }
.c-circle { clip-path: circle(40%); transition: clip-path var(--duration-slow) var(--ease-spring); }
.c-circle:hover { clip-path: circle(70%); }
.c-ellipse { clip-path: ellipse(48% 34%); }
.c-inset { clip-path: inset(14px 20px round 18px); }
.c-star { clip-path: polygon(50% 2%, 61% 36%, 98% 36%, 68% 57%, 79% 92%, 50% 71%, 21% 92%, 32% 57%, 2% 36%, 39% 36%); }
.c-heart {
  clip-path: path('M75 100 C 30 70, 5 45, 25 22 C 40 6, 65 12, 75 32 C 85 12, 110 6, 125 22 C 145 45, 120 70, 75 100 Z');
}
.c-ring { clip-path: path(evenodd, 'M75 10 A 45 45 0 1 1 74.9 10 Z M75 35 A 20 20 0 1 0 75.1 35 Z'); }
`;

export default function PaintClips() {
  useSheet(tileCss + css, 'clips.css');
  return (
    <div class="wiki-grid" style={{ gap: 20 }}>
      <Tile class="c-tile c-circle" css="circle, hover me" />
      <Tile class="c-tile c-ellipse" css="ellipse()" />
      <Tile class="c-tile c-inset" css="inset(round)" />
      <Tile class="c-tile c-star" css="polygon(…)" />
      <Tile class="c-tile c-heart" css="path()" />
      <Tile class="c-tile c-ring" css="path(evenodd)" />
    </div>
  );
}
