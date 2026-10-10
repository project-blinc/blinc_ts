const art = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90"><rect width="160" height="90" fill="#5a93ff"/><circle cx="50" cy="45" r="28" fill="#ffd24d"/><path d="M80 90 L120 30 L160 90Z" fill="#2fb344"/></svg>',
)}`;

const frame = {
  width: 120,
  height: 120,
  border: '1px solid var(--border)',
  borderRadius: 8,
} as const;

export default function Images() {
  return (
    <div class="wiki-row" style={{ gap: 18, alignItems: 'flex-start' }}>
      {(['fill', 'contain', 'cover'] as const).map((fit) => (
        <div class="wiki-col" style={{ alignItems: 'center' }}>
          <img src={art} style={{ ...frame, objectFit: fit }} />
          <span class="wiki-hint">{fit}</span>
        </div>
      ))}
      <div class="wiki-col" style={{ alignItems: 'center' }}>
        <div style={{ ...frame, backgroundImage: `url("${art}")`, backgroundSize: 'cover' }} />
        <span class="wiki-hint">background</span>
      </div>
    </div>
  );
}
