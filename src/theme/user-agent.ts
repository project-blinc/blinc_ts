/**
 * Default looks for built-in elements, as a browser's own stylesheet gives
 * HTML elements theirs: headings, paragraphs, code, quotations, rules, links,
 * buttons, labels and fieldsets. Everything it uses is a theme variable, so
 * the sheet is the same for every theme and a theme change restyles through
 * the cascade. It goes under every other sheet, so an app's rules, utility
 * classes and inline properties win over it. Importing this module is
 * optional; an app that does not pays nothing for it.
 *
 * Colours, radii and shadows come from the theme; the type metrics have
 * fallbacks, since an unresolved one stops layout. It only declares what the
 * host applies. Tags are flex rows by default, so
 * containers that stack their children are set to columns here, and margins
 * are half a browser's because flex siblings do not collapse them.
 */
import type { Layout, StyleSheet } from '../native/layout.js';

const containers =
  'div, section, header, footer, nav, main, article, aside, form, fieldset, ul, ol, dl, blockquote, pre, figure, details, table, thead, tbody, tfoot, dialog';
const flows =
  'p, h1, h2, h3, h4, h5, h6, span, a, strong, b, em, i, small, code, kbd, mark, legend, figcaption, dt, dd';

const css = `
:root {
  background: var(--background);
  color: var(--text-primary);
  font-family: var(--font-sans, system-ui, sans-serif);
  font-size: var(--text-base, 16px);
  line-height: var(--leading-normal, 1.5);
}

${containers} { flex-direction: column; }
${flows} { flex-direction: row; flex-wrap: wrap; align-items: baseline; }
p, h1, h2, h3, h4, h5, h6, dt, dd, legend, figcaption { max-width: 100%; min-width: 0; }

h1, h2, h3, h4, h5, h6 { font-weight: 700; }
h1 { font-size: 2em; margin: 0.34em 0; }
h2 { font-size: 1.5em; margin: 0.42em 0; }
h3 { font-size: 1.17em; margin: 0.5em 0; }
h4 { font-size: 1em; margin: 0.67em 0; }
h5 { font-size: 0.83em; margin: 0.84em 0; }
h6 { font-size: 0.67em; margin: 1.17em 0; }
p { margin: 0.5em 0; }
strong, b { font-weight: 700; }
em, i { font-style: italic; }
small { font-size: 0.83em; }
code, kbd {
  font-family: var(--font-mono, monospace);
  font-size: 0.9em;
  padding: 1px 4px;
  border-radius: var(--radius-sm);
  background: var(--accent-subtle);
}
kbd { border: 1px solid var(--border); }
mark { background: var(--warning-bg); }

pre {
  margin: 0.5em 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-default);
  font-family: var(--font-mono, monospace);
  font-size: 0.9em;
  white-space: pre;
  background: var(--surface);
  overflow: auto;
}
pre > code { padding: 0; background: transparent; font-size: 1em; }
blockquote {
  margin: 0.5em 0;
  padding: 2px 0 2px 14px;
  border-left: 3px solid var(--border);
  color: var(--text-secondary);
}
figure { gap: 6px; margin: 0.5em 0; }
figcaption { font-size: 0.9em; color: var(--text-secondary); }
ul, ol, dl { gap: 2px; margin: 0.5em 0; }
li { flex-direction: row; align-items: flex-start; }
dt { font-weight: 600; }
dd { margin: 0 0 6px 24px; color: var(--text-secondary); }
hr { height: 1px; flex-shrink: 0; align-self: stretch; margin: 8px 0; background: var(--border); }

a { color: var(--text-link); border-radius: var(--radius-sm); cursor: pointer; }
a:hover { opacity: 0.8; }
a:active { opacity: 0.65; }
a:focus-visible, button:focus-visible { outline: 3px solid var(--focus-ring); outline-offset: 2px; }

button {
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: var(--radius-md);
  background: var(--primary);
  color: var(--text-inverse);
  font-weight: 500;
  cursor: pointer;
}
button:hover { background: var(--primary-hover); }
button:active { background: var(--primary-active); }
button:disabled { opacity: 0.5; cursor: default; }

label { flex-direction: row; align-items: center; gap: 8px; }
fieldset {
  gap: 8px;
  margin: 0;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-default);
}
legend { padding: 0 2px; font-weight: 600; }
`;

/** The user-agent stylesheet's text, for `Layout.addStyleSheet` or a build step. */
export function userAgentCss(): string {
  return css;
}

/**
 * Add the user-agent sheet to `layout`, first among its sheets so every other
 * rule of equal specificity wins. Returns the sheet, for `removeStyleSheet`.
 */
export function addUserAgent(layout: Layout): StyleSheet {
  return layout.addStyleSheet(css, { at: 0, file: 'user-agent.css' });
}
