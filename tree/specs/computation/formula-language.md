---
aliases: ["Formula language and evaluator"]
tags: [spec, computation]
---
<!-- [[B16]] oneFormulaSurface, [[C14]] currentExcelParity, [[D25]] blockedFailFast, [[C15]] matricesInFormulas, [[D26]] hideMatrixFromVendor, [[D27]] oneBroadcast, [[C17]] shareImpl, [[D19]] implReteFree, [[D20]] declareContract, [[D51]] oneAnswerOneDivergence, [[C18]] uniqueNameMap, [[C20]] wholeArrayArgs, [[D24]] prepByShape, [[C21]] matchNodeLimits, [[C45]] excelComparisons, [[C46]] consistencyOverQuirks, [[C50]] lambdaBindsByName, [[C51]] formulaNaming, [[C80]] blankArgIsExcelBlank -->

# Spec: Formula language and evaluator

Serves [[B16]] oneFormulaSurface, with its subtree: [[C14]] currentExcelParity, [[D25]] blockedFailFast, [[C15]] matricesInFormulas, [[D26]] hideMatrixFromVendor, [[D27]] oneBroadcast, [[C17]] shareImpl, [[D19]] implReteFree, [[D20]] declareContract, [[D51]] oneAnswerOneDivergence, [[C18]] uniqueNameMap, [[C20]] wholeArrayArgs, [[D24]] prepByShape, [[C21]] matchNodeLimits, [[C45]] excelComparisons, [[C46]] consistencyOverQuirks, [[C50]] lambdaBindsByName, [[C51]] formulaNaming and [[C80]] blankArgIsExcelBlank. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

The per-name reasons Solenoid overrides a Formula.js function are [[formulajs-divergences]]; this spec does not repeat them. Computed-column name resolution is [[computed-columns]]. The Equation node's symbolic rearrangement of the same AST is [[equation-solver]]. The dimension pass that runs beside the numeric evaluator is [[unit-flow]].

## Files

| File | Owns |
|---|---|
| `src/graph/excelFormula.ts` | Tokenizer, parser, AST, the evaluator (`compileEvaluator`, `compilePositional`), argument routing and preparation, broadcasting (`mapCells`), the operator table (`applyOp`), the error-handler family, LAMBDA as a special form, static analyses (`extractVariables` and siblings), LaTeX rendering and the step trace. |
| `src/graph/excelFunctions.ts` | The function registry (`registerInternal`, `resolveExcelFunction`), the declared contracts (`EXCEL_IMPL_META`), the Formula.js fallthrough and its error mapping, the blocklist (`LEGACY_ALIASES`), the wrong-surface names (`FRAME_SURFACE_NAMES`, `NODE_SURFACE_NAMES`), and every internal registration, including the LAMBDA hosts. |
| `src/graph/formulaSignatures.ts` | Display-only argument hints per function name. |
| `src/graph/formulaExtensions.ts` | Pack formula registration and the advertised (autocomplete) name set. |
| `src/graph/formulaSyntax.ts` | Editor highlighting, caret word, suggestions, enclosing-call detection. |
| `src/graph/lambdaValue.ts` | The `LambdaValue` shape and `isLambdaValue`. |
| `src/graph/nodeExcel.ts` | `NODE_EXCEL` (catalog node type to its Excel equivalents, with `parity` and a note) and `EXCEL_GAP` (Excel functions with no node, flagged out of scope or superseded). The Function Reference and catalog read them; the evaluator does not. |
| `src/graph/nodes/expression.ts` | The Expression node. |
| `src/graph/nodes/lambda.ts` | The LAMBDA node, which emits a `LambdaValue`. |
| `src/graph/nodes/tableLambda.ts` | The MAP, BYROW, BYCOL, REDUCE, SCAN and MAKEARRAY nodes and `resolveFn`, their wired-LAMBDA binding. |

Every module the formula path imports is rete-free ([[D19]] implReteFree). `formulaPathIsReteFree.test.ts` pins it.

## Lexical grammar

`tokenize(src)` scans left to right and returns a token list, or null (a syntax error) on the first character it cannot place. Whitespace (space, tab, newline, carriage return) separates tokens and is otherwise ignored.

| Token | Form | Notes |
|---|---|---|
| number | a digit, or `.` followed by a digit; then any run of digits and dots; then optionally `e` or `E`, an optional sign, and digits | The run must be one well-formed number (digits with at most one decimal point, and digits after any exponent), or the formula is a syntax error: `1.2.3` and `2e` do not parse. No thousands separators, hex or leading sign (a sign is the unary operator). |
| string | `"` up to the next `"` | No escapes. A doubled quote is not an embedded quote: `"a""b"` is two adjacent strings, which is a syntax error. An unterminated string is a syntax error. Single quotes are not string delimiters. |
| name | starts with `A`-`Z`, `a`-`z`, `_` or `λ`; continues with those or digits; a `.` is consumed only when an identifier character follows it | So `NORM.S.DIST` and `STDEV.S` are one name, and a trailing dot is not part of the name. Only ASCII letters and `λ` are letters; `é` is an unknown character. `λ` exists so a wired LAMBDA socket's name (`λ1`) can be typed. |
| operator | `<>`, `<=`, `>=` (two characters, matched first), then any of `+ - * / ^ % & = < > @` | |
| paren | `(` or `)` | |
| comma | `,` | The only argument separator. |
| column reference | `[` text `]` | Whole-column reference. The text is everything up to the first `]`, trimmed; it cannot contain `]`. Empty text is a syntax error. |
| row reference | `[@` text `]`, or `[@[` text `]]` | This-row reference. The inner bracket form lets the text hold characters a name cannot. |

Anything else (`{`, `}`, `;`, `#`, `'`, `!`, `:`, `$`) is an unknown character, so the formula is a syntax error. There are no error literals, no array literals and no cell references. `A1` is an ordinary name.

`TRUE` and `FALSE` are names at the token level. The parser turns a bare `TRUE` or `FALSE` (any case, not followed by `(`) into a logical literal.

## Syntax

The parser is recursive descent over the token list. A formula is one expression that consumes every token; anything left over is a syntax error. An empty or all-whitespace formula does not parse.

Precedence, loosest first. Every binary level is left-associative, including `^` (so `2^3^2` is 64, as in Excel).

| Level | Operators | Form |
|---|---|---|
| 1 comparison | `=` `<>` `<` `>` `<=` `>=` | binary; chains left to right, so `1<2<3` is `(1<2)<3` |
| 2 concatenation | `&` | binary |
| 3 additive | `+` `-` | binary |
| 4 multiplicative | `*` `/` | binary |
| 5 exponent | `^` | binary |
| 6 percent | `%` | postfix, repeatable (`50%%` is 0.005) |
| 7 unary | `-` `+` | prefix, repeatable |
| 8 primary | literals, names, calls, references, `( expr )`, postfix application | |

Unary binds tighter than `^`, so `-2^2` is `(-2)^2` = 4, and `-x^2` is `(-x)^2`, both Excel's reading. Percent binds looser than unary: `-50%` is `(-50)%`.

Primaries:

| Source | AST node |
|---|---|
| number token | `{ t: "num", v }` (the raw text; evaluated with `Number`) |
| string token | `{ t: "str", v }` |
| bare `TRUE` / `FALSE` | `{ t: "bool", v }` |
| bare name | `{ t: "name", name }` |
| name `(` args `)` | `{ t: "call", name, args }` |
| `@` name, or `@` `[Name]` | `{ t: "atcol", name }` (this-row reference) |
| `[@Name]`, `[@[Name]]` | `{ t: "atcol", name }` |
| `[Name]` | `{ t: "wholecol", name }` (whole-column reference) |
| `(` expr `)` | the inner expression |
| primary `(` args `)` | `{ t: "apply", fn, args }`, repeatable: `LAMBDA(x, x+1)(5)`, `f(2)(3)` |

A name immediately followed by `(` is a call, never an application; application applies to any other complete primary, including a call's result. `@` must be followed by a name or a `[Name]`; anything else is a syntax error.

Argument lists: `(` then zero or more slots separated by commas, then `)`. `F()` has no arguments. A slot that is empty, because a comma or the closing paren sits where an expression should start, is `{ t: "blank" }`: `IF(x,,y)` has three arguments, the middle one blank; `F(a,)` has two; `F(,)` has two blanks.

`parseFormula` exports the AST (null on a syntax error); `equationSolve.ts` and `unitDimExpr.ts` walk it.

### Syntax hints

`formulaSyntaxHint(expr)` explains a failed parse, or answers null when nothing recognizable is wrong. String literals are blanked first so their contents cannot trigger a hint. Checks run in this order and the first hit wins:

1. braces anywhere: array literals aren't supported, wire a List or Table instead;
2. a leading `=`: drop it;
3. a `;`: use commas;
4. unbalanced `[` and `]`;
5. more `(` than `)`, naming the count; or more `)` than `(`;
6. a trailing operator or comma: the formula ends mid-expression.

## Names

A bare name (`{ t: "name" }`) resolves, in order:

1. **Constant.** `pi`, `tau` (2π), `e` and `phi` (the golden ratio), matched case-insensitively (`FORMULA_CONSTANTS`). A constant wins over a variable, but a LAMBDA parameter shadows it inside that LAMBDA's body: `LAMBDA(e, e+1)(5)` is 6. A constant is never a variable, so a formula cannot have a variable named `e`, `E`, `pi` or `PI`.
2. **Environment.** `env[name]`, case-sensitive. In the Expression node every non-constant bare name is a variable with a socket, so it is always bound (see *The Expression node*). A name the environment lacks evaluates to `undefined`.

Function names in call position are case-insensitive and resolve through the registry (see *Calls*). A variable never shadows a function, and a function never shadows a variable: `SUM` bare is a variable named `SUM`, `SUM(…)` is the function. The one crossover is a call whose raw name is bound in the environment to a `LambdaValue`, which applies that lambda.

`@name`, `@[Name]`, `[@Name]` and `[Name]` read a computed column's row context. Outside one they answer `#REF!` ("@ reads the current row, so it only works inside a computed column", or the whole-column wording for `[Name]`). They are never variables: `extractVariables` skips them, so they never grow a socket.

## Calls

### The registry

`registerInternal(name, fn)` stores an implementation under the uppercased name. A second registration of a live name throws ([[C18]] uniqueNameMap's registry half). `unregisterInternal` withdraws one, and only packs use it. Each registration or withdrawal bumps `registryGeneration()`, which the derived name lists memoize against, because packs register after module load.

`resolveExcelFunction(name)` uppercases the name, returns the internal implementation if one exists, and otherwise walks Formula.js's export object by the dotted path (`NORM.S.DIST` is `FX.NORM.S.DIST`). Both functions and plain objects are walkable containers, since Formula.js hangs `.MATH`, `.PRECISE`, `.INTL` and `.TEST` off callable parents. The result is null when neither has the name. An internal registration therefore always wins over Formula.js.

`EXCEL_IMPL_META[name]` declares a registration's contract ([[D20]] declareContract):

| Field | Meaning |
|---|---|
| `returns` | element type: `number`, `string`, `logical`, `date`, `complex`, or `any` (passes through whatever its arguments carry) |
| `rank` | `scalar` (default), `list` or `matrix` |
| `listArgs` | whole-list native: arguments arrive exactly as they are, skipping the range preparation |
| `matrixArgs` | the only way a matrix reaches the implementation whole |
| `cxArgs` | the only way a complex value reaches the implementation |
| `arity` | `[min, max]`; a max of 255 or more means variadic |
| `family` | a `FuncFamily` label |
| `native` | Solenoid-only, no Formula.js equivalent |

`arity` is not enforced at evaluation. It feeds the signature hints and the tests; an implementation handles missing or extra arguments itself. `returns: "date"` is read by `exprYieldsDate`. The routing reads `listArgs`, `matrixArgs` and `cxArgs`.

`FUNCTION_FAMILY` and `FAMILY_BACKING` record, for names that exist both as a node and in Formula.js, whether the family is backed internally, by Formula.js, or awaits verification. They are documentation data; `excelFunctionInfo(name)` reads them, and the evaluator does not.

The core registers every internal function at module load. The node and the formula call the same kernel ([[C17]] shareImpl). A generator that a formula can reach (SEQUENCE, RANDARRAY, MAKEARRAY and the list generators) checks `MAX_GENERATED` (1,000,000 elements, from `nodes/listOps.ts`, the constant the nodes use) and answers `#OVERFLOW!` past it ([[C21]] matchNodeLimits).

### Blocked and wrong-surface names

Three tables name functions a formula refuses. Each refusal happens before any argument is evaluated, so a blocked name over a list answers one error, never a list of them ([[D25]] blockedFailFast).

| Table | Answer | Examples |
|---|---|---|
| `LEGACY_ALIASES` (the blocklist, [[C14]] currentExcelParity) | `#NAME?` "Use {replacement}" | `VLOOKUP`, `HLOOKUP`, `LOOKUP` to `XLOOKUP`; `MATCH` to `XMATCH`; the D* database family to its aggregate; the pre-2010 statistics spellings (`NORMDIST`, `STDEVP`, `TDIST`); the undotted spellings of dotted names (`STDEVS`, `PERCENTILEINC`); `CEILING.PRECISE`, `FLOOR.PRECISE`, `ISO.CEILING`; `SUBTOTAL`, `AGGREGATE` to `SUM`; `COLUMN`, `ROW` to `INDEX`; `SUMIF` to `SUMIFS` |
| `FRAME_SURFACE_NAMES` ([[C15]] matricesInFormulas) | `#TYPE!` "Frames don't flow through formulas, use the {node} node, or a Computed Column for row math" | `BUILDFRAME`, `JOIN`, `FRAMEFILTER`, `PIVOTBY`, `UNPIVOT`, `KMEANS`, `SETCELL` |
| `NODE_SURFACE_NAMES` | `#NAME?` "Use the {node} node" | `TEXTFILTER` to List Filter |

`ELIMINATED_FUNCTIONS` is the set of `LEGACY_ALIASES` keys, derived, never kept by hand. Each blocked name is also registered as an internal stub answering the same `#NAME?`, so a direct `resolveExcelFunction` caller (a node) gets the redirect instead of Formula.js's implementation. Blocked names are removed from `RANGE_FUNCTIONS` and `RANGE_POSITIONAL` at module load and filtered out of every advertised list.

`formulaFunctionNames()` is every dispatchable name, uppercase and sorted: Formula.js's flat and dotted names (walked to depth two, skipping `FX.utils`), every `EXCEL_IMPL_META` key and every internal registration, minus `ELIMINATED_FUNCTIONS`.

### Packs

`initPackFormulas()` registers every known pack's formulas, active or not, with `registerInternal`, and writes an `EXCEL_IMPL_META` entry (`returns`, `arity`, `native: true`, and `rank` and `listArgs` when declared). A pack name that collides with a core name (snapshotted on the first call) or with another pack's throws at startup. A re-run first withdraws the previous run's registrations. A pack's functions always resolve, so a saved formula keeps computing with the pack off; `advertisedFunctionNames()` hides an inactive pack's names from the editor ([[C51]] formulaNaming).

### The dispatch ladder

Evaluating `{ t: "call", name, args }` uppercases the name and takes the first matching step:

1. **Lambda binding.** If `env[rawName]` (case-sensitive) is a `LambdaValue`, evaluate the arguments, return the first `SolError` among them, answer `#VALUE!` "{name} takes N arguments, not M" when the lambda declares parameters and the count differs, and otherwise call it.
2. **LAMBDA.** The special form (see *LAMBDA*).
3. **Blocked.** `LEGACY_ALIASES`, then `FRAME_SURFACE_NAMES`, then `NODE_SURFACE_NAMES`, as tabled above.
4. **Unknown.** No implementation resolves: `#NAME?` "Unknown function {NAME}".
5. **Evaluate arguments.** Each argument is evaluated. For a lambda host (`MAP`, `BYROW`, `BYCOL`, `REDUCE`, `SCAN`, `GROUPBY`) a bare dispatchable name eta-expands instead (see *LAMBDA*).
6. **Typed blanks.** `excelBlanks` replaces blank slots with typed blanks where `BLANK_ARG_TYPES` declares them (see *Blank and omitted arguments*).
7. **Error handlers.** `IFERROR`, `IFNA`, `ISERROR`, `ISERR`, `ISNA` and `ERROR.TYPE` receive their arguments as they are (see *Error-handling functions*).
8. **Error propagation.** The first top-level argument that is a `SolError` is the answer. Errors inside a list are not hoisted here; each route decides.
9. **Matrix containment.** If any argument is a matrix and the function does not declare `matrixArgs`: a `RANGE_POSITIONAL` function answers `#SHAPE!`; a `RANGE_FUNCTIONS` member flattens each matrix row-major and continues; a whole-list native, or a name with no `EXCEL_IMPL_META` entry and no internal registration (a Formula.js-only name), answers one `#SHAPE!` "{NAME} works on values and 1-D lists, not a 2-D matrix"; an internally registered element-wise function continues to the broadcast ([[D26]] hideMatrixFromVendor).
10. **Complex containment.** If any argument is or contains a complex value and the function declares no `cxArgs`, is not in `NULL_INSPECTING` and is not a whole-list native: `#TYPE!` "{NAME} doesn't compute on complex numbers, use the IM* family".
11. **Route.** Whole-list native, else range function, else broadcast (see *Argument routing*).

## Blank and omitted arguments

A blank slot evaluates to `null`, the first-class missing value. An omitted trailing argument is absent, so the implementation receives `undefined`. Implementations read `undefined` as "use the default" and never treat `null` as omitted ([[C80]] blankArgIsExcelBlank).

`BLANK_ARG_TYPES` declares, per function and zero-based parameter index, the Excel type of a blank slot; `excelBlanks` substitutes that type's blank (number 0, logical FALSE, text "") at step 6, for internal and Formula.js implementations alike. Only a slot that was syntactically blank is substituted; a variable that happens to be null is not.

| Function | Parameter | Blank reads as |
|---|---|---|
| `TEXTJOIN` | 1 (`ignore_empty`) | FALSE |
| `XMATCH` | 2 (`match_mode`), 3 (`search_mode`) | 0 |
| `XLOOKUP` | 4 (`match_mode`), 5 (`search_mode`) | 0 |

So `TEXTJOIN(",",,"a","","b")` is `a,,b`, and `XMATCH(7, x, )` is an exact match. A blank `search_mode` becomes 0, which the implementation rejects as Excel does. Every other blank stays `null` and follows the route's missing-value rules. `IF(x,,y)` returns `null` for a true `x`, not 0.

## Argument routing

A dispatched call takes exactly one of three routes, chosen by the function's declaration ([[C20]] wholeArrayArgs).

### Whole-list natives

A function whose `EXCEL_IMPL_META` entry has `listArgs: true` (and is not blocked) receives every argument unchanged: nulls stay in place and cell errors stay where they are, because these functions preserve positions (`REVERSE([1, null, 3])` is `[3, null, 1]`). A list-returning function with scalar arguments (SEQUENCE, QUADRATICROOTS) is declared the same way so it is never broadcast. Before dispatch, a top-level `null` scalar argument makes the answer `null` (a blank scalar is unknown, not 0), except for the names in `NULLABLE_SCALARS_OK`, whose registrations decide blank by blank: `FILLVALUE`, `COALESCE`, the matrix and array-shaping functions (`SEQUENCE`, `WRAPROWS`, `WRAPCOLS`, `MMULT`, `MDETERM`, `MINVERSE`, `TRANSPOSE`, `MUNIT`, `TOCOL`, `TOROW`, `UNIQUE`, `SORT`, `SORTBY`, `FILTER`, `TAKE`, `DROP`, `MODE.MULT`, `FREQUENCY`, `RANDARRAY`, `RANDDIST`, `INTERPOLATE`, `HSTACK`, `VSTACK`, `CHOOSECOLS`, `CHOOSEROWS`, `EXPAND`), the lambda hosts (`MAP`, `BYROW`, `BYCOL`, `REDUCE`, `SCAN`, `MAKEARRAY`, `GROUPBY`), the regression quartet (`TREND`, `GROWTH`, `LINEST`, `LOGEST`) and the criteria family (`SUMIFS`, `COUNTIFS`, `AVERAGEIFS`, `MINIFS`, `MAXIFS`, `COUNTIF`, `AVERAGEIF`).

`INDEX` declares `listArgs`, so it takes this route even though it is also listed in `RANGE_FUNCTIONS` and `RANGE_POSITIONAL`.

### Range functions

`RANGE_FUNCTIONS` lists the functions whose signature takes a range: the aggregates (`SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, the STDEV and VAR families, `MEDIAN`, `LARGE`, `PERCENTILE`, `RANK` and the rest), `GCD`, `LCM`, `MULTINOMIAL`, the workday functions (their holiday list), the correlation and regression pairs, `AND`, `OR`, `XOR`, `TEXTJOIN`, `CONCAT`, the criteria aggregates, `NPV`, `XNPV`, the lookups, the statistical tests and the pairwise sums. An argument that is a list arrives as one list; nothing is called per element.

Before dispatch, `prepRangeArgs` applies the function's null and error policy ([[D24]] prepByShape). The policies are checked in this order:

| Policy | Members | Errors | Nulls |
|---|---|---|---|
| `RANGE_RAW` | `COUNT`, `COUNTA`, `COUNTBLANK`, and the criteria family `SUMIF(S)`, `COUNTIF(S)`, `AVERAGEIF(S)`, `MAXIFS`, `MINIFS` | untouched; the function classifies them (COUNT skips errors, COUNTA counts them) | untouched (COUNTBLANK counts them; a blank criterion matches a blank cell) |
| `RANGE_POSITIONAL` | `XLOOKUP`, `XMATCH`, `INDEX` | untouched, so an error at a position the lookup never reads cannot poison it | untouched, so positions do not shift |
| `RANGE_ZERO_FILL` | `SERIESSUM`, `NPV` | the first cell error in any list argument is the answer | each null becomes 0 in place |
| `RANGE_PAIRED` | `SUMPRODUCT`, `CORREL`, `SPEARMAN`, `KENDALL`, `WILCOXON`, `COVAR`, `COVARIANCE.P`, `COVARIANCE.S`, `SLOPE`, `INTERCEPT`, `RSQ`, `STEYX`, `FORECAST.LINEAR`, `XNPV`, `SUMX2MY2`, `SUMX2PY2`, `SUMXMY2`, `CHISQ.TEST`, `PROB` | the first cell error is the answer | every list is cut to the shortest list's length, and an index where any list holds null is dropped from all of them |
| pooled (default) | every other range function, including `T.TEST` and `F.TEST` | the first cell error is the answer | each list drops its own nulls independently |

A Formula.js `Error` object found in a list counts as an error and is mapped with `fxErrorToSol`. Scalar arguments pass through every policy unchanged. The prepared lists are copied before dispatch because some Formula.js functions mutate their arguments. A numeric result passes `guardFinite` with every flattened input, so `SUM` over a list holding a first-class infinity still answers infinity.

So `AND(x)` over `[TRUE, null, TRUE]` is TRUE: a reduction skips nulls, while the operators and element-wise functions propagate them. That is the one sanctioned node-versus-formula split ([[D51]] oneAnswerOneDivergence).

### Broadcast

Every other function is element-wise. With no list or matrix argument it is called once with the scalars, under the same null rule as a cell: a blank value makes the answer blank unless the function is in `NULL_INSPECTING`. An empty argument slot is not a value, so the function still reads it (`ROUND(2.5, )` is 3). With at least one list argument, `mapCells` aligns the arguments (see *Broadcasting*) and calls the function per cell with this per-cell contract:

1. a `SolError` among the cell's operands is the cell's answer;
2. otherwise a `null` among them makes the cell `null`, unless the function is in `NULL_INSPECTING` (`ISBLANK`, `ISNUMBER`, `ISTEXT`, `ISNONTEXT`, `ISLOGICAL`, `ISBOOLEAN`, `ISREF`, `N`, `T`, `TYPE`, `IF`, `CHOOSE`), which sees the null;
3. otherwise the function runs, and a numeric result passes `guardFinite` against that call's arguments.

If every list argument is empty, the answer is `[]`.

## Broadcasting

`mapCells(argv, cellFn)` is the one broadcaster for every element-wise surface: binary operators, unary minus and plus, percent, and function broadcasting ([[D27]] oneBroadcast). It owns shape only; `cellFn` owns the per-cell meaning. The rules, as the B-table in `docs/archive/17-matrix-formulas.md` Part 2 states them and `tests/graph/broadcastRules.test.ts` transcribes row by row:

- A value nested deeper than a matrix (a matrix cell that is itself an array) answers one `#SHAPE!`.
- Each argument first collapses a singleton: a 1×1 matrix and a one-element list are their scalar, so `[5] + [1,2,3]` is `[6,7,8]` (B10, B11).
- The result rank is the highest argument rank.
- Rank 0: one call.
- Rank 1: scalars repeat; lists zip to the longest length; a position past the end of a shorter list yields `null` for that cell without calling `cellFn` (B2 to B4).
- Rank 2: the row count is the largest matrix row count. A list reads as one row and repeats down every row. A matrix with one row repeats down every row; a matrix whose every row has one cell repeats across every column. The column count is the largest of each matrix's width (1 for a single-column matrix) and each list's length. A cell any operand cannot supply is `null`, again without calling `cellFn` (B5 to B9).

Ragged element-wise math pads with `null`, never `#N/A`. Shape-building functions (VSTACK, HSTACK, WRAPROWS, WRAPCOLS) pad with `#N/A` inside their own implementations and never go through `mapCells` ([[C15]] matricesInFormulas).

## Scalar operators

`applyOp(op, a, b)` runs per cell. Checks in order: an error in `a`, then in `b`, is the answer; a `null` on either side answers `null`; a complex operand goes to the complex table; a `LambdaValue` operand answers `#TYPE!` ("A LAMBDA isn't a value…"). Otherwise logicals become 1 and 0 for the numeric operators and ordering, and:

| Operator | Result |
|---|---|
| `+` `-` `*` `^` | Arithmetic on the operands, then `guardFinite`. A text operand to any of these (and to `/`) is `#VALUE!` "Arithmetic needs numbers. Join text with &, or read a number from text with NUMBERVALUE" ([[D11]] noAutoCross). |
| `/` | `#DIV/0!` when the divisor is 0 and the dividend is a number; otherwise divide, then `guardFinite`. |
| `&` | Both sides as text: numbers through `numberToText`, logicals as `TRUE` and `FALSE`, strings as they are. `null & "a"` is `null`. |
| `=` `<>` | Two strings compare case-insensitively (`toLowerCase`, [[C45]] excelComparisons). Anything else compares with `===` after the logical bridge, so `5 = "5"` is FALSE and `TRUE = 1` is TRUE. |
| `<` `>` `<=` `>=` | Two numbers numerically; two strings by UTF-16 code unit (`compareStrings`, [[C59]] byteStringOrder), which is case-sensitive; any other pair `#TYPE!` "Cannot order values of different types; Cast one side first". |

`0^0` is 1, the JavaScript answer, not Excel's `#NUM!` ([[C46]] consistencyOverQuirks).

`numberToText(x)`: non-finite values use `String`; otherwise round to 15 significant digits and strip trailing zeros, so `(0.1+0.2) & "kg"` is `0.3kg`. Magnitudes of 1e21 or more, or nonzero below 1e-4, are written Excel's way: `1E+21`, `1E-07` (uppercase E, signed, at least two exponent digits).

Complex operands (`applyCxOp`): `&` formats the complex value with `formatCx`; `=` and `<>` are true only for two complex values with equal real and imaginary parts; ordering answers `#TYPE!` "Complex numbers have no order…"; arithmetic answers `#TYPE!` naming `IMSUM`, `IMSUB`, `IMPRODUCT` and `IMDIV`.

Unary `-` and `+` and postfix `%` run per cell through `mapCells` on a list or matrix, and directly on a scalar: an error passes, `null` stays `null`, a complex value answers `#TYPE!` (naming `IMSUB(0, z)` or `IMDIV(z, COMPLEX(100, 0))`), and otherwise the result is `-x`, `+x` or `x/100` with JavaScript coercion. These do not call `guardFinite`.

Evaluation is eager. Both operands of every operator and every argument of every call are evaluated before the operator or function runs, including `IF`'s branches.

## Numeric and vendor boundaries

`guardFinite(result, ...inputs)`: a finite result passes; NaN is `#DOMAIN!`; an infinite result is `#OVERFLOW!` unless some input was itself infinite, in which case the infinity passes (a first-class infinity from the Constant node). The operators, range dispatch, broadcast calls and eta calls apply it.

Formula.js reports failures as `Error` objects. Inside a formula they stay `Error`s (the error handlers recognize them). `fxErrorToSol` maps one to a `SolError` by the code in its message: `#DIV/0!`, `#N/A`, `#NAME?`, `#REF!`, `#VALUE!` keep their code, `#NULL!` becomes `#VALUE!`, `#NUM!` becomes `#DOMAIN!`, and anything unrecognized is `#VALUE!`. `normalizeFxResult` applies that to a top-level result.

`compileEvaluator(expr)` parses once and returns `(env) => value`, or null on a syntax error. The returned evaluator answers `#VALUE!` "LAMBDA needs arguments…" when the result is an unapplied `LambdaValue`, and otherwise returns `normalizeFxResult(result)`. Array results are returned as they are; each host cleans cells itself.

`compilePositional(expr, paramNames)` wraps `compileEvaluator` with positional binding: argument `i` binds to `paramNames[i]` in a fresh environment. The LAMBDA node and the table-lambda nodes use it.

## Error-handling functions

`IFERROR`, `IFNA`, `ISERROR`, `ISERR`, `ISNA` and `ERROR.TYPE` (`ERROR_HANDLER_FUNCTIONS`) are handled by `applyErrorHandler` before error propagation. An operand counts as an error when it is a `SolError` or a Formula.js `Error`. `IFNA` and `ISNA` catch only `#N/A`; `ISERR` catches everything except `#N/A`; the rest catch every error.

- `IFERROR(value, fallback)` and `IFNA`: a scalar value is replaced by the fallback when caught. A list or matrix is walked cell by cell; when the fallback is also a list, cell `i` uses fallback cell `i`. A missing fallback is `null`.
- `ISERROR`, `ISERR`, `ISNA`: TRUE or FALSE, walked cell by cell over lists and matrices.
- `ERROR.TYPE`: per element of a list, Excel's number for the code (`#DIV/0!` 2, `#VALUE!` 3, `#REF!` 4, `#NAME?` 5, `#N/A` 7, and 6 for `#NUM!` and the Solenoid codes that split it: `#DOMAIN!`, `#OVERFLOW!`, `#CONV!`); any other code is 3; a non-error answers `#N/A`.

## LAMBDA

### Syntax and evaluation

`LAMBDA(p1, …, pn, body)` is a special form: its arguments are not evaluated. With no arguments it answers `#VALUE!` "LAMBDA needs a body…". Every argument but the last must be a bare name, or it answers `#VALUE!` "LAMBDA parameters must be plain names". The value is a closure, `{ __lambda: true, params, fn, expr: "" }`: calling `fn(...args)` copies the defining environment, binds parameter `i` to argument `i` (a missing argument binds `undefined`) and evaluates the body. The closure captures the whole defining environment, so a body can read the formula's variables. A lambda can return a lambda.

A lambda is applied three ways:

- **Application** `(lambda)(args)`: the callee expression must evaluate to a `LambdaValue`, or the answer is `#VALUE!` "Only a LAMBDA can be called like a function". Arguments are evaluated with eta expansion; the first `SolError` argument is the answer; a lambda that declares parameters and receives a different count answers `#VALUE!` "This LAMBDA takes N arguments, not M".
- **By name**: a call whose name is bound to a lambda (a LAMBDA parameter, or a λ socket in a computed column) applies it, step 1 of the dispatch ladder.
- **A host function** calls `fn` directly.

A lambda is not a value the graph carries out of a formula: the top-level evaluator refuses one, and an operator given one answers `#TYPE!`. The `LAMBDA` name is also registered as an internal stub answering `#VALUE!` "Write LAMBDA inside the call that uses it…", so a direct registry caller gets an honest answer.

### Eta expansion

In an argument of `MAP`, `BYROW`, `BYCOL`, `REDUCE`, `SCAN` or `GROUPBY`, and in every argument of an application, a bare name that is not in the environment, is not a constant, and resolves to a function becomes an eta lambda: `{ params: [], eta: true, expr: name }`, whose `fn` dispatches that function and applies `guardFinite`. A host calls an eta lambda with only its meaningful arity (MAP with one array passes one value, not the row and column indices). `MAKEARRAY` is not an eta host, since its generator slot takes `(row, col)`. A variable of the same name wins over the function.

### Formula hosts

The hosts accept a list, a matrix or a scalar (read as a 1×1), and read a list as one row. Each requires a `LambdaValue` in its lambda slot, else `#VALUE!` "{HOST} needs a LAMBDA as its last argument". A `null` array argument answers `null`. The lambda receives these arguments positionally, Excel's binding:

| Host | Calls the lambda with | Result |
|---|---|---|
| `MAP(a1, [a2], [a3], λ)` | `(v1, v2, v3, row, col)`: each array's cell at that position (`null` past its edge, or when the array is absent), then 1-based indices | the largest row count by the largest row width; a list result when the first array was a list |
| `BYROW(a, λ)` | `(row as a list)` | a list, one value per row |
| `BYCOL(a, λ)` | `(column as a list)`, `null` for a short row | a list, one value per column |
| `REDUCE(init, a, λ)` | `(acc, value, step)`, row-major, `acc` starting at `init` (or `null`) | the final accumulator; a cell error, or an accumulator that becomes an error, stops the fold and is the answer |
| `SCAN(init, a, λ)` | as REDUCE | every intermediate accumulator in the input's shape; from the first error onward every cell is that error |
| `MAKEARRAY(rows, cols, λ)` | `(row, col)`, 1-based | a rows by cols matrix; one column reads as a list; a `null` dimension answers `null`; past `MAX_GENERATED` `#OVERFLOW!` |
| `GROUPBY(keys, values, λ)` | `(the group's values as a list)` | a two-column matrix `[key, result]`, groups in first-seen order, keyed by value (`setKey`) over the shorter list's length |

Arity is not checked by the hosts: missing parameters bind `null` from the host's tuple and extra host arguments are ignored.

### The LAMBDA node and wired lambdas

The LAMBDA node has a comma-separated `params` field and a body `expr`. Every name in the body that is not a parameter, together with every identifier-shaped `@name` (from `atColNames`), except the builtins `row` and `rows`, becomes a capture input socket. The node compiles the body with `compilePositional(expr, [...params, ...captures])` and emits `{ __lambda: true, params, fn, expr, captured, descriptions }`, where `fn(...args)` passes the first `params.length` arguments followed by the capture values resolved at compute time. An unchanged recompute returns the same object, since consumers memoize on identity. A parameter that is not an identifier answers `#NAME?`; a body that does not parse answers `#SYNTAX!` with the syntax hint; an empty body answers `null`.

A wired lambda reaching the MAP, BYROW, BYCOL, REDUCE, SCAN or MAKEARRAY node binds by parameter name, not position ([[C50]] lambdaBindsByName). Each node has fixed variable names (MAP `value`, `value2`, `value3`, `row`, `col`; BYROW and BYCOL `values`; REDUCE and SCAN `acc`, `value`, `step`; MAKEARRAY `row`, `col`). A parameter outside that set answers `#VALUE!` naming the node's variables. A captured name that matches one of the node's variables is flagged on the card as a likely missing parameter (`undeclaredConsumerVars`). Without a wired lambda, the node compiles its inline formula text over its fixed variables, and any other name answers `#NAME?`, pointing at the LAMBDA node. The formula hosts above bind positionally; only the node hosts bind by name.

## Errors a formula answers

| Code | When |
|---|---|
| `#SYNTAX!` | The formula does not parse (Expression and LAMBDA nodes). |
| `#NAME?` | Unknown function; a blocked spelling (naming its replacement); a node-only verb (naming its node). |
| `#TYPE!` | A Frame verb; ordering across types; any operator or undeclared function on a complex value; a lambda used as an operand. |
| `#SHAPE!` | A value deeper than a matrix; a matrix given to a whole-list native, a positional lookup without `matrixArgs`, or a Formula.js-only function. |
| `#VALUE!` | Applying a non-lambda; lambda arity mismatch; bad LAMBDA parameters or no body; an unapplied lambda as the result; a host without a lambda; mapped from Formula.js `#VALUE!`, `#NULL!` or an unrecognized error; many implementations' argument checks. |
| `#DIV/0!` | `/` by zero; implementations. |
| `#DOMAIN!` | A NaN result from an operator, a broadcast call, a range call, or Expression's final check; Formula.js `#NUM!`. |
| `#OVERFLOW!` | An infinite result from finite inputs; a generator past `MAX_GENERATED`. |
| `#REF!` | A row or column reference outside a computed column. |
| `#N/A` | `ERROR.TYPE` of a non-error; lookups with no match; shape-builder padding. |
| `#CONV!` | The iterative finance functions failing to converge (IRR, XIRR, RATE). |

Errors produced by an implementation for its own reasons (a negative `SQRT`, a bad argument) are that implementation's business and are not listed.

## The Expression node

`ExpressionNode` (catalog type `expression`) is the formula surface on the canvas. Its persisted fields are `label`, `expr`, `locked`, `resultAs`, `literals` (variable name to number) and `varDescriptions` (variable name to prose, shown as a hover tooltip and a legend, never part of the formula). Its sockets derive from `expr`.

**Variables.** `extractVariables(expr)` walks the AST and collects every bare `name` that is not a constant, in first-appearance order without duplicates, from operator operands, call arguments, application callees and arguments, and LAMBDA bodies. Function names in call position, `@` and bracket references, and literals are not variables. A LAMBDA's parameters are bound inside its body and are not variables, and neither is a bare function name in a lambda slot (an argument of `MAP`, `BYROW`, `BYCOL`, `REDUCE`, `SCAN`, `GROUPBY`, or of an application), which evaluates as an eta function. So `MAP(x, LAMBDA(v, v*2))` and `MAP(x, SQRT)` both grow the one socket `x`. A formula that does not parse has no variables.

**Rebuild.** `_rebuild()` recomputes the variables, adds an `anydata` input (scalar, list or matrix, never a Frame) for each new one, recompiles the evaluator and the AST, and returns the added and removed names. The single edit path, `applyExprChange` in `components/expressionEdit.ts`, is a no-op on a locked node; otherwise it sets `expr`, rebuilds, drops the removed sockets' cables before removing the sockets ([[D10]] onePrunePath), resizes the card and recomputes the graph. A locked node is a pack preset: the formula is read-only and the title stays editable.

**Inputs.** Each variable reads `readInput(inputs[v], literals[v] ?? 0)`: unwired is the literal (0 by default); wired is the cable's value, even when `null`, so a wired blank stays blank through the formula. The error guard around every `data()` short-circuits a wired top-level `SolError` before the formula runs, so `IFERROR(x, 0)` catches errors raised inside the formula and cell errors inside a wired list, not a wired scalar error. Unit-tagged cells are stripped to their base-SI magnitudes before evaluation.

**Evaluation.**

1. No evaluator: an empty formula answers `null` with no error; otherwise `#SYNTAX!` carrying the syntax hint, and the card shows the hint (or "Syntax error").
2. Run the evaluator. Each result cell (scalar, list cell or matrix cell) is tagged: a `SolError` passes; a Formula.js `Error` maps through `fxErrorToSol`; NaN is `#DOMAIN!`; a string, a logical, a number (an infinity included) or a complex value passes; anything else becomes `null`.
3. When any input carries a non-dimensionless unit, `dimEval` computes the result's dimension from the AST, the input dimensions and their currency codes. An error there is the result; a known dimension tags each numeric cell; an indeterminate one drops the unit ([[unit-flow]]).
4. A thrown exception answers `#VALUE!` "The formula failed to evaluate".

**Result socket.** `resultAs` (`number`, `text`, `date` or `auto`) is the user's declared element type, set by the result-type toggle; the Expression node does not infer it. The result starts as a combo socket (scalar or list) of that type. `reconcileResultRank` swaps it to the matrix socket of the same type when a value arrives with rank 2, and back when rank 1 or 0 returns, retyping the output cables in a microtask outside `data()`. An error result leaves the socket where it was.

## Static analyses

Other surfaces read a formula without evaluating it. All return empty on a syntax error.

| Function | Answers |
|---|---|
| `extractVariables(expr)` | the variables, as above |
| `calledNames(expr)` | every name in call position, raw spelling (a surface binding lambdas by name reads which ones a formula calls) |
| `rowRefNames(expr)` | every `@` and bracket reference name, excluding a name that is a parameter of an enclosing LAMBDA literal (a computed column's dependency feed) |
| `atColNames(expr)` | identifier-shaped `@name` references only (the LAMBDA node's capture sockets) |
| `exprYieldsDate(expr, isDateName)` | whether the result is a date: a name or reference `isDateName` accepts; unary `+` of a date; `date + number` or `number + date`; `date - number`; a call whose `EXCEL_IMPL_META.returns` is `date`; `IF` whose every non-blank branch is a date. Everything else is false. |
| `formulaSyntaxHint(expr)` | as in *Syntax hints* |
| `formulaFunctionNames()` | every dispatchable name |

## Rendering

`formulaToLatex(expr)` renders the AST for KaTeX, or null on a syntax error. Division is `\frac`, `*` is `\cdot`, `^` is a superscript, comparisons use their symbols, `&` is `\mathbin{\&}`, a blank is `\varnothing`, strings are `\text{"…"}` with LaTeX specials escaped, logicals are upright words, and references are `\text{@name}` or `\text{[Name]}`. `SQRT`, `ABS`, `POWER`, `EXP`, `PI()`, `LN`, one-argument `LOG` and `LOG10`, and the trigonometric and hyperbolic functions get their math forms; any other call is `\operatorname{NAME}`. A name splits into a base and a subscript at its first underscore, or at a trailing digit run (`x2` is `x_2`); a Greek base becomes its letter (`phi` is `\varphi`); a longer base is upright. Parentheses are added only where precedence needs them.

`evaluateSteps(expr, vars)` produces one LaTeX step per operation and call, deduplicated by rendered form, for a numeric scalar formula. It uses plain JavaScript arithmetic, not `applyOp`, reads unbound variables and blanks as 0 and logicals as 1 and 0, and answers null for strings, references, applications, `&`, a non-finite result or no steps.

## Editor support

`highlightFormula(src)` is a position-preserving tokenizer for the highlighted overlay: every character reaches the output. A name in call position is `fx-fn` when advertised, `fx-frame` for a Frame or node-only verb (a recognized name on the wrong surface), and `fx-unknown` otherwise; a bare name is `fx-const` for a constant and `fx-var` otherwise; an unplaceable character is `fx-err`.

`suggestFor(word, extraNames)` ranks the node's variables, the constants and the advertised function names by fuzzy match, exact prefixes first, with variables ahead of constants ahead of functions on a tie, and drops a fully typed non-function. A function suggestion carries its hint from `signatureFor`: a Frame or node-only verb's redirect, the curated `FORMULA_SIGNATURES` entry, a pack's declared signature, or a placeholder built from `arity` (`arg1, arg2, [arg3], …`). `enclosingCall(src, caret)` finds the innermost named call around the caret and its argument index for the parameter bar, skipping strings and letting anonymous parentheses nest.

## Computed columns

A computed column's formula runs on this evaluator inside a row context pushed by `computedColumnCore.ts`. There, a bare name is the whole column as a list, and `@name`, `@[Name]` or `[@Name]` is this row's cell; `readRowCell` resolves a this-row reference through columns, then the builtins, then the LAMBDA's own environment, then the surface's side value ([[C22]] rowFormulaRefs). [[computed-columns]] owns those rules.

## What pins this

| Behavior | Test |
|---|---|
| The broadcast table, containment, singleton collapse | `tests/graph/broadcastRules.test.ts`, `broadcastContract.test.ts`, `expressionMatrix.test.ts` |
| Parser, variables, LaTeX, steps, operator table, lookups redirect, omitted arguments | `tests/graph/excelFormula.test.ts`, `formulaSyntax.test.ts` |
| Typed blanks | `tests/graph/blankArgIsExcelBlank.test.ts` |
| Range routing and preparation policies | `tests/graph/rangeRouting.test.ts` |
| Matrix and complex containment | `tests/graph/formulaMatrix.test.ts`, `formulaComplex.test.ts` |
| LAMBDA and hosts | `tests/graph/formulaLambda.test.ts`, `tests/graph/nodes/tableLambda.test.ts` |
| Node and formula give one answer | `tests/graph/formulaNodeParity.test.ts`, `nodeFormulaArgParity.test.ts`, `formulaTier1.test.ts`, `formulaTier3.test.ts` |
| Formula.js divergences and tripwires | `tests/graph/formulaDivergence.test.ts` |
| Pack registration | `tests/graph/formulaExtensions.test.ts` |
| The formula path stays rete-free | `tests/graph/formulaPathIsReteFree.test.ts` |
