import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer, isRunnableDevEnvironment } from 'vite';
import { blinc } from '../dist/vite.js';
import { save } from './save.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtures = new URL('../.test-fixtures/', import.meta.url);
await mkdir(fixtures, { recursive: true });
const directory = await mkdtemp(fileURLToPath(new URL('native-hmr-', fixtures)));
const entry = directory + '/app.ts';
const output = fileURLToPath(
  new URL('../.blinc/snapshots/hmr-' + Date.now() + '/', import.meta.url),
);
const key = '__blinc_native_hmr_' + Math.random().toString(36).slice(2);
const state = { created: 0, cleaned: 0, label: '', session: undefined, updates: 0, history: [] };
globalThis[key] = state;
const source = (label) => `
import {createHmrSession} from 'blinc_ts/hmr';
import {loadNative,Brush} from 'blinc_ts/native';
import {NativeWindowHost} from 'blinc_ts/native/window';
const state=globalThis[${JSON.stringify(key)}];
export const session=createHmrSession(import.meta.hot,()=>{state.created++;return new NativeWindowHost(loadNative(),{title:'Native HMR test',width:320,height:240});});
state.session=session;state.history.push({stage:"evaluate",label:${JSON.stringify(label)},at:performance.now()});
await session.host.ready;
session.mount((host,scope)=>{state.history.push({stage:"mount",label:${JSON.stringify(label)},at:performance.now()});state.label=${JSON.stringify(label)};scope.onCleanup(host.onEvent(()=>{}));scope.onCleanup(()=>{state.cleaned++;});
const scene=loadNative().createLayout(scope);
const root=scene.createNode({width:'100%',height:'100%',padding:24});
root.setPaint({background:Brush.solid(0x142535),textColor:[1,1,1,1]});
root.setChildren([scene.createText(${JSON.stringify(label)},{fontSize:24})]);
state.scene=scene;host.attachScene(scene,root,{},scope);});
if(import.meta.hot){import.meta.hot.accept();import.meta.hot.on("vite:afterUpdate",()=>{state.updates++;});}
`;
let server;
try {
  await save(entry, source('first'));
  server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [blinc()],
    server: { host: '127.0.0.1', port: 0, watch: { usePolling: true, interval: 20 } },
  });
  await server.listen();
  const environment = server.environments.blinc;
  assert(isRunnableDevEnvironment(environment));
  await environment.runner.import(entry);
  const host = state.session.host,
    window = host.window,
    device = host.device;
  await mkdir(output, { recursive: true });
  await save(output + '/index.html', '<title>Offscreen capture</title>');
  await delay(150);
  assert.equal(state.created, 1);
  assert.equal(state.cleaned, 0);
  assert.equal(host.disposed, false, 'A capture artifact must not reload the application');
  for (const [label, cleaned] of [
    ['second', 1],
    ['third', 2],
  ]) {
    const oldScene = state.scene;
    const previousFrame = host.frames;
    await save(entry, source(label));
    const deadline = performance.now() + 8000;
    while (
      state.label !== label ||
      state.updates < cleaned ||
      host.frames <= previousFrame ||
      host.stats === undefined
    ) {
      assert(performance.now() < deadline, 'Native HMR timed out');
      await delay(20);
    }
    assert.equal(oldScene.disposed, true);
    assert(host.stats.primitives >= 2);
    assert.equal(state.created, 1);
    assert.equal(state.cleaned, cleaned, JSON.stringify(state.history));
    assert.equal(state.session.host, host);
    assert.equal(host.window, window);
    assert.equal(host.device, device);
    assert.equal(host.disposed, false);
    assert.equal(device.takeError(), null);
    await delay(75);
  }
  console.log(
    JSON.stringify({
      test: 'Vite native HMR',
      windowsCreated: state.created,
      rootCleanups: state.cleaned,
      windowPreserved: true,
      devicePreserved: true,
      scenePresented: true,
    }),
  );
} finally {
  try {
    state.session?.dispose();
  } finally {
    await server?.close();
    await rm(directory, { recursive: true, force: true });
    await rm(output, { recursive: true, force: true });
    delete globalThis[key];
  }
}
