import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'vite';
import { PNG } from 'pngjs';
import { Scope } from '../dist/hmr.js';
import { Brush, gpu, loadNative } from '../dist/native/index.js';
import { NativeWindowHost } from '../dist/native/window.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative();
const output = new URL('../.blinc/window/', import.meta.url);
const fixtures = new URL('../.test-fixtures/', import.meta.url);
await mkdir(output, { recursive: true });
await mkdir(fixtures, { recursive: true });
const directory = await mkdtemp(fileURLToPath(new URL('window-scene-', fixtures)));
await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    outDir: directory,
    lib: { entry: 'examples/native/scene.ts', formats: ['es'], fileName: () => 'scene.mjs' },
    rollupOptions: { external: ['blinc_ts/native', 'blinc_ts/hmr'] },
  },
});
const { createScene } = await import(pathToFileURL(directory + '/scene.mjs').href);
const host = new NativeWindowHost(native, {
  title: 'Native scene verification',
  width: 720,
  height: 480,
});
const scope = new Scope();
const demo = createScene(native, scope);
let computes = 0;
const compute = demo.layout.compute.bind(demo.layout);
demo.layout.compute = (...args) => {
  computes++;
  return compute(...args);
};
const waitFor = async (condition, message) => {
  const until = performance.now() + 5000;
  while (!condition()) {
    assert.equal(host.error, undefined);
    assert(performance.now() < until, message);
    await delay(16);
  }
};
try {
  await host.ready;
  assert([gpu.TextureFormat.Rgba8unorm, gpu.TextureFormat.Bgra8unorm].includes(host.format));
  const renderer = host.attachScene(demo.layout, demo.root, { cornerShape: 2 }, scope);
  await waitFor(() => host.frames > 0 && host.stats?.primitives > 25, 'First scene frame');
  await delay(100); // Drain the initial window/exposure events before measuring idle behavior.
  const before = host.frames;
  const beforeLayout = computes;
  await delay(100);
  assert.equal(host.frames, before, 'Unchanged scenes do not redraw');
  assert.equal(host.render(), false);
  const bounds = new Float32Array(4);
  demo.layout.readBounds([demo.root], bounds);
  assert.equal(bounds[2], host.window.width() / host.window.scaleFactor());
  assert.equal(bounds[3], host.window.height() / host.window.scaleFactor());
  for (let i = 0; i < 20; i++) {
    demo.glass.setPaint({ opacity: 0.8 + i / 100 });
  }
  assert.equal(host.render(), true, 'Successful paint edits request a frame');
  assert.equal(host.frames, before + 1, 'Many synchronous changes coalesce');
  assert.equal(computes, beforeLayout, 'Paint changes skip layout');
  const validFrames = host.frames;
  assert.throws(() => demo.glass.setStyle({ width: 'invalid' }));
  assert.equal(host.render(), false, 'Rejected edits do not schedule frames');
  assert.equal(host.frames, validFrames);
  demo.glass.setStyle({ width: 360 });
  host.render();
  assert.equal(computes, beforeLayout + 1, 'Geometry changes recompute layout once');
  host.window.setVisible(false);
  demo.glass.setPaint({ opacity: 1 });
  if (process.platform === 'linux' && host.window.platform() === 4) {
    // xwindow platform 4 is Wayland: winit cannot hide its toplevels.
    assert.equal(host.window.isVisible(), true);
    assert.equal(host.render(), true, 'Unsupported hiding must not suspend a visible surface');
  } else {
    assert.equal(host.window.isVisible(), false, 'The native window is hidden');
    assert.equal(host.render(), false, 'Hidden windows defer drawing');
  }
  host.window.setVisible(true);
  const atResize = host.frames;
  host.window.setSize(760, 520);
  await waitFor(() => {
    // The OS can update its size before the corresponding scene frame is presented.
    demo.layout.readBounds([demo.root], bounds);
    return host.frames > atResize && bounds[2] === 760 && bounds[3] === 520;
  }, 'Resize frame');
  demo.layout.readBounds([demo.root], bounds);
  assert.equal(bounds[2], 760);
  assert.equal(bounds[3], 520);

  // Snapshot the same demo through the scene renderer, including actual glass pixels.
  const target = await OffscreenRenderer.create(native, 720, 480, probeShader);
  const snapshot = new SceneRenderer(target.device, demo.layout);
  try {
    const capture = async (name) => {
      demo.layout.compute(demo.root, 720, 480);
      const pixels = new Uint8Array(720 * 480 * 4);
      await target.captureCommandsInto(
        pixels,
        (encoder, view) =>
          snapshot.encode(encoder, demo.root, view, { width: 720, height: 480, cornerShape: 2 })
            .drawCalls,
      );
      await writeFile(
        new URL(name + '.png', output),
        PNG.sync.write({ width: 720, height: 480, data: Buffer.from(pixels) }),
      );
      return pixels;
    };
    const low = await capture('native-scene');
    assert.deepEqual([...low.slice(0, 4)], [16, 23, 34, 255]);
    demo.toggle();
    const high = await capture('native-scene-dispersion');
    assert.notDeepEqual(high, low, 'Demo updates its rendered scene');
  } finally {
    snapshot.dispose();
    target.dispose();
  }

  const replacement = native.createLayout();
  const root = replacement.createNode({ width: '100%', height: '100%' });
  root.setPaint({ background: Brush.solid(0x174e65) });
  const beforeReplace = host.frames;
  host.attachScene(replacement, root);
  scope.dispose(); // Old cleanup must leave the replacement active.
  assert.equal(demo.layout.disposed, true);
  assert.throws(() => renderer.setImage(0, {}), /disposed/);
  await waitFor(
    () => host.frames > beforeReplace && host.stats?.primitives === 1,
    'Replacement scene frame',
  );
  const beforeDetach = host.frames;
  replacement.dispose(); // Disposing a caller-owned scene detaches its renderer.
  await waitFor(() => host.frames > beforeDetach, 'Detached scene clears the window');
  assert.equal(host.stats, undefined);
  assert.equal(host.device.takeError(), null);
  console.log(
    JSON.stringify({
      test: 'Native scene presentation',
      frames: host.frames,
      paintSkipsLayout: true,
      coalescedEdits: 20,
      resize: [760, 520],
      format: host.format,
      output: output.pathname,
    }),
  );
} finally {
  scope.dispose();
  host.dispose();
  await rm(directory, { recursive: true, force: true });
}
