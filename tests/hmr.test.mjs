import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer, isRunnableDevEnvironment } from 'vite';
import { blinc } from '../dist/vite.js';
import { AppSession } from '../dist/hmr.js';
import { save } from './save.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

async function waitFor(predicate, description) {
  const deadline = Date.now() + 8000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for ' + description);
    }
    await delay(20);
  }
}

test('actual Vite HMR replaces roots while retaining a single host', async () => {
  const fixtures = new URL('../.test-fixtures/', import.meta.url);
  await mkdir(fixtures, { recursive: true });
  const directory = await mkdtemp(fileURLToPath(new URL('hmr-', fixtures)));
  const entry = directory + '/app.ts';
  const stateKey = '__blinc_test_' + Math.random().toString(36).slice(2);
  const state = {
    created: 0,
    closed: 0,
    cleaned: 0,
    updates: 0,
    labels: [],
    listeners: new Set(),
    session: undefined,
  };
  globalThis[stateKey] = state;

  function source(label) {
    return `
import { createHmrSession } from 'blinc_ts/hmr';
const state = globalThis[${JSON.stringify(stateKey)}];
export const session = createHmrSession(import.meta.hot, () => {
  state.created++;
  return { dispose() { state.closed++; } };
});
state.session = session;
session.mount((_host, scope) => {
  state.labels.push(${JSON.stringify(label)});
  const listener = () => ${JSON.stringify(label)};
  state.listeners.add(listener);
  scope.onCleanup(() => {
    state.listeners.delete(listener);
    state.cleaned++;
  });
});
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.on('vite:afterUpdate', () => { state.updates++; });
}
`;
  }

  let server;
  try {
    await save(entry, source('first'));
    server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [blinc()],
      server: {
        host: '127.0.0.1',
        port: 0,
        watch: { usePolling: true, interval: 20 },
      },
    });
    await server.listen();
    const environment = server.environments.blinc;
    assert.ok(isRunnableDevEnvironment(environment));
    await environment.runner.import(entry);
    const initialHost = state.session.host;

    for (const [label, cleanupCount] of [
      ['second', 1],
      ['third', 2],
    ]) {
      await save(entry, source(label));
      await waitFor(
        () => state.labels.at(-1) === label && state.updates >= cleanupCount,
        label + ' completed HMR update',
      );
      assert.equal(state.created, 1);
      assert.equal(state.closed, 0);
      assert.equal(state.cleaned, cleanupCount);
      assert.equal(state.listeners.size, 1);
      assert.equal([...state.listeners][0](), label);
      assert.equal(state.session.host, initialHost);
      // Vite's watcher suppresses duplicate change events for 50 ms.
      // Separate synthetic editor saves after the update has completed.
      await delay(75);
    }

    environment.hot.send({ type: 'full-reload', path: '*' });
    await waitFor(() => state.created === 2 && state.labels.length === 4, 'full reload');
    assert.equal(state.closed, 1);
    assert.equal(state.cleaned, 3);
    assert.equal(state.listeners.size, 1);
    assert.notEqual(state.session.host, initialHost);

    state.session.dispose();
    assert.equal(state.closed, 2);
    assert.equal(state.cleaned, 4);
    assert.equal(state.listeners.size, 0);
  } finally {
    try {
      state.session?.dispose();
    } finally {
      await server?.close();
      delete globalThis[stateKey];
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test('a failed root mount cleans partial resources and keeps the host usable', () => {
  const events = [];
  const app = new AppSession({
    dispose() {
      events.push('host');
    },
  });
  assert.throws(
    () =>
      app.mount((_host, scope) => {
        scope.onCleanup(() => events.push('first'));
        scope.onCleanup(() => {
          events.push('failing cleanup');
          throw new Error('cleanup');
        });
        scope.onCleanup(() => events.push('last'));
        throw new Error('mount');
      }),
    AggregateError,
  );
  assert.deepEqual(events, ['last', 'failing cleanup', 'first']);
  app.mount((_host, scope) => scope.onCleanup(() => events.push('replacement')));
  app.dispose();
  app.dispose();
  assert.deepEqual(events, ['last', 'failing cleanup', 'first', 'replacement', 'host']);
});
