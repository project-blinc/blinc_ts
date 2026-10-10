import type { HostElement } from 'blinc_ts/native/host';
import { signal } from '#jsx/owner';

export default function TextFields() {
  const text = signal('');
  const note = signal('First line\nSecond line');
  const read = (event: { target: unknown }) => (event.target as HostElement).value;
  return (
    <div class="wiki-col" style={{ width: 340 }}>
      <div class="wiki-field">
        <label for="name">Name</label>
        <input
          id="name"
          placeholder="Type here"
          maxlength="20"
          onInput={(e: { target: unknown }) => text.set(read(e))}
        />
        <span class="wiki-hint">At most 20 characters; undo with the platform shortcut</span>
      </div>
      <div class="wiki-field">
        <label for="secret">Password</label>
        <input id="secret" type="password" value="hunter2" />
      </div>
      <div class="wiki-field">
        <label for="count">Number</label>
        <input id="count" type="number" value="3" min="0" max="10" step="1" />
        <span class="wiki-hint">Arrow keys and the steppers move it by step</span>
      </div>
      <div class="wiki-field">
        <label for="notes">Notes</label>
        <textarea
          id="notes"
          style={{ height: 90 }}
          onInput={(e: { target: unknown }) => note.set(read(e))}
        >
          {note.peek()}
        </textarea>
      </div>
      <span class="wiki-readout">name = {() => JSON.stringify(text.get())}</span>
      <span class="wiki-readout">notes = {() => String(note.get().split('\n').length)} lines</span>
    </div>
  );
}
