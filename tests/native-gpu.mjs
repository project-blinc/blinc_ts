import assert from 'node:assert/strict';
import { loadNative } from '../dist/native/index.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const renderer = await OffscreenRenderer.create(loadNative(), 319, 213, probeShader);
const pixels = new Uint8Array(renderer.width * renderer.height * 4);
try {
  assert.equal(renderer.rowStride % 256, 0);
  assert(renderer.rowStride > renderer.width * 4, 'Odd-width capture must exercise row padding');
  const pending = renderer.captureInto(pixels, probeShader.vertexCount);
  await assert.rejects(renderer.captureInto(pixels, probeShader.vertexCount), /already pending/);
  assert.throws(() => renderer.dispose(), /pending capture/);
  const stats = await pending;
  const sample = (x, y) =>
    Array.from(pixels.subarray((y * renderer.width + x) * 4, (y * renderer.width + x) * 4 + 4));
  const topLeft = sample(0, 0),
    bottomRight = sample(renderer.width - 1, renderer.height - 1);
  assert(
    topLeft[0] < 8 && topLeft[1] < 8 && Math.abs(topLeft[2] - 128) < 2 && topLeft[3] === 255,
    JSON.stringify(topLeft),
  );
  assert(
    bottomRight[0] > 247 &&
      bottomRight[1] > 247 &&
      Math.abs(bottomRight[2] - 128) < 2 &&
      bottomRight[3] === 255,
    JSON.stringify(bottomRight),
  );
  await assert.rejects(renderer.captureInto(new Uint8Array(4), 3), /target size/);
  const second = new Uint8Array(pixels.length);
  await renderer.captureInto(second, probeShader.vertexCount);
  assert.deepEqual(second, pixels);
  console.log(
    JSON.stringify({
      test: 'Offscreen TypeGPU render and readback',
      topLeft,
      bottomRight,
      rowStride: stats.rowStride,
    }),
  );
} finally {
  renderer.dispose();
  renderer.dispose();
}
await assert.rejects(renderer.captureInto(pixels, 3), /disposed/);
