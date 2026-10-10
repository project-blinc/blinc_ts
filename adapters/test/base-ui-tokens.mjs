// The sheets say tokens: colours, spacing, type, shadows and motion come from the theme, and shape
// only through the radius tokens, so the theme's corner smoothing reaches every part. Only the
// size of a box has no token, and may be a length.
import assert from 'node:assert/strict';
import { colorTokens, themeVariables } from 'blinc_ts/theme';
import { baseUiCss } from '../dist/base-ui/sheet.js';
import { baseUiTheme } from '../dist/base-ui/theme.js';
import { wikiCss } from '../dist/wiki/sheet.js';

/** The declarations of a sheet, outside its keyframes, and those inside them. */
function declarations(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  // Blocks of @keyframes hold blocks of their own; a declaration is `name: value` in a leaf block.
  const leaf = /([^{}]+)\{([^{}]*)\}/g;
  for (const [, selector, body] of text.matchAll(leaf)) {
    for (const piece of body.split(';')) {
      const colon = piece.indexOf(':');
      if (colon > 0) {
        found.push({
          selector: selector.trim().split('\n').pop().trim(),
          name: piece.slice(0, colon).trim(),
          value: piece.slice(colon + 1).trim(),
        });
      }
    }
  }
  return found;
}

const NAMED = new Set(
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(
    ' ',
  ),
);

const COLOUR =
  /^(color|background(-color|-image)?|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|box-shadow|fill|stroke|text-decoration(-color)?)$/;
const SPACING =
  /^(padding|margin)(-(top|right|bottom|left))?$|^(gap|row-gap|column-gap|top|right|bottom|left)$/;
/** Where a hairline is allowed: a border or an outline, and a shadow that draws one. */
const HAIRLINE = /^(border(-(top|right|bottom|left))?|outline|box-shadow)$/;
const RAW_LENGTH = /(^|[\s(,-])(-?\d*\.?\d+)(px|em|rem|pt|vw|vh)\b/g;

/** The ways a declaration breaks the rule, if it does. */
function problems({ selector, name, value }) {
  const out = [];
  const bare = value.replace(/var\([^)]*\)/g, 'var');
  if (/^(corner-|smoothing-)/.test(name)) {
    out.push("shape is the theme's: a sheet sets no corner property");
  }
  if (COLOUR.test(name)) {
    if (/#[0-9a-f]{3,8}\b|\b(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/i.test(bare)) {
      out.push('a colour literal');
    }
    for (const word of bare.toLowerCase().split(/[^a-z-]+/)) {
      if (NAMED.has(word)) {
        out.push(`the colour name ${word}`);
      }
    }
  }
  if (
    /^border(-(top|right|bottom|left|top-left|top-right|bottom-left|bottom-right))?-radius$/.test(
      name,
    )
  ) {
    if (!/^(var\(--radius-[a-z0-9-]+\)\s*)+$/.test(value) && value !== '0') {
      out.push('a corner not from the radius tokens');
    }
  }
  if (
    SPACING.test(name) ||
    name === 'font-size' ||
    name === 'letter-spacing' ||
    name === 'line-height'
  ) {
    for (const m of bare.matchAll(RAW_LENGTH)) {
      if (Number(m[2]) !== 0) {
        out.push(`the raw length ${m[2]}${m[3]}`);
      }
    }
    if (
      /^(font-size|letter-spacing|line-height)$/.test(name) &&
      !/var/.test(bare) &&
      !/^(inherit|normal|0)$/.test(value)
    ) {
      out.push('type that is not a token');
    }
  }
  if (HAIRLINE.test(name)) {
    for (const m of bare.matchAll(RAW_LENGTH)) {
      // Hairlines and a rule's width; nothing that is a size of its own.
      if (Number(m[2]) > 3 || m[3] !== 'px') {
        out.push(`the raw length ${m[2]}${m[3]}`);
      }
    }
  }
  if (name === 'box-shadow' && !/^(none|var\(--shadow-[a-z0-9]+\))$/.test(value)) {
    out.push('a shadow that is not a shadow token');
  }
  if (name === 'font-family' && !/^var\(--font-[a-z]+\)$/.test(value)) {
    out.push('a face that is not a font token');
  }
  if (name === 'font-weight' && !/^var\(--font-[a-z]+\)$/.test(value)) {
    out.push('a weight that is not a font token');
  }
  if (name === 'transform' && /translate/.test(bare) && RAW_LENGTH.test(bare)) {
    out.push('a distance that is not a space token');
  }
  if (
    name === 'transition' ||
    name === 'animation' ||
    name.startsWith('transition-') ||
    name.startsWith('animation-')
  ) {
    if (
      /\b\d*\.?\d+m?s\b/.test(bare) ||
      /cubic-bezier|\b(ease|ease-in|ease-out|ease-in-out|linear)\b/.test(bare.replace(/var/g, ''))
    ) {
      out.push('motion that is not a duration or ease token');
    }
  }
  void selector;
  return out;
}

const variables = Object.keys(themeVariables(baseUiTheme.light));
const known = (css) => [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]);

for (const [name, css] of [
  ['the parts', baseUiCss],
  ['the wiki', wikiCss],
]) {
  const broken = declarations(css).flatMap((d) =>
    problems(d).map((why) => `${d.selector} { ${d.name}: ${d.value} }: ${why}`),
  );
  assert.deepEqual(broken, [], `${name}' sheet says only tokens:\n${broken.join('\n')}`);
  // And every token it names is one the theme has.
  const unknown = [...new Set(known(css))].filter((v) => !variables.includes(v));
  assert.deepEqual(unknown, [], `${name}' sheet names tokens the theme lacks: ${unknown}`);
}
assert.ok(declarations(baseUiCss).length > 150, 'the parts sheet was read');
assert.ok(colorTokens.length > 20);

// The rule has teeth: each of these is refused.
for (const bad of [
  ['color', '#ff0000'],
  ['background', 'rgb(0, 0, 0)'],
  ['border-color', 'red'],
  ['border-radius', '8px'],
  ['padding', '4px 8px'],
  ['gap', '10px'],
  ['font-size', '15px'],
  ['font-weight', '600'],
  ['transition', 'opacity 150ms ease'],
  ['animation', 'x 1s linear'],
  ['corner-smoothing', '0.5'],
  ['box-shadow', '0 10px 30px black'],
  ['box-shadow', 'inset 0 -1px 0 var(--border)'],
  ['box-shadow', 'var(--shadow-sm), 0 1px 2px var(--border)'],
  ['transform', 'translateX(16px)'],
]) {
  assert.ok(
    problems({ selector: '.x', name: bad[0], value: bad[1] }).length > 0,
    `${bad[0]}: ${bad[1]} is refused`,
  );
}
for (const good of [
  ['color', 'var(--text-primary)'],
  ['border', '1px solid var(--border)'],
  ['border-radius', 'var(--radius-lg)'],
  ['padding', '0 var(--space-3-5)'],
  ['transition', 'opacity var(--duration-fast) var(--ease-state)'],
  ['box-shadow', 'var(--shadow-md)'],
  ['box-shadow', 'none'],
  ['width', '480px'],
  ['transform', 'translateX(var(--space-4)) scale(0.92)'],
]) {
  assert.deepEqual(
    problems({ selector: '.x', name: good[0], value: good[1] }),
    [],
    `${good[0]}: ${good[1]} is allowed`,
  );
}
console.log('Base UI tokens: colours, spacing, type, shape and motion are tokens in both sheets');
