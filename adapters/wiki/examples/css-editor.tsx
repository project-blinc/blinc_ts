import type { CssDiagnostic, StyleSheet } from 'blinc_ts/native';
import type { HostElement } from 'blinc_ts/native/host';
import { For } from '#jsx/flow';
import { onCleanup, signal, useHost } from '#jsx/owner';

const START = `.live-card {
  gap: var(--space-1-5);
  padding: var(--space-5);
  border-radius: var(--radius-xl);
  background: linear-gradient(135deg, var(--primary), var(--text-secondary));
  color: var(--text-inverse);
  box-shadow: var(--shadow-lg);
  transition: transform var(--duration-slow) var(--ease-spring);
}
.live-card:hover { transform: translateY(-4px) rotate(-1deg); }
.live-card > .live-title {
  font-size: var(--text-xl);
  font-weight: var(--font-bold);
}`;

export default function CssEditor() {
  const layout = useHost().layout;
  const problems = signal<readonly CssDiagnostic[]>([]);
  let editor: HostElement | undefined;
  let sheet: StyleSheet | undefined;
  // Each apply takes the last sheet out and adds the new one; what it said is shown below.
  const apply = (css: string) => {
    if (sheet) {
      layout.removeStyleSheet(sheet);
    }
    sheet = layout.addStyleSheet(css, { file: 'live.css' });
    problems.set(sheet.diagnostics);
  };
  apply(START);
  onCleanup(() => {
    if (sheet && !layout.disposed) {
      layout.removeStyleSheet(sheet);
    }
  });
  return (
    <div class="wiki-col" style={{ width: '100%' }}>
      <textarea
        class="wiki-code-input"
        aria-label="Stylesheet"
        value={START}
        ref={(e: HostElement) => {
          editor = e;
        }}
      />
      <div class="wiki-row">
        <button onClick={() => apply(editor!.value)}>Apply</button>
        <span class="wiki-hint">Try a typo, such as color: bleu</span>
      </div>
      <div class="live-card">
        <div class="live-title">Styled as you write</div>
        <div>Hover me, then change the sheet and apply it.</div>
      </div>
      <div class="wiki-col">
        <For each={problems}>
          {(d: CssDiagnostic) => (
            <span class="wiki-error">{`${d.severity} at ${d.line}:${d.column}: ${d.message}`}</span>
          )}
        </For>
        <span class="wiki-hint">
          {() =>
            problems.get().length === 0 ? 'The engine read every declaration.' : 'The rest applies.'
          }
        </span>
      </div>
    </div>
  );
}
