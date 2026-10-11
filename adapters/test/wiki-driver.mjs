// Driving the wiki as a window does: a frame after each event, and pointer travel between them.
import { FrameLayout } from '../../dist/native/frame-layout.js';
import { SceneRenderer } from 'blinc_ts/native/renderer';

/** The button under `node` whose text is `text`. */
export function buttonNamed(node, text) {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.tag === 'button' && child.textContent === text) {
      return child;
    }
    const found = buttonNamed(child, text);
    if (found) {
      return found;
    }
  }
  return undefined;
}

/** The elements under `node` with `name` among their classes, in tree order. */
export function findAll(node, name, out = []) {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.classList?.contains(name)) {
      out.push(child);
    }
    findAll(child, name, out);
  }
  return out;
}

/**
 * Frames as a window makes them for `host`, drawn on `target` at `width` by `height`. A frame lays
 * out, ticks motion by 16 ms and draws; `press` moves the pointer to a node, presses and
 * releases, a frame after each, and runs frames until the motion it started has played.
 */
export function windowed(host, target, width, height) {
  host.compute(width, height);
  const layout = new FrameLayout(host.layout, host.root.layoutNode);
  host.layout.onChange((change) => layout.changed(change));
  let clock = 0;
  const pixels = new Uint8Array(width * height * 4);
  // One renderer for every frame, as a window keeps, with the host's canvases drawn through it.
  const renderer = new SceneRenderer(target.device, host.layout);
  renderer.useImages(host.images.library);
  host.canvases.attach(renderer);
  host.layout.onChange((change) => {
    if (change === 'disposed') {
      renderer.dispose();
    }
  });
  const frame = async () => {
    const moving = layout.prepare(width, height, 1, () => (clock += 16));
    await target.captureCommandsInto(
      pixels,
      (encoder, view) =>
        renderer.encode(encoder, host.root.layoutNode, view, { width, height, scale: 1 }).drawCalls,
    );
    return moving;
  };
  /** Frames until nothing is moving, at most `limit`; how many it took. */
  const settle = async (limit = 400) => {
    let n = 0;
    while ((await frame()) && n < limit) {
      n++;
    }
    return n;
  };
  const press = async (element) => {
    const [x, y, w, h] = element.viewBounds();
    host.input.pointerMove(x + w / 2, y + h / 2);
    await frame();
    host.input.pointerDown();
    await frame();
    host.input.pointerUp();
    await frame();
    return settle();
  };
  return { frame, settle, press, pixels };
}
