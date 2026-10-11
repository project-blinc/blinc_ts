/**
 * The wiki's own layout: a navigation column beside the page, and its examples. Like the parts'
 * sheet it says only theme tokens, bar the size of a box.
 */
import type { Layout, StyleSheet } from 'blinc_ts/native';

const STATE = 'var(--duration-fast) var(--ease-state)';
const RING = 'var(--duration-fast) var(--ease-out)';

export const wikiCss = `
.wiki { width: 100%; height: 100%; flex-direction: row; background: var(--background); }

.wiki-nav {
  width: 236px;
  flex-shrink: 0;
  gap: var(--space-0-5);
  padding: var(--space-4) var(--space-3);
  border-right: 1px solid var(--border);
  background: var(--surface);
  overflow-y: auto;
}
.wiki-brand { padding: var(--space-1) var(--space-2-5) var(--space-0-5) var(--space-2-5); font-size: var(--text-lg); font-weight: var(--font-bold); }
.wiki-tagline { padding: 0 var(--space-2-5) var(--space-2-5) var(--space-2-5); font-size: var(--text-sm); color: var(--text-tertiary); }
.wiki-section { padding: var(--space-4) var(--space-2-5) var(--space-1) var(--space-2-5); font-size: var(--text-xs); font-weight: var(--font-semibold); color: var(--text-tertiary); }
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
  font-weight: var(--font-medium);
  transition: background ${STATE}, color ${STATE}, outline-width ${RING};
}
.wiki-link, .wiki-link:hover, .wiki-link:active { box-shadow: none; }
.wiki-link:hover, .wiki-link:active { background: var(--input-bg-hover); color: var(--text-primary); transform: none; }
.wiki-link[data-active] { background: var(--accent-subtle); color: var(--text-primary); }
.wiki-scheme { flex-direction: row; align-items: center; gap: var(--space-2-5); padding: var(--space-4) var(--space-2-5) 0 var(--space-2-5); color: var(--text-secondary); font-size: var(--text-sm); }

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
.wiki-example-source { max-height: 340px; overflow-y: auto; }
.wiki-example-source > pre { margin: 0; border: 0; border-radius: var(--radius-none); font-size: var(--text-sm); }
.wiki-row { flex-direction: row; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.wiki-col { gap: var(--space-2-5); align-items: flex-start; }
.wiki-readout { padding: var(--space-1-5) var(--space-2-5); border-radius: var(--radius-md); background: var(--accent-subtle); font-family: var(--font-mono); font-size: var(--text-sm); }
.wiki-field { gap: var(--space-1); align-items: stretch; }
.wiki-field > label { font-size: var(--text-sm); font-weight: var(--font-medium); }
.wiki-hint { font-size: var(--text-sm); color: var(--text-tertiary); }
.wiki-error { font-size: var(--text-sm); color: var(--error); }
@keyframes wiki-pulse { from { opacity: 0.25; } to { opacity: 1; } }
.wiki-pulse { animation: wiki-pulse var(--duration-slowest) var(--ease-in-out) infinite alternate; }
`;

export function addWikiSheet(layout: Layout): StyleSheet {
  return layout.addStyleSheet(wikiCss, { at: 2, file: 'wiki.css' });
}
