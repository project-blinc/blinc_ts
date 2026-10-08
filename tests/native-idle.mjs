import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { Worker } from 'node:worker_threads';
import { Brush, loadNative, window } from '../dist/native/index.js';
import { NativeWindowHost } from '../dist/native/window.js';

const native = loadNative();
if (!native.subscribeWindowEvents) {
  console.log('Event-driven native idle test: backend not yet supported on this platform');
  process.exit(0);
}
native.window.Window.listenDeviceEvents(window.DeviceEvents.Never);
const hosts = [],
  layouts = [];
function open(bindings = native) {
  const host = new NativeWindowHost(bindings, {
    title: 'Event wake verification',
    width: 320,
    height: 200,
  });
  hosts.push(host);
  return host;
}
async function mount(host) {
  await host.ready;
  const layout = native.createLayout();
  layouts.push(layout);
  const root = layout.createNode({ width: '100%', height: '100%' });
  root.setPaint({ background: Brush.solid(0x173342) });
  host.attachScene(layout, root);
  return root;
}
async function until(test) {
  const start = performance.now();
  while (!test()) {
    assert(performance.now() - start < 3000, 'Native event delivery timed out');
    await delay(10);
  }
}
const watchdog = setTimeout(() => {
  console.error('Native event wait stalled Node');
  process.exit(1);
}, 15000);
watchdog.unref();
try {
  const first = open();
  const root = await mount(first);
  await until(() => first.frames > 0);
  await delay(700);
  let polls = 0;
  const poll = first.window.poll.bind(first.window);
  first.window.poll = () => {
    polls++;
    return poll();
  };
  const frames = first.frames;
  await delay(400);
  assert.equal(polls, 0, 'A quiet window must not periodically poll');
  assert.equal(first.frames, frames, 'A quiet window must not redraw');

  // No main-thread timer runs until the watchdog. A worker's I/O completion
  // must interrupt the platform wait immediately, not wait for that deadline.
  const started = performance.now();
  const worker = new Worker(
    `const {parentPort}=require('node:worker_threads');setTimeout(()=>parentPort.postMessage('awake'),100)`,
    { eval: true },
  );
  const message = await once(worker, 'message');
  const wakeMs = performance.now() - started;
  assert.deepEqual(message, ['awake']);
  assert(wakeMs < 1000, `I/O wake took ${wakeMs}ms`);
  await once(worker, 'exit');
  const server = createServer((socket) => {
    socket.on('data', (bytes) => {
      socket.end(bytes);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const networkStarted = performance.now();
  const client = new Worker(
    `const {parentPort}=require('node:worker_threads');const net=require('node:net');const socket=net.connect(${server.address().port},'127.0.0.1',()=>setTimeout(()=>socket.write('echo'),100));socket.on('data',bytes=>parentPort.postMessage(bytes.toString()));`,
    { eval: true },
  );
  try {
    assert.deepEqual(await once(client, 'message'), ['echo']);
    assert(
      performance.now() - networkStarted < 1000,
      'New I/O registrations must reach the kernel before sleeping',
    );
    await once(client, 'exit');
  } finally {
    server.close();
    await once(server, 'close');
  }
  root.setPaint({ background: Brush.solid(0x287651) });
  await until(() => first.frames > frames);
  const beforeRedraw = first.frames;
  first.window.requestRedraw();
  await until(() => first.frames > beforeRedraw);

  // Separate loadNative calls must share the one native pump. Closing one
  // window must not stop another; the pump can be recreated after all close.
  const second = open(loadNative());
  await mount(second);
  await until(() => second.frames > 0);
  first.dispose();
  await first.closed;
  const beforeResize = second.frames;
  second.window.setSize(360, 240);
  await until(() => second.frames > beforeResize);
  second.dispose();
  await second.closed;
  const third = open();
  await mount(third);
  await until(() => third.frames > 0);
  third.dispose();
  await third.closed;
  console.log(
    JSON.stringify({
      test: 'Native event-driven idle and wake',
      idlePolls: 0,
      idleFrames: 0,
      wakeMs,
      redraw: true,
      multipleWindows: true,
      recreate: true,
    }),
  );
} finally {
  for (const host of hosts) {
    host.dispose();
  }
  for (const layout of layouts) {
    layout.dispose();
  }
  clearTimeout(watchdog);
}
