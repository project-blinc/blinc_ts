import assert from 'node:assert/strict';
import test from 'node:test';
import { SceneRenderer } from '../dist/native/renderer.js';
import { TextureAtlas } from '../dist/native/texture-atlas.js';

// Observe allocation budgets and lifetime at the GPU boundary; pixel tests use the real GPU.
function fixture() {
  const resources = [],
    textures = [],
    shaders = [],
    builders = [];
  let fail = false;
  const keep = (kind, members = {}) => {
    const r = {
      kind,
      released: 0,
      destroy() {
        this.released++;
      },
      ...members,
    };
    resources.push(r);
    return r;
  };
  const queue = { writeBuffer() {}, writeTextureWith() {} };
  const device = {
    queue: () => queue,
    takeError: () => (fail ? ((fail = false), 'shader failure') : null),
    createBindGroupLayout: () => keep('bindLayout'),
    createPipelineLayout: () => keep('pipelineLayout'),
    createBuffer: () => keep('buffer'),
    createBindGroup: () => keep('group'),
    sampler: () => keep('sampler'),
    texture: ({ size }) => {
      textures.push(size);
      return keep('texture', { createView: () => keep('view') });
    },
    createShader: (code) => {
      shaders.push(code);
      return keep('shader');
    },
    pipeline: () => {
      const b = keep('builder', {
        shader() {},
        layout() {},
        target() {},
        blend() {},
        build: () => keep('pipeline'),
      });
      builders.push(b);
      return b;
    },
    encoder: () => keep('encoder', { copyTextureToTexture() {}, submit() {} }),
  };
  const record = new Float32Array(112);
  const layout = {
    prepareDisplayList: () => ({ count: 1, floats: 112 }),
    readDisplayList: (out) => out.set(record),
    atlasInfo: () => null,
  };
  const encoder = {
    beginRenderPass() {},
    renderSetPipeline() {},
    renderSetBindGroup() {},
    renderDrawRange() {},
    renderEnd() {},
  };
  return {
    device,
    layout,
    encoder,
    resources,
    textures,
    shaders,
    builders,
    record,
    fail: () => {
      fail = true;
    },
  };
}

test('unused renderer pipelines and atlases stay small; warm frames reuse GPU resources', () => {
  const f = fixture(),
    renderer = new SceneRenderer(f.device, f.layout);
  assert.equal(f.shaders.length, 0, 'Construction must not compile unused shaders');
  assert(f.textures.every((s) => s.width === 1 && s.height === 1));
  const draw = () => renderer.encode(f.encoder, {}, {}, { width: 64, height: 48 });
  draw();
  assert.equal(f.shaders.length, 2, 'Solid boxes need only the box and presentation pipelines');
  assert(f.builders.every((b) => b.released === 1));
  const count = f.resources.length;
  for (let i = 0; i < 1000; i++) {
    draw();
  }
  assert.equal(f.resources.length, count, 'Unchanged warm frames allocate no GPU resources');
  f.record[44] = 3;
  draw();
  assert.equal(f.shaders.length, 3, 'Shadow shader is compiled only on first use');
  renderer.dispose();
  renderer.dispose();
  assert(
    f.resources.every((r) => r.released === 1),
    'Every owned handle is released exactly once',
  );
});

test('a failed lazy pipeline is released and can be rebuilt on a later frame', () => {
  const f = fixture(),
    renderer = new SceneRenderer(f.device, f.layout);
  f.fail();
  const draw = () => renderer.encode(f.encoder, {}, {}, { width: 64, height: 48 });
  assert.throws(draw, /shader failure/);
  draw();
  assert.equal(f.shaders.length, 3, 'Failed pipelines must not be cached');
  renderer.dispose();
  assert(f.resources.every((r) => r.released === 1));
});

test('image atlas grows directly to the needed size and releases replaced views', () => {
  const f = fixture(),
    atlas = new TextureAtlas(f.device);
  assert.deepEqual(
    f.textures.map((s) => s.width),
    [1],
  );
  atlas.add(700, 500, new Uint8Array(700 * 500 * 4));
  assert.deepEqual(
    f.textures.map((s) => s.width),
    [1, 1024],
  );
  const first = atlas.view;
  atlas.add(800, 800, new Uint8Array(800 * 800 * 4));
  assert.equal(first.released, 1);
  assert.deepEqual(
    f.textures.map((s) => s.width),
    [1, 1024, 2048],
  );
  atlas.dispose();
  assert(f.resources.every((r) => r.released === 1));
});
