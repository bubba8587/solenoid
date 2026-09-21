<!-- [[C107]] obsidianPlugin, [[B3]] sameNodeEverywhere, [[B1]] obsidianBet; covers: obsidian-plugin/vite.config.ts, obsidian-plugin/src/*.ts, obsidian-plugin/src/*.tsx, obsidian-plugin/src/shims/*.ts -->

# Spec: Solenoid Properties (the Obsidian plugin)

Serves [[C107]] obsidianPlugin. The plugin adds every Solenoid object type that YAML can hold to
Obsidian's properties: each one shows as the app's chip and opens the app's popup editor, and the
note keeps plain YAML. This spec is what the plugin has, how it is built, and every place it
differs from the full app. A divergence lives here under the rule it bends, with what would remove
it ([[C5]] exceptionsUnderRule).

## What it has

**Twelve property types.** One per container rung of the socket lattice
(`specs/socket-lattice.md`): the list and the matrix of each of the five element families, the
frame and the cube. The type id is `solenoid-` plus the socket variant, so
`.obsidian/types.json` names a socket by identity; the name is the socket legend's.

| Type id | Name in Obsidian | YAML in the note | Chip | Editor |
|---|---|---|---|---|
| `solenoid-list` | Numeric List | sequence of numbers | `[N× List]` | one-column raw grid |
| `solenoid-strlist` | String List | sequence of text | same, string tint | same |
| `solenoid-datelist` | Date List | sequence of ISO dates | same, date tint | same |
| `solenoid-complexlist` | Complex List | sequence of `a+bi` text | same, complex tint | same |
| `solenoid-logicallist` | Boolean List | sequence of `true` / `false` | same, logical tint | same |
| `solenoid-table`, `-strtable`, `-datetable`, `-complextable`, `-logicaltable` | Numeric / String / Date / Complex / Boolean Matrix | sequence of sequences | `[R×C Table]` in the family's matrix shade | Table Input's raw grid |
| `solenoid-frame` | Frame | sequence of `key: value` maps, scalar values | `[R×C Frame]` | Frame Input's literal-source editor (Grid, Form, CSV, Source toggle, column types, sort, summary footer) |
| `solenoid-cube` | Cube | sequence of maps whose values may be lists or rows | `[R×C×D Cube]` | Cube Input's drill-stack editor |

**Type icons.** A list or matrix wears its element FAMILY's icon, Obsidian's own: Number's
`lucide-binary`, Text's `lucide-text`, Date's `lucide-calendar`, Checkbox's
`lucide-check-square`. The chip already says list or table, so the icon says what is in it
(author 2026-09-20). Complex has no Obsidian counterpart and takes `lucide-radical`. A frame and
a cube keep their socket glyph's outline, registered with `addIcon` (`icons.ts`).

**A settings page** laid out as the app's own palette row: the Color palette choice (the
built-in palettes, persisted in the plugin's `data.json`, which also holds the frame column types below) with the app's read-only `SwatchGrid`
stacked under it, following the choice. One more item, "Solenoid", carries two links and no
prose: the app's deploy and its GitHub repository, each shown as its URL (author 2026-09-21).
The manifest description is one sentence naming the four
shapes. Both follow DESIGN.md § 7: nothing explains how to use a control. The page shows no
sample chips (author 2026-09-20: a chip over made-up data is bogus).

**Everything the popups do without a graph:** cell and header editing, add and remove rows and
columns, the column type cycle, visual sort, the CSV view, Copy, Copy as Markdown, Export CSV,
the summary footer and its per-column stat, freeze header, the resize grip, the cube breadcrumb
and drill levels, Escape semantics.

## Requirements

1. **The chips and popups are the app's components, never redrawn** ([[B3]] sameNodeEverywhere).
   `PropertyChip.tsx` renders `ArrayChip`, `FrameChip` and `CubeChip`; `main.tsx` mounts
   `TablePopup` and `CubePopup` once. A look or behaviour the plugin needs that the component
   lacks becomes a prop or a popup-state field on the component (`FrameChip`'s `popupOverrides`,
   `TablePopupState.noFormulaColumns`), never a fork.
2. **The seam to the graph is a list of module swaps.** The `SHIMMED` map in
   `obsidian-plugin/vite.config.ts` replaces, at build time, each app module that reaches the
   graph with a file in `src/shims/`: `persistence`, `process`, `fileBridge`, `frameBackend`,
   `activeGraph`, `flyToNode`, `packs`, `formulaSyntax`, `perfProbe`, `nativeAccent`. A shim may only stand in for something
   that cannot happen in a note (no node to fly to, no editor to ask, no formula to tokenize); a
   shim that would change what a bundled component draws is refused, and the component gets a
   real seam under requirement 1. `PLUGIN_REPORT=1 npm run plugin:build` writes what the bundle
   pulled in; `PLUGIN_TRACE=<path,…>` adds the import chain to each named module.
3. **Every chip and the one popup layer render in Shadow DOM** (`shadow.ts`), because Obsidian
   and its themes style bare `button`, `input`, `select` and checkboxes. The build moves
   `@font-face` rules into `styles.css` (a font registers only from the document) and hands the
   rest of the bundled CSS to the shadow roots as a string with `:root` rewritten to `:host`. The
   plugin never writes to `<html>`, to `document.body`'s styles, or to an Obsidian variable.
4. **Tokens come from the app's own theme code.** `themeVars()` in `appTheme.ts` yields the
   socket colors, accent, error red and chrome ramp for a mode; `shadow.ts` writes both modes into
   one shared sheet, and each host's `data-theme` follows Obsidian's `theme-light` / `theme-dark`
   on `css-change`. A palette change rewrites that one sheet, so every open chip retints.
5. **A portal aimed at `document.body` lands in the popup layer** (`shims/reactDom.ts`, applied
   to app source only; `react-dom/client` keeps the real module). A click-outside test in a
   bundled component reads `composedPath()[0]`, since a shadow root retargets `event.target`.
6. **A property is plain YAML, and the mapping is pure** (`yamlValue.ts`, no DOM, no Obsidian;
   `tests/obsidianPlugin/yamlValue.test.ts`). Dates are ISO text in the note and serials inside
   the components. Opening and saving an untouched value writes back the same YAML. Every row of
   a saved frame carries every key, a missing cell as `null`. What the plugin writes, Solenoid's
   note reader (`noteFrontmatter.ts`) reads as the same type; the one open gap is listed below.
7. **`validate` checks shape, and family inside a list or matrix; `render` takes anything.** On a
   value `validate` refuses, Obsidian shows its own mismatch warning and the inferred type. But
   when the user picks a type from the property menu over incompatible data and confirms its
   "Update" dialog, Obsidian force-renders the chosen widget over the OLD value. So every kind
   reshapes whatever arrives (`coerceYaml`): a value that fits is untouched; the rest widens as
   the socket boundary does (a scalar is one element, a list one row, a matrix gets `Col1…`
   names); narrowing keeps what it can (a matrix or rows flatten into a list row by row) and a
   cell the family cannot read becomes missing. The result always validates. **Nothing is
   written on render**: the note keeps its old YAML until the editor's Save.
8. **An empty value is usable.** `null`, `""` and the `[]` Obsidian leaves behind all read as
   empty: the chip says `[0× List]`, `[0×0 Table]` (the `twoD` hint, since `[]` cannot show its
   rank), `[0×0 Frame]` or `[0×0×1 Cube]`. A list or matrix opens on one blank row, and a frame
   on one blank Text column and row (Text, so nothing typed is lost to a column type). Blank rows
   at the END of a saved grid are the editor's and are never written; a blank row in the middle
   stays.
9. **The chip owns its value between Obsidian's renders.** Obsidian skips re-rendering a focused
   property, so `PropertyChip` keeps the edited YAML in state and the cube editor's records seam
   reads the latest commit. Obsidian builds a property row off-document and attaches it after
   `render` returns, so a mount counts as dropped (and is unmounted) only once it has been seen
   attached and then is not.
10. **Stylesheets are per document.** Obsidian's settings, and a note popped out, are windows of
    their own, and a constructed stylesheet can only be adopted in the document that made it. A
    host is created in its container's `ownerDocument` with that document's sheets; a palette
    change rewrites every live document's token sheet. The popup layer lives in the main window,
    so a chip in a popped-out note opens its editor there (a gap, below).
11. **The plugin leaves nothing behind.** `onunload` removes the twelve widgets, closes both
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
| A value popup wears its launching node's accent, and its type's socket color only when no node hosts it (DESIGN.md, the Nearest-Accent Rule) | Every popup wears its value TYPE's socket color: `--sock-list` … `--sock-logicaltable`, `--sock-frame`, `--sock-cube` (author 2026-09-20) | There is no launching node. The chip passes the color as a resolved hex for the current palette and mode (`tokenHex`), because the filled Save button's ink and the light-mode border derive from a hex, and re-renders when either moves. A numeric chip itself stays `--sock-number`, as the app's chip CSS has it | Nothing planned |
| A table or cube popup is `min(1100px, 94vw)` wide and centers in the window | It is `min(1100px, 94%)` of the note's pane and centers over that pane; the dimmed overlay still covers the whole window, so a click on a sidebar closes the popup instead of changing the file under an open editor (author 2026-09-20) | Obsidian's sidebars make the window a poor measure of the room a note has. The pane is the chip's `.workspace-leaf` when it sits in the center area, else the center area (a property shown in a sidebar view). A layer-only stylesheet in `shadow.ts` does it; the app's CSS is untouched | Nothing planned |
| A list has no popup editor: List Input's rows on the card are the only editor, and its chip opens view-only (`specs/literal-input-editors.md`) | A list property opens as a one-column raw grid with Save (author 2026-09-20: a fine workaround) | There is no card to type rows on, and a chip that cannot edit would make the type read-only. The grid is Table Input's, with the column count fixed (`fixedCols`) | A list editor in the app, which the plugin would then adopt |
| A frame's column types are declared by its source | A column's type is the user's pick, kept in the plugin's `data.json` under the property's name, then the column's: vault-wide, as Obsidian types a property by name. Save records every column's type (`columnTypesOf`). A column nobody has typed takes a FIRST guess from its YAML values' own types, never their text: `true` is Boolean, a number is Number, a string is Text unless every one is an ISO date (`frameSourceFromYaml`). Author 2026-09-21: re-inferring from the cell text on every open made the type selector a lie, and a Save turned a Text column of `"0012"` into `12` | YAML rows carry no column types, and a note stays plain YAML | A schema beside the property (mdbase is the likely one, [[C67]] mdbaseCeiling). A frame drilled out of a CUBE still guesses on every open (`recordsToCube`) |
| A cell can hold a `SolError` that flows on | A cell the family cannot read saves as missing (`null`) | An error is a computed result, and nothing computes here | Nothing planned |
| A frame may be a lazy engine handle with a head-N preview (Polars on desktop) | Always an eager value | A property is small and already parsed | Nothing planned |
| A chip is `md` in a value box and `sm` in a result box | Always `sm` | Author's ruling 2026-09-20: `md` overpowers a property row | The author's word |
| Accent and palette follow the app setting and the open document's palette pin | Accent is the brand gold; palette is the plugin's own setting | No document, and Obsidian's accent is not a palette slot | A setting for the accent |
| Light or dark follows the app's own toggle | Follows Obsidian's | The note is Obsidian's surface | Nothing planned |
| Export CSV opens the desktop save dialog | The web build's download path | No Tauri bridge in Obsidian | Nothing planned |

## Out of scope

Computing anything. Reading or writing a note's body. Bases table cells (they show raw YAML for
these keys). Mobile is untested: `isDesktopOnly` is false because nothing in the bundle needs
Electron, and that is all it claims.

## Publishing

Obsidian's community list points at one GitHub repository, reads `manifest.json` from the root of
its default branch and installs `main.js`, `manifest.json` and `styles.css` from a GitHub Release
whose tag is the manifest's version. It cannot point at a branch or a folder, and this repository
is the app's, so the plugin publishes from its own: `bubba8587/Solenoid-Properties`. That
repository holds no source. Its `source.json` pins a commit of this one; its release workflow
checks that commit out, runs `npm run plugin:build`, and attaches the three files plus
`third-party-licenses.txt`. Its `manifest.json` must equal `obsidian-plugin/manifest.json` at the
pinned commit, and the workflow refuses a release when they differ. The release steps are that
repository's README. The listing is submitted through community.obsidian.md (the author's), whose
automated review rescans every published release.

The bundle is what a reviewer reads, so nothing in it logs, writes a global or touches the
document; `perfProbe` is shimmed for that reason (its probe registers `__solenoidStats` on
import). `test.yml` builds the plugin on every push, so `develop` cannot break the build the
release workflow depends on.

## Gaps

- **Solenoid's reader types no matrix.** A sequence of sequences reads as a text list, so a
  matrix the plugin writes does not yet arrive in Solenoid as a `table` rung (`docs/backlog.md`).
- `obsidianTypes.ts` maps the list ids and `solenoid-frame` to a `TypeHint`; `TypeHint` has no
  matrix or cube shape, so those ids fall through to the guesser.
- A chip in a popped-out note opens its editor in the main window (one popup layer).

## Verifying against real Obsidian

A fake `obsidian` module is not enough: it missed that the settings page is a separate document
and that a property row is built off-document, and both broke the plugin. The check that counts
is a second Obsidian on a private display (`Xephyr`), with its own `--user-data-dir`, a copy of
the vault and `--remote-debugging-port`, driven over CDP; `window.app` is reachable there, and
the author's own session is untouched. It is one command: `npm run plugin:rig -- up | sync | shot | eval |
down` (`scripts/obsidian-rig.mjs`). A plugin reload unmounts every chip and Obsidian does not redraw an
open note, so `sync` rebuilds the open views.

A builder that finds this spec silent stops that part and runs
`python tools/dte.py gap specs/obsidian-plugin.md --title "..." --by <name>`; it never improvises.
