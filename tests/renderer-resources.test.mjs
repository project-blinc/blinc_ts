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
  const copies = [];
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
    encoder: () =>
      keep('encoder', {
        copyTextureToTexture() {},
        copyTextureToTextureWith: (from, to, size) =>
          copies.push([from.origin, to.origin, size.width, size.height]),
        submit() {},
      }),
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
    renderSetBindGroupOffsets() {},
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
    copies,
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

test('image atlas grows only as wide and tall as its entries need and releases replaced views', () => {
  const f = fixture(),
    atlas = new TextureAtlas(f.device);
  const sizes = () => f.textures.map((s) => [s.width, s.height]);
  assert.deepEqual(sizes(), [[1, 1]]);
  atlas.add(700, 500, new Uint8Array(700 * 500 * 4));
  assert.deepEqual(sizes(), [
    [1, 1],
    [1024, 512],
  ]);
  const first = atlas.view;
  // Too wide to sit beside the first: a shelf below it, and as wide as that leaves it tall.
  atlas.add(800, 800, new Uint8Array(800 * 800 * 4));
  assert.equal(first.released, 1);
  assert.deepEqual(sizes(), [
    [1, 1],
    [1024, 512],
    [2048, 1536],
  ]);
  atlas.dispose();
  assert(f.resources.every((r) => r.released === 1));
});

test('image atlas repacks what it keeps into what they need, copied on the GPU', () => {
  const f = fixture(),
    atlas = new TextureAtlas(f.device);
  atlas.add(700, 500, new Uint8Array(700 * 500 * 4));
  const kept = atlas.add(800, 800, new Uint8Array(800 * 800 * 4));
  assert.deepEqual([atlas.width, atlas.height], [2048, 1536]);
  assert.deepEqual(kept, { x: 0, y: 501, width: 800, height: 800 });
  const view = atlas.view;
  const revision = atlas.revision;
  // Only the second kept: it moves to the top of an atlas as large as it needs.
  assert.equal(atlas.repack([kept]), true);
  assert.deepEqual([atlas.width, atlas.height], [1024, 1024]);
  assert.deepEqual(kept, { x: 0, y: 0, width: 800, height: 800 });
  assert.deepEqual(f.copies, [[{ x: 0, y: 501, z: 0 }, { x: 0, y: 0, z: 0 }, 800, 800]]);
  assert.equal(view.released, 1);
  assert.equal(atlas.revision, revision + 1);
  // Packed as tight as it gets already: nothing changes.
  assert.equal(atlas.repack([kept]), false);
  assert.equal(f.copies.length, 1);
  const short = atlas.add(1000, 100, new Uint8Array(1000 * 100 * 4));
  assert.equal(atlas.repack([short, kept]), false, 'the same size: not worth a copy');
  assert.equal(atlas.repack([]), true, 'nothing kept: as small as it gets');
  assert.deepEqual([atlas.width, atlas.height], [1, 1]);
  atlas.dispose();
  assert(f.resources.every((r) => r.released === 1));
});

test('image atlas widens rather than leaving space under a shelf, and repacks at its best width', () => {
  const f = fixture(),
    atlas = new TextureAtlas(f.device);
  // A page of wide pictures, in the order its frame drew them.
  const rects = [
    [28, 28],
    [1364, 440],
    [1476, 800],
    [1364, 440],
    [1364, 440],
  ].map(([w, h]) => atlas.add(w, h, new Uint8Array(w * h * 4)));
  // Widened for the last, it sits beside the second rather than under everything.
  assert.deepEqual([atlas.width, atlas.height], [4096, 1792]);
  assert.deepEqual(rects[4], { x: 1365, y: 29, width: 1364, height: 440 });
  assert.equal(atlas.repack(rects), true);
  assert.deepEqual([atlas.width, atlas.height], [2048, 2304]);
  // Tallest first; none overlaps another.
  assert.deepEqual(rects[2], { x: 0, y: 0, width: 1476, height: 800 });
  for (const a of rects) {
    for (const b of rects) {
      assert(
        a === b ||
          a.x + a.width < b.x ||
          b.x + b.width < a.x ||
          a.y + a.height < b.y ||
          b.y + b.height < a.y,
      );
    }
  }
  atlas.dispose();
});
