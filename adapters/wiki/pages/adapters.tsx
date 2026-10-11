/** The wiki's Adapters pages. */
import type { WikiPage } from '../page.js';
import { Example, Note, Page, SourceView } from '../kit.js';
import HandWritten from '../examples/adapter-h.js';
import FromData from '../examples/adapter-json.js';
import VueCounter from '../examples/vue-counter.js';
import Reactive from '../examples/reactive.js';

export const adaptersPages: readonly WikiPage[] = [
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
];
