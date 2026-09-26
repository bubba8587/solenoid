# Settings sweep: the audit for review

The list the backlog item "The settings sweep" asked for before any behavior changes ([[D86]] blankRoles, [[input-roles]]).
It proposes a role for every formula argument and card socket that looks like a setting or a pick; everything not listed
stays data (a blank stays blank). Nothing here is built. Mark a row wrong and it changes before the sweep lands; once the
sweep is done this file moves to `archive/`.

How to read a row: **setting, blank = omitted** means a blank reads as Excel's omitted argument (the function's default);
**blank = #SYNTAX!** means Excel requires it and there is no default; **pick** means a position, dropped when blank.

## Judgment calls

These are not obvious from the name, so each needs the author's word:

- **LARGE** and **SMALL**'s `k`: which rank to take. A pick (a list of ranks drops its blanks) or a required setting?
- **CLAMP**'s `min` and `max`: a blank bound read as no bound, so the value passes on that side.
- **FILTER**'s `if_empty`: what to show when nothing passes; a setting read as left out means an empty answer.
- **`alpha`** in GAMMA.DIST / GAMMA.INV, BETA.DIST / BETA.INV and WEIBULL.DIST is a shape of the distribution; in
  CONFIDENCE.NORM / CONFIDENCE.T and BINOM.INV it is a probability. Required setting (`#SYNTAX!` when blank) or data
  (a blank answer)? The proposal is required setting for all eight.
- **Date "start" arguments** (DATEDIF, DAYS, YEARFRAC, NETWORKDAYS, WORKDAY, DAYS360 and the .INTL pair) are left as data:
  a blank date is a missing date, so the answer is blank.
- **Generators' start and step** (LINSPACE, GEOMETRIC, RANGE, SEQUENCE) are listed as settings, since the function has no
  other input to work on.
- **Card-only defaults.** A card's typed default can differ from Excel's omitted reading (the Round card's digits type 0,
  Excel's ROUND requires them). The sweep reads a blank as the formula's reading, not the card's typed value, per D86.

## Formula functions

Already declared (not listed): TAKE, DROP, EXPAND, INDEX, ROUND(UP/DOWN), CHOOSEROWS/COLS, SORT, SORTBY, UNIQUE, TEXTJOIN,
XMATCH, XLOOKUP, TEXTSPLIT, TEXTAFTER, TEXTBEFORE. Generated from the signature hints (`formulaSignatures.ts`), then
pruned by hand.

| Function | Proposed roles |
|---|---|
| CHOOSE | `index` (pick; blank = #SYNTAX!) |
| LOG | `base` (setting; blank = omitted) |
| TRUNC | `digits` (setting; blank = omitted) |
| MROUND | `multiple` (setting; blank = #SYNTAX!) |
| CEILING | `significance` (setting; blank = #SYNTAX!) |
| FLOOR | `significance` (setting; blank = #SYNTAX!) |
| RANK | `order` (setting; blank = omitted) |
| PERCENTILE | `k` (setting; blank = #SYNTAX!) |
| PERCENTRANK | `significance` (setting; blank = omitted) |
| RANDDIST | `n` (setting; blank = #SYNTAX!) |
| NORM.DIST | `cumulative` (setting; blank = #SYNTAX!) |
| NORM.S.DIST | `cumulative` (setting; blank = #SYNTAX!) |
| T.DIST | `cumulative` (setting; blank = #SYNTAX!) |
| CHISQ.DIST | `cumulative` (setting; blank = #SYNTAX!) |
| F.DIST | `cumulative` (setting; blank = #SYNTAX!) |
| BINOM.DIST | `cumulative` (setting; blank = #SYNTAX!) |
| POISSON.DIST | `cumulative` (setting; blank = #SYNTAX!) |
| EXPON.DIST | `cumulative` (setting; blank = #SYNTAX!) |
| LEFT | `count` (setting; blank = omitted) |
| RIGHT | `count` (setting; blank = omitted) |
| MID | `start` (setting; blank = #SYNTAX!), `count` (setting; blank = #SYNTAX!) |
| REPLACE | `start` (setting; blank = #SYNTAX!), `count` (setting; blank = #SYNTAX!) |
| FIND | `start` (setting; blank = omitted) |
| SEARCH | `start` (setting; blank = omitted) |
| TEXT | `format` (setting; blank = #SYNTAX!) |
| REPT | `count` (setting; blank = #SYNTAX!) |
| DATEDIF | `unit` (setting; blank = #SYNTAX!) |
| WEEKDAY | `type` (setting; blank = omitted) |
| WEEKNUM | `type` (setting; blank = omitted) |
| YEARFRAC | `basis` (setting; blank = omitted) |
| PMT | `type` (setting; blank = omitted) |
| PV | `type` (setting; blank = omitted) |
| FV | `type` (setting; blank = omitted) |
| NPER | `type` (setting; blank = omitted) |
| RATE | `type` (setting; blank = omitted), `guess` (setting; blank = omitted) |
| IPMT | `type` (setting; blank = omitted) |
| PPMT | `type` (setting; blank = omitted) |
| IRR | `guess` (setting; blank = omitted) |
| XIRR | `guess` (setting; blank = omitted) |
| DDB | `factor` (setting; blank = omitted) |
| REGEXEXTRACT | `return_mode` (setting; blank = omitted) |
| COUPDAYBS | `frequency` (setting; blank = omitted), `basis` (setting; blank = omitted) |
| COUPDAYSNC | `frequency` (setting; blank = omitted), `basis` (setting; blank = omitted) |
| COUPNUM | `frequency` (setting; blank = omitted), `basis` (setting; blank = omitted) |
| COUPNCD | `frequency` (setting; blank = omitted), `basis` (setting; blank = omitted) |
| COUPPCD | `frequency` (setting; blank = omitted), `basis` (setting; blank = omitted) |
| ACCRINTM | `basis` (setting; blank = omitted) |
| INTRATE | `basis` (setting; blank = omitted) |
| RECEIVED | `basis` (setting; blank = omitted) |
| YIELDDISC | `basis` (setting; blank = omitted) |
| PRICEMAT | `basis` (setting; blank = omitted) |
| YIELDMAT | `basis` (setting; blank = omitted) |
| DURATION | `frequency` (setting; blank = omitted), `basis` (setting; blank = omitted) |
| MDURATION | `frequency` (setting; blank = omitted), `basis` (setting; blank = omitted) |
| PRICE | `frequency` (setting; blank = omitted) |
| YIELD | `frequency` (setting; blank = omitted) |
| VDB | `factor` (setting; blank = omitted) |
| ODDFPRICE | `frequency` (setting; blank = omitted) |
| ODDFYIELD | `frequency` (setting; blank = omitted) |
| ODDLPRICE | `frequency` (setting; blank = omitted) |
| ODDLYIELD | `frequency` (setting; blank = omitted) |
| CONVERT | `from_unit` (setting; blank = #SYNTAX!), `to_unit` (setting; blank = #SYNTAX!) |
| VALUETOTEXT | `format` (setting; blank = omitted) |
| SLUGIFY | `separator` (setting; blank = omitted) |
| PADTEXT | `width` (setting; blank = #SYNTAX!) |
| TRUNCATETEXT | `width` (setting; blank = #SYNTAX!) |
| WRAPTEXT | `width` (setting; blank = #SYNTAX!) |
| SAVGOL | `window` (setting; blank = #SYNTAX!), `order` (setting; blank = #SYNTAX!) |
| CAGR | `periods_per_year` (setting; blank = omitted) |
| VOLATILITY | `periods_per_year` (setting; blank = omitted) |
| SHARPE | `periods_per_year` (setting; blank = omitted) |
| SORTINO | `periods_per_year` (setting; blank = omitted) |
| DOLLAR | `decimals` (setting; blank = omitted) |
| RANK.EQ | `order` (setting; blank = omitted) |
| RANK.AVG | `order` (setting; blank = omitted) |
| T.TEST | `tails` (setting; blank = #SYNTAX!), `type` (setting; blank = #SYNTAX!) |
| GAMMA.DIST | `cumulative` (setting; blank = #SYNTAX!) |
| WRAPROWS | `wrap_count` (setting; blank = #SYNTAX!), `pad_with` (setting; blank = omitted) |
| WRAPCOLS | `wrap_count` (setting; blank = #SYNTAX!), `pad_with` (setting; blank = omitted) |
| TOCOL | `ignore` (setting; blank = omitted), `scan_by_column` (setting; blank = omitted) |
| TOROW | `ignore` (setting; blank = omitted), `scan_by_column` (setting; blank = omitted) |
| SEQUENCE | `rows` (setting; blank = #SYNTAX!), `columns` (setting; blank = omitted), `start` (setting; blank = omitted), `step` (setting; blank = omitted) |
| RANDARRAY | `rows` (setting; blank = omitted), `columns` (setting; blank = omitted), `min` (setting; blank = omitted), `max` (setting; blank = omitted), `whole_number` (setting; blank = omitted) |
| MAKEARRAY | `rows` (setting; blank = #SYNTAX!), `columns` (setting; blank = #SYNTAX!) |
| SLICE | `start` (setting; blank = #SYNTAX!) |
| NTHELEMENT | `n` (setting; blank = #SYNTAX!) |
| PADRIGHT | `length` (setting; blank = #SYNTAX!) |
| PADLEFT | `length` (setting; blank = #SYNTAX!) |
| SIMILARITY | `method` (setting; blank = omitted) |
| FUZZYMATCH | `method` (setting; blank = omitted) |
| SPARKLINE | `type` (setting; blank = omitted) |
| COMBINATIONS | `k` (setting; blank = #SYNTAX!) |
| PERMUTATIONS | `k` (setting; blank = #SYNTAX!) |
| EWMA | `alpha` (setting; blank = #SYNTAX!) |
| POLYFIT | `degree` (setting; blank = #SYNTAX!) |
| ISOUTLIER | `method` (setting; blank = omitted) |
| FROMEPOCH | `unit` (setting; blank = omitted) |
| TOEPOCH | `unit` (setting; blank = omitted) |
| DATETRUNC | `unit` (setting; blank = #SYNTAX!) |
| RUNNING | `window` (setting; blank = omitted) |
| LINSPACE | `start` (setting; blank = #SYNTAX!), `count` (setting; blank = #SYNTAX!) |
| REPEAT | `count` (setting; blank = #SYNTAX!) |
| GEOMETRIC | `start` (setting; blank = #SYNTAX!), `count` (setting; blank = #SYNTAX!) |
| FIBONACCI | `count` (setting; blank = #SYNTAX!) |
| RANGE | `start` (setting; blank = #SYNTAX!), `step` (setting; blank = omitted) |
| CEILING.MATH | `significance` (setting; blank = omitted), `mode` (setting; blank = omitted) |
| FLOOR.MATH | `significance` (setting; blank = omitted), `mode` (setting; blank = omitted) |
| BASE | `radix` (setting; blank = #SYNTAX!) |
| DECIMAL | `radix` (setting; blank = #SYNTAX!) |
| BESSELI | `n` (setting; blank = #SYNTAX!) |
| BESSELJ | `n` (setting; blank = #SYNTAX!) |
| BESSELK | `n` (setting; blank = #SYNTAX!) |
| BESSELY | `n` (setting; blank = #SYNTAX!) |
| BIN2HEX | `places` (setting; blank = omitted) |
| BIN2OCT | `places` (setting; blank = omitted) |
| DEC2BIN | `places` (setting; blank = omitted) |
| DEC2HEX | `places` (setting; blank = omitted) |
| DEC2OCT | `places` (setting; blank = omitted) |
| HEX2BIN | `places` (setting; blank = omitted) |
| HEX2OCT | `places` (setting; blank = omitted) |
| OCT2BIN | `places` (setting; blank = omitted) |
| OCT2HEX | `places` (setting; blank = omitted) |
| GESTEP | `step` (setting; blank = omitted) |
| PERCENTILE.EXC | `k` (setting; blank = #SYNTAX!) |
| PERCENTILE.INC | `k` (setting; blank = #SYNTAX!) |
| PERCENTRANK.EXC | `significance` (setting; blank = omitted) |
| PERCENTRANK.INC | `significance` (setting; blank = omitted) |
| BETA.DIST | `cumulative` (setting; blank = #SYNTAX!) |
| HYPGEOM.DIST | `cumulative` (setting; blank = #SYNTAX!) |
| LOGNORM.DIST | `cumulative` (setting; blank = #SYNTAX!) |
| NEGBINOM.DIST | `cumulative` (setting; blank = #SYNTAX!) |
| WEIBULL.DIST | `cumulative` (setting; blank = #SYNTAX!) |
| FIXED | `decimals` (setting; blank = omitted) |
| DAYS360 | `method` (setting; blank = omitted) |
| NETWORKDAYS.INTL | `weekend` (setting; blank = omitted) |
| WORKDAY.INTL | `weekend` (setting; blank = omitted) |
| ACCRINT | `frequency` (setting; blank = #SYNTAX!), `basis` (setting; blank = omitted) |
| COUPDAYS | `frequency` (setting; blank = omitted), `basis` (setting; blank = omitted) |
| CUMIPMT | `type` (setting; blank = #SYNTAX!) |
| CUMPRINC | `type` (setting; blank = #SYNTAX!) |
| DISC | `basis` (setting; blank = omitted) |
| PRICEDISC | `basis` (setting; blank = omitted) |

## Card sockets

Sockets with a typed field that look like settings. A card that is its formula's twin takes the formula's roles through
`rolesFrom`; the rest declare their own.

| Card | Proposed settings (default when blank) | Proposed picks / column references |
|---|---|---|
| Histogram | Bins (10) | |
| Gantt, Schedule, Earned Value, WORKDAY / NETWORKDAYS | Weekend (1) | |
| Schedule | Hours per day (8) | |
| Record | | Row (1) |
| Slider | Min, Max, Step: the bound the widget needs ([[input-roles]] control row) | |
| Alert | Low, High (no bound) | |
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
| LARGE / SMALL card | | K (see Judgment calls) |
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
| Get Column, Frame Sort, Join, Split Column, Replace Values, Unnest, Cube Rollup, Reconcile, Earned Value | | Column references ([[input-roles]] marks them setting or required; each needs a call: pass the Frame through, or #SYNTAX!) |
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
