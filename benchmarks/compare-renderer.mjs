import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    baseline: { type: 'string' },
    candidate: { type: 'string' },
    output: { type: 'string', default: '.blinc/benchmarks/renderer-comparison' },
    counts: { type: 'string', default: '30,300,3000' },
    scales: { type: 'string', default: '1,2' },
    cases: { type: 'string', default: 'list,cards,effects' },
    samples: { type: 'string', default: '101' },
    warmup: { type: 'string', default: '20' },
    runs: { type: 'string', default: '3' },
  },
});
assert(values.baseline && values.candidate, 'Provide --baseline and --candidate release addons');
const runs = Number(values.runs);
assert(Number.isSafeInteger(runs) && runs >= 2 && runs <= 20);
const output = resolve(values.output);
await mkdir(output, { recursive: true });
const reports = [];
let reference;
for (let run = 0; run < runs; run++) {
  for (const build of run % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
    const path = join(output, `${build}-${run}.json`);
    const args = [
      fileURLToPath(new URL('./renderer.mjs', import.meta.url)),
      '--addon',
      resolve(values[build]),
      '--output',
      path,
    ];
    for (const key of ['counts', 'scales', 'cases', 'samples', 'warmup']) {
      args.push(`--${key}`, values[key]);
    }
    if (reference) {
      args.push('--verify', reference);
    }
    if (run === 0) {
      args.push('--captures', join(output, `${build}-captures`));
    }
    console.error(`Run ${run + 1}/${runs}: ${build}`);
    await new Promise((done, reject) => {
      const child = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'inherit'] });
      child.on('error', reject);
      child.on('exit', (code, signal) =>
        code === 0 ? done() : reject(new Error(`${build} exited ${code ?? signal}`)),
      );
    });
    reference ??= path;
    reports.push({ build, run, data: JSON.parse(await readFile(path, 'utf8')) });
  }
}
const first = reports[0].data;
for (const { build, data } of reports) {
  for (const key of [
    'node',
    'platform',
    'arch',
    'os',
    'cpu',
    'buildProfile',
    'sdkSha256',
    'fixtureSha256',
    'harnessSha256',
  ]) {
    assert.deepEqual(data[key], first[key], `Mismatched benchmark environment: ${key}`);
  }
  assert.equal(
    data.addonSha256,
    reports.find((r) => r.build === build).data.addonSha256,
    'Each build must use the same binary throughout',
  );
}
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
};
const results = [];
for (let index = 0; index < first.results.length; index++) {
  const ref = first.results[index];
  for (const mode of ['static', 'changed']) {
    const builds = {};
    for (const build of ['baseline', 'candidate']) {
      builds[build] = reports
        .filter((r) => r.build === build)
        .map(({ data }) => {
          const r = data.results[index];
          assert.deepEqual(
            [r.kind, r.count, r.scale, r.totalNodes, r.gpu],
            [ref.kind, ref.count, ref.scale, ref.totalNodes, ref.gpu],
          );
          assert.deepEqual(
            r.states.map((s) => s.pixelSha256),
            ref.states.map((s) => s.pixelSha256),
          );
          return r.measurements.find((m) => m.mode === mode);
        });
    }
    const metrics = {};
    for (const metric of Object.keys(builds.baseline[0].metrics)) {
      const a = builds.baseline.map((m) => m.metrics[metric].medianMs);
      const b = builds.candidate.map((m) => m.metrics[metric].medianMs);
      metrics[metric] = {
        baselineMedianMs: median(a),
        candidateMedianMs: median(b),
        reductionPercent: (1 - median(b) / median(a)) * 100,
        baselineRunMediansMs: a,
        candidateRunMediansMs: b,
      };
    }
    const stats = Object.fromEntries(
      Object.entries(builds).map(([build, ms]) => [
        build,
        Object.fromEntries(
          ['primitives', 'drawCalls', 'recordBytes'].map((key) => {
            const numbers = ms.flatMap((m) => m.frameStats.map((s) => s[key]));
            return [key, [Math.min(...numbers), Math.max(...numbers)]];
          }),
        ),
      ]),
    );
    results.push({ kind: ref.kind, count: ref.count, scale: ref.scale, mode, metrics, stats });
  }
}
const summary = {
  schema: 1,
  workload: 'ui-renderer-comparison',
  runs,
  samples: Number(values.samples),
  warmup: Number(values.warmup),
  sourceNote:
    'Use otherwise matched release addons. Alternating fresh processes use the same SDK, fixtures, GPU, fonts and viewport. Pixels must match; records may differ.',
  machine: Object.fromEntries(
    ['node', 'platform', 'arch', 'os', 'cpu', 'buildProfile'].map((key) => [key, first[key]]),
  ),
  builds: Object.fromEntries(
    ['baseline', 'candidate'].map((build) => [
      build,
      reports.find((r) => r.build === build).data.addonSha256,
    ]),
  ),
  pixelsMatch: true,
  results,
};
await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', {
  flag: 'wx',
});
console.log(`Saved ${join(output, 'summary.json')}; all captured pixels match.`);
