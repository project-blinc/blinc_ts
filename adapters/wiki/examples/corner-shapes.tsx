import { effect, onCleanup, signal, useContext } from '#jsx/owner';
import { WikiTheme } from '../context.js';
import { valueOf } from '../kit.js';

const shapes = [
  'round',
  'squircle',
  'bevel',
  'scoop',
  'notch',
  'square',
  'round locked',
  'squircle bevel',
  'scoop round',
] as const;

const tile = {
  width: 96,
  height: 96,
  borderRadius: 'var(--radius-3xl)',
  background: 'linear-gradient(135deg, var(--primary), var(--text-secondary))',
  boxShadow: 'var(--shadow-md)',
};

export default function CornerShapes() {
  const theme = useContext(WikiTheme);
  const n = signal(2);
  const smoothing = signal(0);
  // The theme's smoothing reaches every rounded corner that does not set its own shape.
  effect(() => {
    theme.override({
      shape: { cornerSmoothing: smoothing.get(), cornerExponent: 5, smoothingThreshold: 4 },
    });
  });
  onCleanup(() => theme.clearOverrides());
  return (
    <div class="wiki-col" style={{ width: '100%' }}>
      <div class="wiki-grid">
        {shapes.map((shape) => (
          <div class="wiki-swatch" style={{ width: 112, alignItems: 'center' }}>
            <div style={{ ...tile, cornerShape: shape }} />
            <span class="wiki-mono">{shape}</span>
          </div>
        ))}
      </div>
      {/* The tile never shrinks, the readouts are fixed width and the dials a set length, so
          nothing moves as the values change. */}
      <div class="wiki-row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <div
          style={{
            ...tile,
            width: 140,
            height: 140,
            flexShrink: 0,
            cornerShape: () => `superellipse(${n.get().toFixed(2)})`,
          }}
        />
        <div class="wiki-col" style={{ width: 320, flexShrink: 0 }}>
          <div class="wiki-field">
            <span class="wiki-mono">
              {() => `corner-shape: superellipse(${n.get().toFixed(2)})`}
            </span>
            <input
              type="range"
              aria-label="Superellipse exponent"
              min="-2"
              max="5"
              step="0.25"
              value="2"
              onInput={(e: { target: unknown }) => n.set(Number(valueOf(e)))}
            />
          </div>
          <div class="wiki-field">
            <span class="wiki-mono">{() => `cornerSmoothing: ${smoothing.get().toFixed(2)}`}</span>
            <input
              type="range"
              aria-label="The theme's corner smoothing"
              min="0"
              max="1"
              step="0.05"
              value="0"
              onInput={(e: { target: unknown }) => smoothing.set(Number(valueOf(e)))}
            />
          </div>
          <span class="wiki-hint">
            The second dial is the theme's: it smooths every rounded corner in this window that sets
            no shape of its own.
          </span>
        </div>
      </div>
    </div>
  );
}
