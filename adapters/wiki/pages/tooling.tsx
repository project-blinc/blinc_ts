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
];
