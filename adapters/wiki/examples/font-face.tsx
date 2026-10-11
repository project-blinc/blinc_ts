import { asset } from '../assets.js';
import { useSheet } from '../kit.js';

const css = `
@font-face {
  font-family: WikiMono;
  src: url("${asset('fonts/wiki-mono.woff2')}") format('woff2');
  font-weight: 400;
  font-style: normal;
}
.font-examples { gap: 12px; font-size: 20px; }
.font-bundled { font-family: WikiMono, monospace; }
`;

export default function FontFace() {
  useSheet(css, 'font-face.css');
  return (
    <div class="wiki-col font-examples">
      <p>The system face: bundled fonts keep the app consistent.</p>
      <p class="font-bundled">Bundled Fira Code: 0123456789, != and =&gt;</p>
      <p class="font-bundled">
        A family inherited across <span>inline spans</span> and wrapped lines.
      </p>
    </div>
  );
}
