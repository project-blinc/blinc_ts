import { probeShader } from '../renderer/shaders.js';
import { gpu, type NativeBindings, type window } from './index.js';
import { NativeWindowHost } from './window.js';

/** GPU smoke-test content using the same lifecycle as native scene windows. */
export class NativeProbeHost extends NativeWindowHost {
  constructor(bindings: NativeBindings, options: window.WindowAttributes = {}) {
    super(bindings, { title: 'Blinc — TypeGPU', width: 640, height: 420, ...options });
  }
  protected override initializeContent(): void {
    const owned: { destroy(): void }[] = [];
    const keep = <T extends { destroy(): void }>(resource: T): T => {
      owned.push(resource);
      return resource;
    };
    try {
      const shader = keep(this.device.createShader(probeShader.code));
      const builder = keep(this.device.pipeline());
      builder.shader(shader, probeShader.vertexEntryPoint, probeShader.fragmentEntryPoint);
      builder.target(this.format, gpu.ColorWrite.ALL);
      const pipeline = keep(builder.build());
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
