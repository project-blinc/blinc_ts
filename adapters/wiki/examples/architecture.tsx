import { signal } from '#jsx/owner';
import { useSheet } from '../kit.js';

// The layers of a Blinc app, top to bottom, drawn with the SDK they describe. Choose one to see
// what it does and where it is.
const css = `
.arch { flex-direction: row; gap: 28px; align-items: flex-start; }
.arch-stack { width: 300px; flex-shrink: 0; gap: 6px; }
.arch-layer {
  height: 46px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: none;
  color: var(--text-primary);
  font-weight: 600;
  transition: background var(--duration-fast) var(--ease-state), transform var(--duration-normal) var(--ease-spring);
}
.arch-layer:hover { background: var(--input-bg-hover); transform: translateX(4px); }
.arch-layer[data-active] { background: var(--primary); border-color: var(--primary); color: var(--text-inverse); transform: translateX(8px); }
.arch-where { font-family: var(--font-mono); font-size: var(--text-xs); font-weight: 400; opacity: 0.7; }
.arch-arrow { align-self: center; color: var(--text-tertiary); font-size: 12px; height: 10px; }
.arch-detail { width: 340px; flex-shrink: 0; gap: 8px; padding: 18px; border-radius: var(--radius-xl); background: var(--accent-subtle); }
.arch-detail-title { font-size: var(--text-lg); font-weight: 700; }
`;

const layers = [
  [
    'Your view',
    'JSX, Vue, …',
    'Components, written however a framework writes them. It knows nothing of Blinc; its adapter does.',
  ],
  [
    'Adapter',
    'adapters/',
    'Turns a framework’s view into calls on the host: create, insert, set a property, listen. The JSX runtime and the Vue renderer are two.',
  ],
  [
    'Host',
    'blinc_ts/native/host',
    'A tree of elements as a document has it: events, focus, input, scrolling, and what built-in elements do. It batches every edit of a tick into one native call.',
  ],
  [
    'Layout, CSS, motion',
    'blinc_abi',
    'The native engine, in Rust: the cascade, flexbox and grid, text shaping, transitions, keyframes and layout animation, hit testing. It writes a display list.',
  ],
  [
    'Renderer',
    'blinc_ts/native/renderer',
    'Draws the display list with TypeGPU shaders: boxes, borders, shadows, text, images, layers, filters, backdrops, glass and canvases.',
  ],
  [
    'GPU and window',
    'xgpu, xwindow',
    'WebGPU through wgpu, and a native window with its event loop, on Node’s main thread beside libuv.',
  ],
] as const;

export default function Architecture() {
  useSheet(css, 'architecture.css');
  const chosen = signal(2);
  return (
    <div class="arch">
      <div class="arch-stack">
        {layers.map(([name, where], i) => [
          <button
            class="arch-layer"
            data-active={() => (chosen.get() === i ? '' : undefined)}
            onClick={() => chosen.set(i)}
          >
            <span>{name}</span>
            <span class="arch-where">{where}</span>
          </button>,
          i < layers.length - 1 ? <span class="arch-arrow">▼</span> : null,
        ])}
      </div>
      <div class="arch-detail">
        <span class="arch-detail-title">{() => layers[chosen.get()]![0]}</span>
        <span class="wiki-mono">{() => layers[chosen.get()]![1]}</span>
        <span>{() => layers[chosen.get()]![2]}</span>
      </div>
    </div>
  );
}
