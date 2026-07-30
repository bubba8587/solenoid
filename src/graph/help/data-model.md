## What connects, exactly

The ladder above is the whole rule for *shape*; these are the edges of it.

- A **combo** (split square) is the one shape that narrows: it can *be* a single value, so it drops into its own family's scalar input. A plain list never does — pull a value out with INDEX instead.
- A **Frame** output reaches only Frame and Cube inputs, or a hollow ring. Letting it into a plain matrix input would silently throw away the column names and types; **Get Column** or **Split Frame** take the pieces out on purpose.
- A **Cube** output reaches only another Cube, or a hollow ring — anything narrower would drop its nesting, so **UNNEST** does that explicitly. Everything flows *in*: any data value widens into a Cube cell.
- **Lambda, Chart and Document** are object values, outside the data lattice entirely: each connects only to its own kind, or a hollow ring. A chart isn't a table of numbers; a lambda isn't a value to add.
- The gray **wildcards** keep the shape rules at their own rung — a gray square is still a list socket, so it still refuses a Frame. The **hollow ring** is the exception to everything: it takes any value whatsoever, object types included.

## What happens on arrival

When a cable lands, the value is reshaped for the input — never mutated in place:

- a single value entering a list input becomes a one-element list; entering a matrix, Frame or Cube input, a 1×1;
- a **list entering a 2-D input becomes ONE ROW** (transpose it first if you meant a column);
- a one-element list entering a scalar or combo input collapses to the value inside — at a *numeric* scalar, a longer list is a `#SHAPE!`;
- a matrix entering a Frame input gets generated column names (Col1, Col2, …);
- **Boolean ⟷ number** converts here, in whichever direction the socket asks for;
- blanks stay **null** — missing, not zero. Aggregators skip them, Filter drops them (or selects exactly them, with **is blank**), Fill replaces them;
- errors (`#DIV/0!`, `#N/A`, …) pass through *every* socket untouched — error in, error out, so the red trail survives any plumbing.

Text, date and Boolean **list** inputs are typeable in place: with no cable attached, text typed into the box is read as CSV, and a part that won't parse for the type becomes null and holds its position.

The literal sources (List / Table / Frame Input) follow one rule: **the Source is never coerced.** What you typed stays verbatim in the source text — a stray `abc` in a number table, a blank row you left for later — and only the *derived* value coerces it: blank → null, unparseable → NaN. Retype nothing; fix it when you mean to.

## Sockets that change type

Some ports **adopt**: the socket takes the type of the cable plugged in and reverts to its own when unplugged. A hollow ring adopts whatever arrives, verbatim. A gray list or grid port instead **keeps its rank** and adopts only the family — wire a number into one and it becomes a *numeric list* socket, not a numeric scalar, so it still draws as a list and still refuses a Frame. Adoption is never saved to a file; it is recomputed on load, paste and drill-in. A passthrough node (Display, IF, Conduit lanes, INDEX) types its output from the input it forwards.

Retyping a socket in place — switching a **Cast**'s target, a **Get Column** read-as, editing a Note's frontmatter — **drops any cable whose target no longer accepts the new type.**

## Why a cable was refused

A drag that won't drop has exactly three causes: the canvas is **locked**; it's a **self-loop**, an output wired back into its own node; or the **types don't connect**. The drag guard refuses silently, but wiring through the connection dialog names the reason — `Incompatible types: Date → Number.`

On a type mismatch:

- **wrong family** (a date into a number, text into a number) — insert a **Cast**; the one pair that needs none is Boolean ⟷ number;
- **wrong direction on the ladder** (a list into a scalar, a matrix into a list) — the value is wider than the port, so reshape it explicitly: Get Column, TOCOL, INDEX;
- **a container into something narrower** (a Cube into a Frame, a Frame into a matrix) — UNNEST or Get Column.

Dragging a cable into empty canvas opens the Add menu filtered to nodes that will actually connect, and wires the first compatible port.

## What a socket's type controls besides connections

**Display.** How a value renders is chosen from its socket type, not by reading its cells — a date list reads as dates because the socket says date, even if every cell is an integer. A chip takes its accent color from the same source.

**Format Controller.** The FC offers the control set for its socket's family. A Frame, Cube, Document or gray list/combo socket has none.

## Units

A unit is a property of the **value**, not of a node or a wire. It is authored at the value's origin — a **Format Controller** docked on a socket, a table column's unit picker, or **Convert**. From there the unit rides the value through anything that merely carries it — selectors, Displays, reshapes — and breaks at the first real transform, where the arithmetic *derives* the result's unit instead: `m × m` is `m²`, `km ÷ h` is a speed, and `10 m ÷ 2 m` cancels to a pure **ratio**, shown `5:1`.

Because the unit is the value's, a Format Controller downstream of a value that already carries one shows it **locked** — it mirrors, it doesn't relabel. A unit change is really a magnitude change, so it takes **Convert**.

Mixing genuinely different dimensions in one sum is a **`#UNIT!`** — meters plus seconds has no answer. A bare, unitless number is compatible with anything: it **adopts** the unit of the operation it's in, read in the other side's display unit — `$5 + 3` is `$8`, and `SUM(5 km, 3)` is `8 km`, not 5.003 km.

Where the unit *lives* depends on the container — it attaches at the level that is guaranteed uniform:

| Container | Unit granularity | Why |
|---|---|---|
| Single value | the value | — |
| List | **per element** | a list is the one shape with no uniformity guarantee — Get Row hands you a legitimate `[$120, 4 kg]` |
| Matrix | **one unit for the whole grid** | a matrix is one element type by construction, so one quantity |
| Frame | **per column** | each column is one homogeneous population; a `Speed (km/h)` header locks it |
| Cube | per cell, like a list | cube cells hold anything |

A fold over mixed-unit elements (SUM over that `[$120, 4 kg]`) is a `#UNIT!` — aggregation demands one dimension. Structural reshapes carry a matrix's unit; stacking carries it only when every part agrees; linear algebra (MMULT, MINVERSE) deliberately drops it.

Two special cases: **currencies** share one dimension but never cross codes — `$5 + 5€` is a `#UNIT!`, because there is no exchange rate in the model. And a **custom** unit typed into a Format Controller ("widgets") becomes its own dimension: `widgets ÷ s` reads `widgets/s`, and widgets never add to anything that isn't widgets.

The number **format** — decimals, percent, thousands separators, `K/M/B` — is a different animal: display-only, never touching the stored value. It travels with the unit on the Format Controller but re-formats freely downstream; the unit is the part with physics.
