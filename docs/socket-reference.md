# Socket reference

Every socket variant in Solenoid, in plain English: what it carries, what it looks
like, what may connect to it, what is blocked, and what happens to a value the
moment it arrives.

There are **30 socket variants**. This document has one section for each. It
describes only what the system **does** and what it **blocks** — a rule that is
absent is simply not listed.

The machine-readable source for the connection lists below is `src/graph/sockets.ts`;
the arrival behaviour is `src/graph/coerceInputs.ts`; the drawing is
`src/graph/components/SocketComponent.tsx`. Regenerate the port counts with
`npx tsx scripts/socket-inventory.ts`.

---

## 1. Vocabulary

These words are used with exactly these meanings throughout. Where Solenoid's
internal name differs from the on-screen label, both are given.

**Node** — one card on the canvas.

**Port** — one named connection point on a node (`Value`, `List`, `Result`). A port
belongs to exactly one node and is either an input or an output.

**Socket** — the typed dot drawn at a port. Every port has exactly one socket.

**Socket variant** — one of the 30 named types a socket can be (`number`,
`strlist`, `frame`, `trueany`, …). "Variant" always means the type, never a
particular port on a particular node.

**Cable** — a connection from an output port to an input port.

**Element family** — what kind of thing the individual values are. There are five:
**number**, **string** (text), **date**, **complex**, **logical** (boolean).
Some variants belong to no family; they are called *element-agnostic*.

**Rank** — how many dimensions a value has. Rank 0 is a single value (**scalar**),
rank 1 is a **list**, rank 2 is a **matrix**. Frames, cubes, functions, charts and
documents carry no rank.

**Rung** — one cell of the (element family × rank) grid. Each of the five families
has four rungs:

| family | scalar | list | combo | matrix |
|---|---|---|---|---|
| number | `number` | `list` | `numlist` | `table` |
| string | `string` | `strlist` | `strcombo` | `strtable` |
| date | `date` | `datelist` | `datecombo` | `datetable` |
| complex | `complex` | `complexlist` | `complexcombo` | `complextable` |
| logical | `logical` | `logicallist` | `logicalcombo` | `logicaltable` |

**Combo** — the "scalar **or** list" rung of a family. It is used by any operation
whose result rank follows its input rank: `Add(2, 3)` produces one number,
`Add([1,2], [3,4])` produces a list, and one socket has to describe both.

**Strict list** — the plain list rung (`list`, `strlist`, `datelist`,
`complexlist`, `logicallist`, `anylist`). It always holds a list. This is the rung
to choose when a single value must be treated as a one-element list rather than as
a scalar.

**Wildcard** — a variant that carries no element family. There are five, forming a
ladder: `any` (rank 0), `anycombo` (rank 0-or-1), `anylist` (rank 1), `anytable`
(rank 2), `trueany` (the top — anything at all).

**Widening** — a value moving up the rank ladder: a scalar becoming a
one-element list, a list becoming a one-row matrix, a matrix becoming a frame, and
anything becoming a cube. Widening is what the socket system permits between ranks.

**Narrowing** — the reverse. Narrowing is blocked at the socket, with one named
exception (see the second rule below).

**Collapsing** — the runtime counterpart of the combo→scalar exception: a
one-element list arriving at a rung whose rank can be 0 is unwrapped to the value
it contains.

**The boundary** — the single wrapper (`wrapNodeData`) placed around every node's
compute function. It reshapes each incoming value to what the receiving socket
declares before the node runs. Every "on arrival" description in this document is
the boundary's work.

**Adoptive port** — a port whose socket changes type to match the cable plugged
into it, and changes back when unplugged. Its declared type is called its **base**.

**Passthrough** — a node that forwards a value from an input to an output without
changing what it is (Display, IF, Conduit lanes, INDEX). Passthrough nodes declare
which output follows which inputs, and type information travels along that
declaration.

**Blocked** — the connection guard refuses the cable. The user sees the drag
rejected.

**Frame** — a data table with named, typed columns.

**Cube** — a frame whose cells may themselves hold any value, including another
frame or cube. It is the top of the data lattice: every data value widens into it.

**Frame ref** — a lazy handle to a frame that has not been computed yet. The
relational verb nodes pass these to each other and the engine executes the whole
chain in one round trip.

**Unit cell** — a number tagged with a physical dimension (metres, seconds). Only
nodes that run the unit algebra receive them; every other node receives the plain
magnitude.

**SolError** — a tagged error value (`#SHAPE!`, `#DIV/0!`, `#N/A` …) that flows
along cables like any other value.

**Null** — a first-class missing value. It is distinct from zero, from empty text,
and from an error.

---

## 2. The two governing rules

**Rule 1 — element families stay separate.** A value of one family reaches only
sockets of that same family, or an element-agnostic socket. Crossing families
requires an explicit Cast node. There is exactly **one** built-in bridge:
**`logical` ↔ `number`**, in both directions, at every rank. A boolean arriving at
a numeric socket becomes 1 or 0; a number arriving at a logical socket becomes
TRUE (non-zero), FALSE (zero) or null (NaN).

**Rule 2 — rank flows upward.** Within a family, a value of rank *r* reaches any
socket of rank ≥ *r*. Rank 0 → 1 → 2, then into `frame`, then into `cube`.
Narrowing is blocked, with one exception: **a combo socket may feed the scalar
socket of its own family**, because a combo may in fact be holding a scalar. A
strict list may not.

At runtime the same exception is honoured by collapsing: a one-element list
arriving at a combo or scalar socket becomes the value it contains. A longer list
arriving at a scalar socket is an accepted risk — the numeric scalar coercer raises
`#SHAPE!`.

---

## 3. Reading a socket at a glance

The **shape** of the dot tells you the rank. The **colour** tells you the element
family.

| Shape | Meaning | Variants |
|---|---|---|
| Filled circle | scalar | `number` `string` `date` `complex` `logical` `any` |
| Filled rounded square | strict list | `list` `strlist` `datelist` `complexlist` `logicallist` `anylist` |
| Two-tone split square | combo (scalar or list) | `numlist` `strcombo` `datecombo` `complexcombo` `logicalcombo` `anycombo` |
| Square with a 2×2 grid | matrix | `table` `strtable` `datetable` `complextable` `logicaltable` `anytable` |
| Square with an "F" | frame | `frame` |
| Flat hexagon (three rhombi) | cube | `cube` |
| Circle with a λ | function | `lambda` |
| Square with three bars | chart | `chart` |
| Square with two text lines | document | `document` |
| Hollow ring (outline only) | anything | `trueany` |

Colours by family: number amber, text yellow-green, date pink, complex sky blue,
logical purple, frame and cube violet, function teal-green, chart and document
blue, all five wildcards gray. Within a family, the strict list is a darker shade
of the scalar and the matrix is a more saturated shade. A combo's split square
takes the scalar colour on the upper-left triangle and the list colour on the
lower-right. `anycombo`, whose family has only one colour, takes gray on the
upper-left and gray's own border shade on the lower-right, so the split stays
visible without inventing a hue.

Every dot's border is the same fixed darkening of its own fill. Hovering a dot
shows the variant's human label.

---

## 4. What the boundary does to every value, regardless of variant

These apply first, at every socket:

1. **A frame ref passes through untouched.** It is an opaque handle. For a node
   that is not one of the lazy relational verbs, the boundary first materialises
   the ref into a real frame, then applies the reshaping below.
2. **A SolError passes through untouched**, at every variant. Errors propagate.
3. **A unit cell** reaches only a node that runs the unit algebra, or a
   passthrough node on the specific inputs it declares as forwarded. Everywhere
   else the cell is unwrapped to its display magnitude before the socket sees it.
   Where a unit cell does arrive, it is shaped by rank without the numeric
   coercers: a scalar socket takes the cell (or a one-element list of one cell);
   a strict list wraps a lone cell into a singleton; a combo leaves it alone; a
   matrix, frame or cube socket widens it element-agnostically and keeps the cell.
4. **Three variants are typeable in place** — `strlist`, `datelist` and
   `logicallist`. When such an input has no cable, text typed into its box is
   parsed as CSV and injected as the list. A part that will not parse for the type
   becomes null, holding its position.
5. **A few ports opt out entirely.** A node that branches on the runtime shape
   itself declares those input keys as raw, and the value reaches it exactly as it
   flowed in. In the shipped catalog this is XLOOKUP's frame/cube input and the
   two chart nodes that accept either a list or a frame of values.

---

## 5. The variants

Each section lists the variants a cable may arrive **from** (identity included),
what is **blocked at the input**, what the variant **reaches**, what is **blocked
at the output**, and what happens **on arrival**.

The port counts are distinct node-class ports in the shipped catalog, counted on a
freshly created node. A node that swaps a socket by selection — Cast's target, Get
Column's read-as — is counted at its default, so its other targets read as zero.
A variadic row (`Value 1`, `Value 2`, …) counts once, as the one extensible role
it is.

---

### 5.1 The number family

#### `number` — "Number"

**Holds:** one number.
**Dot:** amber filled circle.
**Ports:** 191 inputs, 102 outputs — the most-used variant in the app.

**Accepts from:** `number`, `numlist`, `logical`, `logicalcombo`, `anycombo`,
`any`, `trueany`.

**Blocked at the input:** `list`, `string`, `strlist`, `strcombo`, `date`,
`datelist`, `datecombo`, `complex`, `complexlist`, `complexcombo`, `complextable`,
`logicallist`, `logicaltable`, `table`, `strtable`, `datetable`, `anytable`,
`anylist`, `frame`, `cube`, `lambda`, `chart`, `document`.

**Reaches:** `number`, `list`, `numlist`, `logical`, `logicallist`,
`logicalcombo`, `logicaltable`, `table`, `anytable`, `anylist`, `anycombo`,
`frame`, `cube`, `any`, `trueany`.

**Blocked at the output:** `string`, `strlist`, `strcombo`, `date`, `datelist`,
`datecombo`, `complex`, `complexlist`, `complexcombo`, `complextable`, `strtable`,
`datetable`, `lambda`, `chart`, `document`.

**On arrival:** booleans convert to 1/0, then the value is reduced to a single
number. A one-element list collapses to its element. A longer list or a matrix
raises `#SHAPE!`.

#### `list` — "List (number)"

**Holds:** a list of numbers. Strict: always a list.
**Dot:** dark amber filled square.
**Ports:** 66 inputs, 19 outputs.

**Accepts from:** `number`, `list`, `numlist`, `logical`, `logicallist`,
`logicalcombo`, `anylist`, `anycombo`, `any`, `trueany`.

**Blocked at the input:** `string`, `strlist`, `strcombo`, `date`, `datelist`,
`datecombo`, `complex`, `complexlist`, `complexcombo`, `complextable`,
`logicaltable`, `table`, `strtable`, `datetable`, `anytable`, `frame`, `cube`,
`lambda`, `chart`, `document`.

**Reaches:** `list`, `numlist`, `logicallist`, `logicalcombo`, `logicaltable`,
`table`, `anytable`, `anylist`, `anycombo`, `frame`, `cube`, `trueany`.

**Blocked at the output:** `number`, `string`, `strlist`, `strcombo`, `date`,
`datelist`, `datecombo`, `complex`, `complexlist`, `complexcombo`, `complextable`,
`logical`, `strtable`, `datetable`, `lambda`, `chart`, `document`, `any`.

**On arrival:** booleans convert to 1/0, then the value is flattened to a 1-D
numeric list. A scalar widens to a one-element list. A matrix flattens.

#### `numlist` — "Number or list"

**Holds:** one number **or** a list of numbers. The number family's combo.
**Dot:** two-tone split square, amber over dark amber.
**Ports:** 149 inputs, 93 outputs.

**Accepts from:** `number`, `list`, `numlist`, `logical`, `logicallist`,
`logicalcombo`, `anylist`, `anycombo`, `any`, `trueany`.

**Blocked at the input:** `string`, `strlist`, `strcombo`, `date`, `datelist`,
`datecombo`, `complex`, `complexlist`, `complexcombo`, `complextable`,
`logicaltable`, `table`, `strtable`, `datetable`, `anytable`, `frame`, `cube`,
`lambda`, `chart`, `document`.

**Reaches:** `number`, `list`, `numlist`, `logical`, `logicallist`,
`logicalcombo`, `logicaltable`, `table`, `anytable`, `anylist`, `anycombo`,
`frame`, `cube`, `any`, `trueany` — including the scalar `number`, by the combo
exception.

**Blocked at the output:** `string`, `strlist`, `strcombo`, `date`, `datelist`,
`datecombo`, `complex`, `complexlist`, `complexcombo`, `complextable`, `strtable`,
`datetable`, `lambda`, `chart`, `document`.

**On arrival:** booleans convert to 1/0. A 2-D matrix flattens to a list so
element-wise logic never sees rows. A one-element list collapses to its number.
Everything else keeps its natural rank — that is the point of the rung.

#### `table` — "Matrix (number)"

**Holds:** a 2-D numeric matrix.
**Dot:** gold 2×2-grid square.
**Ports:** 8 inputs, 11 outputs.

**Accepts from:** `number`, `list`, `numlist`, `logical`, `logicallist`,
`logicalcombo`, `logicaltable`, `table`, `anytable`, `anycombo`, `any`, `trueany`.

**Blocked at the input:** `string`, `strlist`, `strcombo`, `date`, `datelist`,
`datecombo`, `complex`, `complexlist`, `complexcombo`, `complextable`, `strtable`,
`datetable`, `anylist`, `frame`, `cube`, `lambda`, `chart`, `document`.

**Reaches:** `logicaltable`, `table`, `anytable`, `frame`, `cube`, `trueany`.

**Blocked at the output:** `number`, `list`, `numlist`, `string`, `strlist`,
`strcombo`, `date`, `datelist`, `datecombo`, `complex`, `complexlist`,
`complexcombo`, `complextable`, `logical`, `logicallist`, `logicalcombo`,
`strtable`, `datetable`, `anylist`, `anycombo`, `lambda`, `chart`, `document`,
`any`.

**On arrival:** booleans convert to 1/0, then the value is shaped into a 2-D
numeric matrix — a scalar becomes 1×1, a list becomes one row. A homogeneous
matrix unit tag survives the reshape.

---

### 5.2 The text family

#### `string` — "Text"

**Holds:** one piece of text.
**Dot:** yellow-green filled circle.
**Ports:** 68 inputs, 10 outputs.

**Accepts from:** `string`, `strcombo`, `anycombo`, `any`, `trueany`.

**Blocked at the input:** `number`, `list`, `numlist`, `strlist`, `date`,
`datelist`, `datecombo`, `complex`, `complexlist`, `complexcombo`, `complextable`,
`logical`, `logicallist`, `logicalcombo`, `logicaltable`, `table`, `strtable`,
`datetable`, `anytable`, `anylist`, `frame`, `cube`, `lambda`, `chart`,
`document`.

**Reaches:** `string`, `strlist`, `strcombo`, `strtable`, `anytable`, `anylist`,
`anycombo`, `frame`, `cube`, `any`, `trueany`.

**Blocked at the output:** `number`, `list`, `numlist`, `date`, `datelist`,
`datecombo`, `complex`, `complexlist`, `complexcombo`, `complextable`, `logical`,
`logicallist`, `logicalcombo`, `logicaltable`, `table`, `datetable`, `lambda`,
`chart`, `document`.

**On arrival:** a one-element list collapses to the text it contains. Everything
else passes as-is.

#### `strlist` — "List (text)"

**Holds:** a list of text values. Strict.
**Dot:** dark yellow-green filled square.
**Ports:** 18 inputs, 4 outputs. **Typeable in place.**

**Accepts from:** `string`, `strlist`, `strcombo`, `anylist`, `anycombo`, `any`,
`trueany`.

**Blocked at the input:** `number`, `list`, `numlist`, `date`, `datelist`,
`datecombo`, `complex`, `complexlist`, `complexcombo`, `complextable`, `logical`,
`logicallist`, `logicalcombo`, `logicaltable`, `table`, `strtable`, `datetable`,
`anytable`, `frame`, `cube`, `lambda`, `chart`, `document`.

**Reaches:** `strlist`, `strcombo`, `strtable`, `anytable`, `anylist`, `anycombo`,
`frame`, `cube`, `trueany`.

**Blocked at the output:** `number`, `list`, `numlist`, `string`, `date`,
`datelist`, `datecombo`, `complex`, `complexlist`, `complexcombo`, `complextable`,
`logical`, `logicallist`, `logicalcombo`, `logicaltable`, `table`, `datetable`,
`lambda`, `chart`, `document`, `any`.

**On arrival:** a lone value widens to a one-element list. An unwired port with
typed CSV text parses that text into the list — every part is valid text.

#### `strcombo` — "Text or list"

**Holds:** one piece of text **or** a list of text. The text family's combo.
**Dot:** two-tone split square, yellow-green over dark yellow-green.
**Ports:** 20 inputs, 15 outputs.

**Accepts from:** `string`, `strlist`, `strcombo`, `anylist`, `anycombo`, `any`,
`trueany`.

**Blocked at the input:** `number`, `list`, `numlist`, `date`, `datelist`,
`datecombo`, `complex`, `complexlist`, `complexcombo`, `complextable`, `logical`,
`logicallist`, `logicalcombo`, `logicaltable`, `table`, `strtable`, `datetable`,
`anytable`, `frame`, `cube`, `lambda`, `chart`, `document`.

**Reaches:** `string`, `strlist`, `strcombo`, `strtable`, `anytable`, `anylist`,
`anycombo`, `frame`, `cube`, `any`, `trueany` — including the scalar `string`, by
the combo exception.

**Blocked at the output:** `number`, `list`, `numlist`, `date`, `datelist`,
`datecombo`, `complex`, `complexlist`, `complexcombo`, `complextable`, `logical`,
`logicallist`, `logicalcombo`, `logicaltable`, `table`, `datetable`, `lambda`,
`chart`, `document`.

**On arrival:** a one-element list collapses to the text it contains. Everything
else keeps its natural rank.

#### `strtable` — "Matrix (text)"

**Holds:** a 2-D matrix of text.
**Dot:** saturated yellow-green 2×2-grid square.
**Ports:** none in the shipped catalog. The variant exists as the text family's
matrix rung and is reachable by adoption — a text-family value flowing into an
adoptive matrix port takes this type.

**Accepts from:** `string`, `strlist`, `strcombo`, `strtable`, `anytable`,
`anycombo`, `any`, `trueany`.

**Blocked at the input:** `number`, `list`, `numlist`, `date`, `datelist`,
`datecombo`, `complex`, `complexlist`, `complexcombo`, `complextable`, `logical`,
`logicallist`, `logicalcombo`, `logicaltable`, `table`, `datetable`, `anylist`,
`frame`, `cube`, `lambda`, `chart`, `document`.

**Reaches:** `strtable`, `anytable`, `frame`, `cube`, `trueany`.

**Blocked at the output:** `number`, `list`, `numlist`, `string`, `strlist`,
`strcombo`, `date`, `datelist`, `datecombo`, `complex`, `complexlist`,
`complexcombo`, `complextable`, `logical`, `logicallist`, `logicalcombo`,
`logicaltable`, `table`, `datetable`, `anylist`, `anycombo`, `lambda`, `chart`,
`document`, `any`.

**On arrival:** the value passes as-is — the producing node has already shaped it.

---

### 5.3 The date family

Dates are stored as serial numbers, exactly as in Excel. The socket type is the
only signal that a serial should render as a date, which is why a date value keeps
a date socket through every rung.

#### `date` — "Date"

**Holds:** one date serial.
**Dot:** pink filled circle.
**Ports:** 26 inputs, 7 outputs.

**Accepts from:** `date`, `datecombo`, `anycombo`, `any`, `trueany`.

**Blocked at the input:** `number`, `list`, `numlist`, `string`, `strlist`,
`strcombo`, `datelist`, `complex`, `complexlist`, `complexcombo`, `complextable`,
`logical`, `logicallist`, `logicalcombo`, `logicaltable`, `table`, `strtable`,
`datetable`, `anytable`, `anylist`, `frame`, `cube`, `lambda`, `chart`,
`document`.

**Reaches:** `date`, `datelist`, `datecombo`, `datetable`, `anytable`, `anylist`,
`anycombo`, `frame`, `cube`, `any`, `trueany`.

**Blocked at the output:** `number`, `list`, `numlist`, `string`, `strlist`,
`strcombo`, `complex`, `complexlist`, `complexcombo`, `complextable`, `logical`,
`logicallist`, `logicalcombo`, `logicaltable`, `table`, `strtable`, `lambda`,
`chart`, `document`.

**On arrival:** a one-element list collapses to the serial it contains.

#### `datelist` — "List (date)"

**Holds:** a list of date serials. Strict.
**Dot:** dark pink filled square.
**Ports:** 2 inputs, no outputs (the holiday lists on WORKDAY and NETWORKDAYS).
**Typeable in place.**

**Accepts from:** `date`, `datelist`, `datecombo`, `anylist`, `anycombo`, `any`,
`trueany`.

**Blocked at the input:** `number`, `list`, `numlist`, `string`, `strlist`,
`strcombo`, `complex`, `complexlist`, `complexcombo`, `complextable`, `logical`,
`logicallist`, `logicalcombo`, `logicaltable`, `table`, `strtable`, `datetable`,
`anytable`, `frame`, `cube`, `lambda`, `chart`, `document`.

**Reaches:** `datelist`, `datecombo`, `datetable`, `anytable`, `anylist`,
`anycombo`, `frame`, `cube`, `trueany`.

**Blocked at the output:** `number`, `list`, `numlist`, `string`, `strlist`,
`strcombo`, `date`, `complex`, `complexlist`, `complexcombo`, `complextable`,
`logical`, `logicallist`, `logicalcombo`, `logicaltable`, `table`, `strtable`,
`lambda`, `chart`, `document`, `any`.

**On arrival:** a lone value widens to a one-element list. An unwired port with
typed CSV text parses each part as a date; a part that will not parse becomes null.

#### `datecombo` — "Date or list"

**Holds:** one date **or** a list of dates. The date family's combo.
**Dot:** two-tone split square, pink over dark pink.
**Ports:** 10 inputs, 3 outputs.

**Accepts from:** `date`, `datelist`, `datecombo`, `anylist`, `anycombo`, `any`,
`trueany`.

**Blocked at the input:** `number`, `list`, `numlist`, `string`, `strlist`,
`strcombo`, `complex`, `complexlist`, `complexcombo`, `complextable`, `logical`,
`logicallist`, `logicalcombo`, `logicaltable`, `table`, `strtable`, `datetable`,
`anytable`, `frame`, `cube`, `lambda`, `chart`, `document`.

**Reaches:** `date`, `datelist`, `datecombo`, `datetable`, `anytable`, `anylist`,
`anycombo`, `frame`, `cube`, `any`, `trueany` — including the scalar `date`, by
the combo exception.

**Blocked at the output:** `number`, `list`, `numlist`, `string`, `strlist`,
`strcombo`, `complex`, `complexlist`, `complexcombo`, `complextable`, `logical`,
`logicallist`, `logicalcombo`, `logicaltable`, `table`, `strtable`, `lambda`,
`chart`, `document`.

**On arrival:** a one-element list collapses to the date it contains. This is what
makes a one-value date list feed YEAR and come out as a single year rather than a
one-element list.

#### `datetable` — "Matrix (date)"

**Holds:** a 2-D matrix of date serials.
**Dot:** saturated rose 2×2-grid square.
**Ports:** none in the shipped catalog; reachable by adoption on a matrix-based
adoptive port.

**Accepts from:** `date`, `datelist`, `datecombo`, `datetable`, `anytable`,
`anycombo`, `any`, `trueany`.

**Blocked at the input:** `number`, `list`, `numlist`, `string`, `strlist`,
`strcombo`, `complex`, `complexlist`, `complexcombo`, `complextable`, `logical`,
`logicallist`, `logicalcombo`, `logicaltable`, `table`, `strtable`, `anylist`,
`frame`, `cube`, `lambda`, `chart`, `document`.

**Reaches:** `datetable`, `anytable`, `frame`, `cube`, `trueany`.

**Blocked at the output:** `number`, `list`, `numlist`, `string`, `strlist`,
`strcombo`, `date`, `datelist`, `datecombo`, `complex`, `complexlist`,
`complexcombo`, `complextable`, `logical`, `logicallist`, `logicalcombo`,
`logicaltable`, `table`, `strtable`, `anylist`, `anycombo`, `lambda`, `chart`,
`document`, `any`.

**On arrival:** the value passes as-is.

---

### 5.4 The complex family

A complex number is itself a two-element pair `[real, imaginary]`. That is why
collapsing a one-element complex list tests the **outer** length only.

#### `complex` — "Complex number"

**Holds:** one complex number.
**Dot:** sky blue filled circle.
**Ports:** none in the shipped catalog — every complex node uses the combo rung.
Reachable by adoption and by Cast.

**Accepts from:** `complex`, `complexcombo`, `anycombo`, `any`, `trueany`.

**Blocked at the input:** `number`, `list`, `numlist`, `string`, `strlist`,
`strcombo`, `date`, `datelist`, `datecombo`, `complexlist`, `complextable`,
`logical`, `logicallist`, `logicalcombo`, `logicaltable`, `table`, `strtable`,
`datetable`, `anytable`, `anylist`, `frame`, `cube`, `lambda`, `chart`,
`document`.

**Reaches:** `complex`, `complexlist`, `complexcombo`, `complextable`, `anytable`,
`anylist`, `anycombo`, `frame`, `cube`, `any`, `trueany`.

**Blocked at the output:** `number`, `list`, `numlist`, `string`, `strlist`,
`strcombo`, `date`, `datelist`, `datecombo`, `logical`, `logicallist`,
`logicalcombo`, `logicaltable`, `table`, `strtable`, `datetable`, `lambda`,
`chart`, `document`.

**On arrival:** a one-element list collapses to the complex number it contains.

#### `complexlist` — "List (complex)"

**Holds:** a list of complex numbers. Strict.
**Dot:** dark sky blue filled square.
**Ports:** none in the shipped catalog. Reachable by adoption: a `complex` scalar
wired into a port based on `anylist` retypes that port to `complexlist`.

**Accepts from:** `complex`, `complexlist`, `complexcombo`, `anylist`, `anycombo`,
`any`, `trueany`.

**Blocked at the input:** `number`, `list`, `numlist`, `string`, `strlist`,
`strcombo`, `date`, `datelist`, `datecombo`, `complextable`, `logical`,
`logicallist`, `logicalcombo`, `logicaltable`, `table`, `strtable`, `datetable`,
`anytable`, `frame`, `cube`, `lambda`, `chart`, `document`.

**Reaches:** `complexlist`, `complexcombo`, `complextable`, `anytable`, `anylist`,
`anycombo`, `frame`, `cube`, `trueany`.

**Blocked at the output:** `number`, `list`, `numlist`, `string`, `strlist`,
`strcombo`, `date`, `datelist`, `datecombo`, `complex`, `logical`, `logicallist`,
`logicalcombo`, `logicaltable`, `table`, `strtable`, `datetable`, `lambda`,
`chart`, `document`, `any`.

**On arrival:** a lone complex number widens to a one-element list. The test is on
nesting: a value whose first element is itself a list is already a complex list and
passes through.

#### `complexcombo` — "Complex or list"

**Holds:** one complex number **or** a list of them. The complex family's combo,
and the rung every complex node actually uses.
**Dot:** two-tone split square, sky blue over dark sky blue.
**Ports:** 5 inputs, 5 outputs.

**Accepts from:** `complex`, `complexlist`, `complexcombo`, `anylist`, `anycombo`,
`any`, `trueany`.

**Blocked at the input:** `number`, `list`, `numlist`, `string`, `strlist`,
`strcombo`, `date`, `datelist`, `datecombo`, `complextable`, `logical`,
`logicallist`, `logicalcombo`, `logicaltable`, `table`, `strtable`, `datetable`,
`anytable`, `frame`, `cube`, `lambda`, `chart`, `document`.

**Reaches:** `complex`, `complexlist`, `complexcombo`, `complextable`, `anytable`,
`anylist`, `anycombo`, `frame`, `cube`, `any`, `trueany` — including the scalar
`complex`, by the combo exception.

**Blocked at the output:** `number`, `list`, `numlist`, `string`, `strlist`,
`strcombo`, `date`, `datelist`, `datecombo`, `logical`, `logicallist`,
`logicalcombo`, `logicaltable`, `table`, `strtable`, `datetable`, `lambda`,
`chart`, `document`.

**On arrival:** a one-element list of complex numbers collapses to the single
complex number. A bare `[real, imaginary]` pair is length 2 and stays put.

#### `complextable` — "Matrix (complex)"

**Holds:** a 2-D matrix of complex numbers.
**Dot:** saturated blue 2×2-grid square.
**Ports:** none in the shipped catalog; reachable by adoption.

**Accepts from:** `complex`, `complexlist`, `complexcombo`, `complextable`,
`anytable`, `anycombo`, `any`, `trueany`.

**Blocked at the input:** `number`, `list`, `numlist`, `string`, `strlist`,
`strcombo`, `date`, `datelist`, `datecombo`, `logical`, `logicallist`,
`logicalcombo`, `logicaltable`, `table`, `strtable`, `datetable`, `anylist`,
`frame`, `cube`, `lambda`, `chart`, `document`.

**Reaches:** `complextable`, `anytable`, `frame`, `cube`, `trueany`.

**Blocked at the output:** `number`, `list`, `numlist`, `string`, `strlist`,
`strcombo`, `date`, `datelist`, `datecombo`, `complex`, `complexlist`,
`complexcombo`, `logical`, `logicallist`, `logicalcombo`, `logicaltable`, `table`,
`strtable`, `datetable`, `anylist`, `anycombo`, `lambda`, `chart`, `document`,
`any`.

**On arrival:** the value passes as-is.

---

### 5.5 The logical family

The logical family is the one family with a built-in bridge to another: it
connects to and from the number family at every rank, in both directions.

#### `logical` — "Boolean"

**Holds:** one TRUE, FALSE or null. Logic is three-valued (Kleene): null means
unknown.
**Dot:** purple filled circle.
**Ports:** 1 input, 2 outputs.

**Accepts from:** `logical`, `logicalcombo`, `number`, `numlist`, `anycombo`,
`any`, `trueany`.

**Blocked at the input:** `list`, `string`, `strlist`, `strcombo`, `date`,
`datelist`, `datecombo`, `complex`, `complexlist`, `complexcombo`, `complextable`,
`logicallist`, `logicaltable`, `table`, `strtable`, `datetable`, `anytable`,
`anylist`, `frame`, `cube`, `lambda`, `chart`, `document`.

**Reaches:** `logical`, `logicallist`, `logicalcombo`, `logicaltable`, `number`,
`list`, `numlist`, `table`, `anytable`, `anylist`, `anycombo`, `frame`, `cube`,
`any`, `trueany`.

**Blocked at the output:** `string`, `strlist`, `strcombo`, `date`, `datelist`,
`datecombo`, `complex`, `complexlist`, `complexcombo`, `complextable`, `strtable`,
`datetable`, `lambda`, `chart`, `document`.

**On arrival:** a number becomes a boolean — zero is FALSE, any other finite
number is TRUE, NaN is null. A one-element list collapses to the boolean it
contains.

#### `logicallist` — "List (boolean)"

**Holds:** a list of booleans. Strict.
**Dot:** dark purple filled square.
**Ports:** 1 input, 2 outputs. **Typeable in place.**

**Accepts from:** `logical`, `logicallist`, `logicalcombo`, `number`, `list`,
`numlist`, `anylist`, `anycombo`, `any`, `trueany`.

**Blocked at the input:** `string`, `strlist`, `strcombo`, `date`, `datelist`,
`datecombo`, `complex`, `complexlist`, `complexcombo`, `complextable`,
`logicaltable`, `table`, `strtable`, `datetable`, `anytable`, `frame`, `cube`,
`lambda`, `chart`, `document`.

**Reaches:** `logicallist`, `logicalcombo`, `logicaltable`, `list`, `numlist`,
`table`, `anytable`, `anylist`, `anycombo`, `frame`, `cube`, `trueany`.

**Blocked at the output:** `number`, `string`, `strlist`, `strcombo`, `date`,
`datelist`, `datecombo`, `complex`, `complexlist`, `complexcombo`, `complextable`,
`logical`, `strtable`, `datetable`, `lambda`, `chart`, `document`, `any`.

**On arrival:** numbers convert to booleans, then a lone value widens to a
one-element list. An unwired port with typed CSV text parses each part with a
friendly vocabulary — `yes/y/t/true/1` are TRUE, `no/n/f/false/0` are FALSE, and
anything else is null.

#### `logicalcombo` — "Boolean or list"

**Holds:** one boolean **or** a list of booleans. The logical family's combo, and
the output type of every comparison and test node.
**Dot:** two-tone split square, purple over dark purple.
**Ports:** 3 inputs, 8 outputs.

**Accepts from:** `logical`, `logicallist`, `logicalcombo`, `number`, `list`,
`numlist`, `anylist`, `anycombo`, `any`, `trueany`.

**Blocked at the input:** `string`, `strlist`, `strcombo`, `date`, `datelist`,
`datecombo`, `complex`, `complexlist`, `complexcombo`, `complextable`,
`logicaltable`, `table`, `strtable`, `datetable`, `anytable`, `frame`, `cube`,
`lambda`, `chart`, `document`.

**Reaches:** `logical`, `logicallist`, `logicalcombo`, `logicaltable`, `number`,
`list`, `numlist`, `table`, `anytable`, `anylist`, `anycombo`, `frame`, `cube`,
`any`, `trueany` — including both the scalar `logical` **and** the scalar
`number`, since the combo exception applies to the number bridge as well.

**Blocked at the output:** `string`, `strlist`, `strcombo`, `date`, `datelist`,
`datecombo`, `complex`, `complexlist`, `complexcombo`, `complextable`, `strtable`,
`datetable`, `lambda`, `chart`, `document`.

**On arrival:** numbers convert to booleans, then a one-element list collapses to
the boolean it contains.

#### `logicaltable` — "Matrix (boolean)"

**Holds:** a 2-D matrix of booleans.
**Dot:** saturated purple 2×2-grid square.
**Ports:** none in the shipped catalog; reachable by adoption.

**Accepts from:** `logical`, `logicallist`, `logicalcombo`, `logicaltable`,
`number`, `list`, `numlist`, `table`, `anytable`, `anycombo`, `any`, `trueany`.

**Blocked at the input:** `string`, `strlist`, `strcombo`, `date`, `datelist`,
`datecombo`, `complex`, `complexlist`, `complexcombo`, `complextable`, `strtable`,
`datetable`, `anylist`, `frame`, `cube`, `lambda`, `chart`, `document`.

**Reaches:** `logicaltable`, `table`, `anytable`, `frame`, `cube`, `trueany`.

**Blocked at the output:** `number`, `list`, `numlist`, `string`, `strlist`,
`strcombo`, `date`, `datelist`, `datecombo`, `complex`, `complexlist`,
`complexcombo`, `complextable`, `logical`, `logicallist`, `logicalcombo`,
`strtable`, `datetable`, `anylist`, `anycombo`, `lambda`, `chart`, `document`,
`any`.

**On arrival:** numbers convert to booleans, cell by cell, at whatever rank the
value arrives with.

---

### 5.6 The wildcards

Five variants carry no element family. They form a ladder by rank. All five are
gray; they are told apart by shape.

#### `any` — "Any value"

**Holds:** one value of an unknown family. The rank-0 wildcard.
**Dot:** gray filled circle.
**Ports:** 8 inputs, no outputs. It is an input-side wildcard: a slot that takes
one value of whatever type the comparison, fill or accumulator is working in —
List Filter's and Frame Filter's comparison value, SUMIFS' criteria, EXPAND's
fill, REDUCE's and SCAN's initial value, SWITCH's expression and its `when`
arms. Every one of them is adoptive.

**Accepts from:** every family's scalar and combo — `number`, `numlist`, `string`,
`strcombo`, `date`, `datecombo`, `complex`, `complexcombo`, `logical`,
`logicalcombo` — plus `any` and `trueany`.

**Blocked at the input:** `list`, `strlist`, `datelist`, `complexlist`,
`logicallist`, `logicaltable`, `table`, `strtable`, `datetable`, `complextable`,
`anytable`, `anylist`, `anycombo`, `frame`, `cube`, `lambda`, `chart`, `document`.

**Reaches:** every data variant — `number`, `list`, `numlist`, `string`,
`strlist`, `strcombo`, `date`, `datelist`, `datecombo`, `complex`, `complexlist`,
`complexcombo`, `complextable`, `logical`, `logicallist`, `logicalcombo`,
`logicaltable`, `table`, `strtable`, `datetable`, `anytable`, `anylist`,
`anycombo`, `frame`, `cube`, `any`, `trueany`.

**Blocked at the output:** `lambda`, `chart`, `document` — the object family.

**On arrival:** the value passes as-is; the node handles it.

#### `anycombo` — "Any value or list"

**Holds:** one value **or** a list, of an unknown family. The element-agnostic
combo — what `numlist` is to `number`.
**Dot:** two-tone split square, gray over gray's own border shade.
**Ports:** 107 inputs, 1 output. Almost all of the inputs are Expression's formula
variables; the output is Regex, whose result rank follows its operation.

**Accepts from:** every family's scalar, list and combo — `number`, `list`,
`numlist`, `string`, `strlist`, `strcombo`, `date`, `datelist`, `datecombo`,
`complex`, `complexlist`, `complexcombo`, `logical`, `logicallist`,
`logicalcombo` — plus `anylist`, `anycombo`, `any`, `trueany`.

**Blocked at the input:** `complextable`, `logicaltable`, `table`, `strtable`,
`datetable`, `anytable`, `frame`, `cube`, `lambda`, `chart`, `document`.

**Reaches:** everywhere `any` reaches, plus `anycombo` itself — `number`, `list`,
`numlist`, `string`, `strlist`, `strcombo`, `date`, `datelist`, `datecombo`,
`complex`, `complexlist`, `complexcombo`, `complextable`, `logical`,
`logicallist`, `logicalcombo`, `logicaltable`, `table`, `strtable`, `datetable`,
`anytable`, `anylist`, `anycombo`, `frame`, `cube`, `trueany`.

**Blocked at the output:** `lambda`, `chart`, `document`, `any`.

**On arrival:** a one-element list collapses to the value it contains. Everything
else keeps its natural rank — a scalar stays a scalar, which is the whole reason
this rung exists. There is no element conversion, because the family is unknown.

#### `anylist` — "List (any)"

**Holds:** a list of values of an unknown family. Strict: always a list.
**Dot:** gray filled square.
**Ports:** 25 inputs, 15 outputs — the element-agnostic list operations (FILTER,
DROP, Concat Lists, Interleave, GROUPBY keys, Frame from Lists).

**Accepts from:** every family's scalar, list and combo — `number`, `list`,
`numlist`, `string`, `strlist`, `strcombo`, `date`, `datelist`, `datecombo`,
`complex`, `complexlist`, `complexcombo`, `logical`, `logicallist`,
`logicalcombo` — plus `anylist`, `anycombo`, `any`, `trueany`.

**Blocked at the input:** `complextable`, `logicaltable`, `table`, `strtable`,
`datetable`, `anytable`, `frame`, `cube`, `lambda`, `chart`, `document`.

**Reaches:** every family's list and combo — `list`, `numlist`, `strlist`,
`strcombo`, `datelist`, `datecombo`, `complexlist`, `complexcombo`,
`logicallist`, `logicalcombo` — plus `anytable`, `anylist`, `anycombo`, `frame`,
`cube`, `trueany`.

**Blocked at the output:** `number`, `string`, `date`, `complex`, `logical`,
`complextable`, `logicaltable`, `table`, `strtable`, `datetable`, `lambda`,
`chart`, `document`, `any`.

**On arrival:** a lone value widens to a one-element list. Without this, a number
would fail the node's iteration and a string would iterate one character at a time.
A complex number is itself a two-element array, so at this element-agnostic rung it
passes through as-is.

#### `anytable` — "Matrix (any)"

**Holds:** a 2-D matrix of values of an unknown family. The reshapers' output.
**Dot:** gray 2×2-grid square.
**Ports:** 14 inputs, 7 outputs (TRANSPOSE, WRAPROWS, TAKE/DROP, HSTACK/VSTACK,
MAP over a table, chart series, Build Frame's matrix).

**Accepts from:** every family value at any rank — `number`, `list`, `numlist`,
`string`, `strlist`, `strcombo`, `date`, `datelist`, `datecombo`, `complex`,
`complexlist`, `complexcombo`, `complextable`, `logical`, `logicallist`,
`logicalcombo`, `logicaltable`, `table`, `strtable`, `datetable` — plus
`anytable`, `anylist`, `anycombo`, `any`, `trueany`.

**Blocked at the input:** `frame`, `cube`, `lambda`, `chart`, `document`.

**Reaches:** every concrete matrix — `complextable`, `logicaltable`, `table`,
`strtable`, `datetable` — plus `anytable`, `frame`, `cube`, `trueany`.

**Blocked at the output:** `number`, `list`, `numlist`, `string`, `strlist`,
`strcombo`, `date`, `datelist`, `datecombo`, `complex`, `complexlist`,
`complexcombo`, `logical`, `logicallist`, `logicalcombo`, `anylist`, `anycombo`,
`lambda`, `chart`, `document`, `any`.

**On arrival:** the value passes as-is.

#### `trueany` — "Anything"

**Holds:** literally any value, object types included.
**Dot:** hollow gray ring — outline only, no fill.
**Ports:** 23 inputs, 15 outputs — the genuine anything-nodes: Display, IF, IFS,
IFERROR, SWITCH, CHOOSE, Cast, INDEX, Expect, IS.TEST, NA, XLOOKUP's value, Build
Cube, Cube Columns, Nest Join, Input Switch, Conduit lanes, the Format Controller's
pair, composite input/output ports and Placeholder.

**Accepts from:** every variant, with nothing blocked.

**Reaches:** every variant, with nothing blocked.

**On arrival:** the value passes through completely untouched. A port that
declares it handles anything is taken at its word.

---

### 5.7 The containers

#### `frame` — "Frame (table)"

**Holds:** a data table with named, typed columns.
**Dot:** violet square with an "F" cut into it.
**Ports:** 43 inputs, 37 outputs — every relational verb, every table-shaped chart,
every data source.

**Accepts from:** every family value at any rank — `number`, `list`, `numlist`,
`string`, `strlist`, `strcombo`, `date`, `datelist`, `datecombo`, `complex`,
`complexlist`, `complexcombo`, `complextable`, `logical`, `logicallist`,
`logicalcombo`, `logicaltable`, `table`, `strtable`, `datetable` — plus
`anytable`, `anylist`, `anycombo`, `frame`, `any`, `trueany`.

**Blocked at the input:** `cube`, `lambda`, `chart`, `document`.

**Reaches:** `frame`, `cube`, `trueany`.

**Blocked at the output:** everything else — `number`, `list`, `numlist`,
`string`, `strlist`, `strcombo`, `date`, `datelist`, `datecombo`, `complex`,
`complexlist`, `complexcombo`, `complextable`, `logical`, `logicallist`,
`logicalcombo`, `logicaltable`, `table`, `strtable`, `datetable`, `anytable`,
`anylist`, `anycombo`, `lambda`, `chart`, `document`, `any`. Reading a column out
of a frame is an explicit Get Column, never an implicit narrowing.

**On arrival:** a real frame passes through. A 2-D matrix becomes named columns
(`Col1`, `Col2`, … with types inferred). A 1-D list becomes a single **row**,
matching CSV convention — transpose first for a column. A scalar becomes a 1×1
frame. Null passes through.

For the eleven lazy relational verbs, a frame ref arrives as the ref itself so the
chain fuses into one engine round trip. For every other node the ref is
materialised into a real frame first.

#### `cube` — "Cube (nested table)"

**Holds:** a frame whose cells may hold any value, including another frame or
cube. The top of the data lattice.
**Dot:** violet flat hexagon built from three rhombi.
**Ports:** 3 inputs, 5 outputs.

**Accepts from:** every data variant — `number`, `list`, `numlist`, `string`,
`strlist`, `strcombo`, `date`, `datelist`, `datecombo`, `complex`, `complexlist`,
`complexcombo`, `complextable`, `logical`, `logicallist`, `logicalcombo`,
`logicaltable`, `table`, `strtable`, `datetable`, `anytable`, `anylist`,
`anycombo`, `frame`, `cube`, `any`, `trueany`.

**Blocked at the input:** `lambda`, `chart`, `document`.

**Reaches:** `cube`, `trueany`.

**Blocked at the output:** everything else — `number`, `list`, `numlist`,
`string`, `strlist`, `strcombo`, `date`, `datelist`, `datecombo`, `complex`,
`complexlist`, `complexcombo`, `complextable`, `logical`, `logicallist`,
`logicalcombo`, `logicaltable`, `table`, `strtable`, `datetable`, `anytable`,
`anylist`, `anycombo`, `frame`, `lambda`, `chart`, `document`, `any`. Flowing a
cube into a narrower container would silently drop its nesting, so it is refused;
UNNEST does it explicitly.

**On arrival:** a cube passes through. A frame re-brands as flat cells. A matrix
becomes a grid of cells. A list becomes one row. A scalar becomes 1×1. Null passes
through.

---

### 5.8 The object family

Three variants hold things that are not data. Each connects only to itself and to
`trueany`. Nothing widens into them and they widen into nothing.

#### `lambda` — "Function"

**Holds:** a first-class function value.
**Dot:** teal-green circle with a λ.
**Ports:** 5 inputs, 1 output — the LAMBDA node produces one; MAP, MAKEARRAY,
REDUCE, SCAN and BYROW/BYCOL consume it.

**Accepts from:** `lambda`, `trueany`.
**Blocked at the input:** every other variant.
**Reaches:** `lambda`, `trueany`.
**Blocked at the output:** every other variant.
**On arrival:** the function passes through untouched.

#### `chart` — "Chart / visual"

**Holds:** a rendered chart or visual output.
**Dot:** blue square with three bars.
**Ports:** 19 outputs, no inputs. Charts are sinks that emit; the value is read by
the chart popup and the canvas figure renderer rather than wired onward.

**Accepts from:** `chart`, `trueany`.
**Blocked at the input:** every other variant.
**Reaches:** `chart`, `trueany`.
**Blocked at the output:** every other variant.
**On arrival:** the value passes through untouched.

A figure node that receives an error on its data input renders an empty figure; it
never emits a SolError out a `chart` socket.

#### `document` — "Document"

**Holds:** a whole Note's or Report's renderable content.
**Dot:** blue square with two left-aligned text lines.
**Ports:** 1 input, 3 outputs. Note, Report and Import from Obsidian produce one;
Write to Obsidian consumes one.

**Accepts from:** `document`, `trueany`.
**Blocked at the input:** every other variant.
**Reaches:** `document`, `trueany`.
**Blocked at the output:** every other variant.
**On arrival:** the value passes through untouched.

---

## 6. Adoptive ports

An adoptive port's socket **changes type to match the cable plugged into it** and
**reverts to its base when the cable is removed**. This is derived state: it is
recomputed after every load, paste and drill-in, and it is never saved to a file.

Five bases are in use:

**Base `trueany`** — the hollow ring. It adopts the wired type verbatim, whatever
it is, including `lambda`, `chart` and `document`. Used by Display, IF, CHOOSE,
Cast, Cable Switch, Conduit lanes, composite ports and Placeholder.

**Base `any`** — adopts verbatim. Used for the comparison-value slots.

**Base `anycombo`** — adopts verbatim. Used for Expression's formula variables.

**Base `anylist`** and **base `anytable`** — these **keep their rank** and adopt
only the element family. A number wired into a Concat-Lists row makes that row a
`list` (dark amber square), not a `number` (amber circle) — the port still
represents a list, so it still draws as one and still refuses a frame. A wire
carrying no family at all (another wildcard, a frame, a cube) leaves the port at
its base.

**Reshaping outputs** project the same way in both directions. An adoptive output
based on `anytable` fed a `strlist` becomes a `strtable`; an adoptive output based
on `anylist` fed a `strtable` becomes a `strlist`.

**Passthrough outputs** take their type from the inputs their node declares. Three
modes exist: *single* (follow the one named input), *agree* (follow the inputs only
when they all carry the same type), and *active* (follow whichever branch is
selected). A declaration may also carry a **projection** — a function applied to
the resolved type. INDEX uses this: it declares that its result follows its
container input, projected to that family's **combo** rung, because whether INDEX
returns one element or a whole slice depends on runtime arguments. Feeding INDEX a
`datelist` gives a `datecombo` output; feeding it a frame or cube, where the
extracted value genuinely could be anything, gives `trueany`.

**The Format Controller and Conduit lanes** use the same mechanism through a
mutable socket, adopting the type that flows in so the FC can offer the right
controls.

Adoption runs to a fixpoint together with Conduit reconciliation, so a chain of
passthroughs settles in one pass. Any node that changes a socket's type in place
without a connection event — Cast's target, a LAMBDA result, Get Column's read-as,
Note frontmatter — reconciles downstream types explicitly, so a downstream Format
Controller does not keep a stale format.

---

## 7. What a socket's type controls beyond connections

**Display.** A value's rendering is chosen from its **socket type**, not by reading
its cells. A `datelist` renders as dates because its socket says date, even if
every cell is an integer. A list chip takes its accent colour from the same source.

**Format Controller controls.** The FC offers the control set for the adopted
socket's family:

| Socket variants | FC family |
|---|---|
| `number` `list` `numlist` `table` | number |
| `string` `strlist` `strcombo` `strtable` | text |
| `date` `datelist` `datecombo` `datetable` | date |
| `logical` `logicallist` `logicalcombo` `logicaltable` | logical |
| `complex` `complexlist` `complexcombo` `complextable` | complex |
| `anytable`, and `any`/`trueany` before a type resolves | number (provisional) |
| `lambda` | function view-as |
| `chart` | text scale |
| `anylist` `anycombo` `frame` `cube` `document` | none |

**Units.** A unit is a property of the value, authored by the Format Controller or
by Convert, and it rides through passthroughs and selectors. It attaches per
element on a list, per column on a frame, and once for a whole matrix. Only a node
that runs the unit algebra receives the tagged cells; the socket is what decides
whether the tag survives the boundary.

---

## 8. Adding a socket variant

Adding a sixth element family is one row in the `FAMILIES` table, its four colours,
a drawing branch, and one case in the Format Controller's family map. The
accept-sets, the compatibility test and the connection guard all fall out of the
lattice — no other edits. The full accept/block matrix is machine-checked by a
sweep over every ordered pair in `socketConnect.test.ts`.
