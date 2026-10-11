import type { HostElement, HostPointerEvent } from 'blinc_ts/native/host';
import { memo, signal, useHost } from '#jsx/owner';
import { valueOf } from '../kit.js';

// measureText lays text out as the renderer draws it, without a tree: its lines, their widths,
// and every place a caret can stand. Each line below is drawn from what it returned.
// One family for what is measured and what is drawn, so the two agree.
const FAMILY = 'system-ui, sans-serif';
const STYLE = { fontSize: 18, fontFamily: FAMILY };

export default function MeasureText() {
  const native = useHost().native!;
  const text = signal(
    'Measure me: the lines wrap at the width you give, and each caret stop is known.',
  );
  const width = signal(300);
  const caret = signal(-1);
  const measured = memo(() => native.measureText(text.get(), STYLE, width.get()));
  let box: HostElement | undefined;
  return (
    <div class="wiki-col" style={{ width: '100%', gap: 12 }}>
      <input
        type="text"
        aria-label="Text"
        value={text.get()}
        style={{ width: 480 }}
        onInput={(e: { target: unknown }) => text.set(valueOf(e))}
      />
      <div class="wiki-row">
        <input
          type="range"
          min="120"
          max="460"
          value="300"
          aria-label="Wrap width"
          onInput={(e: { target: unknown }) => width.set(Number(valueOf(e)))}
        />
        <span class="wiki-readout" style={{ width: 380 }}>
          {() =>
            `${measured.get().lineCount} lines at ${width.get()}px, line height ${measured.get().lineHeight.toFixed(1)}`
          }
        </span>
      </div>
      <div
        ref={(e: HostElement) => {
          box = e;
        }}
        style={{
          position: 'relative',
          width: 480,
          height: 200,
          flexShrink: 0,
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
        }}
        onPointerDown={(e: HostPointerEvent) => {
          const [x, y] = box!.viewBounds();
          caret.set(measured.get().caretNear(e.x - x - 12, e.y - y - 12).index);
        }}
      >
        {() => {
          const m = measured.get();
          const at = caret.get() >= 0 ? m.caretAt(caret.get()) : undefined;
          return [
            <div
              style={{
                position: 'absolute',
                left: 12,
                top: 12,
                width: width.get(),
                height: m.height,
                background: 'var(--accent-subtle)',
              }}
            />,
            ...m.lines.map((line, i) => [
              <div
                style={{
                  position: 'absolute',
                  left: 12,
                  top: 12 + i * m.lineHeight,
                  width: line.width,
                  height: m.lineHeight,
                  border: '1px solid var(--info)',
                }}
              />,
              <span
                style={{
                  position: 'absolute',
                  left: 12,
                  top: 12 + i * m.lineHeight,
                  height: m.lineHeight,
                  fontSize: STYLE.fontSize,
                  fontFamily: FAMILY,
                  whiteSpace: 'pre',
                }}
              >
                {text.get().slice(line.start, line.end)}
              </span>,
            ]),
            at ? (
              <div
                style={{
                  position: 'absolute',
                  left: 12 + at.x - 1,
                  top: 12 + at.line * m.lineHeight,
                  width: 2,
                  height: m.lineHeight,
                  background: 'var(--error)',
                }}
              />
            ) : null,
          ];
        }}
      </div>
      <span class="wiki-readout" style={{ width: 300 }}>
        {() =>
          caret.get() < 0
            ? 'Press in the text for the caret nearest'
            : `caret before index ${caret.get()}`
        }
      </span>
    </div>
  );
}
