import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { Scope } from '../dist/hmr.js';
import { loadNative, Brush, LayoutOverflow, gpu } from '../dist/native/index.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';
import { canvasProbeShader } from '../dist/renderer/generated/canvasProbe.js';
import { compare } from '../tools/snapshot/image.mjs';

const native = loadNative();
const scene = native.createLayout();
const output = new URL('../.blinc/renderer/', import.meta.url);
await mkdir(output, { recursive: true });
const root = scene.createNode({ width: 640, height: 480 });
root.setPaint({ background: Brush.solid(0x101722) });
const nodes = [];
function item(x, y, width, height, paint, slot) {
  const anchor = scene.createNode({ width: 0, height: 0, shrink: 0 });
  anchor.setVisual([x, y, -1, 0]);
  const node = scene.createNode({ width, height, shrink: 0 });
  node.setPaint(paint);
  if (slot !== undefined) {
    node.setResource(slot, true);
  }
  anchor.setChildren([node]);
  nodes.push(anchor);
  return { anchor, node };
}
const color = [0.2, 0.8, 0.9, 1];
item(20, 20, 160, 110, { textColor: color, radius: [24, 24, 24, 24] }, 0);
item(135, 65, 70, 66, { background: Brush.solid(0xff724c), radius: [12, 12, 12, 12] });
item(
  240,
  35,
  150,
  110,
  {
    textColor: [1, 0.65, 0.22, 1],
    radius: [28, 28, 28, 28],
    transform: [0.9659258, 0.258819, -0.258819, 0.9659258, 0, 0],
  },
  1,
);
const clip = item(445, 24, 155, 130, {
  background: Brush.solid(0x243244),
  radius: [24, 24, 24, 24],
});
clip.node.setStyle({ overflow: LayoutOverflow.Hidden });
const clipped = scene.createNode({ width: 210, height: 104, shrink: 0 });
clipped.setVisual([-24, 18, -1, 0]);
clipped.setPaint({ textColor: [0.7, 0.35, 0.9, 1], radius: [20, 20, 20, 20] });
clipped.setResource(2, true);
clip.node.setChildren([clipped]);
const group = item(24, 208, 276, 190, {
  background: Brush.solid(0x2b4258),
  opacity: 0.65,
  filter: { blur: 0.5, brightness: 1.15 },
});
const inner = scene.createNode({ width: 232, height: 128, shrink: 0 });
inner.setVisual([20, 22, -1, 0]);
inner.setPaint({
  textColor: [0.35, 0.9, 0.55, 1],
  opacity: 0.6,
  radius: [32, 32, 32, 32],
  maskImage: Brush.linear(0, 0, 1, 0, true).stop(0, 0xffffff, 0.1).stop(1, 0xffffff, 1),
});
inner.setResource(3, true);
group.node.setChildren([inner]);
item(
  342,
  226,
  232,
  145,
  { textColor: [0.35, 0.65, 1, 1], radius: [26, 26, 26, 26], opacity: 0.7 },
  4,
);
item(720, 50, 90, 90, {}, 5);
item(530, 410, 50, 50, { transform: [0, 0, 0, 1, 0, 0] }, 6);
root.setChildren(nodes);
scene.compute(root, 640, 480);
const references = [];
try {
  for (const scale of [1, 2]) {
    const target = await OffscreenRenderer.create(native, 640 * scale, 480 * scale, probeShader);
    const renderer = new SceneRenderer(target.device, scene);
    const owned = [];
    const keep = (value) => {
      owned.push(value);
      return value;
    };
    const scope = new Scope();
    try {
      const extra = keep(
        target.device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: gpu.ShaderStage.FRAGMENT,
              buffer: { type: gpu.BufferBindingType.Uniform },
            },
          ],
        }),
      );
      const tint = keep(
        target.device.createBuffer({
          size: 16n,
          usage: gpu.BufferUsage.UNIFORM | gpu.BufferUsage.COPY_DST,
        }),
      );
      target.queue.writeBuffer(tint, 0n, new Uint8Array(new Float32Array([1, 1, 1, 1]).buffer), 16);
      const bindings = keep(
        target.device.createBindGroup({
          layout: extra,
          entries: [{ binding: 0, resource: { kind: 'Buffer', value: tint } }],
        }),
      );
      const program = renderer.createCanvasPipeline(canvasProbeShader, [extra], scope);
      const aux = keep(
        target.device.texture({
          size: { width: 32, height: 32 },
          format: gpu.TextureFormat.Rgba8unorm,
          usage: gpu.TextureUsage.RENDER_ATTACHMENT,
        }),
      );
      const auxView = keep(aux.createView({}));
      let saved, visits, stats;
      const draw = (frame) => {
        saved = frame;
        visits++;
        assert.equal(frame.pixelRatio, scale);
        assert.equal(frame.format, gpu.TextureFormat.Rgba8unorm);
        assert(frame.scissor[2] > 0 && frame.scissor[3] > 0);
        frame.bind(program);
        frame.encoder.renderSetBindGroup(2, bindings);
        frame.draw(program);
      };
      const restoreState = (frame) => {
        assert.equal(frame.width, 160);
        assert.equal(frame.height, 110);
        assert.deepEqual([...frame.transform], [1, 0, 0, 1, 20, 20]);
        assert.equal(frame.scale, scale);
        draw(frame);
        frame.encoder.renderSetScissorRect(0, 0, 1, 1);
        frame.encoder.renderSetViewport(0, 0, 1, 1, 0, 1);
        frame.encoder.renderSetBlendConstant(1, 1, 1, 1);
      };
      renderer.registerCanvas(0, restoreState, scope);
      for (const slot of [1, 2, 3]) {
        renderer.registerCanvas(slot, draw, scope);
      }
      renderer.registerCanvas(
        4,
        (frame) => {
          const scissor = [...frame.scissor];
          frame.suspend((encoder) => {
            assert.throws(() => frame.draw(program), /only valid/);
            encoder.beginRenderPass({
              colorAttachments: [
                {
                  view: { kind: 'TextureView', value: auxView },
                  loadOp: gpu.LoadOp.Clear,
                  storeOp: gpu.StoreOp.Store,
                  clearValue: { r: 0.2, g: 0.4, b: 0.7, a: 1 },
                },
              ],
            });
            encoder.renderSetPipeline(target.pipeline);
            encoder.renderDraw(3, 1);
            encoder.renderEnd();
            return 1;
          });
          assert.deepEqual([...frame.scissor], scissor);
          draw(frame);
        },
        scope,
      );
      for (const slot of [5, 6]) {
        renderer.registerCanvas(
          slot,
          () => {
            throw new Error('Invisible canvas must be skipped');
          },
          scope,
        );
      }
      const capture = async (name) => {
        visits = 0;
        const pixels = new Uint8Array(target.width * target.height * 4);
        await target.captureCommandsInto(pixels, (encoder, view) => {
          stats = renderer.encode(encoder, root, view, {
            width: target.width,
            height: target.height,
            scale,
            cornerShape: 1.3334237337112427,
          });
          return stats.drawCalls;
        });
        if (name) {
          await writeFile(
            new URL(`${name}.png`, output),
            PNG.sync.write({
              width: target.width,
              height: target.height,
              data: Buffer.from(pixels),
            }),
          );
        }
        return pixels;
      };
      const first = await capture(`canvas-${scale}x`);
      assert.equal(visits, 5);
      assert.equal(stats.canvasCalls, 5);
      const firstDraws = stats.drawCalls;
      assert.throws(() => saved.draw(program), /only valid/);
      assert.throws(() => saved.suspend(() => {}), /only valid/);
      const sample = (x, y) => [
        ...first.slice(
          (y * scale * target.width + x * scale) * 4,
          (y * scale * target.width + x * scale) * 4 + 4,
        ),
      ];
      assert.deepEqual(sample(20, 20), [16, 23, 34, 255], 'Rounded canvas excludes its corner');
      assert.deepEqual(
        sample(160, 90),
        [255, 114, 76, 255],
        'Later UI restores viewport/scissor and paints on top',
      );
      assert.deepEqual(
        sample(610, 80),
        [16, 23, 34, 255],
        'Ancestor clip excludes canvas overflow',
      );
      assert.deepEqual(await capture(), first);
      const info = scene.prepareDisplayList(root, { scale, cornerShape: 1.3334237337112427 });
      const records = new Float32Array(info.floats);
      scene.readDisplayList(records);
      await writeFile(
        new URL(`records-canvas-${scale}x.json`, output),
        JSON.stringify({ width: 640, height: 480, count: info.count, records: [...records] }),
      );

      // Raw callbacks receive rectangular scissoring even without the shader helpers.
      renderer.registerCanvas(0, (frame) => {
        frame.encoder.renderSetPipeline(target.pipeline);
        frame.encoder.renderDraw(3, 1);
        return 1;
      });
      const raw = await capture(`canvas-raw-${scale}x`);
      assert.notDeepEqual(raw, first);
      const at = (15 * scale * target.width + 60 * scale) * 4;
      assert.deepEqual(raw.slice(at, at + 4), first.slice(at, at + 4));
      renderer.registerCanvas(0, restoreState);
      assert.deepEqual(await capture(), first);

      // Old roots must not remove a replacement registration during HMR cleanup.
      const oldScope = new Scope();
      renderer.registerCanvas(0, restoreState, oldScope);
      renderer.registerCanvas(0, restoreState, scope);
      oldScope.dispose();
      assert.deepEqual(await capture(), first);
      for (const callback of [
        () => {
          throw new Error('paint failed');
        },
        (frame) =>
          frame.suspend(() => {
            throw new Error('auxiliary failed');
          }),
        () => Promise.resolve(),
        () => renderer.dispose(),
        () => renderer.createCanvasPipeline(canvasProbeShader, [extra]),
      ]) {
        const remove = renderer.registerCanvas(0, callback);
        await assert.rejects(
          capture(),
          /paint failed|auxiliary failed|synchronous|during encoding/,
        );
        remove();
        renderer.registerCanvas(0, restoreState);
        assert.deepEqual(await capture(), first, 'Failed callback does not poison the next frame');
      }
      const other = new SceneRenderer(target.device, scene);
      try {
        const foreign = other.createCanvasPipeline(canvasProbeShader, [extra]);
        renderer.registerCanvas(0, (frame) => frame.draw(foreign));
        await assert.rejects(capture(), /another renderer/);
      } finally {
        other.dispose();
      }
      renderer.registerCanvas(0, restoreState);
      const dead = renderer.createCanvasPipeline(canvasProbeShader, [extra]);
      dead.dispose();
      dead.dispose();
      renderer.registerCanvas(0, (frame) => frame.draw(dead));
      await assert.rejects(capture(), /pipeline disposed/);
      renderer.registerCanvas(0, restoreState);
      assert.deepEqual(await capture(), first);
      renderer.registerCanvas(0, () => {});
      scope.dispose();
      await capture();
      assert.equal(stats.canvasCalls, 1, 'Only the later unscoped registration remains');
      renderer.registerCanvas(0, () => {})();
      await capture();
      assert.equal(stats.canvasCalls, 0, 'Unregistered canvas slots are skipped');
      assert.equal(
        firstDraws - stats.drawCalls,
        6,
        'Counts all five helper draws and the auxiliary raw draw',
      );
    } finally {
      scope.dispose();
      renderer.dispose();
      for (const resource of owned.reverse()) {
        resource.destroy();
      }
      target.dispose();
    }
  }
  for (const scale of [1, 2]) {
    const current = PNG.sync.read(await readFile(new URL(`canvas-${scale}x.png`, output)));
    const reference = PNG.sync.read(
      await readFile(new URL(`fixtures/renderer/canvas-${scale}x.png`, import.meta.url)),
    );
    const result = compare(current, reference);
    await writeFile(
      new URL(`canvas-${scale}x-diff.png`, output),
      PNG.sync.write({
        width: current.width,
        height: current.height,
        data: Buffer.from(result.diff),
      }),
    );
    assert.equal(
      result.changedPixels,
      0,
      `Canvas reference ${scale}x: maximum delta ${result.maximumDelta}`,
    );
    references.push({
      scale,
      maximumDelta: result.maximumDelta,
      changedPixels: result.changedPixels,
    });
  }
  console.log(
    JSON.stringify({
      test: 'Native canvas callbacks, state, clipping and lifecycle',
      references,
      output: output.pathname,
    }),
  );
} finally {
  scene.dispose();
}
