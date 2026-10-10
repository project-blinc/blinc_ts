/** The few glyphs the parts draw, as images that take the colour of the text around them. */
import type { JsxNode } from '#jsx/jsx-runtime';
import { merge, type PartProps } from './props.js';

const svg = (path: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`,
  )}`;

const CHEVRON = svg('M4 6l4 4 4-4');
const CHECK = svg('M3.5 8.5 6.5 11.5l6-7');
const SUN = svg(
  'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M3.4 12.6l.85-.85M11.75 4.25l.85-.85',
);
const MOON = svg('M13.5 9.6A5.7 5.7 0 0 1 6.4 2.5a5.7 5.7 0 1 0 7.1 7.1z');

/**
 * A chevron that points down and turns over while what it is in is open: the sheet turns it
 * with its trigger's `data-panel-open`, easing over the theme's motion.
 */
export function Chevron(props: PartProps): JsxNode {
  return (
    <span {...merge({ class: 'bui-chevron', 'aria-hidden': 'true' }, props)}>
      <img src={CHEVRON} />
    </span>
  );
}

/** A sun, for a switch's knob while it is off: day. Give it `bui-thumb-unchecked`. */
export function Sun(props: PartProps): JsxNode {
  return <img {...merge({ class: 'bui-icon', src: SUN }, props)} />;
}

/** A moon, for a switch's knob while it is on: night. Give it `bui-thumb-checked`. */
export function Moon(props: PartProps): JsxNode {
  return <img {...merge({ class: 'bui-icon', src: MOON }, props)} />;
}

/** A check mark, for a checkbox's indicator. */
export function Check(props: PartProps): JsxNode {
  return <img {...merge({ class: 'bui-icon', src: CHECK }, props)} />;
}
