import { motionShader } from '../../../dist/renderer/shaders.js';
import { gpu } from '../../../dist/native/index.js';
export const shader = motionShader;
export function create(renderer) {
  const buffer = renderer.device.createBuffer({
    size: BigInt(shader.uniformBytes),
    usage: gpu.BufferUsage.UNIFORM | gpu.BufferUsage.COPY_DST,
  });
  const layout = renderer.pipeline.getBindGroupLayout(shader.group);
  const group = renderer.device.createBindGroup({
    layout,
    entries: [{ binding: shader.binding, resource: { kind: 'Buffer', value: buffer } }],
  });
  const params = new Float32Array(4);
  const bytes = new Uint8Array(params.buffer);
  return {
    tracks: [
      {
        id: 'disc-x',
        targetId: 'disc',
        label: 'Moving disc',
        property: 'center-x',
        kind: 'transition',
        from: 0.18 * renderer.width,
        to: 0.82 * renderer.width,
        startMs: 0,
        durationMs: 1000,
        easing: 'cubic-in-out',
      },
    ],
    frame(timeMs) {
      const progress = Math.max(0, Math.min(1, timeMs / 1000));
      const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
      const x = 0.18 + 0.64 * eased;
      params.set([x, 0.5, renderer.width / renderer.height, 0]);
      renderer.queue.writeBuffer(buffer, 0n, bytes, bytes.length);
      return {
        groups: [group],
        debug: {
          progress,
          eased,
          motion: [{ id: 'disc-x', value: params[0] * renderer.width }],
          layers: [
            {
              id: 'disc',
              name: 'Moving disc',
              bounds: {
                x: params[0] - (0.11 * renderer.height) / renderer.width,
                y: 0.39,
                width: (0.22 * renderer.height) / renderer.width,
                height: 0.22,
              },
            },
          ],
        },
      };
    },
    dispose() {
      group.destroy();
      layout.destroy();
      buffer.destroy();
    },
  };
}
