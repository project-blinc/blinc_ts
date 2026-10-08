import { cpus, platform, arch, release } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadNative } from '../dist/native/index.js';

const api = loadNative();
if (api.buildProfile !== 'release') {
  throw new Error('Run npm run build:native before benchmarking; debug builds are not comparable');
}
const instance = api.gpu.GpuInstance.new();
const iterations = 250000,
  samples = 11,
  warmup = 25000;
function measure(name, operation) {
  let checksum = 0;
  for (let i = 0; i < warmup; i++) {
    checksum += Number(operation());
  }
  const times = [];
  for (let sample = 0; sample < samples; sample++) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
      checksum += Number(operation());
    }
    times.push(Number(process.hrtime.bigint() - start) / iterations);
  }
  const rawSamplesNs = [...times];
  times.sort((a, b) => a - b);
  return {
    name,
    iterations,
    samples,
    medianNs: times[Math.floor(times.length / 2)],
    p90Ns: times[Math.floor((times.length - 1) * 0.9)],
    minimumNs: times[0],
    checksum,
    rawSamplesNs,
  };
}
try {
  const results = [
    measure('js_loop_control', () => true),
    measure('native_resource_valid', () => instance.valid()),
  ];
  const result = {
    schema: 1,
    workload: 'bridge',
    buildProfile: api.buildProfile,
    node: process.version,
    platform: platform(),
    arch: arch(),
    os: release(),
    cpu: cpus()[0]?.model,
    results,
  };
  console.log(JSON.stringify(result, null, 2));
  const output = process.argv.indexOf('--output');
  if (output >= 0) {
    if (!process.argv[output + 1]) {
      throw new Error('Missing --output path');
    }
    const destination = resolve(process.argv[output + 1]);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, JSON.stringify(result, null, 2) + '\n');
  }
} finally {
  instance.destroy();
}
