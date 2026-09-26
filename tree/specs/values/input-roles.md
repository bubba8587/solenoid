---
aliases: ["Input roles"]
tags: [spec, values]
---
<!-- [[D86]] blankRoles, [[C80]] blankArgIsExcelBlank, [[C24]] arraySemantics, [[D36]] nullSkippedNotZero, [[D37]] errorBeatsMissing, [[D35]] errorInErrorOut, [[C17]] shareImpl -->

# Spec: Input roles

Serves [[D86]] blankRoles (what a blank means depends on what the input is for), [[C80]] blankArgIsExcelBlank (a formula's empty slot), [[C24]] arraySemantics and [[D36]] nullSkippedNotZero (data blanks), [[D37]] errorBeatsMissing and [[D35]] errorInErrorOut (errors first), and [[C17]] shareImpl (the card and the formula read one declaration). It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

This file owns what a blank does once it reaches an input: the roles an input can have, the one declaration every function and card subscribes to, and how each surface reads it. How the blank gets there (unwired versus wired, `readInput`) is [[value-semantics]] "Reading an input"; what a blank then does inside a computation (totals skip it, element-wise math carries it) is the rest of [[value-semantics]]. The error codes are [[error-values]].

A rule that is decided but not yet built carries a `[decided <date>]` tag and an item in the backlog (the settings sweep).

## The roles

An input's role answers one question: what is this input for? Decide by purpose, never by socket type: a number socket can be data (SUM's values), a setting (ROUND's digits) or a pick (INDEX's position).

| Role | The input is | A blank reads as | Declared as |
|---|---|---|---|
| **data** | the values the node works on | a real missing value: it stays blank and follows [[value-semantics]] (totals skip it, element-wise math carries it). A node whose data is wholly blank answers blank | nothing: every undeclared input is data |
| **setting** | how the node works: a count, a size, a mode, a digit count, a bound, a tolerance | the setting left out: the node's default | `setting(blank)`: `blank` is the value a blank reads as, or `LEFT_OUT` for the function's own omitted reading |
| **required setting** | a setting with no sensible default | `#SYNTAX!`: "*label* is blank, and it has no default" | `required` |
| **picks** | positions: which items, rows or columns to take | a blank pick is dropped; with none left, the picks were left out | `picks()`, or `picks({ required: true })` when there is no default (none left is `#SYNTAX!`) |

The aim behind the table ([[D86]] blankRoles): as few blank answers as possible, and when something the node needs is missing, say so loudly with `#SYNTAX!` rather than going quietly blank. A half-built card that errors is fine; it names what it still needs.

### By the shape of the value

A role applies to the whole value and, for a list or a table, to each item:

| The value is | setting | required | picks |
|---|---|---|---|
| blank | the declared blank | `#SYNTAX!` | left out (`#SYNTAX!` when required) |
| a list with blank items | each blank item reads as the declared blank, in place | each blank item is `#SYNTAX!`, in place | blank items are removed; an empty result is left out |
| a table with blank cells | each blank cell reads as the declared blank | each blank cell is `#SYNTAX!` | each blank cell is `#SYNTAX!` in place: one position answers one cell, so dropping it would break the table |
| an error | passes on untouched ([[D35]] errorInErrorOut) | passes on | passes on |

So ROUND's digits `[1, blank]` round the second value to 0 places, INDEX's positions `[3, blank, 1]` pick two items, and `INDEX(x, P)` with a blank cell in the table `P` answers `#SYNTAX!` in that cell and values everywhere else.

### Left out

`LEFT_OUT` is `undefined`, the value an omitted formula argument already carries ([[formula-language#Blank and omitted arguments]]). Each surface applies its own omitted reading to it: a formula kernel reads `undefined` as the argument not given (TAKE keeps the axis, INDEX takes the whole row or column), and a card maps it to its default at the read (`readRole(...) ?? 0` on TAKE, where 0 keeps all). A left-out size or position keeps the whole thing, where that applies.

A setting whose Excel blank is a value rather than an omission declares that value: TEXTJOIN's `ignore_empty` blank is FALSE, XMATCH's modes are 0, ROUND's digits are 0 ([[C80]] blankArgIsExcelBlank). A blank variable in those slots reads the same as a slot left empty.

## The declaration

**MUST:** a role is declared once, in `ARG_ROLES` (`src/graph/inputRoles.ts`), keyed by the formula name and the zero-based argument index, and every surface reads that declaration:

```ts
TAKE: { 1: setting(LEFT_OUT), 2: setting(LEFT_OUT) },
ROUND: { 1: setting(0) },
CHOOSEROWS: { 1: picks({ required: true }), rest: picks({ required: true }) },
```

- `rest` covers every argument past the highest numbered one, for variadic functions (CHOOSEROWS's `row_num2…`).
- An argument with no entry is data. A function with no entry has only data arguments.
- A card points its sockets at the formula's arguments with `rolesFrom`, so the card and the formula cannot disagree ([[C17]] shareImpl):

  ```ts
  static inputRoles = rolesFrom("TAKE", { rows: 1, cols: 2 });
  static inputRoles = rolesFrom("INDEX", { index: 1, position: 1, column: 2 });
  ```

  One entry serves every op that shares its arguments (TAKE for TAKE and DROP, ROUND for ROUNDUP and ROUNDDOWN, CHOOSEROWS for CHOOSECOLS). A card input with no formula twin declares its role inline: `static inputRoles = { end: setting(LEFT_OUT) }`.

`inputRoles.test.ts` pins the declaration: every declared function exists and every declared argument is within its arity, and every card that declares a role reads that socket through `readRole`.

## Reading

**A card** reads a declared input with `readRole(this, key, inputs.key)` (`nodes/shared.ts`). Unwired, the value is the typed literal; wired, the cable's value, and a blank cable overrides the typed value ([[D86]] blankRoles). The value then goes through `applyRole` with the socket's label for the error. An unwired input with no typed value (CHOOSEROWS's indices) is a blank. The card still hides its typed field while a cable is plugged in, so the override is visible.

**A formula** reads its arguments in `applyArgRoles` at evaluation step 6, after the arguments are evaluated and before the error check ([[formula-language#Calls]]). A slot left empty evaluates to `null`, so an empty slot and a blank value take the same path. A declared slot is *settled*: the element-wise null rule no longer blanks the answer on it. A required picks group (CHOOSEROWS's indices across all its arguments) answers `#SYNTAX!` only when every one of them is left out, so `CHOOSEROWS(m, blank, 2)` is row 2.

**A computed column** runs the formula once per row, so a blank setting cell is a whole blank setting on that row: `ROUND(@Price, @Digits)` rounds a row with a blank digits cell to 0 places, the same answer the Round card gives for a digits list with a blank item.

**A kernel** never sees a blank setting or a blank pick: it receives the declared blank, `LEFT_OUT`, or a list with the blank picks gone. Kernels shared by a card and a formula (`chooseAxis`, `indexInto`) take numbers and `undefined` only.

## Choosing a role

1. Does the node compute on this value, or does the value tell the node how to compute? The first is **data**.
2. Is it which items to take, by position? **picks**.
3. Otherwise it is a **setting**. Give it the default the node already uses when the input is unwired and untyped, or Excel's omitted reading for a formula twin. Only when no default makes sense is it **required**.

## What each input kind does today

The roles replace an older per-kind table in which most non-data inputs propagated a blank. Rows marked `[decided 2026-09-26]` are settings under [[D86]] blankRoles that still propagate until the settings sweep reaches them (backlog); the six declared functions (TAKE, DROP, EXPAND, INDEX, ROUND, CHOOSEROWS/COLS) and TEXTJOIN, XMATCH and XLOOKUP's modes are done.

| Input kind | Role | A wired blank today | Example |
|---|---|---|---|
| an operand, the value computed on | data | propagates, per cell | `UPPER(blank)` is blank |
| a member of a reduction | data | skipped, as SUM skips nulls ([[D36]] nullSkippedNotZero) | `CONCAT(blank, "b")` is `"b"` |
| a figure's datum: a chart's values, a KPI's number | data | renders an empty figure, never a `SolError` out a `chart` socket | Gauge, KPI |
| a filter predicate, one per row | data | drops that row | Filter |
| a declared setting or pick | setting / picks | read by its role | TAKE's rows, INDEX's position, ROUND's digits |
| a check's parameter: Expect's bound or pattern | setting | skips that check and passes the data through (already the setting reading) | Expect |
| a presentation annotation: options, decimals, a color | setting | the neutral default, never the card's styling (already the setting reading) | chart Options |
| a mode selector: basis, delimiter, pattern | setting `[decided 2026-09-26]` | propagates | `TEXTSPLIT(x, blank)` is blank |
| a shape: rows, columns, count, wrap width | setting `[decided 2026-09-26]` | propagates | `MAKEARRAY(blank, 3)` is blank; Series' count |
| an optional bound or tolerance | setting `[decided 2026-09-26]` | propagates | Clamp's min; an as-of Join's tolerance; Slice's end |
| a column reference: which column to sort, group or look up by | setting or required `[decided 2026-09-26]` | propagates: a blank Frame out | Frame Sort, Get Column |
| a filter condition's column or comparison value | setting `[decided 2026-09-26]`: a blank condition keeps every row, overturning [[C24]]'s blank-filter consequence | propagates: the whole result is blank | Filter, SUMIFS |
| a control's bound: Slider min, max, step | setting `[decided 2026-09-26]`; its default is the bound the widget needs | falls back to the card's own value | Slider |

Two dispositions keep their reason under the new roles:

- A **reduction** that propagated would let one blank void a whole aggregate, which is neither Excel's range behavior nor SQL's. Its members are data, and data blanks in a reduction are skipped ([[D36]] nullSkippedNotZero).
- A **control's** widget can't work without a bound: `±Infinity` breaks `<input type="range">`, the play loop's wrap-around and the Tornado sweep's bounds. Its setting default must be a working bound, and every consumer of the published bound (`effectiveMin`, a DOM attribute, a sweep in another file) must read the resolved value, not the raw input.

**An empty string** is the literal most of these kinds ship with, and it already means something on almost every frame verb: "no column chosen, pass the Frame through". It is what an unwired slot on an untouched card reads. Read the raw value first and only then `.trim()` it: in `const raw = readInput(inputs.column, this.stringLiterals.column ?? "")`, `null` is the wired blank and `""` is the untouched card.

## Where the check goes

Two placement rules, both found by sweeping `finance.ts`. Neither is about which role to take; both are about a guard that takes the right one in the wrong place, which typechecks and is silently wrong.

- **An error outranks a blank** ([[D37]] errorBeatsMissing). A node that both reads its settings and inspects a list for `SolError`s runs the error check first. `#DIV/0!` reaching MIRR's cash flows while a blank reaches its `finrate` is `#DIV/0!`.
- **Scope the read to the active op.** On a multi-op node, only the inputs the current op reads can change the answer. A guard hoisted above the `switch` that combines every op's inputs turns a blank on an input this op ignores into a wrong answer: TBILLYIELD does not read `discount`. Read and guard inside the op's branch, or read op-dependently first.

## Writing a new node or function

1. Name each input's role ("Choosing a role"). A formula function with a setting or a pick gets an `ARG_ROLES` entry; its card points at it with `rolesFrom`.
2. Read data through `readInput` and declared inputs through `readRole`. Never `inputs.x?.[0] ?? this.literals.x` ([[value-semantics]] "Reading an input").
3. Check what consumes the value, not only `data()`: a published field read elsewhere must hold the resolved value.
4. Pin it in a test: a blank setting reads as its default, a blank pick is dropped, a required one is `#SYNTAX!`, and an unwired slot still uses the literal. Worked examples are in `inputRoles.test.ts` and `nodes/wiredNull.test.ts`.
