import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    baseline: { type: 'string' },
    candidate: { type: 'string' },
    output: { type: 'string', default: '.blinc/benchmarks/layout-comparison' },
    counts: { type: 'string', default: '100,1000,10000' },
    ratios: { type: 'string', default: '0.01,0.1,1' },
    samples: { type: 'string', default: '41' },
    warmup: { type: 'string', default: '10' },
    runs: { type: 'string', default: '3' },
  },
});
assert(
  values.baseline && values.candidate,
  'Provide --baseline <string-transport addon> and --candidate <numeric addon> built with matching sources/features',
);
const runs = Number(values.runs);
assert(Number.isSafeInteger(runs) && runs >= 2 && runs <= 20);
const output = resolve(values.output);
await mkdir(output, { recursive: true });
const collected = [];
for (const mode of ['cpu', 'gpu']) {
  for (let run = 0; run < runs; run++) {
    const order = run % 2 ? ['numeric', 'strings'] : ['strings', 'numeric'];
    for (const transport of order) {
      const name = `${mode}-${transport}-${run}`;
      const resultPath = join(output, name + '.json');
      const args = [
        fileURLToPath(new URL('./layout-pipeline.mjs', import.meta.url)),
        '--addon',
        resolve(transport === 'strings' ? values.baseline : values.candidate),
        '--transport',
        transport,
        '--counts',
        values.counts,
        '--ratios',
        values.ratios,
        '--samples',
        values.samples,
        '--warmup',
        values.warmup,
        '--output',
        resultPath,
      ];
      if (mode === 'gpu') {
        args.push('--gpu');
        if (run === 0) {
          args.push('--captures', join(output, name + '-captures'));
        }
      }
      console.error(`Run ${run + 1}/${runs}: ${mode} ${transport}`);
      await new Promise((done, reject) => {
        const child = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'inherit'] });
        child.on('error', reject);
        child.on('exit', (code, signal) =>
          code === 0 ? done() : reject(new Error(`${name} exited ${code ?? signal}`)),
        );
      });
      collected.push({
        mode,
        run,
        transport,
        data: JSON.parse(await readFile(resultPath, 'utf8')),
      });
    }
  }
}
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
};
const result = [];
for (const mode of ['cpu', 'gpu']) {
  const baseline = collected.filter((r) => r.mode === mode && r.transport === 'strings');
  const candidate = collected.filter((r) => r.mode === mode && r.transport === 'numeric');
  for (let index = 0; index < baseline[0].data.results.length; index++) {
    const ref = baseline[0].data.results[index];
    for (const run of [...baseline, ...candidate]) {
      const current = run.data.results[index];
      assert.deepEqual(
        [
          current.topology,
          current.targetNodes,
          current.dirtyRatio,
          current.dirtyCount,
          current.totalNodes,
        ],
        [ref.topology, ref.targetNodes, ref.dirtyRatio, ref.dirtyCount, ref.totalNodes],
      );
      assert.deepEqual(
        current.geometry,
        ref.geometry,
        'Geometry and capture hashes must match across builds/runs',
      );
      assert.deepEqual(current.gpu, ref.gpu, 'Use the same GPU, viewport and submitted geometry');
    }
    const metrics = {};
    for (const metric of Object.keys(ref.metrics)) {
      const strings = baseline.map((r) => r.data.results[index].metrics[metric].medianMs);
      const numeric = candidate.map((r) => r.data.results[index].metrics[metric].medianMs);
      const a = median(strings),
        b = median(numeric);
      metrics[metric] = {
        stringMedianMs: a,
        numericMedianMs: b,
        savedMs: a - b,
        reductionPercent: (1 - b / a) * 100,
        stringRunMediansMs: strings,
        numericRunMediansMs: numeric,
      };
    }
    result.push({
      mode,
      topology: ref.topology,
      totalNodes: ref.totalNodes,
      targetNodes: ref.targetNodes,
      dirtyRatio: ref.dirtyRatio,
      dirtyCount: ref.dirtyCount,
      metrics,
    });
  }
}
const summary = {
  schema: 1,
  workload: 'layout-enum-transport-comparison',
  runs,
  samples: Number(values.samples),
  warmup: Number(values.warmup),
  sourceNote:
    'Comparison requires otherwise matched native sources/features; addon hashes identify the exact tested binaries.',
  machine: Object.fromEntries(
    ['node', 'platform', 'arch', 'os', 'cpu', 'buildProfile'].map((k) => [k, collected[0].data[k]]),
  ),
  builds: {
    strings: collected.find((r) => r.transport === 'strings').data.addonSha256,
    numeric: collected.find((r) => r.transport === 'numeric').data.addonSha256,
  },
  geometryAndPixelsMatch: true,
  results: result,
};
await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
const report = [
  '# Layout transport benchmark',
  '',
  `Runs: ${runs} per build and mode; ${values.samples} timed samples after ${values.warmup} warm-up frames.`,
  '',
  'Numbers below are medians of run medians. Positive savings mean less elapsed time. Raw stage samples and both-phase geometry/pixel hashes are in the accompanying JSON files.',
  '',
  '| Mode | Shape | Nodes | Changed targets | Metric | Strings (ms) | Numeric (ms) | Saved (ms) | Reduction |',
  '| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |',
];
for (const r of result) {
  for (const name of r.mode === 'cpu'
    ? ['styleMs', 'cpuLayoutMs']
    : ['cpuSubmitMs', 'frameCompletedMs']) {
    const m = r.metrics[name];
    report.push(
      `| ${r.mode} | ${r.topology} | ${r.totalNodes} | ${r.dirtyCount} | ${name} | ${m.stringMedianMs.toFixed(3)} | ${m.numericMedianMs.toFixed(3)} | ${m.savedMs.toFixed(3)} | ${m.reductionPercent.toFixed(1)}% |`,
    );
  }
}
report.push(
  '',
  'GPU frames draw rectangles from actual layout bounds with one upload and instanced draw. Completion latency includes native polling and promise delivery. These measurements exclude text, UI display-list encoding, clipping/effects, virtualization and window presentation. Snapshot readback is outside timed frames.',
  '',
);
await writeFile(join(output, 'report.md'), report.join('\n'));
console.log(`Saved ${join(output, 'report.md')}; all compared geometry and captured pixels match.`);
