import { asset } from '../assets.js';
import { useSheet } from '../kit.js';

// Liquid glass bars over a page that scrolls under them: the rims bend the photographs and the
// type as they pass, and the clear middles show them as they are. Scroll inside the frame.
const css = `
.gs-frame { position: relative; align-self: stretch; height: 440px; flex-shrink: 0; overflow: hidden; border-radius: 16px; background: #0b0b0f; }
.gs-page { width: 100%; height: 100%; overflow-y: auto; scrollbar-width: none; }
.gs-content { gap: 18px; padding: 96px 28px 120px 28px; color: #ffffff; }
.gs-photo { width: 100%; height: 220px; flex-shrink: 0; border-radius: 22px; object-fit: cover; }
.gs-title { font-size: 40px; font-weight: 800; line-height: 1.1; }
.gs-text { font-size: 17px; line-height: 1.6; color: rgba(255, 255, 255, 0.82); }
.gs-stripes { flex-direction: row; gap: 10px; align-self: stretch; height: 80px; flex-shrink: 0; }
.gs-stripe { flex: 1; border-radius: 12px; }

/* The bars: nearly clear, a strong rim, the colours parting at the edge. */
.gs-glass {
  position: absolute;
  background: glass;
  glass-blur: 2px;
  glass-bevel: 0.9;
  glass-aberration: 0.45;
  glass-tint: rgba(255, 255, 255, 0.06);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
  flex-direction: row;
  align-items: center;
  color: #ffffff;
  font-weight: 700;
}
.gs-top { left: 16px; right: 16px; top: 14px; height: 56px; padding: 0 20px; gap: 12px; border-radius: 9999px; }
.gs-dock { left: 50%; bottom: 18px; width: 280px; margin-left: -140px; height: 72px; padding: 0 14px; justify-content: space-between; border-radius: 28px; }
.gs-dot { width: 46px; height: 46px; border-radius: 9999px; background: glass; glass-blur: 0px; glass-bevel: 1; glass-aberration: 0.6; glass-tint: rgba(255, 255, 255, 0.1); }
`;

const colours = ['#2563eb', '#f59e0b', '#dc2626', '#16a34a', '#9333ea', '#0891b2', '#db2777'];

export default function GlassScroll() {
  useSheet(css, 'glass-scroll.css');
  return (
    <div class="gs-frame">
      <div class="gs-page">
        <div class="gs-content">
          <span class="gs-title">Scroll, and watch the rims</span>
          <img class="gs-photo" src={asset('planet.webp')} alt="" />
          <span class="gs-text">
            What passes under the bar at the top and the dock at the bottom is bent at their edges,
            more the stronger the bevel, its colours parting with the aberration. In the middle the
            glass is all but clear.
          </span>
          <div class="gs-stripes">
            {colours.map((c) => (
              <div class="gs-stripe" style={{ background: c }} />
            ))}
          </div>
          <img class="gs-photo" src={asset('album.webp')} alt="" />
          <span class="gs-title">Type bends too</span>
          <img class="gs-photo" src={asset('plains.webp')} alt="" />
          <div class="gs-stripes">
            {[...colours].reverse().map((c) => (
              <div class="gs-stripe" style={{ background: c }} />
            ))}
          </div>
        </div>
      </div>
      <div class="gs-glass gs-top">
        <span>Glass</span>
        <span style={{ fontWeight: 500, opacity: 0.8 }}>over a page that moves</span>
      </div>
      <div class="gs-glass gs-dock">
        <div class="gs-dot" />
        <div class="gs-dot" />
        <div class="gs-dot" />
        <div class="gs-dot" />
      </div>
    </div>
  );
}
