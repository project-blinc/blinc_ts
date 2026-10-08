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
  readonly #textureGroups = new Map<gpu.GpuTextureView, gpu.GpuBindGroup>();
  readonly #dummy: Texture;
  readonly #glyphs: [GlyphTexture, GlyphTexture];
  #records = new Float32Array(0);
  #buffer: gpu.GpuBuffer | undefined;
  #frameGroup: gpu.GpuBindGroup | undefined;
  #frame: Texture | undefined;
  #rows: Texture | undefined;
  #disposed = false;

  constructor(device: gpu.GpuDevice, layout: Layout, format = gpu.TextureFormat.Rgba8unorm) {
    this.#device = device;
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
          ...[0, 1, 2, 3].map((binding) => ({
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

  /** Pack a rasterized image into the shared atlas and associate its renderer slot. */
  setImage(
    slot: number,
    image: ImageResource,
    width = image.width,
    height = image.height,
    fit = ImageFit.Fill,
  ): void {
    this.#assertLive();
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
    for (let i = 0; i < info.count; i++) {
      const at = i * R;
      const kind = this.#records[at + KIND]!;
      if (kind !== 0 && kind !== 3 && kind !== 7 && kind !== 32 && kind !== 42) {
        throw new Error(`Unsupported display-list primitive ${kind}`);
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
    const atlasBytes = this.#syncGlyphs();
    if (this.#frame?.width !== width || this.#frame.height !== height) {
      this.#clearGroups();
      this.#drop(this.#frame);
      this.#drop(this.#rows);
      this.#frame = this.#texture(width, height, gpu.TextureFormat.Rgba8unorm, true);
      this.#rows = this.#texture(width, height, gpu.TextureFormat.Rgba8unorm, true);
    }
    const frame = this.#frame;
    const rows = this.#rows!;
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
    for (let i = 0; i < info.count;) {
      const kind = this.#records[i * R + KIND]!;
      if (kind === 42) {
        encoder.renderEnd();
        this.#begin(encoder, rows.view, [0, 0, 0, 0]);
        this.#draw(encoder, -1, i, 1, frame.view);
        encoder.renderEnd();
        this.#begin(encoder, frame.view);
        this.#draw(encoder, 42, i, 1, rows.view);
        drawCalls += 2;
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
      drawCalls: drawCalls + 1,
      recordBytes: info.floats * 4,
      atlasBytes,
    };
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
  ): void {
    let group = this.#textureGroups.get(layer);
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
        ],
      });
      this.#textureGroups.set(layer, group);
    }
    encoder.renderSetPipeline(this.#pipelines.get(kind)!);
    encoder.renderSetBindGroup(0, this.#frameGroup!);
    encoder.renderSetBindGroup(1, group);
    encoder.renderDrawRange(kind === -2 ? 3 : 6, count, 0, first);
  }
  #clearGroups(): void {
    for (const group of this.#textureGroups.values()) {
      group.destroy();
    }
    this.#textureGroups.clear();
  }
  #drop(texture: Texture | undefined): void {
    texture?.view.destroy();
    texture?.texture.destroy();
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
    this.#disposed = true;
    this.#clearGroups();
    this.#frameGroup?.destroy();
    this.#buffer?.destroy();
    this.#drop(this.#frame);
    this.#drop(this.#rows);
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
