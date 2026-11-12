Solenoid 1.6.2

Excel workbooks as a source, undo that changes only what changed, a Probability pack, and a forecast chart on the Weather card. Runs free in your browser at solenoid-ngc.com; the Windows exe and the Linux .deb are below.

Highlights

- Excel workbooks: Local File and Web Source read a named Table from an `.xlsx` or `.xlsm` file. Pick the Table on the card; a workbook with one Table needs no pick.
  - Each cell is the answer Excel saved. A formula Excel never calculated is `#UNCALC!`, naming the cell and its formula, never a blank.
  - Column types come from the cells, and the popup's type buttons change them as they do for a CSV.
  - A pattern like `reports/*.xlsx` reads the same Table from every workbook as one table.
  - Only named Tables are read: in Excel, select the data and press Ctrl+T.
- Undo and redo change only what changed. The canvas, the camera and every untouched card stay as they are, and undoing a typed value keeps that card's focus. On the Personal Finance example an undo went from about 2.7 seconds to a third of one.
  - Delete, removing a cable, Wrap as Composite and Unpack recalculate only the cards they reach.
- The Probability pack (Settings, Packs): three cards that draw the distribution behind their answer.
  - Probability Between: the chance a value lands between two numbers, with handles to drag on the curve.
  - A/B Test: visitors and conversions for two versions give the chance B beats A, and the lift with its likely range.
  - Bootstrap: how far a mean, median or standard deviation could be off, from resamples of the values.
- Weather has a Forecast output: a chart of each day's high and low, rain and sky, with today marked, for a Dashboard or a Display. The card shows the next five days.
- Pivot calculated fields drag among the values in Configure Fields, and out of the pivot without losing their cable. Sort takes a calculated field.
- Card fields line up. Every input field on a card starts at one column, a field too narrow beside its label moves below it, and the long connection cards fold their extras into Options. Equation and TVM are about half as tall.

Canvas

- Fit all, the fit on load and framing a card use the exact zoom that fits, instead of the next 10% step down.
- Tab shows and hides the chrome from anywhere on the canvas.
- Dragging on a Curve, XY Pad, Point Plotter or Grid Painter no longer drags the card.
- A number field no longer changes when dragged across.

Fixes

- SOLVE and MINVERSE no longer call a system singular because one variable is written in much larger or smaller units.
- BETA.DIST's density at 0 and at 1 is the value Excel gives.
- A calculated field over a large or filtered table reads the columns its formula names (it read blanks, so every cell was `#DIV/0!`).
- With a calculated field placed among the values, the Pivot view's captions and its right-click menu act on the right field.
- A new LAMBDA card starts with no parameter.
- A table wired into Frame from Lists is `#TYPE!` naming the input, not a failed card.
- A deleted card leaves its group.
- Weather's forecast marks today by the forecast place's clock, and moves at midnight.
