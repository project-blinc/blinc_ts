import type { HostElement } from 'blinc_ts/native/host';
import { For } from '#jsx/flow';
import { signal } from '#jsx/owner';
import { useSheet } from '../kit.js';

// A toast plays its way out before it is taken away: closing marks it, the sheet animates the
// mark, and animationsFinished says when to remove it. The others close up behind it.
const css = `
.toasts { gap: 10px; width: 340px; min-height: 200px; }
.toast {
  flex-direction: row;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-md);
  animation: t-in var(--duration-slow) var(--ease-spring);
  transition: opacity var(--duration-normal) var(--ease-out), transform var(--duration-normal) var(--ease-in);
}
.toast[data-closing] { opacity: 0; transform: translateX(80px) scale(0.96); }
@keyframes t-in { from { opacity: 0; transform: translateY(-12px) scale(0.96); } }
.toast > span { flex: 1; }
.toast > button { height: 28px; padding: 0 10px; }
`;

interface Toast {
  n: number;
}

export default function MotionExit() {
  useSheet(css, 'toasts.css');
  let next = 0;
  const toasts = signal<Toast[]>([]);
  const close = async (toast: Toast, element: HostElement) => {
    element.setAttribute('data-closing', '');
    await element.animationsFinished();
    toasts.set(toasts.get().filter((t) => t !== toast));
  };
  return (
    <div class="wiki-col">
      <button onClick={() => toasts.set([...toasts.get(), { n: ++next }])}>Notify</button>
      <div class="toasts">
        <For each={toasts}>
          {(toast: Toast) => {
            let element: HostElement | undefined;
            return (
              <div
                class="toast"
                ref={(e: HostElement) => {
                  element = e;
                  e.animateLayout({ size: false, duration: 260 });
                }}
              >
                <span>{`Saved, number ${toast.n}`}</span>
                <button onClick={() => void close(toast, element!)}>Dismiss</button>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
