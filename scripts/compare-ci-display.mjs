// Compare offscreen work with and without the compositor on the same runner.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const directory = resolve('.blinc/ci/display-comparison');
const results = [];
for (const mode of ['display', 'headless']) {
  const output = resolve(directory, mode);
  await mkdir(output, { recursive: true });
  const env = { ...process.env, STEPS: '80', SEED: '20261011', NATIVE_TEST_PROFILE_DIR: output };
  if (mode === 'headless') {
    delete env.DISPLAY;
    delete env.WAYLAND_DISPLAY;
  }
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      ['--expose-gc', 'test/wiki-stress.mjs'],
      {
        cwd: resolve('adapters'),
        env,
      },
    );
    await writeFile(resolve(output, 'test.log'), stdout + stderr);
  } catch (error) {
    await writeFile(
      resolve(output, 'test.log'),
      (error.stdout ?? '') + (error.stderr ?? '') + String(error),
    );
    throw error;
  }
  const profile = JSON.parse(await readFile(resolve(output, 'wiki-stress.mjs.json'), 'utf8'));
  assert.equal(profile.exitCode, 0);
  results.push(profile);
}
const [display, headless] = results;
assert.deepEqual(headless.adapter, display.adapter, 'the same Vulkan adapter runs both workloads');
assert.equal(headless.result.steps, display.result.steps);
assert.equal(headless.result.seed, display.result.seed);
assert.equal(
  headless.result.pixelHash,
  display.result.pixelHash,
  'identical final offscreen pixels',
);
assert.equal(headless.samples.length, display.samples.length, 'identical frame counts');
const comparison = results.map((profile, i) => ({
  mode: i === 0 ? 'display' : 'headless',
  elapsedMs: profile.elapsedMs,
  frames: profile.samples.length,
  adapter: profile.adapter,
  nativeThreads: profile.nativeThreads,
  result: profile.result,
}));
await writeFile(resolve(directory, 'summary.json'), JSON.stringify(comparison, null, 2));
console.log('Offscreen display comparison:', JSON.stringify(comparison));
