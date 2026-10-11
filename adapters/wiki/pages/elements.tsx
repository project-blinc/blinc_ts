/** The wiki's Elements pages. */
import type { WikiPage } from '../page.js';
import { Example, Page } from '../kit.js';
import Forms from '../examples/forms.js';
import SelectDialog from '../examples/select-dialog.js';
import Tables from '../examples/tables.js';
import TextFields from '../examples/text-fields.js';

export const elementsPages: readonly WikiPage[] = [
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
];
