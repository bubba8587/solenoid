---
aliases: ["Formula.js divergences"]
tags: [spec, computation]
---
<!-- [[C17]] shareImpl, [[C15]] matricesInFormulas -->

# Spec: Formula.js divergences

Serves [[C17]] shareImpl. Formula.js was the library behind every Excel function Solenoid didn't write itself; its bodies were ported into the core ([[rust-core]]) and the library is gone. Where its answer differed from Excel's, Solenoid answers as Excel does, usually through the same kernel the matching card runs. This spec lists each of those and the evidence for it. Read it before changing one of these functions: each entry is the reason Formula.js's answer was wrong for Solenoid. `tests/graph/formulaDivergence.test.ts` pins the Excel-correct answers. A kernel named below (`roundDigits`, `mathUtils.ts`) is the TypeScript one the core's body was ported from, its name kept in snake_case.

Deliberate differences from Excel itself (not from Formula.js) are in [[formula-language]] under *Function notes*.

## Excel's answer, pinned

**MUST:** where Formula.js gave a different answer from Excel, Solenoid gives Excel's, backed by the same implementation as the card ([[C17]] shareImpl), and a test pins it. The tripwires that held Formula.js to its wrong answers went with the library: no vendor update reaches the core. The first divergence list lived in a sweep script that was later lost and had to be rebuilt from notes, so the evidence lives in the suite, with the per-name reasons below.

## Scalar math

- **MOD** takes the divisor's sign, as Excel does: `MOD(10, -3)` is -2, where Formula.js gives -1. A zero divisor is `#DIV/0!`, and so is a blank one, which reads as 0.
- **QUOTIENT** by zero is `#DIV/0!`; Formula.js returns null.
- **ROUNDUP, ROUNDDOWN**: Formula.js scales and rounds the raw binary value, so `ROUNDUP(0.1+0.2, 1)` is 0.4 where Excel answers 0.3. All three rounding names run `roundDigits`, the ROUND card's kernel, which reads the scaled value at 15 significant digits and truncates a fractional digits count.
- **POWER(0, 0)** is 1, the answer of `^` and the Arithmetic card ([[B16]] oneFormulaSurface); Formula.js answers `#NUM!`.
- **ATAN2**: Excel's `ATAN2(x, y)` is `atan2(y, x)`, x first. Formula.js computes `atan2(x, y)`.
- **GCD, LCM** run `gcdLcm` (`mathUtils.ts`), the GCD card's kernel: each value is truncated, as in Excel, and a negative value, or a value or an LCM at 2^53 or more, is `#DOMAIN!`. Formula.js runs Euclid's algorithm on the raw decimals, so `GCD(4.5, 6.9)` is about 1.8e-15 and `LCM(4.5, 6)` is 27, and it takes negatives. The card, which read each pair after rounding, reads it the same way now.
- **LN, LOG10, SQRTPI, ASIN, ACOS, ACOSH, ATANH** outside their domain answer `#DOMAIN!` ("Input is outside this function's domain"). Formula.js silently returns null for some of them.
- **ACOT** is in (0, π), as Excel's and the Math Function card's: `ACOT(-1)` is 3π/4. Formula.js computes `atan(1/x)`, so a negative x answered in (−π/2, 0).
- **GAMMALN, GAMMALN.PRECISE** run `ln_gamma` (`dists.rs`), the Math Function card's kernel, and an x of 0 or less is `#DOMAIN!` (Excel's `#NUM!`). Formula.js answered `GAMMALN(-3.7)` as -1.38 and `GAMMALN(0)` as infinity, and its own log-gamma drifts by about 1e-13 at x = 100.

- **FACT, FACTDOUBLE, COMBIN, COMBINA, PERMUT, MULTINOMIAL** run `combinatoric` (`mathUtils.ts`). Formula.js builds FACT by recursion, so a large count, or a negative one that never reaches its base case, overflowed the call stack, and COMBIN, PERMUT and MULTINOMIAL divide factorials, so `COMBIN(30, 15)` was 155117519.99999997. Arguments truncate; a negative count or choosing more than there are without repetition is `#DOMAIN!`, except that `FACTDOUBLE(-1)` is 1, as in Excel; COMBINA takes more than there are, so `COMBINA(2, 5)` is 6 and `COMBINA(0, 3)` is 0; COMBIN divides as it multiplies, so its answer is the exact integer wherever a double holds one; past a double's range the answer overflows to `#OVERFLOW!`. The factorials multiply in Formula.js's order, so FACT and FACTDOUBLE answer what it did up to 170. The Combinatorics card runs the same kernel ([[C17]] shareImpl); PERMUTATIONA is its own.

- **BINOM.DIST.RANGE** runs `binomDistRange` (`mathUtils.ts`): Excel's constraints (0 ≤ s ≤ s2 ≤ trials, a probability from 0 to 1) answer `#DOMAIN!`, where Formula.js checks nothing and sums a reversed range to 0; each term multiplies COMBIN's exact count by the powers, or works in logs where the count overflows, so `BINOM.DIST.RANGE(1e5, 0.5, 0, 50000)` answers instead of overflowing the call stack; a range past a million outcomes is `#DOMAIN!`.

- **BESSELJ, BESSELI, BESSELK, BESSELY** answer as Formula.js did with the order truncated to a whole number, as Excel does (Formula.js rounds it, so `BESSELJ(1, 2.7)` was J₃). A negative order answers `#DOMAIN!` ("BESSELJ takes an order of 0 or more", Excel's `#NUM!`) and an order past 1,000,000, infinity included, `#DOMAIN!` ("BESSELJ takes an order of at most 1,000,000"): Formula.js recurs once per order, so `BESSELJ(1, 1e12)` hung the app ([[C120]] linearWork). An order given as text is read as every number text is ([[C117]] usNumberText), so `BESSELJ(1, "-Infinity")` is `#VALUE!` ("BESSELJ needs a number"), where Formula.js reads it as -Infinity and loops. The Bessel card computes through these registrations, its order passed as wired ([[C17]] shareImpl).

- **CLEAN** drops character codes 0 to 31, as Excel's does, and reads a number or logical as its text: Formula.js threw on `CLEAN(5)`. The Text Transform card's CLEAN calls it, so the card no longer also drops DEL (127), which Excel keeps.

These match the Math node's own compute.

## Logic

- **IFS** reads each test with `ifTest`, IF's reading, which the IFS card shares: text is `#VALUE!`, even `"TRUE"` ([[C131]] noTextGuessing). Formula.js takes any truthy JavaScript value, so `IFS("FALSE", 1)` answered 1.

## Text arguments

- Formula.js's `parseNumber` read numeric text as a number (`ABS("5")` was 5, `SUMSQ` summed `"5"`), its `parseDate` read date text (`EDATE("2024-01-31", 1)`), and its SUM `parseFloat`ed a text argument. Every body ported from it answers `#VALUE!` for text where it needs a number or a date, and SUM skips text ([[C131]] noTextGuessing, [[formula-language#Text is text]]).

## Statistics

- **RANK, RANK.EQ, RANK.AVG** (`excelRank`): descending, largest is rank 1. Ties share the lowest rank (RANK, RANK.EQ) or the average rank (RANK.AVG). A value not in the list is `#N/A`; Formula.js answers 0.
- **TRIMMEAN** (`excelTrimmean`) drops `floor(n · percent / 2)` values from each end, so the total trimmed is rounded down to an even count, then averages the rest. Formula.js over-trims: `TRIMMEAN([2,4,4,4,5,5,7,9], 0.2)` is 5 in Excel and 4.83 in Formula.js. Trimming every value is `#DOMAIN!`.
- **PERCENTRANK, PERCENTRANK.INC, PERCENTRANK.EXC** (`excelPercentRank`) interpolate linearly between the bracketing points and truncate, never round, to `significance` digits (default 3). The inclusive forms use an (n−1) basis and the exclusive form an (n+1) basis. A value outside the data's range is `#N/A`, where Formula.js's dotted forms answer 0 below it and an error above it; an exact match takes the first occurrence. Blanks and text in the array are skipped and an error in it is the answer. A one-value array ranks its value 1 in every form, as Excel does (checked in Excel 2026-10-05), where the (n−1) basis would divide by zero and the (n+1) one would give 0.5. The card truncates its significance as the formula does.
- **SUM** is owned for the same reason: Formula.js recurses through `SUM.apply(null, list)`, which throws past about 125k values, so `SUM(column)` in a computed column over a long table failed in every row and re-summed per row. It reads as Formula.js does (numbers, text through `parseFloat`, a nested list as its own subtotal, the first error) by a loop.
- **MIN, MAX** are owned because Formula.js spreads the whole list into `Math.min` and `Math.max`, which throws past about 125k values. They run the Aggregate card's kernel over the numbers Formula.js reads, with text and logicals skipped; no numbers is 0, and a NaN cell is `#DOMAIN!`.
- **QUARTILE.INC** is PERCENTILE.INC at q/4, so quartile 0 is the minimum and quartile 4 the maximum, matching the Rank & Percentile node's interpolation. Formula.js's QUARTILE.INC errors on 0 and 4.
- **T.TEST**: Formula.js ignores `tails` and `type`. Ours honors both: type 1 is paired, 2 equal variance, 3 Welch; tails 1 halves the two-tailed p-value.
- **F.TEST**: Formula.js returns the variance ratio instead of the p-value.

RANK, TRIMMEAN and PERCENTRANK are the functions the Rank & Percentile and Trim Mean nodes call, and T.TEST and F.TEST are the Hypothesis Test node's kernels.

## Text and number parsing

- **CONCAT, CONCATENATE, TEXTJOIN** are owned so a number is written with `numberToText` (15 significant digits) rather than Formula.js's formatting.
- **SEARCH** is Solenoid's own: Formula.js matches `?`, `*` and `~` literally, where Excel reads them as wildcards (`wildcard_tokens` in `excel_criteria.rs`, shared with the criteria functions). Its start and empty-find rules are FIND's below.
- **Text pass-throughs.** LEFT, RIGHT, UPPER, LOWER, TRIM, REPLACE, EXACT and FIND stay Formula.js for their semantics, but each text-position argument (`TEXT_PASS_THROUGHS`; REPLACE's first and fourth) first goes through `numberToText`, so `LEFT(0.1+0.2, 3)` reads "0.3". LEFT and RIGHT with a count below 0, and FIND and SEARCH with a start below 1, are `#VALUE!` as in Excel, where Formula.js clamps them; the Text Slice and Text Find cards call the same registrations with their numbers as given.
- **BASE, DEC2HEX, BIN2HEX, OCT2HEX** stay Formula.js with the result uppercased: Excel writes the letter digits A to Z in uppercase (`DEC2HEX(255)` is `FF`), and Formula.js in lowercase.
- **PROPER** runs `properCase` (`nodes/textOps.ts`), the Text Transform card's kernel: a letter after any non-letter is capitalized and every other letter lowercased, Excel's rule, so `PROPER("76BudGet")` is `76Budget` and `o'neil 2nd` is `O'Neil 2Nd`. Formula.js capitalizes only after certain separators.
- **MID** of length 0 is `""`, as in Excel; Formula.js answers an error. A start below 1 or a negative length is `#VALUE!`. The Text Slice card calls the same registration.
- **REPT** truncates a fractional count (`REPT("ab", 2.9)` is `abab`), refuses a negative one, and refuses a result past Excel's 32,767 characters, all with `#VALUE!`. Formula.js throws a raw `RangeError` on a fractional count.
- **CHAR, CODE, UNICHAR, UNICODE** run the CHAR / CODE card's kernels, `charFromCode` and `codeOfText` (`nodes/textOps.ts`), which cover every code point: `CHAR(128512)` is 😀 and `CODE("😀")` is 128512. A code outside 1 to 1114111, a surrogate, or empty text is `#VALUE!`. Formula.js works in UTF-16 units, so it answers a lone surrogate half, and its CHAR wraps a code past 65535. That CHAR and CODE reach past Excel's 255 is a difference from Excel itself, listed in [[formula-language]].
- **SUBSTITUTE** is owned: Formula.js replaces the (instance + 1)th match, while Excel truncates `instance` like every numeric argument and replaces that match. An instance below 1 is `#VALUE!`; an empty search text returns the text unchanged.
- **VALUE** is strict. It accepts a plain number, an optional `$` after the sign, thousands commas, a wrapping pair of parentheses for a negative, and any number of trailing `%` (each divides by 100). The number itself is `decimalFromText`'s reading, so a `0x`, `0b` or `0o` literal and `Infinity` are `#VALUE!`, as in Excel. Anything else is `#VALUE!`, including a logical (`VALUE(TRUE)`) and empty text. Formula.js returns 0 for any unparseable text, which silently corrupts a result. VALUE deliberately does not parse date or time text; that is DATEVALUE's job. Number text is read in the US form only ([[C117]] usNumberText): `.` is the decimal point and a comma anywhere before it is a grouping mark (`VALUE("1,5")` is 15, as in US Excel), while a comma after it makes the text not a number, so the European `1.234,5` is `#VALUE!`, never reread as 1.2345. Only `$` is stripped, so `€5` is `#VALUE!`. Cast to Number reads the same way (`parseValueText`).
- **NUMBERVALUE(text, [decimal], [group])**: formula only; its kernel is `numberValue` (`textOps.ts`). Its card is Cast to Number, which reads as VALUE does (`parseValueText`, `$` and `(5)` included) with the same separator rules, so empty text is `#VALUE!` on the card and 0 here ([[B11]] maximalMerge). Only the first character of each separator argument counts, whitespace is stripped anywhere, trailing `%` each divide by 100, and empty text is 0. The group separator is legal only before the decimal point. The default group separator `,` steps aside when the decimal separator is `,`; only two explicitly identical separators are `#VALUE!`. The digits left after the separators go through `decimalFromText`, so `NUMBERVALUE("0x1F")` is `#VALUE!` where JavaScript's `Number` reads 31. Formula.js returns null when only a decimal separator is given.
- **DOLLAR**: Excel writes a negative in accounting form as `($1,234.57)`, the `$` inside the parentheses. Formula.js writes `$(1,234.57)`, and the override moves the `$`. A negative that rounds to zero keeps the form, `($0.00)`, where Formula.js writes `-$0.00`. The DOLLAR card calls the same registration.
- **FIXED, DOLLAR** round with `roundDigits` first, so `FIXED(1.005, 2)` is "1.01" as in Excel; Formula.js's `toFixed` reads the binary 1.00499… and writes "1.00". A value that rounds to zero goes through unrounded, so its sign survives. The FIXED card calls the same registration.
- **CONVERT** runs Solenoid's unit system on the Convert node's units, read by Excel code first (`"C"`, `"lbm"`, `"oz"` the fluid ounce) and by the node's unit id second (`convert_unit_key`, `convert_units.rs`). An unknown or cross-category unit is `#N/A`, as in Excel. Formula.js's CONVERT errors even on Celsius to Fahrenheit.
- **TEXT** answers as Formula.js did, with its holes patched up front:
  - text that is not a number passes through unchanged, where Formula.js throws;
  - `@` and `General` use `numberToText`;
  - a code of only zeros (`000`) zero-pads the rounded magnitude;
  - a scientific code (`0.00E+00`) writes `1.23E+06`;
  - a date-shaped code (letters from `ymdhs`, once quoted literals are removed, and no `#`, `0` or `?`) hands Formula.js the serial's UTC `Date`, because Formula.js formats through UTC getters. Building a local wall-clock `Date` instead shifts the day twice on any machine outside UTC.

  Three kinds of code stay broken on purpose and are not chased: section codes (`pos;neg`), fractions (`# ?/?`), and time tokens (`hh:mm` renders only the date part).

## Dates

- **YEAR, MONTH, DAY, HOUR, MINUTE, SECOND** read Solenoid's serial through `serialToJsDate` and the UTC getters, the one serial model the Date Part node uses, not Formula.js's Date and 1900 conventions.
- **EDATE** wraps Formula.js and converts its result, a local-midnight `Date`, to a serial with `toSerialIfDate`. `jsDateToSerial` reads UTC, so the raw serial is off by the machine's time-zone offset; rounding recovers the day because the result is date-only.
- **WORKDAY, WORKDAY.INTL** never reach Formula.js, which walks one day at a time (a count of 1e9 hangs) and takes only the numeric weekend codes. Both run `addWorkdays` (`nodes/dateOps.ts`), shared with the Workdays node: it jumps whole weeks, then walks the remainder, and an answer outside the years 1 to 9999 is `#DOMAIN!` (Excel: `#NUM!`). WORKDAY.INTL also takes Excel's seven-character mask of `0` and `1`, Monday first, where 1 is a day off; an all-ones mask, any other string or an undefined code is `#VALUE!`.
- **NETWORKDAYS, NETWORKDAYS.INTL** never reach Formula.js, which miscounts a reversed span and a date carrying a time of day. Both run `networkDays` (`nodes/dateOps.ts`), shared with the Workdays node: it counts calendar days, whatever the times, and a reversed span is the negation of the forward count. The weekend argument reads as WORKDAY.INTL's does, so an undefined code is `#VALUE!` on the card and in the formula.

## Finance

- **TBILLEQ, TBILLPRICE, TBILLYIELD** run the T-Bill node's actual/360 kernel. Formula.js counts 30/360 and misses Microsoft's worked examples by a day.
- **IRR, XIRR** run the IRR node's solver, `solve_discount_rate` (`finance_ops.rs`): Newton's method with a rate floor, then bracket and bisect, answering `#CONV!` only when no root exists above the floor. Formula.js's IRR returns a fabricated 1000 (100,000%) when the root sits close to the floor: `IRR([-4943, -2458, 285])` is −0.903. The `guess` argument is accepted and ignored, because this solver needs no seed and the node takes none ([[D73]] nodeCoversFormula). Pinned across both surfaces in `tests/graph/nodes/financeIterative.test.ts`.
- **MIRR** runs the node's `mirr` kernel on the same cash-flow preparation as IRR.
- **DB, DDB** answer as Formula.js did, except that a period past 1,000,000 within the life answers `#DOMAIN!` ("DB needs a period of at most 1,000,000"). Formula.js stepped once per period, so a huge period hung the app ([[C120]] linearWork); VDB, CUMIPMT and CUMPRINC stop at the same million.
- **NPV** answers as Formula.js did, but is `RANGE_ZERO_FILL`: a blank period is a zero cash flow, as the nodes' `cashPrep` treats it. Dropping the blank would shift every later period.

## Array-returning names and complex numbers

UNIQUE, SORT, MODE.MULT, FREQUENCY and the regression quartet (TREND, GROWTH, LINEST, LOGEST) are Solenoid's own. Formula.js wrote its array functions against 2-D spreadsheet ranges with unvetted quirks, and was caught changing its arguments in place ([[formula-language#The dispatch ladder]]). The IM* family is Solenoid's own for the same reason: Formula.js's IM* functions took complex numbers only as text and refused the graph's own complex values.

## Names

The dotted names Formula.js hung off callable parents (`CEILING.MATH`, `NORM.S.DIST`, `T.TEST`) are ordinary names on the core. The editor's list and dispatch read one set (`engine_function_names`), so a name can't be offered and then fail. `formulaTier1.test.ts` and `formulaNodeParity.test.ts` dispatch the dotted names.
