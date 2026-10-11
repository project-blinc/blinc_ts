/** The wiki's Drawing pages: what an app draws itself, beside what the host draws for it. */
import type { WikiPage } from '../page.js';
import { Example, Note, Page, Table } from '../kit.js';
import CanvasShader from '../examples/canvas-shader.js';

export const drawingPages: readonly WikiPage[] = [
  {
    id: 'canvas',
    title: 'GPU canvas',
    section: 'Drawing',
    view: () => (
      <Page
        title="GPU canvas"
        lead="A canvas element draws with your own shaders, in the scene's paint order, on its GPU."
      >
        <p>
          A <code>canvas</code> is a box like any other: laid out, styled, transformed, clipped and
          faded by CSS. What is inside it is drawn by your code, with your own pipelines, in the
          same render pass as the rest of the scene and at the canvas's place in paint order. What
          comes after it in the tree is drawn over it.
        </p>
        <Example name="canvas-shader" title="A shader in a canvas element" view={CanvasShader} />
        <h2>Drawing a canvas</h2>
        <p>
          <code>host.canvases.draw(canvas, drawing)</code> draws a canvas element until the returned
          function is called or the element is destroyed. A drawing's{' '}
          <code>prepare(renderer, scope)</code> makes what painting needs on that renderer's device,
          a pipeline from <code>renderer.createCanvasPipeline(shader, layouts, scope)</code> and any
          buffers and bind groups, and returns the paint. It is called once for each renderer that
          draws the host: a mounted host's window, and any renderer given to{' '}
          <code>host.canvases.attach(renderer)</code>, as an offscreen capture is. What it made is
          released with its scope when the canvas stops or the renderer goes.
        </p>
        <h2>Painting</h2>
        <p>
          The paint runs synchronously at the canvas's place in each frame, with a frame that is
          valid only during the call. <code>frame.draw(program)</code> binds the program and the
          shared groups and draws its quad; for groups of your own, call{' '}
          <code>frame.bind(program)</code>, set them on <code>frame.encoder</code> from group 2 on,
          then draw. <code>frame.suspend(encoder =&gt; …)</code> ends the pass for passes of your
          own into your own targets, and resumes it after. Return the number of any raw draws, so
          the frame's draw count includes them.
        </p>
        <Table
          head={['Frame', 'Is']}
          rows={[
            [<code>width, height</code>, "the canvas's content box, in layout units"],
            [<code>transform</code>, 'content coordinates to the scene, as an affine matrix'],
            [
              <code>scale, pixelRatio</code>,
              'target pixels per unit, with and without the transform',
            ],
            [<code>scissor</code>, 'the clipped rectangle, in target pixels'],
            [<code>device, encoder, format</code>, 'what to draw with: RGBA8, straight alpha'],
          ]}
        />
        <p>
          A canvas that animates asks for the next frame from its paint with{' '}
          <code>host.canvases.requestFrame()</code>; one that stops asking stops costing frames. A
          canvas out of view is not painted.
        </p>
        <h2>Shaders</h2>
        <p>
          <code>blinc_ts/shaders/canvas</code> gives the parts a canvas shader needs:{' '}
          <code>canvasVertex</code>, which places a quad over the element whatever transforms it,
          and passes on <code>uv</code>, the pixel and the record; and <code>canvasClip</code>,
          which a fragment multiplies its alpha by to keep inside the element's rounded or shaped
          corners, its ancestors' clips and fades, and its opacity. The example writes its fragment
          in WGSL and resolves it with TypeGPU's <code>tgpu.resolve</code>, which brings the SDK's
          parts in by name; a shader in TypeScript compiles with TypeGPU's build plugin instead.
        </p>
        <Note>
          <code>tests/native-canvas.mjs</code> checks paint order, transformed clipping, layers,
          suspension and failures at 1× and 2×; <code>tests/native-canvas-element.mjs</code> checks
          a canvas element drawn in place through two renderers, stopped and destroyed.
        </Note>
      </Page>
    ),
  },
];
