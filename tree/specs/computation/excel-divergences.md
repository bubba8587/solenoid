---
aliases: ["Excel divergences"]
tags: [spec, computation]
---
<!-- [[A5]] excelParity, [[B16]] oneFormulaSurface, [[C17]] shareImpl, [[C15]] matricesInFormulas, [[D115]] datesArePoints, [[D119]] datesBefore1900 -->

# Spec: Excel divergences

Serves [[A5]] excelParity and [[B16]] oneFormulaSurface: a function keeps Excel's name and answer, and each place it doesn't is written here with its reason. Read this before changing a function whose answer differs from Excel's.

The first part is Solenoid's own differences from Excel, deliberate ones. The rest is the functions Solenoid answers as Excel does where Formula.js did not: Formula.js was the library behind every Excel function Solenoid didn't write itself, its bodies were ported into the core ([[rust-core]]) and the library is gone, so each entry is the reason its answer was wrong for Solenoid and the evidence for Excel's. Every kernel below is the core's, its file under `crates/solenoid-core/src/`.

## Deliberate differences from Excel

Each of these is a named divergence ([[B16]] oneFormulaSurface), kept because consistency across the graph beats matching a quirk:

- `0^0` is 1; Excel answers `#NUM!`.
- DATE's year is literal: 26 is the year 26, never 1926. Date text needs a four-digit year. One reading of a year everywhere beats matching Excel's two-digit guess ([[C44]] dateSerials).
- DATEDIF's `MD` is never negative; Excel's goes negative across a short month.
- VALUE does not parse date or time text, and no date function reads it: date text where a date belongs is `#TYPE!` "YEAR needs a date" (`date_values::ready`); DATEVALUE or Cast to Date reads it. Excel reads `YEAR("7/5/2008")` as 2008.
- MUNIT(0) is the empty matrix, as SEQUENCE's zero rows are an empty list; Excel answers `#VALUE!`. A negative size is `#DOMAIN!`.
- The IM* functions answer tagged complex values, zip lists pairwise, and answer IMARGUMENT(0) as 0; unparseable complex text is `#VALUE!` rather than `#NUM!`.
- EXPAND's default padding is blank rather than `#N/A`.
- CHAR and CODE are UNICHAR and UNICODE, the CHAR / CODE card's full-Unicode reading; Excel's stop at 255 and use the system code page.
- SEQUENCE and RANDARRAY with zero rows or columns are an empty list; Excel, which has no empty array, answers `#CALC!`. TAKE and DROP keep the error, as `#DOMAIN!`, because an empty take there is almost always a wrong count.
- The TAKE / DROP card reads a count of 0 as "left out", keeping the whole axis; Excel's TAKE of 0 is `#CALC!`, and so is the formula's (`#DOMAIN!`).
- XMATCH and XLOOKUP refuse wildcard and binary search modes.
- Excel's `#NUM!` is split into `#DOMAIN!`, `#OVERFLOW!` and `#CONV!`; `ERROR.TYPE` still reports all three as 6. A percentile outside its domain, taking nothing or dropping everything, and an XIRR date before the first are `#DOMAIN!`.
- A sample statistic with too few values (SKEW below 3, KURT below 4, SEM and CV below 2) is blank rather than `#DIV/0!` ([[C24]] arraySemantics), and so are AVERAGE and MEDIAN of no numbers and LARGE or SMALL with k past the count (Excel: `#DIV/0!`, `#NUM!`); STDEV.S and VAR.S of one value stay `#DIV/0!`, as in Excel, and so does AVERAGEIF(S) with no matching row.
- LOG2 of a value at or below 0 is blank.
- FORECAST.ETS uses its own parameter search, so its values are close to Excel's but not identical.

Tests: `excelFormula.test.ts`: ERROR.TYPE reports the split errors as Excel's code; `formulaMatrix.test.ts`: EXPAND pads with blank, the formula and the EXPAND card alike; `formulaComplex.test.ts`: the IM* functions answer as the complex cards do.

### Dates are points

A date is its own kind of value, a point in time, never a number ([[D114]] dateIsAKind, [[D115]] datesArePoints, [[C137]] datesNeverSerials; the rules are [[date-values]]). Excel's date is a number with a format, so each of these answers where Solenoid's is `#TYPE!`:

- Arithmetic other than moving a date by days or measuring between two: `date * 2`, `date / 7`, `date ^ 2`, `date1 + date2`, `5 - date`, `-date` and `date%`. A date plus or minus a number is still a date, and a date minus a date a number of days, as in Excel.
- A date compared with a number or text: `date = 46000`, `date < "x"`. Two dates compare as in Excel.
- A function in no date class handed a date: `SUM(date)`, `ABS(date)`, `SQRT(date)`, SUMIFS adding a range of dates, and a sum, product or share of dates in the table verbs.
- A number where a function reads a date: `YEAR(46000)`, `EDATE(46000, 1)`, and dates beside plain numbers in MIN, MAX, AVERAGE and the other functions that keep or spread dates. Cast to Number is the one way from a date to its serial, and Cast to Date or DATE the way back.
- A list or table mixing dates with another kind, which Excel holds as numbers in one range.

Tests: `datesNeverSerials.test.ts` and the date-values tests ([[date-values#Functions]]).

### Days before 1900

Excel has no dates before 1 January 1900: it refuses a negative date in TEXT, EDATE, the coupon functions and the rest. Solenoid takes them everywhere, from 01-Jan-0001 ([[D119]] datesBefore1900; [[date-values#Days before 1900]]). Its serials have no 29-Feb-1900 ([[C44]] dateSerials), so a serial from 1 to 60 is one day earlier than Excel's (Excel's 1 is 01-Jan-1900, Solenoid's 31-Dec-1899), and from 61 on (01-Mar-1900) they agree.

Tests: `dates_before_1900.rs` (solenoid-core).

## Excel's answer, pinned

**MUST:** where Formula.js gave a different answer from Excel, Solenoid gives Excel's, backed by the same implementation as the card ([[C17]] shareImpl), and a test pins it. No vendor update reaches the core, so the evidence lives in the suite, with the per-name reasons below.

Tests:

- `formulaDivergence.test.ts` pins the Excel-correct answer of each function below, and that the card sharing its kernel answers the same.
- `excel_examples.rs` (solenoid-core): Excel's documented answers for the functions whose bodies were rewritten away from what JavaScript computed.
- `excel_doc_sweep.rs` (solenoid-core): Excel's documented examples, function page by function page.

## Scalar math

- **MOD** takes the divisor's sign, as Excel does: `MOD(10, -3)` is -2, where Formula.js gives -1. A zero divisor is `#DIV/0!`, and so is a blank one, which reads as 0.
- **QUOTIENT** by zero is `#DIV/0!`; Formula.js returns null.
- **ROUNDUP, ROUNDDOWN**: Formula.js scales and rounds the raw binary value, so `ROUNDUP(0.1+0.2, 1)` is 0.4 where Excel answers 0.3. All three rounding names run `round_digits` (`excel_functions.rs`), which the ROUND card calls too; it reads the scaled value at 15 significant digits and truncates a fractional digits count.
- **POWER(0, 0)** is 1, the answer of `^` and the Arithmetic card ([[B16]] oneFormulaSurface); Formula.js answers `#NUM!`.
- **ATAN2**: Excel's `ATAN2(x, y)` is `atan2(y, x)`, x first. Formula.js computes `atan2(x, y)`.
- **GCD, LCM** run `gcd_lcm` (`excel_functions.rs`), which the GCD card calls too: each value is truncated, as in Excel, and a negative value, or a value or an LCM at 2^53 or more, is `#DOMAIN!`. Formula.js runs Euclid's algorithm on the raw decimals, so `GCD(4.5, 6.9)` is about 1.8e-15 and `LCM(4.5, 6)` is 27, and it takes negatives. The card, which read each pair after rounding, reads it the same way now.
- **LN, LOG10, SQRTPI, ASIN, ACOS, ACOSH, ATANH** outside their domain answer `#DOMAIN!` ("Input is outside this function's domain"). Formula.js silently returns null for some of them.
- **ACOT** is in (0, π), as Excel's and the Math Function card's: `ACOT(-1)` is 3π/4. Formula.js computes `atan(1/x)`, so a negative x answered in (−π/2, 0).
- **GAMMALN, GAMMALN.PRECISE** run `ln_gamma` (`dists.rs`), the Math Function card's kernel, and an x of 0 or less is `#DOMAIN!` (Excel's `#NUM!`). Formula.js answered `GAMMALN(-3.7)` as -1.38 and `GAMMALN(0)` as infinity, and its own log-gamma drifts by about 1e-13 at x = 100.

- **FACT, FACTDOUBLE, COMBIN, COMBINA, PERMUT, MULTINOMIAL** run `combinatoric` (`excel_functions.rs`). Formula.js builds FACT by recursion, so a large count, or a negative one that never reaches its base case, overflowed the call stack, and COMBIN, PERMUT and MULTINOMIAL divide factorials, so `COMBIN(30, 15)` was 155117519.99999997. Arguments truncate; a negative count or choosing more than there are without repetition is `#DOMAIN!`, except that `FACTDOUBLE(-1)` is 1, as in Excel; COMBINA takes more than there are, so `COMBINA(2, 5)` is 6 and `COMBINA(0, 3)` is 0; COMBIN divides as it multiplies, so its answer is the exact integer wherever a double holds one; past a double's range the answer overflows to `#OVERFLOW!`. The factorials multiply in Formula.js's order, so FACT and FACTDOUBLE answer what it did up to 170. The Combinatorics card runs the same kernel ([[C17]] shareImpl); PERMUTATIONA is its own.

- **BINOM.DIST.RANGE** runs `binom_dist_range` (`excel_functions.rs`): Excel's constraints (0 ≤ s ≤ s2 ≤ trials, a probability from 0 to 1) answer `#DOMAIN!`, where Formula.js checks nothing and sums a reversed range to 0; each term multiplies COMBIN's exact count by the powers, or works in logs where the count overflows, so `BINOM.DIST.RANGE(1e5, 0.5, 0, 50000)` answers instead of overflowing the call stack; a range past a million outcomes is `#DOMAIN!`.

- **BESSELJ, BESSELI, BESSELK, BESSELY** answer as Formula.js's bessel.js does, whose polynomial fits Excel shares: Excel documents `BESSELJ(1.9, 2)` as 0.329925829, bessel.js's answer, where the exact value is 0.3299257277 (libm's `jn`). They take the order truncated to a whole number, as Excel does (Formula.js rounds it, so `BESSELJ(1, 2.7)` was J₃). A negative order answers `#DOMAIN!` ("BESSELJ takes an order of 0 or more", Excel's `#NUM!`) and an order past 1,000,000, infinity included, `#DOMAIN!` ("BESSELJ takes an order of at most 1,000,000"): Formula.js recurs once per order, so `BESSELJ(1, 1e12)` hung the app ([[C120]] linearWork). An order given as text is read as every number text is ([[C58]] tableInputRawText), so `BESSELJ(1, "-Infinity")` is `#VALUE!` ("BESSELJ needs a number"), where Formula.js reads it as -Infinity and loops. The Bessel card computes through these registrations, its order passed as wired ([[C17]] shareImpl).

- **CLEAN** drops character codes 0 to 31, as Excel's does, and reads a number or logical as its text: Formula.js threw on `CLEAN(5)`. The Text Transform card's CLEAN calls it, so the card no longer also drops DEL (127), which Excel keeps.

These match the Math node's own compute.

## Logic

- **IFS** reads each test with `if_test`, IF's reading, which the IFS card shares: text is `#VALUE!`, even `"TRUE"` ([[C10]] socketLattice). Formula.js takes any truthy JavaScript value, so `IFS("FALSE", 1)` answered 1.

## Text arguments

- Formula.js's number reader read numeric text as a number (`ABS("5")` was 5, `SUMSQ` summed `"5"`), its `parseDate` read date text (`EDATE("2024-01-31", 1)`), and its SUM `parseFloat`ed a text argument. Every body ported from it answers `#VALUE!` for text where it needs a number or a date, and SUM refuses text ([[D109]] aggregatesRefuseText, [[formula-language#Text is text]]).

## Statistics

- **RANK, RANK.EQ, RANK.AVG** (`excel_rank`): descending, largest is rank 1. Ties share the lowest rank (RANK, RANK.EQ) or the average rank (RANK.AVG). A value not in the list is `#N/A`; Formula.js answers 0.
- **TRIMMEAN** (`excel_trimmean`) drops `floor(n · percent / 2)` values from each end, so the total trimmed is rounded down to an even count, then averages the rest. Formula.js over-trims: `TRIMMEAN([2,4,4,4,5,5,7,9], 0.2)` is 5 in Excel and 4.83 in Formula.js. Text and blanks in the list are skipped, a single number is a list of one, and a percent outside 0 up to 1, or no number at all, is `#DOMAIN!`.
- **PERCENTRANK, PERCENTRANK.INC, PERCENTRANK.EXC** (`excel_percent_rank`) interpolate linearly between the bracketing points and truncate, never round, to `significance` digits (default 3). The inclusive forms use an (n−1) basis and the exclusive form an (n+1) basis. A value outside the data's range is `#N/A`, where Formula.js's dotted forms answer 0 below it and an error above it; an exact match takes the first occurrence. Blanks and text in the array are skipped and an error in it is the answer. A one-value array ranks its value 1 in every form, as Excel does (checked in Excel 2026-10-05), where the (n−1) basis would divide by zero and the (n+1) one would give 0.5. The card truncates its significance as the formula does.
- **SUM** is owned for the same reason: Formula.js recurses through `SUM.apply(null, list)`, which throws past about 125k values, so `SUM(column)` in a computed column over a long table failed in every row and re-summed per row. It sums numbers and logicals by a loop, a nested list as its own subtotal; text, typed or in a list, is `#VALUE!` ([[D109]] aggregatesRefuseText), and the first error is the answer.
- **MIN, MAX** are owned because Formula.js spreads the whole list into `Math.min` and `Math.max`, which throws past about 125k values. They run the Aggregate card's kernel over the numbers, a logical read as 1 or 0 ([[D108]] aggregatesCountLogicals) and text `#TYPE!` ([[D109]] aggregatesRefuseText); no numbers is 0, and a NaN cell is `#DOMAIN!`.
- **QUARTILE.INC** is PERCENTILE.INC at q/4, so quartile 0 is the minimum and quartile 4 the maximum, matching the Rank & Percentile node's interpolation. Formula.js's QUARTILE.INC errors on 0 and 4.
- **T.TEST**: Formula.js ignores `tails` and `type`. Ours honors both: type 1 is paired, 2 equal variance, 3 Welch; tails 1 halves the two-tailed p-value.
- **F.TEST**: Formula.js returns the variance ratio instead of the p-value. Text and blanks are skipped; under two numbers on a side, or no spread, is `#DIV/0!`, as in Excel.

- **SUMSQ, SUMPRODUCT, SUMX2MY2, SUMX2PY2, SUMXMY2, Z.TEST, LOG, TYPE** are Excel's ([[B27]] computeAnswersToExcel), not Formula.js's JavaScript coercions: text typed as an argument is `#VALUE!` ([[C10]] socketLattice); text in a list is `#VALUE!` for SUMSQ and SUMPRODUCT ([[D109]] aggregatesRefuseText) and dropped with its pair by the SUMX functions, and a blank in a list is skipped (SUMPRODUCT counts it as 0), SUMPRODUCT's lists of different sizes are `#VALUE!` and the SUMX functions' `#N/A`. LOG's base of 0 is a base, not a missing one (`#DOMAIN!`), and a base of 1 is `#DIV/0!`. Z.TEST with no spread is `#DIV/0!`. TYPE is an error handler, so an error argument answers 16, a blank 1, a LAMBDA 128, and no argument `#VALUE!`. WAVG, WVAR and WSTDEV drop a pair whose value or weight is text, where the weight sum once joined it as text.

RANK, TRIMMEAN and PERCENTRANK are the functions the Rank & Percentile and Trim Mean nodes call, and T.TEST and F.TEST are the Hypothesis Test node's kernels.

## Text and number parsing

- **CONCAT, CONCATENATE, TEXTJOIN** are owned so a number is written with `number_to_text` (15 significant digits) rather than Formula.js's formatting.
- **SEARCH** is Solenoid's own: Formula.js matches `?`, `*` and `~` literally, where Excel reads them as wildcards (`wildcard_tokens` in `excel_criteria.rs`, shared with the criteria functions). Its start and empty-find rules are FIND's below.
- **Text functions.** LEFT, RIGHT, UPPER, LOWER, EXACT and FIND answer as Excel does (checked 2026-11-01): positions count UTF-16 units as Excel's do (`LEN("😀")` is 2), a number reads through `number_to_text` (`LEFT(0.1+0.2, 3)` is "0.3"), a logical as TRUE or FALSE, and FIND with nothing found is `#VALUE!` saying so. UPPER maps each character to its one-character uppercase and keeps one whose uppercase is several (`UPPER("straße")` is "STRAßE"), as Excel does, so the text keeps its length. A cut (LEFT, RIGHT, MID, REPLACE) never halves a character: one between a surrogate pair's halves widens to take it whole, so `LEFT("😀x", 1)` is the smiley, as in Excel (`whole_chars`). TRIM is Excel's: it takes spaces (U+0020 only) off both ends and collapses each run of them inside to one, leaving tabs and non-breaking spaces (`excel_trim`); the Text Transform card's trim calls it. REPLACE is Excel's: its text arguments read the same way, its start truncates and is `#VALUE!` below 1, and a negative count is `#VALUE!`. LEFT and RIGHT with a count below 0, and FIND and SEARCH with a start below 1, are `#VALUE!` as in Excel, where Formula.js clamps them; the Text Slice, Text Find and REPLACE cards call the same registrations with their numbers as given.
- **DEC2HEX, BIN2HEX, OCT2HEX** answer as Formula.js did, with the result uppercased: Excel writes the letter digits A to Z in uppercase (`DEC2HEX(255)` is `FF`), and Formula.js in lowercase. DEC2BIN, DEC2HEX and DEC2OCT truncate a fraction (`DEC2HEX(255.9)` is `FF`), and every base conversion refuses `places` past 10 with `#NUM!`, as Excel does.
- **BASE, DECIMAL, ROMAN, ARABIC, PERMUTATIONA** are Excel's ([[B27]] computeAnswersToExcel), not Formula.js's, which ran on JavaScript's `parseInt` and `toString(radix)`. BASE truncates its number, radix and length and is `#NUM!` outside 0 to 2^53, radix 2 to 36 and length 0 to 255; DECIMAL reads digits of its radix in any case, ignoring spaces around and a `0x` prefix in base 16, and is `#NUM!` on any other character or past 2^53. ROMAN takes Excel's `form` (0 to 4, TRUE as 0 and FALSE as 4) and is `#VALUE!` below 0 or past 3999; ARABIC reads any case, spaces around and a leading `-`, as leniently as Excel: each numeral adds, or subtracts before a larger one, so `IIII` is 4, `VV` 10 and `MMMM` 4000 (`roman_text`, `arabic_value` in `formulajs.rs`; checked in Excel 2026-11-01). PERMUTATIONA truncates both counts and refuses a negative one.
- **PROPER** runs `proper_case` (`excel_functions.rs`), which the Text Transform card calls too: a letter after any non-letter is capitalized and every other letter lowercased, Excel's rule, so `PROPER("76BudGet")` is `76Budget` and `o'neil 2nd` is `O'Neil 2Nd`. Formula.js capitalizes only after certain separators.
- **MID** of length 0 is `""`, as in Excel; Formula.js answers an error. A start below 1 or a negative length is `#VALUE!`. The Text Slice card calls the same registration.
- **REPT** (and the REPT card, which passes its count as given) truncates a fractional count (`REPT("ab", 2.9)` is `abab`), refuses a negative one, and refuses a result past Excel's 32,767 characters, all with `#VALUE!`. Formula.js throws a raw `RangeError` on a fractional count.
- **CHAR, CODE, UNICHAR, UNICODE** cover every code point (their arms in `excel_functions.rs`, which the CHAR / CODE card calls): `CHAR(128512)` is 😀 and `CODE("😀")` is 128512. A code outside 1 to 1114111, a surrogate, or empty text is `#VALUE!`. Formula.js works in UTF-16 units, so it answers a lone surrogate half, and its CHAR wraps a code past 65535. That CHAR and CODE reach past Excel's 255 is a difference from Excel itself, listed in [[formula-language]].
- **SUBSTITUTE** is owned: Formula.js replaces the (instance + 1)th match, while Excel truncates `instance` like every numeric argument and replaces that match. An instance below 1 is `#VALUE!`; an empty search text returns the text unchanged.
- **VALUE** is strict. It accepts a plain number, an optional `$` after the sign, thousands commas, a wrapping pair of parentheses for a negative, and any number of trailing `%` (each divides by 100). The number itself is `decimalFromText`'s reading, so a `0x`, `0b` or `0o` literal and `Infinity` are `#VALUE!`, as in Excel. Anything else is `#VALUE!`, including a logical (`VALUE(TRUE)`) and empty text. Formula.js returns 0 for any unparseable text, which silently corrupts a result. VALUE deliberately does not parse date or time text; that is DATEVALUE's job. Number text is read in the US form only ([[C58]] tableInputRawText): `.` is the decimal point and a comma anywhere before it is a grouping mark (`VALUE("1,5")` is 15, as in US Excel), while a comma after it makes the text not a number, so the European `1.234,5` is `#VALUE!`, never reread as 1.2345. Only `$` is stripped, so `€5` is `#VALUE!`. Cast to Number reads the same way (`parse_value_text`).
- **NUMBERVALUE(text, [decimal], [group])**: formula only; its kernel is `number_value` (`excel_functions.rs`). Its card is Cast to Number, which reads as VALUE does (`parse_value_text`, `$` and `(5)` included) with the same separator rules, so empty text is `#VALUE!` on the card and 0 here ([[B11]] maximalMerge). Only the first character of each separator argument counts, whitespace is stripped anywhere, trailing `%` each divide by 100, and empty text is 0. The group separator is legal only before the decimal point. The default group separator `,` steps aside when the decimal separator is `,`; only two explicitly identical separators are `#VALUE!`. The digits left after the separators go through `decimalFromText`, so `NUMBERVALUE("0x1F")` is `#VALUE!` where JavaScript's `Number` reads 31. Formula.js returns null when only a decimal separator is given.
- **DOLLAR**: Excel writes a negative in accounting form as `($1,234.57)`, the `$` inside the parentheses. Formula.js writes `$(1,234.57)`, and the override moves the `$`. A negative that rounds to zero keeps the form, `($0.00)`, where Formula.js writes `-$0.00`. `decimals` truncates, and a blank one is 0 (left out, 2). The DOLLAR card calls the same registration.
- **FIXED, DOLLAR** round with `round_digits` first, so `FIXED(1.005, 2)` is "1.01" as in Excel; Formula.js's `toFixed` reads the binary 1.00499… and writes "1.00". A value that rounds to zero goes through unrounded, so its sign survives. The FIXED card calls the same registration.
- **CONVERT** runs Solenoid's unit system on the Convert node's units, read by Excel code first (`"C"`, `"lbm"`, `"oz"` the fluid ounce) and by the node's unit id second (`convert_unit_key`, `convert_units.rs`). An unknown or cross-category unit is `#N/A`, as in Excel. Formula.js's CONVERT errors even on Celsius to Fahrenheit.
- **TEXT** reads Excel's format codes (US English) in `excel_format.rs`, shared with Cast to Text: up to four sections (positive; negative, shown without its minus; zero; text), conditions (`[>100]`), digit placeholders `0 # ?`, grouping and scaling commas, `%`, scientific (`0.00E+00`, engineering with `##0.0E+0`), fractions (`# ?/?`, `# ?/8`), dates and times (`m` is minutes after an hour or before seconds; `[h]:mm` elapsed; `ss.00`; AM/PM shows in capitals), quoted and escaped literals, `_x` as a space, `*x` dropped, `[$€-…]` currency and colors ignored. A number is formatted from its 15 significant digits, rounded half up (`TEXT(1.005, "0.00")` is "1.01"), and a value that rounds to zero loses its minus. Text and a logical go through the text section and otherwise pass unchanged (`TEXT(TRUE, "0")` is "TRUE"; text is never read as a number, [[C10]] socketLattice). `#VALUE!`: digit placeholders mixed with date codes (`0 days`), an unclosed quote or bracket, more than four sections, a missing format. A day before 1900 formats as a date, where Excel refuses a negative date ([[D119]] datesBefore1900), and a date code shows the value's own day in whichever section takes it. Checked against the author's Excel, 2026-11-01 (`excel_format.rs` tests); the one gap is Excel cutting a typed number to 15 digits on entry, where Solenoid's literal keeps its double.

## Dates

- **YEAR, MONTH, DAY, HOUR, MINUTE, SECOND** read Solenoid's serial through `serialToJsDate` and the UTC getters, the one serial model the Date Part node uses, not Formula.js's Date and 1900 conventions.
- **WEEKDAY, WEEKNUM** take every Excel return type, read as the day the week starts on: WEEKDAY 1 to 3 and 11 to 17, WEEKNUM 1, 2, 11 to 17 and 21 (ISO). Any other code is `#DOMAIN!` (Excel's `#NUM!`). The Week Info card passes its code through. Pinned in `excel_doc_sweep.rs`.
- **TIME** truncates each part and wraps at 24 hours, as Excel does; a total below zero, or an hour past 32767, is `#DOMAIN!` (Excel's `#NUM!`). The Time card calls it with its fields as given.
- **EDATE** drops the start's time of day and truncates the months, as Excel does; the Date Add card passes both as given. `fx_edate` (`excel_functions.rs`) moves the start's day by whole months, on the calendar with no time zone (`date_serial::civil`, as YEARFRAC, the coupon days and DATEDIF's days do), so the machine's zone and daylight saving never move it, (the count truncated, as Excel does, where Formula.js `parseInt`ed its text), clamping to the month's last day, and rounds back to a serial on the day, since the result is date-only. A count that carries the date past the calendar is `#DOMAIN!`.
- **WORKDAY.INTL, NETWORKDAYS.INTL**: an undefined numeric weekend code is `#DOMAIN!` (Excel's `#NUM!`), a malformed mask `#VALUE!`.
- **WORKDAY, WORKDAY.INTL** never reach Formula.js, which walks one day at a time (a count of 1e9 hangs) and takes only the numeric weekend codes. Both run `add_workdays` (`date_ops.rs`), which the Workdays node calls through them: it jumps whole weeks, then walks the remainder, and an answer outside the years 1 to 9999 is `#DOMAIN!` (Excel: `#NUM!`). WORKDAY.INTL also takes Excel's seven-character mask of `0` and `1`, Monday first, where 1 is a day off; an all-ones mask, any other string or an undefined code is `#VALUE!`.
- **NETWORKDAYS, NETWORKDAYS.INTL** never reach Formula.js, which miscounts a reversed span and a date carrying a time of day. Both run `network_days` (`date_ops.rs`), which the Workdays node calls through them: it counts calendar days, whatever the times, and a reversed span is the negation of the forward count. The weekend argument reads as WORKDAY.INTL's does, so an undefined code is `#VALUE!` on the card and in the formula.

## Finance

- **TBILLEQ, TBILLPRICE, TBILLYIELD** run the T-Bill node's actual/360 kernel. Formula.js counts 30/360 and misses Microsoft's worked examples by a day.
- **IRR, XIRR** run the IRR node's solver, `solve_discount_rate` (`finance_ops.rs`): Newton's method with a rate floor, then bracket and bisect, answering `#CONV!` only when no root exists above the floor. Formula.js's IRR returns a fabricated 1000 (100,000%) when the root sits close to the floor: `IRR([-4943, -2458, 285])` is −0.903. The `guess` argument is accepted and ignored, because this solver needs no seed and the node takes none ([[D73]] nodeCoversFormula). Pinned across both surfaces in `tests/graph/nodes/financeIterative.test.ts`.
- **MIRR** runs the node's `mirr` kernel on the same cash-flow preparation as IRR.
- **DB** is Excel's: its rate rounds to three places, periods run from 1 to the life, and when the first year is partial (`month` below 12) a partial last period follows the life, as Excel documents (`DB(1000000, 100000, 6, 7, 7)` is 15,845.10), where Formula.js refused it. **DDB** answers as Formula.js did, which matches Excel's documented examples. Both refuse a period past 1,000,000 within the life: `#DOMAIN!` ("DB needs a period of at most 1,000,000"). Formula.js stepped once per period, so a huge period hung the app ([[C120]] linearWork); VDB, CUMIPMT and CUMPRINC stop at the same million.
- **NPV** answers as Formula.js did, but is `prep: zero`: a blank period is a zero cash flow, as the nodes' `cash_prep` treats it. Dropping the blank would shift every later period.

## Array-returning names and complex numbers

UNIQUE, SORT, MODE.MULT, FREQUENCY and the regression quartet (TREND, GROWTH, LINEST, LOGEST) are Solenoid's own. Formula.js wrote its array functions against 2-D spreadsheet ranges with unvetted quirks, and was caught changing its arguments in place ([[formula-language#The dispatch ladder]]). The IM* family is Solenoid's own for the same reason: Formula.js's IM* functions took complex numbers only as text and refused the graph's own complex values.

## Names

The dotted names Formula.js hung off callable parents (`CEILING.MATH`, `NORM.S.DIST`, `T.TEST`) are ordinary names in Solenoid. The editor's list and dispatch read one set (`engine_function_names`), so a name can't be offered and then fail. `formulaTier1.test.ts` and `formulaNodeParity.test.ts` dispatch the dotted names.
