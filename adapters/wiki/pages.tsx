/** The wiki's pages: prose, with live examples beside the source that makes them. */
import type { Child } from '#jsx/jsx-runtime';
import { Example, Note, Page } from './kit.js';
import Accordion from './examples/disclosure.js';
import Forms from './examples/forms.js';
import Images from './examples/images.js';
import Motion from './examples/motion.js';
import Overlays from './examples/overlays.js';
import Paint from './examples/paint.js';
import Reactive from './examples/reactive.js';
import SelectDialog from './examples/select-dialog.js';
import Tables from './examples/tables.js';
import Tabs from './examples/tabs.js';
import TextFields from './examples/text-fields.js';
import Toggles from './examples/toggles.js';

export interface WikiPage {
  readonly id: string;
  readonly title: string;
  readonly section: string;
  readonly view: () => Child;
}

export const pages: readonly WikiPage[] = [
  {
    id: 'overview',
    title: 'Overview',
    section: 'Start',
    view: () => (
      <Page
        title="blinc_ts"
        lead="A TypeScript SDK for the Blinc UI framework: a reactive scene in Rust, drawn with TypeGPU."
      >
        <p>
          This wiki is a Blinc app. Everything on it is built from the parts it describes, so each
          example is live: use it, then read the source on the next tab.
        </p>
        <h2>How it is built</h2>
        <p>
          A host holds a tree of elements, as a browser's document does. A user-agent stylesheet
          gives them looks and the host gives them behaviour: buttons submit forms, a select opens a
          list, text is edited in place. CSS, parsed and applied in Rust, styles the tree from a
          theme's variables.
        </p>
        <p>
          Views are JSX on a small reactive runtime. A prop or a child given as a signal, a computed
          value or a function follows it, and only what depends on it updates.
        </p>
        <Note>
          The examples run in this window, so a click is a real press on a real element. Try the
          dark scheme with the switch under the navigation.
        </Note>
      </Page>
    ),
  },
  {
    id: 'reactive',
    title: 'Reactive views',
    section: 'Start',
    view: () => (
      <Page title="Reactive views" lead="Signals, and what depends on them.">
        <p>
          A view is built once. What changes later is a prop or a child given as a source: a signal,
          a computed value or a function of them. Text is rewritten in place, and anything else
          rebuilds only its own part: <code>Show</code> for a condition, <code>For</code> for a list
          that keeps what it built for each item.
        </p>
        <Example name="reactive" view={Reactive} />
        <p>
          Components run under an owner, so a signal, an effect or an <code>onCleanup</code> they
          make ends with the part of the view that holds them.
        </p>
      </Page>
    ),
  },
  {
    id: 'forms',
    title: 'Forms and validity',
    section: 'Elements',
    view: () => (
      <Page title="Forms and validity" lead="Controls hold what they must, and a form checks them.">
        <p>
          A form owns its controls and a button submits it. A control is checked for{' '}
          <code>required</code>, <code>pattern</code>, length, a well-formed email or URL, and a
          number's bounds and step. Invalid controls match <code>:invalid</code>, and once the user
          has changed one and left it, <code>:user-invalid</code>.
        </p>
        <Example name="forms" view={Forms} />
        <p>
          An invalid form is not submitted: each control shows as the user's, the first takes focus,
          and no <code>submit</code> event fires.
        </p>
      </Page>
    ),
  },
  {
    id: 'text',
    title: 'Text fields',
    section: 'Elements',
    view: () => (
      <Page
        title="Text fields"
        lead="Text is edited in place, with a caret, a selection and an input method."
      >
        <p>
          An <code>input</code> and a <code>textarea</code> take presses, drags, the arrows, the
          clipboard, undo and an input method's composition. <code>maxlength</code> cuts what is
          typed or pasted; a number takes only the characters a number is written with.
        </p>
        <Example name="text-fields" view={TextFields} />
      </Page>
    ),
  },
  {
    id: 'select',
    title: 'Select and dialog',
    section: 'Elements',
    view: () => (
      <Page
        title="Select and dialog"
        lead="A list that opens under a control, and a modal that closes with a reason."
      >
        <p>
          A <code>select</code> shows its chosen option and opens the rest as a list in the top
          layer: arrows, typing and Enter choose. A <code>dialog</code> opens modally with{' '}
          <code>showModal()</code>, keeps focus inside, closes on Escape, and a form of{' '}
          <code>method="dialog"</code> closes it with the button's value as its{' '}
          <code>returnValue</code>.
        </p>
        <Example name="select-dialog" view={SelectDialog} />
      </Page>
    ),
  },
  {
    id: 'tables',
    title: 'Tables and lists',
    section: 'Elements',
    view: () => (
      <Page title="Tables and lists" lead="Columns line up, and markers keep count.">
        <p>
          Every row of a table is a grid of the table's columns, so they line up, with{' '}
          <code>colspan</code>. A list item has a marker by depth, or a number from{' '}
          <code>start</code>, kept right as items come and go.
        </p>
        <Example name="tables" view={Tables} />
      </Page>
    ),
  },
  {
    id: 'paint',
    title: 'Paint',
    section: 'Styling',
    view: () => (
      <Page title="Paint" lead="CSS is parsed in Rust and drawn by the GPU.">
        <p>
          Gradients, shadows, transforms, filters, masks, clips, glass and text decoration are
          written as CSS and drawn natively.
        </p>
        <Example name="paint" view={Paint} />
      </Page>
    ),
  },
  {
    id: 'motion',
    title: 'Motion',
    section: 'Styling',
    view: () => (
      <Page
        title="Motion"
        lead="A change eases, and a keyframe animation runs without the main thread."
      >
        <p>
          A property with a <code>transition</code> eases to its new value when it changes, whatever
          changed it. Keyframes animate on their own.
        </p>
        <Example name="motion" view={Motion} />
      </Page>
    ),
  },
  {
    id: 'images',
    title: 'Images',
    section: 'Styling',
    view: () => (
      <Page title="Images" lead="Decoded off the main thread and drawn at the size they cover.">
        <p>
          An <code>img</code> and a <code>url()</code> background load from a path, a URL or a data
          URI, in PNG, JPEG, GIF, WebP or SVG. <code>object-fit</code> is <code>fill</code>,{' '}
          <code>contain</code> or <code>cover</code>.
        </p>
        <Example name="images" view={Images} />
      </Page>
    ),
  },
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
