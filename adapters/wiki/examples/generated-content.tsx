import { signal } from '#jsx/owner';
import { useSheet } from '../kit.js';

const css = `
.generated-label { display: flex; flex-direction: row; align-items: center; gap: 8px; }
.generated-label::before { content: "[" attr(data-label) "]"; color: var(--primary); }
.generated-label::after { content: " →"; }
.generated-label:hover::after { color: var(--primary); }
.generated-label[data-hidden]::before, .generated-label[data-hidden]::after { content: none; }
`;

export default function GeneratedContent() {
  useSheet(css, 'generated-content.css');
  const label = signal('Ready');
  const hidden = signal(false);
  return (
    <div class="wiki-col">
      <div class="wiki-chips">
        <button
          class="wiki-chip generated-change"
          onClick={() => label.set(label.get() === 'Ready' ? 'Done' : 'Ready')}
        >
          Change attribute
        </button>
        <button class="wiki-chip generated-hide" onClick={() => hidden.set(!hidden.get())}>
          {() => (hidden.get() ? 'Show generated content' : 'Hide generated content')}
        </button>
      </div>
      <div
        class="generated-label"
        data-label={() => label.get()}
        data-hidden={() => (hidden.get() ? '' : undefined)}
      >
        <span>Generated label</span>
      </div>
      <p>The brackets read the attribute. Hiding removes both generated parts.</p>
    </div>
  );
}
