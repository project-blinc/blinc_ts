// What motion costs: the engine offscreen (starting transitions, ticking
// paint, keyframes, layout transitions and FLIP, and the restyle overhead of
// declaring them), memory before, during and after, and with --window the
// process CPU and frame rate of a window animating, then the same scene still.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { arch, cpus, platform } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';

const { values } = parseArgs({
  options: {
    nodes: { type: 'string', default: '2000' },
    frames: { type: 'string', default: '120' },
    window: { type: 'boolean', default: false },
    'window-nodes': { type: 'string', default: '300' },
    seconds: { type: 'string', default: '3' },
  },
});
const N = Number(values.nodes);
const FRAMES = Number(values.frames);
assert(Number.isSafeInteger(N) && N > 0 && Number.isSafeInteger(FRAMES) && FRAMES > 0);
const root = fileURLToPath(new URL('../', import.meta.url));
assert.equal(
  createRequire(import.meta.url)(resolve(root, 'native/blinc_ts.node')).buildProfile(),
  'release',
);
const native = loadNative();
const W = 1200;
const H = 900;

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const round = (v, places = 3) => Math.round(v * 10 ** places) / 10 ** places;
const mb = (bytes) => round(bytes / 1048576, 1);
const memory = () => {
  const m = process.memoryUsage();
  return { rss: m.rss, heapUsed: m.heapUsed, external: m.external };
};

/** A host with `count` boxes under one container, styled by `css`. */
function scene(css, count = N) {
  const host = Host.create(native);
  host.onStyleErrors((errors) => assert.fail(errors.join('\n')));
  host.root.setAttribute('style', 'background: #202020');
  host.layout.addStyleSheet(css);
  const holder = host.createElement('div');
  holder.setAttribute('class', 'holder');
  const boxes = [];
  for (let i = 0; i < count; i++) {
    const box = host.createElement('div');
    box.setAttribute('class', 'box');
    holder.appendChild(box);
    boxes.push(box);
  }
  host.root.appendChild(holder);
  host.compute(W, H);
  return { host, holder, boxes };
}

const BOX =
  '.holder { flex-direction: row; flex-wrap: wrap; } .box { width: 8px; height: 8px; background: #ff0000; }';

/** Milliseconds `run` takes, best of `times`. */
function time(run, times = 5) {
  let best = Infinity;
  for (let i = 0; i < times; i++) {
    const start = performance.now();
    run(i);
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

/** Median milliseconds per frame of `frame(t)` over FRAMES frames 16ms apart. */
function perFrame(frame, from = 0) {
  const ms = [];
  for (let i = 0; i < FRAMES; i++) {
    const start = performance.now();
    frame(from + i * 16);
    ms.push(performance.now() - start);
  }
  return median(ms);
}

const report = {
  node: process.version,
  platform: platform(),
  arch: arch(),
  cpu: cpus()[0]?.model,
  nodes: N,
  frames: FRAMES,
  engine: {},
};
const engine = report.engine;
const before = memory();

// Declaring transitions: a restyle of every box, which reads a theme variable, with and without them.
{
  const themed = `${BOX} .box { background: var(--tint, #ff0000); }`;
  const plain = scene(themed);
  const declared = scene(`${themed} .box { transition: opacity 1s linear, transform 1s linear; }`);
  // Interleaved, so both see the same state of the machine; the median of each.
  const runs = { plain: [], withTransitions: [] };
  for (let i = 0; i < 31; i++) {
    for (const [name, { host }] of [
      ['plain', plain],
      ['withTransitions', declared],
    ]) {
      const start = performance.now();
      host.layout.setTheme({ '--tint': i % 2 ? '#ff0000' : '#00ff00' });
      host.compute(W, H);
      runs[name].push(performance.now() - start);
    }
  }
  engine.restyleAllMs = {
    plain: round(median(runs.plain)),
    withTransitions: round(median(runs.withTransitions)),
  };
  plain.host.dispose();
  declared.host.dispose();
}

// Starting changes on every box: applied at once, then as transitions.
{
  const change = '.on .box { opacity: 0.2; transform: translateX(4px); }';
  const plain = scene(`${BOX} ${change}`);
  const start = performance.now();
  plain.holder.setAttribute('class', 'holder on');
  plain.host.compute(W, H);
  engine.changeAtOnceMs = round(performance.now() - start);
  plain.host.dispose();
}

// Paint transitions: starting N of them, then a frame of them all running.
{
  const s = scene(
    `${BOX} .box { transition: opacity 2s linear, transform 2s linear; } .on .box { opacity: 0.2; transform: translateX(4px); }`,
  );
  const quiet = memory();
  const start = performance.now();
  s.holder.setAttribute('class', 'holder on');
  s.host.compute(W, H);
  engine.paintStartMs = round(performance.now() - start);
  s.host.layout.tickMotion(0);
  const running = memory();
  engine.paintTickMs = round(perFrame((t) => s.host.layout.tickMotion(t), 1));
  s.host.layout.tickMotion(10000);
  assert.equal(s.host.layout.tickMotion(10016), false, 'every transition ended');
  const ended = memory();
  // Back and forth, each run to its end: what stays between cycles is held, not spent.
  const cycles = [];
  let t = 20000;
  for (let i = 0; i < 6; i++) {
    s.holder.setAttribute('class', i % 2 ? 'holder on' : 'holder');
    s.host.compute(W, H);
    s.host.layout.tickMotion(t);
    s.host.layout.tickMotion(t + 5000);
    t += 10000;
    cycles.push(mb(memory().rss - quiet.rss));
  }
  engine.paintMemoryMb = {
    sceneRss: mb(quiet.rss - before.rss),
    runningRssDelta: mb(running.rss - quiet.rss),
    afterEndRssDelta: mb(ended.rss - quiet.rss),
    rssDeltaAfterEachCycle: cycles,
  };
  s.host.dispose();
}

// Keyframe animations, two properties each, running forever.
{
  const s = scene(
    `${BOX} .box { animation: pulse 1s linear infinite alternate; } @keyframes pulse { from { opacity: 0.2; transform: scale(0.5); } to { opacity: 1; transform: none; } }`,
  );
  engine.keyframesTickMs = round(perFrame((t) => s.host.layout.tickMotion(t)));
  s.host.dispose();
}

// Layout transitions: each frame ticks, then lays out what moved.
{
  const s = scene(`${BOX} .box { transition: width 2s linear; } .on .box { width: 16px; }`);
  s.holder.setAttribute('class', 'holder on');
  s.host.compute(W, H);
  // One plain layout of the scene: a box's width changed, so the row lays out again.
  engine.layoutAloneMs = round(
    time((i) => {
      s.boxes[N - 1].setProperty('width', i % 2 ? 8 : 9);
      s.host.compute(W, H);
    }),
  );
  engine.layoutFrameMs = round(
    perFrame((t) => {
      s.host.layout.tickMotion(t);
      s.host.compute(W, H);
    }),
  );
  s.host.dispose();
}

// FLIP: every box animates its layout; one inserted at the front moves them all.
{
  const s = scene(BOX);
  for (const box of s.boxes) {
    box.animateLayout({ duration: 2000, easing: 'linear' });
  }
  s.host.compute(W, H);
  const extra = s.host.createElement('div');
  extra.setAttribute('class', 'box');
  const start = performance.now();
  s.holder.insertBefore(extra, s.boxes[0]);
  s.host.compute(W, H);
  engine.flipStartMs = round(performance.now() - start);
  engine.flipFrameMs = round(
    perFrame((t) => {
      s.host.layout.tickMotion(t);
      s.host.compute(W, H);
    }),
  );
  s.host.dispose();
}

engine.perNodeMicroseconds = {
  paintTick: round((engine.paintTickMs * 1000) / N, 2),
  keyframesTick: round((engine.keyframesTickMs * 1000) / N, 2),
  layoutFrame: round((engine.layoutFrameMs * 1000) / N, 2),
  flipFrame: round((engine.flipFrameMs * 1000) / N, 2),
};

if (values.window) {
  const { NativeWindowHost } = await import('../dist/native/window.js');
  const count = Number(values['window-nodes']);
  const seconds = Number(values.seconds);
  const window = new NativeWindowHost(native, { title: 'Motion cost', width: 800, height: 600 });
  await window.ready;
  const host = Host.create(native);
  host.root.setAttribute('style', 'background: #202020');
  host.layout.addStyleSheet(
    `${BOX} .box { width: 24px; height: 24px; animation: pulse 1s linear infinite alternate; } .still .box { animation-play-state: paused; } @keyframes pulse { from { opacity: 0.2; transform: scale(0.5); } to { opacity: 1; transform: none; } }`,
  );
  const holder = host.createElement('div');
  holder.setAttribute('class', 'holder');
  for (let i = 0; i < count; i++) {
    const box = host.createElement('div');
    box.setAttribute('class', 'box');
    holder.appendChild(box);
  }
  host.root.appendChild(holder);
  // How much of each frame is the motion tick, as against laying out and drawing.
  let tickMs = 0;
  const tick = host.layout.tickMotion.bind(host.layout);
  host.layout.tickMotion = (now) => {
    const start = performance.now();
    const moving = tick(now);
    tickMs += performance.now() - start;
    return moving;
  };
  host.mount(window);
  await delay(1000);
  const sample = async () => {
    const start = performance.now();
    const cpu = process.cpuUsage();
    const frames = window.frames;
    const ticked = tickMs;
    await delay(seconds * 1000);
    const elapsed = performance.now() - start;
    const used = process.cpuUsage(cpu);
    const presented = window.frames - frames;
    return {
      cpuPercent: round((used.user + used.system) / elapsed / 10, 1),
      fps: round((presented * 1000) / elapsed, 1),
      motionTickPercent: round(((tickMs - ticked) / elapsed) * 100, 2),
      motionTickMsPerFrame: presented ? round((tickMs - ticked) / presented) : 0,
      rssMb: mb(process.memoryUsage().rss),
    };
  };
  report.window = { nodes: count, scale: window.window.scaleFactor(), animating: await sample() };
  holder.setAttribute('class', 'holder still');
  await delay(500);
  report.window.still = await sample();
  if (process.platform === 'darwin') {
    try {
      const summary = execFileSync('/usr/bin/vmmap', ['-summary', String(process.pid)], {
        encoding: 'utf8',
        timeout: 15000,
      });
      report.window.physicalFootprint = summary.match(/^Physical footprint:\s*(.+)$/m)?.[1];
    } catch (error) {
      report.window.footprintError = String(error);
    }
  }
  host.dispose();
  window.dispose();
  await window.closed;
}
console.log(JSON.stringify(report, null, 2));
