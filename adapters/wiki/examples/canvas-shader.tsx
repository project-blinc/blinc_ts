import { tgpu } from 'typegpu';
import { canvasClip, canvasVertex } from 'blinc_ts/shaders/canvas';
import { gpu } from 'blinc_ts/native';
import type { CanvasDrawing, HostElement } from 'blinc_ts/native/host';
import { onCleanup, signal, useHost } from '#jsx/owner';

// A fragment shader in WGSL. `clip` is the SDK's canvasClip, which keeps the drawing inside the
// element's corners, clips and fades; naming the vertex stage brings in the SDK's canvasVertex,
// which places a quad over the element whatever transforms it.
const code = tgpu.resolve({
  template: `
@group(2) @binding(0) var<uniform> params: vec4f; // seconds, width, height, unused

struct Varyings {
  @location(0) uv: vec2f,
  @location(1) pixel: vec2f,
  @location(2) @interpolate(flat) record: u32,
}

@fragment fn aurora(input: Varyings) -> @location(0) vec4f {
  let t = params.x;
  let p = (input.uv - 0.5) * vec2f(params.y / params.z, 1.0) * 3.0;
  var v = sin(p.x * 1.7 + t);
  v += sin((p.y + t * 0.6) * 1.3);
  v += sin((p.x + p.y + t * 0.8) * 1.1);
  v += sin(length(p + vec2f(sin(t * 0.3), cos(t * 0.4))) * 2.2 - t);
  let c = 0.5 + 0.5 * cos(vec3f(0.0, 2.1, 4.2) + v * 0.9 + t * 0.2);
  return vec4f(c, clip(input.record, input.pixel));
}

// The vertex stage: vertexStage
`,
  externals: { clip: canvasClip, vertexStage: canvasVertex },
});
const shader = {
  code,
  vertexEntryPoint: /@vertex\s+fn\s+(\w+)/.exec(code)![1]!,
  fragmentEntryPoint: 'aurora',
  vertexCount: 6,
  alphaBlend: true,
};

export default function CanvasShader() {
  const host = useHost();
  const playing = signal(true);
  const tilted = signal(false);
  let seconds = 0;
  let last = performance.now();
  // What the canvas needs on each renderer that draws it: a uniform for the time and its size,
  // and the pipeline. Its paint writes the uniform, draws, and asks for the next frame.
  const drawing: CanvasDrawing = {
    prepare(renderer, scope) {
      const device = renderer.device;
      const layout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: gpu.ShaderStage.FRAGMENT,
            buffer: { type: gpu.BufferBindingType.Uniform },
          },
        ],
      });
      const params = device.createBuffer({
        size: 16n,
        usage: gpu.BufferUsage.UNIFORM | gpu.BufferUsage.COPY_DST,
      });
      const group = device.createBindGroup({
        layout,
        entries: [{ binding: 0, resource: { kind: 'Buffer', value: params } }],
      });
      const program = renderer.createCanvasPipeline(shader, [layout], scope);
      scope.onCleanup(() => {
        group.destroy();
        params.destroy();
        layout.destroy();
      });
      const values = new Float32Array(4);
      return (frame) => {
        const now = performance.now();
        if (playing.get()) {
          seconds += (now - last) / 1000;
          host.canvases.requestFrame();
        }
        last = now;
        values.set([seconds, frame.width, frame.height, 0]);
        device.queue().writeBuffer(params, 0n, new Uint8Array(values.buffer), 16);
        frame.bind(program);
        frame.encoder.renderSetBindGroup(2, group);
        frame.draw(program);
      };
    },
  };
  let stop: (() => void) | undefined;
  onCleanup(() => stop?.());
  return (
    <div class="wiki-col" style={{ width: '100%' }}>
      <canvas
        ref={(e: HostElement) => {
          stop = host.canvases.draw(e, drawing);
        }}
        style={{
          alignSelf: 'stretch',
          height: 280,
          flexShrink: 0,
          borderRadius: 'var(--radius-3xl)',
          cornerShape: 'squircle',
          boxShadow: 'var(--shadow-lg)',
          transform: () => (tilted.get() ? 'rotate(-5deg) scale(0.86)' : 'none'),
          opacity: () => (tilted.get() ? 0.85 : 1),
          transition: 'transform 500ms var(--ease-spring), opacity 300ms ease',
        }}
      />
      <div class="wiki-row">
        <button
          onClick={() => {
            last = performance.now();
            playing.set(!playing.get());
            host.canvases.requestFrame();
          }}
        >
          {() => (playing.get() ? 'Pause' : 'Play')}
        </button>
        <button onClick={() => tilted.set(!tilted.get())}>
          {() => (tilted.get() ? 'Straighten' : 'Tilt and fade')}
        </button>
        <span class="wiki-hint">The shader is clipped, turned and faded as the element is.</span>
      </div>
    </div>
  );
}
