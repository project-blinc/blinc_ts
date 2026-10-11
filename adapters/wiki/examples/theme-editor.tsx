import { hex, type ThemePatch } from 'blinc_ts/theme';
import { effect, onCleanup, signal, useContext } from '#jsx/owner';
import { WikiTheme } from '../context.js';

const palettes = {
  Theme: undefined,
  Indigo: ['#4f46e5', '#4338ca', '#3730a3'],
  Emerald: ['#059669', '#047857', '#065f46'],
  Rose: ['#e11d48', '#be123c', '#9f1239'],
  Amber: ['#d97706', '#b45309', '#92400e'],
} as const;
const corners = {
  Theme: undefined,
  Sharp: { sm: 0, default: 0, md: 0, lg: 0, xl: 0, '2xl': 0, '3xl': 0 },
  Round: { sm: 4, default: 8, md: 12, lg: 16, xl: 22, '2xl': 28, '3xl': 36 },
} as const;

/** Overrides on the wiki's own theme: the whole window restyles in place, and leaving resets it. */
export default function ThemeEditor() {
  const theme = useContext(WikiTheme);
  const palette = signal<keyof typeof palettes>('Theme');
  const corner = signal<keyof typeof corners>('Theme');
  const smooth = signal(false);
  effect(() => {
    const colors = palettes[palette.get()];
    const radii = corners[corner.get()];
    const patch: ThemePatch = {
      ...(colors && {
        colors: {
          primary: hex(colors[0]),
          primaryHover: hex(colors[1]),
          primaryActive: hex(colors[2]),
        },
      }),
      ...(radii && { radii }),
      ...(smooth.get() && {
        shape: { cornerSmoothing: 0.6, cornerExponent: 4, smoothingThreshold: 8 },
      }),
    };
    theme.clearOverrides();
    theme.override(patch);
  });
  onCleanup(() => theme.clearOverrides());
  const chips = <K extends string>(choice: { get(): K; set(v: K): void }, names: readonly K[]) => (
    <div class="wiki-chips">
      {names.map((name) => (
        <button
          class="wiki-chip"
          data-active={() => (choice.get() === name ? '' : undefined)}
          onClick={() => choice.set(name)}
        >
          {name}
        </button>
      ))}
    </div>
  );
  return (
    <div class="wiki-col">
      <div class="wiki-row">
        <span class="wiki-chip-label">Primary</span>
        {chips(palette, Object.keys(palettes) as (keyof typeof palettes)[])}
      </div>
      <div class="wiki-row">
        <span class="wiki-chip-label">Radii</span>
        {chips(corner, Object.keys(corners) as (keyof typeof corners)[])}
      </div>
      <div class="wiki-row">
        <span class="wiki-chip-label">Corners</span>
        <div class="wiki-chips">
          <button
            class="wiki-chip"
            data-active={() => (smooth.get() ? undefined : '')}
            onClick={() => smooth.set(false)}
          >
            Circular
          </button>
          <button
            class="wiki-chip"
            data-active={() => (smooth.get() ? '' : undefined)}
            onClick={() => smooth.set(true)}
          >
            Squircle
          </button>
        </div>
      </div>
      <div class="wiki-row">
        <button>A button</button>
        <input type="checkbox" checked aria-label="A checkbox" />
        <input type="range" aria-label="A range" />
        <span class="wiki-readout">Everything in this window follows</span>
      </div>
    </div>
  );
}
