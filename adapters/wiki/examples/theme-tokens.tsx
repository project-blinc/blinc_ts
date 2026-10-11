import {
  colorTokens,
  colorVariable,
  radiusTokens,
  shadowTokens,
  spacingTokens,
  textSizes,
} from 'blinc_ts/theme';

/** Each token drawn by the variable it becomes, so a change of scheme or theme redraws it here. */
export default function ThemeTokens() {
  return (
    <div class="wiki-col" style={{ width: '100%' }}>
      <span class="wiki-chip-label">Colours</span>
      <div class="wiki-grid">
        {colorTokens.map((token) => (
          <div class="wiki-swatch">
            <div class="wiki-swatch-fill" style={{ background: `var(${colorVariable(token)})` }} />
            <span class="wiki-mono">{colorVariable(token)}</span>
          </div>
        ))}
      </div>
      <span class="wiki-chip-label">Spacing</span>
      <div class="wiki-col">
        {spacingTokens
          .filter((step) => Number(step) >= 1 && Number(step) <= 16)
          .map((step) => (
            <div class="wiki-row">
              <span
                class="wiki-mono"
                style={{ width: 92 }}
              >{`--space-${step.replace('.', '-')}`}</span>
              <div
                style={{
                  width: `var(--space-${step.replace('.', '-')})`,
                  height: 'var(--space-2)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--primary)',
                }}
              />
            </div>
          ))}
      </div>
      <span class="wiki-chip-label">Radii</span>
      <div class="wiki-grid">
        {radiusTokens
          .filter((r) => r !== 'none')
          .map((r) => (
            <div class="wiki-swatch" style={{ width: 72 }}>
              <div
                class="wiki-swatch-fill"
                style={{
                  height: 56,
                  borderRadius: `var(--radius-${r})`,
                  background: 'var(--accent-subtle)',
                }}
              />
              <span class="wiki-mono">{r}</span>
            </div>
          ))}
      </div>
      <span class="wiki-chip-label">Shadows</span>
      <div class="wiki-grid" style={{ padding: 'var(--space-3)' }}>
        {shadowTokens
          .filter((s) => s !== 'none')
          .map((s) => (
            <div class="wiki-swatch" style={{ width: 92 }}>
              <div
                style={{
                  height: 56,
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--surface)',
                  boxShadow: `var(${s === 'default' ? '--shadow' : `--shadow-${s}`})`,
                }}
              />
              <span class="wiki-mono">{s}</span>
            </div>
          ))}
      </div>
      <span class="wiki-chip-label">Type</span>
      <div class="wiki-col">
        {textSizes.map((size) => (
          <span
            style={{ fontSize: `var(--text-${size})` }}
          >{`--text-${size} The quick brown fox`}</span>
        ))}
      </div>
    </div>
  );
}
