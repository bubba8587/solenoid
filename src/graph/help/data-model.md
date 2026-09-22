<!-- [[B14]] oneDesignSystem (DESIGN.md § Voice) -->
## What connects, exactly

The ladder above is the whole rule for *shape*. These are its edges.

- A **combo** (split square) is the one shape that narrows. It can *be* a single value, so it plugs into its own family's single-value inputs. A plain List never does; pull a value out with INDEX instead.
- A **Frame** output connects only to Frame and Cube inputs, or a hollow ring. A matrix input would throw away its column names and types, so **Get Column** and **Split Frame** take the pieces out on purpose.
- A **Cube** output connects only to another Cube, or a hollow ring, since anything narrower would drop its nesting. **UNNEST** flattens it on purpose. Going the other way, any data value can become a Cube cell.
- **LAMBDA, Chart and Document** aren't data. Each connects only to its own kind, or to a hollow ring.
- The gray **wildcards** still follow the shape rules of their rung: a gray square is still a List socket, so it still refuses a Frame. The **hollow ring** is the one exception to everything. It takes any value at all, including LAMBDAs, Charts and Documents.

## What happens on arrival

When a cable connects, the value is reshaped for the input. The original is never changed.

- A single value going into a List input becomes a one-item List. Going into a matrix, Frame or Cube input, it becomes a 1×1.
- A **List going into a 2-D input becomes one row**. Transpose it first if you meant a column.
- A one-item List going into a single-value or combo input becomes the value inside. A longer List at a numeric single-value input is a `#SHAPE!`.
- A matrix going into a Frame input gets the column names Col1, Col2, and so on.
- **TRUE/FALSE and numbers** convert here, in whichever direction the input needs.
- Blanks stay **null**: missing, not zero. Aggregates skip them, Filter drops them (or keeps only them, with **is blank**), and Fill replaces them.
- Errors like `#DIV/0!` and `#N/A` pass through every socket unchanged, so a trail of red always leads back to where it started.

With no cable attached, text, date and TRUE/FALSE List inputs take typed comma-separated values. A part that doesn't parse becomes null and keeps its place.

List, Table and Frame Inputs never change what you typed. A stray `abc` or a blank row stays in the source text, and only the output coerces it: blanks become null and unparseable text becomes NaN.

## Sockets that change type

Some inputs **adopt**: they take the type of whatever is plugged in and go back to their own type when unplugged. A hollow ring adopts the incoming type exactly. A gray List or grid input keeps its rank and adopts only the family. Plug a number into one and it becomes a number List socket, not a single number, so it still draws as a List and still refuses a Frame. Adopted types aren't saved; they're worked out again on load, paste and drill-in. A node that passes its input through, like Display, IF, a Conduit lane or INDEX, types its output from that input.

Changing a socket's type in place (a **Cast**'s target, a **Get Column**'s Read as, a Note's frontmatter) **removes any cable whose other end no longer accepts the new type.**

## Why a cable was refused

A cable won't connect if the canvas is **locked**, it loops a node into itself, the **cable already exists**, the **types don't match**, or two Format Controllers have **conflicting units**. Dragging fails silently, but the connection dialog names the mismatch: `Incompatible types: Date → Number.`

On a type mismatch:

- **Wrong family**, like a date into a number: add a **Cast**. TRUE/FALSE and numbers are the one pair that doesn't need one.
- **Too wide for the input**, like a List into a single value or a matrix into a List: reshape it with Get Column, TOCOL or INDEX.
- **A container into something narrower**, like a Cube into a Frame or a Frame into a matrix: use UNNEST or Get Column.

With Quick-wire on in Settings, dropping a cable on empty canvas opens the Add menu with incompatible nodes dimmed, and picking one connects it to the first compatible input.

## What a socket's type controls besides connections

**Display.** How a value shows comes from its socket type, not its cells. A date List shows dates because the socket says date, even though every cell is a whole number. A chip takes its accent color from the same place.

**Format Controller.** The FC shows the controls for its socket's family. Frame, Cube, Document and gray List or combo sockets have none.

## Units

A unit belongs to the **value**, not to a node or a cable. It's set where the value starts: a **Format Controller** docked on a socket, a table column's unit picker, or **Convert**. From there it rides along through anything that only carries the value (selectors, Displays, reshapes) and stops at the first real calculation, where the math works out the result's unit instead: `m × m` is `m²`, `km ÷ h` is a speed, and `10 m ÷ 2 m` cancels to a plain **ratio**, shown as `5:1`.

Because the unit belongs to the value, a Format Controller downstream of a value that already has one shows it **locked**. It mirrors the unit and can't relabel it. Changing a unit changes the number too, so that takes **Convert**.

Adding different dimensions is a **`#UNIT!`**: meters plus seconds has no answer. A plain number with no unit works with anything. It **adopts** the unit of the operation it's in, read in the other side's display unit: `$5 + 3` is `$8`, and `SUM(5 km, 3)` is `8 km`, not 5.003 km.

Where the unit lives depends on the container. It sits at the level that's guaranteed to be uniform:

| Container | Unit granularity | Why |
|---|---|---|
| Single value | the value | the value is the whole thing |
| List | **per item** | a List's items don't have to match, like `[$120, 4 kg]` |
| Matrix | **one unit for the whole grid** | a matrix holds one kind of value throughout |
| Frame | **per column** | each column holds one kind of thing, and a `Speed (km/h)` header locks it |
| Cube | per cell, like a List | Cube cells can hold anything |

A total over mixed units (SUM over that `[$120, 4 kg]`) is a `#UNIT!`, because adding up needs one dimension. Reshaping a matrix keeps its unit. Stacking keeps it only when every part agrees. Matrix math (MMULT, MINVERSE) drops it on purpose.

Two special cases. **Currencies** share one dimension but never mix codes: `$5 + 5€` is a `#UNIT!`, because Solenoid has no exchange rates. And a **custom** unit typed into a Format Controller ("widgets") is its own dimension: `widgets ÷ s` reads `widgets/s`, and widgets only add to widgets.

The number **format** (decimals, percent, thousands separators, `K/M/B`) only changes how a value looks, never the stored value. It lives on the Format Controller next to the unit, but unlike the unit, it can be changed freely downstream.
