# Help

Sockets, ops, and fields carry tooltips, and the corner legend is the type key, so most of the surface explains itself. This covers the parts that behave in a way you wouldn't guess.

## Selecting

Shift-drag on empty canvas draws a free-form **lasso**, and its winding direction sets the rule, AutoCAD-style. Draw it **clockwise** and it's a *crossing* select — anything the loop touches is caught, and the outline is dashed. Draw it **counter-clockwise** and it's a *window* select — only what's fully enclosed is caught, and the outline is solid. (On a phone, **touch select** does the same with a finger.)

## Wiring

Most inputs take both a typed-in value and a socket; a connected cable wins over whatever is in the field. Sockets join only where their types match — a **Cast** node is the deliberate crossover.

Deleting a simple pass-through node leaves a dashed **ghost cable** that offers to splice the chain back together, so removing a step doesn't orphan the rest. **Shift-drag** a node to lock its motion to one axis.

## Conduits, groups, standoffs

- A **Group** is a tinted frame around a set of nodes. Collapsed, it shows only its live readouts, and cables crossing the edge land on pills — a finished sub-calculation reads as a single box.
- A **Conduit** bundles cables. Several outputs heading the same way travel as one wide **ribbon**; **Extend** carries the run on to a Conduit further along.
- A **Standoff** holds two items a fixed distance apart while you rearrange everything around them, then can be edited or removed.
- A **Note** is a label pinned to a region of canvas, outside the math — unless you open it with a `---`-fenced block of `key: value` lines, which turns each key into a typed output socket. A Note then doubles as a block of named constants.

## Reading a graph

- **Isolate** dims everything but the selection (or its whole wired chain, if you ask), to follow one calculation through a busy canvas.
- **Pin** parks a node's live result in a strip along the top; the pin flies you back to its node.
- A failed calculation turns the value box red with an Excel code — `#DIV/0!`, `#N/A`, `#SHAPE!` — and the error flows downstream, so a trail of red leads back to where it started. IFERROR and the IS-checks catch it the way Excel does.

## Units and formatting

A **Format Controller** docks beside a socket and sets how a value reads: decimals or significant figures, percent, a date style, and a **unit** label (currency is a unit, not a number style — `$1,234.50` is "two decimals" plus "US dollars"). The format belongs to the value, so it rides downstream through anything that merely passes the value along, and resets at the first node that *transforms* it. **Convert** changes the unit itself — °C to °F, miles to km — and hands the new unit forward. Load the **Unit Flow** example to see it in one graph.

## Formulas

When wiring a chain of arithmetic nodes is overkill, the **Expression** node takes a formula like `a * b + 1` and turns each variable into an input socket, with the Excel functions and list-broadcasting available and `pi`/`tau`/`e`/`phi` as constants. The **lambda** nodes run that same engine over a collection — MAP transforms every cell, BYROW / BYCOL reduce each row or column, REDUCE folds to one value — and **LAMBDA** packages a formula as a value to feed any of them.

## Recalculation

Everything recomputes live. The exceptions are the random nodes and Today / Now, which hold their value until you press their ⟳ button — or **F9** to recalculate all of them at once.

## Saving

The graph autosaves and returns when you reopen, no file needed. **Save / Open** read and write a graph as JSON — a real file on the desktop app, a download and upload in the browser. The **examples** menu loads a sample in place of the canvas, so save first. A file from a newer version won't open in an older one; you get a clear message rather than a broken graph.

## From Excel, wired

| In Excel you'd write… | Here you wire… |
|---|---|
| `=A1*B1` filled down a column | one **Arithmetic** or **Expression** node — feed it a list and it runs down the column |
| `{=array formula}` (Ctrl+Shift+Enter) | nothing special; every node already broadcasts over lists |
| `=SUMIF` / `=AVERAGEIF` / `=COUNTIF` | **Filter** → **Aggregate** set to SUM / AVG / COUNT |
| `=VLOOKUP` / `=INDEX(MATCH())` | **XLOOKUP**, or **Get Column** + **INDEX** |
| a PivotTable | **Pivot** (or **Group By** for the one-key case) |
| `=IFERROR(x, fallback)` | the **IFERROR** node, or **Fill** for blanks |
| nested `=IF(…, IF(…))` | one **IFS** or **SWITCH** with as many cases as you need |
| Power Query's join / append / unpivot | the **Join** / **Append** / **Unpivot** nodes |

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
