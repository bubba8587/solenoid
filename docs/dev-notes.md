# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-30c: 1.5 release notes, the cube formulas seed; cloud session)
- `docs/release-notes-features.md` is the 1.5 selling list and carries the 1.4.1 and 1.4.2 headliners (author); Heatmap is not a headliner, Cubes take two slides, and the plugin release ships beside the app. The What's New deck is still 1.4.1's.
- New seed **Cubes: records with their own lists and tables** (`cube-formulas.json`, Tables): a gradebook (per-student score lists: drop the two lowest, missing count, quiz slope, weighted grade, a check-in filter) and a portfolio (per-holding lot tables and price histories: cost basis, harvestable loss, max drawdown via SCAN), each ending in charts and totals rather than a Display of the cube (author).
- **A range function's one-value arguments lift** (formula-language § Range functions, `RANGE_SCALAR_ARGS`): a list where LARGE's k, PERCENTILE's p, RANK's number or a criteria value goes runs the function per item, as Excel does. It never worked (v1.4.2 answers the same): range routing hands every list whole, and nothing said which arguments were ranges, so each implementation misread the list (LARGE blank, PERCENTILE a false `#OVERFLOW!`, COUNTIF and SUMIFS a silent 0). `orient` was not the gap; it covers only the whole-list natives. LARGE and SMALL with k below 1 are `#DOMAIN!` now, card and formula ([[D70]]).
- **Narrow screens tightened** (author: the popup editor first, then the app), each checked in true mobile mode (the CDP user-agent override with `userAgentData.mobile`, since headless Chromium reports false) at 390 and 360 px: the table and Cube popups' grid is compact, not finger-sized (a header name as wide as its text through the input's `size`, no format chevron, 60% height), the popup title bar is 44 px, the Cards sort box shows its whole pick (the backlog item), the CSV view gets real height, the tools row fits under 380 px (30 px buttons), the Reference tabs scroll on one line with a plain close, and a long formula's typeset preview scrolls from its start instead of clipping both ends (desktop too).
- **Table editors: Insert and Delete menus replace the footer's button row** (table-popup § The grid, § The Form view, § Editing a Cube Input; author): rows and columns insert and delete anywhere, on the selected rows or columns (row numbers, column headers, a focused header name, Shift to extend; the author removed a column-letter strip), else the focused cell's, else the last. A right click opens both at the pointer. Every per-column state follows a moved column (names, types, formulas, formats, footer stat, sort, live format keys, computed values); a Cube level's nested declarations follow their rows (`shiftNestedRows`). An open menu takes Escape before the popup (`escapeLayers.ts`), which also fixes the ⋯ menu closing the whole popup. Checked in the app through Playwright (Frame, Form, Table Input, Cube record and list levels, a Save round trip) and measured at 412 and 360 px under a coarse pointer. The demo-video scripts click the menus now; the videos need a re-film.
- **Collapse sweep** (components § Collapsed; author: measure, don't eyeball): `scripts/collapse-sweep.mjs` mounts all 678 collapsible catalog cards, computes them, and measures every socket, the pill and React Flow's cable bounds expanded, collapsed and (`--wired`) with every input cabled; `--empty` lists cards that show nothing collapsed. Fixed: a pill hanging halfway off an emptied body (the 36 px floor), several cards drawing two pills or leaving sockets unpilled (Fx, SUMIFS, Filter, Join, Reconcile, Chart Builder, Composite outputs), and every card that went blank collapsed now shows its value, chip or a placeholder (Slider, Candlestick, Import XML, Vault Folder, Write to Obsidian, QR Code; connection cards through `sol-conn`). Found on the way: `__collapsed-only` boxes also showed on open chart cards (a specificity loss to `--chip`). Still flagged, on purpose until the author rules: the solver cards (TVM, Ohm's Law, Triangle Solver and kin) keep one row per variable collapsed instead of a pill, Conduit's sockets sit outside its edge, and some settings still show collapsed (Expect, Grid Painter, Curve, Point Plotter, RANDARRAY, Color, Resistor Code, Query's buttons).

### SESSION DIGEST (2026-09-30b: oldest-first code review, 1.0 import through August; cloud session)
- Walked every file whose last hand edit (sweep commits of 40+ files excluded) predates September; September's 589 files are left for a later walk (the author: confident in them for now). Open leads: `backlog.md` § From the 2026-09-30 oldest-first review.
- Two security holes closed: the SVG Picker scrubs markup in its class (`source` getter), so a loaded or pasted file can't inline script through an `SvgFigure` ([[C103]] untrustedContentSeams); the string editor's save endpoint binds 127.0.0.1, takes only scanned `src/` files and refuses a foreign Origin.
- One complex operand reading for card and formula (`cxValue.ts` `toCx`: a real is z + 0i, text parses, else #TYPE!); Polynomial Roots keeps every coefficient in its slot (an error propagates, a blank leaves the roots unknown).
- `graphSettled()` (`process.ts`, compute-pass spec § Single flight): a caller outside a pass awaits it after `processGraph` before reading results; Tornado and model fuzz do.
- Every hand-rolled draft field found now runs on `useDraftCommit` (Document Properties, Angle Dial, Date Range, Color Picker hex): Escape cancels, a pending draft flushes ([[C95]] commitOnEnter).
- `makeOpNodeComponent` (`standardNode.tsx`) is the op-picker card; 32 cards moved onto the standard factories. Pass-through cards (IF, IFS, CHOOSE, SWITCH, IFERROR, Expect) show tables through `ResultDisplay`.
- The readInput sweep also scans `scripts/new-node.mjs`, whose template now reads through `readInput` ([[D86]] blankRoles).
- Deleted as dead: `highlightUtils`, `hicColors`, `flow/flowSeeds`, `RandNode`, FormulaField's unreachable inline editor, cssColor's `toCss`/`mixSrgb`/`flowTint`, `parseFredObservations`, `snapCoord` and a dozen unused store members and exports.

### SESSION DIGEST (2026-09-30: the Heatmap figure, Tidy fixed points, group collapse round trips; cloud session)
- Heatmap is a figure node now: frame, table or list in, a `heatmap` chart value out; the pass-through `HeatmapCellNode` and its hardcoded blue-yellow-red card are gone (`tree/specs/computation/chart-figures.md` § Heatmap, § The CSS and canvas figures).
- Square, touching cells by default (`aspect=auto` fills); seaborn's `cmap`, `center`, `vmin`, `vmax`, `annot`, `fmt`, `cbar` plus `origin`, all in the Chart Builder's new Heatmap target. No `cmap` means the palette's height ramp, or its diverging ramp with a center, so the default follows the theme.
- Histogram 2-D emits the heatmap figure (matplotlib's `hist2d`: discrete bins, y upward) instead of a smoothed contour, and takes every heatmap key. Calendar Heatmap takes `cmap`, `center`, `vmin`, `vmax`, `cbar` (a colorbar, on by default) and shows the hovered day's date and value; with no cmap it keeps the accent.
- Calendar Heatmap wraps its weeks into up to four bands and sizes its card to them, so a year reads at 8 px or more a day on the card.
- Surface and Vector Field have an Options input (Chart Builder targets Contour, Surface, Vector Field): `cmap` on all three; the Flat view adds axes with round ticks, axis titles, `center`/`vmin`/`vmax`, a colorbar and a hover readout of the interpolated height.
- Chart Builder: switching the target clears the fields and cables the new figure does not read (author); only Gantt's calendar layout still dims rows it ignores.
- Tidy and Cleanup: ELK packs disconnected components (no `INCLUDE_CHILDREN` on the root; flipped layouts keep it), Cleanup waits for the collapsed sizes before its top-level Tidy (a second Cleanup is now a fixed point), each card moves once, and the layer split no longer lives in a module variable (the landing scene read a stale one) (`tree/specs/canvas/auto-arrange-tidy.md`).
- Tidy and Cleanup are fixed points: a sub-pixel change in what ELK is handed flipped whole layouts, so Tidy, the standoff solve and autofit land on whole pixels and a docked FC's socket is read from layout offsets, not the zoomed screen (a second run moves 0 px on the eight seeds probed).
- Tidy alignment gains Balanced (the default: ports halfway to the real socket heights) and Sockets (level cables). Scored against the joined cards' heights, Balanced keeps cables within their cards' band without Sockets' staircase. Every seed is re-baked; `seedTune` tidies with groups expanded. The Power features seed's standoff now pins the Standoffs note under Monitoring, per [[C89]]; it tied Sensor B to its consumer, which left Sensor B stranded.
- Group collapse and expand round-trip exactly: every group of all 28 seeds, three trips each, returns every card to the pixel (it drifted up to 1000 px on unit flow). The collapse read the card's old size from React Flow's cache; standoff solves snapped unrelated slanted standoffs (now scoped to the clusters an op touched); a collapse's standoff re-solve went unrecorded and could shove the canvas (now recorded and undone on expand, and skipped when it would land on a box); and the no-overlap pass treated a cluster's bounding box as solid. Specs: `tree/specs/canvas/group-expand-push.md`, `tree/specs/canvas/standoffs.md`.
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
