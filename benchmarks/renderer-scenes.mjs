import {
  Brush,
  ImageFit,
  LayoutDirection as D,
  LayoutOverflow as O,
} from '../dist/native/index.js';

export const viewport = { width: 1024, height: 768 };
export const paintOptions = { cornerShape: Math.fround(Math.log2(Math.fround(2.52))) };
export const fontFamily = 'Arial';
const rounded = { radius: [18.375, 18.375, 18.375, 18.375] };
const ink = [0.88, 0.92, 0.98, 1];
const muted = [0.57, 0.65, 0.76, 1];
// A fixed SVG exercises native rasterization and the retained image atlas.
const artwork = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="64">
<defs><linearGradient id="g"><stop stop-color="#679bf8"/><stop offset="1" stop-color="#50cebb"/></linearGradient></defs>
<rect width="128" height="64" fill="url(#g)"/>
<circle cx="102" cy="16" r="26" fill="#fbc573"/>
<path d="M0 60L40 16L80 60Z" fill="#203457"/></svg>`;

/** Raw scene workloads, not a component implementation or a styled UI demo. */
export function createScene(api, kind, count) {
  const layout = api.createLayout();
  const root = layout.createNode({ ...viewport, direction: D.Column, padding: 24, gap: 16 });
  root.setPaint({ background: Brush.solid(0x101722), textColor: ink });
  const label = (text, size = 16, color = ink) => {
    const node = layout.createText(
      text,
      { fontSize: size, fontFamily, wrap: false },
      { shrink: 0 },
    );
    node.setPaint({ textColor: color });
    return node;
  };
  const header = label(
    {
      list: 'Clipped text list',
      cards: 'Images, gradients and layout',
      effects: 'Glass and layered effects',
    }[kind],
    24,
  );
  header.setStyle({ height: 32 });
  let update,
    prepare = () => {},
    disposeImage = () => {};
  let description;
  if (kind === 'list') {
    const list = layout.createNode({
      width: 976,
      height: 664,
      direction: D.Column,
      overflow: O.Hidden,
    });
    list.setPaint({ ...rounded, background: Brush.solid(0x172333) });
    list.setChildren(
      Array.from({ length: count }, (_, i) => {
        const row = layout.createNode({ height: 56, width: 976, padding: 10, gap: 12, shrink: 0 });
        row.setPaint({ background: Brush.solid(i % 2 ? 0x1b293a : 0x172333) });
        const index = label(String(i).padStart(4, '0'), 16, [0.4, 0.84, 0.75, 1]);
        index.setStyle({ width: 52 });
        const content = layout.createNode({ direction: D.Column, grow: 1, gap: 2 });
        content.setChildren([
          label('Native text, retained glyphs', 16),
          label('Clipped content · stable layout · cached paint', 12, muted),
        ]);
        row.setChildren([index, content, label('Ready', 13, muted)]);
        return row;
      }),
    );
    root.setChildren([header, list]);
    update = (phase) => {
      list.setScroll(0, phase * 28);
      return false;
    };
    description = `${count} non-virtualized rows, two text lines and two labels per row; a 28px scroll invalidates paint only`;
  } else if (kind === 'cards') {
    const image = api.rasterizeSvg(artwork, 128, 64);
    disposeImage = () => image.dispose();
    prepare = (renderer) => renderer.setImage(0, image, 128, 64);
    layout.setImageSource('benchmark-artwork', ImageFit.Fill, 0);
    const rows = Array.from({ length: 4 }, (_, y) => {
      const row = layout.createNode({ width: 976, height: 144, gap: 12, shrink: 0 });
      row.setChildren(
        Array.from({ length: 3 }, (_, x) => {
          const card = layout.createNode({
            grow: 1,
            height: 144,
            padding: 12,
            gap: 8,
            direction: D.Column,
            overflow: O.Hidden,
          });
          card.setPaint({
            ...rounded,
            background: Brush.solid(0x1c293b),
            borderWidth: 1.25,
            borderColor: [0.36, 0.48, 0.64, 0.6],
            shadows: [{ x: 0, y: 3, blur: 8, color: [0, 0, 0, 0.4] }],
          });
          const photo = layout.createNode({ height: 64, shrink: 0 });
          photo.setPaint({
            background: Brush.image('benchmark-artwork', ImageFit.Fill),
            radius: [8, 8, 8, 8],
          });
          const title = label(`Collection ${y * 3 + x + 1}`, 16);
          const track = layout.createNode({ height: 6, shrink: 0 });
          track.setPaint({
            radius: [3, 3, 3, 3],
            background: Brush.linear(0, 0, 1, 0, true).stop(0, 0x679bf8).stop(1, 0x50cebb),
          });
          card.setChildren([photo, title, track]);
          return card;
        }),
      );
      return row;
    });
    root.setChildren([header, ...rows]);
    const patches = [{ gap: 12 }, { gap: 20 }];
    update = (phase) => {
      root.setStyle(patches[phase]);
      return true;
    };
    description =
      '12 image cards, fractional corners and borders, shadows and gradients; an 8px gap change invalidates layout';
  } else if (kind === 'effects') {
    const stage = layout.createNode({ width: 976, height: 664, overflow: O.Hidden });
    stage.setPaint({
      ...rounded,
      background: Brush.linear(0, 0, 1, 1, true)
        .stop(0, 0x173d8a)
        .stop(0.5, 0x8a3155)
        .stop(1, 0x087c70),
    });
    const box = (x, y, width, height, paint) => {
      const node = layout.createNode({ width: 0, height: 0, shrink: 0 });
      node.setVisual([x, y, width, height]);
      node.setPaint(paint);
      return node;
    };
    const children = [],
      glasses = [];
    for (let x = 16; x < 960; x += 32) {
      children.push(box(x, 16, 3, 632, { background: Brush.solid(0xffffff, 0.55) }));
    }
    const materials = [0.2, 1].map((aberration) =>
      [0, 6].map((blur) => ({
        background: Brush.glass(blur, 0xffffff, 0.04, { bevel: 0.18, inset: true, aberration }),
      })),
    );
    for (let i = 0; i < 6; i++) {
      const card = box(24 + (i % 2) * 480, 24 + Math.floor(i / 2) * 208, 448, 184, {
        ...rounded,
        ...materials[0][i % 2],
        borderWidth: 1.25,
        borderColor: [1, 1, 1, 0.25],
      });
      card.setStyle({ overflow: O.Hidden });
      glasses.push(card);
      const group = box(22, 52, 380, 92, {
        opacity: 0.75,
        filter: { blur: 1.25, dropShadow: { x: 3, y: 4, blur: 6, color: [0, 0, 0, 0.6] } },
        maskImage: Brush.linear(0, 0, 1, 0, true).stop(0, 0xffffff, 0.4).stop(1, 0xffffff),
      });
      group.setChildren([
        box(0, 0, 250, 72, { ...rounded, background: Brush.solid(0x44ccb9) }),
        box(188, 24, 150, 60, { ...rounded, background: Brush.solid(0xf9bf72) }),
      ]);
      const title = label(i % 2 ? 'Blur + refraction' : 'Clear refraction', 20);
      title.setStyle({ width: 0, height: 0 });
      title.setVisual([22, 14, 400, 30]);
      card.setChildren([group, title]);
      children.push(card);
    }
    stage.setChildren(children);
    root.setChildren([header, stage]);
    update = (phase) => {
      for (let i = 0; i < glasses.length; i++) {
        glasses[i].setPaint(materials[phase][i % 2]);
      }
      return false;
    };
    description =
      'Six glass cards, half with zero blur, each with masked group opacity, Gaussian blur and drop shadow; only aberration changes (fixed bevel 0.18)';
  } else {
    layout.dispose();
    throw new Error(`Unknown renderer workload: ${kind}`);
  }
  return {
    layout,
    root,
    description,
    update,
    prepare,
    dispose() {
      disposeImage();
      layout.dispose();
    },
  };
}
