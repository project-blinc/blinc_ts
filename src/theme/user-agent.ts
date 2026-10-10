/**
 * Default looks for built-in elements, as a browser's own stylesheet gives
 * HTML elements theirs. Everything it uses is a theme variable, so the sheet
 * is the same for every theme and a theme change restyles through the
 * cascade. It goes under every other sheet, so an app's rules, utility
 * classes and inline properties win over it. Importing this module is
 * optional; an app that does not pays nothing for it.
 *
 * Every change an interactive element shows eases over the theme's motion
 * tokens rather than jumping:
 *
 * - colour and border changes on hover and press: `--duration-fast`, `--ease-state`;
 * - a focus ring grows out from the element, a small gap from its border:
 *   an outline of no width in `--focus-ring`, 2px out, widens over
 *   `--duration-fast`, `--ease-out`;
 * - a press shrinks a control a little, over `--duration-faster`;
 * - a check mark or a radio's dot scales in with `--ease-spring`;
 * - a dialog grows in and shrinks away on `--ease-sheet`; a list or the
 *   rest of an open `details` slides in. What is going is marked `[closing]`
 *   and kept until `animationsFinished()` resolves.
 *
 * Control states the host does not track (`:checked`, `:indeterminate`,
 * `:user-invalid`) are given by the component with `element.setState`. The
 * parts of a control the host makes itself (a list item's `.marker`, a
 * summary's `.marker`, a progress or meter's `.bar`) are owned elements; those
 * of the controls it does not (a range's `.fill`, `.rest` and `.thumb`, a
 * checkbox's `.check` and `.dash`, a radio's `.dot`) are children the
 * component supplies.
 *
 * Type metrics have fallbacks, since an unresolved one stops layout. It only
 * declares what has an effect. Tags are flex rows by default, so containers that stack their
 * children are set to columns here, and margins are half a browser's
 * because flex siblings do not collapse them.
 */
import type { Layout, StyleSheet } from '../native/layout.js';

const containers =
  'div, section, header, footer, nav, main, article, aside, form, fieldset, ul, ol, dl, blockquote, pre, figure, details, table, thead, tbody, tfoot, dialog, listbox, textarea';
const flows =
  'p, h1, h2, h3, h4, h5, h6, span, a, strong, b, em, i, s, u, small, code, kbd, mark, output, legend, figcaption, caption, dt, dd, th, td';
const fields =
  'input:is([type="text"], [type="password"], [type="search"], [type="email"], [type="tel"], [type="url"], [type="number"])';
const ticks = 'input:is([type="checkbox"], [type="radio"])';

/** Colours and borders easing between states. */
const STATE = 'var(--duration-fast) var(--ease-state)';
/** A focus ring growing out. */
const RING = 'var(--duration-fast) var(--ease-out)';
/** A press, quicker than a hover. */
const PRESS = 'var(--duration-faster) var(--ease-state)';
/** A mark appearing, with the theme's overshoot if it has one. */
const POP = 'var(--duration-fast) var(--ease-spring)';
/** An overlay opening, and going. */
const ENTER = 'var(--duration-fast) var(--ease-sheet)';
const EXIT = 'var(--duration-faster) var(--ease-sheet) forwards';

const css = `
:root {
  background: var(--background);
  color: var(--text-primary);
  font-family: var(--font-sans, system-ui, sans-serif);
  font-size: var(--text-base, 16px);
  line-height: var(--leading-normal, 1.5);
}

${containers}, li { flex-direction: column; }
${flows} { flex-direction: row; flex-wrap: wrap; align-items: baseline; }
p, h1, h2, h3, h4, h5, h6, dt, dd, legend, figcaption, caption { max-width: 100%; min-width: 0; }

/* A scroll container's thumb, in the theme's quiet text colour. */
${containers}, listbox, textarea { scrollbar-color: color-mix(in srgb, var(--text-tertiary) 55%, transparent) transparent; }

/* Text. */
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
u, ins { text-decoration: underline; }
s, del { text-decoration: line-through; }
abbr[title] { text-decoration: underline dotted; }

/* Preformatted text and quotations. */
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
blockquote > p { margin: 0.25em 0; }
figure { gap: 6px; margin: 0.5em 0; }
figcaption { font-size: 0.9em; color: var(--text-secondary); }

/* Lists and descriptions; a list inside an item sits under the item's text. */
ul, ol, dl { gap: 2px; margin: 0.5em 0; }
li { position: relative; padding-left: 32px; }
li > .marker {
  position: absolute;
  left: 0;
  top: 0;
  width: 32px;
  padding-right: 8px;
  flex-direction: row;
  justify-content: flex-end;
  color: var(--text-secondary);
}
li > .marker:not(.number) { padding-top: 0.6em; }
li > .marker > .bullet { width: 0.35em; height: 0.35em; flex-shrink: 0; }
li > .marker.disc > .bullet { border-radius: var(--radius-full); background: var(--text-secondary); }
li > .marker.circle > .bullet {
  border-radius: var(--radius-full);
  border: 1.5px solid var(--text-secondary);
}
li > .marker.square > .bullet { width: 0.3em; height: 0.3em; background: var(--text-secondary); }
li ul, li ol { margin: 2px 0 0 0; }
dt { font-weight: 600; }
dd { margin: 0 0 6px 24px; color: var(--text-secondary); }
hr { height: 1px; flex-shrink: 0; align-self: stretch; margin: 8px 0; background: var(--border); }

/* Tables: every row is a grid of the table's columns, set by the host, so they line up. */
table {
  border: 1px solid var(--border);
  border-radius: var(--radius-default);
  overflow: hidden;
}
caption { padding: 8px 12px; font-weight: 600; border-bottom: 1px solid var(--border); }
thead, tfoot { background: var(--surface); }
tr { display: grid; }
tr + tr, thead + tbody, tbody + tbody, tbody + tfoot, thead + tfoot { border-top: 1px solid var(--border); }
th, td { min-width: 0; padding: 8px 12px; }
th { font-weight: 600; }
col, colgroup { display: none; }

/* Focus rings: an outline of no width at rest, a small gap out from the border, growing out to show focus. */
a, button, input, textarea, select, summary { outline: 0 solid var(--focus-ring); outline-offset: 2px; }
a:focus-visible, button:focus-visible, summary:focus-visible, select:focus-visible,
input:is([type="checkbox"], [type="radio"], [type="range"]):focus-visible { outline-width: 3px; }

/* Links. */
a {
  color: var(--text-link);
  text-decoration: underline;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: opacity ${STATE}, outline-width ${RING};
}
a:hover { opacity: 0.8; }
a:active { opacity: 0.65; }

/* Buttons: a press shrinks them a little. */
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
  transition: background ${STATE}, opacity ${STATE}, transform ${PRESS}, outline-width ${RING};
}
button:hover { background: var(--primary-hover); }
button:active { background: var(--primary-active); transform: scale(0.97); }
button:disabled { opacity: 0.5; transform: none; cursor: default; }

/* Checkboxes and radios: a box, its mark scaling in while it is checked. */
${ticks} {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--border);
  background: var(--input-bg);
  cursor: pointer;
  transition: background ${STATE}, border-color ${STATE}, transform ${PRESS}, outline-width ${RING};
}
input[type="checkbox"] { border-radius: var(--radius-sm); color: var(--text-inverse); }
input[type="radio"] { border-radius: var(--radius-full); }
${ticks}:hover { border-color: var(--border-hover); }
${ticks}:active { transform: scale(0.92); }
input[type="checkbox"]:is(:checked, :indeterminate) { background: var(--primary); border-color: var(--primary); }
input[type="checkbox"]:is(:checked, :indeterminate):hover { background: var(--primary-hover); border-color: var(--primary-hover); }
input[type="radio"]:checked { border-color: var(--primary); }
input[type="checkbox"] > :is(.check, .dash) {
  position: absolute;
  opacity: 0;
  transform: scale(0.4);
  transition: opacity ${STATE}, transform ${POP};
}
input[type="checkbox"]:checked:not(:indeterminate) > .check,
input[type="checkbox"]:indeterminate > .dash { opacity: 1; transform: scale(1); }
input[type="radio"] > .dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--primary);
  transform: scale(0);
  transition: transform ${POP};
}
input[type="radio"]:checked > .dot { transform: scale(1); }
input:is([type="checkbox"], [type="radio"], [type="range"]):disabled { opacity: 0.5; transform: none; cursor: default; }

/* Text fields and text areas: a bordered box the text is edited in; focus grows a ring out from it. */
${fields}, textarea {
  border: 2px solid var(--border);
  border-radius: var(--radius-default);
  background: var(--input-bg);
  color: var(--text-primary);
  cursor: text;
  transition: background ${STATE}, border-color ${STATE}, outline-width ${RING};
}
${fields} { flex-direction: row; align-items: center; width: 240px; height: 38px; padding: 0 10px; }
textarea { min-height: 76px; padding: 8px 10px; }
${fields}:hover, textarea:hover { background: var(--input-bg-hover); border-color: var(--border-hover); }
${fields}:focus, textarea:focus { background: var(--input-bg-focus); border-color: var(--border-focus); outline-width: 3px; }
${fields}:disabled, textarea:disabled { background: var(--input-bg-disabled); border-color: var(--border); cursor: default; }
${fields}:user-invalid, textarea:user-invalid, ${ticks}:user-invalid {
  border-color: var(--border-error);
  outline-color: var(--focus-ring-error);
}
input[type="number"] { width: 120px; padding-right: 2px; }
input[type="number"] > .steppers { flex-direction: column; flex-shrink: 0; margin-left: 4px; }
input[type="number"] > .steppers > div {
  width: 20px;
  height: 14px;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background ${STATE}, color ${STATE}, transform ${PRESS};
}
input[type="number"] > .steppers > div:hover { background: var(--accent-subtle); color: var(--text-primary); }
input[type="number"] > .steppers > div:active { transform: scale(0.85); }

/* Ranges: a track, filled up to the thumb, which grows under the pointer. */
input[type="range"] {
  flex-direction: row;
  align-items: center;
  width: 160px;
  height: 20px;
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: outline-width ${RING};
}
input[type="range"] > :is(.fill, .rest) { flex-basis: 0; min-width: 0; height: 4px; }
input[type="range"] > .fill { border-radius: var(--radius-full) 0 0 var(--radius-full); background: var(--primary); }
input[type="range"] > .rest { border-radius: 0 var(--radius-full) var(--radius-full) 0; background: var(--border); }
input[type="range"] > .thumb {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--surface-elevated);
  border: 2px solid var(--primary);
  box-shadow: var(--shadow-sm);
  transition: transform ${STATE}, box-shadow ${STATE}, border-color ${STATE};
}
input[type="range"]:hover > .thumb { transform: scale(1.1); box-shadow: var(--shadow-md); border-color: var(--primary-hover); }
input[type="range"]:active > .thumb { transform: scale(1.2); }
input[type="range"][data-orientation="vertical"] { flex-direction: column-reverse; width: 20px; height: 160px; }
input[type="range"][data-orientation="vertical"] > :is(.fill, .rest) { width: 4px; height: auto; min-height: 0; }
input[type="range"][data-orientation="vertical"] > .fill { border-radius: 0 0 var(--radius-full) var(--radius-full); }
input[type="range"][data-orientation="vertical"] > .rest { border-radius: var(--radius-full) var(--radius-full) 0 0; }

/* Progress and meters: a track, filled to the value, easing to a new one. */
progress, meter {
  flex-direction: row;
  width: 160px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--border);
  overflow: hidden;
}
progress > .bar, meter > .bar {
  height: 100%;
  border-radius: var(--radius-full);
  transition: width var(--duration-normal) var(--ease-out), background ${STATE};
}
progress > .bar { background: var(--primary); }
progress:indeterminate > .bar {
  width: 30%;
  animation: blinc-pulse var(--duration-slowest) var(--ease-in-out) infinite alternate;
}
meter > .optimum { background: var(--success); }
meter > .suboptimum { background: var(--warning); }
meter > .even-less-good { background: var(--error); }

/* Forms, fieldsets and labels. */
form { align-items: flex-start; }
fieldset {
  gap: 8px;
  margin: 0;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-default);
}
legend { padding: 0 2px; font-weight: 600; }
label { flex-direction: row; align-items: center; gap: 8px; }

/* Selects: the control, its list of options, the options and their group headings. */
select {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 120px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-default);
  background: var(--input-bg);
  color: var(--text-primary);
  cursor: pointer;
  transition: background ${STATE}, border-color ${STATE}, transform ${PRESS}, outline-width ${RING};
}
select > :is(option, optgroup) { display: none; }
select:hover { border-color: var(--border-hover); }
select:active { transform: scale(0.98); }
select[open] { border-color: var(--border-focus); }
select:disabled { opacity: 0.5; transform: none; cursor: default; }
select[data-placeholder] { color: var(--text-tertiary); }
select > .chevron { color: var(--text-secondary); transition: transform var(--duration-normal) var(--ease-state); }
select[open] > .chevron { transform: rotate(180deg); }
listbox {
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-default);
  background: var(--surface-elevated);
  box-shadow: var(--shadow-lg);
  overflow-y: auto;
  animation: blinc-list-in ${ENTER};
}
listbox[closing] { animation: blinc-list-out ${EXIT}; }
option {
  flex-direction: row;
  align-items: center;
  padding: 6px 10px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background ${STATE};
}
option:hover, option:focus { background: var(--accent-subtle); }
option:checked { font-weight: 600; }
option:disabled { opacity: 0.5; cursor: default; }
optgroup { padding: 6px 10px 2px 10px; font-size: 0.8em; font-weight: 600; color: var(--text-secondary); }

/* What sits under an overlay: dimmed, fading in, and out as it closes. */
backdrop { background: var(--surface-overlay); animation: blinc-fade-in ${ENTER}; }
backdrop[closing] { animation: blinc-fade-out ${EXIT}; }

/* Dialogs: a panel, growing in from nothing and shrinking away. */
dialog {
  gap: 12px;
  padding: 20px;
  min-width: 280px;
  border-radius: var(--radius-xl);
  background: var(--surface-elevated);
  box-shadow: var(--shadow-2xl);
}
dialog[open] { animation: blinc-grow-in ${ENTER}; }
dialog[closing] { animation: blinc-shrink-out ${EXIT}; }
dialog:not([open]):not([closing]) { display: none; }

/* Details: a summary that opens and closes the rest, its marker turning. */
details { gap: 6px; }
summary {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: opacity ${STATE}, outline-width ${RING};
}
summary:hover { opacity: 0.8; }
summary > .marker {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-right: 1.5px solid var(--text-secondary);
  border-bottom: 1.5px solid var(--text-secondary);
  transform: rotate(-45deg);
  transition: transform var(--duration-normal) var(--ease-state);
}
details[open] > summary > .marker { transform: rotate(45deg); }
details:not([open]) > :not(summary) { display: none; }
details[open] > :not(summary) { animation: blinc-list-in ${ENTER}; }

@keyframes blinc-pulse { from { opacity: 0.35; } to { opacity: 1; } }
@keyframes blinc-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes blinc-fade-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes blinc-list-in { from { opacity: 0; transform: translateY(-4px) scale(0.96); } to { opacity: 1; transform: none; } }
@keyframes blinc-list-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(-4px) scale(0.96); } }
@keyframes blinc-grow-in { from { opacity: 0; transform: scale(0); } to { opacity: 1; transform: scale(1); } }
@keyframes blinc-shrink-out { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0); } }
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
