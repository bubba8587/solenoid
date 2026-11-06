# Solenoid 1.6: feature highlights (selling list)

The What's New source for 1.6: marketing copy, ordered by how hard each thing sells. `[slide]` entries are the
deck (`src/graph/whatsNewSlides.ts`, `WHATS_NEW_VERSION`, which still shows 1.5's eight until the author picks); the rest
can lead the GitHub notes or a post. The bar is `archive/release-notes-1.1.md`: a sell is something a user would
go play with or download for. Every sentence has to pass "would anyone care?", so internals, fixes and parity
work stay in `release-notes-1.6.md`, the plain changelog. 1.5's list is `archive/release-notes-features-1.5.md`.

Left out on purpose: the Choice Ladder, Gantt, Schedule and Earned Value (hidden for 1.6), Isolate (switched
off), the Android build (not in 1.6) and the headless CLI (unpublished).

## The deck

- **[slide] We rewrote it in Rust.** Yes, us too. The difference is we have numbers: a million rows through
  a filter, a computed column, a group, a join and a sort in 160 ms. A RANK or SUMIFS column over 20,000
  rows used to take long enough to make coffee. Now it's milliseconds, so you'll have to find another
  excuse.
- **[slide] Dashboards.** Wire your charts, numbers and tables into a Dashboard card and open it as a
  full-screen board. Drag things around, color-code them, refresh live data, and check it on your phone
  like it's a stock ticker. The Dashboard showcase example has one ready to poke at.
- **[slide] Pivot tables, the real kind.** PIVOTBY opens on an honest-to-god pivot table: Compact, Outline
  or Tabular, subtotals that fold, a number format per field, and the rows behind any number one click
  away. Your finance team will feel right at home.
- **[slide] Coming from Excel?** The Excel Coverage tab lists Excel's functions under Excel's own headings,
  each with the card that does it. 326 give Excel's exact answers, down to `0.1 + 0.2 = 0.3`, and the ones
  that don't just tell you how instead of making you find out the hard way.
- **[slide] A date is a date.** Dates stay dates through every formula, lookup, sort and pivot. A date
  plus 7 is next week, two dates subtracted are the days between, and you'll never squint at 45000 again
  wondering what it used to be.
- **[slide] All your files, one search.** Folders for your documents, drag and drop, and a globe search that
  looks through everything at once and drops you on the exact card. "Where did I put that" is now a
  two-second problem.
- **[slide] Units that do the math.** Divide a km column by an hr column and you get km/h, no conversion
  factor scribbled on a sticky note. A payment on a dollar loan comes back in dollars.
- **[slide] 32 kinds of diagram.** The Mermaid card has a starter for every diagram it draws: Sankey, Venn,
  Kanban, Treemap, even Wardley maps for the strategy people. All in your theme, no Visio required.

## Also worth shouting about

- **Click a chart to label your data.** Conditional Regions lets you click the areas a chart's lines carve
  out, and every point gets tagged with the one it lands in. 100,000 points in a fifth of a second, which
  is faster than you can say "which quadrant is this in".
- **Grids and signals.** Smooth, Convolve, Integrate and Find Peaks now work on a whole grid of numbers,
  Interpolate turns scattered points into a surface, and Connected Regions finds the islands in a height
  map. For the scientists among us, in the Signals & Grids pack in Settings.
- **XLookup, every which way.** Down or across, exact or nearest, contains or starts with. Leave Return
  blank and you get the whole row, no INDEX/MATCH gymnastics.
- **Charts that annotate themselves.** Hand any chart a References table for target lines, marked points and
  shaded bands. XY charts handle dates and log scales and stay smooth at 50,000 points.
- **Forms that build themselves.** Frame Input looks at your columns and lays out a data-entry form or a card
  layout on its own.
- **Decision Matrix with deal-breakers.** Knock an option out before it's even scored, chain decisions
  (pick a neighborhood, then an apartment in it), and see exactly how much you'd have to care about rent
  before a different place wins.
- **Loops are allowed now.** Run a cable back into itself through a Delayed Pass card and it steps once per
  recalculation. Counters, feedback and little simulations, one wire away.
- **Search speaks human.** Type "mortgage", "running total", "dedupe" or "pivot table" and land on the right
  card, even if you don't know what we called it.
