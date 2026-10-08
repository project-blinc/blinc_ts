import { Brush, LayoutDirection, LayoutOverflow, type NativeBindings } from 'blinc_ts/native';
import type { Scope } from 'blinc_ts/hmr';

/** Shared by the window demo and its offscreen verification. */
export function createScene(native: NativeBindings, scope?: Scope) {
  const layout = native.createLayout(scope);
  const root = layout.createNode({
    width: '100%',
    height: '100%',
    direction: LayoutDirection.Column,
    padding: 28,
    gap: 18,
  });
  root.setPaint({ background: Brush.solid(0x101722), textColor: [0.94, 0.96, 1, 1] });
  const eyebrow = layout.createText('BLINC / NATIVE', {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 2,
  });
  eyebrow.setPaint({ textColor: [0.42, 0.87, 0.81, 1] });
  const heading = layout.createText('One scene. Native pixels.', {
    fontSize: 30,
    fontWeight: 600,
    wrap: false,
  });
  const caption = layout.createText('Live TypeScript · GPU effects · instant updates', {
    fontSize: 15,
  });
  caption.setPaint({ textColor: [0.62, 0.69, 0.79, 1] });
  const preview = layout.createNode({
    height: 240,
    width: '100%',
    shrink: 0,
    overflow: LayoutOverflow.Hidden,
  });
  preview.setPaint({
    background: Brush.linear(0, 0, 1, 1, true)
      .stop(0, 0x243d81)
      .stop(0.5, 0x63334c)
      .stop(1, 0x116966),
    radius: [28, 28, 28, 28],
  });
  const anchored = (x: number, y: number, width: number, height: number) => {
    const anchor = layout.createNode({ width: 0, height: 0, shrink: 0 });
    anchor.setVisual([x, y, -1, 0]);
    const node = layout.createNode({ width, height, shrink: 0 });
    anchor.setChildren([node]);
    return { anchor, node };
  };
  const circle = anchored(400, -30, 260, 260);
  circle.node.setPaint({
    background: Brush.radial(0.35, 0.35, 0.7, true).stop(0, 0x58f2cc).stop(1, 0x117a9c),
    radius: [130, 130, 130, 130],
  });
  const stripes = anchored(0, 0, 660, 240);
  stripes.node.setStyle({ gap: 22, padding: 26 });
  stripes.node.setChildren(
    Array.from({ length: 24 }, () => {
      const line = layout.createNode({ width: 2, height: '100%', shrink: 0 });
      line.setPaint({ background: Brush.solid(0xffffff, 0.4) });
      return line;
    }),
  );
  const glass = anchored(38, 48, 350, 148);
  glass.node.setStyle({ padding: 24, direction: LayoutDirection.Column, gap: 10 });
  const title = layout.createText('Liquid, without the blur.', { fontSize: 23, fontWeight: 600 });
  const subtitle = layout.createText('Click the card to change dispersion.', { fontSize: 14 });
  subtitle.setPaint({ textColor: [0.87, 0.93, 0.98, 1] });
  glass.node.setChildren([title, subtitle]);
  let pronounced = false;
  const updateGlass = () =>
    glass.node.setPaint({
      background: Brush.glass(0, 0xffffff, 0.04, {
        bevel: 0.18,
        aberration: pronounced ? 1 : 0.2,
        inset: true,
      }),
      radius: [24, 24, 24, 24],
    });
  updateGlass();
  preview.setChildren([circle.anchor, stripes.anchor, glass.anchor]);
  const status = layout.createText('Dispersion 20% · bevel stays fixed', { fontSize: 14 });
  status.setPaint({ textColor: [0.48, 0.81, 0.76, 1] });
  const footer = layout.createText('Edit scene.ts — the window and GPU device stay alive.', {
    fontSize: 13,
  });
  footer.setPaint({ textColor: [0.55, 0.63, 0.73, 1] });
  root.setChildren([eyebrow, heading, caption, preview, status, footer]);
  return {
    layout,
    root,
    glass: glass.node,
    toggle: () => {
      pronounced = !pronounced;
      updateGlass();
      status.setText(`Dispersion ${pronounced ? '100' : '20'}% · bevel stays fixed`);
    },
  };
}
