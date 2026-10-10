import type { HostElement } from 'blinc_ts/native/host';
import { signal } from '#jsx/owner';

export default function SelectDialog() {
  const fruit = signal('apple');
  const answer = signal('(not asked)');
  let dialog: HostElement | undefined;
  return (
    <div class="wiki-col">
      <div class="wiki-row">
        <select
          name="fruit"
          onChange={(event: { target: unknown }) => fruit.set((event.target as HostElement).value)}
        >
          <option value="apple">Apple</option>
          <option value="banana">Banana</option>
          <optgroup label="Citrus">
            <option value="lemon">Lemon</option>
            <option value="lime" disabled>
              Lime (none left)
            </option>
          </optgroup>
        </select>
        <span class="wiki-readout">fruit = {fruit}</span>
      </div>
      <div class="wiki-row">
        <button onClick={() => dialog?.showModal()}>Ask</button>
        <span class="wiki-readout">answer = {answer}</span>
      </div>
      <dialog
        ref={(element: HostElement) => (dialog = element)}
        onClose={(event: { target: unknown }) =>
          answer.set((event.target as HostElement).returnValue)
        }
      >
        <h3>Take the {fruit}?</h3>
        <form method="dialog" class="wiki-row">
          <button value="no">No</button>
          <button value="yes">Yes</button>
        </form>
      </dialog>
    </div>
  );
}
