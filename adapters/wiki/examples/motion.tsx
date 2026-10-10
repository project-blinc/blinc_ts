import { signal } from '#jsx/owner';

export default function Motion() {
  const moved = signal(false);
  return (
    <div class="wiki-col">
      <div class="wiki-row">
        <button onClick={() => moved.set(!moved.get())}>Move</button>
        <span class="wiki-hint">A style change eases over its transition</span>
      </div>
      <div style={{ width: 360, height: 48 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            background: () => (moved.get() ? '#2fb344' : '#5a93ff'),
            transform: () => `translateX(${moved.get() ? 312 : 0}px)`,
            transition: 'transform 500ms var(--ease-spring), background 300ms',
          }}
        />
      </div>
      <div
        class="wiki-pulse"
        style={{ width: 120, height: 14, borderRadius: 7, background: 'var(--primary)' }}
      />
    </div>
  );
}
