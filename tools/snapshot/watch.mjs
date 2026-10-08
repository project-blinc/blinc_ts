import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from './args.mjs';

const args = process.argv.slice(2).filter((value) => value !== '--watch');
const options = parse(args);
const root = fileURLToPath(new URL('../../', import.meta.url));
const logDirectory = resolve(root, '.blinc/snapshots');
await mkdir(logDirectory, { recursive: true });
const events = join(logDirectory, 'events.jsonl');
let child,
  timer,
  running = false,
  pending = true,
  nativeChanged = false,
  closed = false;
const watchers = [];

function command(script, extra = [], timeout = 120000) {
  return new Promise((fulfill, reject) => {
    child = spawn(process.execPath, [script, ...extra], { cwd: root, stdio: 'inherit', timeout });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      child = undefined;
      if (code === 0) {
        fulfill();
      } else {
        reject(new Error(script + ' exited with ' + (signal ?? code)));
      }
    });
  });
}

async function drain() {
  if (running || closed) {
    return;
  }
  running = true;
  try {
    while (pending && !closed) {
      pending = false;
      const rebuildNative = nativeChanged;
      nativeChanged = false;
      const started = performance.now();
      try {
        if (rebuildNative) {
          await command('scripts/build-native.mjs', [], 600000);
        }
        await command('node_modules/vite/bin/vite.js', [
          'build',
          '--config',
          'vite.shaders.config.ts',
        ]);
        await command('scripts/generate-shaders.mjs');
        await command('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.build.json']);
        if (closed) {
          break;
        }
        await command('tools/snapshot/run.mjs', args);
        await appendFile(
          events,
          JSON.stringify({
            event: 'capture',
            scene: options.scene,
            output: options.output,
            elapsedMs: performance.now() - started,
            at: new Date().toISOString(),
          }) + '\n',
        );
      } catch (error) {
        if (closed) {
          break;
        }
        const message = error instanceof Error ? error.message : String(error);
        await appendFile(
          events,
          JSON.stringify({
            event: 'error',
            scene: options.scene,
            output: options.output,
            message,
            at: new Date().toISOString(),
          }) + '\n',
        );
        console.error(message);
      }
    }
  } finally {
    running = false;
  }
}

function changed(native, filename) {
  const name = String(filename ?? '').replaceAll('\\', '/');
  if (name.includes('/generated/') || name.startsWith('generated/')) {
    return;
  }
  if (!/\.(ts|mjs|rs|toml|html)$/.test(name)) {
    return;
  }
  console.log('Source changed: ' + (native ? 'native / ' : '') + name);
  nativeChanged ||= native;
  pending = true;
  clearTimeout(timer);
  timer = setTimeout(() => {
    void drain().catch((error) => {
      console.error(error);
      stop();
    });
  }, 150);
}

function stop() {
  if (closed) {
    return;
  }
  closed = true;
  clearTimeout(timer);
  for (const watcher of watchers) {
    watcher.close();
  }
  child?.kill();
}

for (const [path, native] of [
  ['src', false],
  ['shaders', false],
  ['tools/snapshot', false],
  ['native/src', true],
]) {
  watchers.push(
    watch(join(root, path), { recursive: true }, (_event, filename) => changed(native, filename)),
  );
}
for (const path of ['native/build.rs', 'native/Cargo.toml']) {
  watchers.push(watch(join(root, path), () => changed(true, path)));
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
console.log('Watching source; capture and error events: ' + events);
await drain();
