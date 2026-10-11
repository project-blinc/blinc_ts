import { asset } from '../assets.js';

// A url() background, as background-size has it: cover, contain, stretched, or tiled at its size.
const tile = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><rect width="28" height="28" fill="#eef2ff"/><circle cx="14" cy="14" r="6" fill="#6366f1"/><path d="M0 0h6v6H0z" fill="#f59e0b"/></svg>',
)}`;

const sizes = [
  ['cover', asset('avatar.jpg'), 'the box filled, the rest cut away'],
  ['contain', asset('avatar.jpg'), 'all of it, the box showing beside'],
  ['100% 100%', asset('avatar.jpg'), 'stretched to the box, out of shape'],
  ['auto (repeat)', tile, 'repeated at its own size'],
] as const;

export default function ImagesBackgrounds() {
  return (
    <div class="wiki-grid">
      {sizes.map(([size, source, what]) => (
        <div class="wiki-col" style={{ width: 220, gap: 6 }}>
          <div
            style={{
              width: 220,
              height: 120,
              flexShrink: 0,
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--info-bg)',
              backgroundImage: `url("${source}")`,
              ...(size === 'auto (repeat)' ? {} : { backgroundSize: size }),
            }}
          />
          <span class="wiki-mono">{`background-size: ${size}`}</span>
          <span class="wiki-hint" style={{ width: '100%' }}>
            {what}
          </span>
        </div>
      ))}
    </div>
  );
}
