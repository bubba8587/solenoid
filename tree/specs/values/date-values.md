---
aliases: ["Date values"]
tags: [spec, values]
---
<!-- [[D114]] dateIsAKind, [[D115]] datesArePoints, [[C137]] datesNeverSerials, [[D119]] datesBefore1900 -->

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

- The serial counts days from 30-Dec-1899 (serial 0) with no 29-Feb-1900 ([[C44]] dateSerials), so 01-Mar-1900 is 61 as in Excel and the days from 01-Jan-1900 to 28-Feb-1900 sit one higher than Excel's; the fraction is the time of day. A `Num` is never a date.
- A column's type stays the column's declared kind. A Date column packs its cells as plain `f64` (as a Number column's are); reading a cell out of it into a formula gives a `Date` value, and the packing is never seen past the column.
- Building a column from values: every non-blank, non-error cell a `Date` makes a Date column. A Cube column and a loose Cube cell follow the same rule.
- Saved typed inputs (Value, List and Frame Input) store the serial under their declared type and read back as `Date` values; no save stores a loose `__date` inside a typed column.
- A computed column of dates is a Date column. A computed column that mixes dates with another kind holds `#TYPE!` where each date would be, however the column is computed (`eval::column`).

Tests:

- `formulaDates.test.ts`: a formula column that hands back a date (MAX, INDEX, IF, ROUND, EDATE, a LAMBDA) is a Date column; a span of dates or a STDEV stays a Number column; a sum of dates, and a column that is a date in one row and a number in the others, are `#TYPE!` where a date would be.

## Arithmetic

In `eval.rs` the operators match `Date` before numbers. Each row of the table is one case:

| Left | Op | Right | Answer |
|---|---|---|---|
| Date | `+` `-` | Num | Date (Num read as days) |
| Num | `+` | Date | Date |
| Date | `-` | Date | Num (days) |
| Date | `=` `<>` `<` `<=` `>` `>=` | Date | Bool |
| Date | any other operator | anything | #TYPE! "A date can be shifted by days or compared with a date; Cast to Number for its serial" |
| Date | any comparison | Num or Str | #TYPE! |
| unary `-` or `%` | Date | | #TYPE! |

Tests: `fuzz_formulas.rs` (solenoid-core), whose `dates_through_every_operator_row` asks each row of this table of a date today and of a date before 1900 and checks the kind of the answer.

## Functions

Every function is classed once, and its call is readied by that class:

- **Where the class lives.** `class_of` in `date_values.rs` holds each function's class. A name the core refuses with a pointer to another, such as VLOOKUP or MATCH, never reaches it.
- **When it applies.** The call readies its arguments by the class after they are evaluated and before any other step (`ready`, called from `Eval::call`). No body checks for `Date` by hand.
- **What it decides.** A function's class matters only when an argument holds a date, or when the function builds or reads one.

The classes:

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

A long list is read once per list, not once per row (`date_values.rs`), so a range function per row of a computed column stays linear ([[C120]] linearWork):

- **What is read once.** Whether the list holds a date or a plain number (`SEEN`, swept of gone lists each time it doubles), and its serial, text and date copies (`COPIES`, the few used last).
- **Why the copies matter.** A copy keeps one address across rows. The range memo and the lookup indexes know a list by its address, so they hit as they do for a number column, and a kept answer re-stamped as dates is the same list each time.

The table verbs (Group By, Pivot, Window, Rollup) and the SUMIFS card read a Date column by its type (`dates_plan`, [[frame-verbs]]):

- a min, max, mean, median or mode of dates is a date, and so is a running, rolling or per-group min, max or mean, and a lag;
- a count, a rank and a difference are numbers;
- a sum or product of dates is #TYPE!, and so are a running, rolling or per-group sum, a share and a percent change.

Mixed kinds stay refused ([[C137]] datesNeverSerials): a list or table that would hold dates and another kind answers #TYPE!. The cases the tests hold:

- Concat Lists of a date list and a number list;
- IF over a list of conditions with a date branch and a number branch;
- XLOOKUP or INDEX landing on a date column and a number column;
- Get Column reading a Date column as Number (it reads one as dates by default);
- Split Frame under All over a Date column, which leaves no matrix (Date splits it as a date table);
- a Chart handed a plain date list, or a lone date column, as heights;
- a fold (Reduce) over dates that starts from a plain 0, since a fold over dates starts from a date and a 0 beside dates is a mix.

A date matches the same date, never its serial and never another date: Is In, Tally, XMatch (exact and approximate) and SWITCH, on the card and in a formula.

Tests:

- `fuzz_formulas.rs` (solenoid-core): `dates_through_every_function_class` asks a function of each class of a date today and of a date before 1900, and `no_function_hands_a_date_back_as_its_serial` puts a date in each of every callable function's first three places: none may panic or answer the date's serial.
- `datesNeverSerials.test.ts`: the table verbs' rule, the SUMIFS card, and each case of mixed kinds above.
- `dateMatching.test.ts`: a date matches only the same date, in Is In, Tally, XMatch and SWITCH.

## Days before 1900

A day before 1900 is a date like any other ([[D119]] datesBefore1900):

- **Its serial is negative**, and every function, card, display, sort and typed entry takes it.
- **The range** runs from 01-Jan-0001 (`FIRST_SERIAL`, `date_serial.rs`) to 31-Dec-9999 (`END_SERIAL` is the day after).
- **The calendar** is the proleptic Gregorian one throughout, read through Hinnant's day counts, so a date in 1066 has the weekday and leap years that calendar gives it.
- **The functions Excel refuses there take it:** EDATE and the coupon and discount functions (`parse_date`, `fns_stats.rs`), TEXT (`format_date`, `excel_format.rs`), the Date Range card. EDATE and EOMONTH landing outside the calendar are `#DOMAIN!`, as WORKDAY and NETWORKDAYS were.
- **A year read off a date is that year:** a date in the years 1 to 99 never reads as 1900 to 1999 (`date_utc`, `date_serial.rs`), and a serial with a time of day falls on the day below it (YEARFRAC floors, never truncates toward 0).
- **Typed date text** takes a four-digit year below 1000 (`04-Jul-0426`), as the default format writes one.

Tests: `dates_before_1900.rs` (solenoid-core). Its sweeps lean on the calendar repeating every 400 years (146,097 days, a whole number of weeks).

- **The anchors** pin the days around serial 0 (there is no 29-Feb-1900, so the day after 28-Feb-1900 is 01-Mar-1900) and a few far back (1776, 1066, 1600, 01-Jan-0001), each answer checked against Python's proleptic Gregorian calendar. The calendar's ends stay refused: EDATE, EOMONTH or WORKDAY stepping before 01-Jan-0001, and a year 0.
- **The function sweep** asks every date function, every operator row and a function of each class over the same days 400, 800 and 1,600 years back. Each answers as it does today: its dates move by those days, a year it answers moves by those years, and its other numbers stay. Each call is asked on days it can answer, and at least half the calls must answer, so the sweep compares answers rather than one refusal with another.
- **The card sweep** runs the date cards' frozen cases (Date Part, Date Add, Date Diff, Workdays, Week Info, Date Trunc) 400 and 1,600 years back by the same rule. Date Part's year op is left out, since a year moves by the years and not the days. Epoch counts from 1970, and Today, Now and Date Value read no wired date, so those cards are not swept.

## Text and display

- Turning a `Date` into text (`&`, CONCAT, TEXTJOIN, a template fill, a note write) formats it by the format travelling with it ([[C118]] formatTravelsWithValue), else `DD-MMM-YYYY` ([[C44]] dateSerials).
- Every display (card value box, popup, chip, Slicer chip, peek, readout, export) formats a `SolDate` as a date by the value, never by the socket.
- A date read as a name or a match is a date: Pivot heads the columns of a date field with dates (`09-Dec-2025`, never `46000`), and Replace Values finds and writes a date typed as a date.

Tests:

- `formulaDates.test.ts`: a date a formula turns into text (`&`, CONCAT, TEXTJOIN) reads as `DD-MMM-YYYY`.
- `datesNeverSerials.test.ts`: Pivot's date headers and Replace Values' typed dates.

## Card types after a run

A card's result family is read off its values, not from its formula's text ([[C136]] typesKnownAfterCalc):

- an answer of `Num`, `Str`, `Bool` or `Date` values takes that family;
- a mixed answer is untyped;
- an empty answer keeps the last run's family.

Tests: `formulaDates.test.ts`, the Formula card on Auto: MAX of dates is a date, text built from a date reads as a date, a span of dates is a number, and a Number cast gives the serials.

## Cards

A card body reads and answers dates as the formulas do ([[D114]] dateIsAKind):

- Every call to a function readies its arguments by the function's class in one place (`date_values::call`). The three callers are a formula's (`Eval::call`), a card body's (`core_call`, the most of them) and a node's direct call (`engine_call` with `scan`). So the date cards build and read dates, MIN and MAX keep them, and SUM refuses them. The bare body (`engine_call` without `scan`, the function-bodies fixtures) takes plain numbers.
- The sources send dates: Value Input and List Input typed Date, Get Column on a Date column, and a date socket's saved literal, which holds the serial and reads as a date (`Call::literal`). A Frame or Cube carries its dates in Date columns.
- A table built from values types a column of dates Date and refuses dates beside another kind in one column (`infer_column`, Build Frame, Frame from Lists); a list widened into a table is typed the same way.
- A planner that reads amounts, rates or weights by name (Allocator, Payoff Planner, Group Cost Settle, Earned Value's cost) never reads a Date column as one.
- Cast is the one way to a serial; a date cast to text keeps its time of day where it has one.
- A wildcard output shows dates because its value holds them: the Type Settle reads every output's type off its value after a run ([[socket-lattice]] req. 9), so no card names a date family it produced.
- Frame Filter and List Filter compare a date as a day: a wired date, a date typed on a Date column, and each item of a list of dates against a wired date.
- A date card and the formula of the same name answer alike ([[C17]] shareImpl).
- Expect's range check bounds a date by dates and a number by numbers ([[D120]] rangeBoundsTakeTheValuesKind). Its Min and Max sockets turn `date` when the value checked is a date (`ExpectNode.settleFollowers`, [[type-propagation-on-in-place-socket-retype]]). Then:
  - a bound is typed on the card as a date, or wired;
  - the bounds are inclusive;
  - a bound left blank is no bound, so the number bounds the card also keeps never read as days;
  - a typed bound that isn't a date is `#VALUE!`;
  - a number against date bounds, or a date against number bounds, is `#TYPE!`;
  - a day before 1900 is bounded like any other.

Tests:

- `date_fuzz.rs` (solenoid-core) hands every card dates wherever a date can be wired (the wildcard, table and date sockets) over its frozen cases, its numbers there turned into dates and a table's Number columns into Date columns. No body may panic, and none may hand back an input's day as a plain number where the frozen answer held it. Cast is left out, since Cast to Number is the one way to a serial; Describe's `count`, `blank` and `distinct` columns are counts whatever the cells hold. `DATE_FUZZ_REPORT=1` also lists the cases that now refuse or go blank, for review.
- `dateFilters.test.ts`: Frame Filter and List Filter compare dates as days.
- `nodes/dateParity.test.ts`: each date card against its formula (DATE, TIME, DATEVALUE and TIMEVALUE, the week numbers, DAYS, DAYS360, YEARFRAC, DATEDIF).
- `nodes/date.test.ts`: the date cards' own ops (WORKDAY's holidays, DATE's literal year, the date text parser, DATEDIF, EDATE's month end) and a date card refusing a plain number.
- `expect_date_bounds.rs` (solenoid-core): Expect's range check, case by case.

## What was removed

A formula's or card's answer is typed by its values, so these are gone:

- the rule that guessed a date from a formula's text (`date_typing.rs`);
- the LAMBDA helpers' date bookkeeping;
- the per-card stripping of dates back to serials;
- the re-wrapping of date-typed inputs into formulas and the LAMBDA helpers;
- the wired-source-type relay for tables;
- Cast's and Script's source-socket sniffing;
- the display hand-offs that formatted a number as a date by its source socket (peeks, Report and Note refs, exports, templates).
