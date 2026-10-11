/** Stylesheets on a host: added, read, reported on, and taken out. */
import type { Host } from 'blinc_ts/native/host';
import { addUserAgent } from 'blinc_ts/theme/user-agent';

export function styleTheApp(host: Host): void {
  // The elements' defaults go first; a later sheet wins a tie of specificity.
  addUserAgent(host.layout);
  const sheet = host.layout.addStyleSheet(
    `.card { gap: var(--space-2); padding: var(--space-4); border-radius: var(--radius-lg); }
     .card:hover { background: var(--surface-elevated); }`,
    { file: 'app.css' },
  );
  // What the parser could not read, by line and column; the rest of the sheet applies.
  for (const d of sheet.diagnostics) {
    console.warn(`app.css:${d.line}:${d.column}: ${d.message}`);
  }
  // A value that parses but cannot be applied is reported when it is, with why.
  host.onStyleErrors((errors) => {
    for (const error of errors) {
      console.warn(error);
    }
  });
  // Inline declarations: a number is pixels where a length is meant.
  const card = host.createElement('div');
  card.className = 'card';
  card.setProperty('gap', 8);
  card.setAttribute('style', 'opacity: 0.9; transform: rotate(-1deg)');
  host.root.appendChild(card);
  // Taken out, its rules go with it.
  host.layout.removeStyleSheet(sheet);
}
