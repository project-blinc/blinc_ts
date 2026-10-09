import { probeShader } from '../renderer/shaders.js';
import { gpu, type NativeBindings } from './index.js';
import { NativeWindowHost, type NativeWindowOptions } from './window.js';

/** GPU smoke-test content using the same lifecycle as native scene windows. */
export class NativeProbeHost extends NativeWindowHost {
  constructor(bindings: NativeBindings, options: NativeWindowOptions = {}) {
    super(bindings, { title: 'Blinc — TypeGPU', width: 640, height: 420, ...options });
  }
  protected override initializeContent(): void {
    const owned: { destroy(): void }[] = [];
    const keep = <T extends { destroy(): void }>(resource: T): T => {
      owned.push(resource);
      return resource;
    };
    try {
      const shader = this.device.createShader(probeShader.code);
      let builder: gpu.GpuPipelineBuilder | undefined;
      let pipeline: gpu.GpuPipeline;
      try {
        builder = this.device.pipeline();
        builder.shader(shader, probeShader.vertexEntryPoint, probeShader.fragmentEntryPoint);
        builder.target(this.format, gpu.ColorWrite.ALL);
        pipeline = keep(builder.build());
      } finally {
        builder?.destroy();
        shader.destroy();
      }
      this.setPainter(
        (encoder, view) => {
          encoder.passColour(view, 0, 0, 0, 1);
          encoder.passBegin();
          encoder.renderSetPipeline(pipeline);
          encoder.renderDraw(probeShader.vertexCount, 1);
          encoder.renderEnd();
        },
        () => {
          for (const resource of owned.reverse()) {
            resource.destroy();
          }
        },
      );
    } catch (error) {
      for (const resource of owned.reverse()) {
        resource.destroy();
      }
      this.dispose();
      throw error;
    }
  }
}
