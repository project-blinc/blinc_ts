import { PNG } from 'pngjs';
export function encode(width, height, rgba) {
  if (rgba.length !== width * height * 4) {
    throw new Error('Invalid RGBA image');
  }
  return PNG.sync.write({
    width,
    height,
    data: Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength),
  });
}
export function compare(
  current,
  reference,
  tolerance = 2,
  diff = new Uint8Array(current.width * current.height * 4),
) {
  if (current.width !== reference.width || current.height !== reference.height) {
    throw new Error('Snapshot dimensions differ');
  }
  if (
    current.data.length !== current.width * current.height * 4 ||
    reference.data.length !== reference.width * reference.height * 4
  ) {
    throw new Error('Invalid RGBA image');
  }
  if (
    diff.length !== current.data.length ||
    !Number.isFinite(tolerance) ||
    tolerance < 0 ||
    tolerance > 255
  ) {
    throw new Error('Invalid diff buffer or tolerance');
  }
  for (const source of [current.data, reference.data]) {
    if (
      diff.buffer === source.buffer &&
      diff.byteOffset < source.byteOffset + source.byteLength &&
      source.byteOffset < diff.byteOffset + diff.byteLength
    ) {
      throw new Error('Diff buffer must not overlap image data');
    }
  }
  let changedPixels = 0,
    maximumDelta = 0;
  for (let i = 0; i < current.data.length; i += 4) {
    let delta = 0;
    for (let channel = 0; channel < 4; channel++) {
      delta = Math.max(delta, Math.abs(current.data[i + channel] - reference.data[i + channel]));
    }
    maximumDelta = Math.max(maximumDelta, delta);
    const changed = delta > tolerance;
    if (changed) {
      changedPixels++;
    }
    diff[i] = changed ? 255 : current.data[i] * 0.25;
    diff[i + 1] = changed ? 32 : current.data[i + 1] * 0.25;
    diff[i + 2] = changed ? 64 : current.data[i + 2] * 0.25;
    diff[i + 3] = 255;
  }
  return {
    changedPixels,
    changedRatio: changedPixels / (current.width * current.height),
    maximumDelta,
    diff,
  };
}
