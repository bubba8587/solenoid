Solenoid 1.6

DRAFT for the author's copy edit (2026-11-06), built from every commit since v1.5.0. The selling
list and slide picks are `release-notes-features.md`; this is the full GitHub release body, in
1.5's shape. Bracketed notes are for the editor and come out before publishing.

The engine release: everything a document computes now runs on Solenoid's own engine, written in Rust, the same on the web and on desktop. It's faster everywhere, it gives Excel's answers in hundreds of places it didn't before, and dates are finally dates. Around it: a Dashboard card, a rebuilt Function Reference with an Excel Coverage tab, a Files tree in the Navigator, and grid tools for signals and height maps. Runs free in your browser at solenoid-ngc.com; the Windows exe, the Linux AppImage and the .deb are below.

Highlights

- One engine, and it's fast. Every formula, card and table verb runs on Solenoid's own Rust engine, compiled to WebAssembly, on the web and on desktop alike: one implementation, one answer. A million-row chain of filter, computed column, group, join and sort runs in 160 ms, against 1.17 s on 1.5's desktop engine. Computed columns that read a whole column per row (PERCENTILE, RANK, COUNTIF, XLOOKUP, SUMIFS, FORECAST.LINEAR and their kin) went from seconds or minutes to milliseconds at 20,000 rows. On a slow connection the window is usable in about 3 s instead of 13.
- Dashboard. Wire figures, numbers, tables and notes into a Dashboard card and open it as a full-canvas board. Drag and resize boxes in Edit Layout; tint, rename, expand or remove a box from its menu; show a Frame as cards; refresh live data; follow an error back to its cause. Boxes animate in, and on a phone they stack and pair up. Describe's popup opens on a dashboard with a chart for each column. See the Dashboard showcase example.
- The Function Reference, rebuilt. Every card has a page: the formulas that reach it, its ops and modes, what each input expects and what an empty field means, its outputs, and the examples that use it. The navigator is the Add menu's own tree and search, so a formula name finds its card. Each top-level folder has a page that explains its kind of value with real displays. The Add menu's book button opens the Reference on the card you're on, and the Inspector has Open in Reference.
- Coming from Excel? The Reference's Excel Coverage tab lists Excel's functions under Excel's own sections, each with the card that does it and a mark for whether it matches Excel. 326 of the 402 carded functions give Excel's answers; each one that differs says how on its card's page.
- A date is a date. Dates are their own kind of value: in formulas, on every card, through Group By, Pivot, window functions, lookups, sorts, exports and Obsidian. A date plus days is a date and a date minus a date is days; only Cast to Number turns one into its serial. `"Due " & @d` reads "Due 15-Jan-2026". Days before 1900 work everywhere, from 01-Jan-0001 to 31-Dec-9999.
- Excel's answers, to the digit. Arithmetic smooths floating point as Excel does, so `0.1 + 0.2 = 0.3` is TRUE. TEXT and Cast to Text read Excel's number format codes (`TEXT(45000, "mmm d")` is "Mar 15"). Regular expressions follow Excel's PCRE2 rules. Sums are exact and the same in any row order. Numbers become text the way Excel writes them, and dozens of functions were corrected against Excel's own documentation.
- Files in the Navigator. The Navigator has a Files tree: folders of documents you create, rename, move by drag and drop, duplicate and delete, with New from Example, full keyboard control and an unsaved-changes dot. A globe toggle searches every document at once and opens the card it finds. Every file and folder field shares one picker that browses, searches and previews notes, tables and folders; desktop uses the system dialog.
- Grids and signals. Smooth (now with Mean and Median), Convolve, Integrate, DIFF (with a Laplacian) and Find Peaks work on a table of numbers as well as a list. Interpolate spreads scattered x, y, z points onto a grid, and the new Connected Regions card labels patches of touching cells. They live in the new Signals & Grids pack; turn it on in Settings. The core also gains KRON, PINV, SVD, and grid flips and rotation.

Also in 1.6

Tables, Frames and Cubes
- An Excel-style pivot table: a PIVOTBY output opens in Compact, Outline or Tabular form, with repeated labels, blank rows, banding, groups that fold onto their subtotals, a number format per value field and a label filter. Configure Fields gains a Details zone that opens the source rows behind any leaf row.
- XLookup looks across a row as well as down a column, matches the way Filter does (equal, nearest at or below or above, contains, starts with, ends with, not equal, blank), and returns the whole row when Return is blank.
- Frame Input gets a Card Layout beside its Form Layout; with none written, the Form lays itself out from the data, and each layout field has a Suggest button.
- Cards is its own card, tinted by a Color column; Record keeps Detail, Gallery, Board and List, and Record Detail gets a Filter field.
- The Filter field sits in one place in every popup with rows, and the Form view pages through only the records that match it.
- Popups open at once on a placeholder and fill in when a big table is ready, and resizing a large Frame popup is about 10 times smoother.
- In the Frame popup an error cell shows its code, arrow keys move the caret while editing as in Excel, long column names wrap, and a date column sorts by date.
- Local File reads Parquet on desktop with a new reader: category columns read as their values, an empty file keeps its column types.
- Reading a CSV is faster (a 50 MB file in about 1.7 s, from 4.1 s), and written CSV quotes only where it must.
- The summary footer counts errors per column; Slicer shows TRUE and FALSE for a logical column.

Formulas and functions
- A formula never guesses a type out of text: "12" in a number argument is #VALUE! saying the function needs a number, and VALUE, DATEVALUE and Cast are the ways to read text.
- SUM, MIN, MAX, COUNT and SUMPRODUCT count TRUE as 1 and FALSE as 0, so `SUM(x > 5)` counts the matches; the aggregates and AND, OR and XOR answer an error for text instead of quietly reading it.
- IF, IFS, SWITCH and CHOOSE answer the branch they take even when another is an error, so `IF(@qty = 0, 0, @total / @qty)` gives 0, as in Excel; the cards agree.
- Criteria take typed values: `">=" & DATE(…)` in SUMIFS or COUNTIFS compares as a date.
- New comparison functions IS, ISNOT, ABOVE, BELOW, ATLEAST, ATMOST and BETWEEN(values, low, high); the Comparison and Between cards compare numbers, text, dates, Booleans and units. With the set operations they form the Sets & Comparisons pack, on by default.
- WEEKDAY and WEEKNUM take every Excel return type; TIME truncates and refuses a negative total; EDATE drops the time of day; REGEXTEST answers TRUE/FALSE; the coupon functions truncate their arguments; ROMAN(0) is empty text.
- Many functions now follow Excel rather than JavaScript: the BIT functions on 48 bits; ERF, ERFC, GAMMA, Z.TEST, CHISQ.TEST and CONFIDENCE in accuracy and domain; BASE, DECIMAL, ROMAN, ARABIC and the radix conversions; DB's partial last period; DOLLAR's rounding and parentheses; COMBIN, PERMUT and FACT exact; the Bessel family's orders; CLEAN, TRIM (spaces only), UPPER (keeps ß) and LEFT, RIGHT and MID (never split an emoji).
- MAP, BYROW, BYCOL, SCAN and MAKEARRAY expect one value per call, as Excel does.
- Calling a function with too many arguments is #SYNTAX! naming the limit; empty parentheses read as an empty first argument.
- A formula's empty argument reads the same default as its card's empty field, so `CHISQ.DIST.RT(3, )` uses the card's 10 degrees of freedom where Excel's 0 would error.
- Correlation, Covariance and Regression are one card with nine ops, using Excel's Known Ys, Known Xs order.
- Replace Values has Find's Aa toggle; Shuffle gains a Sample op (RANDSAMPLE) with weights; RANDARRAY's card draws a Rows by Columns grid; SIMPLERETURNS joins LOGRETURNS.
- The Formula and LAMBDA cards drop their Number/Text/Date toggle for an inline Cast; a result keeps the type it computed.
- A Script that reads Math.random or Date.now holds its answer until F9, like Excel's volatile functions.
- When a formula or card fails it says why in plain words, and a function that would have frozen on an extreme argument answers an error at once.

Dates
- DATEVALUE and typed dates read more forms: ISO date-times, "Mar 5", "March 2024", month names, ordinals, a weekday; a date that could be day-first or month-first is #AMBIGUOUS!, never a guess.
- Relative dates read more phrases: "in 3 days", "the day after tomorrow", "+3 days", "tonight", "this coming friday".
- Date functions no longer shift with daylight saving or the computer's time zone, and refuse TRUE or FALSE as a date.
- Filters, Is In, Tally and XMatch compare dates by their day; Expect's Min and Max take dates.
- Summing dates, or mixing dates with other kinds in one output, is #TYPE! with a hint to Cast.

Units
- A computed column with no unit of its own works out its unit from its formula: `@distance / @time` over km and hr is km/h.
- Finance functions and cards carry the currency of their money arguments: PMT on a dollar loan answers dollars.
- Table and Cube popups write each number with its column's unit, with a toggle to hide them.
- Running adds mixed units correctly, REDUCE and SCAN carry their starting value's unit, Smooth keeps a list's unit, and Convert-only units (yd, psi, knot) show their symbol.

Charts and figures
- A References table draws dashed lines, points and shaded bands on any chart with axes, and Merge Plots carries them.
- XY charts read a date x column as dates, take a log y scale, break lines over wide gaps, and stay responsive at 50,000 points (a resize step went from 10.7 s to 54 ms).
- Conditional Regions: click the regions a chart's lines cut the plot into, and each point gets that region's value.
- The Mermaid card has a starter template for all 32 diagram types it draws, and diagrams draw in the app's theme.
- Calendar Heatmap counts dated rows per day; Funnel names each stage inside its band; Sunrise / Sunset draws the sun's arc and Weather its condition; KPI draws in the input's number format.
- Vector Field draws its first row at the bottom, so it lines up with the Surface beside it.
- Heavy charts stretch smoothly while resizing and redraw once you let go.

Cards and canvas
- Delayed Pass: a loop of cables is allowed through it, stepping once per recalculation.
- Decision Matrix gains deal-breakers, median fill for a missing score, a Range normalization and chained decisions over a Cube; Sensitivity gains Flip points.
- Every empty card field says what it means: the default it uses, a behavior in brackets, an example in italics, or Required.
- Any-type fields (IF, IFS, SWITCH, Comparison) get a kind button to choose Number, Text, Date or Boolean for a typed value.
- Value Input's type button sits beside its field, and Value Input, Constant, Physics Constant and TODAY/NOW collapse to a value cell; a collapsed Boolean flips on a press.
- Composite cards compute every card inside them, in every run mode and at any depth.
- The Add menu is reorganized into four groups, and search finds cards by everyday words ("mean", "mortgage", "dedupe", "pivot table").
- Repeated groups on cards (Filter conditions, Sort keys, SUMIFS pairs, IFS cases) are spaced apart with their remove button on the rule above.
- Figure cards get an extra-wide width; spline cables no longer bulge backward; the dot grid holds steady under a deep pinch; panning a zoomed-out canvas is much smoother.

Phone
- The ⋮ menu is rebuilt to fit down to Help without scrolling; the nav pill swipes away to the edge.
- Inside a composite, add input and output ports beside the ➕, with the run controls docked in a corner.
- The Navigator is compact, the file picker fills the screen, popups use the full height, and Dashboards work by touch.
- On a locked canvas the ➕ becomes the lock.

Obsidian and files
- The Documents menu lists your five most recent documents.
- Write Properties writes lists, matrices, Frames, Cubes and complex columns with the Solenoid Properties plugin's types, so they read back correctly.
- Write to Obsidian and Write Tasks take Keys as a normal list input.

Settings
- Decimal places is a 0 to 10 slider; Scientific-from has a 1K step.
- A pack's name in Settings opens its cards in the Reference; only the switch turns it on.
- Arrow keys move through every segmented switch, tab list, menu and toolbar.
- The last off-palette colors follow the theme.

Safety
- A document from someone else asks before its Script cards run or its web images load, and cards copied out of it keep asking.
- Local File can't read outside the data folder, a Script's code doesn't run while its syntax is checked, and dropping a file on the desktop window no longer widens what the app can read.

Heads up

- Formulas don't read numbers, dates or TRUE/FALSE out of text any more: numeric text in a number argument is #VALUE!, and aggregates answer an error for text. Use VALUE, DATEVALUE or Cast.
- A date is no longer a number: `date * 2`, `date + date`, `SUM` of dates and `YEAR(46000)` are #TYPE!, and date text in a date function says it needs a date. Cast to Number gives the serial; Cast to Date or DATE goes back.
- Too many arguments is #SYNTAX! instead of silently dropped. PRICE, YIELD and the ODD functions refuse a basis argument, which they never used.
- Correlation, Covariance and Regression merged into one card; the retired cards don't load from older saves.
- Spectrum, Smooth, Find Peaks and Convolve moved into the Signals & Grids pack, off by default. Turn it on in Settings.
- Cards split off from Record into a card of its own.
- The Choice Ladder, Gantt, Schedule and Earned Value are hidden from the Add menu and Examples for this release; documents that use them still load.
- Isolate, Isolate chain and Where used are switched off for now.
- The Formula and LAMBDA cards' Number/Text/Date toggle became an inline Cast; Input Switch names its rows by their source cards.
- MAP, BYROW, BYCOL, SCAN and MAKEARRAY answer #SHAPE! for a lambda that returns a list.
- Angle Dial turns counterclockwise with 90 pointing up, matching SIN and COS. Vector Field's first row is at the bottom.
- "Draw a cable" is now "Draw an arrow". The Rust engine setting is gone, since there is only one engine.

Under the hood

- The TypeScript engine, Formula.js, rete and Polars are gone: the graph runs on netcore-rs, a Rust port of rete, and every card body, formula and table verb on Solenoid's own core, in WebAssembly on the web and on desktop.
- The engine download is 6% smaller, and the Linux package is 18 MB (1.5's was 24). [Check at release.]
- Excel's documented examples are pinned in the test suite function by function, every card is held to its formula, and a formula fuzzer covers dates and the operators.
- Memory is released when a document, composite or landing scene closes.
- Time zones read one bundled database (tzdb 2026e) in the browser and on desktop.
- Saved files keep big integers, -0 and number-like keys exactly.
- Dependencies are current; dompurify's two XSS advisories are closed.
