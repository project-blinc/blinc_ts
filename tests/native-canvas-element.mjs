// A canvas element draws GPU commands of its own at its place, clipped to its corners, through
// every renderer that draws its host, until it is stopped or destroyed.
import assert from 'node:assert/strict';
import { loadNative, gpu } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';
import { canvasProbeShader } from '../dist/renderer/generated/canvasProbe.js';

const native = loadNative();
const W = 200;
const H = 120;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const host = Host.create(native);
const renderers = [];
try {
  host.root.setAttribute('style', 'background: #202020');
  const canvas = host.createElement('canvas');
  canvas.setAttribute(
    'style',
    'position: absolute; left: 40px; top: 20px; width: 120px; height: 80px; border-radius: 24px; color: #ffffff',
  );
  host.root.appendChild(canvas);
  let prepared = 0;
  let released = 0;
  let painted = 0;
  const drawing = {
    prepare(renderer, scope) {
      prepared++;
      const device = target.device;
      const layout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: gpu.ShaderStage.FRAGMENT,
            buffer: { type: gpu.BufferBindingType.Uniform },
          },
        ],
      });
      const tint = device.createBuffer({
        size: 16n,
        usage: gpu.BufferUsage.UNIFORM | gpu.BufferUsage.COPY_DST,
      });
      target.queue.writeBuffer(tint, 0n, new Uint8Array(new Float32Array([1, 0, 0, 1]).buffer), 16);
      const group = device.createBindGroup({
        layout,
        entries: [{ binding: 0, resource: { kind: 'Buffer', value: tint } }],
      });
      const program = renderer.createCanvasPipeline(canvasProbeShader, [layout], scope);
      scope.onCleanup(() => {
        released++;
        group.destroy();
        tint.destroy();
        layout.destroy();
      });
      return (frame) => {
        painted++;
        frame.bind(program);
        frame.encoder.renderSetBindGroup(2, group);
        frame.draw(program);
      };
    },
  };
  const stop = host.canvases.draw(canvas, drawing);
  const capture = async (renderer) => {
    host.compute(W, H);
    const pixels = new Uint8Array(W * H * 4);
    await target.captureCommandsInto(
      pixels,
      (encoder, view) =>
        renderer.encode(encoder, host.root.layoutNode, view, { width: W, height: H, scale: 1 })
          .drawCalls,
    );
    return (x, y) => [...pixels.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)];
  };
  const red = (p) => p[0] > 150 && p[1] < 40 && p[2] < 40;
  const ground = (p) => p.every((c) => Math.abs(c - 0x20) <= 6);

  // Attached, a renderer draws it: red inside, the ground at a corner its radius cuts away.
  const first = new SceneRenderer(target.device, host.layout);
  renderers.push(first);
  host.canvases.attach(first);
  assert.equal(prepared, 1, 'prepared once for the renderer');
  let at = await capture(first);
  assert.ok(red(at(100, 60)), `drawn inside: ${at(100, 60)}`);
  assert.ok(ground(at(42, 22)), `clipped at its corner: ${at(42, 22)}`);
  assert.ok(ground(at(20, 60)), 'and nothing beside it');
  assert.equal(painted, 1);

  // A second renderer prepares its own, and draws it too.
  const second = new SceneRenderer(target.device, host.layout);
  renderers.push(second);
  const detach = host.canvases.attach(second);
  assert.equal(prepared, 2);
  at = await capture(second);
  assert.ok(red(at(100, 60)), 'the second renderer draws it');
  detach();
  assert.equal(released, 1, 'detaching releases what was prepared for it');

  // Stopped, it draws nothing and lets go of what it prepared.
  stop();
  assert.equal(released, 2);
  at = await capture(first);
  assert.ok(ground(at(100, 60)), `stopped, nothing is drawn: ${at(100, 60)}`);

  // Drawn again, then destroyed with a parent: it stops on its own.
  const holder = host.createElement('div');
  host.root.appendChild(holder);
  holder.appendChild(canvas);
  host.canvases.draw(canvas, drawing);
  assert.equal(prepared, 3, 'drawn again, prepared for the attached renderer');
  at = await capture(first);
  assert.ok(red(at(100, 60)));
  holder.destroy();
  assert.equal(released, 3, 'destroyed, it is released');
  at = await capture(first);
  assert.ok(ground(at(100, 60)));

  // Only a canvas draws.
  assert.throws(() => host.canvases.draw(host.createElement('div'), drawing), /Only a canvas/);
} finally {
  for (const renderer of renderers) {
    renderer.dispose();
  }
  host.dispose();
  target.dispose();
}
console.log(
  'Native canvas element: drawn in place and clipped, per renderer, stopped and destroyed passed',
);
