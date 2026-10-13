// Optional CI measurements; no timings or machine details affect test assertions.
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus, freemem, platform, release, totalmem } from 'node:os';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';

const profiles = new WeakMap();

export function renderProfile(target) {
  const directory = process.env.NATIVE_TEST_PROFILE_DIR;
  if (!directory) {
    return undefined;
  }
  const existing = profiles.get(target);
  if (existing) {
    return existing;
  }
  const samples = [];
  const started = performance.now();
  const profile = {
    test: basename(process.argv[1]),
    node: process.version,
    platform: platform(),
    release: release(),
    cpu: cpus()[0]?.model,
    parallelism: availableParallelism(),
    logicalCpus: cpus().length,
    totalMemory: totalmem(),
    freeMemory: freemem(),
    adapter: { name: target.adapter.name(), backend: target.adapter.backend() },
    environment: Object.fromEntries(
      ['DISPLAY', 'WAYLAND_DISPLAY', 'VK_ICD_FILENAMES', 'WGPU_BACKEND', 'LP_NUM_THREADS'].map(
        (key) => [key, process.env[key] ?? null],
      ),
    ),
    samples,
    cpuTimes: cpus().map(({ times }) => times),
  };
  process.once('exit', (exitCode) => {
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, `${profile.test}.json`),
      JSON.stringify({
        ...profile,
        exitCode,
        elapsedMs: performance.now() - started,
        finalCpuTimes: cpus().map(({ times }) => times),
      }),
    );
  });
  console.log(
    'Render profile:',
    JSON.stringify({ ...profile, samples: undefined, cpuTimes: undefined }),
  );
  const recorder = {
    start(stage, detail = {}) {
      const time = performance.now();
      const cpu = process.cpuUsage();
      return (result = {}) => {
        samples.push({
          stage,
          ...detail,
          ...result,
          wallMs: performance.now() - time,
          cpu: process.cpuUsage(cpu),
        });
      };
    },
  };
  profiles.set(target, recorder);
  return recorder;
}
