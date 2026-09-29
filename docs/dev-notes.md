# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-29b: ROW() hint, Frame Input header legend, List Input Source; cloud session)

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
  picks, so a wired list still pages.
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

### SESSION DIGEST (2026-09-26: XY plots from issue #3; branch `claude/feature-requests-vh44bk`)

- **XY plots** ([[D91]] xyColumnMapping, new): Scatter, the new **XY Line** op (Cartesian) and Bubble emit an `xy`
  payload drawn by one `XYView`. Options name the columns: `x`, `y` (comma list), `s` size, `c` color (numeric ramp
  with a colorbar, or text categories), `annotate` point text, `by` split into series. `linestyle` joins points in row
  order, broken at gaps; `aspect=equal` and `xlim` for parametric curves. A missing column is `#REF!` on the card.
- **Merge Plots** overlays XY sources on one numeric plane (Bubble no longer refused); a Line or Area joins by numeric
  label or row position, bars are `#TYPE!`. The old index-plotted Scatter and `BubbleView` paths are gone.
- Chart Builder gains the ten XY rows; chart-showcase seed has a Lissajous XY Line group. Contests recorded on
  [[C96]] chartOptionsAreMatplotlib and [[D75]] builderExposesEveryOption (keep).
- **Checked after the merge (2026-09-28):** an XY Line draws right in a Display and embedded in a Report (equal aspect,
  colorbar). Not yet: a Composite boundary shot, and the demo video isn't re-filmed.

### SESSION DIGEST (2026-09-26: SPARKLINE, typed Cube columns, lists, Add-menu search; author present)

- **SPARKLINE(range, [type])** answers an 80 × 20 SVG as `data:image/svg+xml` text (line, column or win/loss, the
  Sparkline node's types; Default gold, win/loss in green and vermilion), averaged to 40 points past that ([[D82]]
  sparklineCell). A text cell holding a `data:image` picture shows as the picture in Frame and Cube cards and popups
  ([[D83]] imageTextCells).
- **Typed Cube columns** ([[D90]] cubeTypesAtDepth): Cube Input's root header has the type button (None, Number, Text,
  Date, Boolean, Formula). A type overrides every kind in its column: scalars and list items read as Frame cells
  (NaN when unreadable, [[D93]] oneTextReading). Nested tables: see the 2026-09-28 Cube digest. `cubeText` stays
  plain records until a column is typed or computed, then `{ columns, rows }`. The plugin's cube editor has the button
  without Formula and saves the picks as a Frame's.
- **Cube formulas read lists** ([[D81]] cubeRowLists): in Cube Input's Fx columns and the Computed Column node over a
  Cube, `@name` on a list column is this row's list and a row may answer a list; `SPARKLINE(@history)` per row works.
- **Lists** ([[D85]] columnsStayColumns, the author's call): a list is one row everywhere, so INDEX is strict on it
  (`INDEX(x, 2, 1)` is `#REF!`); TOCOL, BYROW and MAKEARRAY(n, 1) answer one-column tables; TOROW is the list and reads
  row by row as Excel's does; SEQUENCE(n) stays a list. TOCOL and TOROW take Excel's `ignore` and `scan_by_column`, on
  the Table Reshape card as a By row / By column toggle and a skip picker. TAKE and DROP count a list's items as
  columns (`TAKE(x, , 2)`), on the formula and the TAKE / DROP card. SORT, SORTBY and List Sort order text and
  mixed kinds (`compareListCells`); SORTBY keeps its `sort_order`. Every list popup has the Source checkbox; a mixed
  list opens as text with a gray chip. Type Check gains ISERR.
- **INDEX** (the author's call): the card shows one Position socket on a list and Row / Column on anything else, through
  the ordinary socket swap; one index walks a one-row or one-column table as in Excel (`INDEX(TOCOL(x), 3)`); the hint
  reads `INDEX(array, [row], [col])`. Positions may be lists, on the card and in the formula, as Excel's array
  arguments; CHOOSEROWS and CHOOSECOLS stay table verbs on a list. A typed skip reads as Excel's in INDEX, EXPAND,
  TAKE and DROP (`EXPAND(m, 3, , 0)`, [[C80]] blankArgIsExcelBlank).
- **Blank roles** ([[D86]] blankRoles, the author's call, absorbing D33 and E15): data blanks stay blank; a blank setting
  (count, size, mode, digits) is its default, overriding the typed value, item by item in a list; a blank pick is dropped;
  no fallback is `#SYNTAX!`. One declaration, `ARG_ROLES` (`inputRoles.ts`), read by formulas (`applyArgRoles`) and by
  cards (`static inputRoles = rolesFrom(...)`, `readRole`); spec [[input-roles]], which also took value-semantics' role
  table. A blank in a table of positions is `#SYNTAX!` in that cell. D86 is written in the author's words.
- **SORT, SORTBY, FILTER, UNIQUE on tables** ([[D85]], the author's call: strict Excel): formulas take tables and Excel's full
  signatures; on a list SORT and UNIQUE change nothing without by_col. List Sort (Rows / Columns, key rows with their own
  order), List Filter (a table's rows tested on one Column) and UNIQUE (Rows / Columns, Only singles) take `anydata`, so a
  list stays a list. Kernels `sortGrid`, `sortGridByKeys`, `filterGrid`, `uniqueGrid`.
- **Excel-signature parity** ([[A5]] excelParity): `excelArityParity.test.ts` checks every registered Excel name's arity
  against Excel's (`fixtures/excelArity.ts`); the ones still short are listed with a reason and the list only shrinks.
  Filled in the author's absence: MODE.MULT's several ranges; TEXTSPLIT's row delimiter, ignore_empty, match_mode and
  pad_with; TEXTAFTER / TEXTBEFORE's instance_num, match_mode, match_end and if_not_found; VDB's no_switch; TREND and
  GROWTH's const. `settings-audit.md` proposes the settings sweep's roles for review.
- **The settings sweep** ([[D86]] blankRoles, built on Claude's judgement at the author's word): `ARG_ROLES` covers about
  150 functions; the cards read their settings through `readRole` (Series per op, `readAsRole`); a blank filter condition
  skips the condition ([[C24]]'s consequence overturned). A required setting with a working Excel blank reads as it
  (a blank `cumulative` is FALSE), otherwise `#SYNTAX!`; distribution parameters are data; CLAMP's blank bound is no
  bound. For review: `settings-audit.md`.
- **Socket labels** carry no parentheticals: "(1-based)" moved to the Inspector's socket notes ([[C19]] namingModel, the
  author's words); the rest are a backlog sweep.
- **Card op switches** now reshape their sockets: Table Reshape (it never did) and By Axis (BYROW a table, BYCOL a list).
- **Add-menu search:** Excel-name rows read "SORTBY → List Sort", or "NORM.DIST → Distributions: Normal" when the name
  is one op's formula name ([[C19]] namingModel, amended on the author's word); a search shows one row per thing placed
  (`places`); every row carries its card's family name; op `keywords` reach their rows. `npm run search-samples` prints
  46 sample queries, one per kind of searchable row, as a Markdown table (`searchSamples.test.ts` pins them).
- **Open:** ratify D86 blankRoles (C80 could fold into it, on the author's word); a review of the settings sweep
  (`settings-audit.md`); whether List Sort and List Filter keep their names now they take tables; the parity list's
  remaining gaps (backlog); the Cubes and lists section of the backlog, next up a blank in a typed list literal; the
  plugin release (its snapshot is on Solenoid-Properties `develop`). Array constants are deferred (`deferrals.md`). The
  outbox is empty.
