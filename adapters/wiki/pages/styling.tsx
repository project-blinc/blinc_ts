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
import ImagesBackgrounds from '../examples/images-backgrounds.js';
import ImagesEffects from '../examples/images-effects.js';
import ImagesFit from '../examples/images-fit.js';
import ImagesPeople from '../examples/images-people.js';
import Motion from '../examples/motion.js';
import Paint from '../examples/paint.js';
import GlassGallery from '../examples/glass-gallery.js';
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
          item's marker is. <code>z-index</code> is not read either: paint order is the tree's
          order, so what comes later is drawn over what came before. Units are px, <code>em</code>,{' '}
          <code>rem</code>, percentages and viewport units; <code>calc()</code> is not supported.
        </p>
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
          <code>calc()</code> or a percentage where none is allowed, is reported to{' '}
          <code>host.onStyleErrors</code> listeners with its reason, once, and the rest of its rule
          still applies. A property the engine does not know, <code>z-index</code> among them, is
          skipped without a report.
        </p>
        <Note>
          A sheet can also be compiled when the app is built, so the app loads bytes and never
          parses CSS at run time. <b>Builders and bundlers</b> under Tooling shows how.
        </Note>
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
      <Page title="Paint" lead="CSS is parsed in Rust and drawn by the GPU.">
        <p>
          Gradients, shadows, transforms, filters, masks, clips, glass and text decoration are
          written as CSS and drawn natively.
        </p>
        <Example name="paint" view={Paint} />
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
        lead="A change eases, and keyframes play, interpolated natively each frame."
      >
        <p>
          A property with a <code>transition</code> eases to its new value when it changes, whatever
          changed it. Keyframes animate on their own. Values are interpolated in native code and
          written to the node, so JavaScript only supplies the time.
        </p>
        <Example name="motion" view={Motion} />
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
