/** The wiki's Elements pages. */
import type { WikiPage } from '../page.js';
import { Example, Page, Table } from '../kit.js';
import Controls from '../examples/controls.js';
import Events from '../examples/events.js';
import InlineFlow from '../examples/inline-flow.js';
import Scrolling from '../examples/scrolling.js';
import TopLayerExample from '../examples/top-layer.js';
import TreeExample from '../examples/tree.js';
import Forms from '../examples/forms.js';
import SelectDialog from '../examples/select-dialog.js';
import Tables from '../examples/tables.js';
import TextFields from '../examples/text-fields.js';

export const elementsPages: readonly WikiPage[] = [
  {
    id: 'tree',
    title: 'The tree and owned parts',
    section: 'Elements',
    view: () => (
      <Page
        title="The tree and owned parts"
        lead="Elements, texts and placeholders, as a document has them, and the parts the host adds."
      >
        <p>
          <code>host.createElement(tag)</code> makes an element: the built-in tags in{' '}
          <code>builtinTags</code> come with behaviour and user-agent looks, and any other valid
          name makes a plain box. <code>createTextNode</code> makes text, which inherits colour and
          type from its element, and <code>createComment</code> a placeholder that takes no room.
          The tree's links, <code>parentNode</code>, <code>firstChild</code>,{' '}
          <code>nextSibling</code> and the rest, are kept as edits are made.
        </p>
        <Example name="tree" title="What a framework sees" view={TreeExample} />
        <p>
          A part an element needs, a list item's marker, a select's value and chevron, a range's
          thumb, a text field's caret, is an <b>owned</b> element: in the native tree and the
          cascade, styled by its class, hit and hovered as its owner, but not among{' '}
          <code>childNodes</code>. A framework that replaces an element's children whenever it
          renders never sees it and never removes it, and no structural selector counts it.{' '}
          <code>host.ownedElement(parent, tag, classes)</code> makes one; <code>element.owner</code>{' '}
          is what a part was made for.
        </p>
      </Page>
    ),
  },
  {
    id: 'events',
    title: 'Events and input',
    section: 'Elements',
    view: () => (
      <Page
        title="Events and input"
        lead="Pointer, keys, focus and wheel, dispatched as the DOM does."
      >
        <p>
          A mounted host feeds <code>host.input</code> from its window; tests and other hosts call
          it directly. Events run the capture, target and bubble phases, with{' '}
          <code>stopPropagation</code>, <code>stopImmediatePropagation</code> and{' '}
          <code>preventDefault</code>, and listeners take <code>capture</code>, <code>once</code>,{' '}
          <code>passive</code> and <code>signal</code>.
        </p>
        <Example name="events" title="Everything that reaches a box" view={Events} />
        <Table
          head={['Input', 'Events']}
          rows={[
            [
              'Pointer',
              'pointermove, pointerenter and pointerleave, pointerover and pointerout, pointerdown, pointerup, click (detail counts quick presses), dblclick',
            ],
            [
              'Capture',
              'element.setPointerCapture(): later pointer events go to it until release, as a drag needs',
            ],
            [
              'Focus',
              'a press focuses the nearest focusable element; Tab and Shift Tab move, positive tabindex first; focus, blur, focusin, focusout',
            ],
            [
              'Keys',
              'keydown and keyup at the focused element, with key, code and modifiers; Enter and Space click it unless cancelled; textinput; composition events for input methods',
            ],
            [
              'Wheel',
              'wheel, then the innermost scroll container that can take it scrolls, passing what it cannot to those around it',
            ],
            [
              'Clipboard',
              'copy, cut and paste at the focused element on the platform shortcuts, with event.clipboard',
            ],
            ['Cursor', 'the cursor property of what is under the pointer, shown by the window'],
          ]}
        />
        <p>
          An element's hover, active, focus, focus-visible, focus-within and disabled states are
          kept by the host for the cascade. States the host does not track, <code>checked</code> on
          a component of your own, are given with <code>element.setState(name, on)</code>, so{' '}
          <code>:checked</code> matches. Quiet pointer movement over the same region makes no native
          call.
        </p>
      </Page>
    ),
  },
  {
    id: 'controls',
    title: 'Controls',
    section: 'Elements',
    view: () => (
      <Page
        title="Controls"
        lead="Checkboxes, radios, ranges, progress, meters, details: built in, as HTML's are."
      >
        <Example name="controls" view={Controls} />
        <p>
          A checkbox or radio is checked by a click, by Space while it has focus, or by a click on
          its label, announcing <code>input</code> then <code>change</code>; radios of one{' '}
          <code>name</code> are a set, and the arrows move through it. <code>indeterminate</code> is
          a state a click clears. A range follows a press and a drag, with the pointer captured,
          steps on the arrows, Page Up and Down and Home and End, and keeps to <code>step</code>{' '}
          from <code>min</code>. A <code>progress</code> with no value is indeterminate and pulses;
          a <code>meter</code>'s bar is optimum, suboptimum or even less good by where its value
          falls. A <code>details</code> opens on its summary.
        </p>
        <p>
          Each draws with owned parts the user-agent sheet styles: a check, a dash, a dot, a fill, a
          thumb, a bar, a marker. A label clicks its control, and a fieldset that is disabled
          disables what it holds.
        </p>
      </Page>
    ),
  },
  {
    id: 'scrolling',
    title: 'Scrolling',
    section: 'Elements',
    view: () => (
      <Page
        title="Scrolling"
        lead="Containers that scroll, thumbs that show how far, and scrolling into view."
      >
        <Example name="scrolling" view={Scrolling} />
        <p>
          An element with <code>overflow: auto</code> or <code>scroll</code> scrolls: the wheel
          moves the nearest container that can, and <code>scrollTo</code>, <code>scrollBy</code> and{' '}
          <code>scrollIntoView({'{ block, inline }'})</code> move it, each dispatching{' '}
          <code>scroll</code>. <code>scrollTop</code>, <code>scrollHeight</code>,{' '}
          <code>clientHeight</code> and their horizontal partners read where it is.
        </p>
        <p>
          A thumb is drawn along each axis that overflows. <code>scrollbar-color</code> colours it,{' '}
          <code>scrollbar-width: none</code> hides it, and <code>scrollbar-visibility</code> says
          when it shows: <code>always</code>, <code>auto</code> (while scrolling, fading after),{' '}
          <code>hover</code>, or <code>hidden</code>. The fade is the host's own timer, asking for
          only the frames it needs.
        </p>
      </Page>
    ),
  },
  {
    id: 'top-layer',
    title: 'Top layer and placement',
    section: 'Elements',
    view: () => (
      <Page
        title="Top layer and placement"
        lead="Popovers, menus, sheets and dialogs: over everything, hit first, clipped by nothing."
      >
        <Example name="top-layer" view={TopLayerExample} />
        <p>
          <code>TopLayer.of(host).open(content, options)</code> puts an element above everything
          else, beside a backdrop as large as the root. A press on the backdrop, or Escape, closes a
          dismissible entry; <code>modal</code> dims the page, keeps Tab inside and gives focus back
          as it closes; <code>modeless</code> has no backdrop, so the page keeps its presses, and a
          press or focus outside it closes it; <code>passThrough</code> takes no presses, for a
          tooltip. Closing puts <code>closing</code> on it, so a sheet can animate it away, and{' '}
          <code>entry.close()</code> resolves once that has played.
        </p>
        <p>
          <code>placement</code> says where: <code>center()</code>, <code>below(anchor)</code> (at
          least as wide, as a select's list), <code>beside(anchor, side, {'{ align, gap }'})</code>,{' '}
          <code>edge(side)</code> for a sheet, and <code>at(x, y)</code> for a context menu. A box
          goes to the other side where there is no room, stays inside the root, follows its anchor
          after each layout, and says where it went on <code>data-side</code>.
        </p>
      </Page>
    ),
  },
  {
    id: 'inline',
    title: 'Inline text',
    section: 'Elements',
    view: () => (
      <Page title="Inline text" lead="Text and inline elements wrapped together, as a paragraph.">
        <Example name="inline-flow" view={InlineFlow} />
        <p>
          A <code>p</code>, a heading, a list item, a cell, or a <code>div</code> of prose that
          holds inline elements (<code>a</code>, <code>strong</code>, <code>em</code>,{' '}
          <code>span</code>, <code>code</code>, <code>kbd</code>, …) lays its content out as one
          paragraph: wrapped together at its width, each line on one baseline whatever its fonts,
          whitespace collapsing as HTML's does, and <code>text-align</code> read from it or above.
          An element that paints a box, <code>code</code> or <code>kbd</code>, is kept whole. So is
          one that says <code>display: inline-block</code>, <code>inline-flex</code> or{' '}
          <code>inline-grid</code>, whatever its tag: a badge or a chip is a box in the line, as big
          as its own layout makes it, on the baseline of its first text, wrapping with the words
          around it. <code>display: inline</code> makes any element part of the line, as a{' '}
          <code>span</code> is, and <code>display: block</code> on a <code>span</code> takes a line
          of its own, as a <code>div</code> does. The elements stay in the tree, so CSS styles them
          and they take input: a press anywhere on a wrapped link is a press on the link.
        </p>
        <p>
          A word too long for its line runs past the box. <code>overflow-wrap: anywhere</code> or{' '}
          <code>break-word</code> (also written <code>word-wrap</code>), or{' '}
          <code>word-break: break-all</code>, breaks it inside, however many lines it takes, and
          lets the box be narrower than its longest word. They are inherited, and text under one is
          laid out as a flow so it can break.
        </p>
        <p>
          Not done yet: hyphenation, <code>white-space: pre-wrap</code> inside a paragraph,{' '}
          <code>float</code>, and the raised baseline of <code>sub</code> and <code>sup</code>.
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
          layer: arrows, typing and Enter choose. With <code>multiple</code> or <code>size</code>
          greater than one, its options stay in a scrolling list. Ctrl/Cmd toggles options, Shift
          extends a range, and a form submits every selected enabled value. A <code>
            dialog
          </code>{' '}
          opens modally with <code>showModal()</code>, keeps focus inside, closes on Escape, and a
          form of <code>method="dialog"</code> closes it with the button's value as its{' '}
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
          <code>colspan</code> across columns and <code>rowspan</code> across rows of a section. A
          list item has a marker by depth, or a number from <code>start</code>, kept right as items
          come and go.
        </p>
        <Example name="tables" view={Tables} />
      </Page>
    ),
  },
];
