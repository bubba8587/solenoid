# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-27: Cards view, resizable formula popup; cloud session)

- **Cards view** ([[D88]] cardsView, asked for by the author, who judges the result): every frame popup has Grid,
  Cards, (Form,) CSV. Each row is a card in one narrow column; `planCards` (`cardLayout.ts`) derives the card's parts
  (key, title, subtitle, date, headline number, chips, flags, stat tiles, clamped prose, thumbnail) from the column
  names, types and cells, deterministically. A filter, a one-key sort and Show More sit above; Edit in Form jumps an
  editable row to the Form view. A phone-width popup opens a frame in Cards. Spec: [[table-popup]] § The Cards view.
  Checked in headless Chromium at 1400 and 390 pixels, both themes.
- **The formula popup resizes** (Expression, Equation, LAMBDA, the table lambdas): the Table popup's corner grip, and
  the editor's own vertical grip before the first drag, as the CSV block has; once sized the editor fills.

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
  the author; the render sits in `.dev/video/`, uncommitted. Plugin 0.1.4 and the video ship with the next app version
  bump (`docs/backlog.md` § Obsidian).
- **Rig in a cloud container:** Obsidian's Linux tarball unpacks to `/opt/Obsidian`; Xephyr is absent, so a stand-in
  script running `Xvfb` on the same display (and a no-op `metacity`) lets `npm run plugin:rig` run unchanged.

### SESSION DIGEST (2026-09-26: SPARKLINE, typed Cube columns, lists, Add-menu search; author present)

- **SPARKLINE(range, [type])** answers an 80 × 20 SVG as `data:image/svg+xml` text (line, column or win/loss, the
  Sparkline node's types; Default gold, win/loss in green and vermilion), averaged to 40 points past that ([[D82]]
  sparklineCell). A text cell holding a `data:image` picture shows as the picture in Frame and Cube cards and popups
  ([[D83]] imageTextCells).
- **Typed Cube columns** ([[D80]] cubeColumnTypes): Cube Input's root header has the type button (None, Number, Text,
  Date, Boolean, Formula). A type overrides every kind in its column: scalars read as Frame cells (NaN when
  unreadable), list items as List Input's (blank when unreadable), nested tables column by column. `cubeText` stays
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
