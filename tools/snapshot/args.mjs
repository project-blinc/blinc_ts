import { resolve, sep } from 'node:path';

const flags = {
  '--width': 'width',
  '--height': 'height',
  '--frames': 'frames',
  '--fps': 'fps',
  '--at': 'at',
  '--tolerance': 'tolerance',
  '--max-diff': 'maxDiff',
  '--output': 'output',
  '--baseline': 'baseline',
};

/** Shared validation runs before loading any native code. */
export function parse(args) {
  const input = [...args];
  const scene = input[0]?.startsWith('--') || !input.length ? 'probe' : input.shift();
  if (!['probe', 'motion'].includes(scene)) {
    throw new Error('Scene must be probe or motion');
  }
  const options = {
    scene,
    width: 640,
    height: 420,
    frames: 1,
    fps: 30,
    at: 0,
    tolerance: 2,
    maxDiff: 0,
    output: resolve('.blinc/snapshots', scene),
    baseline: undefined,
  };
  for (let i = 0; i < input.length; i += 2) {
    const key = input[i],
      value = input[i + 1];
    if (!Object.hasOwn(flags, key)) {
      throw new Error('Unknown option ' + key);
    }
    if (value === undefined) {
      throw new Error('Missing value for ' + key);
    }
    options[flags[key]] =
      key === '--output' || key === '--baseline' ? resolve(value) : Number(value);
  }
  for (const key of ['width', 'height', 'frames', 'fps']) {
    if (!Number.isSafeInteger(options[key]) || options[key] < 1) {
      throw new Error('Invalid ' + key);
    }
  }
  if (
    options.width > 8192 ||
    options.height > 8192 ||
    options.frames > 600 ||
    options.fps > 240 ||
    !Number.isFinite(options.at) ||
    options.at < 0 ||
    !Number.isFinite(options.tolerance) ||
    options.tolerance < 0 ||
    options.tolerance > 255 ||
    !Number.isFinite(options.maxDiff) ||
    options.maxDiff < 0 ||
    options.maxDiff > 1
  ) {
    throw new Error('Invalid capture limits');
  }
  if (options.baseline === options.output || options.baseline?.startsWith(options.output + sep)) {
    throw new Error('Keep baselines outside the capture output directory');
  }
  return options;
}
