## What connects, exactly

The ladder above is the whole rule for *shape*; these are the edges of it.

- A **combo** (split square) is the one shape that narrows: it can *be* a single value, so it drops into its element's scalar input. A plain list never does — pull a value out with INDEX instead.
- A **Frame** output connects only to Frame and Cube inputs. Letting it into a plain table input would silently throw away the column names and types; **Split Frame** or **Get Column** take the pieces out on purpose.
- A **Cube** output connects only to another Cube input — anything narrower would flatten its nesting. Everything flows *in*: any value widens into a Cube cell.
- Colours never mix on their own. The one built-in bridge is **Boolean ⟷ number** (TRUE/FALSE ⟷ 1/0), at every shape: a Boolean list drops into a numeric list input and vice versa. Everything else crosses through **Cast**, element-wise.
- The grey **Any** ladder mirrors the shapes — circle for one value of any type, square for any list, grid for any table — and each rung keeps the shape rules (an *any* output is still a scalar: it widens anywhere data flows, but won't enter a Lambda/Chart/Document input). The **hollow ring** is the exception to everything: it takes any value whatsoever, and it *adopts* — wire a date list into one and the socket becomes a date-list socket until you unplug it.
- **Lambda, Chart, and Document** are object values, outside the data lattice entirely: each connects only to its own kind (or a hollow ring). A chart isn't a table of numbers; a lambda isn't a value to add.

## What happens at the boundary

When a cable lands, the value is reshaped for the input — never mutated in place:

- a single value entering a list input becomes a one-element list; entering a table or Frame input, a 1×1;
- a **list entering a 2-D input becomes ONE ROW** (transpose it first if you meant a column);
- a matrix entering a Frame input gets generated column names (Col1, Col2, …);
- blanks stay **null** — missing, not zero. Aggregators skip them, Filter drops them (or selects exactly them, with **is blank**), Fill replaces them;
- errors (`#DIV/0!`, `#N/A`, …) pass through *every* socket untouched — error in, error out, so the red trail survives any plumbing.

The literal sources (List / Table / Frame Input) follow one rule: **the Source is never coerced.** What you typed stays verbatim in the source text — a stray `abc` in a number table, a blank row you left for later — and only the *derived* value coerces it: blank → null, unparseable → NaN. Retype nothing; fix it when you mean to.

## Units

A unit is a property of the **value**, not of a node or a wire. Only two things author one: a **Format Controller** docked on a socket, and **Convert**. From there the unit rides the value through anything that merely carries it — selectors, Displays, reshapes — and breaks at the first real transform, where the arithmetic *derives* the result's unit instead: `m × m` is `m²`, `km ÷ h` is a speed, and `10 m ÷ 2 m` cancels to a pure **ratio**, shown `5:1`.

Mixing genuinely different dimensions in one sum is a **`#UNIT!`** — metres plus seconds has no answer. A bare, unitless number is compatible with anything: it **adopts** the unit of the operation it's in (`$5 + 3` is `$8`, `SUM($5, $2, 3)` is `$10`).

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
