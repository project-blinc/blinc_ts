import { useSheet } from '../kit.js';

/** Every rule here is one feature of the engine, used on the element beside its name. */
export const featuresCss = `
.f-demo { flex-direction: row; gap: var(--space-1-5); align-items: center; }
.f-box {
  width: var(--space-8);
  height: var(--space-8);
  border-radius: var(--radius-md);
  background: var(--border);
}

/* Relationships: a child, and each box after another. */
.f-rel > .f-box + .f-box { background: var(--primary); }

/* Structure: odd children, and the last. */
.f-nth > :nth-child(odd) { background: var(--primary); }
.f-nth > :last-child { border-radius: var(--radius-full); }

/* Attributes: begins with, ends with, contains. */
.f-attr > [data-tone^="warn"] { background: var(--warning); }
.f-attr > [data-tone$="ok"] { background: var(--success); }
.f-attr > [data-tone*="err"] { background: var(--error); }

/* :has(): a row whose box is ticked. */
.f-has { padding: var(--space-1-5) var(--space-2-5); border: 1px solid var(--border); border-radius: var(--radius-md); }
.f-has:has(input:checked) { border-color: var(--success); background: var(--success-bg); }

/* Nesting with &. */
.f-nest {
  padding: var(--space-1-5) var(--space-3);
  border-radius: var(--radius-full);
  background: var(--accent-subtle);
  & > .f-dot { width: var(--space-2); height: var(--space-2); border-radius: var(--radius-full); background: var(--text-tertiary); }
  &:hover { background: var(--primary); color: var(--text-inverse); }
  &:hover > .f-dot { background: var(--text-inverse); }
}

/* A mixin with a default, included twice. */
@mixin chip($bg, $fg: var(--text-inverse)) {
  padding: var(--space-1) var(--space-2-5);
  border-radius: var(--radius-full);
  background: $bg;
  color: $fg;
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
}
.f-chip-a { @include chip(var(--primary)); }
.f-chip-b { @include chip(var(--warning-bg), var(--warning)); }

/* Media queries: the window's width, and the scheme. */
.f-wide { background: var(--success); }
@media (max-width: 1000px) { .f-wide { background: var(--warning); } }
.f-scheme { background: var(--warning); }
@media (prefers-color-scheme: dark) { .f-scheme { background: var(--info); } }

/* !important wins over a more specific rule. */
.f-important { background: var(--success) !important; }
.f-demo > .f-box.f-important { background: var(--error); }

/* var() with a fallback, for a variable nobody set. */
.f-fallback { background: var(--not-set, var(--info)); }
`;

function Row(props: { name: string; children?: unknown }) {
  return (
    <div class="wiki-row">
      <span class="wiki-chip-label">{props.name}</span>
      {props.children}
    </div>
  );
}

export default function CssFeatures() {
  useSheet(featuresCss, 'features.css');
  return (
    <div class="wiki-col">
      <Row name="a > b + c">
        <div class="f-demo f-rel">
          <div class="f-box" />
          <div class="f-box" />
          <div class="f-box" />
        </div>
      </Row>
      <Row name=":nth-child">
        <div class="f-demo f-nth">
          <div class="f-box" />
          <div class="f-box" />
          <div class="f-box" />
          <div class="f-box" />
          <div class="f-box" />
        </div>
      </Row>
      <Row name="[a^= $= *=]">
        <div class="f-demo f-attr">
          <div class="f-box" data-tone="warning" />
          <div class="f-box" data-tone="all-ok" />
          <div class="f-box" data-tone="an-error" />
        </div>
      </Row>
      <Row name=":has()">
        <label class="f-demo f-has">
          <input type="checkbox" />
          Tick me
        </label>
      </Row>
      <Row name="nesting &">
        <div class="f-demo f-nest">
          <div class="f-dot" />
          Hover me
        </div>
      </Row>
      <Row name="@mixin">
        <div class="f-demo">
          <span class="f-chip-a">Primary</span>
          <span class="f-chip-b">Warning</span>
        </div>
      </Row>
      <Row name="@media">
        <div class="f-demo">
          <div class="f-box f-wide" />
          <span class="wiki-hint">green over 1000px wide</span>
          <div class="f-box f-scheme" />
          <span class="wiki-hint">blue when dark</span>
        </div>
      </Row>
      <Row name="!important">
        <div class="f-demo">
          <div class="f-box f-important" />
        </div>
      </Row>
      <Row name="var(--x, y)">
        <div class="f-demo">
          <div class="f-box f-fallback" />
        </div>
      </Row>
    </div>
  );
}
