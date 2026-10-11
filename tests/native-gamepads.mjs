import assert from 'node:assert/strict';
import { loadNative } from '../dist/native/index.js';

const { Gamepad } = loadNative().window;
assert.equal(typeof Gamepad.available(), 'boolean');
assert(Number.isInteger(Gamepad.count()) && Gamepad.count() >= 0);
const invalid = Gamepad.fromId(-1);
assert.equal(invalid.valid(), false);

// Native writes borrow only the supplied byte view, including its offset and length.
const storage = new Uint8Array(256).fill(0xa5);
assert.equal(invalid.snapshot(storage.subarray(16, 192)), false);
assert.equal(invalid.snapshot(storage.subarray(16, 17)), false);
assert(
  storage.every((byte) => byte === 0xa5),
  'invalid snapshots leave all bytes untouched',
);
assert.equal(Gamepad.drain(storage.subarray(16, 47)), 0);
assert(
  storage.every((byte) => byte === 0xa5),
  'a short event view writes nothing',
);
const count = Gamepad.drain(storage.subarray(16, 81));
assert(Number.isInteger(count) && count >= 0 && count <= 2);
assert(storage.subarray(0, 16).every((byte) => byte === 0xa5));
assert(storage.subarray(16 + count * 32).every((byte) => byte === 0xa5));
for (let i = 0; i < count; i++) {
  const kind = new DataView(storage.buffer).getUint32(16 + i * 32, true);
  assert(kind >= 1 && kind <= 5, 'drain returns complete declared event records');
}
console.log('Native gamepads: discovery, invalid handles and bounded mutable byte views passed');
