---
aliases: ["Date values"]
tags: [spec, values]
---
<!-- [[D114]] dateIsAKind, [[D115]] datesArePoints, [[C137]] datesNeverSerials -->

# Spec: Date values

A date is a value kind beside number, text and logical ([[D114]] dateIsAKind), a point that shifts and differs by days ([[D115]] datesArePoints). This spec is how the core, the wire and the TypeScript side hold it, what each operator and function does with one, and how it shows.

Status: the date kind, the operators, the function classes and the formula surfaces are in; the sources and most card bodies still relay (§ What was removed, and what still relays).

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

Every function is classed once (`class_of`, `date_values.rs`), and the call readies its arguments by the class after they are evaluated and before any other step (`ready`, called from `Eval::call`); no body checks for `Date` by hand. A function's class decides only when an argument holds a date, or the function builds one.

- **Builds** (DATE, DATEVALUE, TODAY, NOW, FROMEPOCH, EDATE, EOMONTH, WORKDAY, WORKDAY.INTL, COUPNCD, COUPPCD) answers a `Date`; a plain number where it reads a date is #TYPE! "… takes a date there, not a number. Cast to Date or build it with DATE()" ([[C10]] socketLattice). DATETRUNC, TIMEZONECONVERT, SUNRISE and SUNSET answer a `Date` and read a number there too.
- **Reads** (YEAR, MONTH, DAY, WEEKDAY, WEEKNUM, ISOWEEKNUM, TOEPOCH, DAYS, DAYS360, DATEDIF, YEARFRAC, NETWORKDAYS(.INTL), the coupon day counts and the dated finance functions, XNPV's and XIRR's dates) answers a number; a plain number where it reads a date is #TYPE!: `YEAR(46000)` is #TYPE!, `YEAR(DATE(2025, 12, 9))` is 2025. HOUR, MINUTE, SECOND, TEXT, DAYLENGTH, SUNPOSITION and MOONPHASE read a date or a number (a time of day is a number until that is ruled).
- **Keeps** (MIN, MAX, MEDIAN, MODE, AVERAGE, CLAMP over all their arguments; LARGE, SMALL, PERCENTILE, QUARTILE, TRIMMEAN, the rounding functions, WAVG over their first) answers a `Date` where the values it reads there are dates; a date elsewhere, or dates beside plain numbers there, is #TYPE!. MAXIFS, MINIFS, AVERAGEIFS and AVERAGEIF do the same over their value range and take dates in their criteria ranges. SEQUENCE starting from a date is dates.
- **Spreads** (STDEV, VAR and their forms, AVEDEV, DEVSQ, IQR, MAD, PTP, SEM) answer a plain number of days (VAR in days squared); dates beside plain numbers are #TYPE!.
- **Counts** (COUNT, COUNTA, COUNTBLANK, COUNTIF(S), COUNTDISTINCT, RANK, PERCENTRANK, MATCH, XMATCH, ROWS, COLUMNS, ARGSORT, ARGMIN, ARGMAX, ISIN, BETWEEN, TALLY, WHICH) read dates as their days and answer a number.
- **Sums** (SUMIF, SUMIFS) refuse a date in the range they add, and take dates in their criteria ranges.
- **Text** (CONCAT, TEXTJOIN, LEN, LEFT, SUBSTITUTE, the regex and padding functions and kin) reads a date as its text.
- **Moves** (IF, IFS, SWITCH, CHOOSE, IFERROR, IFNA, INDEX, TAKE, DROP, the reshapes and stacks, FILTER, VLOOKUP, HLOOKUP, the IS functions, TYPE, the LAMBDA helpers and kin) passes a date through as itself.
- **Returns** (SORT, SORTBY, UNIQUE, DISTINCT over their first; XLOOKUP over its return array; LOOKUP over its last; the set functions over all) compares by days and hands back dates where it was given dates; dates beside plain numbers there are #TYPE!.
- **Unlisted:** SUM, PRODUCT, SUMPRODUCT and every function in no class answer #TYPE! "… takes no date. Cast to Number for its serial" for a date argument, so a new function can't let a serial out.

Whether a long list holds a date is scanned once per list (`holds_date`), not once per row, so a range function per row of a computed column stays linear ([[C120]] linearWork).

The table verbs (Group By, Pivot, Window, Rollup) and the SUMIFS card read a Date column by its type: a sum, product or share of dates is #TYPE! there too (`dates_plan`, [[frame-verbs]]).

Mixed kinds stay refused ([[C137]] datesNeverSerials): a list or table that would hold dates and another kind answers #TYPE!.

## Text and display

- Turning a `Date` into text (`&`, CONCAT, TEXTJOIN, a template fill, a note write) formats it by the format travelling with it ([[C118]] formatTravelsWithValue), else `DD-MMM-YYYY` ([[C44]] dateSerials).
- Every display (card value box, popup, chip, Slicer chip, peek, readout, export) formats a `SolDate` as a date by the value, never by the socket.

## Card types after a run

A card's result family is read off its values (`Num`, `Str`, `Bool`, `Date`), not from its formula's text. A mixed answer is untyped; an empty answer keeps the last run's family.

## What was removed, and what still relays

Gone: the rule that guessed a date from a formula's text and the rewrite that formatted the dates a formula turned into text (they lived in `date_typing.rs`), and the LAMBDA helpers' date bookkeeping. A formula's answer is typed by its values.

Still relaying, until every source sends a date as itself (each goes with the step named):
- A formula variable, LAMBDA-helper input and computed-column column typed date has its numbers read as dates on the way in (`is_date_input`, `dated_matrix`, `dated_num`, `frame_cell_v`, `run_cells`). Goes once Value, List and Frame Input, Get Column and the other sources send dates.
- A card body not yet converted reads a date input as its serial (`SEES_DATES` in `nodes/mod.rs` lists the converted ones: the formula family and Cast). Goes card by card.
- Each table input's wired source type (`from_in`, `dated_tables`, `Call::widened`, `wiredTypes` in `nodeOnCore.ts`), the extracting cards' `produced` family, Cast's and Script's socket sniffing, and the source types handed to the Slicer, the peek, exports, template lists and Cube popups. Each goes when the value it relays carries its own type.
- A lazily computed column (a column over a held frame) types itself Date when every value is a date, but a row mixing kinds there still keeps its serial.

## Order of work

1. The kind: `V::Date`, the wire tag, `SolDate`, text and display.
2. The operators and function classes, with the unlisted-function guard.
3. Tables: Date columns read out as `Date` values; columns built from dates.
4. Delete the relays, each one's tests moved onto the value.
5. Re-freeze fixtures; the conformance fuzz gains date cases for every operator row and every class.
