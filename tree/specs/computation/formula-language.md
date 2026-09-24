---
aliases: ["Formula language and evaluator"]
tags: [spec, computation]
---
<!-- [[B16]] oneFormulaSurface, [[C14]] currentExcelParity, [[D25]] blockedFailFast, [[C15]] matricesInFormulas, [[D26]] hideMatrixFromVendor, [[D27]] oneBroadcast, [[C17]] shareImpl, [[D19]] implReteFree, [[D20]] declareContract, [[D51]] oneAnswerOneDivergence, [[C18]] uniqueNameMap, [[C20]] wholeArrayArgs, [[D24]] prepByShape, [[C21]] matchNodeLimits, [[C45]] excelComparisons, [[C46]] consistencyOverQuirks, [[C50]] lambdaBindsByName, [[D77]] constantsAlwaysWin, [[C51]] formulaNaming, [[C80]] blankArgIsExcelBlank, [[D7]] oneMetricImpl, [[D9]] useEveryNotSome, [[D4]] noManualList, [[D39]] keyByValue, [[C44]] dateSerials, [[D54]] relativeDatesOptIn, [[C48]] appendLadder, [[C61]] oneDistributionNode, [[D70]] nullNotEnoughData, [[C26]] opArgDistinct, [[D37]] errorBeatsMissing -->

# Spec: Formula language and evaluator

Serves [[B16]] oneFormulaSurface, with its subtree: [[C14]] currentExcelParity, [[D25]] blockedFailFast, [[C15]] matricesInFormulas, [[D26]] hideMatrixFromVendor, [[D27]] oneBroadcast, [[C17]] shareImpl, [[D19]] implReteFree, [[D20]] declareContract, [[D51]] oneAnswerOneDivergence, [[C18]] uniqueNameMap, [[C20]] wholeArrayArgs, [[D24]] prepByShape, [[C21]] matchNodeLimits, [[C45]] excelComparisons, [[C46]] consistencyOverQuirks, [[C50]] lambdaBindsByName, [[D77]] constantsAlwaysWin, [[C51]] formulaNaming and [[C80]] blankArgIsExcelBlank. The shared kernels and the parity measurement also serve [[D7]] oneMetricImpl, [[D9]] useEveryNotSome, [[D4]] noManualList, [[D39]] keyByValue, [[C44]] dateSerials, [[D54]] relativeDatesOptIn, [[C48]] appendLadder, [[C61]] oneDistributionNode, [[D70]] nullNotEnoughData, [[C26]] opArgDistinct and [[D37]] errorBeatsMissing. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

The formula language is the Excel-style expression language typed into an Expression card, a LAMBDA card and a computed column. A formula is parsed once into a syntax tree and evaluated per recompute against the card's variables. Every function it calls is either an internal registration, which usually calls the same kernel as the matching node, or a Formula.js fallthrough. This spec covers the grammar, how names and calls resolve, how arguments are prepared and broadcast, the function-by-function notes, the shared rete-free kernels both surfaces call, and the measurement that keeps nodes and formulas in step.

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
| `src/graph/excelCriteria.ts` | The criteria grammar for the SUMIFS family (see *Criteria*). |
| `src/graph/cxValue.ts` | The tagged complex value, its text forms and its arithmetic kernels. |
| `src/graph/excelToCatalog.ts` | `EXCEL_TO_CATALOG` and `CATALOG_TO_EXCEL`, derived from `NODE_EXCEL`, never hand-edited. |
| `src/graph/formulaNodeParity.ts` | The node-and-formula parity measurement (see *Parity measurement*). |
| `src/graph/nodes/listOps.ts`, `statsOps.ts`, `mathUtils.ts`, `financeOps.ts`, `dateSerial.ts`, `dateOps.ts`, `textOps.ts`, `matrixOps.ts`, `distributionOps.ts`, `fitOps.ts`, `forecastOps.ts`, `signalOps.ts`, `indexAccess.ts`, `visualOps.ts`, `hashOps.ts`, `convertUnits.ts`, `astroOps.ts`, `chemistryOps.ts`, `electricalOps.ts`, `emSpectrumOps.ts`, `fluidsOps.ts`, `healthOps.ts`, `physicsConstantsOps.ts`, `thermoOps.ts`, `triangleOps.ts` | The shared kernels (see *Shared kernels*). |
| `src/graph/packs/*Formulas.ts` | A pack's `formulas` (its `PackFormula` impls), importing only kernels. |

Every module the formula path imports is rete-free, each pack's `*Formulas.ts` included ([[D19]] implReteFree). `formulaPathIsReteFree.test.ts` pins it.

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

1. **Constant.** `pi`, `tau` (2π), `e` and `phi` (the golden ratio), matched case-insensitively (`FORMULA_CONSTANTS`). A constant always wins, inside a LAMBDA body too ([[D77]] constantsAlwaysWin). A constant is never a variable, so a formula cannot have a variable named `e`, `E`, `pi` or `PI`, and a LAMBDA cannot have a parameter by one of those names (see *Syntax and evaluation* under LAMBDA).
2. **Environment.** `env[name]`, case-sensitive. In the Expression node every non-constant bare name is a variable with a socket, so it is always bound (see *The Expression node*). A name the environment lacks evaluates to `undefined`.

Function names in call position are case-insensitive and resolve through the registry (see *Calls*). A variable never shadows a function, and a function never shadows a variable: `SUM` bare is a variable named `SUM`, `SUM(…)` is the function. The one crossover is a call whose raw name is bound in the environment to a `LambdaValue`, which applies that lambda.

`@name`, `@[Name]`, `[@Name]` and `[Name]` read a computed column's row context. Outside one they answer `#REF!` ("@ reads the current row, so it only works inside a computed column", or the whole-column wording for `[Name]`). They are never variables: `extractVariables` skips them, so they never grow a socket.

## Calls

### The registry

`registerInternal(name, fn)` stores an implementation under the uppercased name. A second registration of a live name throws ([[C18]] uniqueNameMap's registry half); a withdrawn name may register again. `unregisterInternal` withdraws one, and only packs use it; the core registers once at module load and never withdraws. `internalFunctionNames()` is a function rather than a constant so it includes registrations made after the module loads. Each registration or withdrawal bumps `registryGeneration()`, which the derived name lists memoize against, because packs register after module load.

`resolveExcelFunction(name)` uppercases the name, returns the internal implementation if one exists, and otherwise walks Formula.js's export object by the dotted path (`NORM.S.DIST` is `FX.NORM.S.DIST`). Both functions and plain objects are walkable containers, since Formula.js hangs `.MATH`, `.PRECISE`, `.INTL` and `.TEST` off callable parents. The result is null when neither has the name. An internal registration therefore always wins over Formula.js. `FX_FUNCTION_NAMES`, which feeds autocomplete and highlighting, walks the same way to a depth of two and skips `FX.utils`; the two walks must match ([[formulajs-divergences]] *Name walking*).

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

The core registers every internal function at module load. The node and the formula call the same kernel ([[C17]] shareImpl). A generator that a formula can reach (SEQUENCE, RANDARRAY, MAKEARRAY and the list generators) checks `MAX_GENERATED` (1,000,000 elements, from `nodes/listOps.ts`, the constant the nodes use) and answers `#OVERFLOW!` past it ([[C21]] matchNodeLimits). The 2-D builders (EXPAND, MUNIT, DIAGONAL, OUTER) apply the same limit to their cell count inside their `matrixOps` kernels, so the card and the formula refuse together.

### Blocked and wrong-surface names

Three tables name functions a formula refuses. Each refusal happens before any argument is evaluated, so a blocked name over a list answers one error, never a list of them ([[D25]] blockedFailFast).

| Table | Answer | Examples |
|---|---|---|
| `LEGACY_ALIASES` (the blocklist, [[C14]] currentExcelParity) | `#NAME?` "Use {replacement}" | `VLOOKUP`, `HLOOKUP`, `LOOKUP` to `XLOOKUP`; `MATCH` to `XMATCH`; the D* database family to its aggregate; the pre-2010 statistics spellings (`NORMDIST`, `STDEVP`, `TDIST`); the undotted spellings of dotted names (`STDEVS`, `PERCENTILEINC`); `CEILING.PRECISE`, `FLOOR.PRECISE`, `ISO.CEILING`; `SUBTOTAL`, `AGGREGATE` to `SUM`; `COLUMN`, `ROW` to `INDEX`; `SUMIF` to `SUMIFS` |
| `FRAME_SURFACE_NAMES` ([[C15]] matricesInFormulas) | `#TYPE!` "Frames don't flow through formulas, use the {node} node, or a Computed Column for row math" | `BUILDFRAME`, `JOIN`, `FRAMEFILTER`, `PIVOTBY`, `UNPIVOT`, `KMEANS`, `SETCELL` |
| `NODE_SURFACE_NAMES` | `#NAME?` "Use the {node} node" | `TEXTFILTER` to List Filter |

Formula.js also exposes some legacy stems with dotted children (`FX.TDIST.RT`); the stem is the superseded name, so those dotted spellings are blocked too (`TDIST.RT`, `CHIDIST.RT`, `BINOMDIST.RANGE`, `ISO.CEILING.MATH` and the rest). `TDIST` maps to `T.DIST.RT` because Excel split its tails argument into `.RT` and `.2T`; `TINV` was always two-tailed, so it maps to `T.INV.2T`. `ELIMINATED_FUNCTIONS` is the set of `LEGACY_ALIASES` keys, derived, never kept by hand. Each blocked name is also registered as an internal stub answering the same `#NAME?`, so a direct `resolveExcelFunction` caller (a node) gets the redirect instead of Formula.js's implementation. Blocked names are removed from `RANGE_FUNCTIONS` and `RANGE_POSITIONAL` at module load and filtered out of every advertised list.

### Excel names on cards

Where a card does what an Excel function does, it wears the Excel spelling in capitals ([[D23]] capsClaimsFunction), even when the formula surface won't run that function. This is a naming divergence from Excel, recorded here rather than as a decision of its own:

- **GROUPBY and PIVOTBY** are frame cards. Excel runs them as formulas; Solenoid's formula surface refuses them through `FRAME_SURFACE_NAMES` (Frames don't flow through formulas, [[C15]] matricesInFormulas) and the refusal names the card, so the capitals still point at something the user can use. The [[D23]] test admits the map's keys. Frame verbs with no Excel function (Unpivot, Nest, Rename and the like) stay Title Case. If the stack merge lands, Append and Bind Columns become VSTACK and HSTACK. Reopen if the formula surface starts accepting Frames.
- **ISBOOLEAN** is the Type Check op's label, because Solenoid's first-class type is called Boolean on every surface. Excel has no ISBOOLEAN, so `excelFunctions.ts` registers `ISBOOLEAN(v)` with ISLOGICAL's test, which keeps the capitals a true callable claim with no `nameCase.test.ts` allowlist entry. `ISLOGICAL` stays callable for Excel parity and is the Inspector's Excel equivalent; the op's saved key stays `islogical`. Reopen if the type is renamed.
- **DATE (Build)** is the DATE(year, month, day) card. A bare DATE beside a Date Input card would differ only by letter case, so the Title Case parenthetical tells them apart ([[D22]] oneNamePerCard allows a parenthetical that distinguishes rather than hints at use); DATE is still the callable token. Reopen if Date Input is renamed.

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

A function whose `EXCEL_IMPL_META` entry has `listArgs: true` (and is not blocked) receives every argument unchanged: nulls stay in place and cell errors stay where they are, because these functions preserve positions (`REVERSE([1, null, 3])` is `[3, null, 1]`). A list-returning function with scalar arguments (SEQUENCE, QUADRATICROOTS) is declared the same way so it is never broadcast. Before dispatch, a top-level `null` scalar argument makes the answer `null` (a blank scalar is unknown, not 0); an empty argument slot is exempt, as on the broadcast path, so `TRIANGLESOLVER(3, 4, , , , 90)` reaches its registration. The rule has further exceptions for the names in `NULLABLE_SCALARS_OK`, whose registrations decide blank by blank: `FILLVALUE`, `COALESCE`, the matrix and array-shaping functions (`SEQUENCE`, `WRAPROWS`, `WRAPCOLS`, `MMULT`, `MDETERM`, `MINVERSE`, `TRANSPOSE`, `MUNIT`, `TOCOL`, `TOROW`, `UNIQUE`, `SORT`, `SORTBY`, `FILTER`, `TAKE`, `DROP`, `MODE.MULT`, `FREQUENCY`, `RANDARRAY`, `RANDDIST`, `INTERPOLATE`, `HSTACK`, `VSTACK`, `CHOOSECOLS`, `CHOOSEROWS`, `EXPAND`), the lambda hosts (`MAP`, `BYROW`, `BYCOL`, `REDUCE`, `SCAN`, `MAKEARRAY`, `GROUPBY`), the regression quartet (`TREND`, `GROWTH`, `LINEST`, `LOGEST`) and the criteria family (`SUMIFS`, `COUNTIFS`, `AVERAGEIFS`, `MINIFS`, `MAXIFS`, `COUNTIF`, `AVERAGEIF`).

`INDEX` declares `listArgs`, so it takes this route even though it is also listed in `RANGE_FUNCTIONS` and `RANGE_POSITIONAL`. The matrix functions declare `listArgs` beside `matrixArgs`, so a rank-1 argument also arrives whole: TRANSPOSE of a list is a column, not an element-wise map, and COLUMNS and ROWS count a list as one row.

### Range functions

`RANGE_FUNCTIONS` lists the functions whose signature takes a range: the aggregates (`SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, the STDEV and VAR families, `MEDIAN`, `LARGE`, `PERCENTILE`, `RANK` and the rest), `GCD`, `LCM`, `MULTINOMIAL`, the workday functions (their holiday list), the correlation and regression pairs, `AND`, `OR`, `XOR`, `TEXTJOIN`, `CONCAT`, the criteria aggregates, `NPV`, `XNPV`, the lookups, the statistical tests and the pairwise sums. An argument that is a list arrives as one list; nothing is called per element. Blocked spellings listed here (`VLOOKUP`, `SUBTOTAL` and the rest) are removed at load, so they get no range routing. A name added to `RANGE_FUNCTIONS` needs a row in `rangeRouting.test.ts`.

Before dispatch, `prepRangeArgs` applies the function's null and error policy ([[D24]] prepByShape). The policies are checked in this order:

| Policy | Members | Errors | Nulls |
|---|---|---|---|
| `RANGE_RAW` | `COUNT`, `COUNTA`, `COUNTBLANK`, and the criteria family `SUMIF(S)`, `COUNTIF(S)`, `AVERAGEIF(S)`, `MAXIFS`, `MINIFS` | untouched; the function classifies them (COUNT skips errors, COUNTA counts them) | untouched (COUNTBLANK counts them; a blank criterion matches a blank cell) |
| `RANGE_POSITIONAL` | `XLOOKUP`, `XMATCH`, `INDEX` | untouched, so an error at a position the lookup never reads cannot poison it | untouched, so positions do not shift |
| `RANGE_ZERO_FILL` | `SERIESSUM`, `NPV` | the first cell error in any list argument is the answer | each null becomes 0 in place |
| `RANGE_PAIRED` (term-by-term definitions that must stay index-aligned) | `SUMPRODUCT`, `CORREL`, `SPEARMAN`, `KENDALL`, `WILCOXON`, `COVAR`, `COVARIANCE.P`, `COVARIANCE.S`, `SLOPE`, `INTERCEPT`, `RSQ`, `STEYX`, `FORECAST.LINEAR`, `XNPV`, `SUMX2MY2`, `SUMX2PY2`, `SUMXMY2`, `CHISQ.TEST`, `PROB` | the first cell error is the answer | every list is cut to the shortest list's length, and an index where any list holds null is dropped from all of them |
| pooled (default) | every other range function, including `T.TEST` and `F.TEST` | the first cell error is the answer | each list drops its own nulls independently |

A Formula.js `Error` object found in a list counts as an error and is mapped with `fxErrorToSol`. Scalar arguments pass through every policy unchanged. The prepared lists are copied before dispatch because some Formula.js functions mutate their arguments. A numeric result passes `guardFinite` with every flattened input, so `SUM` over a list holding a first-class infinity still answers infinity.

Dropping nulls per array would shear a paired function's pairing, which is why `RANGE_PAIRED` drops whole rows; its shortest-length zip is the same as padding with null, since padded rows would drop anyway. `T.TEST` and `F.TEST` stay pooled because their samples may differ in length ([[D24]] prepByShape).

So `AND(x)` over `[TRUE, null, TRUE]` is TRUE: a reduction skips nulls, while the operators and element-wise functions propagate them. That is the one sanctioned node-versus-formula split ([[D51]] oneAnswerOneDivergence).

### Broadcast

Every other function is element-wise. With no list or matrix argument it is called once with the scalars, under the same null rule as a cell: a blank value makes the answer blank unless the function is in `NULL_INSPECTING`. An empty argument slot is not a value, so the function still reads it (`ROUND(2.5, )` is 3). With at least one list argument, `mapCells` aligns the arguments (see *Broadcasting*) and calls the function per cell with this per-cell contract:

1. a `SolError` among the cell's operands is the cell's answer;
2. otherwise a `null` among them makes the cell `null`, unless the function is in `NULL_INSPECTING` (`ISBLANK`, `ISNUMBER`, `ISTEXT`, `ISNONTEXT`, `ISLOGICAL`, `ISBOOLEAN`, `ISREF`, `N`, `T`, `TYPE`, `IF`, `CHOOSE`), which sees the null;
3. otherwise the function runs, and a numeric result passes `guardFinite` against that call's arguments.

If every list argument is empty, the answer is `[]`.

## Broadcasting

`mapCells(argv, cellFn)` is the one broadcaster for every element-wise surface: binary operators, unary minus and plus, percent, `IFERROR` and `IFNA`, and function broadcasting ([[D27]] oneBroadcast). It owns shape only; `cellFn` owns the per-cell meaning. The rules, as the B-table in `docs/archive/17-matrix-formulas.md` Part 2 states them and `tests/graph/broadcastRules.test.ts` transcribes row by row:

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
| `+` `-` `*` `^` | Arithmetic on the operands, then `guardFinite`. `^` runs `powerOf`, the POWER and Arithmetic card kernel: zero to a negative power is `#DIV/0!`, as in Excel. A text operand to any of these (and to `/`) is `#VALUE!` "Arithmetic needs numbers. Join text with &, or read a number from text with NUMBERVALUE" ([[D11]] noAutoCross). |
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

`compilePositional(expr, paramNames)` wraps `compileEvaluator` with positional binding: argument `i` binds to `paramNames[i]` in a fresh environment. A name that is a constant still reads the constant; the LAMBDA node refuses such a parameter before it compiles. The LAMBDA node and the table-lambda nodes use it.

## Complex numbers

A complex value is a tagged object, `{ __cx: true, re, im }` (`cxValue.ts`, [[D45]] maxRankMatrix), so `Array.isArray` means exactly one thing everywhere, and every complex test goes through `isCx`, never a structural array check. It reaches a function only through a declared `cxArgs` (step 10 of the dispatch ladder). The IM* family declares it; COMPLEX and QUADRATICROOTS take real arguments and deliberately do not.

- **Arguments** (`asCxArg`): a complex value as is, a real number as `re + 0i`, or text in Excel's `a+bi` grammar. Text that does not parse is `#VALUE!` (Excel says `#NUM!`); anything else, logicals included, is `#TYPE!`.
- **Results** are tagged complex values, not Excel's text complexes. IMREAL, IMAGINARY, IMABS and IMARGUMENT answer numbers.
- The IM* functions are element-wise, like their nodes: they declare no `listArgs`, so they broadcast over lists, and IMSUM and IMPRODUCT over two lists zip them pairwise rather than summing a whole range as Excel does.
- IMARGUMENT(0) is 0, atan2's convention and the IM Unpack node's answer; Excel answers `#DIV/0!`.
- IMPOWER's exponent is real on both surfaces; a complex exponent is `#TYPE!`.
- COMPLEX(re, im, [suffix]) takes real parts and answers a tagged value. The suffix is checked (`"i"` or `"j"`, else `#VALUE!`) and then dropped, since a tagged value stores no spelling.
- QUADRATICROOTS(a, b, c) answers both roots as a two-element list `[x₁, x₂]`, the Quadratic Roots node's two outputs side by side: `(−b − √D)/2a` then `(−b + √D)/2a`, as real values when the discriminant D is at least 0 and as a conjugate pair otherwise. `a = 0` is `#DOMAIN!` (a line, not a quadratic). A −0 part becomes 0 so it never displays as "-0". POLYROOTS(coefficients) answers every root as complex values through `polyRoots`.
- **Text forms.** `assembleCx` is the one place that knows how a complex is spelled: `a + bi`, `a - bi`, `bi`, `-bi`, `i`, `a`, `0`, and `NaN` when either part is NaN. `formatCx` is the Excel and coercion form, which drops a zero part (`23`, `4i`); the `&` operator and cast to text use it, and it round-trips with `parseCx`. `formatCxDisplay` always shows both parts (`0 + 4i`, `23 + 0i`). `hasBothParts` reports the two-term form, which a unit wrapper must parenthesize. Numbers print as integers or to 4 decimals with trailing zeros removed. `parseCx` accepts Excel's forms and the spaced output (`3 + 4i`, `-2.5-1e3j`, `i`, `-j`, a bare real), and answers null otherwise so the caller picks the error.
- The arithmetic kernels (`cxAdd` through `cxCsch`) do no error classification; they carry their own non-finite forms (dividing by zero is `cx(NaN, NaN)`) rather than minting tagged errors. `cxPow(0, n)` is 0.

## Error-handling functions

`IFERROR`, `IFNA`, `ISERROR`, `ISERR`, `ISNA` and `ERROR.TYPE` (`ERROR_HANDLER_FUNCTIONS`) are handled by `applyErrorHandler` before error propagation. An operand counts as an error when it is a `SolError` or a Formula.js `Error`. `IFNA` and `ISNA` catch only `#N/A`; `ISERR` catches everything except `#N/A`; the rest catch every error.

- `IFERROR(value, fallback)` and `IFNA`: a scalar value is replaced by the fallback when caught. When either argument is a list or matrix, the two broadcast through `mapCells` like an operator's operands ([[D27]] oneBroadcast): a list fallback reads as one row across a matrix, and a cell past a shorter operand's edge is `null`. A missing fallback is `null`.
- `ISERROR`, `ISERR`, `ISNA`: TRUE or FALSE, walked cell by cell over lists and matrices.
- `ERROR.TYPE`: per cell of a list or matrix, Excel's number for the code (`#DIV/0!` 2, `#VALUE!` 3, `#REF!` 4, `#NAME?` 5, `#N/A` 7, and 6 for `#NUM!` and the Solenoid codes that split it: `#DOMAIN!`, `#OVERFLOW!`, `#CONV!`); any other code is 3; a non-error answers `#N/A`.

## LAMBDA

### Syntax and evaluation

`LAMBDA(p1, …, pn, body)` is a special form: its arguments are not evaluated. With no arguments it answers `#VALUE!` "LAMBDA needs a body…". Every argument but the last must be a bare name, or it answers `#VALUE!` "LAMBDA parameters must be plain names", a name may appear once (`#NAME?` "LAMBDA parameter x appears twice"), and a constant's name is refused (`#NAME?` "e is a constant, so it can't name a LAMBDA parameter", [[D77]] constantsAlwaysWin). The value is a closure, `{ __lambda: true, params, fn, expr: "" }`: calling `fn(...args)` copies the defining environment, binds parameter `i` to argument `i` (a missing argument binds `undefined`) and evaluates the body. The closure captures the whole defining environment, so a body can read the formula's variables. A lambda can return a lambda.

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

The LAMBDA node has a comma-separated `params` field and a body `expr`. Every name in the body that is not a parameter, together with every identifier-shaped `@name` (from `atColNames`), except the builtins `row` and `rows`, becomes a capture input socket. The node compiles the body with `compilePositional(expr, [...params, ...captures])` and emits `{ __lambda: true, params, fn, expr, captured, descriptions }`, where `fn(...args)` passes the first `params.length` arguments followed by the capture values resolved at compute time. An unchanged recompute returns the same object, since consumers memoize on identity. A parameter that is not an identifier, one named twice, or one named after a constant answers `#NAME?`, and the card shows the reason ("e is a constant" for the last, [[D77]] constantsAlwaysWin); a body that does not parse answers `#SYNTAX!` with the syntax hint; an empty body answers `null`.

A wired lambda reaching the MAP, BYROW, BYCOL, REDUCE, SCAN or MAKEARRAY node binds by parameter name, not position ([[C50]] lambdaBindsByName). Each node has fixed variable names (MAP `value`, `value2`, `value3`, `row`, `col`; BYROW and BYCOL `values`; REDUCE and SCAN `acc`, `value`, `step`; MAKEARRAY `row`, `col`). A parameter outside that set answers `#VALUE!` naming the node's variables. A captured name that matches one of the node's variables is flagged on the card as a likely missing parameter (`undeclaredConsumerVars`). Without a wired lambda, the node compiles its inline formula text over its fixed variables, and any other name answers `#NAME?`, pointing at the LAMBDA node. The formula hosts above bind positionally; only the node hosts bind by name.

## Errors a formula answers

| Code | When |
|---|---|
| `#SYNTAX!` | The formula does not parse (Expression and LAMBDA nodes). |
| `#NAME?` | Unknown function; a blocked spelling (naming its replacement); a node-only verb (naming its node). |
| `#TYPE!` | A Frame verb; ordering across types; any operator or undeclared function on a complex value; a lambda used as an operand. |
| `#SHAPE!` | A value deeper than a matrix; a matrix given to a whole-list native, a positional lookup without `matrixArgs`, or a Formula.js-only function. |
| `#VALUE!` | Applying a non-lambda; lambda arity mismatch; bad LAMBDA parameters or no body; an unapplied lambda as the result; a host without a lambda; mapped from Formula.js `#VALUE!`, `#NULL!` or an unrecognized error; many implementations' argument checks. |
| `#DIV/0!` | `/` by zero; zero to a negative power; implementations. |
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

`formulaToLatex(expr)` renders the AST for KaTeX, or null on a syntax error. It uses KaTeX's own operator names (the arc functions are `\arcsin`, never `\asin`), and since KaTeX has no `\textquotedbl`, quotes stay literal inside `\text{}`. Division is `\frac`, `*` is `\cdot`, `^` is a superscript, comparisons use their symbols, `&` is `\mathbin{\&}`, a blank is `\varnothing`, strings are `\text{"…"}` with LaTeX specials escaped, logicals are upright words, and references are `\text{@name}` or `\text{[Name]}`. `SQRT`, `ABS`, `POWER`, `EXP`, `PI()`, `LN`, one-argument `LOG` and `LOG10`, and the trigonometric and hyperbolic functions get their math forms; any other call is `\operatorname{NAME}`. A name splits into a base and a subscript at its first underscore, or at a trailing digit run (`x2` is `x_2`); a Greek base becomes its letter (`phi` is `\varphi`); a longer base is upright. Parentheses are added only where precedence needs them.

`evaluateSteps(expr, vars)` produces one LaTeX step per operation and call, deduplicated by rendered form, for a numeric scalar formula. It uses plain JavaScript arithmetic, not `applyOp`, reads unbound variables and blanks as 0 and logicals as 1 and 0, and answers null for strings, references, applications, `&`, a call that fails to dispatch, a non-finite result or no steps. Each step's LaTeX reads `operands = result`, with the operands shown as their computed numbers (integers as is, others to 6 significant digits).

## Editor support

**Highlighting.** `highlightFormula(src)` is a position-preserving tokenizer for the highlighted overlay: every character of the source reaches the output, so the colored layer mirrors the text area and a half-typed formula never bails out. Each token becomes a classed span:

| Class | Token |
|---|---|
| `fx-num` | a number, scanned as the lexer does |
| `fx-str` | a string literal; an unterminated one colors through to the end |
| `fx-var` | a bare name that is not a constant; an `@name` reference; a bracket reference `[…]` or `@[…]`, one token through its matching `]` (nesting counted), running to the end while left open |
| `fx-const` | a bare constant name (case-insensitive) |
| `fx-fn` | a name in call position (the next non-space character is `(`) that `advertisedFunctionNames()` offers |
| `fx-frame` | a name in call position that is a Frame verb or a node-only verb: a recognized name on the wrong surface, shown in violet, never the typo red |
| `fx-unknown` | any other name in call position |
| `fx-op`, `fx-paren`, `fx-comma` | operators (`<>`, `<=`, `>=` first), parentheses, commas |
| `fx-err` | any character the tokenizer cannot place |

The advertised set is re-read by identity on each call, never kept as a module constant, because packs register after load and switching a pack off shrinks it.

**Autocomplete.** `tokenAtCaret(src, caret)` answers the identifier word ending at the caret, or null when that word does not start with a letter, `_` or `λ`. `suggestFor(word, extraNames, limit = 8)` ranks the card's variables, the constants and the advertised function names by `fuzzyScore`. The score is 1,000 for an exact prefix, plus the fuzzy score, plus 3 for a variable or 2 for a constant, so a card's own variable outranks the long function list on a tie; equal scores put the shorter name first. A suggestion that is already fully typed is dropped, unless it is a function, where accepting it still adds the `(`. A function suggestion carries its hint from `signatureFor`.

**Signatures** (`formulaSignatures.ts`). `signatureFor(name)` answers, in order: `frame verb — use the {node} node` for a Frame verb, `use the {node} node` for a node-only verb, the curated `FORMULA_SIGNATURES` entry, a pack's declared signature, a placeholder built from the registration's `arity`, or null. It never answers a bare argument count. A curated entry is keyed by the uppercase name, joins its parameters with ", ", puts an optional parameter in brackets and ends a variadic tail with `…`; a blocked name has no entry, since a hint would advertise a name the parser refuses. `genericSignature([min, max])` writes `arg1, arg2, [arg3]`, showing max parameters, or for a variadic function (max 255 or more) `max(min, 1)` parameters followed by `…`; a function of no arguments is "". `signatureParams(sig)` splits a signature into parameters for the parameter bar, answers `[]` for "", and null for a prose redirect (one containing " — "), which the bar shows as prose.

**The parameter bar.** `enclosingCall(src, caret)` finds the innermost named call around the caret and the index of the argument the caret is in. It skips string literals and lets anonymous parentheses nest; commas count only on the innermost open group, so a named call's count already excludes an inner anonymous group's commas.

## Computed columns

A computed column's formula runs on this evaluator inside a row context pushed by `computedColumnCore.ts`. There, a bare name is the whole column as a list, and `@name`, `@[Name]` or `[@Name]` is this row's cell; `readRowCell` resolves a this-row reference through columns, then the builtins, then the LAMBDA's own environment, then the surface's side value ([[C22]] rowFormulaRefs). [[computed-columns]] owns those rules.

## Function notes

Per-function behavior that the routing above does not decide. The node and the formula call the same kernel ([[C17]] shareImpl), so the kernel's own rules are in *Shared kernels*; the overrides of Formula.js and their evidence are in [[formulajs-divergences]]. An omitted optional argument takes its default; a blank one follows the rules in *Blank and omitted arguments*.

### Logic and choice

- **IF(test, [then], [else])** reads its test with `ifTest` (`valueKinds.ts`), which the IF card shares: a blank test answers blank; a number test is true when nonzero; text reads as TRUE or FALSE in any case, and any other text, `""` included, is `#VALUE!`, as in Excel. With a false test and no `else` the answer is FALSE, and with a true test and no `then` it is TRUE. A blank branch (`IF(x,,y)`) arrives as null and stays null, a deliberate difference from Excel, which reads it as 0 ([[C80]] blankArgIsExcelBlank).
- **IFS(test1, value1, …)** reads each test with `ifTest`, as the IFS card does, and answers the value of the first true one. A blank test before any true one answers blank, an unreadable test is `#VALUE!`, an odd argument count is `#VALUE!`, and no true test is `#N/A`.
- **CHOOSE(index, v1, …)** runs the Choose node's rule: a blank index is blank, a fractional index truncates (`CHOOSE(2.7, …)` is the second), an index outside 1 to n is `#VALUE!`, and the chosen value passes through as it is, a blank included. CHOOSE is in `NULL_INSPECTING`, so a blank among the unchosen values cannot blank the answer.
- **NAND, NOR, XNOR** are variadic and three-valued like the Boolean Op node: each operand goes through `coerceLogical`, an unknown (null) flows by Kleene logic, and the answer is a logical. XNOR is TRUE when an even number of inputs are true, and any unknown makes it unknown.
- **ISCLOSE(a, b, [tolerance])**: `|a − b| ≤ tolerance`, default 10⁻⁹; a blank operand answers blank. **ISBOOLEAN** is TRUE only for a logical.
- **CLAMP(x, lo, hi)** and **BETWEEN(x, lo, hi)** (inclusive) answer `#VALUE!` for a non-number.

### Math

- **ROUND**, **ROUNDUP** and **ROUNDDOWN** run the ROUND card's kernel, `roundDigits` (`nodes/mathUtils.ts`). ROUND rounds half away from zero, as Excel does (`ROUND(-2.5, 0)` is −3). The digits count truncates toward zero, and the scaled value is read at 15 significant digits before it rounds, as Excel reads it, so binary noise never tips a result: `ROUND(1.005, 2)` is 1.01 and `ROUNDUP(0.1+0.2, 1)` is 0.3. A blank digits argument is 0.
- **POWER** is the `^` operator and the Arithmetic card's power op, so `POWER(0, 0)` is 1 ([[C46]] consistencyOverQuirks) and `POWER(0, -1)` is `#DIV/0!`.
- **LOG2** answers blank for x at or below 0, the node's quiet-blank convention, rather than `#DOMAIN!`. **HYPOTENUSE(x, y)** answers blank when either is blank.
- **ERF.PRECISE** and **ERFC.PRECISE** are Excel's single-argument forms, identical to ERF and ERFC, and delegate to them.
- **CONVERT** runs the unit system on the Convert node's unit keys ([[formulajs-divergences]]).

### Text

- The text functions write a number through `numberToText` (15 significant digits), so `(0.1+0.2) & "kg"` is `0.3kg`.
- **TEXTJOIN(delimiter, ignore_empty, …)**: only FALSE or 0 keeps empty strings; a blank `ignore_empty` slot is FALSE. **CONCAT** and **TEXTJOIN** take whole ranges; **CONCATENATE** is element-wise.
- **VALUETOTEXT** implements only Excel's concise form (format 0), what Cast to Text does with no format.
- **REGEXTEST, REGEXEXTRACT, REGEXREPLACE** take Excel's documented optional arguments, not JavaScript flag strings. `case_sensitivity` is 0 (case-sensitive, the default) or 1 (case-insensitive); anything else is `#VALUE!`. REGEXREPLACE's `occurrence` is 0 (the default, every match) or n (only the nth); a negative or non-finite one is `#VALUE!`. REGEXEXTRACT's `return_mode` is 0 (the first match, the default), 1 (every match as a list) or 2 (the first match's capture groups as a list).
- **SIMILARITY(a, b, [method])** takes `ratio` (the default), `damerau`, `jaro_winkler` or `levenshtein`, case-insensitive with `-` and spaces read as `_`; `jaro` means `jaro_winkler`; anything else is `#DOMAIN!`. **LEVENSHTEIN(a, b)** is the raw distance. **FUZZYMATCH(text, candidates, [threshold], [method])** answers the best candidate among the text candidates, with a default threshold of 0.6, or `#N/A` when none is similar enough.
- **PADTEXT(text, width, [side], [fill])**: side is `right` by default, `left`, or `center` (also spelled `both`); fill is a space by default. **TRUNCATETEXT** defaults its ellipsis to "…", **SLUGIFY** its separator to `-`, and **WRAPTEXT** refuses a width below 1 with `#DOMAIN!`.
- **HASH(text, [algorithm])**: SHA-256 by default; the name is lowercased with `-`, `_` and spaces removed, and must be one of `HASH_ALGORITHM_META` (`#DOMAIN!` otherwise). The digests are written out in full in `hashOps.ts`, since WebCrypto's SHA is asynchronous: UTF-8 in, lowercase hex out. **UUID()** is a random v4 UUID from the platform's secure generator. Base64 is the standard alphabet with padding over UTF-8 text; invalid base64 passes through unchanged.
- **TEMPLATE(text, v0, v1, …)** takes positional placeholders only, `{0}`, `{1}` or `{0:0.00}`; a named placeholder is the Template node's business (it grows sockets), so here it is `#NAME?` and the mistake is loud. A number formats through TEXT with its spec (General, `@`, by default).
- The Solenoid text functions (REVERSETEXT, UNACCENT, SLUGIFY, PADTEXT, TRUNCATETEXT, WRAPTEXT, SPELLNUMBER, DECODEURL, the Base64 pair, HASH, TEMPLATE) answer blank for a blank text.

### Dates and times

- The date functions run the date nodes' kernels on one serial model read in UTC ([[C44]] dateSerials); see *Date kernels*.
- **DATE(year, month, day)**: the year is literal and a blank day is 0, the last day of the month before.
- **DAYS(end, start)** is signed. **DAYS360(start, end, [method])** is European when `method` is TRUE. **YEARFRAC** defaults its basis to 0. **WEEKDAY** and **WEEKNUM** default their return type to 1.
- **DATEDIF(start, end, unit)** refuses a start after the end for every unit with `#DOMAIN!`, as Excel does, while the Date Diff card's Days op keeps its sign. An unknown unit is `#DOMAIN!`.
- **TODAY()** is today's date on the local calendar as an integer serial; **NOW()** is the local wall clock with its time fraction. Both run `wallClockSerial`, the Today / Now card's kernel and the day a relative date text such as `tomorrow` counts from, so the day turns at local midnight, when the rollover recalculates.
- **FROMEPOCH(value, [unit])** and **TOEPOCH(date, [unit])** take `s` (the default) or `ms`, case-insensitive; any other unit is `#DOMAIN!`. **DATETRUNC(date, [unit], [ceiling])** defaults to `day`; an unknown unit is `#DOMAIN!`.
- **TIMEZONECONVERT(datetime, from, to)** reads a datetime serial on one IANA zone's wall clock and rebuilds it on another's, the Time Zone Convert node's `convertZone`; any blank argument answers blank.

### Statistics

- The statistics family runs the nodes' kernels (Aggregate, Rank & Percentile, Correlation, Covariance, Mode, Fisher). Range arguments arrive prepared by `prepRangeArgs`, so a registration only gathers the finite numbers.
- The flat Excel names carry Excel's flat-name defaults: STDEV and VAR are the sample forms, PERCENTILE and QUARTILE inclusive, MODE single, COVAR the population form.
- **AVERAGEA** counts every non-blank cell: text as 0, logicals as 1 and 0.
- **SLOPE, INTERCEPT, STEYX, RSQ** take Excel's order, known Ys first, and **FORECAST.LINEAR(x, known_ys, known_xs)** runs the node's `linearFit` (zero-variance Xs are `#DIV/0!`). **PERCENTRANK(array, x, [significance])** is the inclusive form with 3 digits by default.
- **The tests beyond Excel's four** run the Hypothesis Test node's kernels: ANOVA and KRUSKAL take each group as a separate list argument (the node reads a matrix's columns); MANNWHITNEY, WILCOXON and KSTEST take two lists; FISHEREXACT(a, b, c, d), PROPTEST(x1, n1, x2, n2) and BINOMTEST(k, n, p) take numbers. **T.TEST(a, b, tails, type)** defaults tails to 2; a type other than 1, 2 or 3, or tails other than 1 or 2, is `#DOMAIN!`.
- **PROB(range, probabilities, lower, [upper])**: an omitted upper limit means exactly the lower limit.
- **COUNTDISTINCT** counts distinct values by value (`setKey`), skipping blanks; an error in the list is the answer.
- **The distributions.** The t, χ², F and gamma functions Formula.js lacks (T.DIST, T.DIST.RT, T.DIST.2T, T.INV, T.INV.2T, CHISQ.DIST.RT, CHISQ.INV.RT, F.DIST.RT, F.INV.RT, GAMMA.DIST, GAMMA.INV) run the `mathUtils` kernels; the rest (NORM.*, CHISQ.DIST and CHISQ.INV, F.DIST and F.INV, BETA.*, LOGNORM.*, WEIBULL.DIST, EXPON.DIST, BINOM.DIST, BINOM.INV, POISSON.DIST, HYPGEOM.DIST, NEGBINOM.DIST) run the Distribution node's `DIST_SPECS`, with Excel's argument order mapped onto the spec's value-then-parameters shape. An invalid parameter answers blank, never a fabricated number. A `cumulative` flag is true for TRUE, 1, or the text "true" or "1". BETA.DIST and BETA.INV take Excel's optional support bounds [A, B]: x maps to `(x − A)/(B − A)`, the density scales by `1/(B − A)`, and the quantile maps back; B at or below A is blank.
- **RANDDIST(family, n, [params…])** draws n values (rounded, at most 100,000) from a Distribution-node family by inverse CDF, the node's `sample` form as a formula. The family name is case-insensitive with spaces read as hyphens; an unknown one is `#DOMAIN!` naming the families. An omitted parameter takes the node's default. It is volatile like RAND, a fresh stream each evaluation, while the node's form holds its draws for a recalculation. A draw that is not finite is blank.
- **FITDIST(sample)** answers the name of the best-fitting family by AIC; **FITDIST(sample, family)** answers that family's parameters in the Distribution node's order. `lognormal` and `exponential` are accepted spellings; an unknown family is `#DOMAIN!`, and a sample a family cannot fit is `#VALUE!`.
- **The regression quartet.** TREND(known_ys, [known_xs], [new_xs]), GROWTH (the same, exponential), LINEST(known_ys, [known_xs]) answering `[slope, intercept, R²]`, and LOGEST(known_ys, [known_xs]) answering `[m, b]`. Pairs are prepared by `pairPresent`: an error is the answer, a pair with a blank side drops, and ragged tails are cut. Omitted Xs are 1 to n and omitted new Xs are the known Xs, the Excel defaults the node's sockets cannot express. Excel's trailing `const` and `stats` arguments are not taken. A prediction target that is an error is the answer, and a blank target drops. A blank `known_ys` answers blank; a degenerate LINEST is blank (the node's three blank outputs); LOGEST with a Y at or below 0, and a TREND or GROWTH that cannot fit, answer `[]`.
- **INTERPOLATE** covers both of the Interpolate node's modes under one name ([[C18]] uniqueNameMap), chosen by the first argument's rank. List mode, `INTERPOLATE(known_ys, known_xs, new_xs)`, requires all three arguments (`#VALUE!` otherwise), prepares the known pairs with the node's `pairPresent`, and answers `interpolateLinear` per query; an error in the queries is the answer, a blank query stays blank in place, and a scalar query answers a scalar. Grid mode, `INTERPOLATE(table, [xs], [ys], [forecast])`, takes a matrix first and runs [[bordered-grid-fill]]. There a blank positional argument is an omitted axis counting 1, 2, 3, like an unwired socket, because a formula has no cables and so no wired blank; `forecast` defaults to TRUE.
- **FORECAST.ETS**, **FORECAST.ETS.CONFINT** and **FORECAST.ETS.SEASONALITY** run the Forecast (ETS) node's kernel (*Signal and forecasting kernels*).

### Finance

- The bond, coupon, discount and T-bill functions (COUP*, ACCRINTM, INTRATE, RECEIVED, YIELDDISC, TBILLEQ, TBILLPRICE, TBILLYIELD, PRICEMAT, YIELDMAT, DURATION, MDURATION, PRICE, YIELD, ODDFPRICE, ODDFYIELD, ODDLPRICE, ODDLYIELD) run the finance nodes' kernels in Excel's argument order; an out-of-range argument answers blank. ODDF functions read an issue date and a first-coupon date; ODDL functions read only a last-interest date, so their argument lists differ in shape.
- **IRR(values)**, **MIRR(values, finance_rate, reinvest_rate)** and **XIRR(values, dates)** prepare cash flows as the node does (`cashPrep`, `datedPrep`): a blank cash flow is 0 and a blank date makes the answer blank. Fewer than two cash flows answer blank. A failed solve is `#CONV!`, noting the cash flows may have no internal rate of return. XIRR refuses a date before the first with `#DOMAIN!` (Excel's `#NUM!`), since a negative exponent would otherwise break the solver and be blamed on the sign pattern.
- **VDB** always switches to straight-line when that is the larger charge, which is Excel's default; a `no_switch` of TRUE is refused with `#VALUE!` rather than ignored. `factor` defaults to 2.
- **The return-series functions** are the Returns card's ops: LOGRETURNS, CUMRETURNS, DRAWDOWN, MAXDRAWDOWN, CAGR(list, [periods per year]), VOLATILITY(list, [periods per year]), SHARPE(list, [risk-free rate per period], [periods per year]) and SORTINO (the same arguments). Periods per year defaults to 1 and the risk-free rate to 0.

### Lookup and reference

- **XLOOKUP(lookup, keys, values, [if_not_found], [match_mode], [search_mode])** and **XMATCH(lookup, keys, [match_mode], [search_mode])** run `xmatchIndex`, the XMATCH node's kernel, on Solenoid's 1-D list model. `match_mode` is 0 (exact, also the default for an omitted argument), 1 (next larger) or −1 (next smaller); wildcard matching (2) is `#VALUE!` "isn't supported", and any other value `#VALUE!`. `search_mode` is 1 (first, the default) or −1 (last); binary search (±2) is `#VALUE!`, since every search scans the whole list. A blank mode argument reads as 0 (*Blank and omitted arguments*), which the search mode rejects as Excel does.
  - Excel's lookup and return arrays are one-dimensional but orientation-free: a single row or a single column both work. Both functions declare `matrixArgs`, so a matrix reaches them whole, and they check each argument themselves: an array that is a true grid is `#VALUE!`, and a 1 × N or N × 1 matrix flattens.
  - An array lookup value spills, as in Excel: one result per element, as a list. A 1 × N or N × 1 matrix lookup value spills over its cells; a true grid is `#SHAPE!`. This spill is scoped to the lookup family; it is not a general per-argument spill ([[C20]] wholeArrayArgs).
  - XLOOKUP's return array must be as long as the lookup array (`#VALUE!` otherwise). No match answers `if_not_found` when given, else `#N/A`. XMATCH answers a 1-based position.
- **INDEX(array, [row], [col])** runs the INDEX node's accessor (`indexInto`), so the formula answers what the card answers (*Index access*).

### Lists

- The list functions call the list nodes' kernels (*List kernels*). A bare scalar argument widens to a one-element list, as a cable widens a Number into a list input, so `REVERSE(5)` is `[5]`; a blank argument is an empty list.
- The formula names of the Sets and Fill ops (`SETUNION`, `FILLVALUE` and the rest) are declared on `SET_OP_META`, `SET_RELATION_META` and `FILL_OP_META`, because the bare op labels despace to other names ([[D3]] overrideInPlace).
- **LINSPACE, REPEAT, GEOMETRIC, RANGE, PADLEFT, PADRIGHT** check their count at the formula boundary, as their cards do at theirs: a non-finite count is `#VALUE!`, and one above `MAX_GENERATED` is `#OVERFLOW!` ([[C21]] matchNodeLimits). RANGE(start, [stop], [step]) has no count argument, so it caps on the implied length (`rangeCount`), and an endless walk is `#VALUE!`. FIBONACCI caps itself at 78 terms.
- **RUNNING(op, list, [window])** is the Running family's one name, the aggregator a text argument, as SORT carries its direction ([[C26]] opArgDistinct). The op is SUM, AVERAGE (or AVG), MIN, MAX, MEDIAN, PRODUCT or STDEV, case-insensitive; anything else is `#VALUE!` listing them. A blank op or list answers blank. An omitted window is cumulative; a blank window is unknown and answers blank; 0 is cumulative, a positive count is the sliding window, and anything else is `#DOMAIN!`.
- **LENGTH** counts every slot, blanks included, which is why it takes the whole-list route.
- **CONTAINS(list, value)** refuses a matrix with `#SHAPE!`.
- **COALESCE(list, fallback1, …)** is variadic, matching the node's extensible Else rows: per position the first non-blank of the list and then each fallback. A list fallback extends the result to its length, a number broadcasts, and any other fallback is ignored. **FILLVALUE(list, value)** fills every blank with the value.
- **ISOUTLIER(list, [method], [threshold])**: method `z` by default, or `iqr` or `mad` (`#DOMAIN!` otherwise), with the method's default threshold.
- **DECOMPOSE(list, period, component, [model])**, **SAVGOL(list, window, order)**, **LOWESS(list, [frac])** (default 2/3), **GAUSSIANSMOOTH(list, sigma)** and **FINDPEAKS(list, [height], [distance], [prominence])** (the peak positions) run the signal kernels.
- **SHUFFLE(list)** is volatile: a fresh permutation each evaluation, while the node holds its keys until the next recalculation.

### Matrices and dynamic arrays

- A matrix argument reads as itself, a list as one row ([[D13]] widenNeverNarrow), a scalar as 1 × 1, and a blank stays blank.
- **COLUMNS** and **ROWS** share the Table Info node's `matrixShape`: a list is a row, so COLUMNS counts it and ROWS is 1; a scalar is 1 × 1; a blank is unknown.
- **HSTACK**, **VSTACK** and **XSTACK(axis, …)** (axis `"v"` or `"h"`, else `#VALUE!`) share the Stack node's kernels: a blank input drops, no inputs answer blank, and ragged edges pad with `#N/A` ([[C48]] appendLadder). **CHOOSECOLS** and **CHOOSEROWS** take the trailing arguments, flattened, as the index list.
- **EXPAND(array, rows, [cols], [pad_with])** grows the array; a blank row or column count is unknown and answers blank, and an omitted `pad_with` pads with blank, the author's override of Excel's `#N/A`.
- **MMULT** needs complete numeric matrices and matching inner dimensions (`#SHAPE!` otherwise). **MDETERM** and **MINVERSE** need a square matrix (`#SHAPE!`) and answer `#DIV/0!` for a singular one. **MUNIT(n)** is the identity.
- **DIAGONAL(list)** is `numpy.diag`: a list becomes a square matrix with the list on its diagonal and 0 elsewhere (the node alone offers a blank off-diagonal). The registration also reads a matrix's diagonal as a list, `numpy.diag`'s dual, but DIAGONAL declares no `matrixArgs`, so a matrix argument answers `#SHAPE!` before it gets there. **OUTER(a, b)** is the matrix of products.
- **TRACE**, **MATRIXRANK**, **NORM**, **SOLVE(A, b)**, **EIGENVALUES** and **EIGENVECTORS** run the Matrix Determinant, Solve and Eigen nodes' kernels; SOLVE needs a square A with one b per row (`#SHAPE!`) and answers `#DIV/0!` for a singular A; the eigen functions need a square, symmetric matrix.
- **SPECTRUM(list, [rate])** is the FFT node's one-sided spectrum as rows `[frequency, magnitude, phase]`. **HISTOGRAM2D(xs, ys, kx, ky)** answers only the kx × ky count matrix (`counts[x bin][y bin]`), since coordinates ride beside a matrix rather than inside it; the Histogram node's 2-D mode draws the figure, and no finite pair answers blank. The kernel pairs samples by index, skips a pair with a non-finite side, clamps each axis to 1 to 100 equal-width bins, and collapses an axis whose values are all equal to one bin.
- **WRAPROWS** and **WRAPCOLS(list, count, [pad_with])**: a blank list or count answers blank, the count truncates (`wrapCount`, shared with the Table Reshape card), a count below 1 is `#DOMAIN!` (Excel's `#NUM!`), and the default pad is `#N/A` ([[C48]] appendLadder).
- **TOCOL** flattens row by row and **TOROW** down the columns (transpose, then flatten), as the Table Reshape node does.
- **SEQUENCE(rows, [cols], [start], [step])**: one column answers a list, the Sequence node's own 1-D output; more columns wrap row by row. A blank row count answers blank. The counts truncate; a negative one is `#VALUE!`, and zero rows or columns answer an empty list.
- **SORT(array, [sort_index], [sort_order])** works on one list: `sort_index` must be 1 or omitted (`#SHAPE!` otherwise), and order −1 sorts descending. **SORTBY(array, by)** refuses a key list of another length with `#SHAPE!`, as the Sort card and Excel do. **FILTER(array, include, [if_empty])** refuses an include array of another size with `#SHAPE!`, and an empty result answers `if_empty` when given.
- **TAKE** and **DROP(array, rows, [cols])** take Excel's signed counts through the one `takeSlice`/`dropSlice` kernel, per axis on a matrix; a column count on a list is `#SHAPE!`, and taking 0 rows or columns or dropping everything is `#DOMAIN!` (Excel's `#CALC!`), never a silent empty array. DROP of 0 drops nothing. The TAKE / DROP card has no way to leave a count out, so its 0 means "left out" and keeps the whole axis.
- **UNIQUE**, **MODE.MULT** and **FREQUENCY(data, bins)** answer blank for a blank argument.
- **RANDARRAY([rows], [cols], [min], [max], [integer])** defaults to one row, one column, 0 and 1. Its counts read as SEQUENCE's do (`arrayCount`, shared with the RANDARRAY card): they truncate, a negative one is `#VALUE!`, and zero answers an empty list. A Min above Max is `#VALUE!`, as in Excel; it is volatile, fresh values each evaluation, while the node holds its rolls for a recalculation.

### Criteria (`excelCriteria.ts`)

The criteria family (SUMIFS, COUNTIFS, AVERAGEIFS, MINIFS, MAXIFS, COUNTIF, AVERAGEIF) runs one Excel criteria grammar. The card's condition rows carry an op and value pair and reach the same cell test, `criterionMatches`. The plural forms take `(values, range1, criterion1, range2, criterion2, …)`, COUNTIFS without the values range; an empty or odd range-and-criterion list is `#VALUE!` "Criteria come in range, criterion pairs". The singular forms take `(range, criterion, [values])`, with the values range defaulting to the range. A lone scalar range reads as a one-cell range.

**Parsing a criterion** (`parseCriterion(raw, numericRange)`):

1. A blank criterion is "equals blank". A number or logical is "equals" that value. An error is the answer.
2. Text may start with a comparison prefix, tried in the order `<>`, `>=`, `<=`, `=`, `>`, `<`. Nothing after the prefix means blank, so `"<>"` is "not blank".
3. The rest reads as `TRUE` or `FALSE` (exact case), then as a number.
4. When the range is numeric (it holds a number and no non-empty text), date-shaped text compares as its serial through `parseDate`. An ambiguous day-month text is `#AMBIGUOUS!`, never a guess.
5. Otherwise the criterion is text. With `=` or `<>` (or no prefix), `*` and `?` are wildcards, and `~` escapes the next character.

**Matching a cell** (`criterionMatches`): an error cell never matches. A blank criterion matches a blank cell (null or empty text), and "not blank" matches the rest. A blank cell otherwise matches only a `<>` criterion. A logical criterion matches only logical cells. A number criterion compares with number cells, and also with text that reads as a number (`decimalFromText`), as Excel's SUMIF does; logical cells never match it. Text compares case-insensitively: a wildcard pattern matches the whole cell, and the ordering prefixes compare lowercased text by UTF-16 code unit (`compareStrings`, [[C45]] excelComparisons).

**Aggregating** (`criteriaAggregate(kind, values, pairs)`): the ranges and the values range zip to the shortest length, and a row counts when it matches every criterion. An error in a matched value cell is the answer, as in Excel. A value cell contributes when it is a finite number or text that reads as one (AVERAGEIF over "10" and "30" is 20, never "1030"); other text is ignored. COUNT counts matched rows; SUM of nothing is 0; AVERAGE of nothing is `#DIV/0!`; MIN and MAX of nothing are 0, as in Excel.

### Deliberate differences from Excel

Each of these is a named divergence ([[B16]] oneFormulaSurface), kept because consistency across the graph beats matching a quirk ([[C46]] consistencyOverQuirks):

- A blank IF branch stays blank; Excel reads it as 0.
- `0^0` is 1; Excel answers `#NUM!`.
- DATE's year is literal: 26 is the year 26, never 1926.
- DATEDIF's `MD` is never negative; Excel's goes negative across a short month.
- VALUE does not parse date or time text.
- The IM* functions answer tagged complex values, zip lists pairwise, and answer IMARGUMENT(0) as 0; unparseable complex text is `#VALUE!` rather than `#NUM!`.
- EXPAND's default padding is blank rather than `#N/A`.
- CHAR and CODE are UNICHAR and UNICODE, the CHAR / CODE card's full-Unicode reading; Excel's stop at 255 and use the system code page.
- SEQUENCE and RANDARRAY with zero rows or columns are an empty list; Excel, which has no empty array, answers `#CALC!`. TAKE and DROP keep the error, as `#DOMAIN!`, because an empty take there is almost always a wrong count.
- The TAKE / DROP card reads a count of 0 as "left out", keeping the whole axis; Excel's TAKE of 0 is `#CALC!`, and so is the formula's (`#DOMAIN!`).
- XMATCH and XLOOKUP refuse wildcard and binary search modes.
- Excel's `#NUM!` is split into `#DOMAIN!`, `#OVERFLOW!` and `#CONV!`; `ERROR.TYPE` still reports all three as 6. A percentile outside its domain, taking nothing or dropping everything, and an XIRR date before the first are `#DOMAIN!`.
- A sample statistic with too few values (SKEW below 3, KURT below 4, SEM and CV below 2) is blank rather than `#DIV/0!` ([[D70]] nullNotEnoughData), and so are AVERAGE and MEDIAN of no numbers and LARGE or SMALL with k past the count (Excel: `#DIV/0!`, `#NUM!`); STDEV.S and VAR.S of one value stay `#DIV/0!`, as in Excel, and so does AVERAGEIF(S) with no matching row.
- LOG2 of a value at or below 0 is blank.
- FORECAST.ETS uses its own parameter search, so its values are close to Excel's but not identical.

## Shared kernels

The kernels are the rete-free modules under `src/graph/nodes/` that a node's `data()` and a formula registration both call, so the two surfaces cannot answer differently ([[C17]] shareImpl, [[D19]] implReteFree). They never import rete; a kernel that would need something from a rete-reaching module takes it as an argument instead. Each takes plain values and answers a value, null for "no answer" (shown as a blank), or a `SolError` for a real domain failure. The caller, node or formula, prepares the inputs and tags its own failures.

### List kernels (`nodes/listOps.ts`)

A `Cell` is a number, `null` or a `SolError`; `firstError` returns the first `SolError` in a list. Two policies recur. A **position-preserving** op keeps each null in its slot and carries a cell error along in place. A **reduction** (a statistic, or a scale computed from the whole list) answers the first error in the list and skips nulls.

**Shape: list in, list out** (position-preserving unless noted)

| Kernel | Behavior |
|---|---|
| `sliceList(arr, start, end?)` | 1-based and inclusive, like the node's Start and End fields. An omitted `end` runs to the end of the list. |
| `nthElement(arr, n)` | Every nth element from the first; `n` rounds and is at least 1, so 1 is the identity. |
| `interleave(a, b)` | Alternates a and b. The shorter list pads with null to the longer one's length, so the alternation stays aligned and no tail element drops. |
| `padList(arr, n, fill, dir)` | Pads to length `round(n)` on the right or left; a list already that long is returned unchanged. |
| `diffList` | Successive differences, one shorter than the input. A missing neighbor makes that difference null; an error propagates into each difference it touches. |
| `pctChangeList` | `(x[i] − x[i−1]) / x[i−1]`, one shorter. A missing neighbor is null, a zero base is `#DIV/0!`, an error propagates as in `diffList`. |
| `normalizeList` | Rescales to 0–1 by the list's own minimum and maximum; a flat list is all zeros. The scale is a reduction; a cell that is not a finite number stays null in place. |
| `zscoreList` | `(x − mean) / sd` with the population standard deviation; a flat list is all zeros. Same policy as `normalizeList`. |
| `shiftList(arr, k, wrap)` | Moves each element `round(k)` places later (negative is earlier). Vacated slots are null, or with `wrap` are filled from the elements that fell off the other end, like `numpy.roll`. |
| `binIndex(arr, breaks, rightInclusive)` | For each value, how many sorted breakpoints lie at or below it: 0 is below the first break, so n breaks give bins 0 to n. An edge belongs to the bin above it (`numpy.digitize`); with `rightInclusive` only edges strictly below count, as in pandas `qcut`. Errors pass through; other non-numbers are null. |
| `combinationsOf(arr, k, kind)` | Every k-length combination (order-free) or permutation (ordered), one row each. k below 0 is `#VALUE!`; k above the length is `[]`. The count is computed first, multiplicatively so no factorial overflows, and above `COMBO_CAP` (10,000) the answer is `#OVERFLOW!` rather than an enormous table. |
| `gradientList(arr, dx)` | Central differences inside, one-sided differences at the ends, same length; a missing neighbor makes that entry null, and fewer than two cells are all null. Any error answers that error. |
| `ewmaList(arr, alpha)` | `y[0] = x[0]`, `y[i] = α·x[i] + (1 − α)·y[i−1]`. A blank carries the previous value forward (null before the first number). Alpha outside (0, 1] is `#DOMAIN!`, as pandas refuses it; clamping would silently return the input. Any error answers that error. |
| `trapzList(arr, dx)` | Trapezoidal area with uniform spacing. Any gap or non-number is `#VALUE!`; fewer than two points is 0. |
| `convolveList(a, b)` | Full linear convolution, length `a + b − 1`; a blank counts as zero; an empty operand gives `[]`. |
| `rleEncode` | Each run of equal consecutive values (compared by `setKey`) becomes a row `[value, count]`. |
| `crossProduct(a, b)` | The 3-D cross product of each side's present numbers; each side must have exactly three, else `#SHAPE!`. |
| `polyfitEval(xs, ys, degree)` | Least-squares polynomial fit, evaluated back at each x. It solves the normal equations by Gaussian elimination with partial pivoting (a pivot below 10⁻¹² is singular, `#SOLVE!`). The fit uses the pairs where both x and y are present, so a blank drops its pair and never shifts the pairing. The result follows xs: each present x gets its fitted value, a missing x stays null. No pairs gives all null; fewer than `degree + 1` points is `#VALUE!`. |
| `running(op, arr, window)` | One aggregate per cell over the window ending there. Ops: `sum`, `avg`, `min`, `max`, `median`, `product`, `stdev` (sample). A null window, or one below 1, grows from the start (cumulative); otherwise the last `round(window)` cells slide, running short at the start. An error in the window is that cell's answer, so in cumulative mode it answers every later cell too. Nulls are skipped; an empty window is 0 for `sum` and null otherwise; `stdev` of fewer than two numbers is null. |

**Find: list in, scalar or positions out**

| Kernel | Behavior |
|---|---|
| `argsortList(arr, desc)` | 1-based positions that would sort the numbers, stable on ties. Blank, error and non-numeric cells go to the end in either direction, in their original order. |
| `whichPositions` | 1-based positions of the true cells: `TRUE`, a nonzero finite number, or non-empty text. Blanks and errors never count. |
| `argMinMax` | 1-based position of the first maximum or minimum, under the reduction policy; null when there is no number. `ARG_LIST_OPS` (`argsort`, `argsort_desc`, `which`) answer a list, so the card's output retypes between number and list. |
| `lookupEq` | Excel's lookup equality: two strings compare case-insensitively (EXACT is the case-sensitive escape), everything else with `===`. |
| `xmatchIndex(lookup, keys, matchMode, searchMode)` | The kernel behind the XMATCH node and the XMATCH and XLOOKUP formulas. Answers the 0-based index of the winning key, or −1. Null and error keys never match, so an error at a position the lookup never picks cannot decide the answer. `searchMode: "last"` scans from the end, which decides which duplicate wins. The approximate modes (`next_larger`, `next_smaller`) need a finite numeric lookup value (`#VALUE!` otherwise), skip non-numeric keys, return an exact hit at once, and otherwise take the closest key above or below, keeping the first one in scan order on a tie. This mirrors the frame kernel `lookupFrameRowIndex`. |
| `containsValue` | Membership by value (`setKey`, [[D39]] keyByValue); blank and error cells are never members. Returns a boolean. |

**Weighted statistics.** `weighted(op, values, weights)` pairs values with weights by position and skips a pair when either side is missing; an error in either list is the answer. No values, fewer weights than values, no pairs, or a zero weight sum answer null. `wavg` is `Σw·x / Σw`. `wvar` is the reliability-weight form `Σw·(x − μ)² / (Σw − Σw²/Σw)`, null when that denominator is not positive, and `wstdev` is its square root. A non-finite result is null.

**Build: scalars in, list out.** These kernels are uncapped; each surface applies `MAX_GENERATED` (1,000,000) at its own boundary and answers `#OVERFLOW!` past it, rather than a kernel silently truncating.

- `linspace(start, end, count)`: `round(count)` evenly spaced points including both ends; 0 or fewer is `[]`, and 1 is `[start]`.
- `repeatValue(value, count)`, `geometric(start, ratio, count)` (`start·ratioⁱ`) and `sequenceList(count, start, step)` (`start + i·step`, count floored).
- `fibonacci(count)`: 1, 1, 2, 3, …, capped at 78 terms, because F79 exceeds 2⁵³ and would silently start rounding.
- `rangeCount(start, stop, step)` and `rangeList`: inclusive `[start, stop]`, `step` apart, so the series ends on Stop, unlike `numpy.arange` ([[C110]] rangeIncludesStop). An unset stop means no series yet (count 0), not a blank. A zero step gives one value when start equals stop and an infinite count otherwise; the count is `floor((stop − start)/step + 10⁻⁹) + 1`, at least 0, and is what callers cap on, since Range has no Count field. Each value is `start + i·step`, never accumulated, and the last snaps exactly onto Stop when within `|step|·10⁻⁹`, so 0 to 1 by 0.1 ends on 1.
- `concatLists`: end to end, staying 1-D; a missing list contributes nothing.

**Sets.** Membership is by value ([[D39]] keyByValue): `setKey` turns a complex value into a canonical string and leaves every primitive as itself. Blank and error cells equal nothing, so they are never members.

- `setOperation(op, a, b)` (`union`, `intersect`, `difference`, `symdiff`): results in first-seen order, deduplicated as UNIQUE does, blanks dropped. An error cell matches nothing, so union, difference and symmetric difference pass it through where it sits; intersect drops it.
- `setRelation(op, a, b)` (`equal`, `subset`, `superset`, `disjoint`) compares the member sets. The empty set follows set theory: it is a subset of anything, disjoint from anything, and equal to itself.

**Fill and Coalesce**, the explicit opt-in to treat a missing value as something (`fillList`):

- `constant` fills every gap with the value; `ffill` carries the last value forward (leading gaps stay null); `bfill` carries the next value back (trailing gaps stay null).
- `mean`, `median`, `mode` fill with that statistic of the present finite numbers (`imputeStat`); with none present the gaps stay null. The mode is the first value to reach the highest count.
- `interpolate` fills interior gaps only, linearly between the finite neighbors; a run at either end, or bounded by an error, stays null.
- `drop` removes the missing cells.
- `coalesce` takes, per position, the first non-missing value from the list and then each fallback in order. A list fallback extends the result to its length, a bare number broadcasts without extending, and a null fallback contributes nothing.

**Shuffle.** `shuffleList(arr, keys)` sorts by caller-supplied keys, so volatility stays with the caller: the node holds its keys until the next recalc, and the SHUFFLE formula draws fresh ones each evaluation. `weightedShuffleKey(u, w)` is `−ln(u)/w` with `u` clamped inside (0, 1); sorting ascending gives the Efraimidis–Spirakis weighted order, where an element's chance to land first is proportional to its weight. A non-positive or non-finite weight is an infinite key and sinks to the end.

**Array-returning core** ([[C15]] matricesInFormulas):

- `uniqueList`: first-seen order, deduplicated by value; every error cell survives, so the count of errors to fix is deterministic.
- `sortNumericList(arr, desc)`: numeric and stable; nulls and errors sort last in both directions, since a bare compare would read null as 0 and scatter it mid-list.
- `sortByKeys(arr, by, desc)`: reorders by parallel numeric keys; ragged lists pad to the longer with null; a null or error key sends its row to the tail, stably, in either direction.
- `takeSlice`, `dropSlice`: signed counts, positive from the start and negative from the end, 0 the identity. One kernel serves the 1-D nodes, the 2-D node per axis and the formulas.
- `filterByMask(arr, mask)`: keeps cells whose mask is `TRUE` or a nonzero number; an error in the mask is the answer. Matching sizes are the caller's check.
- `modeMult`: every value with the top count, when that count is at least 2, in first-seen order, keyed by value; blanks are ignored and an error is the answer; no repeated value gives `[]`.
- `frequencyBins(data, bins)`: counts per interval `(previous bin, bin]` in sorted order, reported in the bins' given order, plus one overflow count for values above every bin. Errors in either list are the answer.
- `ntileList(arr, n)`: quantile buckets 1 to n with right-inclusive edges, like pandas `qcut`. The edges are the PERCENTILE.INC quantiles at k/n, and a value on an edge stays in the lower bucket. Position-preserving; n below 1 is `#VALUE!`.
- `outlierFlags(arr, method, threshold)`: `z` flags `|x − mean| / sd > t` (sample standard deviation, default 3); `iqr` flags values beyond `Q1 − t·IQR` or `Q3 + t·IQR` (default 1.5); `mad` flags a modified z-score `|0.6745·(x − median) / MAD| > t` (default 3.5). The defaults are `OUTLIER_DEFAULT_THRESHOLD`. A blank stays null and an error passes; fewer than three numbers, or zero spread, flag nothing (all `FALSE`).
- `fftReal(x)`: the discrete Fourier transform of a real list at any length, as `{ re, im }`. A power-of-two length uses iterative radix-2 Cooley–Tukey; any other length uses Bluestein's chirp-z through a power-of-two FFT of size at least 2n − 1, so no padding changes the answer.
- `spectrum(x, rate)`: the one-sided amplitude spectrum, bins 0 to ⌊n/2⌋, frequency `k·rate/n`, phase in radians. Magnitudes are scaled by 2/n (1/n at DC, and at Nyquist for an even length) so a pure sine of amplitude A reads A. A blank in the signal counts as 0.

### Statistics kernels (`nodes/statsOps.ts`)

The Aggregate, Rank & Percentile, Correlation, Covariance, Mode, Fisher and Hypothesis Test nodes and the statistics formulas call these. Inputs are already-prepared numbers: errors propagated and blanks skipped by the caller. Null means the input cannot support the statistic (too few points, a flat list) and shows as a blank ([[D70]] nullNotEnoughData); a `SolError` is a real domain failure.

**`aggregate(op, nums)`**, the Aggregate node's reducers:

- An empty list answers the identity for `sum` (0), `count` (0) and `product` (1), and null for every other op.
- `stdev` and `var_s` (sample) of a single value are `#DIV/0!`, as in Excel. `stdev_p` and `var_p` are the population forms.
- `skew` needs 3 values, `skew_p` 2 and `kurt` 4; below that, or with zero spread, they are null. `skew` and `kurt` are Excel's sample-adjusted forms.
- `geomean` and `harmean` over any value at or below 0 are `#DOMAIN!`.
- `countdistinct` counts distinct numbers; `sumsq`, `devsq` and `avedev` are Excel's.
- The Solenoid-only reducers: `ptp` (max − min), `iqr` (Q3 − Q1 with PERCENTILE.INC quartiles), `mad` (the median absolute deviation, unscaled, as scipy does; R's `mad` scales by 1.4826), `sem` (sample sd / √n, null below 2), `cv` (sample sd / mean, null below 2, `#DIV/0!` for a zero mean), `rms`.

**Percentiles and ranks.**

- `percentileOf(sorted, p, exc)` interpolates at index `p·(n − 1)` (inclusive) or `p·(n + 1) − 1` (exclusive) of a sorted list.
- `percentile` applies Excel's domains: INC needs 0 ≤ p ≤ 1, EXC needs p between 1/(n + 1) and n/(n + 1). Outside is `#DOMAIN!` (Excel's `#NUM!`). An empty list is null.
- `quartile` is the percentile at `round(q)/4`; q outside 0 to 4 is `#DOMAIN!`. INC's quartile 0 is the minimum and 4 the maximum; EXC refuses 0 and 4, and at small n an interior quartile can still fall outside the EXC domain.
- `nthExtreme` is LARGE and SMALL: the k-th largest or smallest, 1-based; k out of range is null.

**Correlation and regression** over paired numbers (the caller has already dropped pairs with a blank), using the shorter list's length:

- `pearson` (CORREL, and RSQ with `rsq`): fewer than two pairs is null; zero variance in either list is `#DIV/0!`.
- `averageRanks` gives tied values the mean of their ranks; `spearman` is Pearson over those ranks.
- `kendallTau` is τ-b with the tie correction, O(n²); a list that is all ties is `#DIV/0!`.
- `covariance` (COVARIANCE.P, and .S with `sample`): fewer than two pairs is null.
- `regression` (SLOPE, INTERCEPT, STEYX) is the least-squares line: fewer than two pairs is null, zero X variance `#DIV/0!`, and STEYX, with its n − 2 denominator, needs three points (null below).

**Mode and Fisher.** `modeSingle` is Excel's MODE and MODE.SNGL: the most frequent value, and among ties the one that occurs first in the data; empty is null. `modes` is the node's form: one mode as a number, a tie as every tied value ascending. `fisher` is `atanh`, defined only on (−1, 1) (`#DOMAIN!` outside); the inverse is `tanh`.

**Hypothesis tests beyond Excel's four.** Each answers a two-sided p-value (ANOVA and Kruskal–Wallis: the upper tail of F or χ²), and null when the data cannot support the test: too few points, no variance, an empty group. Conventions follow R and scipy where they agree.

| Kernel | Test |
|---|---|
| `anovaP(groups)` | One-way ANOVA over the non-empty groups; needs at least two groups and more values than groups. Zero within-group spread answers 0, or null when the between-group spread is zero too. |
| `mannWhitneyP(a, b)` | Mann–Whitney U (Wilcoxon rank-sum), normal approximation with tie and continuity corrections (R `wilcox.test` for larger samples, scipy `mannwhitneyu` asymptotic with continuity). |
| `wilcoxonSignedRankP(a, b)` | Wilcoxon signed-rank on paired differences, zero differences dropped, normal approximation with tie and continuity corrections. |
| `kruskalP(groups)` | Kruskal–Wallis H, tie-corrected, χ² upper tail with k − 1 degrees of freedom; needs two groups and three values. |
| `fisherExactP(a, b, c, d)` | Fisher's exact test on the 2×2 table `[[a, b], [c, d]]`: the sum of every table probability no larger than the observed one (within a relative 10⁻⁷). Cells round; a negative or non-finite cell, or an empty table, is null. |
| `ksTwoSampleP(a, b)` | Two-sample Kolmogorov–Smirnov, exact: the probability that a random interleaving of the two samples keeps every ECDF gap below the observed D. D is kept as the integer `|i·n₂ − j·n₁|` and the probability comes from a lattice-path count on that integer grid, O(n₁·n₂), so no asymptotic approximation is needed. D of 0 answers 1. |
| `twoProportionP(x1, n1, x2, n2)` | Two-proportion z-test with the pooled standard error and no continuity correction (statsmodels `proportions_ztest`, R `prop.test(correct = FALSE)`). A zero standard error answers 0, or null when the proportions are equal. |
| `binomTestP(k, n, p0)` | Exact binomial test: the sum of every outcome probability no larger than the observed one. p₀ of 0 or 1 answers 1 when k matches it and 0 otherwise. |

### Numeric kernels (`nodes/mathUtils.ts`)

- `iterMin`, `iterMax`: minimum and maximum over any iterable; empty input gives `Infinity` and `-Infinity`, as `Math.min()` does. Use these on user data, never `Math.min(...arr)`, whose spread throws `RangeError` past about 125,000 elements.
- **Special functions.** `lnGamma` is the Lanczos approximation (g = 7), with the reflection formula below 0.5 and `Infinity` at or below 0. `regularizedGamma(a, x)` is P(a, x), by the series for x < a + 1 and a Lentz continued fraction otherwise. `regularizedBeta(x, a, b)` is Iₓ(a, b) by a Lentz continued fraction, using `Iₓ(a, b) = 1 − I₁₋ₓ(b, a)` to stay where it converges. Both answer NaN for arguments outside their domain.
- **Normal distribution.** `stdNormCDF` is W. J. Cody's rational Chebyshev algorithm (ACM TOMS 715, the one R's `pnorm` runs): three ranges, double-precision relative error, exactly 0.5 at 0, and a tail that stays accurate where an erf-based form underflows. `normSInv` is Peter Acklam's rational approximation (error below 1.15 × 10⁻⁹) refined by one Halley step against `stdNormCDF`, for full precision.
- `bisectionInv(cdf, p, lo, hi)` inverts a non-decreasing CDF on [lo, hi] by bisection (up to 200 steps, to 10⁻¹⁰); p at or below 0 answers `lo`, at or above 1 `hi`.
- **Continuous distributions** Formula.js lacks, shared by the Distribution node and the formulas: `tCDF` (through the incomplete beta), `tPDF`, `chiSqCDF`, `fCDF`, and `gammaCDF`, `gammaPDF` with a scale parameter (Excel's β). The CDFs and the gamma PDF are 0 at or below the origin. The CDFs also back every inverse form through `bisectionInv`.
- **Fits.** `linearFit(xs, ys)` is the least-squares line over the shorter list's length; fewer than two points, or Xs with zero variance, answer null so each surface tags its own error. `linearFitR2` adds R², which is 0 when Y has zero variance. `expFit` fits `y = b·mˣ` by least squares on ln y and answers null when any y is at or below 0 or the log fit is undefined; `expFitR2` adds R² on the log scale (Excel's LOGEST with stats).
- `interpolateLinear(xs, ys, queryXs)`: piecewise-linear over the pairs sorted by x (the shorter list's length). A query past either end takes the end value; a NaN query stays NaN; no pairs give NaN everywhere. Two points with the same x have no gap between them, so the step between them has zero weight.
- `pairPresent(xs, ys)`: the paired policy. The first error cell in either list is the answer; a pair with a null on either side drops; the longer list's tail is cut.
- **Hypothesis tests.** `tTestP(kind, a, b)` is the two-tailed Student-t p-value: `paired` uses the differences over the shorter length; `equal-var` the pooled variance; `unequal-var` Welch's t and degrees of freedom. It answers null when a sample has fewer than two values, the variance is zero, or t or df is not finite, and clamps p to [0, 1]. `fTestP` is Excel's F.TEST, the two-tailed p-value that the variances differ, null under the same guards. `probBetween(range, probs, lo, hi)` is Excel's PROB: the total probability of the values in [lo, hi] under the paired policy, clamped to [0, 1], null with no pairs.
- `gridAxes` and `fillGrid` are the Interpolate card's grid mode and INTERPOLATE's matrix form; [[bordered-grid-fill]] owns them.
- `polyRoots(coeffs)`: every complex root of a polynomial with coefficients highest degree first (`numpy.roots` order), as `[re, im]` pairs in no set order. Leading zeros drop; a constant has no roots (`[]`); an empty or non-finite input answers null. It runs Durand–Kerner iteration (up to 500 rounds) from starting points on a circle whose radius comes from the coefficient bound, then up to four Newton steps per root; a Newton step that would move the root far is refused, so polishing never wanders. Finally, parts tiny relative to the root's size snap to 0: 10⁻¹² for the real part and 10⁻⁷ for the imaginary part, because a multiple root converges only linearly and leaves residuals near 10⁻⁹, and a double root should read as two reals, as in numpy.

### Distribution table (`nodes/distributionOps.ts`)

Every probability distribution sits behind one Distribution card ([[C61]] oneDistributionNode): the op picks the distribution (`DistKey`), and the form picks the curve or the inverse. `DIST_SPECS` holds, per distribution, its label, group (Continuous or Discrete), Excel names, forms (the first is the default), the first input's key, label and default, the inverse form's input label (`probLabel`, default "Probability"), its parameters with defaults, and `compute(form, value, params)`. The distribution formulas call the same `compute`, so the card and the formula answer identically.

- **Forms** (`DIST_FORM_META`): `cdf` (P(X ≤ x)), `pdf`, `pmf` (P(X = k)), `2t` and `rt` (two-tailed and right-tail probability), `inv` (the quantile), `inv2t`, `invrt`, `sample` (N random draws, re-rolled each recalculation), and `half` (Φ − ½, the area from 0 to x). An inverse form (`isInverseForm`: any form starting with `inv`) reads a probability; every other form reads an x.
- `compute` answers null for a domain refusal, never a fabricated number: invalid parameters, a probability outside (0, 1) for an inverse. The broadcaster guards finiteness centrally.
- PHI and GAUSS are standard-normal forms, not distributions: PHI is the density, and GAUSS is Φ − ½, a half-area, so its form is `half` and is never labeled a CDF.
- The discrete CDFs are 1 above their support and 0 below it, not blank: BINOM and POISSON above the top, and HYPGEOM beyond `min(n, M)`. Invalid parameters have no distribution at all and are blank. The binomial CDF is `I₁₋ₚ(n − k, k + 1)` through the regularized incomplete beta. BINOM.INV is the smallest k whose cumulative probability reaches alpha, or n when none does.
- `formAfterSwitch(form, next)`: switching distribution keeps the form when the target has it, else takes its natural sibling (PDF and PMF across the continuous and discrete line; any inverse variant to plain `inv`), else the target's default.
- `sampleQuantile(key, u, params)` is one draw for the `sample` form, from a uniform `u` clamped into (10⁻¹², 1 − 10⁻¹²): a distribution with an inverse form uses it; a continuous one without (Weibull, exponential) is inverted by bisection on its CDF over [0, 10⁶]; a discrete one (Poisson, hypergeometric, negative binomial) walks k up from 0 until the CDF reaches `u`. Invalid parameters answer null.

### Finance kernels (`nodes/financeOps.ts`)

The finance nodes and the finance formulas share these kernels. Entry points take date serials. Invalid input (a missing date, a frequency other than 1, 2 or 4, an out-of-range argument) answers null, never a throw or a fabricated number, and each surface tags its own failure. The formulas pass Excel's argument order; an omitted `basis` is 0, `frequency` 2, `par` 1000 and `redemption` 100.

**Day counts.** `days30_360` is the US 30/360 rule: a start on the 31st counts as the 30th, and an end on the 31st counts as the 30th when the start is the 30th or 31st. `actualDays` counts real days. Basis 0 and 4 use 30/360; every other basis counts real days. `basisDays` is the year length: 365 for basis 3, 365.25 for basis 1, 360 otherwise.

**Coupon periods.** `coupDates` finds the coupon period around settlement by stepping back from maturity by `12/freq` months. `coupPeriodDays` gives that period's day counts under a basis: `e` is the whole period (Excel's COUPDAYS), `dsc` settlement to the next coupon (COUPDAYSNC), `dsbs` the previous coupon to settlement (COUPDAYBS). On a 30/360 basis `e` is `360/freq` and `dsc` is `e − dsbs`; on basis 3 `e` is `365/freq`; otherwise all three are actual days. The COUP* family and DURATION's first-period fraction both read this one definition. `couponValue` answers the COUP* ops; COUPNCD and COUPPCD answer date serials, COUPNUM counts the coupons from the next one through maturity.

**Bonds.**

- `bondPrice` (PRICE) prices on 30/360: the dirty price discounts the redemption and each coupon at `y = yield/freq` over `k − 1 + DSC/E` periods, less the accrued `C·A/E`. With one coupon period or less to maturity, Excel's PRICE switches to simple interest: `(redemption + C) / (1 + (DSC/E)·y) − C·A/E`.
- `solveYield` finds the yield that gives a target price by Newton's method from the coupon rate (or 0.05), with a numeric derivative, at most 100 steps, and each step clamped to [−0.9999, 100] so a bad price cannot diverge. YIELD, ODDFYIELD and ODDLYIELD use it.
- `durationValue` (DURATION, MDURATION) is the Macaulay duration in years, and the modified duration divides by `1 + y`. The fraction of the first period still to run is `dsc/e` from `coupPeriodDays`, day-counted per the basis.
- `oddfPrice` (ODDFPRICE) uses Excel's quasi-coupon form for an odd first period, long or short (a short one is the case of one quasi period): the first coupon accrues from issue across the quasi periods, on 30/360 only. Settlement on or after the first coupon prices as a regular bond.
- `oddlPrice` (ODDLPRICE): with settlement in the odd last period, the whole odd period is discounted with simple interest, `1 + (DSC/E)·y`, never compounded, as PRICEMAT does. Otherwise the regular coupons up to the last interest date are discounted, and the final cash flow lands one odd fraction `Nc` after them. ODDF ops read an issue date and a first-coupon date; ODDL ops read only a last-interest date.

**Accrued interest and discounted securities.**

- `accrint` (ACCRINT) accrues over issue to settlement; the period length is the real period only on basis 1, `365/freq` on basis 3 and `360/freq` otherwise. Excel's `first_interest` and `calc_method` arguments are not modeled. `accrintM` (ACCRINTM) accrues a security paying at maturity.
- `securityDisc` (DISC, INTRATE, RECEIVED): RECEIVED answers null when its denominator `1 − discount·DSM/B` is zero or negative (Excel's `#NUM!`), never a fabricated 0. Maturity on or before settlement is null.
- `priceDisc` (PRICEDISC, YIELDDISC) uses a 365-day year on basis 3 and 360 otherwise.
- `priceMat` (PRICEMAT, YIELDMAT) spans three periods: issue to maturity for the total interest, settlement to maturity for discounting, and issue to settlement for the accrued interest deducted from the price.
- `tbill` (TBILLPRICE, TBILLYIELD, TBILLEQ) counts actual days over 360. TBILLYIELD is a money-market yield on 360 days. TBILLEQ uses `365·rate / (360 − rate·DSM)` up to 182 days; past 182 days Excel switches to the bond-equivalent yield, the semiannual-compounding price equation solved in closed form.

**Depreciation.** `vdb` (VDB) is the depreciation between two periods: each period takes the larger of the declining-balance charge (`book·factor/life`) and straight-line over the remaining life, never below salvage, with a fractional period charged pro rata. Out-of-range arguments are null. The VDB formula refuses Excel's `no_switch` of TRUE with `#VALUE!`, since the kernel always switches to straight-line.

**Cash-flow preparation** ([[D24]] prepByShape):

- `cashPrep`: an error cell is the answer; then a null cash flow is 0, never dropped, because dropping it would shift every later period.
- `datedPrep`: an error in the values or dates is the answer ([[D37]] errorBeatsMissing); null cash flows are 0; a null date makes the whole schedule unknown (`blank`).

**The discount-rate solver.** `solveDiscountRate(values, exponents)` finds the rate where `Σ vᵢ / (1 + r)^eᵢ = 0`. It is the one kernel behind the IRR node's two modes and the IRR and XIRR formulas ([[C17]] shareImpl). Periodic IRR's exponents are the period indices; XIRR's are year fractions from the first date (days / 365). That is the only difference between the two. Null means no root above the floor, and each surface tags its own `#CONV!`.

1. **Newton** (`newtonDiscountRate`) starts at 0.1 and runs up to 100 steps. Each step is clamped at `RATE_FLOOR` (−0.9999): below r = −1 a fractional exponent makes the discount NaN and an integer one flips its sign every period, so an overshoot never walks back. A step that hits the floor never counts as converged, or a solve pinned there would read as a settled root of −0.9999. Convergence is relative (`|Δ| < 10⁻¹² · (1 + |r|)`), because the root is unbounded: 0.05 and a runaway 31,000 are both real answers. A flat derivative (below 10⁻¹⁵) or no convergence answers null, which means Newton stalled, not that no root exists.
2. **Bracket and bisect** (`bracketDiscountRate`) runs only when Newton stalls, so it never overrides which of several roots Newton picked. It is for the roots Newton cannot reach from 0.1, chiefly one crowded against the floor (near −0.95), where the curve is nearly vertical. It scans `1 + r` on a log grid of 2,000 steps from the floor out to r = 10⁷, so the decade near the floor is sampled as densely as the rest and runaway rates stay bracketed. The first sign change scanning up from the floor is bisected (up to 200 steps, to a relative width of 10⁻¹³). No sign change at all answers null.

**MIRR** (`mirr`) works on periodic flows already zeroed by `cashPrep`: negatives are discounted at the finance rate and positives compounded at the reinvestment rate. It needs at least one of each sign, else `#DIV/0!` (Excel's code); a non-finite result is `#OVERFLOW!`.

**Amortization.** `amortizationSchedule(rate, nper, pv, fv, type)` builds the level-payment table (Excel's PMT, IPMT and PPMT per period). A positive `pv` is a loan received, so payment, interest and principal come back negative, as in Excel; `balance` is the principal remaining after each period and ends at `−fv`. Interest is Excel's IPMT: interest on the balance after k − 1 payments. With `type` 1 the payment lands at the start of the period, so period 1 bears no interest and later periods' interest is discounted one period. A zero rate (below 10⁻¹² in magnitude) divides evenly. Fewer than one period, or a non-finite input, gives an empty table.

**Return series** (`returnsOp`, the Returns card's dispatcher; `RETURNS_OP_META` says which ops answer a list and which a scalar, and which take prices or returns):

- `log` and `simple` returns per period (`periodReturns`): the first is blank, as is a period with a blank on either side or a zero previous price; an error passes in place.
- `cumulative` (`Π(1 + r) − 1` so far): a blank return compounds as 0 but stays blank in its slot.
- `drawdown` (`pₜ / running max − 1`, at most 0): blanks stay blank and do not move the peak. `maxdrawdown` is the deepest one.
- `cagr`: `(p_last / p_first)^(periodsPerYear / periods elapsed) − 1` over the present prices; fewer than two is null, a non-positive price `#DOMAIN!`.
- `volatility`: the sample standard deviation of the returns times `√periodsPerYear`.
- `sharpe` and `sortino` work on excess returns `r − rf`, where `rf` is the risk-free rate per period and `periodsPerYear` annualizes. Sharpe divides by the sample standard deviation, Sortino by the downside deviation (the root mean square of the negative excess returns). Zero spread is `#DIV/0!`; fewer than two returns is null.

### Date kernels (`nodes/dateSerial.ts`, `nodes/dateOps.ts`)

**The serial model.** A date is an Excel-style serial: serial 1 is 1900-01-01, so the Unix epoch is serial 25569, and the fraction is the time of day. `serialToJsDate` and `jsDateToSerial` convert, and every reader uses the UTC getters, so a serial is the same calendar day on every machine ([[C44]] dateSerials). `DEFAULT_DATE_FORMAT` is `DD-MMM-YYYY` and `DEFAULT_DATETIME_FORMAT` is `DD-MMM-YYYY HH:mm`.

**`parseDate(text, opts)`** is the one text-to-date parser, behind DATEVALUE, Cast to date, Frame and Table date columns, Date Input and Get Column's read-as. It answers the serial, `#AMBIGUOUS!`, or NaN when the text is not a date. Time is kept, not floored. In order:

1. Trimmed empty text is NaN.
2. **Relative phrases** (`isRelativeDateText`: today, tonight, tomorrow, yesterday, now, next, last, this, coming, upcoming, ago, "from now", "in 3…", or a weekday name or abbreviation) are NaN unless `opts.relative` is set. Text with a four-digit year is never relative, so "Monday, 16 March 2026" is a fixed date. With `relative` on, chrono resolves the phrase against `opts.now` (default the wall clock), looking forward ("friday" is the coming one), and the answer is that local calendar day as a UTC serial. Only an opted-in Date Input passes `relative` ([[D54]] relativeDatesOptIn).
3. Text without a four-digit year is NaN: there is no two-digit-year century pivot in any form.
4. ISO date-only text (`YYYY-MM` or `YYYY-MM-DD`, with an optional sign and up to six year digits) goes through `new Date`, which reads it as UTC with no 0–99 century pivot (chrono would pivot "0026"). ISO text with a time goes on to chrono's zone handling.
5. A numeric day-month-year date (`NUMERIC_DMY`: one or two digits, a separator of `-`, `/` or `.`, one or two digits, a four-digit year) whose two leading parts are both 12 or less and differ is `#AMBIGUOUS!`, with a message asking for a month name (3-Apr-2026) or ISO. Where one part is above 12 the reading is forced; the parser never guesses.
6. Otherwise chrono-node parses (ordinals, month names, natural forms). The match must start at the beginning and be followed only by spaces, dots or commas, and day, month and year must all be certain; anything else is NaN.
7. An explicit zone designator is an absolute instant and is kept. A zone-less value is rebuilt as UTC from chrono's local components, so it means the same calendar wall-clock on every machine.

`parseDateToSerial` is NaN for every failure, an ambiguous date included; a surface that reports `#AMBIGUOUS!` calls `parseDate` instead.

`formatDateSerial(serial, pattern)` substitutes the tokens `YYYY`, `YY`, `MMMM` (full month name), `MMM`, `MM`, `M`, `DDDD` (full weekday), `DDD`, `DD`, `D`, `HH`, `hh`, `h` (12-hour), `mm`, `ss`, and `A` or `a` (AM/PM, am/pm), all in UTC; a non-finite serial prints as `String(serial)`.

**Date functions** (`dateOps.ts`). Entry points take serials. A per-cell domain failure is a `SolError`; an undefined answer, such as a DATEDIF unit over a reversed range, is null.

- `dateFromParts` (DATE): the year is literal, so 26 is the year 26, never 1926, a documented deviation from Excel. The year must be 1 to 9999 (`#DOMAIN!` otherwise); month and day overflow carries, and a day of 0 is the last day of the month before.
- `timeFraction` (TIME): the fraction of a day, wrapping past 24 hours as Excel does.
- `parseDateOnly` (DATEVALUE): the whole day of `parseDate`; `#AMBIGUOUS!` passes through and unparseable text is `#VALUE!`.
- `parseTimeOfDay` (TIMEVALUE): `h:mm`, `h:mm:ss` or with fractional seconds, with an optional AM or PM (hours 1 to 12 then, else 0 to 23), gives the 0–1 fraction. Anything else goes through `parseDateToSerial` and keeps the fraction of a full datetime; failure is `#VALUE!`. It never uses `new Date("1970-01-01T…")`, which reads zone-less text as local time and would vary by machine.
- `weekInfo` (WEEKDAY, WEEKNUM, ISOWEEKNUM): WEEKDAY's return type 1 is 1 Sunday to 7 Saturday, 2 is 1 Monday to 7 Sunday, 3 is 0 Monday to 6 Sunday. WEEKNUM's 1 counts Sunday-start weeks and 2 Monday-start weeks from 1 January. ISOWEEKNUM is the ISO 8601 week (weeks start Monday, week 1 contains 4 January) and ignores the return type.
- `dateDiff(op, start, end, basis)`:
  - `days` (DAYS) is signed.
  - `days360` is US 30/360 on basis 0 and European 30/360 on any other basis.
  - `yearfrac` (YEARFRAC): basis 0 is US 30/360 over 360, 1 is actual days over 365.25 (an approximation of actual/actual), 2 actual over 360, 3 actual over 365, 4 European 30/360 over 360.
  - The DATEDIF units (`dateDiffOpForUnit`: `D`, `Y`, `M`, `YM`, `MD`, `YD`, any case) are null over a reversed range. `MD` counts from the start day advanced by the whole months, clamped to that month's length (31 January plus a month is 28 February), so it is never negative. Excel's MD goes negative when the borrow crosses a short month (31 January to 1 March gives −2).
- `epochToSerial` and `serialToEpoch` (FROMEPOCH, TOEPOCH) convert Unix seconds or milliseconds since 1970-01-01 UTC.
- `dateTrunc(serial, unit, ceiling)` (DATETRUNC) floors to the start of its day, week (Monday, or Sunday for `week_sun`), month, quarter or year. `ceiling` answers the start of the next period instead, except that a value already on the boundary stays put either way. `dateTruncUnitFor` accepts `d`, `day`, `days`, `w`, `week`, `weeks`, `week_mon`, `monday`, `week_sun`, `sunday`, `m`, `month`, `months`, `q`, `quarter`, `quarters`, `y`, `year`, `years`, case-insensitive.

### Text kernels (`nodes/textOps.ts`)

Each kernel works on one string; the text nodes and the text formulas broadcast it. `textOps.ts` must not import `text.ts`, which imports `excelFunctions` and would pull rete into the formula path through the cycle ([[D19]] implReteFree). Lengths and positions count code points, not UTF-16 units.

- `splitText` (TEXTSPLIT): an empty delimiter splits into characters.
- `textAfterBefore` (TEXTAFTER, TEXTBEFORE): the text after or before the first occurrence of the delimiter. An empty delimiter, or one the text does not contain, answers null rather than the whole string.
- `urlEncode` (ENCODEURL, DECODEURL, ENCODEBASE64, DECODEBASE64): a malformed escape, or text that is not base64, passes through unchanged.
- **Regular expressions.** `regexApply(op, text, pattern, replacement, flags)` runs `test` (1 or 0), `extract` (the first match, or ""), `extract_all` (every match), `extract_groups` and `replace` (every match). An empty or unparseable pattern answers null, matching the node's whole-output behavior. `regexGroups` (REGEXEXTRACT return mode 2) answers the first match's capture groups as a list, and `[]` when the pattern has no groups or nothing matches. `replaceNth` (REGEXREPLACE with a nonzero occurrence) replaces only the nth match, 1-based, and leaves the text unchanged when there are fewer matches, as Excel does; `$1` backreferences work in the replacement.
- `ordinalText` (ORDINAL): the truncated whole number with its English suffix: 1st, 22nd, 113th.
- `spellNumber` (SPELLNUMBER): English words for any magnitude below 10¹⁵ (`#DOMAIN!` at or above, and for a non-finite number): "negative" for a negative, hyphenated tens ("twenty-one"), scale words up to trillion, and at most six decimal digits read one by one after "point".
- `reverseText` reverses by code point.
- **Similarity.** `levenshtein` is the edit distance (insert, delete, substitute). `damerauLevenshtein` is the optimal-string-alignment form, adding adjacent transposition. `jaroWinkler` is the Jaro–Winkler similarity with prefix scale 0.1 over up to 4 characters. `textSimilarity(a, b, method)` answers 0 to 1: `ratio` is `1 − levenshtein / longer length` (rapidfuzz's normalized Levenshtein), `damerau` the same with transpositions, `jaro_winkler` as is, and two empty strings are 1; `levenshtein` answers the raw distance, an integer. Every method is case-sensitive; trim and lowercase upstream when that is the intent.
- `fuzzyBest(needle, candidates, method, threshold)` (FUZZYMATCH): the candidate with the highest similarity, the first on a tie, with its score; null when none reaches the threshold or there are none. The `levenshtein` method scores as `ratio` here, since a distance cannot be compared with a threshold.
- `unaccent` (UNACCENT) strips combining marks after NFD decomposition, and spells the letters NFD cannot decompose in ASCII (`TRANSLIT`: ß to ss, æ to ae, ø to o, œ to oe, đ, ł, ð, þ to th, ı, ŋ to ng, and their capitals), the unidecode convention.
- `slugify(t, sep)` (SLUGIFY): unaccent, lowercase, every run of characters outside a to z and 0 to 9 becomes `sep`, and leading or trailing separators are trimmed.
- `padText(t, width, side, fill)` (PADTEXT): pads to `width` code points; `side` is where the padding goes (`left`, `right`, `center`, where center puts the odd extra on the right). The fill cycles, an empty fill is a space, and text already that long is unchanged.
- `truncateText(t, width, ellipsis)` (TRUNCATETEXT): cuts to at most `width` code points, ending in the ellipsis (default …) when anything was cut; when the ellipsis alone is wider than `width`, it is cut to fit.
- `wrapText(t, width)` (WRAPTEXT): greedy word wrap on whitespace to at most `width` code points per line. Words join with single spaces, runs of whitespace collapse, and a word longer than `width` sits alone on its line unbroken. `width` is at least 1; empty or all-blank text gives `[]`.
- **Templates.** The grammar is `{name}` or `{name:spec}`, where the name is an identifier (letters, digits, `_`, space, `.` and `-` after the first character) or a number, and `spec` is an Excel TEXT format code or a date format handed to the caller's formatter. `{{` and `}}` are literal braces. `templatePlaceholders` lists the distinct names in first-appearance order. `renderTemplate(template, lookup, fmt)` substitutes each placeholder through `lookup` and `fmt`. `templateFormat` is the standard `fmt`: a blank prints as "", an error as its code, a logical as `TRUE` or `FALSE`, a number through the injected number formatter (or the date formatter for a date-typed input), and a list as its elements joined with ", ".

### Matrix kernels (`nodes/matrixOps.ts`)

The matrix nodes and the matrix formulas share these; the nodes add unit tagging on top, and the kernels are pure shape and arithmetic.

- `matTranspose`, `matUnit(n, offDiag)` (the identity; `n` rounds, below 1 is empty), and `matDiag(values, offDiag)`: a list becomes the diagonal of a square matrix. The off-diagonal is 0 (as MUNIT) or null, a blank that stays out of sums; a null in the list is a blank diagonal cell.
- `outerProduct(a, b)`: the matrix of products `a[i]·b[j]`; a null in either operand blanks its whole row or column.
- `asNumericMatrix` is the numeric gate for linear algebra: a missing cell (null, undefined or "") is `#VALUE!`, because complete data is needed, and any other non-number is `#TYPE!`, since a table can deliver text into a matrix.
- `matMul` answers null when the inner dimensions differ or are 0. `matDet` and `matInverse` use elimination with partial pivoting (LU for the determinant, Gauss–Jordan for the inverse); a pivot below 10⁻¹⁴ is singular (null), as is a non-square matrix.
- `wrapCells(list, w, dir, pad)` wraps a list into rows of width `w`, or into `w` rows filled column by column. Leftover cells take `pad()`, which the formulas default to `#N/A` ([[C48]] appendLadder) so a `pad_with` argument overrides it cleanly.
- **Append ladder, selection and grow** ([[C48]] appendLadder). Shape construction pads with `#N/A` cells, never null; EXPAND's fill is the exception. `stackH` (HSTACK) glues matrices left to right, padding shorter ones down; `stackV` (VSTACK) stacks top to bottom, padding narrower ones right. A bare list arrives as one row, so VSTACK of two lists is a 2 × n grid. `chooseAxis` (CHOOSEROWS, CHOOSECOLS) selects by 1-based index, negative from the end, a fraction truncated toward zero; a zero or out-of-range index fails the whole call with `#VALUE!`.
- `expandMat(m, rows, cols, fill)` (EXPAND) grows to rows × cols, filling new cells with `fill`. A target of 0 (Excel's omitted) keeps that axis; shrinking is `#VALUE!`. The default fill is the caller's choice: the node and the formula pass null, the author's override of Excel's `#N/A` ([[value-semantics]]).
- `setCells(m, writes)` (the Set Cell node) overwrites cells by a 1-based (row, column) anchor. The input is first made a full grid (ragged rows pad with blank). Each write extends by its shape: a scalar (including null or an error) fills one cell, a list a row segment to the right, a matrix a block, like numpy's `A[r:r+h, c:c+w] = B`. An anchor, segment or block that runs past the table edge fails the whole result with `#REF!` in the shared `indexRefError` wording, naming the axis that overflowed; nothing is clipped. Writes apply in order, so a later write wins.
- `matTrace` sums the main diagonal. `matRank` is Gaussian elimination with partial pivoting, where a pivot within 10⁻¹⁰ of the largest entry counts as zero. `matNorm` is the Frobenius norm (default), the 1-norm (largest column sum), the ∞-norm (largest row sum) or the largest absolute entry.
- `matSolve(A, b)` solves `A·x = b` by Gaussian elimination with partial pivoting; null when A is singular (pivot below 10⁻¹²), not square, or b's length differs.
- `matEigh(m)` decomposes a symmetric matrix by cyclic Jacobi rotations (up to 100 sweeps): eigenvalues descending, eigenvectors as the unit-length columns of `vectors` in the same order, each with its largest-magnitude component positive so the sign is deterministic. Null when the matrix is not square or not symmetric (within 10⁻⁹ of its scale).

### Signal and forecasting kernels (`nodes/signalOps.ts`, `nodes/forecastOps.ts`)

**Smoothing and peaks** (`signalOps.ts`). An error cell passes through in place; a blank stays blank.

- `savgol(values, window, order)` (SAVGOL): at each position, a least-squares polynomial of degree `order` over an odd `window` of neighbors, evaluated there. Near the edges the nearest full window is used and evaluated off-center (scipy's `mode="interp"`). Blank and error cells are left out of the fits. `savgolProblem` names why a call cannot run (an even window, an order not below the window, a window longer than the list), and the formula answers that as `#DOMAIN!`.
- `gaussianSmooth(values, sigma)` (GAUSSIANSMOOTH): a Gaussian kernel truncated at 4σ each side, with scipy's reflect padding (`d c b a | a b c d | d c b a`), as `gaussian_filter1d` does by default. Blank neighbors are skipped and the weights renormalized over the present ones. A sigma that is not positive returns the input unchanged.
- `lowess(values, frac, iterations)` (LOWESS, default frac 2/3 and 3 iterations): over positions 1 to n, a local linear fit with tricube weights over the nearest `frac·n` points (at least 2), then bisquare robustness passes on residuals scaled by 6 × their median absolute value (Cleveland 1979, the statsmodels and R shape without R's delta speed-up). Fewer than three present points pass through unchanged.
- `findPeaks(values, { height, distance, prominence })` (FINDPEAKS), like `scipy.signal.find_peaks`: strict local maxima, where a flat top counts once at its middle. Then a minimum height, then a minimum prominence, then a minimum distance applied greedily, highest peaks first. A peak's prominence is its height above the higher of its two base minima, each taken between the peak and the nearest higher point on that side, or the signal's end. Blank and error cells break the signal. Positions are 1-based; the formula answers the positions.

**Exponential smoothing** (`forecastOps.ts`) is additive Holt–Winters: ETS AAN without a season, AAA with one (statsmodels `ExponentialSmoothing` add/add, R `HoltWinters`). Excel's FORECAST.ETS is the same family with Microsoft's own parameter search, so the values are close but not identical (`parity: false`).

- `fitEts(y, season)` fits an equally spaced series; season 1 is trend only (Holt). It needs 3 values, and 2 full seasons when seasonal, else null. Initialization: with a season, the level is the first season's mean, the trend the difference of the first two seasons' means divided by the season, and the seasonal terms the first season's deviations; without, the level is the first value and the trend the first step. The parameters α, β, γ come from a coarse grid (α and γ from 0.05, 0.15, 0.3, 0.5, 0.7, 0.9; β from 0, 0.05, 0.15, 0.3, 0.6), then coordinate refinement in steps halving from 0.05 down to 10⁻⁴, minimizing the one-step squared error after the initialization window. The fit carries the one-step fitted values and σ, the residual standard deviation of those one-step errors.
- `etsForecast(fit, h)` projects level + k × trend (+ the season's term) for k = 1 to h.
- `etsInterval(fit, h, confidence)` is the half-width `z · σ · √h`, the usual growing band (FORECAST.ETS.CONFINT has the same shape), with z the two-sided normal quantile for `confidence` (default 0.95).
- `detectSeason(y)` (FORECAST.ETS.SEASONALITY, with its own method): the lag from 2 to min(n/2, 24) with the highest autocorrelation of the differenced series, when that autocorrelation is above 0.3 and at least its neighbors'; otherwise 1, no season. Fewer than 6 values or a flat differenced series answer 1.
- The formulas: FORECAST.ETS(target, values, timeline, [seasonality]) requires an equally spaced timeline, and the horizon is the number of steps from the timeline's last point to the target (at least 1). Seasonality 1 (the default) detects, 0 means none, and n sets the period; a seasonal fit that fails falls back to no season. Excel's data completion and aggregation arguments are accepted and ignored: blanks drop and each step is one value. FORECAST.ETS.CONFINT adds a confidence (default 0.95; outside (0, 1) is `#DOMAIN!`). A series that cannot fit is `#VALUE!`. FORECAST.ETS.SEASONALITY answers 0 when no season is found.

**Decomposition.** DECOMPOSE(list, period, component, [model]) answers one component, `trend`, `seasonal` or `residual`, of the Decompose node's three; `model` is `additive` (the default), `multiplicative` or `stl`.

- `seasonalDecompose(y, period, model)` is the classical filter (statsmodels `seasonal_decompose`, R `decompose`). The trend is a centered moving average over the period (a 2 × MA when the period is even), blank for the half-window at each end. The seasonal term is the per-position mean of the detrended series, centered to zero (additive) or to one (multiplicative) and tiled. The residual is what is left. Blanks in the input leave blanks where they touch. It needs a period of at least 2 and two full periods, else null.
- `stlDecompose(y, period)` is STL with a periodic seasonal (R `stl(s.window = "periodic")`): the seasonal term is exactly periodic, each phase the mean of its cycle-subseries centered to zero, and the trend is a LOWESS fit of the deseasonalized series (frac `min(1, 1.5 · period / n)`), refined over 15 inner passes, enough to put a clean signal's residual well below 10⁻⁴. Because LOWESS is local linear, a smooth trend comes back cleanly and a linear one exactly, and the trend has no blank ends. It needs a gap-free series and two full periods, else null.

### Distribution fitting (`nodes/fitOps.ts`)

FITDIST and the Fit Distribution node share these, in the spirit of `scipy.stats.<dist>.fit` and R's fitdistrplus. `fitDistribution(data, family)` fits one family to the finite values on the Distribution node's own parameterization (`DIST_SPECS`), so a fit plugs straight back into that card. It answers the parameter names and values, the log-likelihood, AIC (`2k − 2·logLik`), the one-sample Kolmogorov–Smirnov statistic against the fitted CDF (smaller is closer), and n; null when the data cannot support the family (fewer than 3 values, or values outside its support).

| Family | Parameters | Fit |
|---|---|---|
| `normal` | mean, stdev | maximum likelihood (the variance divides by n) |
| `lognorm` | mean, stdev of ln x | maximum likelihood on ln x; every value above 0 |
| `expon` | lambda | 1 / mean; no negative values |
| `gamma` | alpha, beta (scale) | Newton on `ln a − ψ(a) = ln(mean) − mean(ln x)` from Minka's starting value; every value above 0 |
| `weibull` | alpha (shape k), beta (scale) | Newton on the profile likelihood for k from 1.2, scale from k; every value above 0 |
| `uniform` | min, max | the sample's range |
| `beta` | alpha, beta | method of moments; every value strictly inside (0, 1) |
| `poisson` | lambda | the mean; non-negative whole numbers only |

`fitAll(data)` fits every family the data supports and sorts them by AIC, best first.

### Unit conversion (`nodes/convertUnits.ts`)

`CONVERT_UNIT_DEFS` is the Convert node's unit table, keyed by the dropdown's unit key, with each unit's label, Excel code and category (angle, length, mass, temperature, time, area, volume, speed, energy, pressure). Every factor is relative to its category's local base unit (radian, meter, gram, second, square meter, liter, m/s, joule, pascal), and a unit's SI scale is that factor times the base's SI scale (`CATEGORY_DIM`: 0.001 for the gram and the liter, 1 otherwise). Temperature is affine: `toBase` and `fromBase` work in Celsius, while the `dim` unit, which the conversion actually runs through, works in kelvin with an offset. `convertValue(x, from, to)` converts through `dimension.convert`, and answers null for an unknown key or units of different dimensions, which CONVERT reports as `#N/A`.

### Index access (`nodes/indexAccess.ts`)

The INDEX node and the INDEX formula share `indexInto(value, row, col, tagUnit?)` over a scalar, a list or a matrix, everything both surfaces can hold. Frame and cube slicing stay in the node, because `frame.ts` imports the socket lattice; for the same reason the node passes `tagFrameCellUnit` in as `tagUnit` rather than the kernel importing `unitColumn.ts`, which reaches rete through `unitBridge`.

- An axis (`IndexAxis`) is a 1-based position, `undefined` for an axis never given, or null for one given as blank. `resolveAxes` truncates a fractional position (`INDEX(x, 1.9)` reads row 1), reads 0 or `undefined` as the whole axis (Excel's omitted `row_num`), and makes the answer blank when either axis is blank. A blank container answers blank.
- A scalar is a 1 × 1: position 1, or the whole axis, returns it, and anything else is `#REF!`.
- A matrix: both axes whole passes it through; a whole column comes out as a list (a short ragged row contributes a blank); a whole row as a list; one cell as itself. A homogeneous matrix unit rides out onto each extracted number through `tagUnit`; the unit-blind formula surface passes none.
- A flat list is an n × 1 column, so a given column must be 1; the whole column is the list itself.
- Out of range is `#REF!` from `indexRefError(n, max, what)`, "Row 5 is outside 1…3", so both surfaces word it identically.

## Parity measurement

`formulaNodeParity.ts` measures how far the node catalog and the formula registry cover each other. It is the one implementation behind both the report script and the ratchet test in `formulaNodeParity.test.ts` ([[D7]] oneMetricImpl).

`measureParity()` walks every visible catalog leaf (hidden leaves skipped, pairs flattened, categories joined into a " › " path) against the current `formulaFunctionNames()`, and produces a `ParityRow` per leaf:

- `excel`: the Excel names the leaf stands in for, uppercase, from the leaf's `excel` field or `NODE_EXCEL`; empty for a Solenoid-native node.
- `excelCovered`: every one of those names dispatches (`excelCoverage`). An empty claim is never covered, since vacuous is not complete ([[D9]] useEveryNotSome).
- `inFormula`: the leaf is reachable from a formula by name. That holds when any Excel name dispatches; or the despaced label does (`despace`: whitespace removed, uppercased, the same rule the registrations use, [[C51]] formulaNaming); or every name in the leaf's `fx` dispatches; or the leaf is covered by the language itself (`LANGUAGE_LEAVES`: the four arithmetic operators, Comparison, and the Expression and Equation hosts); or it is a preset formula, a locked Expression with a non-empty formula, detected by creating the node rather than listed ([[D4]] noManualList); or it is an op family whose every op dispatches under `fx ?? despace(label)`. Argument families are not in `NODE_OPS` ([[C26]] opArgDistinct), so an aggregator value such as the GROUPBY card's SUM never makes SUM count.

The measurement reports:

| Field | Meaning |
|---|---|
| `rows` | every visible leaf |
| `covered` | leaves with `inFormula` |
| `excelNamedGap` (gap A) | leaves with Excel names that are not all dispatchable: typing the name gives `#NAME?` while the node sits in the Add menu |
| `nativeGap` (gap B) | Solenoid-native leaves with no formula name; not ratcheted, since visual and input/output nodes make parity moot |
| `inScope` | leaves with `inFormula` or Excel names, the complement of `nativeGap` from the same predicate; the denominator a coverage claim must use, since `rows` includes leaves such as Slider and Note that were never candidates |
| `noNode` | dispatchable names that no `NODE_EXCEL` entry claims |
| `untracked` (gap C) | `noNode` names that are neither in `EXCEL_GAP` nor registered in `EXCEL_IMPL_META`: the uncurated surface Formula.js brings in. A deliberately registered name counts as tracked, so the ratchet never fights the registry. |

`excelNamedGapNames(m)` flattens gap A to a sorted, deduplicated list of the names that do not dispatch. It is the ratchet's unit, so closing one name of a multi-name node shows.

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
| The criteria grammar | `tests/graph/criteriaFamily.test.ts` |
| Signatures and the parameter bar | `tests/graph/formulaSignatures.test.ts` |
| The parity measurement and its ratchet | `tests/graph/formulaNodeParity.test.ts` |
| Distribution kernels on both surfaces | `tests/graph/distributionFormula.test.ts`, `tests/graph/nodes/distributions.test.ts`, `distributionInvariants.test.ts` |
| Finance kernels and the discount-rate solver | `tests/graph/nodes/finance.test.ts`, `financeInvariants.test.ts`, `financeIterative.test.ts` |
| Date kernels and relative dates | `tests/graph/nodes/date.test.ts`, `dateParity.test.ts`, `relativeDates.test.ts` |
| Text, signal and forecasting kernels | `tests/graph/nodes/textOps.test.ts`, `signalOps.test.ts`, `forecastOps.test.ts` |
