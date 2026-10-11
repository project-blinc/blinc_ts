import { useSheet } from '../kit.js';

const css = `
.d-col { gap: 14px; font-size: 20px; }
.d-under { text-decoration: underline; text-underline-offset: 4px; }
.d-double { text-decoration: underline double #6366f1; }
.d-dotted { text-decoration: underline dotted #ec4899 2px; }
.d-dashed { text-decoration: underline dashed #f59e0b 2px; text-underline-offset: 6px; }
.d-over { text-decoration: overline #0ea5e9 2px; }
.d-through { text-decoration: line-through #ef4444 3px; }
.d-grow {
  text-decoration: underline var(--primary) 1px;
  text-underline-offset: 3px;
  transition: text-decoration-thickness var(--duration-normal) var(--ease-out),
    text-underline-offset var(--duration-normal) var(--ease-spring);
}
.d-grow:hover { text-decoration-thickness: 4px; text-underline-offset: 7px; }
`;

export default function PaintText() {
  useSheet(css, 'text.css');
  return (
    <div class="wiki-col d-col">
      <span class="d-under">underline, offset 4px</span>
      <span class="d-double">double, in a colour</span>
      <span class="d-dotted">dotted, 2px</span>
      <span class="d-dashed">dashed, further below</span>
      <span class="d-over">overline</span>
      <span class="d-through">line-through, 3px</span>
      <span class="d-grow">hover me: thickness and offset ease</span>
    </div>
  );
}
