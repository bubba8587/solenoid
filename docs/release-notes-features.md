# Solenoid 1.5: feature highlights (selling list)

Curated, high-value features that will sell 1.5: the source material for the release
notes (the author writes the final copy) and the **What's New** slides. Living doc:
keep it current as features land; each entry is a *benefit*, not a changelog line.
Order = rough selling priority. Mark `[slide]` on the ones worth a What's-New slide.
The bar for what earns a spot: `archive/release-notes-1.1.md` (a sell is a shiny thing
a user will go discover and play with, or something that would inspire a download;
What's New is not a changelog, GitHub is). There is no install base yet (author
2026-08-28): novelty *versus the last release* counts for nothing, only the bar above
makes something a slide. **The 1.4.1 list shipped with v1.4.1 and v1.4.2 and lives in
git history** (`git show v1.4.2:docs/release-notes-features.md`); this file covers
everything on `develop` since the v1.4.2 tag. The What's New deck
(`HelpDialogs.tsx`) still shows 1.4's slides.

## Headliners: the slide deck

- **[slide] Cards.** Any table opens as a stack of cards: the Table popup's new Cards
  view reads the columns and lays each row out on its own, with a title from the name
  columns, dates as ranges, tags as chips, ratings as stars, progress as meters, colors
  as swatches, links you can click and pictures inline. Filter, sort and Show More sit
  on top. Record's new Cards view puts the same cards on the canvas as a masonry
  gallery, and **Add Record: Cards** in the popup wires one up for you. The Cards from
  files example shows it off on a crew, products and orders set.
- **[slide] Cubes with typed columns.** A Cube Input column takes a type (Number, Text,
  Date, Boolean, Formula) the way a Frame's does, and it holds at every depth: a table
  nested inside a cell keeps its own column types, so one column's rows can hold
  differently shaped tables. Typed values read and show like a Frame's, and the
  Solenoid Properties plugin's cube editor has the same type button.
- **[slide] Any cell, any shape.** Every Cube cell, list items included, has a menu at its
  edge that turns it into a value, a list, a table, a Frame or a nested Cube. Formula
  columns read a list cell as that row's list and can answer one, so per-row math over
  nested data (`SUM(@prices)`, `SPARKLINE(@history)`) just works.
- **[slide] XY plots.** Scatter, the new **XY Line** and Bubble plot real x against y:
  name the columns (`x`, several `y`, `s` for size, `c` for color, `annotate` for point
  labels, `by` to split series), join points into a connected line, and set
  `aspect=equal` for parametric curves (the chart showcase draws a Lissajous figure).
  Merge Plots overlays any of them on one plane. Asked for in issue #3.
- **[slide] Sparklines in cells.** `SPARKLINE(range, [type])` draws a line, column or
  win/loss sparkline straight into a table cell, and in a Cube a formula column runs it
  per row: `SPARKLINE(@history)` gives every row its own trend. Pictures in text cells
  show as pictures in every card and popup.
- **[slide] Knap notes in Obsidian** (Solenoid Properties plugin). Put `knap: true` in a
  note and its body renders as a live template from its own properties, in Reading view
  and Live Preview. A bare `{{ budget }}` on a Frame or List property is the property's
  chip right in the text, and editing it edits the property. The plugin release goes out
  alongside the app.

## Release-notes body

- **Card sections.** Busy cards (Cast, Frame Input, XLOOKUP, Schedule, Gantt, Earned
  Value and more) group their settings under captions, and the secondary ones fold away.
  Folding a section with cables in it melts the sockets into one pill and buds them back
  out on reopen. A section opens by itself when anything inside is set or wired.
- **Type icons everywhere.** Number, Text, Date, Boolean and Complex draw as small icons
  in every type picker, column header and legend, and the Frame and Cube editors have an
  (i) in the corner that explains them.
- **Excel's table functions at full strength.** SORT, SORTBY, FILTER and UNIQUE take
  whole tables with Excel's full signatures; TEXTSPLIT, TEXTAFTER and TEXTBEFORE take all
  their options; TOCOL and TOROW scan and skip; INDEX takes lists of positions; TREND,
  GROWTH, VDB and MODE.MULT take their missing arguments. Every Excel name is checked
  against Excel's own argument list.
- **Add-menu search speaks Excel.** Typing an Excel name shows where it lives
  ("SORTBY → List Sort", "NORM.DIST → Distributions: Normal"), one row per card, with
  the card's family on every row.
- **Computed columns:** `ROW()` gives the current row number and `ROWS(price)` the count,
  so a column may be called `row` again. Formulas close their missing parentheses when
  you commit, and the formula popup resizes.
- **Table popup:** it asks before throwing away unsaved edits; a Custom format gets a
  pattern box; the summary footer shows sums and dates in the column's format; list
  editing suggests the list's own items. Frame Input and Table Input cards have an Edit
  button right on the card.
- **Cast does number parsing too:** to Number takes decimal and group separators, to Text
  takes a format (NUMBERVALUE folds into it).
- **Numbers look the same everywhere:** one General style on every card, grid and popup,
  with a Decimal places setting (default 4).
- **Tidy is steadier.** A second Tidy or Cleanup moves nothing, disconnected pieces pack
  together, and the new Balanced alignment (the default) keeps cables level without a
  staircase. Collapsing and expanding a group puts every card back exactly where it was.
- **Units read like a person would.** Two °C readings subtract to a temperature
  difference and can't be added; joins match 68 °F to 20 °C; a unit carries through
  lookups, LAMBDAs, IFS and SWITCH.
- **Big data holds up.** Lists past 125,000 values no longer fail, and formula columns
  over tall tables run far faster (a 40,000-row column went from about 2 s to 54 ms).
- **Charts:** every Chart Builder option works on every figure that shows it, titles
  included; switching the builder's target clears what the new chart won't read. Sankey
  merges repeated flows and lifts one on hover. Axes write compact ticks that fit.
  Exports keep their legend at any zoom, vault PNGs included.
- **Undo** restores the exact view you had and keeps your last edit even on very large
  documents.
- **Obsidian round trips:** frontmatter reads and writes the way Obsidian itself does
  (line endings, odd keys, dates with times, infinities), and the plugin's Frame editor
  suggests column names already used across your vault.
- **Webpage export:** math renders as MathML, pictures and SVGs are embedded, and values
  show in their column formats.
- **Safer to open other people's files:** an SVG can't carry script onto the canvas, and
  a File Link asks before it runs a program on Linux or macOS.
- **Record:** the single-record view is now called Detail, and Rows takes a number or a
  list (`1, 3, 5`) on every view.
- **Schedule and Gantt:** work divides by the calendar's hours a day, the resource
  histogram skips non-working days, and MS Project export handles repeated task names,
  elapsed lags and start-no-earlier-than dates.
- The palette reaches further: Add menu tints, the neutral card colors and sparklines all
  follow it.
- A long list of Excel-parity fixes at the edges (finance argument checks, YEARFRAC,
  DAYS360, NETWORKDAYS, QUARTILE, PERCENTRANK, GCD/LCM, text functions), on the card and
  in the formula alike.

## Heads up: things that changed shape

Pre-alpha, so no migration ([[B7]]); worth one line each in the notes so a 1.4 save that
opens differently isn't a surprise.

- The **Composed** chart is gone: Merge Plots over a Column and a Line chart draws the
  same figure.
- The **NumberValue** card is gone: Cast to Number does it.
- The bare `row` and `rows` names in computed columns are now `ROW()` and `ROWS(col)`.
- AVERAGEA, MINA, MAXA, STDEVA, STDEVPA, VARA and VARPA run as their plain forms.
- A list is one row everywhere, so `INDEX(list, 2, 1)` is `#REF!` (use `INDEX(list, 2)`).
- The list Group By is **Group Lists**; Record's Card view is **Detail**.
- Heatmap emits a chart instead of passing its table through.

## Under the hood: seed list for the GitHub changelog

- Native Polars runs in CI (`test.yml` `rust` job); the frame-verb fuzzer covers window,
  fill, replace, slice, bind, cross join and error cells, and every divergence it found is
  fixed and pinned.
- The test suite runs in about 15 s instead of about 100 s (shared and isolated vitest
  projects).
- One declaration of what a blank means for every function's settings (`ARG_ROLES`), read
  by cards and formulas alike.
- An Excel arity parity check (`excelArityParity.test.ts`) that only lets the list of
  short signatures shrink.
- Several oldest-first code reviews and adversarial review rounds: well over 100 bugs
  fixed with tests.
- The demo video is generated from the real app and a real Obsidian
  (`scripts/demo-video/`), with a second cut for Obsidian users.
- The site's pages each get their own title and link preview, and the Obsidian page leads
  with Solenoid Properties.
- The Solenoid Properties plugin exposes an API for other plugins' Frames ([[D89]]
  pluginApi), which the Decision Matrix Bases View plugin uses.
- Shipped copy is free of em dashes, enforced by `uiCopy.test.ts`.
- Dependencies on latest, `mermaid` 12 with a patched `lodash-es`, `@xyflow/react` 12.12.
