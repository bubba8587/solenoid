Solenoid 1.6

[DRAFT for the author's edit, 2026-11-06, built from every commit since v1.5.0. The What's New copy is
`release-notes-features.md`. Bracketed notes come out before publishing.]

Everything a document computes now runs on Solenoid's own Rust engine, on the web and on desktop. Runs free in your browser at solenoid-ngc.com; the Windows exe, the Linux AppImage and the .deb are below.

Highlights

- One engine, on the web and on desktop, written in Rust.
  - A million-row filter, computed column, group, join and sort chain runs in 160 ms (1.17 s on 1.5's desktop engine).
  - Computed columns that read a whole column per row (PERCENTILE, RANK, COUNTIF, XLOOKUP, SUMIFS, FORECAST.LINEAR) went from seconds or minutes to milliseconds at 20,000 rows.
  - On a slow connection the window is usable in about 3 s instead of 13.
- Dashboard card: wire in figures, numbers, tables and notes and open it as a full-canvas board.
  - Drag and resize boxes in Edit Layout; tint, rename, expand or remove a box from its menu.
  - Show a Frame as cards, refresh live data, follow an error to its cause.
  - Works by touch; on a phone boxes stack and pair up.
  - Describe opens on a dashboard with a chart per column. See the Dashboard showcase example.
- Function Reference, rebuilt.
  - Every card has a page: the formulas that reach it, its ops and modes, its inputs and what an empty field means, its outputs, and the examples that use it.
  - The navigator uses the Add menu's tree and search, so a formula name finds its card.
  - Each top-level folder has a page explaining its kind of value.
  - The Add menu's book button and the Inspector's Open in Reference open the card you're on.
- Excel Coverage tab in the Reference: Excel's functions under Excel's own sections, each with its card and whether it matches Excel. 326 of the 402 carded functions give Excel's answers; each one that differs says how on its page.
- Dates are their own type everywhere: formulas, cards, Group By, Pivot, window functions, lookups, sorts, exports and Obsidian.
  - A date plus days is a date; a date minus a date is days; only Cast to Number gives the serial.
  - `"Due " & @d` reads "Due 15-Jan-2026".
  - Dates run from 01-Jan-0001 to 31-Dec-9999.
- Closer to Excel's arithmetic and text.
  - Floating point is smoothed as in Excel: `0.1 + 0.2 = 0.3` is TRUE.
  - TEXT and Cast to Text read Excel number format codes (`TEXT(45000, "mmm d")` is "Mar 15").
  - Regular expressions follow Excel's PCRE2 rules.
  - Sums are exact and independent of row order.
  - Numbers convert to text the way Excel writes them.
- Files tree in the Navigator.
  - Create, rename, drag, duplicate and delete documents and folders; New from Example; full keyboard control; an unsaved-changes dot.
  - The globe toggle searches every document and opens the card it finds.
  - One shared file and folder picker that browses, searches and previews; desktop uses the system dialog.
- Grids and signals.
  - Smooth (now with Mean and Median), Convolve, Integrate, DIFF (with a Laplacian) and Find Peaks take a grid as well as a list.
  - Interpolate spreads scattered x, y, z points onto a grid.
  - New Connected Regions card labels patches of touching cells.
  - New Signals & Grids pack (off by default; turn it on in Settings) holds Spectrum, Smooth, Find Peaks, Convolve and Connected Regions.
  - New core functions: KRON, PINV, SVD, grid flips and rotation.

Tables, Frames and Cubes
- Pivot tables: a PIVOTBY output opens in Compact, Outline or Tabular form, with repeated labels, blank rows, banding, collapsible groups, a number format per value field and a label filter.
- Configure Fields has a Details zone that opens the source rows behind a leaf row.
- XLookup card: searches rows or columns; matches with Filter's ops (equal, nearest at or below or above, contains, starts with, ends with, not equal, blank); a blank Return returns the whole row.
- Frame Input: new Card Layout beside Form Layout; with none written, the Form lays itself out from the data; each layout field has a Suggest button.
- Cards is now its own card, tinted by a Color column. Record keeps Detail, Gallery, Board and List; Record Detail has a Filter field.
- The Filter field is in the same place in every popup with rows; the Form view pages only through matching records.
- Popup titles wrap; Pin and Go to Source moved to the overflow menu.
- A Cube cell holding a single record drills in as a one-row table.
- Popups open immediately on a placeholder and fill in when a big table is ready.
- Resizing a large Frame popup is about 10 times smoother.
- Frame popup: error cells show their code, arrow keys move the caret while editing, long column names wrap, date columns sort by date.
- Local File reads Parquet on desktop with a new reader; category columns read as values, an empty file keeps its column types.
- CSV reads faster (a 50 MB file in about 1.7 s, was 4.1 s); written CSV quotes only where needed.
- A CSV number or date column stays numbers when a few cells are N/A, -, #DIV/0! or other stray text; those cells read as NaN and keep their text.
- The summary footer counts errors per column.
- Slicer shows TRUE and FALSE for a logical column.
- Fixed: the Cards gallery crashing when the row count changes, and a Computed Column named as its own anchor.

Formulas and functions
- Text is never silently read as a number: "12" in a number argument is #VALUE!. Use VALUE, DATEVALUE or Cast.
- Errors propagate through every function: `CONCAT(NA(), "a")` is #N/A.
- Paired functions (CORREL, COVAR, SLOPE, SUMX2MY2 and the rest) refuse lists of different sizes, as in Excel.
- Powers follow IEEE 754: `1^y` is 1, `0^0` is 1.
- Text sorts by code point.
- SERIESSUM takes a single coefficient.
- The Aggregate card's COUNT DISTINCT and COUNTBLANK take any list, text included.
- SUM, MIN, MAX, COUNT and SUMPRODUCT count TRUE as 1 and FALSE as 0 (`SUM(x > 5)` counts matches).
- Aggregates, AND, OR and XOR answer an error for text; PTP, IQR, MAD, SEM, CV and RMS do too, as their cards already did.
- Empty text `""` counts as nothing in a total, on cards and in formulas: the Aggregate card over `2, ""` is 2, and `SUMSQ(2, "")` is 4.
- AVERAGEIF and AVERAGEIFS with no matching row are blank, as AVERAGE of nothing is (Excel: #DIV/0!).
- IF, IFS, SWITCH and CHOOSE ignore an error in a branch not taken (`IF(@qty = 0, 0, @total / @qty)` gives 0); their cards match.
- Criteria take typed values: `">=" & DATE(…)` in SUMIFS or COUNTIFS compares as a date.
- New functions IS, ISNOT, ABOVE, BELOW, ATLEAST, ATMOST and BETWEEN.
- Comparison and Between cards compare numbers, text, dates, Booleans and units.
- New Sets & Comparisons pack (on by default) holds the comparisons and set operations.
- WEEKDAY and WEEKNUM take every Excel return type.
- TIME truncates and refuses a negative total; EDATE drops the time of day; REGEXTEST answers TRUE/FALSE; coupon functions truncate their arguments; ROMAN(0) is empty text.
- Matched to Excel: the BIT functions (48 bits); ERF, ERFC, GAMMA, Z.TEST, CHISQ.TEST and CONFIDENCE (accuracy and domain); BASE, DECIMAL, ROMAN, ARABIC and the radix conversions; DB's partial last period; DOLLAR's rounding and parentheses; exact COMBIN, PERMUT and FACT; the Bessel orders; CLEAN; TRIM (spaces only); UPPER (keeps ß); LEFT, RIGHT and MID (never split an emoji).
- MAP, BYROW, BYCOL, SCAN and MAKEARRAY expect one value per call, as in Excel.
- Too many arguments is #SYNTAX! naming the limit; empty parentheses are an empty first argument.
- An empty formula argument uses the same default as the card's empty field (`CHISQ.DIST.RT(3, )` uses 10 degrees of freedom).
- Correlation, Covariance and Regression are one card with nine ops, in Excel's Known Ys, Known Xs order.
- Replace Values has Find's Aa toggle.
- Shuffle has a Sample op (RANDSAMPLE): weighted, with replacement.
- RANDARRAY's card draws a Rows by Columns grid.
- New SIMPLERETURNS beside LOGRETURNS.
- Formula and LAMBDA cards: the Number/Text/Date toggle is replaced by an inline Cast; results keep their computed type.
- A Script that reads Math.random or Date.now holds its answer until F9.
- Errors from formulas and cards explain why in plain words.
- Functions that could hang on an extreme argument now answer an error immediately; an Amortization past a million periods is #DOMAIN! instead of crashing the tab.

Dates
- DATEVALUE and typed dates read ISO date-times, "Mar 5", "March 2024", month names, ordinals and weekdays.
- A date that could be day-first or month-first is #AMBIGUOUS!.
- Relative dates read "in 3 days", "the day after tomorrow", "+3 days", "tonight", "this coming friday".
- Date functions no longer shift with daylight saving or the computer's time zone.
- Date functions refuse TRUE or FALSE.
- Filters, Is In, Tally and XMatch compare dates by day; Expect's Min and Max take dates.
- Summing dates, or mixing dates with other types in one output, is #TYPE! with a hint to Cast.

Units
- A computed column with no unit infers one from its formula (`@distance / @time` over km and hr is km/h).
- Finance functions and cards keep the currency of their money inputs (PMT on a dollar loan answers dollars).
- Table and Cube popups show each number with its column's unit; a toggle hides them.
- Running adds mixed units correctly; REDUCE and SCAN keep their start value's unit; Smooth keeps a list's unit.
- Convert-only units (yd, psi, knot) show their symbol.
- Two temperature scales never mix: K with °C, or °C with °F, is #UNIT! on cards and in formulas, asking for a conversion.

Charts and figures
- A References table draws dashed lines, points and shaded bands on any chart with axes; Merge Plots keeps them.
- XY charts: date x axes, log y scale, line breaks over wide gaps, responsive at 50,000 points (a resize step went from 10.7 s to 54 ms).
- New Conditional Regions card: click the regions a Scatter, XY Line or Bubble chart's lines cut the plot into, and each point gets that region's TRUE/FALSE, label or value, with an optional distance-to-boundary margin (100,000 points in about 0.2 s).
- Mermaid card: a starter template for all 32 diagram types; diagrams use the app's theme.
- Calendar Heatmap sums each day's values, counting a row with no number as 1.
- Funnel labels each stage inside its band.
- Sunrise / Sunset draws the sun's arc; Weather shows its condition.
- KPI uses the input's number format.
- Gauge Dial takes an Options input.
- Legends wrap onto rows and take at most a quarter of the figure's height.
- Date ticks fall on month or year starts.
- A lone XY point draws as a dot.
- Vector Field draws its first row at the bottom, lining up with Surface.
- Heavy charts stretch smoothly while resizing and redraw on release.

Cards and canvas
- Query is now Pipeline, a composite run mode: a table runs through one chain of steps inside, numbered on the card; pick a step to see its table in the card's Preview section. A branch or a stray card inside is named on the card.
- New Delayed Pass card: a cable loop through it is allowed and steps once per recalculation.
- Decision Matrix: deal-breakers, median fill for a missing score, Range normalization, chained decisions over a Cube.
- Sensitivity: Flip points show the weight at which another option wins.
- Every empty card field shows what it means: its default, a behavior in brackets, an example in italics, or Required.
- Any-type fields (IF, IFS, SWITCH, Comparison) have a kind button for Number, Text, Date or Boolean.
- Value Input's type button sits beside its field.
- Value Input, Constant, Physics Constant and TODAY/NOW collapse to a value cell; a collapsed Boolean flips on a press.
- Cards read a wired 0 or FALSE as a value, not as an empty input (fixes Rename, Weighted, Fill, FREQUENCY, Add Column and the hypothesis tests).
- A Display grows with its content up to 560 px wide, then scrolls; resizing by hand goes past that.
- Recalculate sits above the result on every card that has one; the Distributions card's Sample form has one too.
- The socket legend shows type icons; list and matrix socket colors are evened out, and Boolean moved to blue.
- The cable inspector's Shape row is gone.
- Navigator: the Outline follows a drill-in and its search reaches cards inside composites; the panel is resizable on desktop; clicking the document name reveals it in Files.
- Composite cards compute every card inside them, in every run mode and at any depth.
- The Add menu is reorganized into four groups.
- Search finds cards by everyday words ("mean", "mortgage", "dedupe", "pivot table").
- Repeated groups on cards (Filter conditions, Sort keys, SUMIFS pairs, IFS cases) are spaced apart, with the remove button on the rule above.
- Figure cards have an extra-wide width.
- Spline cables no longer bulge backward.
- The dot grid holds steady under a deep pinch.
- Panning a zoomed-out canvas is much smoother on desktop.

Phone
- The ⋮ menu fits down to Help without scrolling.
- The nav pill swipes away to the edge.
- Inside a composite, input and output ports are added beside the ➕; run controls dock in a corner.
- Compact Navigator, full-screen file picker, full-height popups.
- On a locked canvas the ➕ becomes the lock.

Obsidian and files
- In manual calculation, edits are saved immediately instead of being lost on reload.
- Import Obsidian Note says when its note is gone.
- The Documents menu lists your five most recent documents.
- Write Properties writes lists, matrices, Frames, Cubes and complex columns with the Solenoid Properties plugin's types, so they read back correctly.
- Write to Obsidian and Write Tasks take Keys as a normal list input.

Settings
- Decimal places is a 0 to 10 slider; Scientific-from has a 1K step.
- A pack's name opens its cards in the Reference; only the switch toggles it.
- Arrow keys move through every segmented switch, tab list, menu and toolbar.
- The remaining off-palette colors follow the theme.

Safety
- A document from someone else asks before running its Script cards or loading web images; cards copied out of it keep asking.
- Local File can't read outside the data folder.
- A Script's code doesn't run while its syntax is checked.
- Dropping a file on the desktop window no longer widens what the app can read.
- An AI rewrite can't strip a foreign document's trust flags.

Heads up

- Formulas no longer read numbers, dates or TRUE/FALSE out of text: numeric text in a number argument is #VALUE!, and aggregates answer an error for text. Use VALUE, DATEVALUE or Cast.
- Dates are no longer numbers: `date * 2`, `date + date`, `SUM` of dates and `YEAR(46000)` are #TYPE!. Cast to Number gives the serial; Cast to Date or DATE goes back.
- Too many arguments is #SYNTAX! instead of being dropped. This includes arguments Solenoid doesn't support yet: GROUPBY's last five options, LINEST and LOGEST's const and stats, MAP past three arrays, and basis on PRICE, YIELD and the ODD functions.
- Paired functions (CORREL, COVAR, SLOPE and kin) refuse lists of different sizes instead of pairing the overlap.
- A Logical Value Input refuses text other than TRUE or FALSE; a Date Value Input refuses text it can't read.
- An empty Text Value Input sends a blank, so ISBLANK downstream is TRUE.
- Cast's targets are ops ("To Text" and so on); search finds "Cast: To Text".
- MAP, BYROW, BYCOL, SCAN and MAKEARRAY answer #SHAPE! for a lambda that returns a list.
- Correlation, Covariance and Regression merged into one card; the old cards don't load from older saves.
- Spectrum, Smooth, Find Peaks and Convolve moved to the Signals & Grids pack, off by default.
- Cards split off from Record into its own card.
- The Formula and LAMBDA cards' Number/Text/Date toggle became an inline Cast.
- Input Switch names its rows by their source cards.
- Mixing temperature scales is #UNIT!, including a K difference added to a °C reading (`20 °C + 5 K`). Convert to one scale first.
- AVERAGEIF(S) with no matching row is blank instead of #DIV/0!.
- Angle Dial turns counterclockwise with 90 pointing up, matching SIN and COS.
- Vector Field's first row is at the bottom.
- The Choice Ladder, Gantt, Schedule and Earned Value are hidden from the Add menu and Examples; documents that use them still load.
- Isolate, Isolate chain and Where used are switched off for now.
- Query is renamed Pipeline. A saved Query loads as a Manual refresh composite; pick Pipeline in its run-mode menu for the step list.
- "Draw a cable" is now "Draw an arrow".
- The Rust engine setting is gone; there is only one engine.

Under the hood

- The TypeScript engine, Formula.js, rete and Polars are gone. The graph runs on netcore-rs, a Rust port of rete; card bodies, formulas and table verbs run on Solenoid's own core, in WebAssembly on web and desktop.
- The Linux package is 18 MB (was 24). [Re-measure against v1.5.0 at release, and add the engine download size only if it measured smaller.]
- Excel's documented examples are pinned in the tests function by function, every card is checked against its formula, and a formula fuzzer covers dates and operators.
- Memory is released when a document, composite or landing scene closes.
- Time zones use one bundled database (tzdb 2026e) in the browser and on desktop.
- Saved files keep big integers, -0 and number-like keys exactly.
- Dependencies updated; dompurify's two XSS advisories are closed.
