/** A layout tree with no host: nodes, a typed style, a layout, and bounds read back in one call. */
import { LayoutAlign, LayoutDirection, type NativeBindings } from 'blinc_ts/native';

export function sidebarLayout(native: NativeBindings): Float32Array {
  const layout = native.createLayout();
  try {
    const root = layout.createNode({
      width: '100%',
      height: '100%',
      gap: 12,
      padding: 16,
      direction: LayoutDirection.Row,
      align: LayoutAlign.Stretch,
    });
    const sidebar = layout.createNode({ width: 180, shrink: 0 });
    const content = layout.createNode({ grow: 1 });
    root.setChildren([sidebar, content]);
    // Any CSS layout property, read by the same parser a sheet's go through.
    content.setLayoutProperty('margin', '8px auto');
    layout.compute(root, 960, 640);
    // Four numbers a node, absolute x, y, width and height, into storage that can be reused.
    const bounds = new Float32Array(8);
    layout.readBounds([sidebar, content], bounds);
    return bounds;
  } finally {
    layout.dispose();
  }
}
