/** The wiki's pages: prose, with live examples beside the source that makes them. */
import type { Child } from '#jsx/jsx-runtime';
import { Example, Note, Page, SourceView } from './kit.js';
import HandWritten from './examples/adapter-h.js';
import FromData from './examples/adapter-json.js';
import VueCounter from './examples/vue-counter.js';
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
        lead="A TypeScript SDK for native UI: a host that holds a tree of elements, styled in Rust and drawn by the GPU, for any framework to drive."
      >
        <p>
          blinc_ts has no opinion about how you write a view. It gives you a <b>host</b>: a tree of
          elements, as a browser's document is, that you create, edit and listen to. A user-agent
          stylesheet gives them looks and the host gives them behaviour: buttons submit forms, a
          select opens a list, text is edited in place. CSS, parsed and applied in Rust, styles the
          tree from a theme's variables, and a native window shows it.
        </p>
        <p>
          What turns a framework's idea of a view into calls on the host is an <b>adapter</b>. The
          repository has two, a JSX runtime and a Vue renderer, and the <b>Adapters</b> pages
          explain how they work and how to write your own, for a framework or for no framework at
          all.
        </p>
        <Note>
          This wiki is a Blinc app, written with the JSX adapter, so each example is live: use it,
          then read the source on the next tab. The switch at the top changes the colour scheme.
        </Note>
      </Page>
    ),
  },
  {
    id: 'adapters',
    title: 'What is an adapter?',
    section: 'Adapters',
    view: () => (
      <Page
        title="What is an adapter?"
        lead="The part between a framework and the host, small enough to read in one sitting."
      >
        <p>
          The host does the work that is the same for every framework: the tree, the cascade,
          layout, text, input, focus, the behaviour of forms and dialogs and selects, motion, and
          drawing. A framework brings a way to describe a view and to say what changed in it. An
          adapter listens to that, and makes the matching calls on the host.
        </p>
        <p>
          It is small because the host's interface is the same one a document has: create an
          element, a piece of text or a placeholder, put it in a parent before another node, take it
          out, set an attribute, a style property or a class, and listen for an event. The next
          pages say what that comes to; this one is about what an adapter is not.
        </p>
        <h2>It does not own the elements' behaviour</h2>
        <p>
          A <code>button</code> in a <code>form</code> submits it, whichever framework made them. An{' '}
          <code>input</code> edits text, validates and takes focus. An adapter that makes these
          elements has them working, and one that makes a hundred of its own components out of{' '}
          <code>div</code>s has to build every behaviour again.
        </p>
        <h2>It does not own the reactivity</h2>
        <p>
          The JSX adapter brings a small reactive runtime of its own, built on the SDK's signals.
          The Vue adapter brings none: Vue's reactivity decides what to update and the renderer
          carries each change over. A framework that already knows what changed needs nothing more.
        </p>
        <Note>
          The adapters are in <code>adapters/</code>, outside the SDK, and the SDK imports nothing
          from them. <code>adapters/test</code> draws the same scene through both and requires the
          same tree, pixels and event order.
        </Note>
      </Page>
    ),
  },
  {
    id: 'host',
    title: 'The host interface',
    section: 'Adapters',
    view: () => (
      <Page
        title="The host interface"
        lead="What an adapter calls, and what the host does with it."
      >
        <h2>Making and editing the tree</h2>
        <p>
          <code>host.createElement(tag)</code>, <code>host.createTextNode(data)</code> and{' '}
          <code>host.createComment()</code> make nodes. A comment, or a text with no data, takes no
          room and is not a sibling that a selector such as <code>:first-child</code> counts, so a
          framework can keep its placeholders where it likes.{' '}
          <code>parent.insertBefore(child, reference)</code> places a node, moving it from where it
          was; <code>appendChild</code> and <code>removeChild</code> are as in a document, and{' '}
          <code>node.destroy()</code> takes a node and everything under it out and lets go of its
          listeners and bindings.
        </p>
        <h2>Props</h2>
        <p>
          <code>setAttribute</code> and <code>removeAttribute</code> take attributes, which CSS
          selectors read; <code>className</code> and <code>classList</code> take classes;{' '}
          <code>setProperty(name, value)</code> sets an inline style declaration, a number meaning
          pixels where a length is meant; <code>addEventListener(type, listener, options)</code>{' '}
          takes events, which bubble and can be captured, and <code>preventDefault()</code> works.{' '}
          <code>element.value</code>, <code>checked</code> and the like are set as a script sets
          them.
        </p>
        <h2>Writes are batched</h2>
        <p>
          Edits coalesce: the last write to a property wins, and the host sends one native batch for
          the tick. An adapter does not batch for it, and needs no virtual tree to avoid work: it
          can write straight through. <code>host.flush()</code> sends the batch now, and anything
          that reads layout (<code>bounds()</code>, <code>viewBounds()</code>) lays out first.
        </p>
        <h2>What the adapter never sees</h2>
        <p>
          Parts the host makes for an element, a select's chevron or a list item's marker, are in
          the tree and the cascade but not among <code>childNodes</code>. A framework that owns an
          element's children cannot remove them by accident.
        </p>
        <h2>Lifetime</h2>
        <p>
          <code>Host.create(native, scope)</code> ties a host to a <code>Scope</code>, and{' '}
          <code>host.mount(window)</code> shows its root in a window until the scope ends. An
          adapter mounts into <code>host.root</code> or any element it is given, and a destroyed
          node cannot be used again.
        </p>
        <Note>
          The reference is <code>docs/native.md</code>, in the section "Host interface for
          frameworks".
        </Note>
      </Page>
    ),
  },
  {
    id: 'writing',
    title: 'Writing an adapter',
    section: 'Adapters',
    view: () => (
      <Page
        title="Writing an adapter"
        lead="Two that use no framework at all, then what a real one adds."
      >
        <p>
          The smallest adapter is a function that makes elements. This one takes a tag, its props
          and its children, and makes them on the host. Nothing updates itself: what changes is
          changed by hand, which for a text node is one assignment.
        </p>
        <Example name="adapter-h" title="Hyperscript, updated by hand" view={HandWritten} />
        <p>
          Data is a view too. An adapter for a description a server could send is one function from
          the description to elements, and a way to ask again. Here asking again throws the old tree
          away and renders the new description in its place, the simplest update there is.
        </p>
        <Example name="adapter-json" title="A view as data" view={FromData} />
        <h2>What a real adapter adds</h2>
        <ol>
          <li>
            <b>Nodes and edits.</b> Map the framework's create, insert, remove and move to the
            host's. A framework that keeps placeholders can use comments.
          </li>
          <li>
            <b>Props.</b> Decide what is an attribute, a class, a style property or an event
            listener, and how one is taken away. Both reference adapters handle each, and a listener
            the framework swaps is best one listener that calls the current handler.
          </li>
          <li>
            <b>Updates.</b> Either the framework says exactly what changed, as Vue does, or the
            adapter finds out by diffing or by sources, as the JSX adapter's reactive props do.
          </li>
          <li>
            <b>Lifetime.</b> Destroy the nodes a framework removes, so their listeners go, and end
            what the framework started (effects, timers) with the view that started it.
          </li>
          <li>
            <b>Mounting.</b> Mount into the root or an element, in a window, and stop when the scope
            does.
          </li>
          <li>
            <b>Tests.</b> Draw offscreen, drive pointer and key events through the host, and
            compare. <code>adapters/test</code> does so for both reference adapters.
          </li>
        </ol>
      </Page>
    ),
  },
  {
    id: 'jsx-adapter',
    title: 'The JSX adapter',
    section: 'Adapters',
    view: () => (
      <Page title="The JSX adapter" lead="Descriptions built once, with sources for what changes.">
        <p>
          The JSX adapter builds a description into host nodes once, where it is placed, with no
          virtual tree. What changes later is declared: a prop or a child given as a signal, a
          computed value or a function of them follows it, and only what depends on it updates. Text
          is rewritten in place, and anything else rebuilds only its own part: <code>Show</code> for
          a condition, <code>For</code> for a list that keeps what it built for each item.
        </p>
        <Example name="reactive" view={Reactive} />
        <p>
          Components run under an owner, so a signal, an effect or an <code>onCleanup</code> they
          make ends with the part of the view that holds them. The whole of the adapter's entry
          points is short:
        </p>
        <SourceView file="jsx/jsx-runtime.ts" title="adapters/jsx/jsx-runtime.ts" />
      </Page>
    ),
  },
  {
    id: 'vue-adapter',
    title: 'The Vue adapter',
    section: 'Adapters',
    view: () => (
      <Page
        title="The Vue adapter"
        lead="A custom renderer: Vue decides what changed, the adapter says it to the host."
      >
        <p>
          Vue's <code>createRenderer</code> takes a small set of node operations and does the rest
          itself, reactivity and scheduling included. The adapter is those operations, each a call
          on the host, and a way to mount an app into an element. Below, the same host that draws
          the rest of this page is drawing a Vue component.
        </p>
        <Example name="vue-counter" title="A Vue component, in this page" view={VueCounter} />
        <p>The operations, as they are in the repository:</p>
        <SourceView file="vue/renderer.ts" from={60} to={125} title="adapters/vue/renderer.ts" />
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
