/** The reference scene's styles, shared by every adapter so they render the same thing. */
export const styles = {
  app: {
    width: 480,
    height: 320,
    padding: 16,
    flexDirection: 'column',
    gap: 12,
    background: '#101722',
    color: '#e8eef5',
    fontSize: 16,
  },
  header: {
    height: 48,
    padding: '0 16px',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: '#1f2b3a',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#3a5068',
  },
  button: { padding: '6px 12px', background: '#3d7eff', borderRadius: 8 },
  cards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    columnGap: 12,
    flexGrow: 1,
  },
  card: { padding: 12, background: '#243447', borderRadius: 10, position: 'relative' },
  first: { order: -1, background: '#2e4a3a' },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 12,
    height: 12,
    borderRadius: 6,
    background: '#ff6b6b',
  },
  footer: { margin: '0 auto', padding: '4px 8px', fontSize: 12 },
} as const;

/** What the event test records, in dispatch order. */
export type EventLog = string[];
