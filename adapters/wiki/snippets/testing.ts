/** A test with no window: build a tree, press it as a user would, and read what is drawn. */
import assert from 'node:assert/strict';
import { loadNative } from 'blinc_ts/native';
import { Host } from 'blinc_ts/native/host';
import { OffscreenRenderer } from 'blinc_ts/native/offscreen';
import { SceneRenderer } from 'blinc_ts/native/renderer';
import { probeShader } from 'blinc_ts/shaders';
import { ThemeState, neutralTheme } from 'blinc_ts/theme';
import { addUserAgent } from 'blinc_ts/theme/user-agent';

export async function buttonTurnsRed(): Promise<void> {
  const native = loadNative();
  const [W, H] = [200, 100];
  const target = await OffscreenRenderer.create(native, W, H, probeShader);
  const host = Host.create(native);
  const context = native.createReactive();
  try {
    // The user-agent sheet reads the theme's variables.
    new ThemeState(context, neutralTheme, { scheme: 'light' }).attach(host.layout);
    addUserAgent(host.layout);
    // As specific as the user-agent sheet's button:hover, and later, so it wins under the pointer.
    host.layout.addStyleSheet('button.pressed { background: #ff0000; }');
    const button = host.createElement('button');
    button.appendChild(host.createTextNode('Press'));
    button.addEventListener('click', () => button.classList.add('pressed'));
    host.root.appendChild(button);
    host.compute(W, H);

    // Input as a window would give it: the pointer moves, presses and lets go.
    const [x, y, w, h] = button.bounds();
    host.input.pointerMove(x + w / 2, y + h / 2);
    host.input.pointerDown();
    host.input.pointerUp();
    host.compute(W, H);
    // A transition starts at the first tick and is over by the second.
    host.layout.tickMotion(0);
    host.layout.tickMotion(10_000);

    // Draw it, and read the pixels back.
    const renderer = new SceneRenderer(target.device, host.layout);
    const pixels = new Uint8Array(W * H * 4);
    await target.captureCommandsInto(
      pixels,
      (encoder, view) =>
        renderer.encode(encoder, host.root.layoutNode, view, { width: W, height: H, scale: 1 })
          .drawCalls,
    );
    renderer.dispose();
    const i = (Math.round(y + 4) * W + Math.round(x + 4)) * 4;
    assert.ok(pixels[i]! > 200 && pixels[i + 1]! < 60, 'the press turned it red');
  } finally {
    host.dispose();
    context.dispose();
    target.dispose();
  }
}
