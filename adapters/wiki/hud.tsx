/** A panel of what the wiki costs as it runs: memory, the GPU, the tree and the frames it draws. */
import type { Signal } from 'blinc_ts/native';
import type { JsxNode } from '#jsx/jsx-runtime';
import { effect, onCleanup, signal } from '#jsx/owner';

/** One reading of what the wiki holds and does. */
export interface PerfSample {
  /** Bytes the process holds, as the system counts them against it. */
  footprint: number;
  /** Bytes of the JavaScript heap in use. */
  heap: number;
  /** Nodes in the layout tree. */
  nodes: number;
  /** Bytes of the renderer's textures; none without a window. */
  textures?: number | undefined;
  /** Milliseconds the last frame took to lay out and encode. */
  frameTime?: number | undefined;
  drawCalls?: number | undefined;
  /** Frames presented so far. */
  frames?: number | undefined;
}

export type PerfSource = () => PerfSample;

const EVERY_MS = 500;

const mb = (bytes: number): string => `${(bytes / 1048576).toFixed(1)} MB`;
const signed = (bytes: number): string => `${bytes < 0 ? '−' : '+'}${mb(Math.abs(bytes))}`;

/**
 * Readings of `source` twice a second, and what the page shown has added since it opened: how
 * far the footprint has grown, and the most it reached.
 */
export function PerfHud(props: { source: PerfSource; page: Signal<string> }): JsxNode {
  const first = props.source();
  const sample = signal(first);
  const rate = signal(0);
  const opened = signal({ base: first.footprint, peak: first.footprint });
  let last = { at: performance.now(), frames: first.frames ?? 0 };
  // A page opened is measured from where the footprint was as it opened.
  effect(() => {
    props.page.get();
    const now = props.source().footprint;
    opened.set({ base: now, peak: now });
  });
  const timer = setInterval(() => {
    const next = props.source();
    const at = performance.now();
    if (next.frames !== undefined) {
      rate.set(((next.frames - last.frames) * 1000) / (at - last.at));
      last = { at, frames: next.frames };
    }
    const { base, peak } = opened.peek();
    if (next.footprint > peak) {
      opened.set({ base, peak: next.footprint });
    }
    sample.set(next);
  }, EVERY_MS);
  timer.unref?.();
  onCleanup(() => clearInterval(timer));
  const row = (label: string, value: () => string) => (
    <div class="wiki-hud-row">
      <span class="wiki-hud-label">{label}</span>
      <span class="wiki-hud-value">{value}</span>
    </div>
  );
  return (
    <div class="wiki-hud" aria-label="Performance">
      <span class="wiki-hud-title">Performance</span>
      {row('Memory', () => mb(sample.get().footprint))}
      {row('This page', () => signed(sample.get().footprint - opened.get().base))}
      {row('Page peak', () => signed(opened.get().peak - opened.get().base))}
      {row('JS heap', () => mb(sample.get().heap))}
      {row('GPU textures', () => {
        const t = sample.get().textures;
        return t === undefined ? '—' : mb(t);
      })}
      {row('Layout nodes', () => sample.get().nodes.toLocaleString('en'))}
      {row('Frame', () => {
        const { frameTime, drawCalls } = sample.get();
        return frameTime === undefined
          ? '—'
          : `${frameTime.toFixed(1)} ms · ${drawCalls ?? 0} draws`;
      })}
      {row('Frames', () =>
        sample.get().frames === undefined ? '—' : `${rate.get().toFixed(0)} / s`,
      )}
    </div>
  );
}
