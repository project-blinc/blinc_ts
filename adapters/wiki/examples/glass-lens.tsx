import type { HostElement, HostPointerEvent } from 'blinc_ts/native/host';
import type { Signal } from 'blinc_ts/native';
import { signal } from '#jsx/owner';
import { asset } from '../assets.js';
import { useSheet, valueOf } from '../kit.js';

const css = `
.lens-stage {
  position: relative;
  align-self: stretch;
  height: 400px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 16px;
}
.lens-photo { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; }
.lens-words {
  position: absolute;
  left: 28px;
  top: 28px;
  gap: 6px;
  color: #ffffff;
  font-size: 34px;
  font-weight: 800;
  white-space: nowrap;
}
.lens-rule { position: absolute; left: 0; right: 0; height: 2px; background: rgba(255, 255, 255, 0.85); }
.lens {
  position: absolute;
  background: glass;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
  cursor: grab;
}
.lens-dials {
  display: grid;
  grid-template-columns: 150px 240px 64px;
  align-items: center;
  column-gap: 12px;
  row-gap: 8px;
}
/* A dial fills its column, so every dial is one length and its reading sits beside it. */
.lens-dials > input { width: 100%; }
.lens-readout { font-family: var(--font-mono); font-size: var(--text-xs); text-align: right; }
`;

const shapes = {
  Circle: { width: 190, height: 190, borderRadius: 9999, cornerShape: 'round' },
  Pill: { width: 320, height: 110, borderRadius: 9999, cornerShape: 'round' },
  Slab: { width: 280, height: 180, borderRadius: 44, cornerShape: 'squircle' },
} as const;

/** A range and the value it holds, at a set width with its reading beside it. */
function Dial(props: {
  name: string;
  value: Signal<number>;
  min: number;
  max: number;
  step: number;
  unit?: string;
}) {
  return [
    <span class="wiki-mono">{props.name}</span>,
    <input
      type="range"
      aria-label={props.name}
      min={String(props.min)}
      max={String(props.max)}
      step={String(props.step)}
      value={String(props.value.get())}
      onInput={(e: { target: unknown }) => props.value.set(Number(valueOf(e)))}
    />,
    <span class="lens-readout">{() => `${props.value.get().toFixed(2)}${props.unit ?? ''}`}</span>,
  ];
}

function Choice<K extends string>(props: {
  name: string;
  value: Signal<K>;
  options: readonly K[];
}) {
  return [
    <span class="wiki-mono">{props.name}</span>,
    <div class="wiki-chips">
      {props.options.map((option) => (
        <button
          class="wiki-chip"
          data-active={() => (props.value.get() === option ? '' : undefined)}
          onClick={() => props.value.set(option)}
        >
          {option}
        </button>
      ))}
    </div>,
    <span />,
  ];
}

export default function GlassLens() {
  useSheet(css, 'glass-lens.css');
  const x = signal(250);
  const y = signal(70);
  const blur = signal(0);
  const bevel = signal(0.8);
  const aberration = signal(0.5);
  const noise = signal(0);
  const tint = signal(0.04);
  const curvature = signal<'outset' | 'inset'>('outset');
  const mode = signal<'liquid' | 'frosted'>('liquid');
  const shape = signal<keyof typeof shapes>('Circle');
  let stage: HostElement | undefined;
  let grab: [number, number] | undefined;
  return (
    <div class="wiki-col" style={{ width: '100%' }}>
      <div
        class="lens-stage"
        ref={(e: HostElement) => {
          stage = e;
        }}
      >
        <img class="lens-photo" src={asset('planet.webp')} alt="" />
        {[96, 150, 300, 352].map((top) => (
          <div class="lens-rule" style={{ top }} />
        ))}
        <div class="lens-words">
          <span>Liquid glass bends</span>
          <span>what is behind it,</span>
          <span>most at its rim.</span>
        </div>
        <div
          class="lens"
          style={{
            left: x,
            top: y,
            width: () => shapes[shape.get()].width,
            height: () => shapes[shape.get()].height,
            borderRadius: () => shapes[shape.get()].borderRadius,
            cornerShape: () => shapes[shape.get()].cornerShape,
            glassMode: mode,
            glassCurvature: curvature,
            glassBlur: () => `${blur.get()}px`,
            glassBevel: () => String(bevel.get()),
            glassAberration: () => String(aberration.get()),
            glassNoise: () => String(noise.get()),
            glassTint: () => `rgba(255, 255, 255, ${tint.get()})`,
          }}
          onPointerDown={(e: HostPointerEvent) => {
            (e.currentTarget as HostElement).setPointerCapture();
            grab = [e.x - x.get(), e.y - y.get()];
          }}
          onPointerMove={(e: HostPointerEvent) => {
            if (grab && stage) {
              const [, , w, h] = stage.bounds();
              const lens = shapes[shape.get()];
              x.set(Math.min(Math.max(e.x - grab[0], -lens.width / 2), w - lens.width / 2));
              y.set(Math.min(Math.max(e.y - grab[1], -lens.height / 2), h - lens.height / 2));
            }
          }}
          onPointerUp={(e: HostPointerEvent) => {
            grab = undefined;
            (e.currentTarget as HostElement).releasePointerCapture();
          }}
        />
      </div>
      <span class="wiki-hint">Drag the glass over the lines and the planet.</span>
      <div class="lens-dials">
        <Dial name="glass-bevel" value={bevel} min={0} max={1} step={0.05} />
        <Dial name="glass-aberration" value={aberration} min={0} max={1} step={0.05} />
        <Dial name="glass-blur" value={blur} min={0} max={24} step={1} unit="px" />
        <Dial name="glass-tint alpha" value={tint} min={0} max={0.6} step={0.02} />
        <Dial name="glass-noise" value={noise} min={0} max={1} step={0.05} />
        <Choice name="glass-curvature" value={curvature} options={['outset', 'inset'] as const} />
        <Choice name="glass-mode" value={mode} options={['liquid', 'frosted'] as const} />
        <Choice
          name="shape"
          value={shape}
          options={Object.keys(shapes) as (keyof typeof shapes)[]}
        />
      </div>
    </div>
  );
}
