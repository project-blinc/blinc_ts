import {
  CanvasFrame,
  CanvasPipeline,
  canvasDrawCount,
  type CanvasPaint,
  type CanvasState,
} from './canvas.js';
import type { Scope } from '../hmr.js';
export { CanvasFrame, CanvasPipeline, type CanvasPaint } from './canvas.js';
import { fields } from '../renderer/records.js';
import {
  gpu,
  type Layout,
  type LayoutNode,
  type PaintOptions,
  type ImageResource,
  ImageFit,
} from './index.js';
import { sceneSchema } from './scene.js';
import type { Shader } from './offscreen.js';
import { TextureAtlas, type AtlasRect } from './texture-atlas.js';
import { boxShader } from '../renderer/generated/box.js';
import { shadowShader } from '../renderer/generated/shadow.js';
import { textShader } from '../renderer/generated/text.js';
import { imageShader } from '../renderer/generated/image.js';
import { backdropShader } from '../renderer/generated/backdrop.js';
import { backdropRowsShader } from '../renderer/generated/backdropRows.js';
import { layerShader } from '../renderer/generated/layer.js';
import { layerRowsShader } from '../renderer/generated/layerRows.js';
import { layerShadowShader } from '../renderer/generated/layerShadow.js';
import { blitShader } from '../renderer/generated/blit.js';

export interface RenderOptions extends PaintOptions {
  /** Target size in device pixels. The layout viewport is width/scale by height/scale. */
  width: number;
  height: number;
  clear?: readonly [number, number, number, number];
}
export interface SceneRenderStats {
  primitives: number;
  drawCalls: number;
  recordBytes: number;
  atlasBytes: number;
  canvasCalls: number;
}
interface Texture {
  texture: gpu.GpuTexture;
  view: gpu.GpuTextureView;
  width: number;
  height: number;
}
interface GlyphTexture extends Texture {
  revision: number;
  bytes: Uint8Array;
}
const R = sceneSchema.recordFloats;
const KIND = fields.typeInfo * 4;
const GRADIENT = fields.gradient * 4;

/** Native display-list renderer. Owns GPU caches; the host owns the device and layout. */
export class SceneRenderer {
  readonly #device: gpu.GpuDevice;
  readonly #layout: Layout;
  readonly #queue: gpu.GpuQueue;
  readonly #owned: { destroy(): void }[] = [];
  readonly #pipelines = new Map<number, gpu.GpuPipeline>();
  readonly #frameLayout: gpu.GpuBindGroupLayout;
  readonly #textureLayout: gpu.GpuBindGroupLayout;
  readonly #viewport: gpu.GpuBuffer;
  readonly #viewportData = new Float32Array(4);
  readonly #sampler: gpu.GpuSampler;
  readonly #images: TextureAtlas;
  readonly #imageSlots = new Map<number, AtlasRect>();
  readonly #imageCache = new WeakMap<ImageResource, Map<string, AtlasRect>>();
  readonly #textureGroups = new Map<
    gpu.GpuTextureView,
    Map<gpu.GpuTextureView, gpu.GpuBindGroup>
  >();
  readonly #layers: Texture[] = [];
  readonly #dummy: Texture;
  readonly #glyphs: [GlyphTexture, GlyphTexture];
  #records = new Float32Array(0);
  #buffer: gpu.GpuBuffer | undefined;
  #frameGroup: gpu.GpuBindGroup | undefined;
  #frame: Texture | undefined;
  #rows: Texture | undefined;
  #shadow: Texture | undefined;
  #disposed = false;
  #encoding = false;
  readonly #canvases = new Map<number, CanvasPaint>();
  readonly #canvasPipelines = new Set<CanvasPipeline>();
  readonly #canvasState: CanvasState = {
    encoder: undefined,
    target: undefined,
    record: 0,
    width: 0,
    height: 0,
    transform: [1, 0, 0, 1, 0, 0],
    scale: 1,
    pixelRatio: 1,
    scissor: [0, 0, 0, 0],
    drawCalls: 0,
  };
  readonly #canvasFrame: CanvasFrame;

  constructor(device: gpu.GpuDevice, layout: Layout, format = gpu.TextureFormat.Rgba8unorm) {
    this.#device = device;
    this.#canvasFrame = new CanvasFrame({
      device,
      state: this.#canvasState,
      bind: (pipeline) => {
        const encoder = this.#canvasState.encoder!;
        encoder.renderSetPipeline(pipeline.resolve(this));
        this.#bindGroups(encoder, this.#dummy.view, this.#dummy.view);
      },
      resume: () => {
        const state = this.#canvasState;
        this.#begin(state.encoder!, state.target!);
        state.encoder!.renderSetScissorRect(...state.scissor);
      },
    });
    this.#layout = layout;
    this.#queue = device.queue();
    const keep = <T extends { destroy(): void }>(value: T): T => {
      this.#owned.push(value);
      return value;
    };
    this.#frameLayout = keep(
      device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: gpu.ShaderStage.VERTEX | gpu.ShaderStage.FRAGMENT,
            buffer: { type: gpu.BufferBindingType.Uniform },
          },
          {
            binding: 1,
            visibility: gpu.ShaderStage.VERTEX | gpu.ShaderStage.FRAGMENT,
            buffer: { type: gpu.BufferBindingType.ReadOnlyStorage },
          },
        ],
      }),
    );
    this.#textureLayout = keep(
      device.createBindGroupLayout({
        entries: [
          ...[0, 1, 2, 3, 5].map((binding) => ({
            binding,
            visibility: gpu.ShaderStage.FRAGMENT,
            texture: {
              sampleType: gpu.TextureSampleType.Float,
              viewDimension: gpu.TextureViewDimension.D2d,
            },
          })),
          {
            binding: 4,
            visibility: gpu.ShaderStage.FRAGMENT,
            sampler: { type: gpu.SamplerBindingType.Filtering },
          },
        ],
      }),
    );
    const pipelineLayout = keep(
      device.createPipelineLayout({ bindGroupLayouts: [this.#frameLayout, this.#textureLayout] }),
    );
    this.#viewport = keep(
      device.createBuffer({ size: 16n, usage: gpu.BufferUsage.UNIFORM | gpu.BufferUsage.COPY_DST }),
    );
    this.#sampler = keep(
      device.sampler({ minFilter: gpu.FilterMode.Linear, magFilter: gpu.FilterMode.Linear }),
    );
    this.#dummy = this.#texture(1, 1, gpu.TextureFormat.Rgba8unorm);
    this.#glyphs = [
      { ...this.#texture(1, 1, gpu.TextureFormat.R8unorm), revision: 0, bytes: new Uint8Array(0) },
      {
        ...this.#texture(1, 1, gpu.TextureFormat.Rgba8unorm),
        revision: 0,
        bytes: new Uint8Array(0),
      },
    ];
    this.#images = new TextureAtlas(device);
    try {
      for (const [kind, shader] of new Map<number, Shader>([
        [0, boxShader],
        [3, shadowShader],
        [7, textShader],
        [32, imageShader],
        [42, backdropShader],
        [41, layerShader],
        [-3, layerRowsShader],
        [-4, layerShadowShader],
        [-1, backdropRowsShader],
        [-2, blitShader],
      ])) {
        const module = keep(device.createShader(shader.code));
        const builder = keep(device.pipeline());
        builder.shader(module, shader.vertexEntryPoint, shader.fragmentEntryPoint);
        builder.layout(pipelineLayout);
        builder.target(kind === -2 ? format : gpu.TextureFormat.Rgba8unorm, gpu.ColorWrite.ALL);
        if (shader.alphaBlend) {
          builder.blend(
            gpu.BlendFactor.SrcAlpha,
            gpu.BlendFactor.OneMinusSrcAlpha,
            gpu.BlendOperation.Add,
            gpu.BlendFactor.One,
            gpu.BlendFactor.OneMinusSrcAlpha,
            gpu.BlendOperation.Add,
          );
        }
        this.#pipelines.set(kind, keep(builder.build()));
      }
      this.#check();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  /** Register a canvas slot. Cleanup removes only this registration, including after replacement. */
  registerCanvas(slot: number, paint: CanvasPaint, scope?: Scope): () => void {
    this.#assertLive();
    this.#assertIdle();
    if (!Number.isSafeInteger(slot) || slot < 0 || slot > 0xffffff) {
      throw new RangeError('Invalid canvas slot');
    }
    // A unique wrapper makes stale cleanup safe even when the callback itself is reused.
    const callback: CanvasPaint = (frame) => paint(frame);
    this.#canvases.set(slot, callback);
    const remove = () => {
      this.#assertIdle();
      if (this.#canvases.get(slot) === callback) {
        this.#canvases.delete(slot);
      }
    };
    scope?.onCleanup(remove);
    return remove;
  }

  /** Prepare outside paint; the pipeline is reused across frames and released with its scope/renderer. */
  createCanvasPipeline(
    shader: Shader,
    extraLayouts: readonly gpu.GpuBindGroupLayout[] = [],
    scope?: Scope,
  ): CanvasPipeline {
    this.#assertLive();
    this.#assertIdle();
    if (
      !Number.isSafeInteger(shader.vertexCount) ||
      shader.vertexCount < 0 ||
      shader.vertexCount > 0xffffffff
    ) {
      throw new RangeError('Invalid canvas vertex count');
    }
    const resources: { destroy(): void }[] = [];
    const keep = <T extends { destroy(): void }>(resource: T): T => {
      resources.push(resource);
      return resource;
    };
    let result: CanvasPipeline;
    try {
      const layout = keep(
        this.#device.createPipelineLayout({
          bindGroupLayouts: [this.#frameLayout, this.#textureLayout, ...extraLayouts],
        }),
      );
      const module = keep(this.#device.createShader(shader.code));
      const builder = keep(this.#device.pipeline());
      builder.shader(module, shader.vertexEntryPoint, shader.fragmentEntryPoint);
      builder.layout(layout);
      builder.target(gpu.TextureFormat.Rgba8unorm, gpu.ColorWrite.ALL);
      builder.blend(
        gpu.BlendFactor.SrcAlpha,
        gpu.BlendFactor.OneMinusSrcAlpha,
        gpu.BlendOperation.Add,
        gpu.BlendFactor.One,
        gpu.BlendFactor.OneMinusSrcAlpha,
        gpu.BlendOperation.Add,
      );
      const pipeline = keep(builder.build());
      this.#check();
      result = new CanvasPipeline(this, pipeline, shader.vertexCount, resources, () => {
        this.#assertIdle();
        this.#canvasPipelines.delete(result);
      });
    } catch (error) {
      for (const resource of resources.reverse()) {
        resource.destroy();
      }
      throw error;
    }
    this.#canvasPipelines.add(result);
    scope?.onCleanup(() => result.dispose());
    return result;
  }

  /** Pack a rasterized image into the shared atlas and associate its renderer slot. */
  setImage(
    slot: number,
    image: ImageResource,
    width = image.width,
    height = image.height,
    fit = ImageFit.Fill,
  ): void {
    this.#assertLive();
    this.#assertIdle();
    if (!Number.isSafeInteger(slot) || slot < 0 || slot > 0xffffff) {
      throw new RangeError('Invalid image slot');
    }
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1 ||
      width >= 4096 ||
      height >= 4096
    ) {
      throw new RangeError('Invalid image dimensions');
    }
    const key = `${width}:${height}:${fit}`;
    let entries = this.#imageCache.get(image);
    let rect = entries?.get(key);
    if (!rect) {
      const pixels = new Uint8Array(width * height * 4);
      image.resample(width, height, fit, pixels);
      const revision = this.#images.revision;
      rect = this.#images.add(width, height, pixels);
      if (!entries) {
        entries = new Map();
        this.#imageCache.set(image, entries);
      }
      entries.set(key, rect);
      if (revision !== this.#images.revision) {
        this.#clearGroups();
      }
    }
    this.#imageSlots.set(slot, rect);
    this.#check();
  }

  /** Append a complete frame to the host's encoder; submit it before encoding another frame. */
  encode(
    encoder: gpu.GpuEncoder,
    root: LayoutNode,
    target: gpu.GpuTextureView,
    options: RenderOptions,
  ): SceneRenderStats {
    this.#assertLive();
    this.#assertIdle();
    this.#encoding = true;
    try {
      return this.#encode(encoder, root, target, options);
    } finally {
      this.#encoding = false;
    }
  }

  #encode(
    encoder: gpu.GpuEncoder,
    root: LayoutNode,
    target: gpu.GpuTextureView,
    options: RenderOptions,
  ): SceneRenderStats {
    const { width, height } = options;
    const scale = options.scale ?? 1;
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 8192 ||
      height > 8192 ||
      !Number.isFinite(scale) ||
      scale <= 0
    ) {
      throw new RangeError('Invalid render dimensions');
    }
    const info = this.#layout.prepareDisplayList(root, options);
    this.#reserve(info.floats);
    this.#layout.readDisplayList(this.#records);
    let depth = 0;
    let maxDepth = 0;
    let needsRows = false;
    let needsShadow = false;
    for (let i = 0; i < info.count; i++) {
      const at = i * R;
      const kind = this.#records[at + KIND]!;
      if (
        kind !== 0 &&
        kind !== 3 &&
        kind !== 7 &&
        kind !== 32 &&
        kind !== 33 &&
        kind !== 40 &&
        kind !== 41 &&
        kind !== 42
      ) {
        throw new Error(`Unsupported display-list primitive ${kind}`);
      }
      if (kind === 40) {
        maxDepth = Math.max(maxDepth, ++depth);
      } else if (kind === 41) {
        if (--depth < 0) {
          throw new Error('Unbalanced display-list layers');
        }
        needsRows ||= this.#records[at + fields.color * 4]! > 0;
        needsShadow ||= this.#records[at + fields.via * 4 + 3]! > 0;
      } else if (kind === 42) {
        needsRows = true;
      }
      if (kind === 32) {
        const slot = this.#records[at + GRADIENT]!;
        const rect = this.#imageSlots.get(slot);
        if (!rect) {
          throw new Error(`Image slot ${slot} has not been uploaded`);
        }
        // Uploaded ImageResource pixels are straight RGBA, rather than a tint mask.
        this.#records[at + KIND + 1] = 1;
        this.#records[at + GRADIENT] = rect.x;
        this.#records[at + GRADIENT + 1] = rect.y;
        this.#records[at + GRADIENT + 2] = rect.x + rect.width;
        this.#records[at + GRADIENT + 3] = rect.y + rect.height;
      }
    }
    if (depth !== 0) {
      throw new Error('Unbalanced display-list layers');
    }
    const atlasBytes = this.#syncGlyphs();
    if (this.#frame?.width !== width || this.#frame.height !== height) {
      this.#clearGroups();
      this.#drop(this.#frame);
      this.#drop(this.#rows);
      this.#drop(this.#shadow);
      for (const layer of this.#layers) {
        this.#drop(layer);
      }
      this.#layers.length = 0;
      this.#rows = undefined;
      this.#shadow = undefined;
      this.#frame = this.#texture(width, height, gpu.TextureFormat.Rgba8unorm, true);
    }
    // Scratch passes are consumed immediately, so rows/shadow can be shared at every depth.
    // Only simultaneously active groups need distinct content textures.
    if (needsRows && !this.#rows) {
      this.#rows = this.#texture(width, height, gpu.TextureFormat.Rgba8unorm, true);
    }
    if (needsShadow && !this.#shadow) {
      this.#shadow = this.#texture(width, height, gpu.TextureFormat.Rgba8unorm, true);
    }
    while (this.#layers.length < maxDepth) {
      this.#layers.push(this.#texture(width, height, gpu.TextureFormat.Rgba8unorm, true));
    }
    const frame = this.#frame;
    let current = frame;
    this.#viewportData.set([width / scale, height / scale, 0, 0]);
    this.#queue.writeBuffer(this.#viewport, 0n, new Uint8Array(this.#viewportData.buffer), 16);
    if (info.floats) {
      this.#queue.writeBuffer(
        this.#buffer!,
        0n,
        new Uint8Array(this.#records.buffer, 0, info.floats * 4),
        info.floats * 4,
      );
    }
    const clear = options.clear ?? [0, 0, 0, 0];
    this.#begin(encoder, frame.view, clear);
    let drawCalls = 0;
    let canvasCalls = 0;
    this.#canvasState.drawCalls = 0;
    for (let i = 0; i < info.count;) {
      const kind = this.#records[i * R + KIND]!;
      if (kind === 40) {
        encoder.renderEnd();
        current = this.#layers[depth++]!;
        this.#begin(encoder, current.view, [0, 0, 0, 0]);
        i++;
      } else if (kind === 41) {
        encoder.renderEnd();
        const inner = current;
        const blurred = this.#records[i * R + fields.color * 4]! > 0;
        const shadowed = this.#records[i * R + fields.via * 4 + 3]! > 0;
        if (shadowed) {
          this.#begin(encoder, this.#shadow!.view, [0, 0, 0, 0]);
          this.#draw(encoder, -4, i, 1, inner.view);
          encoder.renderEnd();
          drawCalls++;
        }
        if (blurred) {
          this.#begin(encoder, this.#rows!.view, [0, 0, 0, 0]);
          this.#draw(encoder, -3, i, 1, inner.view);
          encoder.renderEnd();
          drawCalls++;
        }
        depth--;
        current = depth === 0 ? frame : this.#layers[depth - 1]!;
        this.#begin(encoder, current.view);
        this.#draw(
          encoder,
          41,
          i,
          1,
          blurred ? this.#rows!.view : inner.view,
          shadowed ? this.#shadow!.view : this.#dummy.view,
        );
        drawCalls++;
        i++;
      } else if (kind === 42) {
        encoder.renderEnd();
        this.#begin(encoder, this.#rows!.view, [0, 0, 0, 0]);
        this.#draw(encoder, -1, i, 1, current.view);
        encoder.renderEnd();
        this.#begin(encoder, current.view);
        this.#draw(encoder, 42, i, 1, this.#rows!.view);
        drawCalls += 2;
        i++;
      } else if (kind === 33) {
        canvasCalls += this.#paintCanvas(encoder, i, width, height, scale, current.view);
        i++;
      } else {
        let end = i + 1;
        while (end < info.count && this.#records[end * R + KIND] === kind) {
          end++;
        }
        this.#draw(encoder, kind, i, end - i, this.#dummy.view);
        drawCalls++;
        i = end;
      }
    }
    encoder.renderEnd();
    this.#begin(encoder, target, [0, 0, 0, 0]);
    this.#draw(encoder, -2, 0, 1, frame.view);
    encoder.renderEnd();
    this.#check();
    return {
      primitives: info.count,
      drawCalls: drawCalls + this.#canvasState.drawCalls + 1,
      canvasCalls,
      recordBytes: info.floats * 4,
      atlasBytes,
    };
  }

  #paintCanvas(
    encoder: gpu.GpuEncoder,
    record: number,
    width: number,
    height: number,
    ratio: number,
    target: gpu.GpuTextureView,
  ): number {
    const at = record * R;
    const paint = this.#canvases.get(this.#records[at + GRADIENT]!);
    if (!paint) {
      return 0;
    }
    const data = this.#records;
    const w = data[at + 2]!,
      h = data[at + 3]!;
    const a = data[at + fields.affine * 4]!,
      b = data[at + fields.affine * 4 + 1]!;
    const c = data[at + fields.affine * 4 + 2]!,
      d = data[at + fields.affine * 4 + 3]!;
    const tx = data[at]!,
      ty = data[at + 1]!;
    const det = a * d - b * c;
    if (w <= 0 || h <= 0 || Math.abs(det) < 1e-12) {
      return 0;
    }
    let x0 = tx + Math.min(0, a * w) + Math.min(0, c * h);
    let y0 = ty + Math.min(0, b * w) + Math.min(0, d * h);
    let x1 = tx + Math.max(0, a * w) + Math.max(0, c * h);
    let y1 = ty + Math.max(0, b * w) + Math.max(0, d * h);
    const clips = data[at + KIND + 2]!;
    if ((clips & 1) !== 0) {
      const clip = at + fields.clipBounds * 4;
      x0 = Math.max(x0, data[clip]!);
      y0 = Math.max(y0, data[clip + 1]!);
      x1 = Math.min(x1, data[clip]! + data[clip + 2]!);
      y1 = Math.min(y1, data[clip + 1]! + data[clip + 3]!);
    }
    if ((clips & 2) !== 0) {
      const clip = at + fields.shadow * 4;
      const cx = data[clip]!,
        cy = data[clip + 1]!,
        cw = data[clip + 2]!,
        ch = data[clip + 3]!;
      const px = tx + a * cx + c * cy,
        py = ty + b * cx + d * cy;
      x0 = Math.max(x0, px + Math.min(0, a * cw) + Math.min(0, c * ch));
      y0 = Math.max(y0, py + Math.min(0, b * cw) + Math.min(0, d * ch));
      x1 = Math.min(x1, px + Math.max(0, a * cw) + Math.max(0, c * ch));
      y1 = Math.min(y1, py + Math.max(0, b * cw) + Math.max(0, d * ch));
    }
    x0 = Math.max(0, Math.floor(x0 * ratio));
    y0 = Math.max(0, Math.floor(y0 * ratio));
    x1 = Math.min(width, Math.ceil(x1 * ratio));
    y1 = Math.min(height, Math.ceil(y1 * ratio));
    if (x1 <= x0 || y1 <= y0) {
      return 0;
    }
    const state = this.#canvasState;
    state.encoder = encoder;
    state.target = target;
    state.record = record;
    state.width = w;
    state.height = h;
    state.pixelRatio = ratio;
    state.scale = Math.sqrt(Math.abs(det)) * ratio;
    state.transform[0] = a;
    state.transform[1] = b;
    state.transform[2] = c;
    state.transform[3] = d;
    state.transform[4] = tx;
    state.transform[5] = ty;
    state.scissor[0] = x0;
    state.scissor[1] = y0;
    state.scissor[2] = x1 - x0;
    state.scissor[3] = y1 - y0;
    encoder.renderSetScissorRect(x0, y0, x1 - x0, y1 - y0);
    this.#canvasFrame.activate();
    try {
      const rawDraws = canvasDrawCount(paint(this.#canvasFrame));
      state.drawCalls += rawDraws;
    } catch (error) {
      encoder.renderEnd();
      throw error;
    } finally {
      this.#canvasFrame.deactivate();
      state.encoder = undefined;
      state.target = undefined;
    }
    // Custom callbacks may alter dynamic state; ordinary runs bind their own pipeline/groups.
    encoder.renderSetViewport(0, 0, width, height, 0, 1);
    encoder.renderSetScissorRect(0, 0, width, height);
    encoder.renderSetBlendConstant(0, 0, 0, 0);
    encoder.renderSetStencilReference(0);
    return 1;
  }

  #reserve(floats: number): void {
    if (this.#records.length >= floats && this.#buffer) {
      return;
    }
    let capacity = Math.max(this.#records.length, 1024);
    while (capacity < floats) {
      capacity *= 2;
    }
    this.#records = new Float32Array(capacity);
    this.#frameGroup?.destroy();
    this.#buffer?.destroy();
    this.#buffer = this.#device.createBuffer({
      size: BigInt(capacity * 4),
      usage: gpu.BufferUsage.STORAGE | gpu.BufferUsage.COPY_DST,
    });
    this.#frameGroup = this.#device.createBindGroup({
      layout: this.#frameLayout,
      entries: [
        { binding: 0, resource: { kind: 'Buffer', value: this.#viewport } },
        { binding: 1, resource: { kind: 'Buffer', value: this.#buffer } },
      ],
    });
  }
  #syncGlyphs(): number {
    let bytes = 0;
    for (const index of [0, 1] as const) {
      let atlas = this.#glyphs[index];
      const color = index === 1;
      const info = this.#layout.atlasInfo(color, atlas.revision);
      if (!info) {
        continue;
      }
      if (atlas.width !== info.width || atlas.height !== info.height) {
        this.#clearGroups();
        this.#drop(atlas);
        atlas = {
          ...this.#texture(
            info.width,
            info.height,
            color ? gpu.TextureFormat.Rgba8unorm : gpu.TextureFormat.R8unorm,
          ),
          revision: 0,
          bytes: atlas.bytes,
        };
        this.#glyphs[index] = atlas;
      }
      // A recreated texture needs the complete atlas, not just the most recent dirty rectangle.
      const update = this.#layout.atlasInfo(color, atlas.revision)!;
      if (atlas.bytes.length < update.bytes) {
        atlas.bytes = new Uint8Array(update.bytes);
      }
      this.#layout.readAtlas(color, atlas.revision, atlas.bytes);
      this.#queue.writeTextureWith(
        { texture: atlas.texture, origin: { x: update.x, y: update.y, z: 0 } },
        atlas.bytes.subarray(0, update.bytes),
        { bytesPerRow: update.updateWidth * (color ? 4 : 1), rowsPerImage: update.updateHeight },
        { width: update.updateWidth, height: update.updateHeight, depthOrArrayLayers: 1 },
      );
      this.#check();
      atlas.revision = update.revision;
      bytes += update.bytes;
    }
    return bytes;
  }
  #texture(width: number, height: number, format: gpu.TextureFormat, target = false): Texture {
    const texture = this.#device.texture({
      size: { width, height, depthOrArrayLayers: 1 },
      format,
      usage:
        gpu.TextureUsage.TEXTURE_BINDING |
        gpu.TextureUsage.COPY_DST |
        (target ? gpu.TextureUsage.RENDER_ATTACHMENT : 0),
    });
    return { texture, view: texture.createView({}), width, height };
  }
  #begin(encoder: gpu.GpuEncoder, view: gpu.GpuTextureView, clear?: readonly number[]): void {
    encoder.beginRenderPass({
      colorAttachments: [
        {
          view: { kind: 'TextureView', value: view },
          loadOp: clear ? gpu.LoadOp.Clear : gpu.LoadOp.Load,
          storeOp: gpu.StoreOp.Store,
          ...(clear
            ? { clearValue: { r: clear[0]!, g: clear[1]!, b: clear[2]!, a: clear[3]! } }
            : {}),
        },
      ],
    });
  }
  #draw(
    encoder: gpu.GpuEncoder,
    kind: number,
    first: number,
    count: number,
    layer: gpu.GpuTextureView,
    shadow: gpu.GpuTextureView = this.#dummy.view,
  ): void {
    encoder.renderSetPipeline(this.#pipelines.get(kind)!);
    this.#bindGroups(encoder, layer, shadow);
    encoder.renderDrawRange(kind === -2 ? 3 : 6, count, 0, first);
  }
  #bindGroups(
    encoder: gpu.GpuEncoder,
    layer: gpu.GpuTextureView,
    shadow: gpu.GpuTextureView,
  ): void {
    let groups = this.#textureGroups.get(layer);
    if (!groups) {
      groups = new Map();
      this.#textureGroups.set(layer, groups);
    }
    let group = groups.get(shadow);
    if (!group) {
      group = this.#device.createBindGroup({
        layout: this.#textureLayout,
        entries: [
          ...[this.#glyphs[0].view, this.#glyphs[1].view, this.#images.view, layer].map(
            (view, binding) => ({
              binding,
              resource: { kind: 'TextureView' as const, value: view },
            }),
          ),
          { binding: 4, resource: { kind: 'Sampler', value: this.#sampler } },
          { binding: 5, resource: { kind: 'TextureView', value: shadow } },
        ],
      });
      groups.set(shadow, group);
    }
    encoder.renderSetBindGroup(0, this.#frameGroup!);
    encoder.renderSetBindGroup(1, group);
  }
  #clearGroups(): void {
    for (const groups of this.#textureGroups.values()) {
      for (const group of groups.values()) {
        group.destroy();
      }
    }
    this.#textureGroups.clear();
  }
  #drop(texture: Texture | undefined): void {
    texture?.view.destroy();
    texture?.texture.destroy();
  }
  #assertIdle(): void {
    if (this.#encoding) {
      throw new Error('Cannot mutate or reenter the renderer during encoding');
    }
  }
  #assertLive(): void {
    if (this.#disposed) {
      throw new Error('Scene renderer disposed');
    }
  }
  #check(): void {
    const error = this.#device.takeError();
    if (error !== null) {
      throw new Error(error);
    }
  }
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#assertIdle();
    this.#disposed = true;
    this.#canvases.clear();
    for (const pipeline of this.#canvasPipelines) {
      pipeline.dispose();
    }
    this.#clearGroups();
    this.#frameGroup?.destroy();
    this.#buffer?.destroy();
    this.#drop(this.#frame);
    this.#drop(this.#rows);
    this.#drop(this.#shadow);
    for (const layer of this.#layers) {
      this.#drop(layer);
    }
    this.#layers.length = 0;
    this.#drop(this.#dummy);
    for (const glyph of this.#glyphs) {
      this.#drop(glyph);
    }
    this.#images.dispose();
    for (const resource of this.#owned.reverse()) {
      resource.destroy();
    }
  }
}
