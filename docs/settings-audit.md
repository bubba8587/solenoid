# Settings sweep: what was built, for review

The settings sweep ([[D86]] blankRoles, [[input-roles]]), built 2026-09-26 on Claude's judgement at the author's word
("please use your own judgement and implement for now. can review later."). Every row below is live; mark one wrong and
it changes. Once reviewed, this file moves to `archive/`.

How to read a row: **setting, blank = omitted** means a blank reads as Excel's omitted argument (the function's default);
**blank = #SYNTAX!** means there is no default; **pick** means a position, dropped when blank.

## The rule applied

- An argument Excel marks optional: a blank is the argument left out, so the function's own default.
- An argument Excel requires, where Excel's typed blank (0, FALSE, "") gives a working answer: that blank, as a slot left
  empty already reads ([[C80]] blankArgIsExcelBlank). So a blank `cumulative` is FALSE, CUMIPMT's blank `type` is 0, a
  Bessel order is 0, TEXTJOIN's blank delimiter is "", TRIMMEAN's blank percent is 0.
- An argument Excel requires, where its typed blank is an error or nonsense (MID's start, LARGE's k, a wrap count, a
  radix): `#SYNTAX!` naming it.
- A card with a formula twin reads the twin's declaration (`rolesFrom`); a card-only setting uses the card's own normal
  default, listed under Card sockets.

## Claude's calls on the judgment rows

- **Distribution parameters** (alpha, beta, mean, sd, probability, degrees of freedom) are data: a blank one is a blank
  answer, as the numbers the function works on are. Only their `cumulative` flag is a setting.
- **CLAMP**'s bounds: a blank bound is no bound on that side, on the card (item by item in a list of bounds) and in the
  formula.
- **LARGE** and **SMALL**'s `k`: a required setting, `#SYNTAX!` when blank.
- **CHOOSE**'s index: a required setting (`#SYNTAX!`), not a pick, since a list of indices must stay aligned with its
  answers.
- **FILTER**'s `if_empty`: a setting; blank is left out, so nothing passing gives the empty answer.
- **Date "start" arguments** stay data: a blank date is a missing date.
- **Generators** (SEQUENCE, LINSPACE, GEOMETRIC, RANGE, FIBONACCI, REPEAT and the Series card's ops): their counts and
  starts are required settings, their optional steps and columns settings.
- **Filter conditions** (List Filter, Frame Filter, SUMIFS): a blank value or column skips the condition, so the rows
  pass it; [[C24]]'s blank-filter consequence is overturned, as the author ruled.

## Not swept yet

- Column references in Frame verbs (Frame Sort, Get Column, Join keys, Split Column, Replace Values, Unnest, Cube Rollup,
  Reconcile, Earned Value, Window's Order by): each needs its own reading of "left out" (pass the Frame through, or
  `#SYNTAX!`), so they still blank the Frame.
- An as-of Join's tolerance, and the Slider's bounds (the widget needs a working bound).
- Gantt, Schedule and Earned Value already read a blank weekend code or hours per day as the default.

## Formula functions

Every declared function, generated from `ARG_ROLES` (`src/graph/inputRoles.ts`). "omitted" is Excel's omitted
argument; a value is the typed blank it reads as.

| Function | Blank reads as |
|---|---|
| ACCRINT | `frequency` → #SYNTAX!; `basis` → omitted |
| ACCRINTM | `basis` → omitted |
| BASE | `radix` → #SYNTAX!; `min_length` → omitted |
| BESSELI | `n` → 0 |
| BESSELJ | `n` → 0 |
| BESSELK | `n` → 0 |
| BESSELY | `n` → 0 |
| BETA.DIST | `cumulative` → false |
| BIN2HEX | `places` → omitted |
| BIN2OCT | `places` → omitted |
| BINOM.DIST | `cumulative` → false |
| CAGR | `periods_per_year` → omitted |
| CEILING | `significance` → #SYNTAX! |
| CEILING.MATH | `significance` → omitted; `mode` → omitted |
| CHISQ.DIST | `cumulative` → false |
| CHOOSE | `index` → #SYNTAX! |
| CHOOSECOLS | `col1` → pick, none left = #SYNTAX!; the rest → pick |
| CHOOSEROWS | `row1` → pick, none left = #SYNTAX!; the rest → pick |
| CLAMP | `min` → omitted; `max` → omitted |
| COMBINATIONS | `k` → #SYNTAX! |
| CONVERT | `from_unit` → #SYNTAX!; `to_unit` → #SYNTAX! |
| COUPDAYBS | `frequency` → omitted; `basis` → omitted |
| COUPDAYS | `frequency` → omitted; `basis` → omitted |
| COUPDAYSNC | `frequency` → omitted; `basis` → omitted |
| COUPNCD | `frequency` → omitted; `basis` → omitted |
| COUPNUM | `frequency` → omitted; `basis` → omitted |
| COUPPCD | `frequency` → omitted; `basis` → omitted |
| CUMIPMT | `type` → 0 |
| CUMPRINC | `type` → 0 |
| DATEDIF | `unit` → #SYNTAX! |
| DATETRUNC | `unit` → #SYNTAX!; `ceiling` → omitted |
| DAYS360 | `method` → omitted |
| DDB | `factor` → omitted |
| DEC2BIN | `places` → omitted |
| DEC2HEX | `places` → omitted |
| DEC2OCT | `places` → omitted |
| DECIMAL | `radix` → #SYNTAX! |
| DISC | `basis` → omitted |
| DOLLAR | `decimals` → omitted |
| DROP | `rows` → omitted; `columns` → omitted |
| DURATION | `frequency` → omitted; `basis` → omitted |
| EWMA | `alpha` → #SYNTAX! |
| EXPAND | `rows` → omitted; `columns` → omitted |
| EXPON.DIST | `cumulative` → false |
| F.DIST | `cumulative` → false |
| FIBONACCI | `count` → #SYNTAX! |
| FILTER | `if_empty` → omitted |
| FIND | `start` → omitted |
| FIXED | `decimals` → omitted; `no_commas` → omitted |
| FLOOR | `significance` → #SYNTAX! |
| FLOOR.MATH | `significance` → omitted; `mode` → omitted |
| FROMEPOCH | `unit` → omitted |
| FUZZYMATCH | `threshold` → omitted; `method` → omitted |
| FV | `type` → omitted |
| GAMMA.DIST | `cumulative` → false |
| GEOMETRIC | `start` → #SYNTAX!; `count` → #SYNTAX! |
| GESTEP | `step` → omitted |
| GROWTH | `const` → omitted |
| HEX2BIN | `places` → omitted |
| HEX2OCT | `places` → omitted |
| HYPGEOM.DIST | `cumulative` → false |
| INDEX | `row` → pick; `col` → pick |
| INTRATE | `basis` → omitted |
| IPMT | `type` → omitted |
| IRR | `guess` → omitted |
| ISCLOSE | `tolerance` → omitted |
| ISOUTLIER | `method` → omitted; `threshold` → omitted |
| LARGE | `k` → #SYNTAX! |
| LEFT | `count` → omitted |
| LINSPACE | `start` → #SYNTAX!; `count` → #SYNTAX! |
| LOG | `base` → omitted |
| LOGNORM.DIST | `cumulative` → false |
| MAKEARRAY | `rows` → #SYNTAX!; `columns` → #SYNTAX! |
| MDURATION | `frequency` → omitted; `basis` → omitted |
| MID | `start` → #SYNTAX!; `count` → #SYNTAX! |
| MROUND | `multiple` → #SYNTAX! |
| MUNIT | `dimension` → #SYNTAX! |
| NEGBINOM.DIST | `cumulative` → false |
| NETWORKDAYS | `holidays` → omitted |
| NETWORKDAYS.INTL | `weekend` → omitted; `holidays` → omitted |
| NORM.DIST | `cumulative` → false |
| NORM.S.DIST | `cumulative` → false |
| NPER | `type` → omitted |
| NTHELEMENT | `n` → #SYNTAX! |
| OCT2BIN | `places` → omitted |
| OCT2HEX | `places` → omitted |
| ODDFPRICE | `frequency` → omitted |
| ODDFYIELD | `frequency` → omitted |
| ODDLPRICE | `frequency` → omitted |
| ODDLYIELD | `frequency` → omitted |
| PADLEFT | `length` → #SYNTAX! |
| PADRIGHT | `length` → #SYNTAX! |
| PADTEXT | `width` → #SYNTAX!; `side` → omitted; `fill` → omitted |
| PERCENTILE | `k` → #SYNTAX! |
| PERCENTILE.EXC | `k` → #SYNTAX! |
| PERCENTILE.INC | `k` → #SYNTAX! |
| PERCENTRANK | `significance` → omitted |
| PERCENTRANK.EXC | `significance` → omitted |
| PERCENTRANK.INC | `significance` → omitted |
| PERMUTATIONS | `k` → #SYNTAX! |
| PMT | `type` → omitted |
| POISSON.DIST | `cumulative` → false |
| POLYFIT | `degree` → #SYNTAX! |
| PPMT | `type` → omitted |
| PRICE | `frequency` → omitted |
| PRICEDISC | `basis` → omitted |
| PRICEMAT | `basis` → omitted |
| PV | `type` → omitted |
| RANDARRAY | `rows` → omitted; `columns` → omitted; `min` → omitted; `max` → omitted; `whole_number` → omitted |
| RANDDIST | `n` → #SYNTAX! |
| RANGE | `start` → #SYNTAX!; `step` → omitted |
| RANK | `order` → omitted |
| RANK.AVG | `order` → omitted |
| RANK.EQ | `order` → omitted |
| RATE | `type` → omitted; `guess` → omitted |
| RECEIVED | `basis` → omitted |
| REGEXEXTRACT | `return_mode` → omitted; `case_sensitivity` → omitted |
| REPEAT | `count` → #SYNTAX! |
| REPLACE | `start` → #SYNTAX!; `count` → #SYNTAX! |
| REPT | `count` → #SYNTAX! |
| RIGHT | `count` → omitted |
| ROUND | `digits` → 0 |
| ROUNDDOWN | `digits` → 0 |
| ROUNDUP | `digits` → 0 |
| RUNNING | `window` → omitted |
| SAVGOL | `window` → #SYNTAX!; `order` → #SYNTAX! |
| SEARCH | `start` → omitted |
| SEQUENCE | `rows` → #SYNTAX!; `columns` → omitted; `start` → omitted; `step` → omitted |
| SHARPE | `rf_per_period` → omitted; `periods_per_year` → omitted |
| SHIFT | `by` → omitted; `wrap` → omitted |
| SIMILARITY | `method` → omitted |
| SLICE | `start` → #SYNTAX!; `end` → omitted |
| SLUGIFY | `separator` → omitted |
| SMALL | `k` → #SYNTAX! |
| SORT | `sort_index` → omitted; `sort_order` → omitted; `by_col` → omitted |
| SORTBY | `sort_order1`, `sort_order2`, … → omitted |
| SORTINO | `rf_per_period` → omitted; `periods_per_year` → omitted |
| SPARKLINE | `type` → omitted |
| T.DIST | `cumulative` → false |
| T.TEST | `tails` → #SYNTAX!; `type` → #SYNTAX! |
| TAKE | `rows` → omitted; `columns` → omitted |
| TEXT | `format` → #SYNTAX! |
| TEXTAFTER | `instance_num` → omitted; `match_mode` → 0; `match_end` → 0; `if_not_found` → omitted |
| TEXTBEFORE | `instance_num` → omitted; `match_mode` → 0; `match_end` → 0; `if_not_found` → omitted |
| TEXTJOIN | `delimiter` → ""; `ignore_empty` → false |
| TEXTSPLIT | `col_delimiter` → #SYNTAX!; `row_delimiter` → omitted; `ignore_empty` → false; `match_mode` → 0; `pad_with` → omitted |
| TOCOL | `ignore` → omitted; `scan_by_column` → omitted |
| TOEPOCH | `unit` → omitted |
| TOROW | `ignore` → omitted; `scan_by_column` → omitted |
| TRAPZ | `dx` → omitted |
| TREND | `const` → omitted |
| TRIMMEAN | `percent` → 0 |
| TRUNC | `digits` → omitted |
| TRUNCATETEXT | `width` → #SYNTAX!; `ellipsis` → omitted |
| UNIQUE | `by_col` → omitted; `exactly_once` → omitted |
| VALUETOTEXT | `format` → omitted |
| VDB | `factor` → omitted; `no_switch` → false |
| VOLATILITY | `periods_per_year` → omitted |
| WEEKDAY | `type` → omitted |
| WEEKNUM | `type` → omitted |
| WEIBULL.DIST | `cumulative` → false |
| WORKDAY | `holidays` → omitted |
| WORKDAY.INTL | `weekend` → omitted; `holidays` → omitted |
| WRAPCOLS | `wrap_count` → #SYNTAX!; `pad_with` → omitted |
| WRAPROWS | `wrap_count` → #SYNTAX!; `pad_with` → omitted |
| WRAPTEXT | `width` → #SYNTAX! |
| XIRR | `guess` → omitted |
| XLOOKUP | `match_mode` → 0; `search_mode` → 0 |
| XMATCH | `match_mode` → 0; `search_mode` → 0 |
| YEARFRAC | `basis` → omitted |
| YIELD | `frequency` → omitted |
| YIELDDISC | `basis` → omitted |
| YIELDMAT | `basis` → omitted |

## Card sockets

Cards with a formula twin read the twin's roles through `rolesFrom`; the rest declare their own. Rows marked "not swept"
still blank.

| Card | Settings (a blank reads as) | Picks / column references |
|---|---|---|
| Histogram | Bins (10) | |
| Gantt, Schedule, Earned Value (already), WORKDAY / NETWORKDAYS | Weekend (1) | |
| Schedule | Hours per day (8) | |
| Record | | Row (1) |
| Slider | not swept: Min, Max, Step need a bound the widget can use | |
| Alert | not swept: Low and High are check parameters, which already skip | |
| MROUND / CEILING / FLOOR | Multiple (1) | |
| Base Convert | From base, To base (10) | |
| Bessel | Order (#SYNTAX!) | |
| Series (range) | Start (0), Step (1) | |
| RANDARRAY | Count (#SYNTAX!) | |
| Combinations | Choose k (#SYNTAX!) | |
| Slice | Start (1); End (to the end, already its omitted reading) | |
| Pad | Target length (#SYNTAX!) | |
| NthElement | Step N (1) | |
| Running | Window (0, cumulative) | |
| Shift | By (1) | |
| EWMA | Alpha (#SYNTAX!) | |
| Trapz | dx (1) | |
| LARGE / SMALL, PERCENTILE, QUARTILE, RANK, PERCENTRANK card | Significance (3), Order (0), Quart (0) | K, P (#SYNTAX!) |
| Polyfit | Degree (#SYNTAX!) | |
| ETS Forecast | Steps ahead (#SYNTAX!), Season length (1) | |
| TRIMMEAN | Trim % (#SYNTAX!) | |
| Is Close | Tolerance (1e-9) | |
| Bond Pricing, Accrued Interest, Duration, Coupon | Frequency (2), Basis (0) | |
| Week Info | Return type (1) | |
| Pad Text | Width (#SYNTAX!), Fill (" ") | |
| Truncate Text | Width (#SYNTAX!), Ellipsis ("…") | |
| Wrap Text | Width (#SYNTAX!) | |
| TEXTJOIN, TEXTSPLIT, Split Column, Merge Columns | Delimiter / Separator ("") | |
| LEFT / MID / RIGHT | N, Len (1); Start (1) | |
| REPT | Times (#SYNTAX!) | |
| FIND / SEARCH | Start (1) | |
| SUBSTITUTE | Instance (every one) | |
| REPLACE | Start, Num chars (#SYNTAX!) | |
| Regex | Occurrence (0, every one) | |
| Fuzzy Match | Threshold (0.6) | |
| Get Row | | Row (#SYNTAX!) |
| Head | Rows (10), To (to the end) | |
| Window | N (3) | Order by, Value (column references) |
| Get Column, Frame Sort, Join, Split Column, Replace Values, Unnest, Cube Rollup, Reconcile, Earned Value | | not swept: column references |
| Add Index | Start (1) | |
| Table Reshape (WRAPROWS / WRAPCOLS) | Wrap count (#SYNTAX!) | |
| Set Cell | | Row n, Column n (#SYNTAX!) |
| MUNIT card | Size n (#SYNTAX!) | |
| Spectrum | Sample rate (1) | |
| Smooth | Window (5), Order (2) | |
| ODE Integrate | Steps (100) | |
| Decompose | Period (#SYNTAX!) | |
| K-Means | Clusters (#SYNTAX!) | |
| List Filter (and Frame Filter, SUMIFS) | Each condition's value: blank keeps every row (overturns [[C24]]'s blank-filter consequence) | |
