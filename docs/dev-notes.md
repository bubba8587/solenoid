# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-30: the Heatmap figure; cloud session)
- Heatmap is a figure node now: frame, table or list in, a `heatmap` chart value out; the pass-through `HeatmapCellNode` and its hardcoded blue-yellow-red card are gone (`tree/specs/computation/chart-figures.md` § Heatmap, § The CSS and canvas figures).
- Square, touching cells by default (`aspect=auto` fills); seaborn's `cmap`, `center`, `vmin`, `vmax`, `annot`, `fmt`, `cbar` plus `origin`, all in the Chart Builder's new Heatmap target. No `cmap` means the palette's height ramp, or its diverging ramp with a center, so the default follows the theme.
- Histogram 2-D emits the heatmap figure (matplotlib's `hist2d`: discrete bins, y upward) instead of a smoothed contour, and takes every heatmap key. Calendar Heatmap takes `cmap`, `center`, `vmin`, `vmax`, `cbar` (a colorbar, on by default) and shows the hovered day's date and value; with no cmap it keeps the accent.
- Calendar Heatmap wraps its weeks into up to four bands and sizes its card to them, so a year reads at 8 px or more a day on the card.
- Surface and Vector Field have an Options input (Chart Builder targets Contour, Surface, Vector Field): `cmap` on all three; the Flat view adds axes with round ticks, axis titles, `center`/`vmin`/`vmax`, a colorbar and a hover readout of the interpolated height.
- Chart Builder: switching the target clears the fields and cables the new figure does not read (author); only Gantt's calendar layout still dims rows it ignores.
- Tidy and Cleanup: ELK packs disconnected components (no `INCLUDE_CHILDREN` on the root; flipped layouts keep it), Cleanup waits for the collapsed sizes before its top-level Tidy (a second Cleanup is now a fixed point), each card moves once, and the layer split no longer lives in a module variable (the landing scene read a stale one) (`tree/specs/canvas/auto-arrange-tidy.md`).
- Tidy and Cleanup are fixed points: a sub-pixel change in what ELK is handed flipped whole layouts, so Tidy, the standoff solve and autofit land on whole pixels and a docked FC's socket is read from layout offsets, not the zoomed screen (a second run moves 0 px on the eight seeds probed).
- Tidy alignment gains Balanced (the default: ports halfway to the real socket heights) and Sockets (level cables). Scored against the joined cards' heights, Balanced keeps cables within their cards' band without Sockets' staircase. Every seed is re-baked; `seedTune` tidies with groups expanded. The Power features seed's standoff now pins the Standoffs note under Monitoring, per [[C89]]; it tied Sensor B to its consumer, which left Sensor B stranded. Open: tidying each group by hand and then the canvas, twice, still moves personal finance ~530 px (both modes; Cleanup itself is a fixed point).
- `presentSocketStore`: which sockets each card shows. Tidy reserves those (a Chart Builder no longer lays out as its 53-field variant) and a collapsed group's leaf row takes the first shown output.
- Canvas figure text draws in the app's faces (`canvasFont`), not `system-ui`.
- New pure modules: `colormaps.ts` (matplotlib's maps, `_r`, `heatScale`), `numberSpec.ts` (the Python format spec behind `fmt`), `components/heatmapLayout.ts` (`tests/graph/heatmap.test.ts`).

### SESSION DIGEST (2026-09-29c: commit-walk review of 08-01 to 09-29; cloud session)
- A collapsed XLOOKUP, Cast, Schedule, Gantt or Earned Value card shows one input pill: collapsed, it drops its socketed section and one `InlineInputs` carries every input (`tree/specs/floors/components.md` § Sections).
- The Table popup's CSV view reads the added columns' inferred types everywhere (`typesShown`), and CSV pressed in CSV does nothing, so a pasted text column no longer turns to NaN.
- INDEX and Filter keep their sockets and cables when a wired table empties: an empty array says nothing about shape ([[D85]] columnsStayColumns; `indexPosition.test.ts`, `conduitFilterTypes.test.ts`).
- Drilling into a Cube cell holding one record saves it as a one-row table first, so the drill shows it and Add Row keeps it.
- Chart exports size their root in canvas units (zoom taken out) and vault PNGs carry the legend (`nodeChartSvgString`).
- Removed: the native pivot's unit tail (Pivot runs in JS; nothing reached it). A computed column builds each whole-column reading once per run.
- Undo flushes a pending edit before it restores, keeps the last edit on documents past the byte budget, and restores the exact camera (`flowHistory.ts`, `View.setCamera`).
- Volatile formula text (TODAY, NOW) folds the recalc generation into the Frame Input, Cube Input and Computed Column memos; Holidays and World Clock recompute at midnight ([[D46]] freezeVolatilePerCalc).
- Lazy frame reads go through `readRefColumn` (sketch scaling and the aggregate guard), and a sink's Run in Sketch mode writes from a forced exact pass (`withExactPass`).
- A superseded Local File load and a stale Pivot pass drop their result; Script calls run one at a time in the worker, each timed from its start.
- Out-of-order odd-coupon dates, T-bills past a year and PRICEMAT after maturity are refused; XIRR's date check is one helper for node and formula; QUARTILE truncates; REGEXREPLACE counts a negative occurrence from the end (author).
- Out-of-range finance arguments (frequency, basis, date order, T-bill term, amounts) are #DOMAIN! with a message naming the need, on node and formula alike; a missing date stays blank ([[D70]] nullNotEnoughData, the author's ruling).
- DAYS360, YEARFRAC basis 0 and the coupon 30/360 follow Excel's end-of-February rules (unchecked in Excel: backlog).
- NETWORKDAYS counts calendar days with its own kernel (`networkDays`, off Formula.js); PERCENTRANK skips blanks; the Z test reads a typed σ; Save Times shows the wall clock; a document's autosave time moves only when its graph changed.
- Tests that assert a module's first state or mock a module run in the ISOLATED project (`noteMarkdown`, `sketchExport`, `localFileRace`, `flowHistory`).
- Open leads the walk found and left: `backlog.md` § From the 2026-09-29 commit-walk review.

### SESSION DIGEST (2026-09-29b: ROW(), the shape model, one text reading and number display, Cast, palette follow-ups, type icons, card sections and the liquid fold; cloud session)

- **`ROW()` replaces the bare `row`/`rows` names; a computed column's whole column is a one-column table**
  ([[C22]] rowFormulaRefs, [[C14]] currentExcelParity): `ROW()` reads the row context (`currentRowNumber`),
  `ROWS(price)` is the row count, and a column may be named `row`. COLUMN stays blocked (`POSITION_NAMES`,
  `blockedNameMessage`).
- **One shape model, D85 columnsStayColumns** (E17 folded in and retired): a List is one CSV row, a Frame column a
  one-column table, Frame from Lists the named transposer.
- **Every list-taking function declares `orient`** ([[D85]] columnsStayColumns): `free` (direction means nothing; a
  one-column or one-row table reads as its items and a list answer comes back the way it went in) or `axis`
  (the Excel shapers read rows and columns themselves). `readVectors` / `asColumn` in `excelFormula.ts` apply it;
  `vectorOrient.test.ts` runs every `free` function on a list and a column. A computed column's row-aligned wired
  list reads as a column. INTERPOLATE and DIAGONAL are `free` for their vector mode and keep their grid mode.
  A Cube column of list cells reads whole as its rows stacked, padded with blanks ([[D81]] cubeRowLists), so
  `SUM(prices)`, `ROWS(prices)` and `INDEX(prices, ROW(), 2)` work; a grid in some row keeps it `#SHAPE!`.
- **The Frame editor's corner (i)** (`HeaderHelpButton`): type glyphs plus the Fx names. [[table-popup]] § The grid.
  The Cube popup's editable levels carry it too (None type, `COUNTA(@tags)`; Fx rows on the root only).
- **One number display** ([[D94]] oneNumberDisplay): `formatScalar` is the FC's General style (integer as is,
  else the "Decimal places" setting, default 4, trimmed; extremes scientific) and every unformatted display uses it: value boxes, Frame
  and Table cards, the Table and Cube popups, complex parts, unit suffixes, Alert messages. `formatCx` (data) keeps
  4 decimals; the Constant and Physics Constant cards and chart ticks keep theirs. `listPreview` was dead and went.
- **A list popup's CSV view followed the Source switch backwards**: the list path of `buildText` ignored the mode
  it was handed and read the not-yet-updated toggle. It now takes the mode like the table path.
- **One text reading** ([[D93]] oneTextReading): every place text becomes a typed value (List Input typed or
  wired, every inline list field via `parseListLiteral`, typed Cube list items via `coerceListItem`, Get Column's Number/Date read, the vault reader's typed properties) reads it with
  `coerceFrameCell`, so unreadable text is NaN, never blank, and `dateFormatDisplay` shows a NaN date as `NaN`.
  `parseBoolText` (yes/no in list fields) is gone. List Input keeps its typed text (`cachedSource`) for the
  popup's Source view and sets `ownsListLiterals` so `coerceInputs` doesn't pre-parse its rows.
- **Sparklines paint in the palette's gold, green and red** ([[D82]] sparklineCell): a SPARKLINE picture keeps the
  Default hexes in its text, and `CellImage` (every grid, card and record picture) repaints them in the active
  palette; the Sparkline node's line and columns paint gold.
- **Type icons** (DESIGN.md § Type icons): every type segment, column type button, the (i) legend and the Pivot
  chips draw `TypeIcon` (`#`, `Aa`, calendar, checkbox, double-struck C) instead of words or `T`/`D`/`B`.
- **Card sections** (DESIGN.md § Card sections; `CardSection.tsx`, `sectionFoldStore`): a caption over
  a run of rows, folding when the rows are secondary: Cast's Separators, Frame Input's Advanced (λ inputs, Form
  Layout), XLOOKUP's Options, the Calendar of Schedule, Gantt and Earned Value, Schedule's Rules. Plain captions on
  Join (Keys), Reconcile (Columns), Decision Matrix and Chart Builder's "Not used by …". A section opens by default
  when anything inside is set away from the node's seeded literals or wired; a hand fold saves (a node's `sections`,
  text form included). Folded, wired sockets tuck onto the caption behind a pill that replaces the chevron and
  reopens the section; the chevron hangs in the body's left margin so caption text stays aligned.
- **The fold is liquid** (`SocketGoo.tsx`): a gooey SVG filter fuses the dots into the pill and buds them back off,
  with each type's ring traced on every neck (a ring-shade layer under the fill layer cut 2px in on the same
  field), and each wired cable rides its drop (`cableEndMotion.ts`, the second frame-rate store). The click pins
  the cable ends so no frame shows them at a moved socket. Reduced motion skips it.
- **Ring shades:** the collapsed input pill and a collapsed group's pills took the translucent global
  `--socket-ring`; they now use the fill's own ring shade (`socketRingVar`), like socket dots.
- **Input cards open first-class:** Frame Input and Table Input carry an Edit Frame / Edit Table button, two thirds
  wide in the card's full accent and its ink (`NodeCard` now publishes `--node-accent-ink`), sharing the chip's
  opener (`openFrameChipPopup`).
- **A collapsed table card centers its chip:** the chip row's inline spacing beat the collapsed rule; it moved to CSS.
- **The Table popup asks before dropping edits** (`tree/specs/documents/table-popup.md` § Closing): a close with
  unsaved edits raises Save your changes? (Discard / Keep Editing / Save) inside the popup. `shot-graph` gained
  `--click-edge` to press a popup's overlay outside the card.
- **Cast absorbs NUMBERVALUE** (the NumberValue card is gone): to Text takes a `format`, to Number takes Decimal and
  Group separators under a small Separators label, read by VALUE's own reader (`parseValueText`); a retarget drops
  the departing inputs' cables. Cast sits on the default width tiers now that its segments are icons.
- **A Cube row holding a table is `#SHAPE!` on that row alone** ([[D81]] cubeRowLists); the column's other rows
  compute. SORT of nothing answers nothing.
- **Palette follow-ups:** Add menu leaf tints follow the palette (`accent` is a node kind, `leafAccent`), and the
  three neutral accents take on the palette's chrome ([[D95]] neutralsFollowChrome: `neutralHex`, tinted toward the
  app background within a lightness range).
- **CI:** four pack formulas lacked `orient`; `vectorOrient.test.ts` now loads the packs itself, so the check no
  longer depends on test order.
- **Left for the author:** ratify D85, D93, D94, D95 and the amended C14, C22, D81, D82, D90; re-film the demo
  video; decide whether `Aa` meaning both Text and Filter's match case is a problem; eyeball the liquid fold at
  real speed (light theme, a card inside a group, mixed socket types).

### SESSION DIGEST (2026-09-29: column name suggestions for the Decision Matrix flow; cloud session)

- **Frame headers suggest column names** ([[D92]] columnNameSuggest): the plugin hands the Frame editor a
  `columnNameOptions` function (read on header focus) over every column typed under a Frame or Cube property;
  the header runs the popup's own `CellSuggest`, a pick sets the column's type, and a Suggest column names toggle
  (on by default) turns it off. API v1 grows `columnNames()`, which the Decision Matrix view's Add criterion reads.
  Specs: [[obsidian-plugin]] § Column name suggestions, [[table-popup]] § Editing a cell. Not yet exported to
  Solenoid-Properties or checked in the rig (no Obsidian in the cloud container); the header list was checked in
  the app's popup through the dev server; the Decision Matrix e2e now covers it in Obsidian 1.13.7. A name typed more than one way shows each type's glyph (`#` `T`, the type button's) and a
  pick sets the name only; the API's options carry `types` beside `type`.

### SESSION DIGEST (2026-09-28: Cube types at every depth, cell kinds; cloud session)

- **Cube types at every depth, cell by cell** ([[D90]] cubeTypesAtDepth, superseding D80 on the author's word): a
  column's type holds its values, lists and Tables; each Frame or Cube nested in a cell has its own declarations, kept
  in the source's `nested` map keyed by the table's records path (`cubeTypes.ts`: `{ frame?, types? }`), so one
  column's rows can hold differently shaped, differently typed tables. The plugin keeps them per note
  (`nestedTables` in `data.json`), which Vault Folder and Import Obsidian Note read. Specs: [[frame-verbs]] § The Cube
  value, [[table-popup]] § Editing a Cube Input.
- **Cell kinds** ([[E16]] cubeCellKinds): every Cube editing cell, list items included, has a Value / List / Table /
  Frame / Cube menu at its edge (`CellKindMenu`, `convertCellKind`), Table being the app's 2-D shape. A Frame cell is
  declared, derives a real Frame (`frameCellFromRecords`) and holds only values; undeclared records are a Cube, so
  the editor no longer labels a flat nested table "Frame" by its contents.
- **Review plan block 15** (the hand-resolved merges): `getOwningEditor` finds a node in a closed composite on any live
  canvas; an Import Obsidian Note Refresh re-reads plugin picks for an unchanged note; every card component reads its
  own graph (`getOwning*`), pinned by `sourceInvariants.test.ts`. The `engine.rs` auto-merges pass `cargo test`.
- **Review plan block 1** (the settings sweep): cards whose formula twin has a blank role but ignored it now read it
  (Date Diff basis, DDB / VDB factor, DOLLAR / FIXED decimals, LOG base, GESTEP step), Find Peaks' minimums read a blank
  as no minimum, Clamp's tooltip matches its code, and the audit sheet gained the QUARTILE rows with
  `settingsAudit.test.ts` holding its formula table to `ARG_ROLES`. MAKEARRAY's required Rows / Cols wait on the author.
- **Review plan blocks 2 and 3:** the one-row list convention checks out against [[D85]] columnsStayColumns (TAKE / DROP
  tooltips now say it). Against [[D48]] classifyNonFinite, the MODEs, the Mode card and PRODUCT answer `#DOMAIN!` on a
  NaN (PRODUCT moved onto the shared kernel), and no repeated value is Excel's `#N/A`. A pivot group past a call's
  argument limit no longer throws (`pivotFrame`), nor do the chart renderers on long data.
- **Table popup formats:** a Custom column format gets its pattern box (`CustomPatternField`), and the summary footer's
  sums, means, extremes and dates read through the column's format (`statReadsAsCell`).
- **Review plan, the rest (blocks 4–44):** every block is checked; what stands is recorded in place in
  `docs/review-plan.md`, and the open lines left are author decisions or need the Obsidian rig. The fixes carry their
  tests; the ones worth knowing: native Polars now runs in CI (`test.yml` `rust` job; the fuzzer then found and the
  engine fixed a rolling-sum drift and a last-n-after-groupBy row loss), frontmatter reads and writes as Obsidian's
  js-yaml does (CRLF, control characters, ambiguous keys, indented blocks), a vault Write subfolder can't climb out on
  Windows, °F reads back as typed, a wired plain number beside °C readings is a reading, live cards drop a reply for a
  URL they moved past, a locked canvas drops keyboard focus in cards, and the midnight rollover sees Cube Input and
  Knap `'now'`. New leaf: [[C117]] usNumberText (US number text only, the author's rule). Inbox:
  `temperature-difference-converts-by-scale`. For 1.6 in the backlog: Equation outputs vs the formula surface.
- **Cloud sessions can run `cargo test`** once WebKitGTK's dev packages are installed (`libwebkit2gtk-4.1-dev
  libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev`); the first build takes about six minutes.

### SESSION DIGEST (2026-09-27: Cards view, resizable formula popup; cloud session)

- **Cards view** ([[C114]] cardsView, asked for by the author, who judges the result): every frame popup has Grid,
  Cards, (Form,) CSV. Each row is a card in one narrow column; `planCards` (`cardLayout.ts`) derives the card's parts
  (key, title, subtitle, date, headline number, chips, flags, stat tiles, clamped prose, thumbnail) from the column
  names, types and cells, deterministically. A filter, a one-key sort and Show More sit above; Edit in Form jumps an
  editable row to the Form view. Every popup opens in Grid; Cards is an option. Spec: [[table-popup]] § The Cards view.
  Checked in headless Chromium at 1400 and 390 pixels, both themes.
- **Cards, second pass:** a name pair joins into the title, Start/End dates make a range, Tags split into chips, hex
  colors get swatches, Rating stars, percent and progress-like columns get meters, a currency column can be the
  hero, http and email cells are links, and a card past 6 fields folds behind Show All N Fields. Pictures are
  `data:image` only, never fetched, as in the grid ([[D83]] imageTextCells); the first pass fetched web images.
- **Record ↔ Cards** ([[B11]] maximalMerge, [[C114]] cardsView): Record's single-record view is renamed **Detail**
  (`detail`), and a **Cards** view (`cards`, no layout socket) draws the popup's derived cards as a figure in the Gallery's
  masonry (`MasonryGallery`), planned in the node over up to 2000 rows (`RecordDeck`). The card is one component,
  `AutoCard`, in both places. The popup's overflow menu adds **Add Record: Cards**, placing a wired Record node in the
  first clear spot right of the host. The Cards from files seed gained a Catalog gallery.
- **Record Rows:** the scalar Row (Detail only) became **Rows** on every view: a number or a list (`numlist`, typed
  `1, 3, 5`, `picks` role, negatives from the end), blank for every row. Detail's pager is its own `page` among the
  picks, so a wired list still pages. The CSV field now takes a `(default X)` placeholder (`all` here).
- **Cards demo data:** `scripts/gen-cards-demo.cjs` writes `demo-vault/Data/{crew,products,orders}.csv` (drawn
  `data:image` avatars and product pictures, tags, colors, ratings, progress, date ranges, links) and the
  **Cards from files** seed (Tables): Local File nodes into Filter, Sort, Head, a Computed Column, Keep lookups, two
  Joins, a Keep that picks the order card's fields, and two GROUPBYs. It runs on the web build through the bundled
  demo vault. The data hangs together (skills and bios by team, Paid by status, backorder notes on out-of-stock
  lines); joining whole tables made nonsense cards, so the joins take lean lookups. The joined frame led to two planner fixes: a second picture column
  draws as a picture, never prose, and a lone Last Name no longer counts as name-like.
- **The formula popup resizes** (Expression, Equation, LAMBDA, the table lambdas): the Table popup's corner grip, and
  the editor's own vertical grip before the first drag, as the CSV block has; once sized the editor fills.

### SESSION DIGEST (2026-09-28: plugin 0.1.5 on Solenoid-Properties main, its whatsnew video; cloud session)

- **Plugin 0.1.5 replaces 0.1.4** (whose release failed the Obsidian review): TableCards' dead eslint directives are
  gone, the Knap marker regexes are built from their constants, and the Knap views use `createSpan`/`createDiv`. Only
  the Release run is left (`docs/backlog.md` § Obsidian).
- **The whatsnew cut is 0.1.5's** (author approved the render): typing about 2.5x faster, the Knap totals held against
  the Frame's qty column and its footer Sum, and `wn-cards`, a crew Frame on Obsidian's phone emulation panned across
  in Grid, then Cards and a filter. Recorded in a cloud container; the setup that works there is in the `demo-video`
  skill. Not yet in `assets/video/` (backlog).
- **The plugin's `main.js` is 626 kB again** (960 kB after 09-27): `closeParens` moved to its own `closeParens.ts`, since
  importing it from `excelFormula.ts` pulled Formula.js and jstat into the plugin; the plugin draws the Cards rules with
  Obsidian's `MarkdownRenderer` through a `components/Markdown` shim, so `marked` stays out (spec: [[obsidian-plugin]]).
  The Cards view itself is the rest of the growth over 581 kB. Checked in a real Obsidian 1.13.7 through the rig.
- **The export refuses an unpinned package:** a copied file importing a package missing from the snapshot's
  `package.json` stops `plugin:export` (it had shipped a snapshot whose `tsc` failed on `marked` and Formula.js).

### SESSION DIGEST (2026-09-27: Knap notes in the Obsidian plugin; cloud session)

- **Knap notes** ([[D87]] knapNotes, asked for by the author): a note with `knap: true` renders its body in Reading view
  as its Note card does, from its own properties; a bare `{{ name }}` on a List, Matrix, Frame or Cube property is the
  property's chip in the body, editing the property. Live Preview renders too, piece by piece: a tag, or an `if` /
  `for` block whole, shows its output until the cursor enters it (`knapLive.ts`). Spec: [[obsidian-plugin]]
  § Knap notes. Checked in a real Obsidian 1.13.7 through the rig (loop and `if` across paragraphs, chip Save writing
  the property, refresh on a property change, errors, embeds, switching off).
- **Module split** so the plugin can bundle Knap without the formula engine: `toTemplateValue` moved to
  `templateValue.ts`, `guessScalarText` to `scalarText.ts`; `bareTags` in `knapTemplate.ts` finds the bare tags
  `embedBareVariables` rewrites. The plugin's `main.js` is 581 kB (477 kB before; the difference is Knap).
- **Live Preview details:** an error waits for a 1.5 s pause in typing (a half-typed tag fails to render), and Up/Down
  enter a drawn block, which the editor stepped over.
- **The `whatsnew` video cut** (`scripts/demo-video/whatsnew.mjs`, plugin 0.1.4, 1080p60 via `DEMO_FPS=60`), approved by
  the author; the render sits in `.dev/video/`, uncommitted, and ships with the next app version bump.
- **Rig in a cloud container:** Obsidian's Linux tarball unpacks to `/opt/Obsidian`; Xephyr is absent, so a stand-in
  script running `Xvfb` on the same display (and a no-op `metacity`) lets `npm run plugin:rig` run unchanged.
