/** The wiki's Drawing pages: what an app draws itself, beside what the host draws for it. */
import type { WikiPage } from '../page.js';
import { Example, Note, Page, SourceView, Table } from '../kit.js';
import Brushes from '../examples/brushes.js';
import MeasureText from '../examples/measure-text.js';
import Notches from '../examples/notches.js';
import ReactiveGraph from '../examples/reactive-graph.js';
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
  {
    id: 'layout-trees',
    title: 'Layout trees',
    section: 'Drawing',
    view: () => (
      <Page title="Layout trees" lead="The native layout under the host, usable on its own.">
        <p>
          A host is built on a <code>Layout</code>: a native tree of nodes with styles, laid out by
          flexbox and grid, that owns text and paint. It can be used without a host, to lay out what
          an app draws itself or to measure a layout. <code>createLayout(scope)</code> makes one,
          released with its scope.
        </p>
        <SourceView
          file="wiki/snippets/layout-tree.ts"
          title="adapters/wiki/snippets/layout-tree.ts"
        />
        <p>
          A typed style covers the box model: sizes with their limits, margin, padding and border
          per side, position and inset, display, flex direction, wrap, grow, shrink and basis, every
          alignment, gaps, <code>order</code>, <code>aspectRatio</code>, overflow, and grid
          templates and placement as CSS text. <code>setLayoutProperty(name, value)</code> takes any
          CSS layout property. Edits are queued and sent as one native call when the layout is
          computed or read; <code>readBounds</code> fills four numbers a node into storage that can
          be reused. <code>setChildren</code>, <code>insertBefore</code>, <code>append</code> and{' '}
          <code>removeChild</code> edit the tree, and a cycle or a duplicate child is refused.
        </p>
      </Page>
    ),
  },
  {
    id: 'brushes',
    title: 'Brushes',
    section: 'Drawing',
    view: () => (
      <Page title="Brushes" lead="Paint as a value: what a background is, made in code.">
        <Example name="brushes" view={Brushes} />
        <p>
          <code>Brush.solid</code>, <code>Brush.linear(x0, y0, x1, y1, boundingBox)</code> and{' '}
          <code>Brush.radial(cx, cy, r, boundingBox)</code> with their <code>stop</code>s,{' '}
          <code>Brush.image(source, fit)</code>, <code>Brush.blur</code> and{' '}
          <code>Brush.glass(blur, tint, alpha, options)</code> are what CSS backgrounds become. A
          brush is made once for each native context and reused; give it to{' '}
          <code>element.setProperty('background', brush)</code> or a style object, and it stays over
          the cascade until it is cleared with <code>null</code>. On a bare layout node,{' '}
          <code>setPaint</code> takes brushes, radii, borders, shadows, opacity, transforms, filters
          and masks.
        </p>
      </Page>
    ),
  },
  {
    id: 'notches',
    title: 'Notches',
    section: 'Drawing',
    view: () => (
      <Page title="Notches" lead="Shapes a rounded box cannot make, drawn in place of the box.">
        <Example name="notches" view={Notches} />
        <p>
          A notch is four signed corner radii, where a negative one is a concave corner curving out
          to the box's edge, as a dropdown meets its bar, and a modifier at the middle of the top
          and of the bottom edge: <code>notchEdge.scoop</code> and <code>cut</code> carve into the
          body, <code>bulge</code> and <code>peak</code> rise out of it. Concave corners, bulges and
          peaks lie inside the box, so the body is inset by them and needs padding for its content.
          A concave corner insets the body from its edge too: a dropdown meets its bar with a margin
          that takes it that radius up into the bar. Fills, borders and shadows follow the notch,
          and a radius animated through zero is continuous.
        </p>
        <p>
          <code>node.setNotch(notch)</code> sets it on an element's <code>layoutNode</code>;{' '}
          <code>bindNotch(source, context)</code> follows a signal. A notch has no CSS property.
        </p>
      </Page>
    ),
  },
  {
    id: 'measure',
    title: 'Measuring text',
    section: 'Drawing',
    view: () => (
      <Page
        title="Measuring text"
        lead="Lines, widths and caret stops, as the renderer draws them, with no tree."
      >
        <Example name="measure-text" view={MeasureText} />
        <p>
          <code>native.measureText(text, style, wrapWidth)</code> returns the lines (each a UTF-16
          range and a width), the line height, the font's ascender and descender, and every place a
          caret can stand; <code>caretAt(index)</code> finds the caret before an index and{' '}
          <code>caretNear(x, y)</code> the one nearest a point, for a click. For runs in different
          styles, <code>native.layoutInline(items, width, {'{ align, breakWords }'})</code> lays out
          a whole paragraph of runs, boxes and breaks, as the host's inline flow does.
        </p>
      </Page>
    ),
  },
  {
    id: 'windows',
    title: 'Windows',
    section: 'Drawing',
    view: () => (
      <Page
        title="Windows"
        lead="A native window with its GPU device, drawing only when something changed."
      >
        <SourceView file="wiki/snippets/windows.ts" title="adapters/wiki/snippets/windows.ts" />
        <p>
          <code>NativeWindowHost</code> keeps a window, its surface and its GPU device while scenes
          come and go. It pumps the window's events in bounded batches on Node's main thread, beside
          timers and I/O, and draws only when dirty: an edit, a resize or motion asks for a frame,
          and a quiet window costs none. Hidden, minimized or covered, it defers drawing.
        </p>
        <Table
          head={['Member', 'Is']}
          rows={[
            [<code>ready</code>, 'resolves once the surface and device exist'],
            [<code>closed</code>, 'resolves when the user closes it, or it is disposed'],
            [
              <code>frames, stats</code>,
              "frames presented, and the last frame's primitives and draw calls",
            ],
            [
              <code>presentable, framePending</code>,
              'whether a frame can be shown now, and whether one waits',
            ],
            [<code>requestFrame()</code>, 'ask for a frame, for a change outside the layout'],
            [
              <code>onEvent(listener)</code>,
              'the native events: resize, pointer, keys, input method, theme',
            ],
            [
              <code>captureFrames(listener)</code>,
              'every presented frame read back, for tests and tools',
            ],
            [<code>window</code>, 'the window itself: size, scale, title, cursor, input method'],
          ]}
        />
        <Note>
          Hosts show their tree with <code>host.mount(window)</code>; a hand-made layout uses{' '}
          <code>window.attachScene(layout, root)</code>. A transparent window needs a surface that
          supports premultiplied alpha; macOS with Metal is verified.
        </Note>
      </Page>
    ),
  },
  {
    id: 'reactive-contexts',
    title: 'Reactive contexts',
    section: 'Drawing',
    view: () => (
      <Page
        title="Reactive contexts"
        lead="Signals, computed values and effects on a native dependency graph."
      >
        <Example name="reactive-graph" view={ReactiveGraph} />
        <p>
          <code>native.createReactive(scope)</code> makes a graph of its own. Signal values stay in
          JavaScript, keeping their identity; the native graph keeps dependencies, dirtiness and
          scheduling. Signals compare with <code>Object.is</code>; computed values are lazy and
          cached and track what they read; effects run synchronously after a write, or once after a{' '}
          <code>batch</code>. <code>peek()</code> and <code>untrack</code> read without subscribing.
          Disposing an item frees its native memory at once.
        </p>
        <p>
          Contexts do not nest: while one context's computed value or effect runs, another context's
          items cannot be made, read, written or disposed. A view built by a framework on one
          context makes another's after it is built, and writes across by plain assignment, as the
          example does with its two texts.
        </p>
        <p>
          The host does not need it: Vue and Solid bring their own reactivity. The JSX adapter is
          built on it, and <code>element.bindProperty(name, signal, context)</code> keeps a property
          equal to a signal with no framework in between.
        </p>
      </Page>
    ),
  },
];
