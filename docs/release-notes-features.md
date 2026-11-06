# Solenoid 1.6: feature highlights (selling list)

Curated, high-value features that will sell 1.6: the source material for the release notes
(the author writes the final copy) and the **What's New** slides. Living doc: keep it current as
features land; each entry is a *benefit*, not a changelog line. Order = rough selling priority.
`[slide]` marks a What's-New slide candidate (the deck, `HelpDialogs.tsx` and
`WHATS_NEW_VERSION`, still shows 1.5's eight until the author picks). The bar for what earns a
spot is `archive/release-notes-1.1.md`: a sell is a shiny thing a user will go discover and play
with, or something that would inspire a download; What's New is not a changelog, GitHub is.

This list covers everything on `develop` since the v1.5.0 tag (2026-10-08). The full draft notes
are `release-notes-1.6.md`. 1.5's list is `archive/release-notes-features-1.5.md`. Left out on
purpose: the Choice Ladder, Gantt, Schedule and Earned Value (hidden for 1.6), Isolate (switched
off), the Android build (not in 1.6) and the headless CLI (unpublished).

## Headliners: the slide deck

- **[slide] One engine, and it's fast.** Every formula, card and table verb now runs on
  Solenoid's own engine, written in Rust: the same on the web and on desktop, with one answer
  everywhere. A million-row chain of filter, computed column, group, join and sort runs in 160 ms
  (the old desktop engine took 1.17 s). Computed columns that look at a whole column per row
  (PERCENTILE, RANK, COUNTIF, XLOOKUP, SUMIFS) went from seconds or minutes to milliseconds at
  20,000 rows, and the window is usable in about 3 s on a slow connection instead of 13.
- **[slide] Dashboard.** Wire figures, numbers, tables and notes into a Dashboard card and open
  it as a full-canvas board: drag and resize boxes, tint and rename them, show a Frame as cards,
  refresh live data, and follow an error back to its cause. Boxes animate in when the board
  opens, and on a phone they stack and pair up. Describe opens on a dashboard too, with a chart
  per column.
- **[slide] The Function Reference, rebuilt.** Every card has a page: the formulas that reach
  it, its ops and modes, what each input expects and what an empty field means, the examples
  that use it. The navigator is the Add menu's own tree and search, each folder has a page that
  explains its kind of value with real displays, and the Add menu's book button opens the card
  you're on.
- **[slide] Coming from Excel?** The Reference's Excel Coverage tab lists Excel's functions
  under Excel's own sections (Financial, Logical, Text, Lookup & Reference...) with the card
  that does each one and a mark for whether it matches Excel. 326 of the 402 carded functions
  give Excel's answers, and each one that differs says how on its card's page.
- **[slide] A date is a date.** Dates are their own kind of value everywhere: in formulas, on
  every card, through Group By, Pivot, lookups and sorts. A date plus days is a date, a date
  minus a date is days, and a date never turns into a serial number unless you Cast it.
  Days before 1900 work too, back to the year 1.
- **[slide] Excel's answers, to the digit.** `0.1 + 0.2 = 0.3` is TRUE, as in Excel. TEXT
  reads Excel's number format codes (`TEXT(45000, "mmm d")` is "Mar 15"), regular expressions
  follow Excel's PCRE2 rules, sums are exact and the same in any row order, and numbers become
  text the way Excel writes them.
- **[slide] Files in the Navigator.** The Navigator has a Files tree: folders of documents you
  create, rename, drag, duplicate and delete, with full keyboard control. A globe search looks
  through every document at once and opens the card it finds. Every file and folder field shares
  one picker that browses, searches and previews (the system dialog on desktop).
- **[slide] Grids and signals.** Smooth, Convolve, Integrate, DIFF and Find Peaks work on a
  table of numbers as well as a list, Interpolate spreads scattered points onto a grid, and the
  new Connected Regions card labels patches of touching cells. They live in the new Signals &
  Grids pack (turn it on in Settings), with KRON, PINV, SVD and grid rotation in the core.

## More headliners (body of the notes)

- **An Excel-style pivot table.** A PIVOTBY output opens on a real pivot table: Compact,
  Outline or Tabular form, repeated labels, banding, groups that fold onto their subtotals, a
  number format per value field, and a Details zone that opens the source rows behind any cell.
- **XLookup both ways.** Look down a column or across a row, and match the way Filter does:
  equal, nearest, contains, starts with, ends with, not equal, blank. Leave Return blank and
  the whole row comes back.
- **Conditional Regions.** Take a Scatter, XY Line or Bubble chart and a set of points, click
  the regions its lines cut the plot into, and each point gets that region's TRUE/FALSE, label
  or value, with a distance-to-boundary margin if you want it. 100,000 points in about 0.2 s.
- **Units that work themselves out.** A computed column with no unit of its own takes one from
  its formula (`@distance / @time` over km and hr comes out in km/h), finance functions keep the
  currency of their money inputs, and table popups write each number with its unit.
- **Mermaid templates.** The Mermaid card offers a starter for all 32 diagram types it draws,
  Venn, Sankey, Timeline, Kanban, Treemap, C4, Ishikawa and Wardley maps among them, and diagrams
  draw in the app's theme.
- **Chart references.** A References table draws dashed lines, points and shaded bands on any
  chart with axes; XY charts read date x axes and log y scales and stay smooth at 50,000 points.
- **Frame Input layouts and the Cards card.** Frame Input gets Card and Form layouts that lay
  themselves out from the data, with a Suggest button per field. Cards is its own card, tinted by
  a Color column.
- **Decision Matrix grows up.** Deal-breakers rule an option out before scoring, a missing score
  takes the column's median instead of 0, decisions chain over a Cube (neighborhoods holding
  apartments), and Sensitivity's Flip points show the weight at which another option wins.
- **Delayed Pass.** A loop of cables on the canvas is allowed through a Delayed Pass card, which
  steps once per recalculation.
- **Every empty field says what it means**: the default it uses, a behavior in brackets, an
  example in italics, or Required; and a formula's empty argument reads the same default as the
  card's empty field.
- **Search speaks people.** "mean", "mortgage", "running total", "dedupe" or "pivot table" land on
  their cards, and the Add menu is reorganized into four clear groups.
