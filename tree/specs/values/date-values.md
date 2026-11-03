---
aliases: ["Date values"]
tags: [spec, values]
---
<!-- [[D114]] dateIsAKind, [[D115]] datesArePoints, [[C137]] datesNeverSerials -->

# Spec: Date values

A date is a value kind beside number, text and logical ([[D114]] dateIsAKind), a point that shifts and differs by days ([[D115]] datesArePoints). This spec is how the core, the wire and the TypeScript side hold it, what each operator and function does with one, and how it shows.

Status: in. Every source sends a date as itself and every card body takes one; the relays that turned serials back into dates are gone (§ What was removed).

## Representation

A date is a peer of number, text and logical at every level, not a number with a tag beside it.

| Layer | Number | Text | Logical | Date |
|---|---|---|---|---|
| Core value (`V`) | `Num(f64)` | `Str` | `Bool` | `Date(f64)` |
| Table cell (`FrameCell`) | `Num` | `Str` | `Bool` | `Num` in a Date column (the column's type says it is a day) |
| Wire (`nodeWire`) | number | string | boolean | `{ "__date": serial }` |
| TypeScript value | `number` | `string` | `boolean` | `SolDate` (`dateValue.ts`: a frozen `{ __date: serial }`, with `isSolDate`, `solDate(n)`) |

- The serial counts days from 01-Jan-1900 with no 29-Feb-1900 ([[C44]] dateSerials); the fraction is the time of day. A `Num` is never a date.
- A column's type stays the column's declared kind. A Date column packs its cells as plain `f64` (as a Number column's are); reading a cell out of it into a formula gives a `Date` value, and the packing is never seen past the column.
- Building a column from values: every non-blank, non-error cell a `Date` makes a Date column. A Cube column and a loose Cube cell follow the same rule.
- Saved typed inputs (Value, List and Frame Input) store the serial under their declared type and read back as `Date` values; no save stores a loose `__date` inside a typed column.

## Arithmetic

In `eval.rs` the operators match `Date` before numbers:

| Left | Op | Right | Answer |
|---|---|---|---|
| Date | `+` `-` | Num | Date (Num read as days) |
| Num | `+` | Date | Date |
| Date | `-` | Date | Num (days) |
| Date | `=` `<>` `<` `<=` `>` `>=` | Date | Bool |
| Date | any other operator | anything | #TYPE! "A date can be shifted by days or compared with a date; Cast to Number for its serial" |
| Date | any comparison | Num or Str | #TYPE! |
| unary `-` or `%` | Date | | #TYPE! |

## Functions

Every function is classed once (`class_of`, `date_values.rs`; a name the core refuses with a pointer to another, such as VLOOKUP or MATCH, never reaches it), and the call readies its arguments by the class after they are evaluated and before any other step (`ready`, called from `Eval::call`); no body checks for `Date` by hand. A function's class decides only when an argument holds a date, or the function builds or reads one.

- **Builds** (DATE, DATEVALUE, TODAY, NOW, FROMEPOCH, EDATE, EOMONTH, WORKDAY, WORKDAY.INTL, COUPNCD, COUPPCD) answers a `Date`; a plain number where it reads a date is #TYPE! "… takes a date there, not a number. Cast to Date or build it with DATE()" ([[C10]] socketLattice). DATETRUNC, TIMEZONECONVERT, SUNRISE and SUNSET answer a `Date` and read a number there too.
- **Reads** (YEAR, MONTH, DAY, WEEKDAY, WEEKNUM, ISOWEEKNUM, TOEPOCH, DAYS, DAYS360, DATEDIF, YEARFRAC, NETWORKDAYS(.INTL), the coupon day counts and the dated finance functions, XNPV's and XIRR's dates) answers a number; a plain number where it reads a date is #TYPE!: `YEAR(46000)` is #TYPE!, `YEAR(DATE(2025, 12, 9))` is 2025. HOUR, MINUTE, SECOND, TEXT, DAYLENGTH, SUNPOSITION and MOONPHASE read a date or a number (a time of day is a number until that is ruled).
- **Keeps** (MIN, MAX, MEDIAN, MODE, AVERAGE, CLAMP over all their arguments; LARGE, SMALL, PERCENTILE, QUARTILE, TRIMMEAN, the rounding functions, WAVG over their first) answers a `Date` where the values it reads there are dates; a date elsewhere, or dates beside plain numbers there, is #TYPE!. MAXIFS, MINIFS, AVERAGEIFS and AVERAGEIF do the same over their value range and take dates in their criteria ranges. SEQUENCE starting from a date is dates.
- **Spreads** (STDEV, VAR and their forms, AVEDEV, DEVSQ, IQR, MAD, PTP, SEM) answer a plain number of days (VAR in days squared); dates beside plain numbers are #TYPE!.
- **Counts** (COUNT, COUNTA, COUNTBLANK, COUNTIF(S), COUNTDISTINCT, RANK, PERCENTRANK, XMATCH, ROWS, COLUMNS, ARGSORT, ARGMIN, ARGMAX, ISIN, BETWEEN, TALLY, WHICH) read dates as their days and answer a number.
- **Sums** (SUMIFS) refuses a date in the range it adds, and takes dates in its criteria ranges.
- **Text** (CONCAT, TEXTJOIN, LEN, LEFT, SUBSTITUTE, the regex and padding functions and kin) reads a date as its text.
- **Moves** (IF, IFS, SWITCH, CHOOSE, IFERROR, IFNA, INDEX, TAKE, DROP, the reshapes and stacks, FILTER, the IS functions, TYPE, the LAMBDA helpers and kin) passes a date through as itself.
- **Returns** (SORT, SORTBY, UNIQUE over their first; XLOOKUP over its return array; the set functions over all) compares by days and hands back dates where it was given dates; dates beside plain numbers there are #TYPE!.
- **Unlisted:** SUM, PRODUCT, SUMPRODUCT and every function in no class answer #TYPE! "… takes no date. Cast to Number for its serial" for a date argument, so a new function can't let a serial out.

A long list is read once per list, not once per row (`date_values.rs`): whether it holds a date or a plain number (`SEEN`, swept of gone lists each time it doubles), and its serial, text and date copies (`COPIES`, the few used last). A copy keeps one address across rows, so the range memo and the lookup indexes, which know a list by its address, hit as they do for a number column, and a kept answer re-stamped as dates is the same list each time; a range function per row of a computed column stays linear ([[C120]] linearWork).

The table verbs (Group By, Pivot, Window, Rollup) and the SUMIFS card read a Date column by its type: a sum, product or share of dates is #TYPE! there too (`dates_plan`, [[frame-verbs]]).

Mixed kinds stay refused ([[C137]] datesNeverSerials): a list or table that would hold dates and another kind answers #TYPE!.

## Text and display

- Turning a `Date` into text (`&`, CONCAT, TEXTJOIN, a template fill, a note write) formats it by the format travelling with it ([[C118]] formatTravelsWithValue), else `DD-MMM-YYYY` ([[C44]] dateSerials).
- Every display (card value box, popup, chip, Slicer chip, peek, readout, export) formats a `SolDate` as a date by the value, never by the socket.

## Card types after a run

A card's result family is read off its values (`Num`, `Str`, `Bool`, `Date`), not from its formula's text. A mixed answer is untyped; an empty answer keeps the last run's family.

## Cards

A card body reads and answers dates as the formulas do ([[D114]] dateIsAKind):

- Every call to a function readies its arguments by the function's class in one place (`date_values::call`): a formula's (`Eval::call`), a card body's (`core_call`, the most of them) and a node's direct call (`engine_call` with `scan`). The date cards build and read dates, MIN and MAX keep them, SUM refuses them. The bare body (`engine_call` without `scan`, the function-bodies fixtures) takes plain numbers.
- The sources send dates: Value Input and List Input typed Date, Get Column on a Date column, and a date socket's saved literal, which holds the serial and reads as a date (`Call::literal`). A Frame or Cube carries its dates in Date columns.
- A table built from values types a column of dates Date and refuses dates beside another kind in one column (`infer_column`, Build Frame, Frame from Lists); a list widened into a table is typed the same way.
- A planner that reads amounts, rates or weights by name (Allocator, Payoff Planner, Group Cost Settle, Earned Value's cost) never reads a Date column as one.
- Cast is the one way to a serial; a date cast to text keeps its time of day where it has one.
- `produced`, the family a lookup or a branch extracted, stays: it is how the Type Settle types a wildcard output after a run for every kind ([[C136]] typesKnownAfterCalc), not a date relay.

`tests/date_fuzz.rs` hands every card dates wherever a date can be wired (the wildcard, table and date sockets) over its frozen cases: no body may panic or hand back an input's day as a plain number.

## What was removed

The rule that guessed a date from a formula's text (`date_typing.rs`), the LAMBDA helpers' date bookkeeping, the per-card stripping of dates back to serials, the re-wrapping of date-typed inputs into formulas and the LAMBDA helpers, the wired-source-type relay for tables, Cast's and Script's source-socket sniffing, and the display hand-offs that formatted a number as a date by its source socket (peeks, Report and Note refs, exports, templates). A formula's or card's answer is typed by its values.

A computed column of dates is a Date column; one mixing dates with another kind holds `#TYPE!` where each date would be, however the column is computed (`eval::column`).
