/** Utility classes: the sheet, a checked class list, and the rules as text. */
import type { Host, HostElement } from 'blinc_ts/native/host';
import { addUtilities, classes, utilityCss } from 'blinc_ts/theme/utilities';

export function useUtilities(host: Host, card: HostElement): string {
  // First among the sheets, so an app's own rules of equal weight win over them.
  addUtilities(host.layout);
  // Only utility names are taken: a misspelt one is a type error.
  card.className = classes('bg-surface', 'rounded-lg', 'shadow-md', 'p-4');
  // The same rules as text, for a build step that compiles its sheets.
  return utilityCss();
}
