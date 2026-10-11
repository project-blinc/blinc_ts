/**
 * What a `canvas` element draws: GPU commands of its own, at its place in paint order, clipped,
 * transformed, faded and masked as the element is. A drawing prepares its pipelines and buffers
 * once for each renderer that draws the host, and paints each frame through it. A mounted host
 * gives its window's renderer; a renderer made by hand is given with `attach`.
 */
import { Scope } from '../hmr.js';
import type { CanvasPaint } from './canvas.js';
import type { Host, HostElement, HostNode } from './host.js';
import type { SceneRenderer } from './renderer.js';

export interface CanvasDrawing {
  /**
   * Make what painting needs on `renderer`'s device, such as a pipeline from
   * `renderer.createCanvasPipeline`, released with `scope`, and return the paint, which runs
   * synchronously at the canvas's place in each frame. Called once for each renderer.
   */
  prepare(renderer: SceneRenderer, scope: Scope): CanvasPaint;
}

interface Drawn {
  readonly slot: number;
  readonly drawing: CanvasDrawing;
}

interface Attached {
  /** What each canvas prepared for this renderer, ended when the canvas stops or the renderer goes. */
  readonly prepared: Map<HostElement, Scope>;
}

export class HostCanvases {
  readonly host: Host;
  readonly #drawn = new Map<HostElement, Drawn>();
  readonly #renderers = new Map<SceneRenderer, Attached>();
  readonly #free: number[] = [];
  #next = 0;

  constructor(host: Host) {
    this.host = host;
  }

  /** Draw `element`, a `canvas`, with `drawing` until it is stopped or the element destroyed. */
  draw(element: HostElement, drawing: CanvasDrawing): () => void {
    if (element.tag !== 'canvas') {
      throw new TypeError(`Only a canvas draws: <${element.tag}> does not`);
    }
    this.stop(element);
    const slot = this.#free.pop() ?? this.#next++;
    this.#drawn.set(element, { slot, drawing });
    element.layoutNode.setResource(slot, true);
    for (const [renderer, attached] of this.#renderers) {
      this.#prepare(renderer, attached, element);
    }
    return () => {
      if (this.#drawn.get(element)?.drawing === drawing) {
        this.stop(element);
      }
    };
  }

  /** Stop drawing `element`: what it prepared is released, and it draws nothing. */
  stop(element: HostElement): void {
    const drawn = this.#drawn.get(element);
    if (!drawn) {
      return;
    }
    this.#drawn.delete(element);
    for (const attached of this.#renderers.values()) {
      attached.prepared.get(element)?.dispose();
      attached.prepared.delete(element);
    }
    if (!element.destroyed) {
      element.layoutNode.setResource(null);
    }
    this.#free.push(drawn.slot);
  }

  /**
   * Draw the host's canvases in `renderer`'s frames, until the returned function is called or
   * `scope` ends. `Host.mount` does this for its window.
   */
  attach(renderer: SceneRenderer, scope?: Scope): () => void {
    const attached: Attached = { prepared: new Map() };
    this.#renderers.set(renderer, attached);
    for (const element of this.#drawn.keys()) {
      this.#prepare(renderer, attached, element);
    }
    let live = true;
    const detach = () => {
      if (!live) {
        return;
      }
      live = false;
      this.#renderers.delete(renderer);
      for (const prepared of attached.prepared.values()) {
        prepared.dispose();
      }
      attached.prepared.clear();
    };
    scope?.onCleanup(detach);
    return detach;
  }

  /** Ask for another frame, as a canvas that animates does from its paint. */
  requestFrame(): void {
    this.host.layout.changed('paint');
  }

  /** @internal A node is destroyed: a canvas under it stops. */
  forget(node: HostNode): void {
    for (const element of [...this.#drawn.keys()]) {
      for (let n: HostNode | null = element; n; n = n.parentNode) {
        if (n === node) {
          this.stop(element);
          break;
        }
      }
    }
  }

  #prepare(renderer: SceneRenderer, attached: Attached, element: HostElement): void {
    const drawn = this.#drawn.get(element)!;
    const scope = new Scope();
    try {
      const paint = drawn.drawing.prepare(renderer, scope);
      renderer.registerCanvas(drawn.slot, paint, scope);
    } catch (error) {
      scope.dispose();
      throw error;
    }
    attached.prepared.set(element, scope);
  }
}
