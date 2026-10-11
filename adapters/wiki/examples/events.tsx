import type { HostEvent, HostPointerEvent } from 'blinc_ts/native/host';
import { For } from '#jsx/flow';
import { signal } from '#jsx/owner';
import { useSheet } from '../kit.js';

// Every event that reaches the box, newest first, with where it is in its journey: captured on
// the way down at the outer box, at the inner one, or bubbling back up.
const css = `
.ev { flex-direction: row; gap: 20px; align-items: flex-start; }
.ev-outer { width: 260px; height: 200px; flex-shrink: 0; align-items: center; justify-content: center;
  border: 1px dashed var(--border-hover); border-radius: var(--radius-xl); }
.ev-inner { width: 150px; height: 100px; align-items: center; justify-content: center; border-radius: var(--radius-lg);
  background: var(--primary); color: var(--text-inverse); font-weight: 700; }
.ev-inner:focus-visible { outline: 3px solid var(--focus-ring); }
.ev-log { width: 330px; height: 200px; flex-shrink: 0; gap: 2px; padding: 8px 10px; overflow: hidden;
  border-radius: var(--radius-lg); background: var(--surface); border: 1px solid var(--border); }
`;

const types = [
  'pointerdown',
  'pointerup',
  'click',
  'dblclick',
  'pointerenter',
  'pointerleave',
  'wheel',
  'keydown',
  'focus',
  'blur',
];

export default function Events() {
  useSheet(css, 'events.css');
  const log = signal<string[]>([]);
  const note = (where: string) => (e: HostEvent) => {
    const p = e as HostPointerEvent;
    const at = 'x' in e ? ` at ${Math.round(p.x)},${Math.round(p.y)}` : '';
    const key = 'key' in e ? ` ${(e as unknown as { key: string }).key}` : '';
    log.set([`${e.type} ${where}${at}${key}`, ...log.get()].slice(0, 11));
  };
  const listeners = (where: string, capture: boolean) =>
    Object.fromEntries(
      types.map((t) => [
        `on${t[0]!.toUpperCase()}${t.slice(1)}${capture ? 'Capture' : ''}`,
        note(where),
      ]),
    );
  return (
    <div class="ev">
      <div class="ev-outer" {...listeners('outer, captured', true)}>
        <div class="ev-inner" tabindex="0" {...listeners('inner', false)}>
          Press, wheel, type
        </div>
      </div>
      <div class="ev-log">
        <For each={log}>{(line: string) => <span class="wiki-mono">{line}</span>}</For>
      </div>
    </div>
  );
}
