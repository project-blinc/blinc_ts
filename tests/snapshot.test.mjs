import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { parse } from '../tools/snapshot/args.mjs';
import { encode, compare } from '../tools/snapshot/image.mjs';
import { viewer } from '../tools/snapshot/viewer.mjs';

test('RGBA snapshots preserve alpha and compare all channels with an inclusive tolerance', () => {
  const image = { width: 2, height: 1, data: Uint8Array.of(10, 20, 30, 40, 50, 60, 70, 80) };
  const decoded = PNG.sync.read(encode(image.width, image.height, image.data));
  assert.deepEqual([...decoded.data], [...image.data]);
  assert.equal(compare(image, decoded).changedPixels, 0);
  decoded.data[0] += 2;
  decoded.data[7] -= 3;
  const result = compare(image, decoded, 2);
  assert.equal(result.changedPixels, 1);
  assert.equal(result.changedRatio, 0.5);
  assert.equal(result.maximumDelta, 3);
  assert.deepEqual([...result.diff.subarray(4)], [255, 32, 64, 255]);
  const reused = new Uint8Array(8);
  assert.equal(compare(image, decoded, 2, reused).diff, reused);
  assert.throws(() => compare(image, decoded, 2, image.data), /overlap/);
  assert.throws(() => compare(image, { ...decoded, width: 3 }), /dimensions/);
  assert.throws(() => compare(image, { ...decoded, data: new Uint8Array(4) }), /RGBA/);
});

test('capture options reject invalid limits and prevent overwriting a baseline', () => {
  const options = parse([
    'motion',
    '--width',
    '319',
    '--height',
    '213',
    '--frames',
    '31',
    '--fps',
    '30',
  ]);
  assert.equal(options.scene, 'motion');
  assert.equal(options.frames, 31);
  for (const input of [
    ['toString'],
    ['--width', 'NaN'],
    ['--fps', '0'],
    ['--frames', '601'],
    ['--at', 'Infinity'],
    ['--tolerance', 'NaN'],
    ['--max-diff', 'NaN'],
    ['--max-diff', '1.01'],
    ['--width', '8193'],
    ['--width'],
    ['__proto__', '0'],
    ['probe', '--output', '/tmp/capture', '--baseline', '/tmp/capture/frame-0000.png'],
  ]) {
    assert.throws(() => parse(input), Error);
  }
  assert.equal(parse(['--width', '64']).scene, 'probe');
  assert.equal(
    parse(['probe', '--baseline', '/tmp/reference.png']).baseline,
    resolve('/tmp/reference.png'),
  );
});

test('offline viewer embeds debug data without closing its script element', () => {
  const manifest = { width: 2, height: 1, frames: [{ debug: { text: '</script><svg>' } }] };
  const html = viewer(manifest);
  const data = /<script id="capture" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1];
  assert(!data.includes('</script>'));
  assert.deepEqual(JSON.parse(data), manifest);
  assert(!html.includes('__BLINC_CLIENT__'));
  assert(html.includes('requestAnimationFrame(tick)'));
});
