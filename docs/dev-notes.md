# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-26: SPARKLINE and typed Cube columns; author present)

- **SPARKLINE(range, [type])** answers an 80 × 20 SVG as `data:image/svg+xml` text: line, column or win/loss, the
  Sparkline node's types in the Default gold (win/loss in green and vermilion), averaged down to 40 points past that ([[D82]] sparklineCell). A text cell holding a
  `data:image` picture shows as the picture in the Frame and Cube cards and popups ([[D83]] imageTextCells).
- **Typed Cube columns** ([[D80]] cubeColumnTypes): Cube Input's root header has the type button (None, Number, Text,
  Date, Boolean, Formula). A type overrides every kind in the column: scalars read as Frame cells (NaN when unreadable),
  list items as List Input's (blank when unreadable), nested tables with every column set to the type. `cubeText` stays
  plain records until a column is typed or computed, then `{ columns, rows }`. The Solenoid Properties plugin's cube
  editor has the button without Formula and saves the picks as it saves a Frame's (the cube replaces its map).
- **Cube formulas read lists** ([[D81]] cubeRowLists): in Cube Input's Fx columns and the Computed Column node over a
  Cube, `@name` on a list column is this row's list and a row may answer a list; a bare list column is `#SHAPE!`
  pointing at `@`. The target shape works: a Cube with a Number-list column and an Fx column `SPARKLINE(@history)`.
- **Popups:** every list popup has the Source checkbox (Table popup and Cube popup list levels); a mixed list opens as
  text and its chip wears the neutral gray instead of the number amber (it was the default tint, not a guess).
- **INDEX on a list** now treats it as one row, as ROWS and COLUMNS already did: `INDEX(x, 1, 2)` is the second item,
  `INDEX(x, 2, 1)` is `#REF!` ([[C15]] matricesInFormulas); one index still walks along it.
- **List audit** (after the author's worry): SORT and the List Sort card never sorted text (a text list came back
  unchanged); now numbers, then text by character code, then FALSE/TRUE, with blanks, errors and NaN last
  (`compareListCells`). SORTBY takes text keys and its `sort_order`, which it used to drop silently. A list is one row
  everywhere ([[D85]] columnsStayColumns, the author's call): TOCOL, BYROW and MAKEARRAY(n, 1) answer one-column
  tables (so `m / BYROW(m, SUM)` divides each row by its own total), TOROW is the list and reads row by row as Excel's
  does, INDEX is strict, and SEQUENCE(n) stays a list. The Table Reshape and By Axis cards follow, and their op switch
  now reshapes the sockets (Table Reshape's never did). A one-row-matrix change to INDEX that shipped by accident is
  reverted. TAKE/DROP on lists, blank list literals, INDEX's blank position and
  SORT/FILTER on matrices wait on the author (backlog, Cubes and lists).
- **Table Reshape and search:** TOCOL/TOROW take Excel's `ignore` and `scan_by_column`, and the card carries them as
  a By row / By column toggle and a skip picker. Type Check gains ISERR (current Excel beside ISERROR). The reshape rows gain "table reshape" keywords, so the family name finds them.
  Excel-alias rows read "SORTBY → List Sort", or "NORM.DIST → Distributions: Normal" when the name is one op's formula
  name and the row places that op ([[C19]] namingModel, amended on the author's word); "Card: Op" is only ever an op.
  Every row carries its card's family name (the hover hint's), so "bessel" or "is test" finds the family.
- **Search samples:** `scripts/search-samples.ts` (46 queries, one per kind of searchable row) runs in
  `searchSamples.test.ts`; `SEARCH_SAMPLES_OUT` writes the table's JSON. It found two gaps, both fixed: an op's
  keywords never reached its row (`fromMeta` dropped them), so "kanban" missed "Record: Board"; and List Sort had no
  argument words ("descending").
  A search shows one row per thing placed, so "SORT → List Sort" no longer sits beside "List Sort" (`places`).
- **Open:** a one-row matrix under one INDEX index (the author holds it for now, backlog); the plugin snapshot
  re-export (backlog, exported to Solenoid-Properties `develop`). The outbox is processed: A1, B1, B2, B3, B7 are ratified.

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
