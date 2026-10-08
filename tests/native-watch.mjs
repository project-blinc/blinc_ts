import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

const output = await mkdtemp(join(tmpdir(), 'blinc-watch-'));
const fixture = join('src', '__watch_' + Date.now() + '.ts');
const events = '.blinc/snapshots/events.jsonl';
await mkdir('.blinc/snapshots', { recursive: true });
const child = spawn(
  process.execPath,
  [
    'tools/snapshot/index.mjs',
    'probe',
    '--width',
    '32',
    '--height',
    '24',
    '--output',
    output,
    '--watch',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let logs = '',
  exited = false;
child.stdout.on('data', (chunk) => {
  logs += chunk;
});
child.stderr.on('data', (chunk) => {
  logs += chunk;
});
const exit = new Promise((resolve) =>
  child.once('exit', () => {
    exited = true;
    resolve();
  }),
);
async function waitFor(predicate) {
  const deadline = performance.now() + 20000;
  while (performance.now() < deadline) {
    assert(!exited, logs);
    const rows = await readFile(events, 'utf8').catch(() => '');
    const records = rows
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((row) => JSON.parse(row))
      .filter((row) => row.output === output);
    if (predicate(records)) {
      return;
    }
    await delay(30);
  }
  throw new Error('Snapshot watch timed out\n' + logs);
}
try {
  await waitFor((records) => records.some((row) => row.event === 'capture'));
  await writeFile(fixture, 'const invalid: string = 123; export {invalid};\n');
  await waitFor((records) => records.some((row) => row.event === 'error'));
  await rm(fixture);
  await waitFor((records) => records.filter((row) => row.event === 'capture').length >= 2);
  console.log(
    JSON.stringify({
      test: 'Snapshot watch recovery',
      initialCapture: true,
      compileFailureLogged: true,
      recovered: true,
    }),
  );
} finally {
  child.kill('SIGTERM');
  await Promise.race([exit, delay(3000)]);
  if (!exited) {
    child.kill('SIGKILL');
    await exit;
  }
  await rm(fixture, { force: true });
  await rm(output, { recursive: true, force: true });
}
