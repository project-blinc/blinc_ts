# Base UI parts

`adapters/base-ui` is a set of components in the manner of Base UI, built on the reactive JSX
runtime (`adapters/jsx`, see [native.md](native.md#host-interface-for-frameworks)). It is a worked
example of an adapter on the host interface and the base of the wiki, not a library: it covers
what the wiki needs. Mount a view that uses it with the user-agent sheet, the parts' sheet over it
and a theme:

```tsx
import { mount } from '#jsx/jsx-runtime';
import { Tabs, addBaseUi, baseUiTheme } from '../base-ui/index.js';

const state = new ThemeState(context, baseUiTheme, { scheme: 'light' });
state.attach(host.layout);
addUserAgent(host.layout);
addBaseUi(host.layout);
mount(host, <Tabs.Root defaultValue="a">…</Tabs.Root>, { context });
```

## The wiki

`npm run wiki` opens the wiki in a window: a navigation column beside pages of prose, each with
live examples beside the source that makes them (`adapters/wiki/examples`). It is built from these
parts and the elements the host gives, so it is also the larger example of them. Its pages are
`adapters/wiki/pages.tsx`; a new example is a file in `examples` and an `Example` on a page. The
scheme switch under the navigation is a `Switch` with a day and night icon on its knob.
`adapters/test/wiki.mjs` renders every page offscreen to `.blinc/wiki/`.

## Conventions

- **Parts draw nothing.** Each part is an element with a class (`bui-tabs-tab`) and the state it
  is in as `data-` attributes, which `addBaseUi`'s sheet styles from the theme's variables. An app
  restyles a part by that class or attribute, since its own sheets come after. A `class`, `style`,
  `ref` or handler given to a part is added to the part's own, the handler after it; anything
  else given wins over what the part set.
- **State is shared as a signal.** `value`/`defaultValue`, `open`/`defaultOpen`, `checked`/
  `defaultChecked` and `pressed`/`defaultPressed` follow Base UI. A signal as the controlled prop
  is read and written, so the component and the code around it share it. A computed value or a
  function is only read: the component asks for a change through `onValueChange` (and the like),
  and the user decides. A constant is the value held. With none, the component holds its own,
  from the default. A write by the user's own code is not reported back to it.
- **State shows as attributes**, present and empty when true: `data-checked` and
  `data-unchecked`, `data-pressed`, `data-open` and `data-closed`, `data-panel-open` on a
  trigger, `data-active` on the chosen tab, `data-disabled`, `data-orientation`, `data-side` on a
  popup. They also set `role` and `aria-` attributes, for the accessibility tree to come.
- **Parts talk through context.** A root provides what its parts read, so a part outside its root
  is an error that says so. Keys: Enter and Space click a focused button, since the parts are
  buttons, and a click on a disabled one does nothing.

## Character

The parts have depth and motion, in a monochrome palette.

- **Tokens only.** `sheet.ts` and the wiki's sheet say only the theme's tokens: colours, spacing
  (`--space-*`), type (`--text-*`, `--font-*`, `--leading-*`), shadows (`--shadow-*`) and motion
  (`--duration-*`, `--ease-*`). Only the size of a box, which has no token, is a length.
  `adapters/test/base-ui-tokens.mjs` refuses a raw colour, space, type size, weight or duration.
- **Shape is the theme's.** A corner is `var(--radius-*)` and nothing else, and a sheet sets no
  `corner-*` property, so the theme's corner smoothing reaches every part. The showcase test turns
  smoothing off and requires an accordion's corner to change.
- **Shadows where a surface stands.** An outline button, the knob of a switch and a tooltip stand on
  `--shadow-sm`; an accordion and a popover on `--shadow-md`; a dialog on `--shadow-xl`; what is
  flat has none, and a disabled button or knob loses its shadow.
- **Everything that changes eases.** Colours and borders ease over `--duration-fast`; a press
  shrinks a button; a switch's knob slides to the other end by layout, with a day and a night
  icon (`Sun`, `Moon`) that turn into each other (`size="lg"`, and `bui-thumb-unchecked` or
  `bui-thumb-checked` on the icons); a check mark pops in; `Chevron` turns over with its trigger
  (the accordion and collapsible triggers have one, `chevron={false}` for none); a panel is
  built while it folds away and eases between its height and none; a segmented tab list's raised
  pill (`variant="underline"` for a bar instead) slides to the chosen tab; popups ease in from
  where they are.
  `adapters/test/base-ui-motion.mjs` catches each partway between its two states.

## The parts

| Component     | Parts                                                       | Holds                                  | Keys                                              |
| ------------- | ----------------------------------------------------------- | -------------------------------------- | ------------------------------------------------- |
| `Toggle`      | itself                                                      | `pressed`                              | Enter, Space                                      |
| `Switch`      | `Root`, `Thumb`                                             | `checked`                              | Enter, Space                                      |
| `Checkbox`    | `Root`, `Indicator` (`keepMounted`)                         | `checked`, `indeterminate`             | Enter, Space                                      |
| `Collapsible` | `Root`, `Trigger`, `Panel` (`keepMounted`)                  | `open`                                 | Enter, Space                                      |
| `Accordion`   | `Root`, `Item`, `Header`, `Trigger`, `Panel`                | `value` (open item values), `multiple` | Up, Down (Left, Right when horizontal), Home, End |
| `Tabs`        | `Root`, `List`, `Tab`, `Panel`                              | `value`, `orientation`                 | arrows, Home, End; `activateOnFocus`              |
| `Tooltip`     | `Root`, `Trigger`, `Popup`                                  | `open`, `delay`, `closeDelay`          | Escape                                            |
| `Popover`     | `Root`, `Trigger`, `Popup`, `Close`, `Title`, `Description` | `open`                                 | Escape                                            |
| `Dialog`      | `Root`, `Trigger`, `Popup`, `Close`, `Title`, `Description` | `open`, `modal`, `dismissible`         | Escape, Tab kept inside                           |

A panel is built only while it is open or chosen, unless `keepMounted`, and is `hidden`
otherwise (the user-agent sheet gives `[hidden]` no room). A switch, a checkbox and a tab have a
`disabled` that skips them: a disabled tab is passed over by the arrows.

An overlay's `Popup` renders nothing where it is written: while open its element is built into
the host's top layer, placed beside the trigger (`side`, `align`, `sideOffset`, `alignOffset` on
the popup) or in the middle for a dialog, and gone, with what it made, once it has closed.
Escape, a press outside and `Close` all close it and update the held state. A tooltip opens
after `delay` ms of hover or at once on keyboard focus (not on a press or a script's `focus()`)
and takes no presses. A popover and a dialog move focus to their first control and give it back
to the trigger as they close; a dialog dims what is beneath and keeps Tab inside. A trigger is
the anchor, so it is built before its popup in the tree.

Not yet: a form value for a switch, a checkbox or a radio (they hold no `name`), radio groups,
menus, a select, a toast and a navigation menu, and the parts' accessibility tree.
