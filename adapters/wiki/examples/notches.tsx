import { concaveTop, notch, notchEdge } from 'blinc_ts/native';
import type { HostElement } from 'blinc_ts/native/host';
import { signal } from '#jsx/owner';
import { useSheet } from '../kit.js';

// Shapes a rounded box cannot make: a menu that flares into its bar, a tooltip's arrow, an island
// with a camera's bowl, a ticket's punched edges. A notch is set on the element's layout node.
const css = `
.n-bar { width: 360px; height: 40px; flex-shrink: 0; flex-direction: row; align-items: center; gap: 18px; padding: 0 16px;
  background: #0f172a; color: #ffffff; border-radius: 12px; }
.n-menu { width: 196px; flex-shrink: 0; margin-left: 40px; padding: 20px 32px 14px 32px; gap: 8px; background: #0f172a; color: #e2e8f0; box-shadow: var(--shadow-lg); }
/* Concave corners inset the body from the top by their radius: the menu sits that far up into its bar. */
.n-menu[data-flared] { margin-top: -16px; }
.n-tip { padding: 10px 14px 22px 14px; background: #6366f1; color: #ffffff; font-weight: 600; }
.n-island { width: 220px; height: 80px; flex-shrink: 0; align-items: center; justify-content: flex-end; padding-bottom: 12px;
  background: linear-gradient(135deg, #111827, #374151); color: #ffffff; }
.n-ticket { width: 220px; height: 100px; flex-shrink: 0; align-items: center; justify-content: center; background: #f59e0b; color: #451a03; font-weight: 800; }
`;

export default function Notches() {
  useSheet(css, 'notches.css');
  const flared = signal(true);
  let menu: HostElement | undefined;
  const shape = (on: boolean) =>
    menu?.layoutNode.setNotch(on ? concaveTop(16, 12) : notch({ bottomLeft: 12, bottomRight: 12 }));
  return (
    <div class="wiki-row" style={{ alignItems: 'flex-start', gap: 36 }}>
      <div class="wiki-col" style={{ gap: 0 }}>
        <div class="n-bar">
          <span>File</span>
          <span>Edit</span>
          <span>View</span>
        </div>
        <div
          class="n-menu"
          data-flared={() => (flared.get() ? '' : undefined)}
          ref={(e: HostElement) => {
            menu = e;
            shape(true);
          }}
        >
          <span>New window</span>
          <span>Open…</span>
          <span>Save as…</span>
        </div>
        <button
          style={{ marginTop: 14 }}
          onClick={() => {
            flared.set(!flared.get());
            shape(flared.get());
          }}
        >
          {() => (flared.get() ? 'Plain corners' : 'Flare into the bar')}
        </button>
      </div>
      <div class="wiki-col" style={{ gap: 24 }}>
        <div
          class="n-tip"
          ref={(e: HostElement) =>
            e.layoutNode.setNotch(
              notch({
                topLeft: 10,
                topRight: 10,
                bottomLeft: 10,
                bottomRight: 10,
                bottom: notchEdge.peak(24, 12),
              }),
            )
          }
        >
          A tooltip, its arrow a peak
        </div>
        <div
          class="n-island"
          ref={(e: HostElement) =>
            e.layoutNode.setNotch(
              notch({
                topLeft: 24,
                topRight: 24,
                bottomLeft: 24,
                bottomRight: 24,
                top: notchEdge.scoop(70, 16, 6),
              }),
            )
          }
        >
          An island
        </div>
        <div
          class="n-ticket"
          ref={(e: HostElement) =>
            e.layoutNode.setNotch(
              notch({
                topLeft: 10,
                topRight: 10,
                bottomLeft: 10,
                bottomRight: 10,
                top: notchEdge.scoop(28, 14),
                bottom: notchEdge.scoop(28, 14),
              }),
            )
          }
        >
          ADMIT ONE
        </div>
      </div>
    </div>
  );
}
