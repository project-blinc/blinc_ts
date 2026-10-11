/** Liquid glass as a brush, with what CSS's glass properties do not yet say: saturation, brightness and a rim. */
import { Brush } from 'blinc_ts/native';
import type { HostElement } from 'blinc_ts/native/host';

export function glassCard(card: HostElement): void {
  card.setProperty(
    'background',
    // A blur of 6, a white tint at 8%, then what the backdrop is made into before the tint.
    Brush.glass(6, 0xffffff, 0.08, {
      bevel: 0.6, // how wide the refracting rim is, and how far it bends
      aberration: 0.3, // how far the colours part at the rim
      inset: false, // the rim curves outward; true curves it in
      saturation: 1.4,
      brightness: 1.05,
      borderThickness: 1.5,
      borderColor: [1, 1, 1, 0.5],
      noise: 0.04, // grain, as frosted glass has
      simple: false, // true is frosted: blur and tint, no refraction
    }),
  );
}
