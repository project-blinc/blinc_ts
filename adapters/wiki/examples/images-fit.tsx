import { asset } from '../assets.js';

// A landscape photograph in portrait frames: object-fit decides what happens to the difference.
const frame = {
  width: 150,
  height: 210,
  flexShrink: 0,
  borderRadius: 'var(--radius-lg)',
  // The frame's own colour shows where a fit leaves room.
  background: 'var(--info-bg)',
  border: '1px solid var(--border)',
} as const;

const fits = [
  ['fill', 'stretched to the frame, out of shape'],
  ['contain', 'all of it, the rest of the frame left'],
  ['cover', 'the frame filled, the rest cut away'],
] as const;

export default function ImagesFit() {
  return (
    <div class="wiki-row" style={{ gap: 20, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
      {fits.map(([fit, what]) => (
        <div class="wiki-col" style={{ width: 170, gap: 6 }}>
          <img src={asset('album.webp')} alt="" style={{ ...frame, objectFit: fit }} />
          <span class="wiki-mono">{`object-fit: ${fit}`}</span>
          <span class="wiki-hint" style={{ width: '100%' }}>
            {what}
          </span>
        </div>
      ))}
    </div>
  );
}
