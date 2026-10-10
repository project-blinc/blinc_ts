/**
 * What the Base UI parts look like. A part draws nothing of its own: it has a class, and what
 * state it is in is a `data-` attribute, which this sheet styles with the theme's variables, as
 * the user-agent sheet does for built-in elements. It goes over that sheet and under the app's
 * own, so an app restyles any part by its class or attribute.
 */
import type { Layout, StyleSheet } from 'blinc_ts/native';

const STATE = 'var(--duration-fast) var(--ease-state)';
const RING = 'var(--duration-fast) var(--ease-out)';
const PRESS = 'var(--duration-faster) var(--ease-state)';
const ENTER = 'var(--duration-fast) var(--ease-sheet)';
const EXIT = 'var(--duration-faster) var(--ease-sheet) forwards';

/** Buttons that show no fill of their own: a toggle, and what opens or closes something. */
const plain = [
  '.bui-toggle',
  '.bui-collapsible-trigger',
  '.bui-tooltip-trigger',
  '.bui-popover-trigger',
  '.bui-dialog-trigger',
  '.bui-popover-close',
  '.bui-dialog-close',
].join(', ');

const css = `
${plain} {
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--text-primary);
  font-weight: 500;
  transition: background ${STATE}, border-color ${STATE}, transform ${PRESS}, outline-width ${RING};
}
${plain.replace(/,\s*/g, ':hover, ')}:hover { background: var(--input-bg-hover); border-color: var(--border-hover); }
${plain.replace(/,\s*/g, ':active, ')}:active { background: var(--input-bg-hover); border-color: var(--border-hover); transform: scale(0.97); }
${plain.replace(/,\s*/g, ':disabled, ')}:disabled { opacity: 0.5; transform: none; }
.bui-toggle[data-pressed] { background: var(--accent-subtle); border-color: var(--border-hover); }
.bui-collapsible-trigger[data-panel-open] { border-color: var(--border-hover); }

/* Switch: a track the thumb slides along. */
.bui-switch {
  width: 36px;
  height: 20px;
  padding: 2px;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  background: var(--input-bg-hover);
  transition: background ${STATE}, border-color ${STATE}, outline-width ${RING};
}
.bui-switch:hover { border-color: var(--border-hover); }
.bui-switch:active { background: var(--input-bg-hover); transform: none; }
.bui-switch[data-checked] { background: var(--primary); border-color: var(--primary); }
.bui-switch[data-checked]:hover { background: var(--primary-hover); border-color: var(--primary-hover); }
.bui-switch[data-disabled] { opacity: 0.5; }
.bui-switch-thumb {
  width: 14px;
  height: 14px;
  border-radius: var(--radius-full);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  transition: transform var(--duration-normal) var(--ease-spring);
}
.bui-switch-thumb[data-checked] { transform: translateX(16px); }
.bui-switch[data-checked] > .bui-switch-thumb { background: var(--text-inverse); }

/* Checkbox: a box its indicator marks. */
.bui-checkbox {
  width: 18px;
  height: 18px;
  padding: 0;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-hover);
  border-radius: var(--radius-sm);
  background: var(--input-bg);
  color: var(--text-inverse);
  transition: background ${STATE}, border-color ${STATE}, outline-width ${RING};
}
.bui-checkbox:hover { background: var(--input-bg-hover); border-color: var(--border-hover); }
.bui-checkbox:active { transform: none; background: var(--input-bg-hover); }
.bui-checkbox:is([data-checked], [data-indeterminate]) { background: var(--primary); border-color: var(--primary); }
.bui-checkbox:is([data-checked], [data-indeterminate]):hover { background: var(--primary-hover); border-color: var(--primary-hover); }
.bui-checkbox[data-disabled] { opacity: 0.5; }
.bui-checkbox-indicator { align-items: center; justify-content: center; color: var(--text-inverse); }

/* Collapsible and accordion: a trigger over a panel. */
.bui-collapsible { gap: 8px; align-items: flex-start; }
.bui-collapsible-panel { gap: 8px; padding: 0 2px; }
.bui-accordion { width: 100%; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); overflow: hidden; }
.bui-accordion-item { border-bottom: 1px solid var(--border); }
.bui-accordion-item:last-child { border-bottom: 0; }
.bui-accordion-header { margin: 0; font-size: var(--text-base); }
.bui-accordion-trigger {
  width: 100%;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--radius-none);
  background: var(--surface);
  color: var(--text-primary);
  font-weight: 500;
  transition: background ${STATE}, outline-width ${RING};
}
.bui-accordion-trigger:hover, .bui-accordion-trigger:active { background: var(--input-bg-hover); transform: none; }
.bui-accordion-trigger[data-disabled] { opacity: 0.5; }
.bui-accordion-panel { padding: 0 16px 14px 16px; color: var(--text-secondary); }

/* Tabs: a row of tabs over what the chosen one shows. */
.bui-tabs { gap: 12px; }
.bui-tabs-list { flex-direction: row; gap: 4px; border-bottom: 1px solid var(--border); }
.bui-tabs-list[data-orientation="vertical"] { flex-direction: column; border-bottom: 0; border-right: 1px solid var(--border); }
.bui-tabs[data-orientation="vertical"] { flex-direction: row; }
.bui-tabs-tab {
  height: 36px;
  padding: 0 14px;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  background: var(--background);
  color: var(--text-secondary);
  font-weight: 500;
  border-bottom: 2px solid transparent;
  transition: color ${STATE}, background ${STATE}, border-color ${STATE}, outline-width ${RING};
}
.bui-tabs-tab:hover { background: var(--input-bg-hover); color: var(--text-primary); }
.bui-tabs-tab:active { background: var(--input-bg-hover); transform: none; }
.bui-tabs-tab[data-active] { color: var(--text-primary); border-bottom-color: var(--primary); background: var(--background); }
.bui-tabs-tab[data-disabled] { opacity: 0.4; }
.bui-tabs-panel { padding: 4px 2px; }

/* What opens over the page: a tooltip, a popover, a dialog. */
.bui-tooltip-popup {
  padding: 6px 10px;
  border-radius: var(--radius-md);
  background: var(--tooltip-bg);
  color: var(--tooltip-text);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-md);
  font-size: var(--text-sm);
  animation: blinc-fade-in ${ENTER};
}
.bui-tooltip-popup[closing] { animation: blinc-fade-out ${EXIT}; }
.bui-popover-popup, .bui-dialog-popup {
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--border);
  background: var(--surface-elevated);
  color: var(--text-primary);
}
.bui-popover-popup {
  min-width: 220px;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  animation: blinc-list-in ${ENTER};
}
.bui-popover-popup[closing] { animation: blinc-list-out ${EXIT}; }
.bui-dialog-popup {
  min-width: 320px;
  max-width: 480px;
  padding: 24px;
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-2xl);
  animation: blinc-grow-in ${ENTER};
}
.bui-dialog-popup[closing] { animation: blinc-shrink-out ${EXIT}; }
.bui-popover-title, .bui-dialog-title { margin: 0; font-size: var(--text-lg); font-weight: 600; }
.bui-popover-description, .bui-dialog-description { margin: 0; color: var(--text-secondary); }
`;

/** Put the Base UI parts' sheet over the user-agent sheet's and under the app's. */
export function addBaseUi(layout: Layout): StyleSheet {
  return layout.addStyleSheet(css, { at: 1, file: 'base-ui.css' });
}
