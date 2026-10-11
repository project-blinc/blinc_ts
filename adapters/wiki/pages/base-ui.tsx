/** The wiki's Base UI pages. */
import type { WikiPage } from '../page.js';
import { Example, Note, Page } from '../kit.js';
import Accordion from '../examples/disclosure.js';
import Overlays from '../examples/overlays.js';
import Tabs from '../examples/tabs.js';
import Toggles from '../examples/toggles.js';

export const baseUiPages: readonly WikiPage[] = [
  {
    id: 'parts',
    title: 'Parts',
    section: 'Base UI',
    view: () => (
      <Page title="Base UI parts" lead="Components that draw nothing of their own.">
        <p>
          A part is an element with a class and the state it is in as <code>data-</code> attributes;
          a sheet styles them from the theme. State is shared as a signal, as Base UI's{' '}
          <code>value</code> and <code>defaultValue</code> are: a signal you pass is read and
          written by the component, and a constant is the value held.
        </p>
        <Note>
          The parts are in <code>adapters/base-ui</code>, built on the reactive runtime and the
          host's top layer, and documented in <code>docs/base-ui.md</code>.
        </Note>
      </Page>
    ),
  },
  {
    id: 'toggles',
    title: 'Toggle, switch, checkbox',
    section: 'Base UI',
    view: () => (
      <Page title="Toggle, switch, checkbox" lead="Two-state buttons.">
        <p>
          Each is a button, so focus, Enter and Space come with it. They show their state as{' '}
          <code>data-checked</code> or <code>data-pressed</code>.
        </p>
        <Example name="toggles" view={Toggles} />
      </Page>
    ),
  },
  {
    id: 'tabs',
    title: 'Tabs',
    section: 'Base UI',
    view: () => (
      <Page title="Tabs" lead="One panel of several, chosen from a row.">
        <p>
          The arrows, Home and End move focus among the enabled tabs; Enter or Space chooses one, or
          focus does with <code>activateOnFocus</code>. Only the chosen tab is in the tab order.
        </p>
        <Example name="tabs" view={Tabs} />
      </Page>
    ),
  },
  {
    id: 'disclosure',
    title: 'Accordion, collapsible',
    section: 'Base UI',
    view: () => (
      <Page title="Accordion, collapsible" lead="Panels that open and close.">
        <p>
          An accordion holds the values of its open items, one at a time unless{' '}
          <code>multiple</code>. A panel is built only while it is open, unless{' '}
          <code>keepMounted</code>.
        </p>
        <Example name="disclosure" view={Accordion} />
      </Page>
    ),
  },
  {
    id: 'overlays',
    title: 'Tooltip, popover, dialog',
    section: 'Base UI',
    view: () => (
      <Page title="Tooltip, popover, dialog" lead="What opens over the page.">
        <p>
          An overlay's popup is built into the host's top layer while it is open, beside its trigger
          or in the middle, and is gone, with what it made, once it has closed. Escape and a press
          outside close it.
        </p>
        <Example name="overlays" view={Overlays} />
      </Page>
    ),
  },
];
