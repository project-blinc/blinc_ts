import { useSheet } from '../kit.js';
import { Tile, tileCss } from './paint-kit.js';

const css = `
.b-plain { background: var(--surface); color: var(--text-primary); border: 2px solid var(--border-hover); }
.b-sides {
  background: var(--surface);
  color: var(--text-primary);
  border-width: 2px 8px 2px 8px;
  border-style: solid;
  border-color: var(--border) #6366f1 var(--border) #ec4899;
}
.b-corners { background: #0f172a; border-radius: 4px 40px 4px 40px; }
.b-pill { background: #16a34a; border-radius: 9999px; height: 56px; }
.b-outline {
  background: var(--surface);
  color: var(--text-primary);
  border: 1px solid var(--border);
  outline: 2px solid #6366f1;
  outline-offset: 0px;
  transition: outline-offset var(--duration-normal) var(--ease-spring), outline-width var(--duration-normal) var(--ease-out);
}
.b-outline:hover { outline-offset: 6px; outline-width: 4px; }
.b-thick { background: #fef3c7; color: #92400e; border: 6px solid #f59e0b; border-radius: 28px; }
.b-dashed { background: var(--surface); color: var(--text-primary); border: 3px dashed #6366f1; border-radius: 20px; }
.b-dotted { background: var(--surface); color: var(--text-primary); border: 3px dotted #ec4899; border-radius: 20px; }
.b-patterns { background: var(--surface); color: var(--text-primary); border: 3px solid #16a34a; border-style: dashed dotted solid none; border-radius: 12px; }
`;

export default function PaintBorders() {
  useSheet(tileCss + css, 'borders.css');
  return (
    <div class="wiki-grid" style={{ gap: 20 }}>
      <Tile class="b-plain" css="border: 2px solid" />
      <Tile class="b-sides" css="per side" />
      <Tile class="b-corners" css="radius per corner" />
      <Tile class="b-pill" css="a pill" />
      <Tile class="b-outline" css="outline, hover me">
        Hover
      </Tile>
      <Tile class="b-thick" css="6px, rounded" />
      <Tile class="b-dashed" css="dashed, rounded" />
      <Tile class="b-dotted" css="dotted, rounded" />
      <Tile class="b-patterns" css="style per side" />
    </div>
  );
}
