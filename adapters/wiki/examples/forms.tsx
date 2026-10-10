import type { HostElement } from 'blinc_ts/native/host';
import { signal } from '#jsx/owner';

export default function Forms() {
  const sent = signal('Nothing sent yet');
  const problem = signal('');
  return (
    <form
      class="wiki-col"
      style={{ width: 340 }}
      onSubmit={(event: { preventDefault(): void; target: unknown }) => {
        // Nothing is sent anywhere: the submit event is where an app takes what the form holds.
        event.preventDefault();
        sent.set(JSON.stringify(Object.fromEntries((event.target as HostElement).formData())));
      }}
    >
      <div class="wiki-field">
        <label for="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          onInput={(event: { target: unknown }) =>
            problem.set((event.target as HostElement).validationMessage)
          }
        />
        <span class="wiki-error">{problem}</span>
      </div>
      <div class="wiki-field">
        <label for="age">Age (18 to 120)</label>
        <input id="age" name="age" type="number" min="18" max="120" />
      </div>
      <div class="wiki-field">
        <label for="code">Code</label>
        <input id="code" name="code" pattern="[A-Z]{3}" placeholder="ABC" />
        <span class="wiki-hint">Three capital letters</span>
      </div>
      <div class="wiki-row">
        <button type="submit">Send</button>
        <button type="reset">Reset</button>
      </div>
      <span class="wiki-readout">{sent}</span>
    </form>
  );
}
