/** A labelled tile for the paint examples: a fixed box, and the CSS it shows beneath it. */
export function Tile(props: { css: string; class?: string; children?: unknown }) {
  return (
    <div class="wiki-col" style={{ width: 150, gap: 8, flexShrink: 0 }}>
      <div class={`paint-tile ${props.class ?? ''}`}>{props.children}</div>
      <span class="wiki-mono" style={{ width: '100%' }}>
        {props.css}
      </span>
    </div>
  );
}

/** The tiles' shared look. */
export const tileCss = `
.paint-tile {
  width: 150px;
  height: 110px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-xl);
  color: #ffffff;
  font-weight: 700;
}
`;
