import { signal } from '#jsx/owner';
import { useSheet } from '../kit.js';

// One move, timed seven ways: each dot crosses the same track over the same time, or, a spring,
// over the time it takes to settle.
const css = `
.race { gap: 10px; width: 100%; }
.lane { flex-direction: row; align-items: center; gap: 12px; }
.lane-name { width: 190px; flex-shrink: 0; }
.track { position: relative; width: 340px; height: 22px; flex-shrink: 0; border-radius: 9999px; background: var(--input-bg-hover); }
.dot { position: absolute; left: 2px; top: 2px; width: 18px; height: 18px; border-radius: 9999px; background: var(--primary); }
.race[data-gone] .dot { transform: translateX(318px); }
`;

const timings = [
  'ease',
  'ease-in-out',
  'linear',
  'steps(6)',
  'cubic-bezier(0.7, -0.4, 0.3, 1.4)',
  'var(--ease-spring)',
  'spring(1 180 9)',
];

export default function MotionTiming() {
  useSheet(css, 'timing.css');
  const gone = signal(false);
  return (
    <div class="wiki-col" style={{ width: '100%' }}>
      <div class="race" data-gone={() => (gone.get() ? '' : undefined)}>
        {timings.map((timing) => (
          <div class="lane">
            <span class="wiki-mono lane-name">{timing}</span>
            <div class="track">
              <div class="dot" style={{ transition: `transform 1200ms ${timing}` }} />
            </div>
          </div>
        ))}
      </div>
      <div class="wiki-row">
        <button onClick={() => gone.set(!gone.get())}>{() => (gone.get() ? 'Back' : 'Go')}</button>
        <span class="wiki-hint">Press again while they run: each turns back from where it is.</span>
      </div>
    </div>
  );
}
