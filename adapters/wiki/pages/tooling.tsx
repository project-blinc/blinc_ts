/** The wiki's Tooling pages: hot reload, and building an app with the builders and bundlers. */
import type { WikiPage } from '../page.js';
import { Code, Note, Page, SourceView, Table } from '../kit.js';

export const toolingPages: readonly WikiPage[] = [
  {
    id: 'hmr',
    title: 'Hot reload',
    section: 'Tooling',
    view: () => (
      <Page
        title="Hot reload"
        lead="Edit a view and see it in the window that is already open, on the same GPU device."
      >
        <p>
          A Blinc app is a Node program that owns a native window, and a window is slow to open and
          holds a device, a surface and the user's place. Hot reload keeps that part and replaces
          the rest: an edit runs the changed modules again and mounts the UI again into the window
          that is still open. This wiki runs that way under <code>npm run wiki:dev</code>, and keeps
          the page you are reading and the scheme you chose across an edit.
        </p>
        <Code title="Terminal">{`npm run build:native   # once, and after a change to native code
npm run wiki:dev        # edit anything under adapters/wiki or adapters/base-ui`}</Code>
        <h2>Two lifetimes</h2>
        <p>
          <code>blinc_ts/hmr</code> separates what lives as long as the process from what lives as
          long as one version of the code. The <b>host</b> is the first: the window, its device and
          anything an app wants to keep. A <code>Scope</code> is the second: each mount gets a new
          one, and the host's tree, listeners, timers, effects and native nodes made in a mount are
          registered on its scope, so the last mount is released before the next one is built.
        </p>
        <Table
          head={['Part', 'On an edit']}
          rows={[
            ['The window, its GPU device and surface', 'kept'],
            ['What the host holds, such as the page and scheme here', 'kept'],
            ['The layout, its nodes and sheets', 'released, and built again'],
            ['Listeners, effects and timers made by the view', 'ended with its scope'],
            ['The last frame', 'shown until the new one is drawn'],
            ['The native addon', 'a change needs a new process'],
          ]}
        />
        <p>
          <code>createHmrSession(import.meta.hot, createHost)</code> makes the host the first time
          and finds it in <code>hot.data</code> after that.{' '}
          <code>session.mount((host, scope) =&gt; …)</code> ends the last mount's scope, then builds
          the new one; a mount that throws releases what it had made and leaves the host usable. A
          full reload, a pruned module or <code>session.dispose()</code> ends the host too. The
          entry must contain a literal <code>import.meta.hot.accept()</code>, which is how Vite
          knows the module takes its own updates.
        </p>
        <SourceView
          file="wiki/app.ts"
          title="adapters/wiki/app.ts: the wiki's entry under the dev server"
        />
        <p>
          The host the wiki keeps is a shell: its window, and what a reader would not want to lose.
          Each mount builds a new host tree in a new scope and shows it in the shell's window.
        </p>
        <SourceView file="wiki/launch.tsx" from={17} title="adapters/wiki/launch.tsx" />
        <h2>The dev server</h2>
        <p>
          <code>blinc()</code> from <code>blinc_ts/vite</code> adds a Vite environment, named{' '}
          <code>blinc</code>, whose modules run in this Node process through Vite's Module Runner,
          on the main thread where the window and the GPU are. It reads the <code>node</code> export
          conditions, leaves <code>blinc_ts</code> to Node (the SDK loads its addon from beside its
          own files), and keeps build outputs and the native target out of the watcher. A script
          starts the server and imports the entry through the runner:
        </p>
        <SourceView file="wiki/dev.mjs" title="adapters/wiki/dev.mjs" />
        <h2>Other bundlers</h2>
        <p>
          <code>blinc_ts/hmr</code> does not import Vite. <code>HotContext</code> is the part of
          Vite's API it uses: <code>data</code>, <code>dispose</code>, and optionally{' '}
          <code>prune</code> and the <code>vite:beforeFullReload</code> event. A bundler with hot
          module replacement can pass an object of that shape, and accept the module with its own
          API.
        </p>
        <Note>
          <code>adapters/test/wiki-hmr.mjs</code> runs the wiki's mount under a real Vite server,
          edits a page, and checks that the shell is kept, the last mount released, and the reader's
          page and scheme carried over; <code>tests/native-hmr.mjs</code> does it with a window and
          checks that the window and the device survive.
        </Note>
      </Page>
    ),
  },
  {
    id: 'bundlers',
    title: 'Builders and bundlers',
    section: 'Tooling',
    view: () => (
      <Page
        title="Builders and bundlers"
        lead="A Blinc app is built for Node, with the SDK left out of the bundle."
      >
        <p>
          Building an app compiles its TypeScript and JSX, and its CSS when it imports sheets, into
          JavaScript Node runs. Whatever does it, three things hold:
        </p>
        <ol>
          <li>
            <b>Build for Node</b>, as ES modules, at Node 22 or later. The window and the GPU are
            reached through a native addon on Node's main thread.
          </li>
          <li>
            <b>
              Leave <code>blinc_ts</code> out of the bundle.
            </b>{' '}
            It loads its native addon from beside its own files, so it must be imported from where
            it is installed. Every recipe below marks it external.
          </li>
          <li>
            <b>
              Compile <code>.css</code> imports
            </b>
            , or add sheets as text at run time. A compiled import is the sheet's bytes, which{' '}
            <code>addStyleSheet</code> loads without parsing, with its class names as a frozen
            object.
          </li>
        </ol>
        <p>Each recipe builds this app, and the app it builds runs:</p>
        <SourceView file="wiki/snippets/bundling/app.ts.txt" title="src/app.ts" language="ts" />
        <SourceView file="wiki/snippets/bundling/card.css" title="src/card.css" />
        <h2>Vite</h2>
        <p>
          <code>blinc()</code> builds its environment for Node into <code>dist/native</code> unless
          the app says otherwise, and <code>blincCss()</code> compiles sheets. <code>buildApp</code>{' '}
          builds that environment alone; Vite would otherwise build a browser client too, and fail
          for want of an <code>index.html</code>.
        </p>
        <SourceView file="wiki/snippets/bundling/vite.config.mjs" title="vite.config.mjs" />
        <Code>{'npx vite build --app\nnode out/vite/app.js'}</Code>
        <h2>Rolldown and Rollup</h2>
        <p>
          <code>blincCss()</code> is a plugin of the shape both take. Rolldown reads TypeScript
          itself; Rollup needs its TypeScript plugin, whose resolver answers a sheet's import with
          the declarations beside it, which <code>blincCss()</code> takes back to the sheet.
        </p>
        <SourceView file="wiki/snippets/bundling/rolldown.config.mjs" title="rolldown.config.mjs" />
        <SourceView file="wiki/snippets/bundling/rollup.config.mjs" title="rollup.config.mjs" />
        <h2>esbuild</h2>
        <p>
          esbuild's plugins are its own, so a sheet is compiled in an <code>onLoad</code> with{' '}
          <code>compileCss</code>, the same compiler, from <code>blinc_ts/native</code>.
        </p>
        <SourceView file="wiki/snippets/bundling/build-esbuild.mjs" title="build-esbuild.mjs" />
        <h2>TypeScript alone</h2>
        <p>
          <code>tsc</code> compiles an app that adds its sheets as text, which is parsed when it is
          added; Node cannot import a <code>.css</code> file. The repository's native example builds
          this way: <code>npm run build:example</code>, then <code>npm run start:native</code>.
        </p>
        <h2>Checked with</h2>
        <Table
          head={['Tool', 'Version']}
          rows={[
            ['Vite', '8.3.3'],
            ['Rolldown', '1.2.13'],
            ['Rollup', '4.64.5, with @rollup/plugin-typescript 12.3.0'],
            ['esbuild', '0.28.2'],
            ['TypeScript', '6.0.3'],
            ['Node', '24.2.0'],
          ]}
        />
        <Note>
          <code>tests/native-vite-css.mjs</code> builds an app in the Blinc environment and runs it,
          and checks that a sheet resolved to its declarations is compiled as the sheet. Bun and
          Deno have not been tried.
        </Note>
      </Page>
    ),
  },
  {
    id: 'shaders',
    title: 'Shaders',
    section: 'Tooling',
    view: () => (
      <Page
        title="Shaders"
        lead="Written in TypeScript with TypeGPU, compiled to WGSL when the SDK is built."
      >
        <p>
          The renderer's shaders are TypeScript functions written with TypeGPU: <code>d</code> for
          GPU data types, <code>std</code> for vector maths, derivatives and texture reads, and
          ordinary operators on scalars. TypeGPU's build plugin compiles them to WGSL; no shader is
          a string assembled at run time. <code>npm run build:shaders</code> writes the WGSL and
          entry-point metadata into <code>src/renderer/generated</code>, which{' '}
          <code>npm run build</code> runs first.
        </p>
        <Table
          head={['Source', 'Draws']}
          rows={[
            [
              <code>src/renderer/gpu/sdf.ts</code>,
              'rounded and shaped corners, notches, clips, fades, shadows',
            ],
            [<code>shaders/ui/fills.ts, box.ts</code>, 'fills and borders, in the box pass'],
            [
              <code>shaders/ui/text.ts, image.ts</code>,
              'glyphs and images from their atlases, clipped',
            ],
            [
              <code>shaders/ui/layer.ts</code>,
              'group opacity, colour filters, masks, blur and drop shadows',
            ],
            [
              <code>shaders/ui/backdrop.ts, glass.ts</code>,
              'backdrop blur, refraction and colour separation',
            ],
          ]}
        />
        <p>
          A record of the native display list is read with <code>field(record, fields.bounds)</code>
          , each shader loading only the rows it uses; a record's index and the pixel cross from
          vertex to fragment, not the whole record. For your own drawing,{' '}
          <code>blinc_ts/shaders/canvas</code> exports the same parts for a canvas: see{' '}
          <b>GPU canvas</b>.
        </p>
        <Note>
          <code>node tests/native-renderer.mjs</code> draws the real renderer offscreen at 1× and 2×
          and checks its pixels; run it after a shader change.
        </Note>
      </Page>
    ),
  },
  {
    id: 'snapshots',
    title: 'Snapshots',
    section: 'Tooling',
    view: () => (
      <Page
        title="Snapshots"
        lead="Capture scenes with no window, inspect motion frame by frame, compare with a baseline."
      >
        <Code title="Terminal">{`npm run snapshot -- probe --width 640 --height 420
npm run snapshot -- motion --frames 31 --fps 30
npm run snapshot -- motion --frames 31 --fps 30 --watch`}</Code>
        <p>
          A capture goes to <code>.blinc/snapshots/&lt;scene&gt;/</code>: clean frames, frames with
          bounds, trails and progress drawn over them, filmstrips, a sheet of curves for every
          track, the pixels that changed from frame to frame, a trace and a report, and an{' '}
          <code>index.html</code> that plays them back offline with overlays to toggle. Motion is
          sampled at simulation times, not wall time, so <code>--at 500</code> is exactly 500 ms in.
        </p>
        <h2>Checking motion</h2>
        <p>
          A track declares its target, property, endpoints, delay, duration and easing;{' '}
          <code>MotionTrace</code> from <code>blinc_ts/debug/motion</code> samples what was really
          drawn and flags a deviation from the curve, a jump, a missing sample or a wrong end, and
          the capture fails on them.
        </p>
        <h2>Baselines</h2>
        <p>
          <code>--output</code> writes a reviewed baseline outside the output directory, and{' '}
          <code>--baseline</code> compares a new capture with it, channel by channel within{' '}
          <code>--tolerance</code>, writing diff images and failing on a difference. The checker
          never updates a baseline. <code>--watch</code> rebuilds and captures again on each edit,
          and recovers from a failed build. Scenes are registered in{' '}
          <code>tools/snapshot/run.mjs</code>.
        </p>
      </Page>
    ),
  },
  {
    id: 'testing',
    title: 'Testing',
    section: 'Tooling',
    view: () => (
      <Page
        title="Testing"
        lead="Drive the host as a user would and read the pixels it draws, with no window."
      >
        <p>
          A host needs no window: lay it out with <code>host.compute(width, height)</code>, give it
          input through <code>host.input</code>, advance motion with{' '}
          <code>layout.tickMotion(time)</code>, and draw it into an <code>OffscreenRenderer</code>{' '}
          to read the pixels back. This test is run by this wiki's own suite:
        </p>
        <SourceView file="wiki/snippets/testing.ts" title="adapters/wiki/snippets/testing.ts" />
        <h2>Frames as a window makes them</h2>
        <p>
          A window lays out, ticks and draws in the same turn as the input it handles, and only a
          frame's layout is where a layout animation measures a move. A test of what a user sees in
          a window should make frames the same way: <code>FrameLayout</code> from{' '}
          <code>blinc_ts/native/frame-layout</code> is the window's own sequence, and{' '}
          <code>adapters/test/wiki-driver.mjs</code> wraps it in a driver that presses, moves and
          draws frame by frame.
        </p>
        <h2>The suites</h2>
        <Table
          head={['Command', 'Runs']}
          rows={[
            [<code>npm test</code>, 'unit tests, and Vite hot reload with no native addon'],
            [<code>npm run test:native</code>, 'the native suites; the last ones open windows'],
            [<code>npm run test:adapters</code>, 'the adapters, Base UI, and this wiki'],
            [<code>npm run check</code>, 'types, lint, formatting and the unit tests'],
          ]}
        />
        <Note>
          A window suite needs a display it can present to: on a sleeping or locked display its
          window gets no surface and it fails waiting for a frame. A test that checks a fix should
          fail without it; take the fix out once and see.
        </Note>
      </Page>
    ),
  },
  {
    id: 'performance',
    title: 'Performance',
    section: 'Tooling',
    view: () => (
      <Page
        title="Performance"
        lead="Coarse native calls, buffers reused, and no work for what did not change."
      >
        <p>
          A tick's edits go to native code in one call. Layout reruns only for what changed, paint
          edits skip layout, and a frame is drawn only when something changed or moves: a quiet
          window costs no frames and wakes for motion out of view only when it ends. Bounds are read
          into reusable storage, glyph and image atlases upload only what changed, and the renderer
          keeps its buffers and textures between frames.
        </p>
        <Table
          head={['Benchmark', 'Measures']}
          rows={[
            [<code>npm run bench:native</code>, 'one call across the native boundary'],
            [
              <code>npm run bench:layout</code>,
              'layout, bounds reads and reparenting of large trees',
            ],
            [<code>npm run bench:layout:pipeline</code>, 'mutation and frame cost on a large tree'],
            [<code>npm run bench:renderer</code>, 'whole scenes through the renderer'],
            [
              <code>npm run bench:window</code>,
              'a window at rest: polls and frames when nothing happens',
            ],
          ]}
        />
        <p>
          Each records warm-up runs and many samples with medians and percentiles, as JSON with{' '}
          <code>--output</code>. Compare runs on the same machine, runtime and build;{' '}
          <code>docs/performance.md</code> has the method and the latest measurements.
        </p>
      </Page>
    ),
  },
  {
    id: 'contributing',
    title: 'Contributing',
    section: 'Tooling',
    view: () => (
      <Page title="Contributing" lead="The conventions the repository keeps.">
        <ul>
          <li>
            <b>Formatting and lint:</b> Prettier owns whitespace, ESLint with type-aware rules
            checks the code, and warnings fail. <code>npm run format</code> and{' '}
            <code>npm run lint:fix</code> fix what they can.
          </li>
          <li>
            <b>Native changes:</b> rebuild the addon with <code>npm run build:native</code> and run{' '}
            <code>npm run test:native</code>. Generated bindings are changed through their
            generator, not by hand.
          </li>
          <li>
            <b>Visual changes:</b> capture representative scenes, look at the images, and compare
            with a reviewed baseline.
          </li>
          <li>
            <b>Issues:</b> work, defects and follow-ups are tracked with git-bug, in the repository.
            An issue holds the reproduction, measurements and what was tried; a commit says what
            changed and cites its issue.
          </li>
          <li>
            <b>Comments:</b> say what code does, and why when that is not plain from reading it; the
            story of how it came to be belongs in its issue.
          </li>
        </ul>
        <Note>
          The full guide is <code>docs/contributing.md</code>; the native setup, with the sibling
          repositories, is in <code>docs/native.md</code>.
        </Note>
      </Page>
    ),
  },
];
