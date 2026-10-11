/**
 * What the Base UI parts look like. A part draws nothing of its own: it has a class, and what
 * state it is in is a `data-` attribute, which this sheet styles. Everything it says is a theme
 * token: colours, spacing, type, shadows and motion, and shape through the radius tokens, so
 * the theme's corner smoothing reaches every part and the sheet never sets a corner of its own.
 * Shadows are the theme's tokens too, as a surface of its own stands on one: an outline button
 * on `shadow-sm`, a knob, an accordion and a popover on `shadow-md`, a dialog on `shadow-xl`;
 * what is flat has none. Only the size of a box, which has no token, is written as a length. It goes over the
 * user-agent sheet and under the app's own, so an app restyles any part by its class or attribute.
 */
import type { Layout, StyleSheet } from 'blinc_ts/native';

const STATE = 'var(--duration-fast) var(--ease-state)';
const RING = 'var(--duration-fast) var(--ease-out)';
const PRESS = 'var(--duration-faster) var(--ease-state)';
const ENTER = 'var(--duration-fast) var(--ease-sheet)';
const EXIT = 'var(--duration-faster) var(--ease-sheet) forwards';
const MOVE = 'var(--duration-normal) var(--ease-state)';
const POP = 'var(--duration-fast) var(--ease-spring)';

/** Buttons that show no fill of their own: a toggle, and what opens or closes something. */
const plain = [
  '.bui-toggle',
  '.bui-tooltip-trigger',
  '.bui-popover-trigger',
  '.bui-dialog-trigger',
  '.bui-popover-close',
  '.bui-dialog-close',
];
const each = (suffix: string): string => plain.map((s) => s + suffix).join(', ');
/** Buttons that are only a place to press: a track, a box, a tab, a row. */
const flat = ['.bui-switch', '.bui-checkbox', '.bui-tabs-tab', '.bui-accordion-trigger'];

export const baseUiCss = `
${each('')} {
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: var(--space-1-5);
  height: var(--space-9);
  padding: 0 var(--space-3-5);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  box-shadow: var(--shadow-sm);
  transition: background ${STATE}, border-color ${STATE}, box-shadow ${STATE}, transform ${PRESS}, outline-width ${RING};
}
${each(':hover')} { background: var(--input-bg-hover); border-color: var(--border-hover); }
${each(':active')} { background: var(--input-bg-hover); border-color: var(--border-hover); box-shadow: none; transform: scale(0.97); }
${each(':disabled')} { opacity: 0.5; transform: none; box-shadow: none; }
.bui-toggle[data-pressed] { background: var(--accent-subtle); border-color: var(--border-hover); }
.bui-popover-trigger[data-popup-open], .bui-dialog-trigger[data-popup-open], .bui-tooltip-trigger[data-popup-open] { border-color: var(--border-hover); }

/* Buttons that are not a surface of their own lie flat, as ashui's ghost buttons do, whatever the user-agent sheet gives a button. */
${flat.flatMap((s) => [s, `${s}:hover`, `${s}:active`]).join(', ')} { box-shadow: none; }

/* A chevron turns over as what it belongs to opens. */
.bui-chevron {
  width: var(--space-4);
  height: var(--space-4);
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  transition: transform ${MOVE}, color ${STATE};
}
.bui-chevron > img { width: var(--space-4); height: var(--space-4); }
[data-panel-open] > .bui-chevron { transform: rotate(180deg); color: var(--text-primary); }

/* Switch: a track the thumb slides along, springing at its end. */
.bui-switch {
  width: var(--space-9);
  height: var(--space-5);
  padding: var(--space-0-5);
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  border: 1px solid var(--border-hover);
  border-radius: var(--radius-full);
  background: var(--border-hover);
  transition: background ${STATE}, border-color ${STATE}, outline-width ${RING};
}
.bui-switch:hover { background: var(--text-tertiary); border-color: var(--text-tertiary); }
.bui-switch:active { transform: none; }
.bui-switch[data-checked] { background: var(--primary); border-color: var(--primary); }
.bui-switch[data-checked]:hover { background: var(--primary-hover); border-color: var(--primary-hover); }
.bui-switch[data-disabled] { background: var(--input-bg-disabled); border-color: var(--border-secondary); opacity: 0.5; }
.bui-switch[data-disabled] > .bui-switch-thumb { box-shadow: none; border: 1px solid var(--border-secondary); }
.bui-switch[data-checked] { justify-content: flex-end; }
.bui-switch[data-size="lg"] { width: var(--space-12); height: var(--space-7); }
.bui-switch-thumb {
  position: relative;
  width: var(--space-3-5);
  height: var(--space-3-5);
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  background: var(--text-inverse);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
  transition: transform ${PRESS};
}
.bui-switch[data-size="lg"] > .bui-switch-thumb { width: var(--space-5); height: var(--space-5); }
.bui-switch:active > .bui-switch-thumb { transform: scale(0.92); }
/* An icon on the knob: the one for the other state turns away as this one turns in. */
.bui-icon { width: var(--space-3); height: var(--space-3); }
.bui-switch[data-size="lg"] .bui-icon { width: var(--space-3-5); height: var(--space-3-5); }
.bui-switch-thumb > .bui-icon {
  position: absolute;
  transition: opacity ${MOVE}, transform var(--duration-normal) var(--ease-spring);
}
.bui-switch-thumb[data-checked] > .bui-thumb-unchecked { opacity: 0; transform: rotate(90deg) scale(0.4); }
.bui-switch-thumb[data-unchecked] > .bui-thumb-checked { opacity: 0; transform: rotate(-90deg) scale(0.4); }

/* Checkbox: a box whose mark pops in. */
.bui-checkbox {
  width: var(--space-5);
  height: var(--space-5);
  padding: 0;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-hover);
  border-radius: var(--radius-sm);
  background: var(--input-bg);
  color: var(--text-inverse);
  transition: background ${STATE}, border-color ${STATE}, transform ${PRESS}, outline-width ${RING};
}
.bui-checkbox:hover { background: var(--input-bg-hover); }
.bui-checkbox:active { transform: scale(0.92); background: var(--input-bg-hover); }
.bui-checkbox:is([data-checked], [data-indeterminate]) { background: var(--primary); border-color: var(--primary); }
.bui-checkbox:is([data-checked], [data-indeterminate]):hover { background: var(--primary-hover); border-color: var(--primary-hover); }
.bui-checkbox[data-disabled] { opacity: 0.5; }
.bui-checkbox-indicator {
  align-items: center;
  justify-content: center;
  color: var(--text-inverse);
  transition: opacity ${STATE}, transform ${POP};
}
.bui-checkbox-indicator:not([data-unchecked]) { animation: bui-pop ${POP}; }
.bui-checkbox-indicator[data-unchecked] { opacity: 0; transform: scale(0.4); }

/* Collapsible and accordion: a trigger over a panel that is revealed as it opens. */
.bui-collapsible { gap: var(--space-2); align-items: flex-start; }
.bui-collapsible-trigger {
  height: auto;
  padding: var(--space-1-5) var(--space-3);
  gap: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  box-shadow: var(--shadow-sm);
  transition: background ${STATE}, border-color ${STATE}, box-shadow ${STATE}, outline-width ${RING}, transform ${PRESS};
}
.bui-collapsible-trigger:hover, .bui-collapsible-trigger:active { background: var(--input-bg-hover); border-color: var(--border-hover); }
.bui-collapsible-trigger[data-panel-open] { border-color: var(--border-hover); }
.bui-collapsible-panel { gap: var(--space-2); padding: 0 var(--space-0-5); overflow: hidden; }
.bui-collapsible-panel[data-closed] { height: 0; }
.bui-accordion {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-md);
  overflow: hidden;
}
.bui-accordion-item { border-bottom: 1px solid var(--border); overflow: hidden; }
.bui-accordion-item:last-child { border-bottom: 0; }
.bui-accordion-header { margin: 0; font-size: var(--text-sm); }
.bui-accordion-trigger {
  width: 100%;
  height: auto;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 0;
  border-radius: var(--radius-none);
  background: var(--surface);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  transition: background ${STATE}, outline-width ${RING};
}
.bui-accordion-trigger:hover, .bui-accordion-trigger:active { background: var(--input-bg-hover); transform: none; }
.bui-accordion-trigger[data-disabled] { opacity: 0.5; }
.bui-accordion-panel {
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border);
  background: var(--background);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
  overflow: hidden;
}
.bui-accordion-panel[data-closed] { height: 0; padding-top: 0; padding-bottom: 0; border-top-width: 0; }

/* Tabs: a tray of tabs with a raised pill that slides under the chosen one; or, as a line, a bar. */
.bui-tabs { gap: var(--space-3); }
.bui-tabs[data-orientation="vertical"] { flex-direction: row; }
.bui-tabs-list { position: relative; flex-direction: row; gap: var(--space-0-5); }
.bui-tabs-list[data-orientation="vertical"] { flex-direction: column; }
.bui-tabs-list[data-variant="segmented"] {
  align-self: flex-start;
  padding: var(--space-1);
  border-radius: var(--radius-lg);
  background: var(--input-bg-hover);
}
.bui-tabs-list[data-variant="underline"] { gap: var(--space-1); border-bottom: 1px solid var(--border); }
.bui-tabs-list[data-variant="underline"][data-orientation="vertical"] { border-bottom: 0; border-right: 1px solid var(--border); }
.bui-tabs-tab {
  position: relative;
  z-index: 1;
  height: var(--space-8);
  padding: 0 var(--space-3-5);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  transition: color ${STATE}, background ${STATE}, outline-width ${RING};
}
/* The chosen tab is marked by what slides under it, so a tab has no fill of its own to compete: hovering only darkens its text. */
.bui-tabs-tab, .bui-tabs-tab:hover, .bui-tabs-tab:active { background: transparent; }
.bui-tabs-tab:hover, .bui-tabs-tab:active { color: var(--text-primary); transform: none; }
.bui-tabs-list[data-variant="underline"] .bui-tabs-tab { height: var(--space-9); border-radius: var(--radius-none); }
.bui-tabs-tab[data-active] { color: var(--text-primary); }
.bui-tabs-tab[data-disabled] { opacity: 0.4; }
.bui-tabs-indicator { position: absolute; z-index: 0; pointer-events: none; }
.bui-tabs-indicator[data-variant="segmented"] {
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}
.bui-tabs-indicator[data-variant="underline"] { bottom: 0; height: var(--space-0-5); background: var(--primary); }
.bui-tabs-indicator[data-variant="underline"][data-orientation="vertical"] { bottom: auto; right: 0; width: var(--space-0-5); height: auto; }
.bui-tabs-indicator[data-ready] { transition: left ${MOVE}, top ${MOVE}, width ${MOVE}, height ${MOVE}; }
.bui-tabs-panel { padding: var(--space-1) var(--space-0-5); font-size: var(--text-sm); line-height: var(--leading-relaxed); }

/* What opens over the page: a tooltip, a popover, a dialog, each easing in from its side. */
.bui-tooltip-popup {
  padding: var(--space-1-5) var(--space-2-5);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--tooltip-bg);
  color: var(--tooltip-text);
  box-shadow: var(--shadow-sm);
  font-size: var(--text-xs);
  animation: bui-rise ${ENTER};
}
.bui-tooltip-popup[closing] { animation: blinc-fade-out ${EXIT}; }
.bui-popover-popup, .bui-dialog-popup {
  gap: var(--space-2);
  padding: var(--space-4);
  border: 1px solid var(--border);
  background: var(--surface-elevated);
  color: var(--text-primary);
  font-size: var(--text-sm);
}
.bui-popover-popup {
  min-width: var(--space-32);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  animation: bui-rise ${ENTER};
}
.bui-popover-popup[closing] { animation: blinc-fade-out ${EXIT}; }
.bui-dialog-popup {
  min-width: var(--space-32);
  max-width: 480px;
  padding: var(--space-6);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  animation: blinc-grow-in ${ENTER};
}
.bui-dialog-popup[closing] { animation: blinc-shrink-out ${EXIT}; }
.bui-popover-title, .bui-dialog-title { margin: 0; font-size: var(--text-lg); font-weight: var(--font-semibold); }
.bui-popover-description, .bui-dialog-description { margin: 0; color: var(--text-secondary); line-height: var(--leading-normal); }

@keyframes bui-pop { from { opacity: 0; transform: scale(0.4); } to { opacity: 1; transform: scale(1); } }
@keyframes bui-rise { from { opacity: 0; transform: translateY(var(--space-1)) scale(0.97); } to { opacity: 1; transform: none; } }
`;

/** Put the Base UI parts' sheet over the user-agent sheet's and under the app's. */
export function addBaseUi(layout: Layout): StyleSheet {
  return layout.addStyleSheet(baseUiCss, { at: 1, file: 'base-ui.css' });
}
