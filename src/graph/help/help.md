<!-- [[B14]] oneDesignSystem (DESIGN.md § Voice) -->
# Help

Tooltips and the Socket Legend explain most of Solenoid. This page covers the parts that aren't obvious.

## Selecting

Shift-drag on empty canvas draws a free-form **lasso**, and its winding direction sets the rule, AutoCAD-style. Draw it **clockwise** and it's a *crossing* select: anything the loop touches is caught, and the outline is dashed. Draw it **counter-clockwise** and it's a *window* select: only what's fully enclosed is caught, and the outline is solid. On a phone, **touch select** does the same with a finger.

## Wiring

Most inputs have both a field and a socket, and a connected cable wins over the field. Sockets connect only where their types match; a **Cast** node converts between types.

Deleting a simple pass-through node leaves a dashed **ghost cable** that offers to splice the chain back together, so removing a step doesn't orphan the rest. **Shift-drag** a node to lock its motion to one axis.

## Conduits, groups, standoffs

- A **Group** is a tinted frame around a set of nodes. Collapsed, it shows only its live readouts, and cables crossing the edge land on pills: a finished sub-calculation reads as a single box.
- A **Conduit** bundles cables. Several outputs heading the same way travel as one wide **ribbon**. **Extend** carries the run on to a Conduit further along.
- A **Standoff** holds two items a fixed distance apart while you rearrange everything around them, then can be edited or removed.
- A **Note** is a text label on the canvas. Start it with a `---`-fenced block of `key: value` lines and each key becomes a typed output, so the Note doubles as a set of named constants.

## Reading a graph

- **Isolate** dims everything but the selection (or its whole wired chain, if you ask), to follow one calculation through a busy canvas.
- **Pin** parks a node's live result in a strip along the top. The pin flies you back to its node.
- A failed calculation turns the value box red with an Excel code like `#DIV/0!`, `#N/A`, or `#SHAPE!`, and the error flows downstream, so a trail of red leads back to where it started. IFERROR and the IS-checks catch it the way Excel does.

## Units and formatting

A **Format Controller** docks beside a socket and sets how a value reads: decimals or significant figures, percent, a date style, and a **unit**. Currency is a unit, not a number style, so `$1,234.50` is "two decimals" plus "US dollars". The format rides downstream through anything that passes the value along, and through calculations that keep its meaning, like adding two percents. It resets at one that doesn't, like multiplying. The unit belongs to the value itself, and **Convert** is how you change it, °C to °F or miles to km. Load the **Unit Flow** example to see it in one graph.

## Formulas

The **Expression** node takes a formula like `a * b + 1` and turns each variable into an input, so one node can stand in for a chain of arithmetic nodes. It has the Excel functions, works over Lists and matrices, and reads `pi`, `tau`, `e` and `phi` as constants. **MAP**, **BYROW**, **BYCOL** and **REDUCE** run a formula over a collection: MAP transforms every cell, BYROW and BYCOL reduce each row or column, and REDUCE folds everything to one value. **LAMBDA** packages a formula so any of them can reuse it.

Formulas don't take Frames. For math on each row of a table, use a computed column: an **Fx** column in Frame Input, or the Computed Column node. Inside one, `@Price` is this row's Price and a bare `Price` is the whole column, the same as in an Excel table.

## Recalculation

Everything recomputes live. The exceptions are the random nodes and Today / Now, which keep their value until you press their ⟳ button, or **F9** to refresh all of them at once. For heavy graphs, set **Calculate ▸ Manual**, and nothing recomputes until you press F9.

## Saving

Every document autosaves and comes back when you reopen. **Save / Open** read and write JSON: a real file on desktop, a download and upload in the browser. Opening a file or an **example** adds it as a new document. Files from other versions of Solenoid won't open.

## From Excel, wired

| In Excel you'd write… | Here you wire… |
|---|---|
| `=A1*B1` filled down a column | one **Arithmetic** or **Expression** node; feed it a list and it runs down the column |
| `{=array formula}` (Ctrl+Shift+Enter) | nothing special. Every node already broadcasts over lists |
| `=SUMIF` / `=AVERAGEIF` / `=COUNTIF` | **Filter** → **Aggregate** set to SUM / AVG / COUNT |
| `=VLOOKUP` / `=INDEX(MATCH())` | **XLOOKUP**, or **Get Column** + **INDEX** |
| a PivotTable | **PIVOTBY** (or **GROUPBY** for the one-key case) |
| `=IFERROR(x, fallback)` | the **IFERROR** node, or **Fill** for blanks |
| nested `=IF(…, IF(…))` | one **IFS** or **SWITCH** with as many cases as you need |
| Power Query's join / append / unpivot | the **Join** / **Append** / **Unpivot** nodes |

## Plans

**Schedule** reads a table of tasks. Task is the first text column, Duration the first number column in days (blank or 0 is a milestone), and Predecessors a list cell naming the tasks that must finish first, or a nested table of Task, Type (FS, SS, FF or SF) and Lag. A row whose Tasks cell holds a table is a summary of those rows. The other columns are optional:

| Column | Effect |
|---|---|
| Start, Finish | holds a task no earlier than a date; caps it and shows negative float |
| Deadline | flags a late finish |
| Manual | pins a task to its dates |
| Complete | 0 to 100 |
| Project | groups the Gantt into sections |
| ALAP | starts a task as late as possible |
| Actual start | the day work began |
| Elapsed | counts every day, weekends included |
| Weekend, Hours, Holidays | a task's own calendar |
| Work, Units | hours of work and people on it, setting Duration when it is blank |
| Resource | who does it, for the histogram |
| Active | FALSE leaves a row in place with no dates |
| Repeat, Every | a recurring row: N occurrences, k days apart |

**Gantt** takes its view from the options string, `key=value` pairs separated by semicolons:

| Key | Values |
|---|---|
| zoom | day, week, month, quarter, year, fit |
| tiers | 1 or 2 header rows |
| window | two dates, `1-Jun,31-Aug`, framing the timeline |
| collapse | fold nesting below this level |
| columns | name, start, finish, duration, float, complete, predecessors |
| layout | gantt, or calendar for a month grid |
| fit | page lays the whole plan out to one width for export |
| week | iso or us |
| fiscal_start | the month, 1 to 12, that starts the fiscal year |
| critical, baseline, arrows, today, status, weekends, labels, histogram, minutes, group_by | on or off |

`title` and `fontsize` apply as on every chart.

## Keyboard

Single keys work when you're not typing in a field.

| | |
|---|---|
| **A** | Add a node at the cursor |
| **N** | Show or hide the Navigator |
| **Enter** | Open the command palette |
| **G** / **I** | Group / isolate the selection |
| **T** / **C** | Tidy (auto-arrange) / cleanup (tidy, collapse, fit) |
| **E** / **F** | Expand or collapse groups / fit a group to its members |
| **[** **]** | Rotate the selected Conduit, Angle Dial, or Standoff |
| **arrows** | Nudge selection (Shift = larger step) |
| **Tab** | Show or hide the side panels |
| **Esc** | Leave isolate mode |
| **Ctrl+Z / Ctrl+Shift+Z** | Undo / redo |
| **Ctrl+C / Ctrl+V** | Copy / paste, wiring intact |
| **Ctrl+Shift+G** | Make a Composite from the selection |
| **Ctrl+A / Ctrl+F** | Select all / find a node |
| **Ctrl+S / Ctrl+Shift+S** | Save / Save As |
| **Ctrl+O / Ctrl+Shift+L** | Open / reload the document |
| **Ctrl+/ / Ctrl+,** | This reference / Settings |
| **F9** | Recalculate the volatile nodes |

## Phone and tablet

The hamburger menu carries the same tools. **Touch select** lassos with a finger, and **Insert ▸ Connection** wires two sockets by picking them from lists instead of dragging.
