A socket's **shape** is the rank — how many dimensions the value has. Its **colour** is the element family — what kind of thing the individual values are. Within a family the list is a darker shade of the scalar and the matrix a punchier one; a combo's split square takes the scalar colour on the upper-left and the list colour on the lower-right.

| Shape | What it carries |
|---|---|
| Filled circle | one value |
| Filled square | a list — always a list |
| Split square | one value **or** a list (a *combo*) |
| 2×2 grid | a 2-D matrix |
| Square with an **F** | a Frame — named, typed columns |
| Hexagon | a Cube |
| Circle with a **λ** | a function |
| Square with bars · with text lines | a chart · a document |
| Hollow ring | anything at all |

**Two rules govern every cable.**

**Families stay separate.** A value reaches only sockets of its own family, or a grey family-agnostic one. Crossing families takes a **Cast**, element-wise on a list. There is exactly one built-in bridge: **Boolean ⟷ number**, both directions, at every shape — TRUE / FALSE arrives as 1 / 0, and a number arrives as TRUE (non-zero), FALSE (zero) or unknown (NaN).

**Rank flows upward.** A value drops into any socket of equal or greater rank — one value → list → matrix → Frame → Cube — and is reshaped on arrival. The reverse is refused. The one exception: a **combo** may feed its own family's scalar, because a combo may in fact be holding a single value. A plain list may not.

The five families:

- **Numeric** — numbers; the default for arithmetic and statistics.
- **Text**.
- **Date** — calendar dates, held as serial numbers, the same as Excel. The socket type is the only signal that a serial should read as a date, which is why a date keeps a date socket at every shape.
- **Complex** — a real part and an imaginary part.
- **Boolean** — TRUE / FALSE. A comparison or an IS-check produces a real Boolean, not a 1 or 0, though it still adds as 1 / 0 when you want it to. Three-valued: an unknown input keeps the answer unknown only where it genuinely is (TRUE OR unknown is still TRUE).

Outside the families:

- **Frame** — a data table of named, typed columns. A column leaves it as a typed list with Get Column; a row leaves as a one-row Frame, since a row mixes types.
- **Cube** — a Frame whose cells hold whole Frames: each Customer holding its own table of Orders, without flattening to one wide sheet.
- **Wildcards** — the grey sockets, for a family that isn't known.
- **Lambda**, **Chart** and **Document** — not data. Each connects only to its own kind, or to a hollow ring.

**Combos are why lists carry through.** Feed a list into a node built for one value and it runs over every element and hands a list back — Excel's array-formula behaviour, without Ctrl+Shift+Enter. The split square is that node's socket: its result rank follows whatever arrives.
