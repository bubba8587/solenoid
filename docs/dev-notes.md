# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

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
  TAKE and DROP (`EXPAND(m, 3, , 0)`, [[C80]] blankArgIsExcelBlank); a blank value blanks the answer, as on the cards.
- **Card op switches** now reshape their sockets: Table Reshape (it never did) and By Axis (BYROW a table, BYCOL a list).
- **Add-menu search:** Excel-name rows read "SORTBY → List Sort", or "NORM.DIST → Distributions: Normal" when the name
  is one op's formula name ([[C19]] namingModel, amended on the author's word); a search shows one row per thing placed
  (`places`); every row carries its card's family name; op `keywords` reach their rows. `npm run search-samples` prints
  46 sample queries, one per kind of searchable row, as a Markdown table (`searchSamples.test.ts` pins them).
- **Open:** a wired blank in INDEX, EXPAND, TAKE and DROP's size slots (backlog; the typed blank slot is ruled); the Cubes and lists section of the backlog, next
  up SORT and FILTER on a matrix; an Excel-signature parity check (backlog); the plugin release
  (its snapshot is on Solenoid-Properties `develop`). Array constants are deferred (`deferrals.md`). The outbox is empty.

### SESSION DIGEST (2026-09-25b: the demo video, and what filming it found; author present)

- **The demo video is generated, not edited by hand:** `scripts/demo-video/` films the real app in headless Chromium
  and a real Obsidian running the Solenoid Properties plugin on a virtual display, then cuts it with ffmpeg: captions,
  title cards, crossfades, callout boxes, post zooms and a synthesized soundtrack. Obsidian scenes are filmed live
  (the plugin's look switched on, a 40-row Frame pasted into a new property, the written note opened); side-by-side
  scenes pair a Solenoid screenshot with an Obsidian grab per state (palettes and light mode, the imported note).
  Running and redoing it, and every mechanic that bit: `.claude/skills/demo-video/SKILL.md`.
- **Two cuts** (`cuts.mjs`): `demo`, the app tour, kept as `assets/video/solenoid-demo.mp4` (2:27) with its poster;
  and `obsidian`, a story for Obsidian users: meeting notes and an attendees String List property, the popup's Grid
  and CSV views, then an emailed table typed into a Frame property through its Form view, all in Obsidian; then,
  after a card that opens Solenoid, the note joined to a roster note and totaled with PIVOTBY, the chart written back
  into the note, and the look in both apps. Its Solenoid scenes film Obsidian and a real Solenoid window side by side
  on one display. Frame zero of each is its title card, also embedded as cover art. Renders land in `.dev/video/`
  (gitignored).
- **Solenoid Properties wordmark**: `src/logo/solenoidpropertieswordmark.svg`, the coil beside SOLENOID PROPERTIES in
  Atkinson Hyperlegible Next 800, outlined at the Solenoid wordmark's size, baseline and spacing. The demo vault
  gains `Sales/Q3 review` and `Sales/Divisions` for the obsidian cut's story.
- **App fixes it found**, one commit each: opening a Report no longer takes the app down (a hook after an early
  return); chart value axes write compact ticks in a gutter that fits them; the vault cards gate on `hasFs()` like
  their nodes; Open in Obsidian on the Write card follows the write, not the shell; a frame's CSV edit types the
  columns it adds from their values (`columnTypesAfterCsvEdit`, once the block is left or saved from); the demo
  vault's showcase note no longer retypes every project's `budget` and `milestones` (its keys are `purchases` and
  `inspections`; the projects' `milestones` is a Frame); an Equation linear in an unknown that appears more than
  once (`p = n*25 - (f + n*10)`) solves it exactly instead of by bisection (`solveLinear`).
- **Open:** the author listens to the soundtracks and picks where each video is published (backlog, Demo video); the
  Frame popup's blank-header-line item in the backlog (the author held that behavior until a change is shown
  rigorous). The outbox still lists A1, B1, B2, B3, B7.
