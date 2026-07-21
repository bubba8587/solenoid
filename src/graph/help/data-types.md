A socket's **colour** is the type of value it carries; its **shape** is the dimension — a circle is one value, a square a list, a grid a 2-D table. A **Frame**'s square carries an **F**: a table with named, typed columns, not just cells.

Types don't mix on their own. A number won't drop into a text input, nor text into a date; a **Cast** node converts when you mean to cross over, element-wise on a list. The one built-in crossover is **Boolean ⟷ number**: TRUE / FALSE reads as 1 / 0 and back, the pair every spreadsheet already treats as the same.

- **Numeric** — numbers; the default for arithmetic and statistics.
- **String** — text.
- **Date** — calendar dates, held as serial numbers, the same as Excel.
- **Complex** — complex numbers, a real part and an imaginary part.
- **Boolean** — TRUE / FALSE. A comparison or an IS-check produces a real Boolean, not a 1 or 0, though it still adds as 1 / 0 when you want it to. Three-valued: an unknown input keeps the answer unknown only where it genuinely is (TRUE OR unknown is still TRUE).
- **Frame** — a data table of named, typed columns. A column leaves it as a typed **list** (Get Column); a row leaves as a one-row Frame (Get Row), since a row mixes types.
- **Cube** — a Frame whose cells hold whole Frames: a one-to-many relationship — each Customer holding its own table of Orders — without flattening to one wide sheet. Double-click a cell to drill in. A Cube sits at the top of the ladder, so any node that takes a Frame takes a Cube.
- **Lambda** — a formula packaged as a value, to hand to MAP, REDUCE, and the other lambda nodes.
- **Any** — accepts any type; used where a node passes a value straight through without inspecting it.

**Lists carry through.** Feed a list into a node built for one value and it runs over every element and hands a list back — Excel's array-formula behaviour, without Ctrl+Shift+Enter. A list can also hold **blanks**, shown `null` and distinct from 0: aggregators skip them, Filter drops them, and the **Fill** node swaps in a default. When a value fails it becomes an Excel-style error code (`#DIV/0!`, `#N/A`, `#SHAPE!`) that flows downstream like any other value, so a trail of red boxes leads back to the cause.
