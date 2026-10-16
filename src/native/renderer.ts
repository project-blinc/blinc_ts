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
import { IMAGE_BASE, type ImageLibrary } from './image-library.js';
import { boxShader } from '../renderer/generated/box.js';
import { shadowShader } from '../renderer/generated/shadow.js';
import { textShader } from '../renderer/generated/text.js';
import { imageShader } from '../renderer/generated/image.js';
import { backdropShader } from '../renderer/generated/backdrop.js';
import { backdropRowsComputeShader } from '../renderer/generated/backdropRowsCompute.js';
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
export interface SceneRendererOptions {
  /**
   * A backdrop blurred by at least this many device pixels (its Gaussian's deviation) is blurred
   * at half resolution: the rows are read at full resolution and kept at half, a quarter of the
   * work. At such blurs no detail finer than two pixels survives either way, but the result is
   * not the same to the bit. Infinity blurs every backdrop at full resolution.
   */
  halfResolutionBlur?: number;
}
export interface SceneRenderStats {
  primitives: number;
  drawCalls: number;
  recordBytes: number;
  atlasBytes: number;
  canvasCalls: number;
  /** What the renderer's own textures hold after the frame: the frame, layers, atlases. */
  textureBytes: number;
}
/** Where a texture's contents sit on screen, in device pixels. */
interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** A layer of the frame: its records, how deep it is, and where it is drawn. */
interface Layer {
  /** Its records: the one that opens it and the one that composites it. */
  begin: number;
  end: number;
  /** How many layers hold it, itself included. */
  level: number;
  /** It holds glass or a canvas, so it is drawn in its place, as large as the frame. */
  full: boolean;
  /** What it covers on screen. */
  region: Region;
  /** Where screen pixels start in the texture it is packed into, and where it sits there. */
  into: Region;
  place: Region;
  blurred: boolean;
  shadowed: boolean;
}
const whole = (width: number, height: number): Region => ({ x: 0, y: 0, width, height });
/** No pixels at all. */
const NOWHERE: Region = { x: 0, y: 0, width: 0, height: 0 };
/** What two regions share; none, when they do not meet. */
const meet = (a: Region, b: Region): Region => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : NOWHERE;
};
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
const BOUNDS = fields.bounds * 4;
const COLOR = fields.color * 4;
const COLOR2 = fields.color2 * 4;
/** Image sizes are bucketed at twelve steps an octave of scale, so a zoom reuses rasterizations. */
/** The tallest texture packed layers are drawn into, within what every GPU allows. */
const MAX_PACK = 8192;
/** Floats between uniform slots: 256 bytes, the alignment a dynamic offset needs. */
const SLOT_FLOATS = 64;
/** Layer textures grow in steps of this many pixels, so a moving layer does not remake one a frame. */
const LAYER_STEP = 64;
/** Frames a scratch texture outlives the last frame that needed it. */
const KEEP_FRAMES = 60;
/** See `SceneRendererOptions.halfResolutionBlur`. */
const HALF_RESOLUTION_BLUR = 16;
const IMAGE_STEPS_PER_OCTAVE = 12;
/** The largest side an image is resampled to; beyond it, it is magnified. */
const IMAGE_MAX_SIDE = 2048;

function imageScale(onScreen: number): number {
  return onScreen > 0
    ? 2 ** (Math.round(Math.log2(onScreen) * IMAGE_STEPS_PER_OCTAVE) / IMAGE_STEPS_PER_OCTAVE)
    : 1;
}
function imageSide(v: number): number {
  return Math.max(1, Math.min(IMAGE_MAX_SIDE, Math.ceil(v - 0.01)));
}
// Generated WGSL is a module constant, shared by every renderer. Compile only used primitives.
const SHADERS = new Map<number, Shader>([
  [0, boxShader],
  [3, shadowShader],
  [7, textShader],
  [32, imageShader],
  [42, backdropShader],
  [41, layerShader],
  [-3, layerRowsShader],
  [-4, layerShadowShader],
  [-2, blitShader],
]);

/** Native display-list renderer. Owns GPU caches; the host owns the device and layout. */
export class SceneRenderer {
  readonly #device: gpu.GpuDevice;
  readonly #layout: Layout;
  readonly #queue: gpu.GpuQueue;
  readonly #owned: { destroy(): void }[] = [];
  readonly #format: gpu.TextureFormat;
  readonly #pipelineLayout: gpu.GpuPipelineLayout;
  readonly #pipelines = new Map<number, gpu.GpuPipeline>();
  readonly #frameLayout: gpu.GpuBindGroupLayout;
  readonly #textureLayout: gpu.GpuBindGroupLayout;
  /** The blurred rows a compute pass writes, and the pass. */
  readonly #rowsLayout: gpu.GpuBindGroupLayout;
  #rowsPipeline: gpu.GpuPipeline | undefined;
  readonly #rowsGroups = new Map<gpu.GpuTextureView, gpu.GpuBindGroup>();
  /** One uniform slot per pass of a frame: the target it draws into, and what it reads. */
  #viewport: gpu.GpuBuffer | undefined;
  #slotData = new Float32Array(0);
  #slotCount = 0;
  #slotOffset = new Uint8Array(4);
  /** The slot of the pass being recorded. */
  #slot = 0;
  readonly #sampler: gpu.GpuSampler;
  readonly #images: TextureAtlas;
  readonly #imageSlots = new Map<number, AtlasRect>();
  /** What each fixed slot was given, to put it back when the atlas is emptied. */
  readonly #fixedImages = new Map<
    number,
    { image: ImageResource; width: number; height: number; fit: ImageFit }
  >();
  readonly #imageIds = new WeakMap<ImageResource, number>();
  /** Atlas rects by what was drawn into them: an image, its size and fit. */
  readonly #imageRects = new Map<string, AtlasRect>();
  #nextImageId = 0;
  #library: ImageLibrary | null = null;
  readonly #textureGroups = new Map<
    gpu.GpuTextureView,
    Map<gpu.GpuTextureView, gpu.GpuBindGroup>
  >();
  readonly #layers: Texture[] = [];
  /** Packed layers at each depth: their content, their shadows and their blurred rows. */
  readonly #packed: [Texture[], Texture[], Texture[]] = [[], [], []];
  readonly #packedUsed: number[] = [];
  readonly #dummy: Texture;
  readonly #glyphs: [GlyphTexture, GlyphTexture];
  #records = new Float32Array(0);
  #buffer: gpu.GpuBuffer | undefined;
  #frameGroup: gpu.GpuBindGroup | undefined;
  #frame: Texture | undefined;
  #rows: Texture | undefined;
  #shadow: Texture | undefined;
  /** Frames encoded, and the last that needed each scratch texture: each layer depth, rows, shadow. */
  #frameCount = 0;
  /** The blur, in device pixels, from which backdrops are blurred at half resolution. */
  readonly #halfBlur: number;
  readonly #layerUsed: number[] = [];
  #rowsUsed = 0;
  #shadowUsed = 0;
  /** Pixels of an atlas entry on their way to it. */
  #scratch = new Uint8Array(0);
  /** The frame each atlas entry was last drawn in, by its key. */
  readonly #imageUsed = new Map<string, number>();
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

  constructor(
    device: gpu.GpuDevice,
    layout: Layout,
    format: gpu.TextureFormat = gpu.TextureFormat.Rgba8unorm,
    options: SceneRendererOptions = {},
  ) {
    this.#halfBlur = options.halfResolutionBlur ?? HALF_RESOLUTION_BLUR;
    this.#device = device;
    this.#format = format;
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
        this.#begin(state.encoder!, state.target!, this.#slot);
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
            visibility: gpu.ShaderStage.VERTEX | gpu.ShaderStage.FRAGMENT | gpu.ShaderStage.COMPUTE,
            buffer: { type: gpu.BufferBindingType.Uniform, hasDynamicOffset: true },
          },
          {
            binding: 1,
            visibility: gpu.ShaderStage.VERTEX | gpu.ShaderStage.FRAGMENT | gpu.ShaderStage.COMPUTE,
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
            visibility: gpu.ShaderStage.FRAGMENT | gpu.ShaderStage.COMPUTE,
            texture: {
              sampleType: gpu.TextureSampleType.Float,
              viewDimension: gpu.TextureViewDimension.D2d,
            },
          })),
          {
            binding: 4,
            visibility: gpu.ShaderStage.FRAGMENT | gpu.ShaderStage.COMPUTE,
            sampler: { type: gpu.SamplerBindingType.Filtering },
          },
        ],
      }),
    );
    this.#pipelineLayout = keep(
      device.createPipelineLayout({ bindGroupLayouts: [this.#frameLayout, this.#textureLayout] }),
    );
    this.#rowsLayout = keep(
      device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: gpu.ShaderStage.COMPUTE,
            storageTexture: {
              access: gpu.StorageTextureAccess.WriteOnly,
              format: gpu.TextureFormat.Rgba8unorm,
              viewDimension: gpu.TextureViewDimension.D2d,
            },
          },
        ],
      }),
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
      this.#check();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  /** The device it draws with, on which a canvas makes the buffers and bind groups it paints with. */
  get device(): gpu.GpuDevice {
    return this.#device;
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
      const module = this.#device.createShader(shader.code);
      let builder: gpu.GpuPipelineBuilder | undefined;
      let pipeline: gpu.GpuPipeline;
      try {
        builder = this.#device.pipeline();
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
        pipeline = keep(builder.build());
        this.#check();
      } finally {
        builder?.destroy();
        module.destroy();
      }
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
    this.#fixedImages.set(slot, { image, width, height, fit });
    this.#imageSlots.set(slot, this.#fixedRect(image, width, height, fit));
    this.#check();
  }

  /** Draw the library's images, each at the size it covers on screen, as records name them. */
  useImages(library: ImageLibrary | null): void {
    this.#assertLive();
    this.#assertIdle();
    this.#library = library;
  }

  #imageId(image: ImageResource): number {
    let id = this.#imageIds.get(image);
    if (id === undefined) {
      id = this.#nextImageId++;
      this.#imageIds.set(image, id);
    }
    return id;
  }

  /** The atlas rect of `key`, made by `draw` into a `width` by `height` buffer when it has none. */
  #imageRect(
    key: string,
    width: number,
    height: number,
    draw: (pixels: Uint8Array) => void,
  ): AtlasRect {
    this.#imageUsed.set(key, this.#frameCount);
    let rect = this.#imageRects.get(key);
    if (!rect) {
      // One buffer serves every entry, so a frame that makes many does not hold them all at once.
      const bytes = width * height * 4;
      if (this.#scratch.length < bytes) {
        this.#scratch = new Uint8Array(bytes);
      }
      const pixels = this.#scratch.subarray(0, bytes);
      draw(pixels);
      const revision = this.#images.revision;
      try {
        rect = this.#images.add(width, height, pixels);
      } finally {
        // It may have grown into a new texture before finding it still had no room.
        if (revision !== this.#images.revision) {
          this.#clearGroups();
        }
      }
      this.#imageRects.set(key, rect);
    }
    return rect;
  }

  #fixedRect(image: ImageResource, width: number, height: number, fit: ImageFit): AtlasRect {
    return this.#imageRect(
      `${this.#imageId(image)}:${width}:${height}:${fit}`,
      width,
      height,
      (p) => image.resample(width, height, fit, p),
    );
  }

  /** Empty the image atlas, putting the fixed slots back. */
  #resetImages(): void {
    this.#images.reset();
    this.#imageRects.clear();
    this.#imageUsed.clear();
    for (const [slot, { image, width, height, fit }] of this.#fixedImages) {
      this.#imageSlots.set(slot, this.#fixedRect(image, width, height, fit));
    }
  }

  /**
   * Give every image record its rect in the atlas. A record that names a library image is drawn
   * from it at the size it covers on screen, which a record carries as its scale; one whose image
   * is not there draws nothing. False when the atlas could not hold them all.
   */
  #resolveImages(count: number): boolean {
    let fitted = true;
    for (let i = 0; i < count; i++) {
      const at = i * R;
      if (this.#records[at + KIND] !== 32) {
        continue;
      }
      const slot = this.#records[at + GRADIENT]!;
      let rect: AtlasRect | undefined;
      let fill = 1;
      let cell: readonly [number, number] | undefined;
      if (slot >= IMAGE_BASE) {
        const entry = this.#library?.get(slot);
        if (entry) {
          try {
            ({ rect, fill, cell } = this.#libraryRect(entry, at));
          } catch (error) {
            if (!(error instanceof RangeError)) {
              throw error;
            }
            fitted = false;
          }
        }
        if (!rect) {
          // Nothing to draw: no colour, no opacity.
          this.#records[at + COLOR + 3] = 0;
          this.#records[at + COLOR2 + 3] = 0;
          continue;
        }
      } else {
        rect = this.#imageSlots.get(slot);
        if (!rect) {
          throw new Error(`Image slot ${slot} has not been uploaded`);
        }
      }
      this.#records[at + KIND + 1] = fill;
      if (cell) {
        // A tile repeats at its own size, which the record carries for the shader.
        this.#records[at + COLOR2] = cell[0];
        this.#records[at + COLOR2 + 1] = cell[1];
      }
      this.#records[at + GRADIENT] = rect.x;
      this.#records[at + GRADIENT + 1] = rect.y;
      this.#records[at + GRADIENT + 2] = rect.x + rect.width;
      this.#records[at + GRADIENT + 3] = rect.y + rect.height;
    }
    return fitted;
  }

  #libraryRect(
    { image, id, fit }: NonNullable<ReturnType<ImageLibrary['get']>>,
    at: number,
  ): { rect: AtlasRect; fill: number; cell?: readonly [number, number] } {
    const scale = imageScale(this.#records[at + GRADIENT + 1]!);
    // A tile is made once at the image's own size, one layout unit a pixel as CSS sizes images,
    // and repeated by the shader; any other fit is made at the size of what it covers.
    const tile = fit === ImageFit.Tile;
    const natural: readonly [number, number] =
      image.kind === 'bitmap'
        ? [image.image.width, image.image.height]
        : [image.width, image.height];
    const [boxWidth, boxHeight] = tile
      ? natural
      : [this.#records[at + BOUNDS + 2]!, this.#records[at + BOUNDS + 3]!];
    const width = imageSide(boxWidth * scale);
    const height = imageSide(boxHeight * scale);
    const cell = tile ? natural : undefined;
    if (image.kind === 'bitmap') {
      const rect = this.#imageRect(`b${id}:${fit}:${width}x${height}`, width, height, (p) =>
        image.image.resample(width, height, tile ? ImageFit.Fill : fit, p),
      );
      return { rect, fill: tile ? 2 : 1, ...(cell && { cell }) };
    }
    // A mask is rasterized white and tinted when drawn; a colour image bakes in its currentColor.
    let color = '#ffffff';
    let key = `s${id}:${tile ? 't' : ''}${width}x${height}`;
    if (!image.mask) {
      const channel = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));
      const hex = (v: number): string => channel(v).toString(16).padStart(2, '0');
      color = `#${hex(this.#records[at + COLOR]!)}${hex(this.#records[at + COLOR + 1]!)}${hex(this.#records[at + COLOR + 2]!)}`;
      if (/currentcolor/i.test(image.markup)) {
        key += color;
      }
    }
    const rect = this.#imageRect(key, width, height, (pixels) => {
      const markup = image.markup.replace(/currentcolor/gi, color);
      const raster = this.#library!.rasterize(markup, width, height);
      try {
        raster.readPixels(pixels);
      } finally {
        raster.dispose();
      }
    });
    return { rect, fill: tile ? 2 : image.mask ? 0 : 1, ...(cell && { cell }) };
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
    this.#frameCount++;
    const info = this.#layout.prepareDisplayList(root, options);
    this.#reserve(info.floats);
    this.#layout.readDisplayList(this.#records);
    if (!this.#resolveImages(info.count)) {
      // The images covering the screen are more than the atlas holds: start it afresh with them.
      this.#resetImages();
      this.#layout.readDisplayList(this.#records);
      this.#resolveImages(info.count);
    }
    // Each layer is drawn into a texture the size of what it covers. One that holds glass or a
    // canvas reads or draws the screen, so it is drawn in its place, into a texture as large as
    // the frame. Every other layer is drawn before the frame, packed beside the others at its
    // depth: one pass a depth for them all, and one for their shadows and one for their blur.
    const layers = new Map<number, Layer>();
    const open: Layer[] = [];
    const deepest: [number, number][] = [];
    let rowsSize: [number, number] = [0, 0];
    let shadowSize: [number, number] = [0, 0];
    // What each backdrop reads, which its blurred rows are drawn for: no more of the screen.
    const backdrops = new Map<number, Region>();
    const backdropRows = new Map<number, Region>();
    // How many pixels a texel of each backdrop's blurred rows spans.
    const backdropSteps = new Map<number, number>();
    let slots = 4;
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
        const layer: Layer = {
          begin: i,
          end: -1,
          level: open.length + 1,
          full: false,
          region: whole(width, height),
          into: whole(width, height),
          place: whole(width, height),
          blurred: false,
          shadowed: false,
        };
        layers.set(i, layer);
        open.push(layer);
      } else if (kind === 41) {
        const layer = open.pop();
        if (!layer) {
          throw new Error('Unbalanced display-list layers');
        }
        layer.end = i;
        layer.blurred = this.#records[at + fields.color * 4]! > 0;
        layer.shadowed = this.#records[at + fields.via * 4 + 3]! > 0;
        slots += 7;
        if (!layer.full) {
          layer.region = this.#region(at, width, height, scale);
        }
      } else if (kind === 42 || kind === 33) {
        for (const layer of open) {
          layer.full = true;
        }
        if (kind === 42) {
          const region = this.#backdropRegion(i, width, height, scale);
          backdrops.set(i, region);
          backdropRows.set(i, this.#backdropRows(i, width, height, scale));
          const step = this.#records[at + fields.color * 4]! >= this.#halfBlur ? 2 : 1;
          backdropSteps.set(i, step);
          rowsSize = [
            Math.max(rowsSize[0], Math.ceil(region.width / step)),
            Math.max(rowsSize[1], Math.ceil(region.height / step)),
          ];
          slots += 2;
        }
      }
    }
    if (open.length !== 0) {
      throw new Error('Unbalanced display-list layers');
    }
    // Shelves of packed layers, a texture a depth as wide as the frame.
    let packs: {
      layers: Layer[];
      width: number;
      height: number;
      x: number;
      y: number;
      shelf: number;
    }[] = [];
    const tallest = Math.min(MAX_PACK, height * 4);
    // As wide as the widest layer at a depth, and about as wide as tall for many small ones.
    const across: number[] = [];
    for (const layer of layers.values()) {
      if (!layer.full) {
        const d = layer.level - 1;
        const { width: w, height: h } = layer.region;
        across[d] = Math.max(
          across[d] ?? 0,
          w,
          Math.ceil(Math.sqrt((across[d] ?? 0) ** 2 + w * h)),
        );
      }
    }
    for (const layer of layers.values()) {
      if (layer.full) {
        continue;
      }
      const wide = Math.min(width, Math.ceil(across[layer.level - 1]! / LAYER_STEP) * LAYER_STEP);
      const pack = (packs[layer.level - 1] ??= {
        layers: [],
        width: wide,
        height: 0,
        x: 0,
        y: 0,
        shelf: 0,
      });
      const { width: w, height: h } = layer.region;
      if (pack.x + w > pack.width) {
        pack.y += pack.shelf + 1;
        pack.x = 0;
        pack.shelf = 0;
      }
      layer.place = { x: pack.x, y: pack.y, width: w, height: h };
      layer.into = { x: layer.region.x - pack.x, y: layer.region.y - pack.y, width: w, height: h };
      pack.x += w + 1;
      pack.shelf = Math.max(pack.shelf, h);
      pack.height = Math.max(pack.height, pack.y + h);
      pack.layers.push(layer);
    }
    if (packs.some((pack) => pack && pack.height > tallest)) {
      // More than a texture holds: every layer is drawn in its place instead.
      packs = [];
      for (const layer of layers.values()) {
        layer.full = true;
      }
    }
    for (const layer of layers.values()) {
      if (layer.full) {
        const d = layer.level - 1;
        const need = deepest[d] ?? [0, 0];
        deepest[d] = [Math.max(need[0], width), Math.max(need[1], height)];
        if (layer.blurred) {
          rowsSize = [width, height];
        }
        if (layer.shadowed) {
          shadowSize = [width, height];
        }
      }
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
      for (const set of this.#packed) {
        for (const texture of set) {
          this.#drop(texture);
        }
        set.length = 0;
      }
      this.#rows = undefined;
      this.#shadow = undefined;
      this.#frame = this.#texture(width, height, gpu.TextureFormat.Rgba8unorm, true);
    }
    // Scratch passes are consumed immediately, so rows/shadow can be shared at every depth.
    // Only simultaneously active groups need distinct content textures.
    const now = this.#frameCount;
    if (rowsSize[0] > 0) {
      this.#rows = this.#fit(this.#rows, rowsSize, width, height, true);
      this.#rowsUsed = now;
    }
    if (shadowSize[0] > 0) {
      this.#shadow = this.#fit(this.#shadow, shadowSize, width, height);
      this.#shadowUsed = now;
    }
    for (let d = 0; d < deepest.length; d++) {
      if (deepest[d]) {
        this.#layers[d] = this.#fit(this.#layers[d], deepest[d]!, width, height);
        this.#layerUsed[d] = now;
      }
    }
    const [content, shadows, rows] = this.#packed;
    for (let d = 0; d < packs.length; d++) {
      const pack = packs[d];
      if (!pack) {
        continue;
      }
      const size: [number, number] = [pack.width, pack.height];
      content[d] = this.#fit(content[d], size, width, tallest);
      if (pack.layers.some((l) => l.shadowed)) {
        shadows[d] = this.#fit(shadows[d], size, width, tallest);
      }
      if (pack.layers.some((l) => l.blurred)) {
        rows[d] = this.#fit(rows[d], size, width, tallest);
      }
      this.#packedUsed[d] = now;
    }
    // What no recent frame needed goes; a frame that needs it again makes it again.
    this.#release(now - KEEP_FRAMES);
    this.#reserveSlots(slots);
    if (info.floats) {
      this.#queue.writeBuffer(
        this.#buffer!,
        0n,
        new Uint8Array(this.#records.buffer, 0, info.floats * 4),
        info.floats * 4,
      );
    }
    const frame = this.#frame;
    const screen = whole(width, height);
    let used = 0;
    /**
     * A uniform slot for drawing into `texture` at `into`, reading what lies at `from`; a texel of
     * the texture spans `draws` pixels, one of what is read `reads`.
     */
    const slot = (texture: Texture, into: Region, from: Region = into, draws = 1, reads = 1) => {
      const data = this.#slotData;
      const o = used * SLOT_FLOATS;
      data[o] = (texture.width * draws) / scale;
      data[o + 1] = (texture.height * draws) / scale;
      data[o + 2] = into.x / scale;
      data[o + 3] = into.y / scale;
      data[o + 4] = into.x;
      data[o + 5] = into.y;
      data[o + 6] = into.x - from.x;
      data[o + 7] = into.y - from.y;
      data[o + 8] = draws;
      data[o + 9] = reads;
      data[o + 10] = 0;
      data[o + 11] = 0;
      return used++;
    };
    let drawCalls = 0;
    let canvasCalls = 0;
    this.#canvasState.drawCalls = 0;
    /** Draw a packed layer's composite, `child`, into what is being drawn at `into`. */
    const composite = (texture: Texture, into: Region, child: Layer) => {
      const d = child.level - 1;
      this.#use(slot(texture, into, child.into));
      this.#draw(
        encoder,
        41,
        child.end,
        1,
        child.blurred ? rows[d]!.view : content[d]!.view,
        child.shadowed ? shadows[d]!.view : this.#dummy.view,
      );
      drawCalls++;
    };
    /** Draw records from `i` to `end`, where only packed layers are nested, into `texture` at `into`. */
    const run = (i: number, end: number, texture: Texture, into: Region, base: number) => {
      while (i < end) {
        const kind = this.#records[i * R + KIND]!;
        if (kind === 40) {
          const child = layers.get(i)!;
          composite(texture, into, child);
          this.#use(base);
          i = child.end + 1;
          continue;
        }
        let stop = i + 1;
        while (stop < end && this.#records[stop * R + KIND] === kind) {
          stop++;
        }
        this.#draw(encoder, kind, i, stop - i, this.#dummy.view);
        drawCalls++;
        i = stop;
      }
    };
    // Packed layers first, the deepest first, so each is ready before what holds it is drawn.
    for (let d = packs.length - 1; d >= 0; d--) {
      const pack = packs[d];
      if (!pack) {
        continue;
      }
      const texture = content[d]!;
      this.#begin(encoder, texture.view, slot(texture, screen), [0, 0, 0, 0]);
      for (const layer of pack.layers) {
        const base = slot(texture, layer.into);
        this.#use(base);
        const p = layer.place;
        encoder.renderSetScissorRect(p.x, p.y, p.width, p.height);
        run(layer.begin + 1, layer.end, texture, layer.into, base);
      }
      encoder.renderEnd();
      for (const [kind, scratch, flag] of [
        [-4, shadows[d], 'shadowed'],
        [-3, rows[d], 'blurred'],
      ] as const) {
        const due = pack.layers.filter((l) => l[flag]);
        if (due.length === 0) {
          continue;
        }
        this.#begin(encoder, scratch!.view, slot(scratch!, screen), [0, 0, 0, 0]);
        for (const layer of due) {
          this.#use(slot(scratch!, layer.into));
          const p = layer.place;
          encoder.renderSetScissorRect(p.x, p.y, p.width, p.height);
          this.#draw(encoder, kind, layer.end, 1, texture.view);
          drawCalls++;
        }
        encoder.renderEnd();
      }
    }
    // Then the frame, with layers that hold glass or a canvas drawn in their place.
    const stack: { texture: Texture; region: Region; base: number }[] = [];
    let current = { texture: frame, region: screen, base: slot(frame, screen) };
    const clear = options.clear ?? [0, 0, 0, 0];
    this.#begin(encoder, frame.view, current.base, clear);
    /** Blur the rows backdrop `i` reads, out of `source` at `from`, into the rows texture. */
    const blurRows = (i: number, source: Texture, from: Region) => {
      const read = backdrops.get(i)!;
      const step = backdropSteps.get(i)!;
      const wanted = meet(backdropRows.get(i)!, read);
      if (wanted.width <= 0) {
        return read;
      }
      // In a compute pass: a tiled GPU bins nothing for it, as it does for a render pass.
      const x = Math.floor((wanted.x - read.x) / step);
      const y = Math.floor((wanted.y - read.y) / step);
      const across = Math.ceil((wanted.x + wanted.width - read.x) / step) - x;
      const down = Math.ceil((wanted.y + wanted.height - read.y) / step) - y;
      const index = slot(this.#rows!, read, from, step);
      const o = index * SLOT_FLOATS;
      this.#slotData.set([x, y, across, down], o);
      this.#slotData[o + 10] = i;
      this.#use(index);
      encoder.beginComputePass({});
      encoder.computeSetPipeline(this.#rowsCompute());
      encoder.computeSetBindGroupOffsets(0, this.#frameGroup!, this.#slotOffset, 0n, 1);
      encoder.computeSetBindGroup(1, this.#textureGroup(source.view, this.#dummy.view));
      encoder.computeSetBindGroup(2, this.#rowsGroup(this.#rows!.view));
      encoder.computeDispatch(Math.ceil(across / 8), Math.ceil(down / 8), 1);
      encoder.computeEnd();
      return read;
    };
    for (let i = 0; i < info.count;) {
      const kind = this.#records[i * R + KIND]!;
      if (kind === 40) {
        const layer = layers.get(i)!;
        if (!layer.full) {
          composite(current.texture, current.region, layer);
          this.#use(current.base);
          i = layer.end + 1;
          continue;
        }
        encoder.renderEnd();
        stack.push(current);
        const texture = this.#layers[layer.level - 1]!;
        current = { texture, region: screen, base: slot(texture, screen) };
        this.#begin(encoder, texture.view, current.base, [0, 0, 0, 0]);
        i++;
      } else if (kind === 41) {
        encoder.renderEnd();
        const inner = current;
        const blurred = this.#records[i * R + fields.color * 4]! > 0;
        const shadowed = this.#records[i * R + fields.via * 4 + 3]! > 0;
        if (shadowed) {
          this.#begin(encoder, this.#shadow!.view, slot(this.#shadow!, inner.region), [0, 0, 0, 0]);
          this.#draw(encoder, -4, i, 1, inner.texture.view);
          encoder.renderEnd();
          drawCalls++;
        }
        if (blurred) {
          this.#begin(encoder, this.#rows!.view, slot(this.#rows!, inner.region), [0, 0, 0, 0]);
          this.#draw(encoder, -3, i, 1, inner.texture.view);
          encoder.renderEnd();
          drawCalls++;
        }
        current = stack.pop()!;
        this.#begin(
          encoder,
          current.texture.view,
          slot(current.texture, current.region, inner.region),
        );
        this.#draw(
          encoder,
          41,
          i,
          1,
          blurred ? this.#rows!.view : inner.texture.view,
          shadowed ? this.#shadow!.view : this.#dummy.view,
        );
        this.#use(current.base);
        drawCalls++;
        i++;
      } else if (kind === 42) {
        encoder.renderEnd();
        const region = blurRows(i, current.texture, current.region);
        this.#begin(
          encoder,
          current.texture.view,
          slot(current.texture, current.region, region, 1, backdropSteps.get(i)),
        );
        this.#draw(encoder, 42, i, 1, this.#rows!.view);
        this.#use(current.base);
        drawCalls += 2;
        i++;
      } else if (kind === 33) {
        canvasCalls += this.#paintCanvas(encoder, i, width, height, scale, current.texture.view);
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
    this.#begin(encoder, target, slot(frame, screen), [0, 0, 0, 0]);
    this.#draw(encoder, -2, 0, 1, frame.view);
    encoder.renderEnd();
    this.#queue.writeBuffer(
      this.#viewport!,
      0n,
      new Uint8Array(this.#slotData.buffer, 0, used * SLOT_FLOATS * 4),
      used * SLOT_FLOATS * 4,
    );
    this.#check();
    return {
      primitives: info.count,
      drawCalls: drawCalls + this.#canvasState.drawCalls + 1,
      canvasCalls,
      recordBytes: info.floats * 4,
      atlasBytes,
      textureBytes: this.textureBytes,
    };
  }

  /** Bytes its own textures hold now: the frame, layers, atlases. */
  get textureBytes(): number {
    const rgba = (t: Texture | undefined) => (t ? t.width * t.height * 4 : 0);
    let bytes = rgba(this.#frame) + rgba(this.#rows) + rgba(this.#shadow);
    for (const layer of this.#layers) {
      bytes += rgba(layer);
    }
    for (const set of this.#packed) {
      for (const texture of set) {
        bytes += rgba(texture);
      }
    }
    bytes += this.#glyphs[0].width * this.#glyphs[0].height + rgba(this.#glyphs[1]);
    return bytes + this.#images.width * this.#images.height * 4;
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
    this.#buffer?.destroy();
    this.#buffer = this.#device.createBuffer({
      size: BigInt(capacity * 4),
      usage: gpu.BufferUsage.STORAGE | gpu.BufferUsage.COPY_DST,
    });
    this.#frameGroup?.destroy();
    this.#frameGroup = undefined;
  }

  /** Room for `count` uniform slots, and the bind group that reads them with the records. */
  #reserveSlots(count: number): void {
    if (count > this.#slotCount) {
      let capacity = Math.max(this.#slotCount, 16);
      while (capacity < count) {
        capacity *= 2;
      }
      this.#slotCount = capacity;
      this.#slotData = new Float32Array(capacity * SLOT_FLOATS);
      this.#viewport?.destroy();
      this.#viewport = this.#device.createBuffer({
        size: BigInt(capacity * SLOT_FLOATS * 4),
        usage: gpu.BufferUsage.UNIFORM | gpu.BufferUsage.COPY_DST,
      });
      this.#frameGroup?.destroy();
      this.#frameGroup = undefined;
    }
    this.#frameGroup ??= this.#device.createBindGroup({
      layout: this.#frameLayout,
      entries: [
        {
          binding: 0,
          resource: { kind: 'BufferBinding', value: { buffer: this.#viewport!, size: 48n } },
        },
        { binding: 1, resource: { kind: 'Buffer', value: this.#buffer! } },
      ],
    });
  }

  /**
   * What the layer ending at record offset `at` covers, in device pixels: its bounds as drawn,
   * grown by how far its blur and drop shadow read, within the frame.
   */
  #region(at: number, width: number, height: number, scale: number): Region {
    const r = this.#records;
    const blur = Math.max(r[at + fields.color * 4]!, 0);
    const offset = at + fields.gradient * 4;
    const reach =
      Math.ceil(3 * Math.max(blur, r[offset + 2]!)) +
      Math.ceil(Math.abs(r[offset]!)) +
      Math.ceil(Math.abs(r[offset + 1]!)) +
      2;
    return this.#onScreen(at, reach, width, height, scale);
  }

  /**
   * The device pixels a backdrop reads: its box and the pixel and a half its quad grows by for
   * antialiasing, as far out as its blur and its rim reach.
   */
  #backdropRegion(record: number, width: number, height: number, scale: number): Region {
    const r = this.#records;
    const o = record * R;
    const reach = Math.max(r[o + fields.color * 4 + 1]!, 0) * scale;
    const m = o + fields.affine * 4;
    const gx = 1.5 / Math.max(Math.hypot(r[m]!, r[m + 1]!), 0.01);
    const gy = 1.5 / Math.max(Math.hypot(r[m + 2]!, r[m + 3]!), 0.01);
    return this.#onScreen(o, Math.ceil(reach) + 2, width, height, scale, gx, gy);
  }

  /**
   * The blurred rows a backdrop goes on to read: across, only as far as its rim bends what is
   * behind it; up and down, as far as its blur reaches too. Its record holds the blur in device
   * pixels and the whole reach in layout pixels.
   */
  #backdropRows(record: number, width: number, height: number, scale: number): Region {
    const r = this.#records;
    const o = record * R;
    const blur = Math.max(r[o + fields.color * 4]!, 0);
    const reach = Math.max(r[o + fields.color * 4 + 1]!, 0) * scale;
    const m = o + fields.affine * 4;
    const gx = 1.5 / Math.max(Math.hypot(r[m]!, r[m + 1]!), 0.01);
    const gy = 1.5 / Math.max(Math.hypot(r[m + 2]!, r[m + 3]!), 0.01);
    const across = Math.ceil(Math.max(reach - 3 * blur, 0)) + 2;
    return this.#onScreen(o, across, width, height, scale, gx, gy, NOWHERE, Math.ceil(reach) + 2);
  }

  /** A record's box as placed on screen, `reach` device pixels larger on every side, in the frame. */
  #onScreen(
    at: number,
    reach: number,
    width: number,
    height: number,
    scale: number,
    gx = 0,
    gy = 0,
    offscreen?: Region,
    reachY = reach,
  ): Region {
    const r = this.#records;
    const [x, y] = [r[at + BOUNDS]!, r[at + BOUNDS + 1]!];
    // The box, grown by `gx` and `gy` before it is placed.
    const [l, t, rt, bm] = [-gx, -gy, r[at + BOUNDS + 2]! + gx, r[at + BOUNDS + 3]! + gy];
    const m = at + fields.affine * 4;
    const [a, b, c, d] = [r[m]!, r[m + 1]!, r[m + 2]!, r[m + 3]!];
    const xs = [a * l + c * t, a * rt + c * t, a * l + c * bm, a * rt + c * bm];
    const ys = [b * l + d * t, b * rt + d * t, b * l + d * bm, b * rt + d * bm];
    const x0 = Math.max(0, Math.floor((x + Math.min(...xs)) * scale) - reach);
    const y0 = Math.max(0, Math.floor((y + Math.min(...ys)) * scale) - reachY);
    const x1 = Math.min(width, Math.ceil((x + Math.max(...xs)) * scale) + reach);
    const y1 = Math.min(height, Math.ceil((y + Math.max(...ys)) * scale) + reachY);
    if (![x0, y0, x1, y1].every(Number.isFinite)) {
      return { x: 0, y: 0, width, height };
    }
    if (x1 <= x0 || y1 <= y0) {
      // Wholly off screen: nothing of it is seen, so a pixel holds it.
      return (
        offscreen ?? {
          x: Math.min(x0, width - 1),
          y: Math.min(y0, height - 1),
          width: 1,
          height: 1,
        }
      );
    }
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  /** `texture`, or one made in its place, at least `size` and at most the frame. */
  #fit(
    texture: Texture | undefined,
    [w, h]: [number, number],
    width: number,
    height: number,
    storage = false,
  ): Texture {
    if (texture && texture.width >= w && texture.height >= h) {
      return texture;
    }
    const step = (n: number, most: number) =>
      Math.min(most, Math.ceil(n / LAYER_STEP) * LAYER_STEP);
    const made = this.#texture(
      Math.max(texture?.width ?? 0, step(w, width)),
      Math.max(texture?.height ?? 0, step(h, height)),
      gpu.TextureFormat.Rgba8unorm,
      true,
      storage,
    );
    if (texture) {
      this.#clearGroups();
      this.#drop(texture);
    }
    return made;
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
  #texture(
    width: number,
    height: number,
    format: gpu.TextureFormat,
    target = false,
    storage = false,
  ): Texture {
    const texture = this.#device.texture({
      size: { width, height, depthOrArrayLayers: 1 },
      format,
      usage:
        gpu.TextureUsage.TEXTURE_BINDING |
        gpu.TextureUsage.COPY_DST |
        (target ? gpu.TextureUsage.RENDER_ATTACHMENT : 0) |
        (storage ? gpu.TextureUsage.STORAGE_BINDING : 0),
    });
    return { texture, view: texture.createView({}), width, height };
  }
  /** Draw what follows with uniform slot `slot`. */
  #use(slot: number): void {
    this.#slot = slot;
    new DataView(this.#slotOffset.buffer).setUint32(0, slot * SLOT_FLOATS * 4, true);
  }
  #begin(
    encoder: gpu.GpuEncoder,
    view: gpu.GpuTextureView,
    slot: number,
    clear?: readonly number[],
  ): void {
    this.#use(slot);
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
  #pipeline(kind: number): gpu.GpuPipeline {
    const cached = this.#pipelines.get(kind);
    if (cached) {
      return cached;
    }
    const shader = SHADERS.get(kind);
    if (!shader) {
      throw new Error(`Unsupported pipeline ${kind}`);
    }
    const module = this.#device.createShader(shader.code);
    let builder: gpu.GpuPipelineBuilder | undefined;
    let pipeline: gpu.GpuPipeline | undefined;
    try {
      builder = this.#device.pipeline();
      builder.shader(module, shader.vertexEntryPoint, shader.fragmentEntryPoint);
      builder.layout(this.#pipelineLayout);
      builder.target(kind === -2 ? this.#format : gpu.TextureFormat.Rgba8unorm, gpu.ColorWrite.ALL);
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
      pipeline = builder.build();
      this.#check();
      this.#pipelines.set(kind, pipeline);
      this.#owned.push(pipeline);
      return pipeline;
    } catch (error) {
      pipeline?.destroy();
      throw error;
    } finally {
      builder?.destroy();
      module.destroy();
    }
  }
  #draw(
    encoder: gpu.GpuEncoder,
    kind: number,
    first: number,
    count: number,
    layer: gpu.GpuTextureView,
    shadow: gpu.GpuTextureView = this.#dummy.view,
  ): void {
    encoder.renderSetPipeline(this.#pipeline(kind));
    this.#bindGroups(encoder, layer, shadow);
    encoder.renderDrawRange(kind === -2 ? 3 : 6, count, 0, first);
  }
  #bindGroups(
    encoder: gpu.GpuEncoder,
    layer: gpu.GpuTextureView,
    shadow: gpu.GpuTextureView,
  ): void {
    const group = this.#textureGroup(layer, shadow);
    encoder.renderSetBindGroupOffsets(0, this.#frameGroup!, this.#slotOffset, 0n, 1);
    encoder.renderSetBindGroup(1, group);
  }
  #textureGroup(layer: gpu.GpuTextureView, shadow: gpu.GpuTextureView): gpu.GpuBindGroup {
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
    return group;
  }
  /** The pipeline that blurs a backdrop's rows in a compute pass, made when first needed. */
  #rowsCompute(): gpu.GpuPipeline {
    if (this.#rowsPipeline) {
      return this.#rowsPipeline;
    }
    const module = this.#device.createShader(backdropRowsComputeShader.code);
    const layout = this.#device.createPipelineLayout({
      bindGroupLayouts: [this.#frameLayout, this.#textureLayout, this.#rowsLayout],
    });
    try {
      const pipeline = this.#device.createComputePipeline({
        layout,
        compute: { module, entryPoint: backdropRowsComputeShader.computeEntryPoint },
      });
      this.#check();
      this.#owned.push(pipeline);
      this.#rowsPipeline = pipeline;
      return pipeline;
    } finally {
      layout.destroy();
      module.destroy();
    }
  }
  #rowsGroup(view: gpu.GpuTextureView): gpu.GpuBindGroup {
    let group = this.#rowsGroups.get(view);
    if (!group) {
      group = this.#device.createBindGroup({
        layout: this.#rowsLayout,
        entries: [{ binding: 0, resource: { kind: 'TextureView', value: view } }],
      });
      this.#rowsGroups.set(view, group);
    }
    return group;
  }
  /**
   * Let go of what the last frame did not draw with: layers deeper than it went, scratch
   * textures it did not use, and image atlas entries it did not draw, when the ones it did fit
   * in a good deal less. Those are moved into an atlas packed for them, their pixels copied as
   * they are. For a window that has gone quiet; frames release what they have not needed for a
   * while on their own.
   */
  trim(): void {
    this.#assertLive();
    this.#assertIdle();
    this.#release(this.#frameCount - 1);
    this.#scratch = new Uint8Array(0);
    const fixed = new Set(this.#imageSlots.values());
    const keep = [...this.#imageRects].filter(
      ([key, rect]) => fixed.has(rect) || this.#imageUsed.get(key) === this.#frameCount,
    );
    if (this.#images.repack(keep.map(([, rect]) => rect))) {
      this.#clearGroups();
      this.#imageRects.clear();
      this.#imageUsed.clear();
      for (const [key, rect] of keep) {
        this.#imageRects.set(key, rect);
        this.#imageUsed.set(key, this.#frameCount);
      }
    }
  }
  /** Drop the scratch textures last needed at or before frame `before`. */
  #release(before: number): void {
    let dropped = false;
    while (this.#layers.length > 0 && (this.#layerUsed[this.#layers.length - 1] ?? 0) <= before) {
      this.#drop(this.#layers.pop());
      dropped = true;
    }
    this.#layerUsed.length = this.#layers.length;
    if (this.#rows && this.#rowsUsed <= before) {
      this.#drop(this.#rows);
      this.#rows = undefined;
      dropped = true;
    }
    if (this.#shadow && this.#shadowUsed <= before) {
      this.#drop(this.#shadow);
      this.#shadow = undefined;
      dropped = true;
    }
    for (let d = 0; d < this.#packedUsed.length; d++) {
      if ((this.#packedUsed[d] ?? 0) <= before) {
        for (const set of this.#packed) {
          if (set[d]) {
            this.#drop(set[d]);
            set[d] = undefined!;
            dropped = true;
          }
        }
      }
    }
    if (dropped) {
      this.#clearGroups();
    }
  }
  #clearGroups(): void {
    for (const groups of this.#textureGroups.values()) {
      for (const group of groups.values()) {
        group.destroy();
      }
    }
    this.#textureGroups.clear();
    for (const group of this.#rowsGroups.values()) {
      group.destroy();
    }
    this.#rowsGroups.clear();
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
    this.#viewport?.destroy();
    this.#drop(this.#frame);
    this.#drop(this.#rows);
    this.#drop(this.#shadow);
    for (const layer of this.#layers) {
      this.#drop(layer);
    }
    this.#layers.length = 0;
    for (const set of this.#packed) {
      for (const texture of set) {
        this.#drop(texture);
      }
    }
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
