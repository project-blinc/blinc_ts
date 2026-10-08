import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeWindowHost } from '../dist/native/window.js';
import { gpu } from '../dist/native/index.js';

// Injectable bindings model only surface/lifetime events that are hard to force on a real compositor.
function fixture(options = {}) {
  const destroyed = [],
    configured = [];
  const state = {
    visible: true,
    minimized: false,
    width: 600,
    height: 400,
    scale: 2,
    frames: 0,
    unavailable: 0,
  };
  const resource = (name, members = {}) => ({
    valid: () => true,
    destroy: () => destroyed.push(name),
    ...members,
  });
  const capabilities = resource('capabilities', {
    formatCount: () => 2,
    format: (i) => [gpu.TextureFormat.Bgra8unormSrgb, gpu.TextureFormat.Bgra8unorm][i],
    alphaModeCount: () => 2,
    alphaMode: (i) => [gpu.AlphaMode.Opaque, gpu.AlphaMode.PreMultiplied][i],
  });
  const surface = resource('surface', {
    capabilities: () => capabilities,
    acquire: () => resource('view', { valid: () => state.unavailable-- <= 0 }),
  });
  const queue = {
    presentSurface() {
      state.frames++;
    },
  };
  const device = resource('device', {
    queue: () => queue,
    configureSurfaceWith: (_, config) => configured.push(config),
    takeError: () => null,
    encoder: () =>
      resource('encoder', { submit() {}, passColour() {}, passBegin() {}, renderEnd() {} }),
  });
  const adapter = resource('adapter', {
    requestDevice: options.requestDevice ?? (() => Promise.resolve(device)),
  });
  const instance = resource('instance', {
    requestAdapter: options.requestAdapter ?? (() => Promise.resolve(adapter)),
    surface: () => surface,
  });
  const events = [];
  const window = {
    poll: () => events.shift() ?? { kind: 'None' },
    close: () => destroyed.push('window'),
    platform: () => 1,
    raw: () => 0n,
    isVisible: () => state.visible,
    isMinimized: () => state.minimized,
    width: () => state.width,
    height: () => state.height,
    scaleFactor: () => state.scale,
    prePresentNotify() {},
  };
  const bindings = {
    window: { Window: { open: () => window } },
    gpu: { GpuInstance: { new: () => instance } },
  };
  return { bindings, state, destroyed, configured, adapter, device, events };
}
class Host extends NativeWindowHost {
  paint(callback, dispose = () => {}) {
    return this.setPainter(callback, dispose);
  }
}

test('window host defers unavailable/hidden frames, coalesces requests and retains in-frame requests', async () => {
  const f = fixture();
  const host = new Host(f.bindings, { transparent: true });
  try {
    await host.ready;
    assert.equal(host.format, gpu.TextureFormat.Bgra8unorm);
    let draws = 0;
    host.paint((_encoder, _target, width, height, scale) => {
      draws++;
      assert.deepEqual([width, height, scale], [600, 400, 2]);
      if (draws === 1) {
        host.requestFrame();
      }
    });
    f.state.unavailable = 1;
    assert.equal(host.render(), false);
    assert.equal(draws, 0);
    assert.equal(host.render(), true);
    assert.equal(host.render(), true, 'Request during paint survives presentation');
    assert.equal(host.render(), false);
    assert.equal(f.configured.length, 2, 'Unavailable frame is reconfigured on a later attempt');
    assert.equal(f.configured[0].alphaMode, gpu.AlphaMode.PreMultiplied);
    f.state.visible = false;
    for (let i = 0; i < 20; i++) {
      host.requestFrame();
    }
    assert.equal(host.render(), false);
    f.state.visible = true;
    assert.equal(host.render(), true);
    assert.equal(host.render(), false);
    assert.equal(draws, 3);
  } finally {
    host.dispose();
  }
  assert.deepEqual(f.destroyed.slice(-4), ['device', 'adapter', 'instance', 'window']);
  assert(f.destroyed.indexOf('surface') < f.destroyed.indexOf('window'));
});

test('window initialization can be cancelled while adapter or device is pending', async () => {
  for (const stage of ['requestAdapter', 'requestDevice']) {
    const pending = Promise.withResolvers();
    let requested = false;
    const f = fixture({
      [stage]: () => {
        requested = true;
        return pending.promise;
      },
    });
    const host = new Host(f.bindings);
    await Promise.resolve();
    assert(requested);
    host.dispose();
    host.dispose();
    pending.resolve(stage === 'requestAdapter' ? f.adapter : f.device);
    await host.ready;
    assert.equal(host.disposed, true);
    assert.equal(f.destroyed.filter((name) => name === 'window').length, 1);
    assert(f.destroyed.includes('instance'));
    assert(f.destroyed.includes('adapter'));
    if (stage === 'requestDevice') {
      assert(f.destroyed.includes('device'));
    }
    assert.equal(f.configured.length, 0);
  }
});

test('scoped release holds the previous frame until replacement, while explicit detach clears', async () => {
  const f = fixture();
  const host = new Host(f.bindings);
  try {
    await host.ready;
    const remove = host.paint(() => {});
    host.render();
    remove();
    host.requestFrame();
    assert.equal(host.render(), false, 'No blank frame during an asynchronous HMR gap');
    assert.equal(host.frames, 1);
    host.paint(() => {});
    assert.equal(host.render(), true);
    host.detachScene();
    assert.equal(host.render(), true, 'Explicit detach clears the window');
  } finally {
    host.dispose();
  }
});

test('stale painter cleanup is safe and a failed frame releases the held surface', async () => {
  const f = fixture();
  const host = new Host(f.bindings);
  await host.ready;
  let released = 0,
    rendered = 0;
  const remove = host.paint(
    () => {},
    () => {
      released++;
    },
  );
  host.paint(() => {
    rendered++;
  });
  remove();
  assert.equal(released, 1);
  host.render();
  assert.equal(rendered, 1);
  const failure = new Error('paint failed');
  host.paint(() => {
    throw failure;
  });
  assert.throws(
    () => host.render(),
    (error) => error === failure,
  );
  assert.equal(host.error, failure);
  assert.equal(host.disposed, true);
  assert.equal(f.destroyed.filter((name) => name === 'surface').length, 1);
  host.dispose();
});
