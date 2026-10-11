/** Plain elements, no classes: what the user-agent sheet gives each. */
export default function UserAgent() {
  return (
    <div style={{ width: '100%', gap: 'var(--space-3)' }}>
      <h1>Heading one</h1>
      <h2>Heading two</h2>
      <h3>Heading three</h3>
      <p>
        A paragraph with <strong>strong</strong>, <em>emphasis</em>, <code>code</code>,{' '}
        <kbd>Ctrl</kbd> <kbd>K</kbd>, <mark>marked</mark>, <a href="#user-agent">a link</a>,{' '}
        <abbr title="user agent">UA</abbr>, <s>struck</s>, <u>underlined</u> and{' '}
        <small>small</small> text.
      </p>
      <blockquote>A quotation, set off from the text around it.</blockquote>
      <hr />
      <div class="wiki-row">
        <ul>
          <li>A list</li>
          <li>
            Nested
            <ul>
              <li>By depth</li>
            </ul>
          </li>
        </ul>
        <ol start="3">
          <li>Counted</li>
          <li>From three</li>
        </ol>
      </div>
      <div class="wiki-row">
        <button>Button</button>
        <button disabled>Disabled</button>
        <input type="text" placeholder="Text" aria-label="Text" />
        <input type="number" value="4" aria-label="Number" />
      </div>
      <div class="wiki-row">
        <label>
          <input type="checkbox" checked /> Checkbox
        </label>
        <label>
          <input type="radio" name="ua-radio" checked /> One
        </label>
        <label>
          <input type="radio" name="ua-radio" /> Two
        </label>
        <input type="range" value="60" aria-label="Range" />
      </div>
      <div class="wiki-row">
        <progress value="70" max="100" />
        <progress />
        <meter value="0.3" low="0.25" high="0.75" optimum="0.9" />
        <select aria-label="Select">
          <option>Select</option>
          <option>Another</option>
        </select>
      </div>
      <details>
        <summary>Details</summary>
        <p>Opened by its summary, a chevron turning with it.</p>
      </details>
      <fieldset>
        <legend>Fieldset</legend>
        <input type="text" placeholder="Inside a fieldset" aria-label="Inside" />
      </fieldset>
    </div>
  );
}
