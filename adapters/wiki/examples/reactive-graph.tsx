import type { ReactiveContext } from 'blinc_ts/native';
import type { HostElement, HostText } from 'blinc_ts/native/host';
import { onCleanup, useHost } from '#jsx/owner';

// The SDK's reactive graph on its own, with no framework: a signal, a computed value, and an effect
// that writes two texts, once for each write and once for a batch of them. A graph's items are made
// and read only while no other graph is running, so it is set up just after the view is built.
export default function ReactiveGraph() {
  const host = useHost();
  let line: HostText | undefined;
  let runs: HostText | undefined;
  let graph: ReactiveContext | undefined;
  let add: (n: number, batched: boolean) => void = () => {};
  queueMicrotask(() => {
    const g = host.native!.createReactive();
    graph = g;
    const count = g.signal(0);
    const doubled = g.computed(() => count.get() * 2);
    let ran = 0;
    g.effect(() => {
      line!.data = `count ${count.get()}, doubled ${doubled.get()}`;
      runs!.data = `the effect has run ${++ran} times`;
    });
    add = (n, batched) => {
      const write = () => {
        for (let i = 0; i < n; i++) {
          count.set(count.peek() + 1);
        }
      };
      if (batched) {
        g.batch(write);
      } else {
        write();
      }
    };
  });
  // Ended just after the view is, for the same reason.
  onCleanup(() => queueMicrotask(() => graph?.dispose()));
  return (
    <div class="wiki-col">
      <div class="wiki-row">
        <button onClick={() => add(1, false)}>Add one</button>
        <button onClick={() => add(2, false)}>Add two</button>
        <button onClick={() => add(2, true)}>Add two in a batch</button>
      </div>
      <span
        class="wiki-readout"
        style={{ width: 260 }}
        ref={(e: HostElement) => {
          line = e.firstChild as HostText;
        }}
      >
        {'count 0'}
      </span>
      <span
        class="wiki-readout"
        style={{ width: 260 }}
        ref={(e: HostElement) => {
          runs = e.firstChild as HostText;
        }}
      >
        {'the effect has run 0 times'}
      </span>
    </div>
  );
}
