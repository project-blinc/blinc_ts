import { useSheet } from '../kit.js';

const css = `
.case-examples { gap: 12px; font-size: 20px; }
.case-upper { text-transform: uppercase; }
.case-lower { text-transform: lowercase; }
.case-capitalize { text-transform: capitalize; }
.case-original { text-transform: none; }
`;

export default function TextTransform() {
  useSheet(css, 'text-transform.css');
  return (
    <div class="wiki-col case-examples">
      <p class="case-upper">Uppercase: Straße and mixed Case</p>
      <p class="case-lower">LOWERCASE: KEEP THE SOURCE TEXT</p>
      <p class="case-capitalize">
        capitalize: a word can cross <span>inline</span> boundaries
      </p>
      <button class="case-capitalize" type="button">
        save my changes
      </button>
      <p class="case-upper">
        Inherited uppercase, <span class="case-original">with original Case here</span>
      </p>
    </div>
  );
}
