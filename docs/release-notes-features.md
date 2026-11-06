# Solenoid 1.6: feature highlights (selling list)

The What's New source for 1.6: marketing copy, ordered by how hard each thing sells. `[slide]` entries are the
deck (`HelpDialogs.tsx`, `WHATS_NEW_VERSION`, which still shows 1.5's eight until the author picks); the rest
can lead the GitHub notes or a post. The bar is `archive/release-notes-1.1.md`: a sell is something a user would
go play with or download for. Every sentence has to pass "would anyone care?", so internals, fixes and parity
work stay in `release-notes-1.6.md`, the plain changelog. 1.5's list is `archive/release-notes-features-1.5.md`.

Left out on purpose: the Choice Ladder, Gantt, Schedule and Earned Value (hidden for 1.6), Isolate (switched
off), the Android build (not in 1.6) and the headless CLI (unpublished).

## The deck

- **[slide] Way faster.** Solenoid now runs on its own engine, written in Rust. Push a million rows through
  a filter, a computed column, a group, a join and a sort in 160 ms. A RANK or SUMIFS column over 20,000
  rows used to take minutes and now takes milliseconds.
- **[slide] Dashboards.** Wire your charts, numbers and tables into a Dashboard card and open it as a
  full-screen board. Drag and resize the boxes, tint them, refresh live data, and pull it up on your phone.
  Open the Dashboard showcase example to see one.
- **[slide] Pivot tables, Excel style.** PIVOTBY opens on a real pivot table: Compact, Outline or Tabular
  form, subtotals that fold, a number format per field, and the source rows behind any line one click away.
- **[slide] Coming from Excel?** The Function Reference has a page for every card, and its Excel Coverage
  tab lists Excel's functions under Excel's own headings with the card that does each one. 326 match Excel's
  answers exactly, down to `0.1 + 0.2 = 0.3`, and the rest tell you how they differ.
- **[slide] A date is a date.** Dates stay dates through every formula, lookup, sort and pivot. A date plus
  7 is next week, one date minus another is the days between, and a date never turns into 45000 unless you
  ask.
- **[slide] All your files, one search.** The Navigator keeps your documents in folders you can drag around,
  and the globe search looks through every document at once and jumps to the card it finds.
- **[slide] Units that do the math.** Divide a km column by an hr column and the answer comes out in km/h.
  A loan payment on a dollar loan comes back in dollars.
- **[slide] 32 kinds of diagram.** The Mermaid card has a starter for every diagram it draws: Sankey,
  Venn, Kanban, Timeline, Treemap and Wardley maps among them, drawn in your theme.

## Also worth shouting about

- **Click a chart to label your data.** Conditional Regions turns the areas a chart's lines cut out into
  labels: click the regions, and every point gets the value of the one it falls in. 100,000 points in a
  fifth of a second.
- **Grids and signals.** Smooth, Convolve, Integrate and Find Peaks now work on a whole grid of numbers,
  Interpolate turns scattered points into a surface, and Connected Regions finds the islands in a height
  map. Turn on the Signals & Grids pack in Settings for the grid cards.
- **XLookup, every way.** Look down or across, match on contains, starts with or nearest, and leave Return
  blank to get the whole row.
- **Charts that annotate themselves.** Feed any chart a References table for target lines, marked points
  and shaded bands. XY charts handle dates and log scales and stay smooth at 50,000 points.
- **Forms from your data.** Frame Input builds a data-entry form or a card layout on its own from your
  columns.
- **Decision Matrix with deal-breakers.** Rule an option out before it's scored, chain decisions together
  (pick a neighborhood, then an apartment in it), and see the exact weight at which a different option
  wins.
- **Loops on the canvas.** Run a cable back on itself through a Delayed Pass card, and it steps once per
  recalculation. Counters, feedback and simple simulations are one wire away.
- **Search speaks human.** Type "mortgage", "running total", "dedupe" or "pivot table" in the Add menu and
  land on the right card.
