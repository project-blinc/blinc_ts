const box = {
  width: 96,
  height: 72,
  borderRadius: 12,
  alignItems: 'center',
  justifyContent: 'center',
} as const;

export default function Paint() {
  return (
    <div class="wiki-row" style={{ gap: 18 }}>
      <div
        style={{ ...box, background: 'linear-gradient(135deg, #5a93ff, #c04fff)', color: 'white' }}
      >
        Gradient
      </div>
      <div
        style={{
          ...box,
          background: 'var(--surface-elevated)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        }}
      >
        Shadow
      </div>
      <div
        style={{
          ...box,
          background: '#ff8800',
          transform: 'rotate(-8deg) scale(0.9)',
          color: 'white',
        }}
      >
        Rotate
      </div>
      <div
        style={{
          ...box,
          background: '#2fb344',
          clipPath: 'polygon(50% 0, 100% 100%, 0 100%)',
          color: 'white',
        }}
      />
      <div
        style={{
          ...box,
          background: 'radial-gradient(circle at 30% 30%, #ffd24d, #ff5a5a 60%, #5a2a8a)',
          filter: 'saturate(0.6)',
        }}
      />
      <span style={{ textDecoration: 'underline', textDecorationColor: 'var(--error)' }}>
        Underlined
      </span>
    </div>
  );
}
