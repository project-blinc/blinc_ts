// Runner facts needed to compare software-GPU jobs; only selected environment variables are read.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { availableParallelism, cpus, freemem, release, totalmem } from 'node:os';

const read = async (path) => {
  try {
    return (await readFile(path, 'utf8')).trim();
  } catch {
    return null;
  }
};
const files = Object.fromEntries(
  await Promise.all(
    ['/etc/os-release', '/sys/fs/cgroup/cpu.max', '/sys/fs/cgroup/cpuset.cpus.effective'].map(
      async (path) => [path, await read(path)],
    ),
  ),
);
const status = await read('/proc/self/status');
const details = {
  time: new Date().toISOString(),
  node: process.version,
  kernel: release(),
  cpus: [...new Set(cpus().map((cpu) => cpu.model))],
  logicalCpus: cpus().length,
  parallelism: availableParallelism(),
  affinity: status?.match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1] ?? null,
  totalMemory: totalmem(),
  freeMemory: freemem(),
  packages: execFileSync('dpkg-query', ['-W', 'mesa-vulkan-drivers', 'libvulkan1'], {
    encoding: 'utf8',
  }).trim(),
  files,
  environment: Object.fromEntries(
    [
      'NATIVE_TEST_DISPLAY',
      'ImageOS',
      'ImageVersion',
      'VK_ICD_FILENAMES',
      'LP_NUM_THREADS',
      'WGPU_BACKEND',
    ].map((key) => [key, process.env[key] ?? null]),
  ),
};
await mkdir('.blinc/ci', { recursive: true });
await writeFile('.blinc/ci/runner.json', JSON.stringify(details, null, 2));
console.log('Native CI runner:', JSON.stringify(details));
