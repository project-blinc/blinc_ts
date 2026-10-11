import type { HostElement } from 'blinc_ts/native/host';
import { For } from '#jsx/flow';
import { signal } from '#jsx/owner';
import { useSheet } from '../kit.js';

// Layout moves the cards; animateLayout draws each from where it was, easing to where it is.
const css = `
.cards { flex-direction: row; flex-wrap: wrap; gap: 10px; width: 520px; min-height: 140px; align-content: flex-start; }
.card { width: 120px; height: 60px; align-items: center; justify-content: center; border-radius: var(--radius-lg);
  color: #ffffff; font-weight: 700; box-shadow: var(--shadow-sm); }
`;

const colours = [
  '#6366f1',
  '#ec4899',
  '#f59e0b',
  '#10b981',
  '#0ea5e9',
  '#8b5cf6',
  '#ef4444',
  '#14b8a6',
];
interface Card {
  n: number;
  colour: string;
}

export default function MotionLayout() {
  useSheet(css, 'layout-motion.css');
  let next = 4;
  const cards = signal<Card[]>(
    [1, 2, 3, 4].map((n) => ({ n, colour: colours[n % colours.length]! })),
  );
  const shuffle = () => {
    const list = [...cards.get()];
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j]!, list[i]!];
    }
    cards.set(list);
  };
  return (
    <div class="wiki-col">
      <div class="wiki-row">
        <button
          onClick={() =>
            cards.set([{ n: ++next, colour: colours[next % colours.length]! }, ...cards.get()])
          }
        >
          Add first
        </button>
        <button onClick={() => cards.set(cards.get().slice(1))}>Remove first</button>
        <button onClick={shuffle}>Shuffle</button>
        <button onClick={() => cards.set([...cards.get()].sort((a, b) => a.n - b.n))}>Sort</button>
      </div>
      <div class="cards">
        <For each={cards}>
          {(card: Card) => (
            <div
              class="card"
              style={{ background: card.colour }}
              ref={(e: HostElement) => e.animateLayout({ duration: 360, easing: 'ease-in-out' })}
            >
              {`Card ${card.n}`}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
