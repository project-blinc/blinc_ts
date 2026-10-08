import { spawnSync } from 'node:child_process';
import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const debug = process.argv.includes('--debug');
const result = spawnSync(
  'cargo',
  ['build', '--manifest-path', 'native/Cargo.toml', ...(debug ? [] : ['--release'])],
  { cwd: root, stdio: 'inherit' },
);
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
const library =
  process.platform === 'darwin'
    ? 'libblinc_ts_native.dylib'
    : process.platform === 'win32'
      ? 'blinc_ts_native.dll'
      : 'libblinc_ts_native.so';
await copyFile(
  new URL(`../native/target/${debug ? 'debug' : 'release'}/${library}`, import.meta.url),
  new URL('../native/blinc_ts.node', import.meta.url),
);

await import('./format-bindings.mjs');
