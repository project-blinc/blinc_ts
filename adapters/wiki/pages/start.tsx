/** The wiki's Start pages. */
import type { WikiPage } from '../page.js';
import { Code, Example, Note, Page, SourceView, Table } from '../kit.js';
import Architecture from '../examples/architecture.js';

export const startPages: readonly WikiPage[] = [
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
        <h2>What is here</h2>
        <ul>
          <li>
            <b>Start:</b> building it, a first app, how the layers fit, and what each import holds.
          </li>
          <li>
            <b>Adapters:</b> what an adapter is, the host interface it calls, and how to write one;
            the JSX and Vue adapters.
          </li>
          <li>
            <b>Elements:</b> the tree, events and input, forms, text fields, controls, selects and
            dialogs, tables, scrolling, the top layer and inline text.
          </li>
          <li>
            <b>Styling:</b> CSS, flexbox and grid, the theme and its tokens, corner shape, utility
            classes, user-agent styles, paint, liquid glass, images and motion.
          </li>
          <li>
            <b>Drawing:</b> GPU canvases, layout trees, brushes, notches, measuring text, windows
            and reactive contexts.
          </li>
          <li>
            <b>Tooling:</b> hot reload, builders and bundlers, shaders, snapshots, testing,
            performance and contributing.
          </li>
          <li>
            <b>Base UI:</b> components built on the JSX adapter, styled only by theme tokens.
          </li>
        </ul>
        <Note>
          This wiki is a Blinc app, written with the JSX adapter, so each example is live: use it,
          then read the source on the next tab. The switch at the top changes the colour scheme.
        </Note>
      </Page>
    ),
  },
  {
    id: 'start',
    title: 'Getting started',
    section: 'Start',
    view: () => (
      <Page
        title="Getting started"
        lead="Build the native addon once, then run the wiki or your own app with Node."
      >
        <h2>What you need</h2>
        <ul>
          <li>Node 22.13 or later.</li>
          <li>
            A Rust toolchain, and the native backends' platform dependencies. macOS with Metal is
            verified; Windows and Linux still need validation.
          </li>
          <li>
            The sibling repositories the addon builds against, beside this one:{' '}
            <code>blinc_abi</code>, <code>x-idl</code>, <code>xgpu</code> and <code>xwindow</code>.
            A prebuilt package is not published yet.
          </li>
        </ul>
        <h2>Build and run</h2>
        <Code title="Terminal">{`npm ci
npm run build:native   # the addon: Rust, once and after native changes
npm run build          # the SDK's TypeScript and shaders
npm run wiki           # this wiki, in a window
npm run wiki:dev       # the same, reloading as you edit it`}</Code>
        <p>
          <code>npm test</code> runs the unit tests, <code>npm run test:native</code> the native
          suites (some open windows), and <code>npm run test:adapters</code> the adapters and this
          wiki.
        </p>
        <h2>A first app</h2>
        <p>
          A Blinc app is a Node program. It loads the addon, opens a window, makes a host, styles
          it, builds a tree of elements and mounts it. Here is all of one, with no framework:
        </p>
        <SourceView file="wiki/snippets/first-app.ts" title="first-app.ts" />
        <p>
          A framework does the middle part for you: the <b>Adapters</b> pages show how, and the{' '}
          <b>Base UI</b> pages show components built that way. To reload as you edit, see{' '}
          <b>Hot reload</b>; to build for shipping, <b>Builders and bundlers</b>.
        </p>
      </Page>
    ),
  },
  {
    id: 'architecture',
    title: 'Architecture',
    section: 'Start',
    view: () => (
      <Page title="Architecture" lead="Six layers, from your view to the GPU, each with one job.">
        <Example name="architecture" title="The layers: choose one" view={Architecture} />
        <h2>A frame, from an event to the screen</h2>
        <ol>
          <li>
            The window reports input on Node's main thread; the host hit-tests it against the last
            layout and dispatches DOM events, with capture and bubbling.
          </li>
          <li>
            Handlers change the tree, attributes, classes and styles. Each edit is queued; the
            tick's edits go to native code in one call, the last write to a property winning.
          </li>
          <li>
            The engine restyles what changed, parents first, lays out with flexbox and grid, shapes
            text, and starts transitions and layout animations.
          </li>
          <li>
            Motion advances to the frame's time, natively. The engine writes a display list of
            packed records, and the renderer draws it in paint order with batched passes,
            compositing layers for opacity, filters and masks, and sampling what is behind for
            backdrops and glass.
          </li>
          <li>
            The frame is presented. Nothing is drawn again until something changes or moves: a quiet
            window costs no frames.
          </li>
        </ol>
        <h2>Lifetimes</h2>
        <p>
          A <code>Scope</code> owns what is released together: a host, its layout, a reactive
          context, listeners. A window, its device and surface outlive a scope, so hot reload can
          replace the UI and keep them. Native resources are freed when their scope ends, not when a
          garbage collector gets to them.
        </p>
        <Note>
          The longer account is <code>docs/architecture.md</code>, and the native contracts are in{' '}
          <code>docs/native.md</code>.
        </Note>
      </Page>
    ),
  },
  {
    id: 'entry-points',
    title: 'Entry points',
    section: 'Start',
    view: () => (
      <Page title="Entry points" lead="What each import of the package holds.">
        <Table
          head={['Import', 'Holds']}
          rows={[
            [
              <code>blinc_ts</code>,
              'Scope, AppSession and hot sessions, and the display list reader',
            ],
            [
              <code>blinc_ts/native</code>,
              'loadNative, the layout and its nodes, brushes, notches, compileCss, the window and GPU bindings',
            ],
            [
              <code>blinc_ts/native/host</code>,
              'Host and its elements: the tree a framework renders through',
            ],
            [
              <code>blinc_ts/native/window</code>,
              'NativeWindowHost: a window with its device, drawing a scene',
            ],
            [
              <code>blinc_ts/native/renderer</code>,
              'SceneRenderer, and canvas frames and pipelines',
            ],
            [
              <code>blinc_ts/native/offscreen</code>,
              'OffscreenRenderer: draw and read back with no window',
            ],
            [
              <code>blinc_ts/native/image-library</code>,
              'ImageLibrary: images by id, drawn at the size they cover',
            ],
            [
              <code>blinc_ts/native/top-layer</code>,
              'TopLayer: what floats over the app, modal or not',
            ],
            [<code>blinc_ts/native/placement</code>, 'Where a floating box goes against an anchor'],
            [
              <code>blinc_ts/native/frame-layout</code>,
              "FrameLayout: a window's frame sequence, for hosts and tests that make frames",
            ],
            [
              <code>blinc_ts/theme</code>,
              'Tokens, themes, bundles, ThemeState, colours, easings and shape',
            ],
            [<code>blinc_ts/theme/user-agent</code>, 'addUserAgent: what plain elements look like'],
            [
              <code>blinc_ts/theme/utilities</code>,
              'Utility classes from the token names, and classes()',
            ],
            [<code>blinc_ts/hmr</code>, 'createHmrSession, AppSession, Scope and HotContext'],
            [
              <code>blinc_ts/vite</code>,
              'blinc() and blincCss(), for Vite and Rollup-shaped bundlers',
            ],
            [<code>blinc_ts/shaders</code>, "The renderer's generated shaders"],
            [
              <code>blinc_ts/shaders/canvas</code>,
              'canvasVertex, canvasClip and the record helpers, for canvas shaders',
            ],
            [<code>blinc_ts/native/probe</code>, 'A GPU smoke test in a window'],
            [<code>blinc_ts/debug/motion</code>, 'Motion traces and checks, for snapshots'],
          ]}
        />
        <p>
          Importing a module that does not touch the addon loads none of it;{' '}
          <code>loadNative()</code> loads it, on Node's main thread. Every module is an ES module
          with its TypeScript declarations.
        </p>
      </Page>
    ),
  },
];
