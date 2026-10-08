import { probeShader } from '../../../dist/renderer/shaders.js';
export const shader = probeShader;
export function create() {
  return {
    frame() {
      return {
        groups: [],
        debug: {
          layers: [
            {
              id: 'gradient',
              name: 'Fullscreen gradient',
              bounds: { x: 0, y: 0, width: 1, height: 1 },
            },
          ],
        },
      };
    },
    dispose() {},
  };
}
