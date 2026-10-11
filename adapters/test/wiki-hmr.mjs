// The wiki under Vite: an edit mounts it again on the same shell, on the page the reader was on and
// in the scheme they chose, and what the last mount made is released.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer, isRunnableDevEnvironment } from 'vite';
import { blinc } from 'blinc_ts/vite';
import { loadNative } from 'blinc_ts/native';
import { save } from '../../tests/save.mjs';
import { buttonNamed, findAll } from './wiki-driver.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtures = new URL('../.test-fixtures/', import.meta.url);
await mkdir(fixtures, { recursive: true });
const directory = await mkdtemp(fileURLToPath(new URL('wiki-hmr-', fixtures)));
const key = '__blinc_wiki_hmr_' + Math.random().toString(36).slice(2);
const native = loadNative();
const state = { created: 0, closed: 0, shown: [], session: undefined };
globalThis[key] = {
  state,
  shell: () => {
    state.created++;
    return {
      native,
      state: { page: 'first', scheme: 'light', hud: false },
      show: (host) => state.shown.push(host),
      dispose: () => state.closed++,
    };
  },
};

const entry = `${directory}/app.ts`;
const pagesFile = `${directory}/pages.ts`;
const pagesSource = (second) => `
import { jsx } from '#jsx/jsx-runtime';
import { Page } from '../../wiki/kit.js';
const page = (id, title, text) => ({
  id,
  title,
  section: 'Test',
  view: () => jsx(Page, { title, children: jsx('p', { class: 'said', children: text }) }),
});
export const pages = [page('first', 'First', 'One'), page('second', 'Second', ${JSON.stringify(second)})];
`;

async function waitFor(predicate, description) {
  const deadline = Date.now() + 8000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for ' + description);
    }
    await delay(20);
  }
}

let server;
try {
  await save(pagesFile, pagesSource('Two'));
  await save(
    entry,
    `
import { createHmrSession } from 'blinc_ts/hmr';
import { mountWiki } from '../../wiki/launch.js';
import { pages } from './pages.js';
const test = globalThis[${JSON.stringify(key)}];
export const session = createHmrSession(import.meta.hot, () => test.shell());
test.state.session = session;
session.mount((shell, scope) => mountWiki(shell, scope, pages));
if (import.meta.hot) {
  import.meta.hot.accept();
}
`,
  );
  server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [blinc()],
    server: { host: '127.0.0.1', port: 0, watch: { usePolling: true, interval: 20 } },
  });
  await server.listen();
  const environment = server.environments.blinc;
  assert.ok(isRunnableDevEnvironment(environment));
  await environment.runner.import(entry);

  const said = (host) => findAll(host.root, 'said').map((e) => e.textContent);
  const first = state.shown.at(-1);
  assert.deepEqual(said(first), ['One'], 'the first page is shown');
  // The reader goes to the second page and to the dark scheme.
  buttonNamed(first.root, 'Second').click();
  findAll(first.root, 'bui-switch')[0].click();
  // And opens the performance panel.
  buttonNamed(first.root, 'Performance').click();
  first.flush();
  assert.deepEqual(said(first), ['Two']);
  assert.equal(findAll(first.root, 'wiki-hud').length, 1, 'the panel shows');
  const memory = findAll(first.root, 'wiki-hud-value')[0].textContent;
  assert.match(memory, /^\d+\.\d MB$/, `with what the process holds: ${memory}`);
  assert.ok(parseFloat(memory) > 10, memory);
  const shell = state.session.host;
  assert.deepEqual(
    shell.state,
    { page: 'second', scheme: 'dark', hud: true },
    'what a reload keeps is noted',
  );

  await save(pagesFile, pagesSource('Two, edited'));
  await waitFor(() => state.shown.length === 2, 'the wiki mounted again');
  const second = state.shown[1];
  assert.equal(state.created, 1, 'on the same shell');
  assert.equal(state.closed, 0, 'which stays open');
  assert.equal(state.session.host, shell);
  assert.ok(first.layout.disposed, 'the last mount is released');
  assert.deepEqual(
    said(second),
    ['Two, edited'],
    'the edit is shown, on the page the reader was on',
  );
  const toggle = findAll(second.root, 'bui-switch')[0];
  assert.ok(toggle.hasAttribute('data-checked'), 'and in the scheme they chose');
  assert.equal(findAll(second.root, 'wiki-hud').length, 1, 'with the panel still open');

  // A full reload starts again with a new shell; disposing the session closes it.
  await delay(75);
  environment.hot.send({ type: 'full-reload', path: '*' });
  await waitFor(() => state.created === 2, 'a full reload');
  assert.equal(state.closed, 1);
  assert.ok(second.layout.disposed);
  state.session.dispose();
  assert.equal(state.closed, 2);
} finally {
  try {
    state.session?.dispose();
  } finally {
    await server?.close();
    delete globalThis[key];
    await rm(directory, { recursive: true, force: true });
  }
}
console.log('Wiki: hot reload keeps the shell, the page, the scheme and the panel');
