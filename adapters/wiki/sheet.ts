/**
 * The wiki's own layout: a navigation column beside the page, and its examples. Like the parts'
 * sheet it says only theme tokens, bar the size of a box.
 */
import type { Layout, StyleSheet } from 'blinc_ts/native';

const STATE = 'var(--duration-fast) var(--ease-state)';
const RING = 'var(--duration-fast) var(--ease-out)';

export const wikiCss = `
.wiki { position: relative; width: 100%; height: 100%; background: var(--background); }

/* The header stays where it is while the page scrolls under it; the body leaves room for it. */
.wiki-header {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  height: var(--space-14);
  flex-direction: row;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-5);
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}
.wiki-spacer { flex: 1; }

/* The performance panel floats over the page's corner; its readouts keep their width as they change. */
.wiki-hud-toggle { font-size: var(--text-sm); }
.wiki-hud {
  position: absolute;
  right: var(--space-5);
  bottom: var(--space-5);
  width: 268px;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  font-size: var(--text-xs);
}
.wiki-hud-title { margin-bottom: var(--space-1); font-weight: var(--font-semibold); color: var(--text-primary); }
.wiki-hud-row { flex-direction: row; align-items: center; justify-content: space-between; }
.wiki-hud-label { color: var(--text-secondary); }
.wiki-hud-value { width: 140px; flex-shrink: 0; flex-direction: row; justify-content: flex-end; font-family: var(--font-mono); color: var(--text-primary); }
.wiki-body { width: 100%; height: 100%; flex-direction: row; padding-top: var(--space-14); }

.wiki-nav {
  width: 236px;
  flex-shrink: 0;
  gap: var(--space-0-5);
  padding: var(--space-2) var(--space-3) var(--space-4) var(--space-3);
  border-right: 1px solid var(--border);
  background: var(--surface);
  overflow-y: auto;
}
.wiki-brand { font-size: var(--text-lg); font-weight: var(--font-bold); letter-spacing: var(--tracking-tight); }
.wiki-tagline { font-size: var(--text-sm); color: var(--text-tertiary); }
.wiki-section { padding: var(--space-5) var(--space-2-5) var(--space-1-5) var(--space-2-5); font-size: var(--text-xs); font-weight: var(--font-bold); letter-spacing: var(--tracking-wider); color: var(--text-primary); text-transform: uppercase; }
.wiki-link {
  min-height: var(--space-8);
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: var(--space-2);
  padding: var(--space-1-5) var(--space-2-5);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-normal);
  transition: background ${STATE}, color ${STATE}, outline-width ${RING};
}
.wiki-link, .wiki-link:hover, .wiki-link:active { box-shadow: none; }
.wiki-link:hover, .wiki-link:active { background: var(--input-bg-hover); color: var(--text-primary); transform: none; }
.wiki-link[data-active] { background: var(--accent-subtle); color: var(--text-primary); font-weight: var(--font-medium); }

.wiki-main { flex: 1; min-width: 0; padding: var(--space-9) var(--space-11) var(--space-16) var(--space-11); overflow-y: auto; }
.wiki-page { width: 100%; max-width: 780px; gap: var(--space-1-5); font-size: var(--text-base); }
.wiki-page > h1 { margin: 0 0 var(--space-1) 0; font-size: var(--text-3xl); letter-spacing: var(--tracking-tight); }
.wiki-lead { margin: 0 0 var(--space-3-5) 0; font-size: var(--text-lg); color: var(--text-secondary); line-height: var(--leading-relaxed); }
.wiki-page > h2 { margin: var(--space-6) 0 var(--space-1) 0; font-size: var(--text-xl); }
.wiki-page > p { margin: var(--space-1) 0; line-height: var(--leading-relaxed); }
.wiki-note {
  margin: var(--space-2-5) 0;
  padding: var(--space-2-5) var(--space-3-5);
  border-left: 3px solid var(--info);
  border-radius: var(--radius-md);
  background: var(--info-bg);
  line-height: var(--leading-normal);
}

.wiki-example { margin: var(--space-3) 0 var(--space-2) 0; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-sm); overflow: hidden; }
.wiki-example-title { padding: var(--space-2-5) var(--space-4) 0 var(--space-4); font-size: var(--text-sm); font-weight: var(--font-semibold); color: var(--text-secondary); }
.wiki-example > .bui-tabs { gap: 0; }
.wiki-example > .bui-tabs > .bui-tabs-list { padding: 0 var(--space-2); }
.wiki-example > .bui-tabs > .bui-tabs-panel { padding: 0; }
.wiki-example > .bui-tabs > .wiki-example-preview { padding: var(--space-5); gap: var(--space-3-5); background: var(--background); align-items: flex-start; }
/* The panel scrolls the code up and down, gutter and lines together; only the lines scroll across,
   so the line numbers stay where they are. */
.wiki-example-source { max-height: 380px; overflow-x: hidden; overflow-y: auto; }

/* Code: a gutter of line numbers, and lines of tokens in the theme's colours, kept as written. */
.wiki-code {
  flex-direction: row;
  align-items: flex-start;
  align-self: stretch;
  padding: var(--space-3) 0;
  background: var(--surface);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  white-space: pre;
}
.wiki-code-gutter {
  flex-shrink: 0;
  align-items: flex-end;
  padding: 0 var(--space-3) 0 var(--space-4);
  border-right: 1px solid var(--border);
  color: var(--text-tertiary);
}
.wiki-code-lines {
  flex: 1;
  min-width: 0;
  align-items: flex-start;
  padding: 0 var(--space-4);
  color: var(--text-primary);
  overflow-x: auto;
  scrollbar-visibility: hover;
}
.wiki-code-line { flex-shrink: 0; }
.wiki-code-gutter > span, .wiki-code-line { height: var(--space-5); align-items: center; }
.wiki-code-line { flex-direction: row; }
.tok-keyword, .tok-tag { color: var(--error); }
.tok-string { color: var(--info); }
.tok-number { color: var(--warning); }
.tok-function, .tok-property { color: var(--success); }
.tok-type { font-weight: var(--font-semibold); }
.tok-comment { color: var(--text-tertiary); font-style: italic; }
.tok-punctuation { color: var(--text-secondary); }
.wiki-row { flex-direction: row; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.wiki-col { gap: var(--space-2-5); align-items: flex-start; }
.wiki-readout { padding: var(--space-1-5) var(--space-2-5); border-radius: var(--radius-md); background: var(--accent-subtle); font-family: var(--font-mono); font-size: var(--text-sm); }
.wiki-field { align-self: stretch; flex-direction: column; gap: var(--space-1); align-items: stretch; }
.wiki-field > :is(textarea, input:not([type="number"]), select) { width: 100%; }
.wiki-field > label { font-size: var(--text-sm); font-weight: var(--font-medium); }
.wiki-hint { font-size: var(--text-sm); color: var(--text-tertiary); }
.wiki-error { font-size: var(--text-sm); color: var(--error); }
/* Reference tables, and the pieces of the examples that show tokens and take input. */
.wiki-table { margin: var(--space-2) 0; align-self: stretch; font-size: var(--text-sm); }
.wiki-table th { text-align: left; color: var(--text-secondary); }
.wiki-code-input { width: 100%; min-height: 220px; font-family: var(--font-mono); font-size: var(--text-sm); }
.wiki-chips { flex-direction: row; flex-wrap: wrap; gap: var(--space-1-5); align-items: center; }
.wiki-chip {
  height: var(--space-7);
  padding: 0 var(--space-2-5);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: var(--surface);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  box-shadow: none;
}
.wiki-chip:hover { background: var(--input-bg-hover); color: var(--text-primary); }
.wiki-chip[data-active] { border-color: var(--primary); background: var(--primary); color: var(--text-inverse); }
.wiki-chip-label { width: 92px; font-size: var(--text-xs); font-weight: var(--font-semibold); color: var(--text-tertiary); }
.wiki-grid { flex-direction: row; flex-wrap: wrap; gap: var(--space-3); align-self: stretch; }
.wiki-swatch { width: 172px; gap: var(--space-1); font-size: var(--text-xs); color: var(--text-secondary); }
.wiki-swatch-fill { height: var(--space-10); border: 1px solid var(--border); border-radius: var(--radius-md); }
.wiki-mono { font-family: var(--font-mono); font-size: var(--text-xs); }
@keyframes wiki-pulse { from { opacity: 0.25; } to { opacity: 1; } }
.wiki-pulse { animation: wiki-pulse var(--duration-slowest) var(--ease-in-out) infinite alternate; }
`;

export function addWikiSheet(layout: Layout): StyleSheet {
  return layout.addStyleSheet(wikiCss, { at: 2, file: 'wiki.css' });
}
