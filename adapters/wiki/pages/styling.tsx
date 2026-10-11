/** The wiki's Styling pages: CSS, the theme and its tokens, shape, utilities, and what is drawn. */
import {
  colorTokens,
  durations,
  easings,
  fontFamilies,
  fontWeights,
  letterSpacings,
  lineHeights,
  radiusTokens,
  shadowTokens,
  spacingTokens,
  textSizes,
} from 'blinc_ts/theme';
import { utilityClasses } from 'blinc_ts/theme/utilities';
import type { WikiPage } from '../page.js';
import { Example, Note, Page, SourceView, Table } from '../kit.js';
import CornerShapes from '../examples/corner-shapes.js';
import CssEditor from '../examples/css-editor.js';
import CssFeatures from '../examples/css-features.js';
import CssMath from '../examples/css-math.js';
import ImagesBackgrounds from '../examples/images-backgrounds.js';
import ImagesEffects from '../examples/images-effects.js';
import ImagesFit from '../examples/images-fit.js';
import ImagesPeople from '../examples/images-people.js';
import MotionExit from '../examples/motion-exit.js';
import MotionKeyframes from '../examples/motion-keyframes.js';
import MotionLayout from '../examples/motion-layout.js';
import MotionTiming from '../examples/motion-timing.js';
import PaintBorders from '../examples/paint-borders.js';
import PaintClips from '../examples/paint-clips.js';
import PaintFade from '../examples/paint-fade.js';
import PaintFilters from '../examples/paint-filters.js';
import PaintGradients from '../examples/paint-gradients.js';
import PaintShadows from '../examples/paint-shadows.js';
import PaintText from '../examples/paint-text.js';
import PaintTextOverflow from '../examples/paint-text-overflow.js';
import PaintTextShadow from '../examples/paint-text-shadow.js';
import PaintTransforms from '../examples/paint-transforms.js';
import GlassGallery from '../examples/glass-gallery.js';
import LayoutLab from '../examples/layout-lab.js';
import GlassLens from '../examples/glass-lens.js';
import GlassScroll from '../examples/glass-scroll.js';
import ThemeEditor from '../examples/theme-editor.js';
import ThemeTokens from '../examples/theme-tokens.js';
import UserAgent from '../examples/user-agent.js';
import Utilities from '../examples/utilities.js';

export const stylingPages: readonly WikiPage[] = [
  {
    id: 'css',
    title: 'CSS',
    section: 'Styling',
    view: () => (
      <Page
        title="CSS"
        lead="Stylesheets are parsed and applied by a native engine, one cascade for each layout."
      >
        <p>
          Every host has a layout, and every layout has a cascade. The host tells it what each
          element is: its tag, id, classes, attributes, states (hover, focus, checked and the rest)
          and its inline declarations. Each layout pass restyles what changed, parents first. Layout
          declarations go to the layout engine, paint declarations to the node's paint, and text,
          cursor and overflow come back to the host, which draws with them.
        </p>
        <h2>Write it, and see it applied</h2>
        <p>
          This sheet is added to the host that draws this page. Change it and apply it: the old
          sheet is taken out, the new one added, and what the parser could not read is listed with
          its line and column.
        </p>
        <Example name="css-editor" title="A stylesheet, live" view={CssEditor} />
        <h2>Adding and removing sheets</h2>
        <p>
          <code>layout.addStyleSheet(source, {'{ at, file }'})</code> takes CSS text, or the bytes a
          build step compiled, and returns the sheet with its diagnostics.{' '}
          <code>removeStyleSheet(sheet)</code> takes it out. Sheets apply in order, so a later sheet
          wins a tie of specificity; <code>at</code> puts one at a position instead. The user-agent
          sheet goes first, then a component library's, then the app's.
        </p>
        <SourceView
          file="wiki/snippets/stylesheets.ts"
          title="adapters/wiki/snippets/stylesheets.ts"
        />
        <h2>What the engine reads</h2>
        <Example name="css-features" title="One feature per row" view={CssFeatures} />
        <Table
          head={['Feature', 'Examples']}
          rows={[
            ['Selectors', <code>{'button, .card, #main, [data-open], *'}</code>],
            ['Relationships', <code>{'a b, a > b, a + b, a ~ b'}</code>],
            [
              'Attributes',
              <code>{'[a], [a="v"], [a~="v"], [a|="v"], [a^="v"], [a$="v"], [a*="v"]'}</code>,
            ],
            [
              'Structure',
              <code>
                {':root, :empty, :first-child, :last-child, :only-child, :nth-child(2n+1), ' +
                  ':nth-last-child(), :first-of-type, :nth-of-type()'}
              </code>,
            ],
            ['Logic', <code>{':is(), :where(), :not(), :has()'}</code>],
            [
              'States',
              <code>
                {':hover, :active, :focus, :focus-visible, :focus-within, :disabled, :enabled, ' +
                  ':checked, :indeterminate, :placeholder-shown, :valid, :invalid, :user-valid, ' +
                  ':user-invalid, :required, :optional'}
              </code>,
            ],
            [
              'Media',
              <code>
                {'(min-width), (max-width), (height), (aspect-ratio), (orientation), ' +
                  '(prefers-color-scheme), (prefers-reduced-motion)'}
              </code>,
            ],
            ['Organisation', <code>{'@import, nesting with &, @mixin and @include'}</code>],
            ['Weight', <code>{'!important, then specificity, then order'}</code>],
            ['Motion', <code>{'transition, animation, @keyframes'}</code>],
          ]}
        />
        <p>
          Pseudo-elements (<code>::before</code>, <code>::after</code>) are not supported: a part an
          element needs is an element the host owns, which a sheet styles by its class, as a list
          item's marker is. Units are px, <code>em</code>, <code>rem</code>, percentages and
          viewport units.
        </p>
        <h2>Lengths as expressions</h2>
        <p>
          <code>calc()</code> adds and subtracts lengths, or multiplies and divides one by a number.
          <code>min()</code>, <code>max()</code> and <code>clamp()</code> choose among lengths. They
          nest, read <code>var()</code>, and resolve relative units before layout. Put spaces around
          addition and subtraction: <code>calc(100vw - 2rem)</code>. A percentage alone, such as{' '}
          <code>calc(100% / 3)</code>, stays a percentage.
        </p>
        <Example name="css-math" title="A variable, held between two bounds" view={CssMath} />
        <Note>
          Mixed lengths such as <code>calc(100% - 32px)</code> and <code>min(50%, 200px)</code>
          resolve during layout, using the property's percentage basis. Font-size percentages use
          the inherited font size. Media-query lengths accept expressions in px, em and rem.
        </Note>
        <h2>Variables and the theme</h2>
        <p>
          <code>var()</code> reads a custom property from the element and its ancestors, then{' '}
          <code>:root</code> rules, then the theme's variables, with a fallback when none is set.
          The theme is not a sheet: <code>layout.setTheme</code> gives the variables{' '}
          <code>var()</code> falls back to, and <code>setColorScheme</code> answers{' '}
          <code>prefers-color-scheme</code>. The next page is about it. The viewport that media
          queries and viewport units read is the size the layout is laid out at, which a window
          keeps equal to its own.
        </p>
        <h2>When a value cannot be used</h2>
        <p>
          A sheet's syntax errors are its diagnostics. A value that cannot be applied, such as{' '}
          division by zero or a percentage where none is allowed, is reported to{' '}
          <code>host.onStyleErrors</code> listeners with its reason, once, and the rest of its rule
          still applies. A property the engine does not know is skipped without a report.
        </p>
        <Note>
          A sheet can also be compiled when the app is built, so the app loads bytes and never
          parses CSS at run time. <b>Builders and bundlers</b> under Tooling shows how.
        </Note>
      </Page>
    ),
  },
  {
    id: 'layout',
    title: 'Flexbox and grid',
    section: 'Styling',
    view: () => (
      <Page
        title="Flexbox and grid"
        lead="CSS's layout, computed natively: the box model, flexbox and grid."
      >
        <p>
          Every element is a flexbox row unless a sheet says otherwise, and the user-agent sheet
          stacks the flow containers in columns. Grid takes its templates and placement as CSS text.
          Sizes take pixels, percentages, <code>auto</code>, <code>min-content</code> and{' '}
          <code>max-content</code>, with their minimums and maximums; borders take room as CSS's box
          model has it. A change to layout is laid out before the next frame, and a transition of a
          length lays out at each value between.
        </p>
        <Example name="layout-lab" title="One property at a time" view={LayoutLab} />
        <p>
          Margins do not collapse between flex items, which is why the user-agent sheet gives half a
          browser's. <code>position: absolute</code> places a box against its nearest positioned
          ancestor, and paint order is tree order: what comes later is drawn on top, until{' '}
          <code>z-index</code> says otherwise.
        </p>
        <h2>Sticky and stacking</h2>
        <p>
          <code>position: sticky</code> holds a box in view of its nearest scrolling ancestor: with{' '}
          <code>top: 0</code> a section's header stays at the top of the box while the section
          scrolls, and goes up with the end of the section. It takes <code>top</code>,{' '}
          <code>right</code>, <code>bottom</code> and <code>left</code>, in pixels; it is laid out
          where it would be without them, and the hit test and <code>viewBounds()</code> follow
          where it is held.
        </p>
        <p>
          <code>z-index</code> takes an integer or <code>auto</code>. Among siblings, a negative one
          is drawn under the rest, the rest in tree order, then <code>0</code> and sticky boxes,
          then positive ones, highest last, and the hit test follows. Two limits: a box with no{' '}
          <code>z-index</code> keeps tree order whatever its <code>position</code>, and each box
          stacks only among its own siblings, as if it began a stacking context, so a nested one
          cannot rise over its ancestors' siblings. What must float over the whole page belongs in
          the top layer.
        </p>
      </Page>
    ),
  },
  {
    id: 'theme',
    title: 'Theme and tokens',
    section: 'Styling',
    view: () => (
      <Page
        title="Theme and tokens"
        lead="Named values that styles refer to, so a theme change restyles everything in place."
      >
        <p>
          A <b>token</b> is a named design value: a colour, a spacing step, a radius, a shadow, a
          type size, a duration. Styles refer to tokens through CSS variables, never to raw values,
          so one sheet serves every theme. A <code>Theme</code> gives every token a value for one
          scheme, light or dark, and a <code>ThemeBundle</code> pairs the two with any sheets that
          come with them.
        </p>
        <h2>The families</h2>
        <Table
          head={['Family', 'Variables', 'How many']}
          rows={[
            [
              'Colours',
              <code>--primary, --surface-elevated, --text-secondary</code>,
              colorTokens.length,
            ],
            ['Spacing', <code>--space-0-5 … --space-32</code>, spacingTokens.length],
            ['Radii', <code>--radius-sm … --radius-full</code>, radiusTokens.length],
            [
              'Shadows',
              <code>--shadow-sm, --shadow, --shadow-md … --shadow-inner</code>,
              shadowTokens.length,
            ],
            ['Type sizes', <code>--text-xs … --text-5xl</code>, textSizes.length],
            ['Weights', <code>--font-thin … --font-black</code>, fontWeights.length],
            ['Families', <code>--font-sans, --font-serif, --font-mono</code>, fontFamilies.length],
            ['Leading', <code>--leading-none … --leading-loose</code>, lineHeights.length],
            ['Tracking', <code>--tracking-tighter … --tracking-wider</code>, letterSpacings.length],
            ['Durations', <code>--duration-fastest … --duration-slowest</code>, durations.length],
            ['Easings', <code>--ease-out, --ease-state, --ease-spring</code>, easings.length],
            ['Shape', <code>--corner-smoothing, --corner-exponent, --corner-n</code>, 4],
          ]}
        />
        <Example
          name="theme-tokens"
          title="Every token, drawn by its variable"
          view={ThemeTokens}
        />
        <h2>Holding the theme: ThemeState</h2>
        <p>
          <code>ThemeState</code> holds the bundle, the scheme preference and any overrides in
          signals of a reactive context. <code>attach(layout)</code> keeps the layout's variables,
          its colour scheme and its corner smoothing equal to the theme, so a change restyles nodes
          in place through the cascade rather than rebuilding them.{' '}
          <code>followSystem(window)</code> takes the system's light or dark; <code>setScheme</code>{' '}
          chooses one; <code>override</code> puts single tokens over the bundle's in both schemes
          until <code>clearOverrides</code> or <code>setBundle</code>.
        </p>
        <Example name="theme-editor" title="Overrides on this window's theme" view={ThemeEditor} />
        <h2>Making a theme</h2>
        <p>
          blinc_ts ships no brand's palette. <code>neutralTheme</code> is a plain grey bundle for
          tests and examples, and an app makes its own: <code>defineTheme</code> from every family,
          or <code>extendBundle</code> and <code>extendTheme</code> for a variant that keeps what it
          does not change. <code>spacingScale</code>, <code>radiusScale</code>,{' '}
          <code>shadowScale</code>, <code>typographyScale</code> and <code>animationScale</code>{' '}
          make whole families. This wiki's monochrome theme is{' '}
          <code>adapters/base-ui/theme.ts</code>.
        </p>
        <SourceView file="wiki/snippets/theme.ts" title="adapters/wiki/snippets/theme.ts" />
        <p>
          <code>theme.theme</code> and <code>theme.variables</code> are computed values: an effect
          that reads a token runs again when it changes. <code>theme.color(token)</code>,{' '}
          <code>spacing</code>, <code>radius</code> and <code>shape</code> read one for code that
          draws by hand.
        </p>
      </Page>
    ),
  },
  {
    id: 'shape',
    title: 'Corner shape',
    section: 'Styling',
    view: () => (
      <Page
        title="Corner shape"
        lead="Rounded corners that are not only circles: squircles, bevels, scoops and notches."
      >
        <p>
          <code>corner-shape</code> takes <code>round</code>, <code>squircle</code>,{' '}
          <code>bevel</code>, <code>scoop</code>, <code>notch</code>, <code>square</code> or{' '}
          <code>superellipse(n)</code>, one to four values from the top-left corner, as{' '}
          <code>border-radius</code> takes its corners. <code>n</code> is 1 for a circle and 2 for a
          classic squircle; 0 is a bevel and below 0 curves in. The radius says how far the shape
          reaches, the shape how it bends. Fills, borders, shadows, glass and the clip a node's
          children get all follow it.
        </p>
        <Example name="corner-shapes" view={CornerShapes} />
        <h2>The theme's smoothing</h2>
        <p>
          A theme's shape tokens smooth every <code>round</code> corner that sets no shape of its
          own. <code>cornerSmoothing</code>, from 0 to 1, pulls the corner from a circle toward{' '}
          <code>cornerExponent</code>; corners smaller than <code>smoothingThreshold</code>, and
          those near a full circle or pill, stay round. <code>round locked</code> keeps a corner
          circular whatever the theme says. A sheet can set it for the whole tree with{' '}
          <code>
            :root {'{ corner-smoothing: 0.6; corner-exponent: 4; smoothing-threshold: 12px; }'}
          </code>
          .
        </p>
        <Note>
          A shape a rounded box cannot make, a menu flaring into its bar or a tooltip's arrow, is a{' '}
          <b>notch</b>, under Drawing.
        </Note>
      </Page>
    ),
  },
  {
    id: 'utilities',
    title: 'Utility classes',
    section: 'Styling',
    view: () => (
      <Page
        title="Utility classes"
        lead="Small classes made from the token names, each reading its token through a variable."
      >
        <p>
          <code>blinc_ts/theme/utilities</code> generates {utilityClasses.length} classes from the
          token families: colours (<code>bg-</code>, <code>text-</code> and <code>border-</code>{' '}
          with each colour's name), spacing (<code>p-</code>, <code>px-</code>, <code>m-</code>,{' '}
          <code>gap-</code>, <code>w-</code>, <code>h-</code>, <code>size-</code> and the rest with
          each step), radii (<code>rounded</code>, <code>rounded-lg</code>), shadows (
          <code>shadow</code>, <code>shadow-md</code>, <code>shadow-inner</code>), type (
          <code>text-lg</code>, <code>font-semibold</code>, <code>font-mono</code>,{' '}
          <code>leading-snug</code>, <code>tracking-wide</code>) and corner shapes (
          <code>corner-squircle</code>, <code>corner-round-locked</code>). One sheet serves every
          theme, and an app that does not import it pays nothing for it.
        </p>
        <Example name="utilities" view={Utilities} />
        <SourceView file="wiki/snippets/utilities.ts" title="adapters/wiki/snippets/utilities.ts" />
        <p>
          <code>classes(...)</code> takes only utility names, so a misspelt one is a compile error,
          and <code>utilityClasses</code> lists them all. A state or a scheme is a selector in an
          app's own sheet, which can be mixed with utilities in one <code>class</code>.
        </p>
      </Page>
    ),
  },
  {
    id: 'user-agent',
    title: 'User-agent styles',
    section: 'Styling',
    view: () => (
      <Page
        title="User-agent styles"
        lead="What plain elements look like before an app styles them, as a browser's own sheet does."
      >
        <p>
          Without a sheet, every element is a flex row with no look of its own: a <code>div</code>{' '}
          lays its children side by side and an <code>h1</code> is body text.{' '}
          <code>addUserAgent(layout)</code> from <code>blinc_ts/theme/user-agent</code> gives the
          built-in elements their defaults: flow containers stack in columns, text elements wrap on
          a baseline at a browser's relative sizes, and controls, tables, lists, dialogs and{' '}
          <code>details</code> get their looks, all from theme variables.
        </p>
        <Example name="user-agent" view={UserAgent} />
        <p>
          Every change it shows eases on the theme's motion tokens: hover and press colours, a focus
          ring growing out from no width, a press shrinking a control a little, a check mark popping
          in, a dialog growing in and shrinking away. Margins are half a browser's, because flex
          siblings do not collapse theirs.
        </p>
      </Page>
    ),
  },
  {
    id: 'paint',
    title: 'Paint',
    section: 'Styling',
    view: () => (
      <Page
        title="Paint"
        lead="What a box is drawn with: CSS read by the native engine and drawn by the GPU."
      >
        <p>
          Paint properties are read by the same engine as the rest of a sheet, so a value means the
          same in a sheet, an inline <code>style</code> and a compiled sheet. They are written to
          the node's paint, not its layout: a change to paint alone draws again without laying out.
          Every example here is CSS; its sheet is on the Source tab.
        </p>
        <h2>Backgrounds and gradients</h2>
        <Example name="paint-gradients" view={PaintGradients} />
        <p>
          <code>background</code> takes a colour, <code>linear-gradient()</code>,{' '}
          <code>radial-gradient()</code> (a circle or an ellipse reaching the farthest corner),{' '}
          <code>glass</code>, or a <code>url()</code>. Colours are hex, named, <code>rgb()</code>,{' '}
          <code>hsl()</code>, <code>color-mix(in srgb, …)</code>, <code>transparent</code> and{' '}
          <code>currentcolor</code>. A gradient is drawn from its first, middle and last stops;
          conic gradients are not drawn yet.
        </p>
        <h2>Borders and outlines</h2>
        <Example name="paint-borders" view={PaintBorders} />
        <p>
          A border takes layout space, as CSS's box model has it; <code>none</code> and{' '}
          <code>hidden</code> take it away and every other style draws solid. Widths and colours are
          per side, radii per corner. An outline is drawn outside the border and takes no space, so
          it can grow and move out without moving anything.
        </p>
        <h2>Shadows</h2>
        <Example name="paint-shadows" view={PaintShadows} />
        <p>
          <code>box-shadow</code> takes outer and <code>inset</code> layers, the first drawn on top.
          Shadows follow the box's radius and corner shape, and blend layer by layer in a
          transition.
        </p>
        <h2>Transforms</h2>
        <Example name="paint-transforms" view={PaintTransforms} />
        <p>
          <code>transform</code> takes the 2D functions, about the box's centre. A transformed box
          is hit where it is drawn, and what it holds turns with it. A transition blends by
          translation, rotation (the short way round), scale and skew.
        </p>
        <h2>Filters and masks</h2>
        <Example name="paint-filters" view={PaintFilters} />
        <p>
          <code>filter</code> takes <code>blur()</code>, <code>brightness()</code>,{' '}
          <code>contrast()</code>, <code>grayscale()</code>, <code>hue-rotate()</code>,{' '}
          <code>invert()</code>, <code>saturate()</code>, <code>sepia()</code> and{' '}
          <code>drop-shadow()</code>, which falls around what is drawn rather than the box.{' '}
          <code>mask-image</code> takes a gradient's alpha. A filter or a mask works on the box and
          everything in it as one layer, as <code>opacity</code> does, so overlapping children do
          not show through each other.
        </p>
        <h2>Clip paths</h2>
        <Example name="paint-clips" view={PaintClips} />
        <p>
          <code>clip-path</code> takes <code>circle()</code>, <code>ellipse()</code>,{' '}
          <code>inset()</code>, <code>rect()</code>, <code>xywh()</code>, <code>polygon()</code> and{' '}
          <code>path()</code> with SVG path data, in the box's own coordinates, so the shape turns
          with it. It clips what the box holds and where the pointer reaches it. Shapes of one kind
          blend in a transition.
        </p>
        <h2>Fading an edge</h2>
        <Example name="paint-fade" view={PaintFade} />
        <h2>Text decoration</h2>
        <Example name="paint-text" view={PaintText} />
        <p>
          <code>text-decoration</code> draws <code>underline</code>, <code>overline</code> and{' '}
          <code>line-through</code>, <code>solid</code>, <code>double</code>, <code>dotted</code> or{' '}
          <code>dashed</code>, in a colour and a thickness, with <code>text-underline-offset</code>,
          under every line of the text; its colour, thickness and offset transition.{' '}
          <code>wavy</code> is not drawn yet.
        </p>
        <h2>Text overflow and line clamp</h2>
        <Example name="paint-text-overflow" view={PaintTextOverflow} />
        <p>
          A line of text wider than its container ends with an ellipsis when the container says{' '}
          <code>text-overflow: ellipsis</code>, which wants <code>white-space: nowrap</code> and an{' '}
          <code>overflow</code> that clips. <code>line-clamp: 2</code>, or{' '}
          <code>-webkit-line-clamp</code>, holds the text under a container to that many lines, the
          box as tall as they are, and ends the last with an ellipsis; <code>none</code> lets go.
          Both are read on the container and found by its text through any boxes between, and the
          text itself, <code>textContent</code> and selection, is untouched. Text in an inline flow
          (spans, links) is the host's, and not ellipsized.
        </p>
        <h2>Text shadow</h2>
        <Example name="paint-text-shadow" view={PaintTextShadow} />
        <p>
          <code>text-shadow</code> takes an offset, an optional blur and a colour, the text's own
          when it is left out, and as many shadows as a comma separates, the first drawn on top. It
          shadows the text's decorations too, and an emoji casts its shape in the shadow's colour.
          It is inherited, so a parent can set it for all its text, and <code>none</code> takes it
          away; a blurred shadow is clipped where its text is, and it transitions shadow by shadow.
          The theme's <code>text-shadow-sm</code>, <code>-md</code> and <code>-lg</code> take the
          colour of its shadows of the same size.
        </p>
        <Note>
          Glass and <code>backdrop-filter</code>, which draw from what is behind a box, have a page
          of their own: <b>Liquid glass</b>.
        </Note>
      </Page>
    ),
  },
  {
    id: 'glass',
    title: 'Liquid glass',
    section: 'Styling',
    view: () => (
      <Page
        title="Liquid glass"
        lead="A surface made of what is behind it: bent at its rim, blurred, tinted and lit."
      >
        <p>
          Glass is drawn from what was painted before it in its layer. <b>Liquid</b> glass bends
          that backdrop along the normal of its edge, inside a rim whose width and strength are its{' '}
          <code>glass-bevel</code>, parts its colours there by <code>glass-aberration</code>, then
          blurs and tints it. <b>Frosted</b> glass only blurs and tints. Both follow the box's
          radius and corner shape, and both are live: what moves behind them is seen moving through
          them.
        </p>
        <p>
          The bending is in the rim, so it shows when the glass is close to clear and what is behind
          it has edges: lines, letters, the border of a photograph. A heavy blur hides it; use one
          for frosted panels, not for a lens.
        </p>
        <Example name="glass-lens" title="A lens to drag, every setting a dial" view={GlassLens} />
        <Example
          name="glass-scroll"
          title="Bars over a page that scrolls under them"
          view={GlassScroll}
        />
        <h2>Every kind</h2>
        <p>
          Blur from none to heavy; frosted glass tinted from clear to dark; a colour over a{' '}
          <code>backdrop-filter</code>; liquid glass light, round and tinted; and the rim's colour
          separation at 0, 0.3 and 1, bending the line above it.
        </p>
        <Example
          name="glass-gallery"
          title="Every kind of glass, over the same backdrop"
          view={GlassGallery}
        />
        <h2>The properties</h2>
        <Table
          head={['Property', 'Takes', 'Default']}
          rows={[
            [<code>background: glass</code>, 'turns it on', ''],
            [<code>glass-mode</code>, <code>liquid | frosted</code>, <code>liquid</code>],
            [<code>glass-blur</code>, 'a length', <code>12px</code>],
            [
              <code>glass-tint</code>,
              'a colour, its alpha the strength',
              <code>rgba(255,255,255,0.1)</code>,
            ],
            [<code>glass-bevel</code>, '0 to 1, or a percentage', <code>1</code>],
            [<code>glass-aberration</code>, '0 to 1, or a percentage', <code>0.3</code>],
            [<code>glass-curvature</code>, <code>outset | inset</code>, <code>outset</code>],
            [<code>glass-noise</code>, '0 to 1, or a percentage', <code>0</code>],
          ]}
        />
        <p>
          <code>backdrop-filter</code> is the other way to see through a box: <code>blur()</code>{' '}
          with the colour filters, applied to what is behind it before its own background is painted
          over it, and eased by a transition. A brush says what CSS does not yet: saturation,
          brightness and a rim of its own.
        </p>
        <SourceView file="wiki/snippets/glass.ts" title="adapters/wiki/snippets/glass.ts" />
      </Page>
    ),
  },
  {
    id: 'motion',
    title: 'Motion',
    section: 'Styling',
    view: () => (
      <Page
        title="Motion"
        lead="Transitions, keyframes, springs and layout animation, interpolated natively each frame."
      >
        <p>
          Motion is CSS's: a <code>transition</code> eases a property to its new value whatever
          changed it, and <code>animation</code> plays <code>@keyframes</code>. Values are
          interpolated in native code and written to the node, so JavaScript supplies only the time.
          A mounted host ticks every frame while something in view moves and asks for none once
          nothing does; motion out of view keeps its clock and draws nothing.
        </p>
        <h2>Timing</h2>
        <Example name="motion-timing" title="One move, timed seven ways" view={MotionTiming} />
        <p>
          Timing functions are CSS's keywords, <code>cubic-bezier()</code>, <code>steps()</code> and{' '}
          <code>linear()</code>, and <code>spring(mass stiffness damping [velocity])</code>. A
          spring runs until it settles, whatever duration it is given, and one turned back mid-way
          keeps its momentum. A change to a transitioned property runs from the value shown, so a
          hover that ends half-way turns back from where it is. The theme's{' '}
          <code>--ease-spring</code> is a spring.
        </p>
        <p>
          What blends: colours (premultiplied), <code>opacity</code>, radii, outlines, shadows layer
          by layer, transforms, filters, gradients of one shape, clip paths of one kind,{' '}
          <code>overflow-fade</code>, <code>backdrop-filter</code> and text decoration's colour,
          thickness and offset; lengths such as <code>width</code>, <code>padding</code> or{' '}
          <code>gap</code> when both ends are in one unit, laid out at each value between. What does
          not blend flips half-way. A node's first style is not a change, so nothing runs as it
          appears.
        </p>
        <h2>Keyframes</h2>
        <Example name="motion-keyframes" view={MotionKeyframes} />
        <p>
          A stop's own <code>animation-timing-function</code> is read, a property a block leaves out
          at <code>from</code> or <code>to</code> starts or ends at the node's style, and fill
          modes, delays, iteration counts, directions and <code>animation-play-state</code> work as
          CSS has them. A keyframe's <code>var()</code>s read the theme, and a running animation
          follows a theme change.
        </p>
        <h2>Layout animation</h2>
        <Example name="motion-layout" title="Cards that make room" view={MotionLayout} />
        <p>
          <code>element.animateLayout(options)</code> animates where layout puts an element: when
          its place or size changes, layout settles at once and the element is drawn where it was,
          easing to where it is, nothing laid out again for it. A child carried by an animated
          parent does not move twice, and a change mid-move starts from where it is drawn. Options
          are <code>position</code> and <code>size</code>, <code>duration</code> and{' '}
          <code>easing</code>; <code>null</code> stops it. Use it for what layout moves, a list
          making room or a panel opening; a <code>transform</code> transition is cheaper for what
          only moves in paint, as a switch's knob does.
        </p>
        <h2>Exits</h2>
        <Example name="motion-exit" title="Toasts that leave" view={MotionExit} />
        <p>
          <code>element.animationsFinished()</code> resolves when an element's transitions and
          animations have ended, and an element with a layout animation waits for the layout that
          starts its move. That is how a component plays its exit: mark it closing, await this, then
          remove it.
        </p>
        <Note>
          Motion is checked frame by frame in <code>tests/native-motion.mjs</code>, and in a real
          window in <code>tests/native-motion-window.mjs</code>;{' '}
          <code>npm run snapshot -- motion</code> captures a scene's frames with curves of every
          track.
        </Note>
      </Page>
    ),
  },
  {
    id: 'images',
    title: 'Images',
    section: 'Styling',
    view: () => (
      <Page
        title="Images"
        lead="Decoded off the main thread, kept once however often they are used, and drawn at the size they cover."
      >
        <p>
          An <code>img</code> loads its <code>src</code>, and a <code>background-image: url()</code>{' '}
          its source: a path (from the host's <code>images.base</code>, else the working directory),
          a <code>file:</code>, <code>http:</code> or <code>https:</code> URL, or a{' '}
          <code>data:</code> URL, in PNG, JPEG, WebP or SVG. What a file is comes from its bytes,
          read and decoded on a worker thread so a large image does not hold up a frame. A source is
          loaded once however many elements name it, and let go with the last.
        </p>
        <h2>Fitting a frame</h2>
        <Example name="images-fit" view={ImagesFit} />
        <p>
          With no size from style, an image is its own size, the <code>width</code> and{' '}
          <code>height</code> attributes shaping it and its aspect ratio filling in a side given
          neither; style, even a class's, wins over all of that. <code>object-fit</code> is{' '}
          <code>fill</code> (the default), <code>contain</code> or <code>cover</code>, about the
          centre.
        </p>
        <h2>In an interface</h2>
        <Example name="images-people" title="Avatars, a stack and a profile" view={ImagesPeople} />
        <h2>Backgrounds</h2>
        <Example name="images-backgrounds" view={ImagesBackgrounds} />
        <p>
          <code>background-size</code> is <code>cover</code>, <code>contain</code>,{' '}
          <code>100% 100%</code> (stretched), or left out, which repeats the image at its own size.
          An SVG keeps its aspect ratio wherever it is drawn.
        </p>
        <h2>Paint on photographs</h2>
        <Example name="images-effects" title="Hover each to ease it back" view={ImagesEffects} />
        <p>
          An image is a box like any other, so filters, clip paths, masks, corner shapes and shadows
          apply to it, and transition. Each image is resampled to the size it covers on screen, in
          steps of a twelfth of an octave so a zoom reuses what it made, and packed in one atlas.
        </p>
        <Note>
          The element fires <code>load</code> or <code>error</code> once it has the image or cannot.
          Nothing is drawn, and no room taken, until it has loaded.{' '}
          <code>await host.images.idle()</code> waits until nothing is loading.
        </Note>
      </Page>
    ),
  },
];
