import { signal } from '#jsx/owner';
import { useSheet } from '../kit.js';

// Animations that run on their own: a spinner, dots that pulse in turn, a bar that sweeps, a
// heart that beats. animation-play-state pauses them where they are.
const css = `
.loaders { flex-direction: row; align-items: center; gap: 40px; height: 72px; }
.loaders[data-paused] * { animation-play-state: paused; }
.spinner {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 9999px;
  border: 4px solid var(--input-bg-hover);
  border-top-color: var(--primary);
  animation: k-spin 900ms linear infinite;
}
@keyframes k-spin { to { transform: rotate(360deg); } }
.dots { flex-direction: row; gap: 8px; }
.dots > div { width: 12px; height: 12px; border-radius: 9999px; background: var(--primary); animation: k-pulse 1s var(--ease-in-out) infinite; }
.dots > div:nth-child(2) { animation-delay: 160ms; }
.dots > div:nth-child(3) { animation-delay: 320ms; }
@keyframes k-pulse {
  0%, 100% { opacity: 0.25; transform: scale(0.7); }
  50% { opacity: 1; transform: scale(1.1); }
}
.sweep { position: relative; width: 160px; height: 6px; flex-shrink: 0; border-radius: 9999px; background: var(--input-bg-hover); overflow: hidden; }
.sweep > div { position: absolute; top: 0; left: 0; width: 60px; height: 6px; border-radius: 9999px; background: var(--primary); animation: k-sweep 1.4s var(--ease-in-out) infinite alternate; }
@keyframes k-sweep { from { transform: translateX(-60px); } to { transform: translateX(160px); } }
.heart { width: 40px; height: 40px; flex-shrink: 0; background: #ef4444;
  clip-path: path('M20 36 C 8 27, 1 20, 5 12 C 8 6, 15 6, 20 12 C 25 6, 32 6, 35 12 C 39 20, 32 27, 20 36 Z');
  animation: k-beat 1.1s var(--ease-spring) infinite; }
@keyframes k-beat { 0%, 100% { transform: scale(1); } 15% { transform: scale(1.25); } 30% { transform: scale(1); } }
`;

export default function MotionKeyframes() {
  useSheet(css, 'keyframes.css');
  const paused = signal(false);
  return (
    <div class="wiki-col">
      <div class="loaders" data-paused={() => (paused.get() ? '' : undefined)}>
        <div class="spinner" />
        <div class="dots">
          <div />
          <div />
          <div />
        </div>
        <div class="sweep">
          <div />
        </div>
        <div class="heart" />
      </div>
      <button onClick={() => paused.set(!paused.get())}>
        {() => (paused.get() ? 'Play' : 'Pause')}
      </button>
    </div>
  );
}
