---
aliases: ["Formula.js divergences"]
tags: [spec, computation]
---
<!-- [[D28]] tripwireVendorDrift, [[D26]] hideMatrixFromVendor, [[C17]] shareImpl -->

# Spec: Formula.js divergences

Serves [[D28]] tripwireVendorDrift. Formula.js is the vendored library that backs every Excel function Solenoid does not register itself. Where its answer differs from Excel's, `excelFunctions.ts` registers an override (`registerInternal`) that gives Excel's answer, usually by calling the same kernel the matching node calls ([[C17]] shareImpl). This spec lists each override and the evidence for it. Read it before deleting an override, widening the Formula.js fallthrough, or folding a registration back into the library: each entry is the reason the library's answer is wrong for Solenoid. `tests/graph/formulaDivergence.test.ts` pins each one both ways, the override right and Formula.js still wrong.

Deliberate differences from Excel itself (not from Formula.js) are in [[formula-language]] under *Function notes*.

## Scalar math

- **MOD** takes the divisor's sign, as Excel does: `MOD(10, -3)` is -2, where Formula.js gives -1. A zero divisor is `#DIV/0!`, and so is a blank one, which reads as 0.
- **QUOTIENT** by zero is `#DIV/0!`; Formula.js returns null.
- **ROUNDUP, ROUNDDOWN**: Formula.js scales and rounds the raw binary value, so `ROUNDUP(0.1+0.2, 1)` is 0.4 where Excel answers 0.3. All three rounding names run `roundDigits`, the ROUND card's kernel, which reads the scaled value at 15 significant digits and truncates a fractional digits count.
- **POWER(0, 0)** is 1, the answer of `^` and the Arithmetic card ([[C46]] consistencyOverQuirks); Formula.js answers `#NUM!`.
- **ATAN2**: Excel's `ATAN2(x, y)` is `atan2(y, x)`, x first. Formula.js computes `atan2(x, y)`.
- **LN, LOG10, SQRTPI, ASIN, ACOS, ACOSH, ATANH** outside their domain answer `#DOMAIN!` ("Input is outside this function's domain"). Formula.js silently returns null for some of them.

These match the Math node's own compute.

## Statistics

- **RANK, RANK.EQ, RANK.AVG** (`excelRank`): descending, largest is rank 1. Ties share the lowest rank (RANK, RANK.EQ) or the average rank (RANK.AVG). A value not in the list is `#N/A`; Formula.js answers 0.
- **TRIMMEAN** (`excelTrimmean`) drops `floor(n · percent / 2)` values from each end, so the total trimmed is rounded down to an even count, then averages the rest. Formula.js over-trims: `TRIMMEAN([2,4,4,4,5,5,7,9], 0.2)` is 5 in Excel and 4.83 in Formula.js. Trimming every value is `#DOMAIN!`.
- **PERCENTRANK** (`excelPercentRank`) interpolates linearly between the bracketing points and truncates, never rounds, to `significance` digits (default 3). The inclusive form uses an (n−1) basis and the exclusive form an (n+1) basis. A value outside the data's range is `#N/A`, and an exact match takes the first occurrence.
- **QUARTILE.INC** is PERCENTILE.INC at q/4, so quartile 0 is the minimum and quartile 4 the maximum, matching the Rank & Percentile node's interpolation. Formula.js's QUARTILE.INC errors on 0 and 4.
- **T.TEST**: Formula.js ignores `tails` and `type`. Ours honors both: type 1 is paired, 2 equal variance, 3 Welch; tails 1 halves the two-tailed p-value.
- **F.TEST**: Formula.js returns the variance ratio instead of the p-value.

RANK, TRIMMEAN and PERCENTRANK are the functions the Rank & Percentile and Trim Mean nodes call, and T.TEST and F.TEST are the Hypothesis Test node's kernels.

## Text and number parsing

- **CONCAT, CONCATENATE, TEXTJOIN** are owned so a number is written with `numberToText` (15 significant digits) rather than Formula.js's formatting.
- **Text pass-throughs.** LEFT, RIGHT, UPPER, LOWER, TRIM, REPLACE, EXACT, FIND and SEARCH stay Formula.js for their semantics, but each text-position argument (`TEXT_ARG_POSITIONS`; REPLACE's first and fourth) first goes through `numberToText`, so `LEFT(0.1+0.2, 3)` reads "0.3".
- **PROPER** runs `properCase` (`nodes/textOps.ts`), the Text Transform card's kernel: a letter after any non-letter is capitalized and every other letter lowercased, Excel's rule, so `PROPER("76BudGet")` is `76Budget` and `o'neil 2nd` is `O'Neil 2Nd`. Formula.js capitalizes only after certain separators.
- **MID** of length 0 is `""`, as in Excel; Formula.js answers an error. A start below 1 or a negative length is `#VALUE!`. The Text Slice card calls the same registration.
- **REPT** truncates a fractional count (`REPT("ab", 2.9)` is `abab`), refuses a negative one, and refuses a result past Excel's 32,767 characters, all with `#VALUE!`. Formula.js throws a raw `RangeError` on a fractional count.
- **UNICHAR, UNICODE** cover every code point, as the CHAR / CODE card does: `UNICHAR(128512)` is 😀 and `UNICODE("😀")` is 128512. Formula.js works in UTF-16 units, so it answers a lone surrogate half.
- **SUBSTITUTE** is owned: Formula.js replaces the (instance + 1)th match, while Excel truncates `instance` like every numeric argument and replaces that match. An instance below 1 is `#VALUE!`; an empty search text returns the text unchanged.
- **VALUE** is strict. It accepts a plain number, an optional `$` after the sign, thousands commas, a wrapping pair of parentheses for a negative, and any number of trailing `%` (each divides by 100). Anything else is `#VALUE!`, including a logical (`VALUE(TRUE)`) and empty text. Formula.js returns 0 for any unparseable text, which silently corrupts a result. VALUE deliberately does not parse date or time text; that is DATEVALUE's job.
- **NUMBERVALUE(text, [decimal], [group])**: only the first character of each separator argument counts, whitespace is stripped anywhere, trailing `%` each divide by 100, and empty text is 0. The group separator is legal only before the decimal point. The default group separator `,` steps aside when the decimal separator is `,`; only two explicitly identical separators are `#VALUE!`. Formula.js returns null when only a decimal separator is given.
- **DOLLAR**: Excel writes a negative in accounting form as `($1,234.57)`, the `$` inside the parentheses. Formula.js writes `$(1,234.57)`, and the override moves the `$`.
- **CONVERT** runs Solenoid's unit system on the same unit keys as the Convert node's dropdown. An unknown or cross-category unit is `#N/A`, as in Excel. Formula.js's CONVERT errors even on Celsius to Fahrenheit.
- **TEXT** stays Formula.js, with its holes patched up front:
  - text that is not a number passes through unchanged, where Formula.js throws;
  - `@` and `General` use `numberToText`;
  - a code of only zeros (`000`) zero-pads the rounded magnitude;
  - a scientific code (`0.00E+00`) writes `1.23E+06`;
  - a date-shaped code (letters from `ymdhs`, once quoted literals are removed, and no `#`, `0` or `?`) hands Formula.js the serial's UTC `Date`, because Formula.js formats through UTC getters. Building a local wall-clock `Date` instead shifts the day twice on any machine outside UTC.

  Three kinds of code stay broken on purpose and are not chased: section codes (`pos;neg`), fractions (`# ?/?`), and time tokens (`hh:mm` renders only the date part).

## Dates

- **YEAR, MONTH, DAY, HOUR, MINUTE, SECOND** read Solenoid's serial through `serialToJsDate` and the UTC getters, the one serial model the Date Part node uses, not Formula.js's Date and 1900 conventions.
- **EDATE, WORKDAY, WORKDAY.INTL** wrap Formula.js and convert its result, a local-midnight `Date`, to a serial with `toSerialIfDate`. `jsDateToSerial` reads UTC, so the raw serial is off by the machine's time-zone offset; rounding recovers the day because these results are date-only. WORKDAY.INTL lives under `FX.WORKDAY.INTL`, not as a flat key, so it is wrapped on its own; unwrapped, it would leak a shifted `Date` into serial arithmetic.
- **WORKDAY.INTL's weekend mask.** Formula.js takes only the numeric weekend codes. Excel also takes a seven-character mask of `0` and `1`, Monday first, where 1 is a day off. A mask walks the days directly, skipping days off and holidays; an all-ones mask, or any other string, is `#VALUE!`.
- **NETWORKDAYS, NETWORKDAYS.INTL**: Formula.js miscounts a reversed span (start after end). Excel defines it as exactly the negation of the forward count, so the override swaps the dates and negates, and never reaches Formula.js's reversed path.

## Finance

- **TBILLEQ, TBILLPRICE, TBILLYIELD** run the T-Bill node's actual/360 kernel. Formula.js counts 30/360 and misses Microsoft's worked examples by a day.
- **IRR, XIRR** run the IRR node's solver, `financeOps.solveDiscountRate`: Newton's method with a rate floor, then bracket and bisect, answering `#CONV!` only when no root exists above the floor. Formula.js's IRR returns a fabricated 1000 (100,000%) when the root sits close to the floor: `IRR([-4943, -2458, 285])` is −0.903. The `guess` argument is accepted and ignored, because this solver needs no seed and the node takes none ([[D73]] nodeCoversFormula). Pinned across both surfaces in `tests/graph/nodes/financeIterative.test.ts`.
- **MIRR** runs the node's `mirr` kernel on the same cash-flow preparation as IRR.
- **NPV** stays Formula.js but is `RANGE_ZERO_FILL`: a blank period is a zero cash flow, as the nodes' `cashPrep` treats it. Dropping the blank would shift every later period.

## Array-returning names and complex numbers

UNIQUE, SORT, MODE.MULT, FREQUENCY and the regression quartet (TREND, GROWTH, LINEST, LOGEST) are registered internally. Formula.js writes its array functions against 2-D spreadsheet ranges with unvetted quirks, and has been caught changing its arguments in place ([[D26]] hideMatrixFromVendor). The IM* family is internal for the same reason: Formula.js's IM* functions accept complex numbers only as text and refuse the graph's own complex values.

## Name walking

A Formula.js function is itself a container: `FX.CEILING` is the CEILING function and also the parent of `FX.CEILING.MATH`, and Formula.js hangs `.MATH`, `.PRECISE`, `.INTL` and `.TEST` children off callable parents. Both walks, `fxLookup` (dispatch) and `FX_FUNCTION_NAMES` (autocomplete and highlighting), therefore descend into functions as well as plain objects, to a depth of two (`NORM.S.DIST`), and skip Formula.js's internal `FX.utils` namespace.

The two walks must match. If they differ, a name is advertised and then fails at dispatch with "Unknown function", or dispatches but is never offered. `formulaTier1.test.ts` and `formulaNodeParity.test.ts` dispatch the dotted names.
