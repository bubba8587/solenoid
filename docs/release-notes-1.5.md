Solenoid 1.5

The Cards release: any table can be read as a stack of cards, Cubes are built and typed straight on the canvas, and Obsidian notes come alive with Solenoid Properties and Knap. It also rolls up 1.4.1 and 1.4.2, which went out without notes of their own. Runs free in your browser at solenoid-ngc.com; the Windows exe, the Linux AppImage and the .deb are below.

Highlights

- Cards. Too many columns in your table? The table popup's Cards view reshapes each row into a compact card, reading the columns by type and length: a title from the name columns, dates as ranges, tags as chips, ratings as stars, progress as meters, colors as swatches, links you can click and pictures inline. Filter, sort and Show More sit on top. Record's Cards view puts the same cards on the canvas as a gallery, and Add Record: Cards in the popup wires one up. See the "Cards from files" example.
- Cube Input. Build a Cube directly: every cell, list items included, has a menu at its edge that turns it into a value, a list, a table, a Frame or a nested Cube. Cube columns take a type, as a Frame's do, and a table nested in a cell keeps its own column types. Formula columns work per row over nested data, so `SUM(@prices)` totals each row's own list.
- Solenoid Properties for Obsidian. The companion plugin adds List, Matrix, Frame, Cube and Complex property types to Obsidian, shown as Solenoid's chips, edited in its table editor and kept as plain YAML in the note. Solenoid reads back every type the plugin writes. Turn on the Solenoid look and Obsidian takes your palette and accent, on desktop and phone. Get it from Obsidian's community plugins: https://community.obsidian.md/plugins/solenoid-properties
- Knap notes. Put `knap: true` in a note and its body renders live from its own properties, in Reading view and Live Preview. A `{{ budget }}` in the text shows the property's chip, and editing the chip edits the property.
- Frame Input. Formula columns grew up: pick Fx on a column to write a formula over the row, such as `@qty * @price`, call the card's λ inputs by name, and a formula that returns a date stays a date. The card itself is easier to work with, with its secondary settings folded under captions and an Edit button right on the card.
- XY plots. Scatter, the new XY Line and Bubble plot real x against y, with size, color, point labels and series split from named columns. Set `aspect=equal` for parametric curves; the chart showcase draws a Lissajous figure.
- Sparklines in cells. `SPARKLINE(range, [type])` draws a line, column or win/loss sparkline straight into a table cell. In a Cube, `SPARKLINE(@history)` gives every row its own trend, and pictures in text cells show as pictures in every card and popup.

Also in 1.5

- Linux desktop: the app runs on Linux as well as Windows, as an AppImage or a .deb, with the same native engine.
- Table editing: the table popup's Form and CSV views edit in place, with a calendar for a date cell, a checkbox for a Boolean, and suggestions from the column's own values. The popup asks before throwing away unsaved edits.
- Obsidian markdown in notes: wikilinks, tags, callouts, highlights and math render the way Obsidian draws them. A quoted Knap tag in frontmatter puts its rendered value on the Note's socket.
- Report previews a wired template with no records, a mail merge previews the notes Run will write, and a composite's Report or Note opens from its Document chip.
- Cube popup: a table level gets the Grid and Cards switch, the row filter and the summary footer; a cell can also be a Matrix with an editable grid; a list level lies across one row. Table and Cube editors have Insert and Delete menus, with Ctrl+Shift+= and Ctrl+- as shortcuts.
- The word filter sits in the popup header and works in Grid view as well as Cards.
- Exact numbers: a selected read-only cell shows its full value, and a value box's copy button copies the exact number.
- Pivot over a Cube: a column of lists or grids can be a PIVOTBY value field, pooling each group's items. PIVOTBY and SUMIFS also take a vault table.
- Excel's table functions at full strength: SORT, SORTBY, FILTER and UNIQUE take whole tables with Excel's full signatures; TEXTSPLIT, TEXTAFTER and TEXTBEFORE take all their options; TOCOL and TOROW scan and skip; INDEX takes lists of positions; TREND, GROWTH, VDB and MODE.MULT take their missing arguments.
- Add-menu search speaks Excel: typing an Excel name shows the card it lives on, such as "SORTBY → List Sort".
- Computed columns: `ROW()` gives the row number and `ROWS(price)` the count. Formulas close their missing parentheses when you commit, and the formula popup resizes.
- A list in a one-value argument, such as LARGE's k or a COUNTIF criterion, runs once per item, as Excel does. SEARCH reads Excel's wildcards, IFERROR catches per cell in a table, and TODAY() and NOW() columns refresh on F9 and at midnight.
- Cast parses numbers too: to Number takes decimal and group separators, and to Text takes a format.
- One scalar input: Value Input takes a number, text, a date or TRUE/FALSE, with its format and unit on the card.
- Card sections: busy cards group their settings under captions, and the secondary ones fold away. A folded section with cables in it gathers its sockets into one pill.
- Type icons in every type picker, column header and legend.
- Numbers look the same everywhere: one General style on every card, grid and popup, with a Decimal places setting.
- Tidy is steadier: a second Tidy moves nothing, disconnected pieces pack together, and the new Balanced alignment keeps cables level. A group collapses and expands back to exactly where it was.
- Units read like a person would: two °C readings subtract to a temperature difference, joins match 68 °F to 20 °C, and a unit carries through lookups, LAMBDAs, IFS and SWITCH.
- Big data holds up: lists past 125,000 values work, and formula columns over tall tables run far faster.
- Heatmap is a full figure, with color maps, a centered scale, value labels, a colorbar and hover values, and a Chart Builder target. Contour, Surface, Vector Field and Histogram 2-D take a color map and title too, and Calendar Heatmap wraps into bands.
- Charts: every Chart Builder option works on every figure that shows it. Pie, Funnel and Radial slices lift on hover and spotlight on click, XY figures take a color map, Sankey merges repeated flows, axes write compact ticks, exports keep their legend, and dense line charts draw fast.
- Collapsed cards show their content: a value, a chip, or a square mini for KPI, Gauge, Slider and World Clock.
- Stacking commands bring a card to the front or send it back, and an expanded card comes to the front by itself.
- New palettes: Neon, Dawn and Dusk. A palette swatch sets the app's accent too.
- On a phone, the Add menu is a docked drill-down sheet, Tidy folds into one pill, and a sideways phone runs the tablet layout. Solenoid also installs as a home-screen app.
- Settings has a search box, an empty setting shows its default, and new settings choose where numbers turn scientific and, on desktop, switch the native engine off.
- Delete removes a selected cable.
- Undo restores the exact view you had, even on very large documents.
- Obsidian round trips: frontmatter reads and writes the way Obsidian does, and the plugin's Frame editor suggests column names used across your vault.
- Webpage export renders math as MathML, embeds pictures and SVGs, and shows values in their column formats.
- Safer to open other people's files: an SVG can't carry script onto the canvas, and a File Link asks before it runs a program on Linux or macOS.
- Record: the single-record view is now Detail, and Rows takes a number or a list on every view.
- Schedule and Gantt: work divides by the calendar's hours a day, and MS Project export handles repeated task names, elapsed lags and start-no-earlier-than dates.
- The palette reaches the Add menu, the neutral card colors and sparklines.
- Excel-parity fixes across finance, date, statistics and text functions, on the card and in the formula alike.

Heads up

- Number, Text, Boolean and Date Input are now Value Input.
- The Composed chart is gone: Merge Plots over a Column and a Line chart draws the same figure.
- The NumberValue card is gone: Cast to Number does it.
- In computed columns, `row` and `rows` are now `ROW()` and `ROWS(col)`.
- AVERAGEA, MINA, MAXA, STDEVA, STDEVPA, VARA and VARPA run as their plain forms.
- A list is one row everywhere, so `INDEX(list, 2, 1)` is `#REF!`; use `INDEX(list, 2)`.
- The list Group By is now Group Lists, and Record's Card view is Detail.
- Heatmap outputs a chart instead of passing its table through.
- The Unit Flow example is out for this release.

Under the hood

- Native Polars runs in CI, and the frame-verb fuzzer covers window, fill, replace, slice, bind, cross join and error cells.
- The test suite runs in about 15 seconds instead of about 100.
- Every function's settings share one definition of what a blank means, on the card and in the formula.
- An Excel argument-list check keeps every Excel name's signature honest.
- Repeated code and adversarial review rounds: well over 100 bugs fixed, each with a test.
- The demo video is generated from the real app and a real Obsidian.
- Each site page has its own title and link preview.
- The Solenoid Properties plugin exposes an API for other plugins' Frames.
- Dependencies are current.
