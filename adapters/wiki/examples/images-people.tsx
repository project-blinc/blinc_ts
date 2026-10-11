import { asset } from '../assets.js';
import { useSheet } from '../kit.js';

// A photograph of a person, as an app uses one: an avatar at its sizes, a stack, a profile. Each
// avatar is a round frame that clips its image, so a border or a ring sits around the photograph.
const css = `
.av { flex-shrink: 0; border-radius: 9999px; overflow: hidden; }
.av > img { width: 100%; height: 100%; object-fit: cover; }
.av-ring { padding: 3px; border-radius: 9999px; background: linear-gradient(135deg, #f59e0b, #db2777, #6366f1); }
.av-ring > .av { border: 3px solid var(--surface); }
.av-status { position: relative; }
.av-dot { position: absolute; right: 2px; bottom: 2px; width: 14px; height: 14px; border-radius: 9999px; border: 2px solid var(--surface); background: #16a34a; }
.av-stack { flex-direction: row; }
.av-stack > .av { width: 44px; height: 44px; margin-left: -12px; border: 3px solid var(--surface); }
.av-stack > .av:first-child { margin-left: 0; }
.av-more { width: 44px; height: 44px; margin-left: -12px; align-items: center; justify-content: center; border-radius: 9999px; border: 3px solid var(--surface); background: var(--accent-subtle); font-size: 13px; font-weight: 700; }
.profile { width: 300px; flex-shrink: 0; border: 1px solid var(--border); border-radius: var(--radius-xl); background: var(--surface); box-shadow: var(--shadow-md); overflow: hidden; }
.profile-cover { width: 100%; height: 96px; object-fit: cover; }
.profile-body { gap: 2px; padding: 0 18px 18px 18px; }
.profile-body > .av { width: 84px; height: 84px; margin-top: -42px; border: 4px solid var(--surface); }
.profile-name { margin-top: 6px; font-size: 18px; font-weight: 700; }
.profile-role { font-size: 14px; color: var(--text-secondary); }
`;

export default function ImagesPeople() {
  useSheet(css, 'people.css');
  const face = asset('avatar.jpg');
  return (
    <div class="wiki-row" style={{ gap: 32, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
      <div class="wiki-col" style={{ gap: 18 }}>
        <div class="wiki-row" style={{ alignItems: 'flex-end', gap: 14 }}>
          {[28, 40, 56, 80].map((size) => (
            <div class="av" style={{ width: size, height: size }}>
              <img src={face} alt="" />
            </div>
          ))}
        </div>
        <div class="wiki-row" style={{ gap: 18 }}>
          <div class="av-ring">
            <div class="av" style={{ width: 72, height: 72 }}>
              <img src={face} alt="" />
            </div>
          </div>
          <div class="av-status">
            <div class="av" style={{ width: 72, height: 72 }}>
              <img src={face} alt="" />
            </div>
            <div class="av-dot" />
          </div>
        </div>
        <div class="av-stack">
          {[0, 1, 2, 3].map((i) => (
            <div class="av">
              <img src={face} alt="" style={{ filter: `hue-rotate(${i * 70}deg)` }} />
            </div>
          ))}
          <div class="av-more">+8</div>
        </div>
      </div>
      <div class="profile">
        <img class="profile-cover" src={asset('planet.webp')} alt="" />
        <div class="profile-body">
          <div class="av">
            <img src={face} alt="" />
          </div>
          <span class="profile-name">Ada Okafor</span>
          <span class="profile-role">Designs the glass, draws the planets</span>
        </div>
      </div>
    </div>
  );
}
