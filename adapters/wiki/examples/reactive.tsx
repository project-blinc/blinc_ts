import { For, Show } from '#jsx/flow';
import { computed, signal } from '#jsx/owner';

let next = 3;

export default function Reactive() {
  // A source is a signal, a computed value or a function: what depends on it updates, and nothing else.
  const count = signal(0);
  const double = computed(() => count.get() * 2);
  const items = signal<readonly { id: number; label: string }[]>([
    { id: 1, label: 'One' },
    { id: 2, label: 'Two' },
  ]);
  return (
    <div class="wiki-col">
      <div class="wiki-row">
        <button onClick={() => count.set(count.get() + 1)}>Count</button>
        <span class="wiki-readout">{() => `${count.get()} doubled is ${double.get()}`}</span>
        <Show
          when={() => count.get() > 2}
          fallback={<span class="wiki-hint">Press it three times</span>}
        >
          <span class="wiki-readout">Past two</span>
        </Show>
      </div>
      <div class="wiki-row">
        <button onClick={() => items.set([...items.get(), { id: next, label: `Item ${next++}` }])}>
          Add
        </button>
        <button onClick={() => items.set(items.get().slice(1))}>Remove first</button>
        <button onClick={() => items.set([...items.get()].reverse())}>Reverse</button>
      </div>
      <ul>
        <For each={items} fallback={<li>Empty</li>}>
          {(item, index) => <li>{() => `${item.label}, number ${index() + 1}`}</li>}
        </For>
      </ul>
    </div>
  );
}
