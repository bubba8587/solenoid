# Solenoid 1.6: feature highlights (selling list)

The What's New source for 1.6: marketing copy, ordered by how hard each thing sells. `[slide]` entries are the
deck (`src/graph/whatsNewSlides.ts`, `WHATS_NEW_VERSION` 1.6); the rest
can lead the GitHub notes or a post. The bar (author 2026-07-08): a sell is something a user would go play with or
download for, or that would earn a link click on social media; What's New is not a changelog, GitHub is. A `[slide]`
is a genuine sell, shiny and playable; the notes body takes real sells that aren't slide-worthy alone (analysis
features, quality of life), a benefit line each; non-sells that shipped are mentioned under the hood, never
headlined. Every sentence has to pass "would anyone care?", so internals, fixes and parity work stay in
`release-notes-1.6.md`, the plain changelog.

Left out on purpose: the Choice Ladder, Gantt, Schedule and Earned Value (hidden for 1.6), Isolate (switched
off), the Android build (not in 1.6) and the headless CLI (unpublished).

## The deck

- **[slide] Rust port (yes, us too).** The app's core now runs Rust via WebAssembly for much faster row operations. Try the Rust engine speed test example with a high row count.
- **[slide] Dashboards.** Wire any number of charts, tables, numbers or documents to the new Dashboard card.
- **[slide] Pivot view.** The PIVOTBY card now has familiar options for your reporting layouts.
- **[slide] Pipeline.** A manual-refresh Composite card mode which lists its steps on the outer card. Useful for building Power Query-esque data transformations.
- **[slide] New and refurbished cards.** Try out the Conditional Regions card, the new Geometry Solvers, & the comparison helper functions ABOVE/BELOW/etc.
- **[slide] Revamped Function Reference.** The Function Reference (that book icon in the top-right of your screen) was bad before and now it's good. Check it out!
- **[slide] Revamped Navigator.** The Navigator sidebar (open with N) now holds a traditional file tree.
- **[slide] Mermaid → Pele.** Solenoid now uses Obsidian's Pele renderer for improved Mermaid diagrams.

## Also worth shouting about

- **Pipeline: Power Query's applied steps, on the canvas.** Run a table through a chain of steps and the card
  numbers them. Click any step to see the table at that point.
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
