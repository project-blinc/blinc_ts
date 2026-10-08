import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { layoutBenchShader } from '../dist/renderer/shaders.js';
import { gpu } from '../dist/native/index.js';

/** Bounds -> one upload and draw. Captures are outside the timed frame loop. */
export async function createLayoutFrame(api, width, height, bounds) {
  const renderer = await OffscreenRenderer.create(api, width, height, layoutBenchShader);
  const owned = [];
  const keep = (value) => {
    owned.push(value);
    return value;
  };
  try {
    const buffer = keep(
      renderer.device.createBuffer({
        size: BigInt(bounds.byteLength),
        usage: gpu.BufferUsage.STORAGE | gpu.BufferUsage.COPY_DST,
      }),
    );
    const viewport = keep(
      renderer.device.createBuffer({
        size: 16n,
        usage: gpu.BufferUsage.UNIFORM | gpu.BufferUsage.COPY_DST,
      }),
    );
    const layout = keep(renderer.pipeline.getBindGroupLayout(0));
    const group = keep(
      renderer.device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { kind: 'Buffer', value: viewport } },
          { binding: 1, resource: { kind: 'Buffer', value: buffer } },
        ],
      }),
    );
    const params = new Float32Array([width, height, 0, 0]);
    renderer.queue.writeBuffer(viewport, 0n, new Uint8Array(params.buffer), params.byteLength);
    const bytes = new Uint8Array(bounds.buffer, bounds.byteOffset, bounds.byteLength);
    const instanceCount = bounds.length / 4;
    const vertexCount = 6;
    const upload = () => renderer.queue.writeBuffer(buffer, 0n, bytes, bytes.byteLength);
    return {
      metadata: {
        name: renderer.adapter.name(),
        backend: renderer.adapter.backend(),
        driver: renderer.adapter.driver(),
        width,
        height,
        drawCalls: 1,
        uploadedBytes: bounds.byteLength,
        vertices: vertexCount * instanceCount,
        instances: instanceCount,
        readbackDuringTiming: false,
        presentation: false,
      },
      async render() {
        const start = performance.now();
        upload();
        const encoder = renderer.device.encoder();
        try {
          encoder.passColour(renderer.view, 0.025, 0.035, 0.05, 1);
          encoder.passBegin();
          encoder.renderSetPipeline(renderer.pipeline);
          encoder.renderSetBindGroup(0, group);
          encoder.renderDraw(vertexCount, instanceCount);
          encoder.renderEnd();
          encoder.submit(renderer.queue);
        } finally {
          encoder.destroy();
        }
        const submitted = performance.now();
        await renderer.device.queueWorkDone(renderer.queue);
        const completed = performance.now();
        const error = renderer.device.takeError();
        if (error !== null) {
          throw new Error(error);
        }
        return { gpuSubmitMs: submitted - start, completionWaitMs: completed - submitted };
      },
      async capture() {
        upload();
        const pixels = new Uint8Array(width * height * 4);
        await renderer.captureInto(pixels, vertexCount, [group], instanceCount);
        return pixels;
      },
      dispose() {
        for (const value of owned.reverse()) {
          value.destroy();
        }
        renderer.dispose();
      },
    };
  } catch (error) {
    for (const value of owned.reverse()) {
      value.destroy();
    }
    renderer.dispose();
    throw error;
  }
}
