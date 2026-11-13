Solenoid 1.6.2

Excel workbooks as a source, a Categorize card for sorting a list into your own groups, whole-row table comparison in Join, edits that recalculate only what they reach, Dashboard filters, stacked bar charts, undo that changes only what changed, a Probability pack, and a forecast chart on the Weather card. Runs free in your browser at solenoid-ngc.com; the Windows exe and the Linux .deb are below.

Highlights

- Excel workbooks: Local File and Web Source read a named Table from an `.xlsx` or `.xlsm` file. Pick the Table on the card; a workbook with one Table needs no pick.
  - Each cell is the answer Excel saved. A formula Excel never calculated is `#UNCALC!`, naming the cell and its formula, never a blank.
  - Column types come from the cells, and the popup's type buttons change them as they do for a CSV.
  - A pattern like `reports/*.xlsx` reads the same Table from every workbook as one table.
  - Only named Tables are read: in Excel, select the data and press Ctrl+T.
- Categorize: wire in a list (vendor names, expense memos, survey answers) and drag each distinct value into a category on the card's sorter. The card answers a two-column lookup table, Item and Category, to Join back onto your rows.
  - Categories come from a list you wire or type, or start as Category 1 to 3 to rename, add and remove in the sorter.
  - A sort is kept by value, so it holds when the list grows, shrinks or reorders. Long items wrap; Ctrl or Shift picks several to drop at once.
- Join compares whole rows: leave both keys blank and rows match on every column the two tables share by name, in any order. Anti then lists the rows one table has and the other lacks, Semi the rows both hold, so comparing two versions of a table takes one card. A blank matches a blank, and units convert as a key's do.
- Stacked charts: Column, Bar and Area take `stacked=True`, or `stacked=percent` for 100% stacked. The Chart Builder offers it as Stacking.
- Dashboards:
  - A box whose value has a Filter in its popup (a table, Frame cards, a Pivot, a Profile, a Gantt, a Record or Cards chart) has the same Filter in its header; a narrow box shows it as a magnifier.
  - A chart's Title shows under the box's name.
  - Cards, and a Record's Gallery, Board and List, scroll inside their box.
  - A table runs to its box's edges on its own ground, and a colored box keeps charts and tables on a neutral ground, the color on its header and border.
  - A collapsed Dashboard card ends on a chip that opens the board.
  - On a colored box, the header's magnifier and the Edit Layout grip take the header's text color.
- A Display, a Dashboard box and a Report show a Pivot as its Pivot view and a Describe output as its Profile, the way their popups open.
- Describe's Profile (the view its popup opens on, renamed from Dashboard) is rebuilt: tiles pack with no gaps, each column in its own color, number and date columns get a Min, Median, Mean and Max strip with the median marked on the histogram, and key, constant and empty columns say so.
- Undo and redo change only what changed. The canvas, the camera and every untouched card stay as they are, and undoing a typed value keeps that card's focus. On the Personal Finance example an undo went from about 2.7 seconds to a third of one.
  - Delete, removing a cable, Wrap as Composite and Unpack recalculate only the cards they reach.
- Edits recalculate only what they reach. A dropdown, a field, a formula or a chart option used to recompute the whole graph, every upstream card included; now only the edited card and what it feeds recompute, so changing a chart's colormap under a large pivot no longer re-runs the pivot. Live sources (a web table, a vault folder, the weather) recompute only what they feed when their data lands.
  - Insert Conduit on eight cables of a large graph: about 4 seconds down to a quarter of one.
- The Probability pack (Settings, Packs): three cards that draw the distribution behind their answer.
  - Probability Between: the chance a value lands between two numbers, with handles to drag on the curve.
  - A/B Test: visitors and conversions for two versions give the chance B beats A, and the lift with its likely range.
  - Bootstrap: how far a mean, median or standard deviation could be off, from resamples of the values.
- Weather has a Forecast output: a chart of each day's high and low, rain and sky, with today marked, for a Dashboard or a Display. The card shows the next five days.
- Pivot calculated fields drag among the values in Configure Fields, and out of the pivot without losing their cable. Sort takes a calculated field.
  - A pivot keeps its sort and its calculated fields' places by name, so removing or reordering a field never hands the sort to another one.
- A Pivot's value columns are headed by their summary, `Sum of Cost` or `Count of Projected Year`, as the Pivot view heads them, so a chart's tooltip or a lookup downstream reads a total or a count for what it is. A formula or chart that named a value column by its plain name needs the new name. GROUPBY keeps the plain name, as Excel's does.
- Chart colormaps start with — (one color) and Theme palette. With no color column wired, a colormap colors the points in order, so a bubble chart can be colorful with nothing extra wired; a color column still decides when it is.
- The Chart Builder is shorter: on/off options are checkboxes side by side, and choices nobody wires (grid, colormap, line style, the Gantt's switches) are plain settings with no socket. Schedule, Gantt and Earned Value pick their weekend by name.
- Card fields line up. Every input field on a card starts at one column, a field too narrow beside its label moves below it, and the long connection cards fold their extras into Options. Equation and TVM are about half as tall.

Canvas

- Fit all, the fit on load and framing a card use the exact zoom that fits, instead of the next 10% step down.
- Tab shows and hides the chrome from anywhere on the canvas.
- Dragging on a Curve, XY Pad, Point Plotter or Grid Painter no longer drags the card.
- A number field no longer changes when dragged across.

Fixes

- LAMBDA's λ( x ) row holds together again; the card-field alignment had pushed the parameter box into the middle of the row.
- A card in a group no longer shows a dark fringe around its header.
- SOLVE and MINVERSE no longer call a system singular because one variable is written in much larger or smaller units.
- BETA.DIST's density at 0 and at 1 is the value Excel gives.
- A calculated field over a large or filtered table reads the columns its formula names (it read blanks, so every cell was `#DIV/0!`).
- With a calculated field placed among the values, the Pivot view's captions and its right-click menu act on the right field.
- A new LAMBDA card starts with no parameter.
- A table wired into Frame from Lists is `#TYPE!` naming the input, not a failed card.
- A deleted card leaves its group.
- Weather's forecast marks today by the forecast place's clock, and moves at midnight.
- A calculated field that names no column of the table and no value on its LAMBDA is `#NAME?` saying so, instead of reading 0.
- A column holding only errors is a Text column, however it got there.
- Bootstrap on a very large list draws fewer resamples (at least 200, where it drew 1,000 past 20,000 values), so it no longer stalls; answers on up to 20,000 values are unchanged.
- Probability Between with Low or High wired to a blank answers blank instead of treating the blank as no limit.
- A Display holding Cards no longer flashes a scrollbar on and off at some sizes.
- An empty list field shows what it does when left empty (Categorize's reads [3 categories]) instead of a generic hint.
- The Chart Builder's Grid checkbox shows checked on a new card, as the chart draws it.
