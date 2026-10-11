import { useSheet } from '../kit.js';

// Glass and blur over a backdrop of coloured discs and lines of text, so each panel's edge shows
// against curves and letters. Every panel is CSS.
const css = `
.gg-board { position: relative; width: 640px; height: 920px; flex-shrink: 0; overflow: hidden; border-radius: 16px; background: #f6f7fb; }
.gg-disc { position: absolute; border-radius: 9999px; }
.gg-line { position: absolute; left: 24px; font-size: 30px; font-weight: 700; color: #ffffff; white-space: nowrap; }
.gg-row { position: absolute; left: 16px; width: 608px; flex-direction: row; gap: 12px; }
.gg-panel {
  width: 92px;
  height: 110px;
  justify-content: flex-end;
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 16px;
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
}
.gg-dark { color: #0b0b0f; }

/* Frosted glass: blurred and tinted, no refraction. */
.gg-frost { background: glass; glass-mode: frosted; glass-blur: 12px; border-color: rgba(255, 255, 255, 0.4); }

/* Liquid glass: a rim that bends what is behind it, its colours parting at the edge. */
.gg-liquid {
  justify-content: flex-end;
  padding: 12px;
  border-radius: 24px;
  background: glass;
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
}
`;

const discs: [number, number, number, string][] = [
  [-20, 10, 70, '#2563eb'],
  [90, 90, 50, '#f59e0b'],
  [170, -30, 80, '#dc2626'],
  [270, 70, 60, '#16a34a'],
  [360, 0, 50, '#9333ea'],
  [420, 80, 70, '#0891b2'],
  [530, 10, 60, '#db2777'],
  [600, 100, 50, '#65a30d'],
  [0, 190, 60, '#9333ea'],
  [110, 240, 70, '#16a34a'],
  [230, 180, 55, '#2563eb'],
  [320, 260, 65, '#f59e0b'],
  [430, 190, 60, '#dc2626'],
  [520, 260, 70, '#0891b2'],
  [610, 200, 45, '#db2777'],
  [-30, 380, 65, '#dc2626'],
  [100, 340, 55, '#0891b2'],
  [200, 400, 70, '#9333ea'],
  [330, 350, 50, '#16a34a'],
  [420, 400, 65, '#f59e0b'],
  [540, 350, 60, '#2563eb'],
  [40, 520, 70, '#db2777'],
  [200, 560, 60, '#0891b2'],
  [330, 510, 75, '#65a30d'],
  [480, 560, 65, '#dc2626'],
  [10, 740, 70, '#2563eb'],
  [130, 800, 55, '#f59e0b'],
  [230, 740, 65, '#dc2626'],
  [330, 810, 70, '#16a34a'],
  [440, 730, 60, '#9333ea'],
  [540, 800, 70, '#0891b2'],
];

const lines: [number, string][] = [
  [70, 'Behind the glass, behind the blur'],
  [240, 'Frosted glass, tinted from clear to dark'],
  [410, 'A colour over a backdrop blur'],
  [580, 'Liquid glass, edges bending what is behind'],
];

export default function GlassGallery() {
  useSheet(css, 'glass-gallery.css');
  return (
    <div class="gg-board">
      {discs.map(([x, y, r, colour]) => (
        <div
          class="gg-disc"
          style={{ left: x, top: y, width: r * 2, height: r * 2, background: colour }}
        />
      ))}
      {lines.map(([top, text]) => (
        <span class="gg-line" style={{ top }}>
          {text}
        </span>
      ))}
      {/* Clear to heavy: a backdrop filter blurs only what is behind the panel's own box. */}
      <div class="gg-row" style={{ top: 30 }}>
        {[0, 2, 4, 8, 16, 32].map((r) => (
          <div class="gg-panel" style={{ backdropFilter: `blur(${r}px)` }}>{`blur ${r}`}</div>
        ))}
      </div>
      {/* Frosted at one blur, tinted from none to strong, then dark. */}
      <div class="gg-row" style={{ top: 200 }}>
        {[0, 0.15, 0.3, 0.5, 0.8].map((a) => (
          <div
            class={a >= 0.15 ? 'gg-panel gg-frost gg-dark' : 'gg-panel gg-frost'}
            style={{ glassTint: `rgba(255, 255, 255, ${a})` }}
          >
            {`white ${a}`}
          </div>
        ))}
        <div
          class="gg-panel gg-frost"
          style={{ glassTint: 'rgba(0, 0, 0, 0.8)', borderColor: 'rgba(255, 255, 255, 0.2)' }}
        >
          black 0.8
        </div>
      </div>
      {/* A colour at an opacity over a backdrop blur, as Tailwind writes bg-white/30 backdrop-blur-md. */}
      <div class="gg-row" style={{ top: 370 }}>
        <div
          class="gg-panel"
          style={{ background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(4px)' }}
        >
          white/10 sm
        </div>
        <div
          class="gg-panel gg-dark"
          style={{
            background: 'rgba(255,255,255,0.3)',
            backdropFilter: 'blur(12px)',
            borderColor: 'rgba(255,255,255,0.4)',
          }}
        >
          white/30 md
        </div>
        <div
          class="gg-panel gg-dark"
          style={{
            background: 'rgba(255,255,255,0.6)',
            backdropFilter: 'blur(16px)',
            borderColor: 'rgba(255,255,255,0.5)',
          }}
        >
          white/60 lg
        </div>
        <div
          class="gg-panel"
          style={{
            background: 'rgba(0,0,0,0.4)',
            backdropFilter: 'blur(24px)',
            borderColor: 'rgba(255,255,255,0.2)',
          }}
        >
          black/40 xl
        </div>
        <div
          class="gg-panel"
          style={{
            background: 'color-mix(in srgb, var(--info) 30%, transparent)',
            backdropFilter: 'blur(40px)',
          }}
        >
          info/30 2xl
        </div>
        <div class="gg-panel" style={{ backdropFilter: 'blur(64px)' }}>
          3xl
        </div>
      </div>
      {/* Liquid: a light blur, a round lens, and a tinted slab. */}
      <div class="gg-row" style={{ top: 540, left: 24, width: 600, gap: 24 }}>
        <div
          class="gg-liquid"
          style={{
            width: 180,
            height: 140,
            glassBlur: '2px',
            glassTint: 'rgba(255,255,255,0.2)',
            glassAberration: '0.3',
          }}
        >
          liquid, light blur
        </div>
        <div
          class="gg-liquid"
          style={{
            width: 140,
            height: 140,
            borderRadius: 9999,
            glassBlur: '6px',
            glassTint: 'rgba(255,255,255,0.3)',
            glassAberration: '0.6',
          }}
        >
          liquid, round
        </div>
        <div
          class="gg-liquid"
          style={{
            width: 220,
            height: 140,
            glassBlur: '14px',
            glassTint: 'rgba(99, 102, 241, 0.5)',
            glassAberration: '1',
          }}
        >
          liquid, tinted
        </div>
      </div>
      <span class="gg-line" style={{ top: 714, fontSize: 20, color: '#0b0b0f' }}>
        Liquid rim: chromatic aberration
      </span>
      {/* Nearly clear, so only the rim is seen: it bends the line above and the discs, its
          colours parting more as aberration rises. */}
      <div class="gg-row" style={{ top: 754, gap: 16 }}>
        {[0, 0.3, 1].map((a) => (
          <div
            class="gg-liquid"
            style={{
              width: 192,
              height: 140,
              glassBlur: '1px',
              glassTint: 'rgba(255,255,255,0.05)',
              glassAberration: String(a),
              fontSize: 14,
            }}
          >
            {`aberration ${a}`}
          </div>
        ))}
      </div>
    </div>
  );
}
