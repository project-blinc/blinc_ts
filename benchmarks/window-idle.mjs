import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { arch, cpus, platform, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'runtime' },
    warmup: { type: 'string', default: '5' },
    seconds: { type: 'string', default: '5' },
    samples: { type: 'string', default: '3' },
    output: { type: 'string' },
    'keep-open': { type: 'boolean', default: false },
  },
});
assert(['runtime', 'dev'].includes(values.mode));
const seconds = Number(values.seconds),
  warmup = Number(values.warmup),
  samples = Number(values.samples);
assert(Number.isFinite(seconds) && seconds >= 1 && seconds <= 60);
assert(Number.isFinite(warmup) && warmup >= 1 && warmup <= 60);
assert(Number.isSafeInteger(samples) && samples >= 1 && samples <= 60);
const root = fileURLToPath(new URL('../', import.meta.url));
const addonPath = resolve(root, 'native/blinc_ts.node');
assert.equal(createRequire(import.meta.url)(addonPath).buildProfile(), 'release');
const revision = (cwd) =>
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
const addonHash = createHash('sha256');
for await (const chunk of createReadStream(addonPath)) {
  addonHash.update(chunk);
}
const report = {
  mode: values.mode,
  timestamp: new Date().toISOString(),
  node: process.version,
  platform: platform(),
  arch: arch(),
  os: release(),
  cpu: cpus()[0]?.model,
  revision: revision(root),
  xwindowRevision: revision(resolve(root, '../xwindow')),
  addonSha256: addonHash.digest('hex'),
  warmupSeconds: warmup,
  samples: [],
};
let server, app, originalPoll, host;
let closing = false;
async function close() {
  if (closing) {
    return;
  }
  closing = true;
  try {
    app?.session.dispose();
  } finally {
    await server?.close();
  }
}
process.once('SIGINT', () => {
  void close();
});
process.once('SIGTERM', () => {
  void close();
});
try {
  if (values.mode === 'dev') {
    // Keep Vite and its dependencies out of the runtime measurement process.
    const { createServer, isRunnableDevEnvironment } = await import('vite');
    const { blinc } = await import('../dist/vite.js');
    server = await createServer({
      configFile: false,
      logLevel: 'silent',
      plugins: [blinc()],
      server: { host: '127.0.0.1', port: 0 },
    });
    await server.listen();
    const environment = server.environments.blinc;
    assert(isRunnableDevEnvironment(environment));
    app = await environment.runner.import('/examples/native/app.ts');
  } else {
    app = await import('../.blinc/native-app/app.js');
  }
  host = app.session.host;
  report.viewport = {
    width: host.window.width(),
    height: host.window.height(),
    scale: host.window.scaleFactor(),
    format: host.format,
  };
  originalPoll = host.window.poll;
  let polls = 0,
    pollMs = 0;
  let kinds = {};
  host.window.poll = function () {
    const start = performance.now();
    const event = originalPoll.call(this);
    pollMs += performance.now() - start;
    polls++;
    kinds[event.kind] = (kinds[event.kind] ?? 0) + 1;
    return event;
  };
  console.log(JSON.stringify({ stage: 'ready', pid: process.pid, mode: values.mode }));
  console.log('Leave the window idle while measuring; do not move the pointer over it.');
  await delay(warmup * 1000);
  for (let i = 0; i < samples; i++) {
    assert(!host.disposed, 'Window closed while measuring');
    const start = performance.now(),
      cpu = process.cpuUsage(),
      frames = host.frames;
    const startPolls = polls,
      startPollMs = pollMs;
    kinds = {};
    await delay(seconds * 1000);
    assert(!host.disposed, 'Window closed while measuring');
    const elapsedMs = performance.now() - start,
      used = process.cpuUsage(cpu);
    const sample = {
      elapsedMs,
      cpuPercent: (used.user + used.system) / elapsedMs / 10,
      frames: host.frames - frames,
      polls: polls - startPolls,
      pollMs: pollMs - startPollMs,
      events: kinds,
      focused: host.window.hasFocus(),
      visible: host.window.isVisible(),
      minimized: host.window.isMinimized(),
      memory: process.memoryUsage(),
    };
    report.samples.push(sample);
    console.log(JSON.stringify(sample));
  }
  // Run diagnostics outside the timed interval. macOS footprint includes compressed
  // private memory and is different from RSS; retain the original diagnostic text.
  if (process.platform === 'darwin') {
    try {
      const summary = execFileSync('/usr/bin/vmmap', ['-summary', String(process.pid)], {
        encoding: 'utf8',
        timeout: 15000,
      });
      report.physicalFootprint = summary.match(/^Physical footprint:\s*(.+)$/m)?.[1];
      report.vmmapSummary = summary;
      console.log(JSON.stringify({ physicalFootprint: report.physicalFootprint }));
    } catch (error) {
      report.footprintError = String(error);
    }
  }
  if (values.output) {
    const output = resolve(values.output);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    console.log(`Saved ${output}`);
  }
} catch (error) {
  await close();
  throw error;
} finally {
  if (host && originalPoll) {
    host.window.poll = originalPoll;
  }
  if (!values['keep-open']) {
    await close();
  }
}
if (values['keep-open']) {
  console.log('Measurement finished; the window stays open. Press Ctrl-C to stop.');
}
