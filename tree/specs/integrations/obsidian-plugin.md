---
aliases: ["Solenoid Properties (the Obsidian plugin)"]
tags: [spec, integrations]
---
<!-- [[C107]] obsidianPlugin, [[B3]] sameNodeEverywhere, [[B1]] obsidianBet; covers: obsidian-plugin/vite.config.ts, obsidian-plugin/src/*.ts, obsidian-plugin/src/*.tsx, obsidian-plugin/src/shims/*.ts -->

# Spec: Solenoid Properties (the Obsidian plugin)

Serves [[C107]] obsidianPlugin. The plugin adds every Solenoid object type that YAML can hold to
Obsidian's properties: each one shows as the app's chip and opens the app's popup editor, and the
note keeps plain YAML. This spec is what the plugin has, how it is built, and every place it
differs from the full app. A divergence lives here under the rule it bends, with what would remove
it ([[C5]] exceptionsUnderRule).

## What it has

**Thirteen property types.** One per container rung of the socket lattice
([[socket-lattice]]): the list and the matrix of each of the five element families, the
frame and the cube; and one scalar, Complex, the only element family Obsidian has no type for
(Number, Text, Date and Checkbox are its own). The type id is `solenoid-` plus the socket variant, so
`.obsidian/types.json` names a socket by identity; the name is the socket legend's.

| Type id | Name in Obsidian | YAML in the note | Chip | Editor |
|---|---|---|---|---|
| `solenoid-complex` | Complex | `a+bi` text, or a number | none: a plain text field, in Obsidian's own style | typed in place; Enter or blur commits, Escape reverts, and text that is not a complex number is refused (marked, never written) |
| `solenoid-list` | Numeric List | sequence of numbers | `[N× List]` | one-column raw grid |
| `solenoid-strlist` | String List | sequence of text | same, string tint | same |
| `solenoid-datelist` | Date List | sequence of ISO dates | same, date tint | same |
| `solenoid-complexlist` | Complex List | sequence of `a+bi` text | same, complex tint | same |
| `solenoid-logicallist` | Boolean List | sequence of `true` / `false` | same, logical tint | same |
| `solenoid-table`, `-strtable`, `-datetable`, `-complextable`, `-logicaltable` | Numeric / String / Date / Complex / Boolean Matrix | sequence of sequences | `[R×C Table]` in the family's matrix shade | Table Input's raw grid |
| `solenoid-frame` | Frame | sequence of `key: value` maps, scalar values | `[R×C Frame]` | Frame Input's literal-source editor (Grid, Form, CSV, Source toggle, column types, sort, summary footer) |
| `solenoid-cube` | Cube | sequence of maps whose values may be lists or rows | `[R×C×D Cube]` | Cube Input's drill-stack editor |

**The Solenoid look.** One more setting, a toggle, off until the user turns it on, dresses
Obsidian itself in Solenoid's palette and the accent chosen above. [[#The look]] is how it works.

**Bases.** A Bases table draws a typed property through the same widget, so a cell shows the chip
and a press opens the same editor (as of Obsidian 1.13.7; a narrow column clips the chip until it
is widened).

**Type icons.** A list or matrix wears its element family's icon, Obsidian's own: Number's
`lucide-binary`, Text's `lucide-text`, Date's `lucide-calendar`, Checkbox's
`lucide-check-square`. The chip already says list or table, so the icon says what is in it.
Complex has no Obsidian counterpart and takes `lucide-radical`, the root of minus one. A frame and
a cube keep their socket glyph's outline (from `SocketLegend.tsx` and `cubeGlyph.tsx`), drawn in
`currentColor` on the icon slot's 100-unit box and registered with `addIcon` (`icons.ts`).

**A settings page** laid out as the app's own palette row: the Color palette choice (the
built-in palettes, persisted in the plugin's `data.json`, which also holds the accent and the frame
column types below) with the app's accent picker stacked under it: the toolbar's `SwatchGrid`, the
twelve slots and the gray swatch's neutral cycle, following the palette. The accent is a slot
id, gold by default; the chips' sheet (`shadow.ts`) and the look wear it. One more item,
"Solenoid", carries two links and no prose: the app's deploy and its GitHub repository, each shown
as its URL, which never breaks inside itself; on a phone the links stack. The manifest description
is one sentence naming the four shapes. Both follow DESIGN.md § 7: nothing explains how to use a
control. The page shows no sample chips ([[C107]] obsidianPlugin).

**Everything the popups do without a graph:** cell and header editing, add and remove rows and
columns, the column type cycle, visual sort, the CSV view, Copy, Copy as Markdown, Export CSV,
the summary footer and its per-column stat, freeze header, the resize grip, the cube breadcrumb
and drill levels, Escape semantics.

## The look

The look's rules have one source, `obsidian-plugin/src/look.css`, and it authors no hex.
`lookTokens.ts` derives every color token (`--sol-*`, Obsidian's `--color-*-rgb`, the accent's HSL)
from `palette.ts` the way the chips' tokens are derived (`themeVars`: the socket shades, the chrome
ramp or the app's neutral one, the adaptive ramps, light mode darkened once). A palette swap
therefore changes values only, and the look's own formulas (inks, rules, washes) stand under
every palette. A palette that authors no chrome ramp leaves the chrome null, where the app's own
`App.css` answers.

**The build.** It scopes every rule under `body.solenoid-look` into the plugin's `styles.css`; a
rule on `.theme-*` or a platform class (`.is-mobile`, `.is-phone`, `.is-tablet`) joins the body's
class rather than nesting under it. It appends one token block per built-in palette and mode under
`body.solenoid-look.solenoid-palette-<name>.theme-<mode>`, then one per palette, accent and mode
under `.solenoid-accent-<slot>` too, carrying what the accent moves: its color, its ink, its HSL,
the accent as text, and, for an adaptive palette (Orchard and Blueprint), the chrome ramp, which
follows the accent's hue as in the app (`CHROME_HOME`). The same build writes `look.css` plus the
Default palette's two blocks, under the gold accent, to `demo-vault/.obsidian/snippets/solenoid.css`
(a snippet cannot follow a setting). The plugin has no automated tests; keeping the snippet in step
with the build is a manual check. It targets Obsidian 1.13's variables (`--callout-<type>`,
`--bases-*`). The faces are Atkinson Hyperlegible, which `styles.css` registers.

**On and off.** The toggle adds the look class, the palette's class and the accent's class to the
body of every Obsidian window (the main one, a popped-out note, settings), one class per call,
since Obsidian's `toggleClass` tests `instanceof Array` and an array from another window fails it.
A palette or accent change swaps its class and triggers a CSS change, because the graph view is a
canvas that re-reads its colors only then. `onunload` takes all three away. The plugin writes
nothing into the user's `.obsidian/` and no style or variable onto the body.

**Color means type.** The accent (`--sol-accent`, and `--sol-ink-accent` as text) belongs to the
UI: tabs, the top line, links, the active item, the h1 and rules. A type's hue (`--sol-number` and
the rest) means that type and nothing else: a property's icon wears its type's color, a string in
code is lime and a number gold. Obsidian's named colors are remapped to the palette, so callouts,
canvas cards and graph groups pull from it.

- **Dark.** A hue used as text or as a line icon is itself, on the dark workbench.
- **Light.** A color is either neutral or the full accent, never a hue greyed toward the ink. No
  hue reaches 4.5:1 as text on white (lime is 1.6:1) and a dark yellow is brown, so gold and lime
  text is the ink and their color moves into fills, rules and badges; every other hue darkens along
  its own hue in OKLCH, which stays a color. The ink on each hue used as a fill (a light-mode
  property badge) follows the chips' contrast rule (`--sol-ink-on-*`).

**Surfaces and chrome**, after the app's own cards, bars and floating windows:

- The note sits on the void like a node card: a lit surface, a hairline, 8 px corners. A quote is a
  tinted block, never a side stripe. The canvas and the graph view sit on the void with its dot
  grid.
- A tab is a node header: 6 px top corners, a tinted band under a 2 px cap, and a small uppercase
  title in the same color's ink. A note's tab is the accent, so it belongs to the accent line it
  stands on; a base, a canvas and media keep a color of their own. Every tab stands on the pane
  below it, active or not. Sidebar tabs are bare icons, and the active one wears the accent with
  nothing around it.
- The top bar is a hairline with the 2 px accent line under it. A pane's line takes its active
  tab's color, so the header and its line read as one piece, and every center pane gets one, split
  or not. The accent line paints over the pane bar's top 2 px, so the bar takes them back as
  padding, clearing the line by the same 6 px as the explorer's pill.
- Icon buttons are circles that fill on hover and turn to the accent, grouped into one pill as the
  app's top-bar clusters are. Fields are sunken, with one hairline and the accent on focus.
- The Navigator's rows have 6 px corners, the selected one washed in the accent, and a 9 px square
  of color in front of each folder: top-level folders take the palette in its own order (gold,
  green, amber, blue, lime, purple, gray, vermilion, violet, pink, sky, teal) and loop back to
  gold, and a subfolder shares its top folder's color. A row with its menu open gets the one-edge
  focus, not a 2 px ring. Section headings are set as the Navigator and the socket legend set
  theirs, the vault's name is the one brand mark, and floating windows wear the overlay border the
  minimap and the legend do.

**Writing.** A heading's rule is its own hue at the hairline rung. A callout is a group: a solid
header in its color over a tinted body with a 2 px dashed outline, and the header's ink picked per
color as the app picks a header's. A horizontal rule is a cable in the default diagonal draw shape:
a socket out, a straight run, a 45 degree leg centered between the runs, a straight run, a socket
in. Bullets are sockets: a circle for one thing, a square for a list under it. A table is one
rounded box whose cells keep inner rules only. In light a link is ink over a rule in the full
color, so the cable carries the hue.

**Properties** are a node card, every type in its own color. A row is a label and a value, not two
boxed fields, and every one-line row is 28 px of content, so a text value and the tag pills seat
the badge alike. Obsidian's 3 px gap above each row goes (with dividers on, nothing would sit
centered between its lines), and the key and value take it back as 2 px above and below. The icon
takes an 18 px box with 2 px either side, instead of Obsidian's 4 px zero-width spacer that leaves
it off center: 10 px to the card and 10 px to the label. In light the icon is a socket: an 18 px
badge in the full type color with a 12 px glyph in the ink that reads on that color, keeping the
22 px column the bare icon had and centered on the label (28 px on the desktop, 36 px on a phone).
On a phone Obsidian makes the content its own full-bleed panel, 12 px left and 24 px wider than
the card; here the card is the panel, so the icon keeps the desktop's 11 px inset. Obsidian nudges
the panel 4 px left so bare icons line up with the text; a bordered card lines up by its edge.

**Graph view.** A note is a node in the accent, and the active one is the ink. Tags and attachments
keep their type's hue.

## Requirements

1. **The chips and popups are the app's components, never redrawn** ([[B3]] sameNodeEverywhere).
   `PropertyChip.tsx` renders `ArrayChip`, `FrameChip` and `CubeChip`; `main.tsx` mounts
   `TablePopup` and `CubePopup` once. A look or behavior the plugin needs that the component
   lacks becomes a prop or a popup-state field on the component (`FrameChip`'s `popupOverrides`,
   `TablePopupState.noFormulaColumns`), never a fork.
2. **The seam to the graph is a list of module swaps.** The `SHIMMED` map in
   `obsidian-plugin/vite.config.ts` replaces, at build time, each app module that reaches the
   graph with a file in `src/shims/`: `persistence`, `process`, `fileBridge`, `frameBackend`,
   `activeGraph`, `flyToNode`, `packs`, `formulaSyntax`, `perfProbe`, `nativeAccent`, `appTheme`,
   `clipboard` and `mobileUa`. Each stands in for something a note cannot have:

   | Shim | Why it can stand in |
   |---|---|
   | `persistence`, `process` | There is no graph to save or compute. |
   | `activeGraph` | A value formats by its own type; there is no socket annotation to find. |
   | `flyToNode` | There is no canvas to fly across, and a property's error has no origin node. |
   | `fileBridge` | `isDesktop()` is false, so Export CSV takes the web build's download path (Obsidian's Electron shell shows a save dialog for it). |
   | `frameBackend` | A property is an eager value; there is no lazy frame handle to collect. |
   | `packs` | Packs gate node menus and add Format Controller units; nothing a property shows depends on one. |
   | `formulaSyntax` | Only a computed column's formula field reads it, and a property has no computed columns. |
   | `perfProbe` | There is no graph pass to time, and the app's probe registers two globals. |
   | `nativeAccent` | There is no native window border to tint, and the app's module carries the Tauri API. |
   | `appTheme` | The app's theme store writes its tokens onto `<html>` on every palette change, which requirement 3 forbids. The stand-in follows the plugin's own theme tick, and the tokens live in the shadow hosts; the pure `themeVars()` lives apart in `themeVars.ts`. |
   | `clipboard` | Obsidian is always a secure context, so the `execCommand` fallback cannot be reached. |
   | `mobileUa` | Obsidian's `Platform` answers instead of the user agent, which the directory's review refuses. |

   A shim keeps the app module's signatures, parameters included: the plugin's
   repository typechecks the app's calls against it (§ Publishing). A shim may only stand in for something
   that cannot happen in a note (no node to fly to, no editor to ask, no formula to tokenize); a
   shim that would change what a bundled component draws is refused, and the component gets a
   real seam under requirement 1. `PLUGIN_REPORT=1 npm run plugin:build` writes what the bundle
   pulled in; `PLUGIN_TRACE=<path,…>` adds the import chain to each named module.
3. **Every chip and the one popup layer render in Shadow DOM** (`shadow.ts`), because Obsidian
   and its themes style bare `button`, `input`, `select` and checkboxes. The build moves
   `@font-face` rules into `styles.css` (a font registers only from the document) and hands the
   rest of the bundled CSS to the shadow roots as a string with `:root` rewritten to `:host`. The
   plugin never writes to `<html>`, to `document.body`'s styles, or to an Obsidian variable.
4. **Tokens come from the app's own theme code.** `themeVars()` in `themeVars.ts` yields the
   socket colors, accent, error red and chrome ramp for a mode; `shadow.ts` writes both modes into
   one shared sheet, and each host's `data-theme` follows Obsidian's `theme-light` / `theme-dark`
   on `css-change`. A palette change rewrites that one sheet, so every open chip retints.
5. **A portal aimed at `document.body` lands in the popup layer** (`shims/reactDom.ts`, applied
   to app source only; `react-dom/client` keeps the real module). A click-outside test in a
   bundled component reads `composedPath()[0]`, since a shadow root retargets `event.target`.
6. **A property is plain YAML, and the mapping is pure** (`yamlValue.ts`, no DOM, no Obsidian). Dates are ISO text in the note and serials inside
   the components. Opening and saving an untouched value writes back the same YAML. Every row of
   a saved frame carries every key, a missing cell as `null`. **Every editor's Save writes each
   cell's source text** ([[D72]] pluginSaveWritesSourceText; list, matrix, frame; the cube already did): an unchanged cell keeps the
   scalar it came in with, an edited one is what was typed as YAML reads it (`parseCellText`: a
   number, true/false, else text), and no type touches the note. A frame column's picked type
   is a lens kept in the plugin's data and the property's family is a lens for a list or matrix,
   as the app's literal editors keep their source: a Number pick over a date column shows NaN and
   saves the dates. The Complex field is the one exception: a scalar with no editor of its
   own, it refuses text it cannot read and writes nothing. What the plugin writes, Solenoid's note
   reader (`noteFrontmatter.ts`) reads as the same type. A blank typed cell is written as
   missing. The Save path is `yamlValue.ts` (`frameSourceToYaml`, `listToYaml`, `matrixToYaml`,
   `coerceYaml`, `validateYaml`) with `PropertyChip.tsx`, which hands every Save the rows the
   editor opened on; no test pins it, since the plugin tests were dropped on the author's call.
   Obsidian's own YAML writer may restyle a saved list (flow to block); the values are what was
   in the note.
7. **`validate` checks shape only (the family inside a list or matrix is a lens, not a gate; the
   Complex scalar still takes only what it reads); `render` takes anything.** On a
   value `validate` refuses, Obsidian shows its own mismatch warning and the inferred type. But
   when the user picks a type from the property menu over incompatible data and confirms its
   "Update" dialog, Obsidian force-renders the chosen widget over the old value. So every kind
   reshapes whatever arrives (`coerceYaml`): a value that fits is untouched; the rest widens as
   the socket boundary does (a scalar is one element, a list one row, a matrix gets `Col1…`
   names); narrowing keeps what it can (a matrix or rows flatten into a list row by row) and
   every cell keeps its scalar; only a container in a frame cell is missing. The result always
   validates. **Nothing is
   written on render**: the note keeps its old YAML until the editor's Save.
8. **An empty value is usable.** `null`, `""` and the `[]` Obsidian leaves behind all read as
   empty: the chip says `[0× List]`, `[0×0 Table]` (the `twoD` hint, since `[]` cannot show its
   rank), `[0×0 Frame]` or `[0×0×1 Cube]`. A list or matrix opens on one blank row, and a frame
   on one blank Text column and row (Text, so nothing typed is lost to a column type). Blank rows
   at the end of a saved grid are the editor's and are never written; a blank row in the middle
   stays.
9. **The chip owns its value between Obsidian's renders.** Obsidian skips re-rendering a focused
   property, so `PropertyChip` keeps the edited YAML in state and the cube editor's records seam
   reads the latest commit. Obsidian builds a property row off-document and attaches it after
   `render` returns, so a mount counts as dropped (and is unmounted) only once it has been seen
   attached and then is not.
10. **Stylesheets are per document.** Obsidian's settings, and a note popped out, are windows of
    their own, and a constructed stylesheet can only be adopted in the document that made it. A
    host is created in its container's `ownerDocument` with that document's sheets; a palette
    change rewrites every live document's token sheet. Obsidian builds a property row in the main
    window and may move it into a popped-out one, and the sheets do not survive the move, so the
    sweep re-adopts the sheets of the document a host is in (`adoptSheets`; also on `window-open`
    and `layout-change`). **The one popup layer follows the chip's window**: a press on a chip
    moves the layer into that chip's document (`homePopupLayer`) and the popups render again
    there. The app's components reach for the global `document` and `window` (Escape, an outside
    press, the resize grip, measuring), which in a popped-out note are still the main window's,
    so the build rewrites every free use in `src/graph/components/` to the layer's own
    (`pluginGlobals` in `vite.config.ts` → `popupDocument` / `popupWindow` in `shadow.ts`).
11. **The plugin leaves nothing behind.** `onunload` removes the thirteen widgets, closes both
    popups, unmounts every root and removes the popup layer.
12. **Obsidian's widget API is undocumented and read from its source** (1.13.7): a widget is
    `{type, icon, name(), validate(value), render(el, value, ctx)}` in
    `app.metadataTypeManager.registeredTypeWidgets`, `ctx` is
    `{app, key, onChange, sourcePath, blur}`, and `render` returns an object with `focus()`. The
    plugin touches nothing else private.

## Divergences from the full app

Each row is a deliberate difference. "Removes it" is what would have to exist for the row to go.

| In the app | In Obsidian | Why | Removes it |
|---|---|---|---|
| The Special sockets `lambda`, `chart`, `document` are values with chips | No property type | They are identity-only values with no data form: a function, a rendered figure, a whole note. YAML cannot hold one | A text form for the value that Solenoid reads back as the same object |
| The Any ladder (`any` … `trueany`) types a port that takes whatever arrives | No property type | A wildcard carries no element family, and a property type is a declaration of family. An untyped key is already Obsidian's default | Nothing planned |
| Scalars (`number`, `string`, `date`, `logical`) are socket variants | Obsidian's native Number, Text, Date and Checkbox hold them | A second Number type would only compete with the native one | Nothing planned |
| `complex` scalar | No property type; it reads as Text | The app has no chip or popup for a scalar, so there is nothing to bring | A complex-scalar control in the app (`docs/backlog.md`) |
| Combo rungs (`numlist`, `strcombo` …) describe a port whose rank follows its input | No property type | A stored value has one rank; a property is a list or it is not | Nothing planned |
| A frame column can be computed (Fx) from a row formula, and can call a wired λ by socket name | The type cycle stops at Boolean; no Fx, no λ list (`noFormulaColumns`) | No formula engine, no sockets and no wired functions in a note. Bundling the engine would roughly double `main.js` for a column that would still have nothing to reference | A reason to compute inside a note that Solenoid's write-back does not already cover |
| A numeric column or matrix can be tagged with a unit that rides the value | No unit control | YAML holds the number alone; a unit would be a second key or a text convention, and the reader knows neither | A unit spelling in frontmatter that `noteFrontmatter.ts` reads |
| A column's format pick persists on the node and flows downstream ([[D41]] formatFlowsDownstream) | The pick restyles the open popup and is gone on close | There is no node to hold it and no downstream to flow to | A per-property place to store it that Solenoid also reads |
| The popup header pins the node to the HUD and flies to its card | Neither button | No node, no canvas | Nothing planned |
| Frame Input's Form view follows a Record layout authored on the card | The Form view is always the stacked default | There is no card to author the layout on | A layout key beside the property |
| A value popup wears its launching node's accent, and its type's socket color only when no node hosts it (DESIGN.md, the Nearest-Accent Rule) | Every popup wears its value type's socket color: `--sock-list` … `--sock-logicaltable`, `--sock-frame`, `--sock-cube` | There is no launching node. The chip passes the color as a resolved hex for the current palette and mode (`tokenHex`), because the filled Save button's ink and the light-mode border derive from a hex, and re-renders when either moves. A numeric chip itself stays `--sock-number`, as the app's chip CSS has it | Nothing planned |
| A table or cube popup is `min(1100px, 94vw)` wide and centers in the window | It is `min(1100px, 94%)` of the note's pane and centers over that pane; the dimmed overlay still covers the whole window, so a click on a sidebar closes the popup instead of changing the file under an open editor | Obsidian's sidebars make the window a poor measure of the room a note has. The pane is the chip's `.workspace-leaf` when it sits in the center area, else the center area (a property shown in a sidebar view). A layer-only stylesheet in `shadow.ts` does it; the app's CSS is untouched | Nothing planned |
| A list has no popup editor: List Input's rows on the card are the only editor, and its chip opens view-only ([[literal-input-editors]]) | A list property opens as a one-column raw grid with Save | There is no card to type rows on, and a chip that cannot edit would make the type read-only. The grid is Table Input's, with the column count fixed (`fixedCols`) | A list editor in the app, which the plugin would then adopt |
| A frame's column types are declared by its source | A column's type is the user's pick, kept in the plugin's `data.json` under the property's name, then the column's: vault-wide, as Obsidian types a property by name. Save records every column's type (`columnTypesOf`). A column nobody has typed takes a first guess from its YAML values' own types, never their text: `true` is Boolean, a number is Number, a string is Text unless every one is a date the app reads as one (`noteDateSerial`), and a mix is Text (`frameSourceFromYaml` through `guessNoteColumnType`, the app's own guess), so a quoted `"0012"` stays Text and a Save cannot turn it into 12 | YAML rows carry no column types, and a note stays plain YAML | A schema beside the property (mdbase is the likely one, [[C67]] mdbaseCeiling). A level inside a cube has no type selector, here or in the app: a cell is typed by what is typed into it (`parseCellText`), and a cell nobody edits is never rewritten |
| A cell can hold a `SolError` that flows on | A cell the type cannot read shows as unreadable and saves as its source text; the note is never touched by a type | An error is a computed result, and nothing computes here | Nothing planned |
| A frame may be a lazy engine handle with a head-N preview (Polars on desktop) | Always an eager value | A property is small and already parsed | Nothing planned |
| A chip is `md` in a value box and `sm` in a result box | Always `sm` | The author's ruling: `md` overpowers a property row ([[C107]] obsidianPlugin) | The author's word |
| Accent and palette follow the app setting and the open document's palette pin | Both are the plugin's own settings, and the look wears them too | No document, and Obsidian's accent is not a palette slot | Nothing planned |
| Light or dark follows the app's own toggle | Follows Obsidian's | The note is Obsidian's surface | Nothing planned |
| Export CSV opens the desktop save dialog | The web build's download path | No Tauri bridge in Obsidian | Nothing planned |

## Out of scope

Computing anything. Reading or writing a note's body. A real phone: `isDesktopOnly` is false because
nothing in the bundle needs Electron, and the plugin is checked as a phone only through Obsidian's
own mobile emulation in the rig (below), never on a device.

## On the site

The site's Obsidian page renders `PropertyChip` itself, over the demo vault's `Solenoid/Property types.md` and `.obsidian/types.json` (`landing/PropertiesDemo.tsx`), with the app's `TablePopup` and `CubePopup` mounted beside it. Off Obsidian there is no shadow root, so the page passes `resolveToken` to read its own CSS variables instead of `tokenHex`. Each save updates a YAML pane beside the panel, printed with `yaml`'s `stringify`.

## Publishing

Obsidian's community list points at one GitHub repository, reads `manifest.json` from the root of
its default branch and installs `main.js`, `manifest.json` and `styles.css` from a GitHub Release
whose tag is the manifest's version. It cannot point at a branch or a folder, and this repository
is the app's, so the plugin publishes from its own: `bubba8587/Solenoid-Properties`, listed at
community.obsidian.md/plugins/solenoid-properties. The directory's automated review rescans every
release, and **it requires the repository to hold the source it is built from**, so that
repository carries a snapshot: `npm run plugin:export -- <its clone>`
(`scripts/export-plugin-source.mjs`) copies exactly the app files the build reads
(`PLUGIN_MODULES`) plus what those import for types alone, the `obsidian-plugin/` folder, a `package.json` pinned to the versions
installed here, its own lock file, the manifest, `versions.json`, the third-party licenses and a
`source.json` naming the commit. This repository stays the source of truth (the chips and editors
are the app's components); nothing is edited there. Its release workflow runs
`npm ci && npm run build` on the snapshot, checks the built manifest against the root one, attests
the three files' build provenance, and attaches only those three (Obsidian downloads nothing else).
The shim swap matches by path,
not by resolving, because the snapshot has the stand-ins and not the modules they replace.
**The snapshot typechecks on its own.** The review lints with types, and a module that does not
resolve there types everything through it `any`, and each such use is an "unsafe" finding. So the export follows type-only imports, and the snapshot's `tsconfig.json` lays
`obsidian-plugin/src/shims` over `src/graph` with `rootDirs`, so `./packs` resolves to the
stand-in for types as the build's swap resolves it for code. Its `npm run build` runs
`tsc --noEmit` first, which is the guard on a shim's signatures. Its
README is for users, so the release steps live here:

1. Here, set the version in `obsidian-plugin/manifest.json`, commit and push `develop`.
2. `npm run plugin:export -- "<clone>"`, then commit and push there.
3. There, run Actions → Release → Run workflow with the version and "publish" OFF: it only builds.
   Then create the release: push a tag equal to the version (`0.1.1`, no `v`), or run the workflow
   again with "publish" on. A fix to a review finding needs a NEW version: the directory reviews
   releases, not commits.

The bundle is what a reviewer reads, so nothing in it logs, writes a global or touches the
document; `perfProbe` is shimmed for that reason (its probe registers `__solenoidStats` on
import). The app's stores keep their picks in `localStorage`, which the review flags and which
Obsidian shares across vaults, so the build points every free `localStorage` /
`sessionStorage` in app code at memory (`memoryStorage.ts`, `pluginGlobals`); the palette persists
through `data.json`. The clipboard is only ever written (the editors' Copy actions), and the
plugin's README discloses it.

**Review findings that stand** (warnings; each is the app's own code, read by the review because
the snapshot carries whole files): `localStorage` in `palette.ts` and `settingsStore.ts`
(rewritten to memory by the build, above); `throw solError(…)` in `frameVerbs.ts` and
`frameShape.ts` (a thrown `SolError` is the engine's error model, [[error-values]]); the
normal-CDF coefficients in `mathUtils.ts`, printed as published (the footer's `aggregate` pulls
the file in; 310 bytes of it ship); in CSS, the `vh` line before each `dvh` one (the fallback),
`:has()`, and the browser-support notes. Reproduce the review before a release with
`eslint-plugin-obsidianmd`'s recommended config, run in the exported snapshot. `test.yml` builds the plugin on every push, so `develop` cannot break the build the
release workflow depends on.

## What Solenoid reads back

A Note or Import Obsidian Note reads each type the plugin writes as the same socket: a list or a
matrix of numbers, text, dates, Booleans or complex numbers (`noteFrontmatter.ts` guesses the
rank and the family, `FIELD_SOCKETS` in `nodes/annotation.ts` mints the socket, and the lattice's
`typeAtRank` reshapes a pinned family onto the value's rank), a frame, a cube and a complex
scalar. A frame column whose every present cell is a number, a Boolean or an ISO date takes that
type, and any other mix is text (`guessNoteColumnType` in `frame.ts`, the plugin's own first guess too). A list or matrix that mixes families is text,
never typed by its first element, and a date read as text (in a text list, or under a Text pin or
a `text` type in `types.json`) is the ISO text written, never its serial. A day the month does not
have (`2026-02-30`) is text. An unquoted `YYYY-MM-DDTHH:mm[:ss]`, Obsidian's Date & time and what
Write to Obsidian writes for a serial with a time, is a date that keeps its time, in a Note as in
Vault Folder. The Vault Folder reader holds a matrix in
a cube cell as its rows, and `obsidianTypes.ts` maps every plugin type id to a `TypeHint`
(a cube takes the frame hint: rows of records either way). Complex cells are text in a cube,
as Excel's complex numbers are.

## The app reads the picks

A column type picked here is read by Solenoid ([[C107]] obsidianPlugin). `src/graph/pluginColumnTypes.ts` parses the plugin's
`data.json` (`columnTypes`, property then column, the four type names); Vault Folder reads it
beside `.obsidian/types.json` and Import Obsidian Note reads it with the note (a bare Note has
no vault and keeps none; the field is transient, the vault is the source). A pick types that
column above the guesser and only refines a frame's columns: mdbase and `types.json` still say
what a key is. The reader keeps a row's plain ISO date as the text written, so the column's
type decides what it becomes: a Date pick or an all-date column makes serials, a Text pick keeps
the text, and a column mixing a date with text is text with the date as written. Every cell crosses the app's own value boundary (`coerceFrameCell`) with its source text kept as
the frame's `raw`, as Frame Input's literal source does: a picked type that cannot read a cell
shows NaN over the text, never a silent blank, and the note keeps its text ([[D72]]). The desktop file scope reaches that one path (`capabilities/default.json`). Tests:
`pluginColumnTypes.test.ts`, `vaultCube.test.ts`, `noteFrontmatter.test.ts`, `noteNodeRanks.test.ts`.

## Verifying against real Obsidian

A fake `obsidian` module is not enough: it cannot show that the settings page is a separate
document or that a property row is built off-document, and either one breaks the plugin. The check that counts
is a second Obsidian on a private display (`Xephyr`), with its own `--user-data-dir`, a copy of
the vault and `--remote-debugging-port`, driven over CDP; `window.app` is reachable there, and
the author's own session is untouched. It is one command: `npm run plugin:rig -- up | sync | shot | eval |
down` (`scripts/obsidian-rig.mjs`). `npm run plugin:build` lands in `obsidian-plugin/dist/` (ignored), never
in a vault: the demo vault installs the plugin from the community store, as a user does, and the rig
lays the build under test over that copy in its own vault (`PLUGIN_OUT=<a vault's plugin folder>`
builds straight into one). A plugin reload unmounts every chip and Obsidian does not redraw an
open note, so `sync` rebuilds the open views.

**As a phone.** `node scripts/obsidian-rig-mobile.mjs` drives the same rig through Obsidian's own
mobile emulation (`app.emulateMobile`, the mobile layout and `body.is-mobile`) in a phone-sized
window with a coarse pointer and touch events, and takes its steps in a row (`setup`, `look`,
`theme`, `note`, `tap <property>`, `shot`, `settings`, `close`, `teardown`), since the emulation
lives in one CDP session. It is the check on the chips, the popups and the settings tab at 412 and
360 px wide; `@media (pointer: coarse)` and `dvh` in the app's popup CSS answer inside a shadow
root, while `html.is-mobile` rules cannot and the bundle carries none. Measured, never eyeballed
(`getBoundingClientRect`, printed): on a phone Obsidian makes the properties content a full-bleed
panel 12px left of the card, which the look undoes so the icon keeps the desktop's 11px inset, and
the light badge centers itself on the taller row. At 412 and 360 px every editor
fits, and under a coarse pointer the footer's controls get smaller, not finger-sized, so the
row/column buttons and Cancel/Save share one row under the view toggle (11px text on a 412px phone,
10px at 380px and under; author's ruling, `TablePopup.css`). Done and Cancel/Save sit right.

A builder that finds this spec silent stops that part and runs
`python tools/dte.py gap [[obsidian-plugin]] --title "..." --by <name>`; it never improvises.
