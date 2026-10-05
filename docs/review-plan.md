# Bug-review plan: develop a66d359 → 37c92d8 (2026-09-24 → 09-27)

High-level walk backward over 118 commits. Each block: what moved, why it smells, what an
agent should check. Review only; no patching without a stated reason and the governing leaf.
Order = priority, not chronology. Agent rules: one block per session, read the routed spec
first (`docs/README.md` routing table), `python3 tools/dte.py find <name>` for the leaf.

Baseline at 37c92d8: see "Baseline" at the bottom.

---

## 1. Blank / settings sweep — ARG_ROLES (highest risk, cross-cutting)
Commits: a1c23e89, f60a450d, ab6dd146, 2990affc, 2445385c, f9f036e0, 4315304e, b9e450ff, 7f01fb06
Where: `src/graph/inputRoles.ts` (the one declaration), `excelFormula.ts`, `excelFunctions.ts`,
`nodes/shared.ts`, `nodes/{list,matrix,scalar,stats,text,logic,date,finance,frame}.ts`
Leaves: [[D86]] blankRoles, [[C80]] blankArgIsExcelBlank. Spec: `tree/specs/values/input-roles.md` (new).
Why risky: one table now decides what a blank means for ~60 functions across BOTH formulas
and cards; every card that grew `static inputRoles = rolesFrom(...)` changed behaviour for a
wired blank. `docs/settings-audit.md` was the author's review sheet; verify code matches it.
- [x] Diffed 2026-09-28: QUARTILE, QUARTILE.INC and QUARTILE.EXC were missing from the sheet (added) and CHOOSEROWS / CHOOSECOLS' rest was worded short; `settingsAudit.test.ts` now holds the formula table to the code. The `required` rows are Claude's calls awaiting the author's review, as the sheet says. Was: Diff `ARG_ROLES` against `docs/settings-audit.md` row by row: every function listed in
      one and not the other is a gap. Especially the `required` ones (MROUND, CEILING, FLOOR,
      LARGE, SMALL, PERCENTILE, MID, REPLACE, TEXT, REPT, DATEDIF): a blank now hard-errors
      `#SYNTAX!` where it used to coerce to 0. Confirm that is what the author ruled.
- [x] Checked 2026-09-28, all 61 mappings name the right argument (SEQUENCE start 2 / step 3, RANDARRAY min 2 / max 3, INDEX, TEXTSPLIT). Was: `rolesFrom(name, {socket: argIndex})` mapping: check each socket→index by hand against
      `formulaSignatures.ts` for that function. An off-by-one silently gives the wrong role.
      Spot-check: INDEX (`index:1, position:1, column:2`), RANDARRAY, SEQUENCE, TEXTSPLIT.
- [x] Checked 2026-09-28 with three pairs: a blank second or third sort_order is left out (ascending), a blank by_array blanks the answer. Was: `rest` role + SORTBY's generated even-index table: a blank by_array (data) vs a blank
      sort_order (setting) at positions 1,3,5… vs 2,4,6…; test a formula with 3 pairs.
- [x] Ruled, not Excel's: [[D86]] blankRoles makes a blank pick dropped (Excel has no blank inside an array constant). Was: "Blank inside a list of settings is skipped at its spot" (2990affc): check the
      `picks` path in INDEX/CHOOSEROWS/CHOOSECOLS with `{1,,3}`-style lists; a dropped blank
      shifts later positions. Confirm this matches Excel rather than a zero-index error.
- [x] Swept 2026-09-28: Date Diff (Year Frac, Days 360) basis, Depreciation (DDB, VDB) factor, DOLLAR and FIXED decimals, LOG base and GESTEP step now read the twin's role (`wiredNull.test.ts` checks each against its formula); Find Peaks' minimums read as no minimum; MAKEARRAY left for the author (see the audit sheet). Was: Cards with no `inputRoles` but a formula twin that HAS `ARG_ROLES`: parity break. Grep
      every key of `ARG_ROLES`, find its card in `nodeExcel.ts`, confirm the card cites it.
- [x] Checked 2026-09-28: the Distributions card picks PDF / CDF / inverse from a dropdown, so no blank reaches `cumulative` there. Was: Distribution `cumulative` blanks now read FALSE (NORM.DIST etc.): check the cards'
      dropdown default agrees (sockets default TRUE in some old seeds?). `seeds.test.ts`.

## 2. "A list is one row" orientation change
Commits: a7b52c41, ddfe18d5, 7484b745, f18ea5ea, b240c970, cd4013e6, 6745ee20, 0a95b655 (lists read per row)
Where: `nodes/matrix.ts`, `matrixOps.ts`, `indexAccess.ts`, `listOps.ts`, `tableLambda.ts`,
`excelFunctions.ts`, `src/graph/help/data-model.md`
Why risky: a global axis convention flipped (list = 1×N row, not N×1 column) but three
functions were exempted (TOCOL, BYROW, MAKEARRAY "keep their column"). Exemption lists rot.
- [x] Checked 2026-09-28 against [[D85]] columnsStayColumns, which settled this after the plan was written: TRANSPOSE, HSTACK / VSTACK, WRAPROWS / WRAPCOLS, CHOOSEROWS / CHOOSECOLS, EXPAND, MMULT both ways, SUMPRODUCT, SORT, UNIQUE, FILTER and MAKEARRAY all give Excel's answer for a one-row array, and INDEX is strict as D85 rules (`INDEX(x, 2, 1)` is `#REF!`, not "either axis"). EXPAND's blank padding and TAKE / DROP's `#DOMAIN!` for an empty result are documented choices (formula-language). Was: Enumerate every matrix-taking function in `excelFunctions.ts` that accepts a list;
      for each, decide row-vs-column by Excel's behaviour on a 1-D array, and check. Suspects:
      TRANSPOSE, HSTACK/VSTACK, WRAPROWS/WRAPCOLS, CHOOSEROWS/CHOOSECOLS, EXPAND, MMULT,
      SUMPRODUCT on list×matrix, INDEX(list, r, c) "reads either axis" (7484b745) — check
      INDEX(list, 2, 1) vs INDEX(list, 1, 2) both work and INDEX(list, 2, 2) errors.
- [x] Checked 2026-09-28: the card agrees with the formula (Rows 1 keeps the list, Cols 2 takes two items); its tooltips now say a list is one row. Was: TAKE/DROP on a list (ddfe18d5): `TAKE(list, 1)` now returns the whole list (one row);
      `TAKE(list, ,2)` takes 2 items. Verify the card's Rows/Cols sockets follow the same
      reading and the socket labels say so.
- [x] Checked 2026-09-28: `BYROW(x, SUM)` is one total as a one-cell column, `BYCOL(x, SUM)` one per item, and D85's two motivating formulas come out right. Was: BYROW/BYCOL over a list: BYROW(list) should give one result, BYCOL N results. Check
      the "keep their column" exemption doesn't make BYROW(list) give N.
- [x] Checked 2026-09-28: `TOROW(TOCOL(x))` is `x`. SPARKLINE draws one picture of a matrix read row by row, as its spec says; "lists read per row" in 0a95b655's title was about INDEX. Was: Round-trip: TOCOL(list) → list → TOROW: shape stable? And SPARKLINE "lists read per
      row" (0a95b655) — a list input draws one sparkline, a matrix draws one per row.
- [x] Checked 2026-09-28: "a List going into a 2-D input becomes one row" is what the code does; no help page says otherwise. Was: `src/graph/help/data-model.md` wording vs code: the help is the user-facing contract.

## 3. Aggregate kernels: NaN, infinity, spread limits
Commits: bdf0b3c3, 7f691901, ea3e187c, 732a9043, ded279c5, 5f4d3fe7, 2537231b, 431b12f3, 9021770b
Where: `nodes/statsOps.ts`, `excelFunctions.ts`, `nodes/shared.ts` (guardFinite), `valueKinds.ts`,
`frameVerbs.ts`, `frameBackend.ts`, `listOps.ts`, `matrixOps.ts`, `scriptCoerce.ts`
Why risky: numeric edge semantics changed in kernels shared by cards, formulas AND frame
verbs; `guardFinite` signature changed (spread → array) across 7 files.
- [x] Checked 2026-09-28: all 29 callers pass an array, and the parameter is typed `ReadonlyArray<unknown>`, so a stray scalar fails tsc. Was: `guardFinite` callers: grep every call; any caller still passing spread args now passes
      ONE array as arg 0 and type-checks if the param is `unknown[]`. tsc may not catch a
      caller that passes a single scalar (now wrapped? or treated as the array?).
- [x] Conformance checked 2026-09-28 (formulas and the Aggregate card, NaN / ±∞ / ∞ with −∞). Fixed against D48: MODE / MODE.SNGL skipped a lone NaN, MODE.MULT and the Mode card passed NaN on bare, and PRODUCT (on Formula.js) answered `#VALUE!`; all are `#DOMAIN!` now, PRODUCT on the shared kernel. Also fixed for Excel parity: no value repeating is `#N/A` in the three MODEs and on the Mode card (was the first value, or every value). The native engine's guard needs the desktop run. Was: NaN in aggregates is RULED, not open ([[D48]] classifyNonFinite, `tree/specs/values/value-semantics.md`,
      `tree/specs/computation/frame-verbs.md` § groupBy): a NaN input makes the group `#DOMAIN!`, checked before
      aggregating; `count` counts NaN and errors; NaN "sorts into the tail, fails every
      predicate except neq". So the check is conformance: list SUM/AVG/MIN/MAX/MEDIAN/MODE/
      STDEV kernels (`statsOps.aggregate`) and `RANGE_RAW` COUNT against that table, and the
      same on the native engine (the guard "wraps every aggregate over a number or date
      column except count and percentof"). A deviation is a bug against D48, not a debate.
- [x] Checked 2026-09-28: formulas and the Aggregate card agree on every ±∞ case (∞ passes, ∞ − ∞ is `#DOMAIN!`); the Polars path needs the desktop run. Was: "Aggregate card and formulas agree on an infinity": which won, `#NUM!` or ±∞? Check
      the frame verb path (Polars returns inf) agrees too.
- [x] A-form "redirects" (5f4d3fe7): checked, `LEGACY_ALIASES` registers each as a `#NAME?`
      refusal naming the replacement, not a silent call. Same for VLOOKUP/HLOOKUP/MATCH and
      the D-functions. No argument-shape bug there. Open only: the inbox item d452bfbc on
      how aggregates read logicals/text still needs the author's ruling.
- [x] Swept 2026-09-28: `pivotFrame` spread one pivot cell's values into `push`, so a group of 150k rows threw on the web engine (fixed, `spreadLimit.test.ts`); the chart, calendar, XY, Surface and PackTool renderers spread plotted values into `Math.min` / `Math.max` (now `iterMin` / `iterMax`). The rest spread small fixed sets. Was: Spread limit (2537231b): `spreadLimit.test.ts` exists; grep for any remaining
      `Math.max(...` / `fn(...list)` on user-sized arrays in `nodes/*Ops.ts` and `frameVerbs.ts`.
- [x] Checked 2026-09-28: ragged and shorter operands pad with blank, and an empty operand broadcasts to blanks, as formula-language § Broadcasting rules (only the shape builders pad `#N/A`). Was: Broadcasting "measures each operand once" (9021770b): a perf change to formula
      broadcasting; check ragged matrices and a 0-row operand still error, not silently
      broadcast to empty.

## 4. Formula parenthesis auto-close on commit
Commits: fb4c8f52
Where: `excelFormula.ts` (`closeParens`), `FormulaPopup.tsx`, `TablePopup.tsx`,
`columnHeadControls.tsx`, `cubeEditCell.tsx`. Leaf: [[C115]] closeParensOnCommit.
Why risky: silently rewrites user text at four commit sites; one of them is a cube CELL editor.
- [x] Checked: the closer lives only in the shared Fx expr-row editor (`table-popup__exprinput`);
      `cubeEditCell.tsx` just forwards the closed text as a column `expr`. Literal cells untouched.
- [x] Fixed 2026-09-28: `"` is the formula language's only quote (single quotes aren't delimiters), but `[column]` and `[@[column]]` references were counted; the closer and the syntax hint now skip them as the tokenizer reads them. Was: `closeParens` treats `"` as the only quote; Excel's `""` escape inside a string toggles
      twice so is fine, but `'` (sheet/name quoting) and a `(` inside `[...]` column refs are
      counted. Check the parser's own quoting rules and mirror them.
- [x] Checked 2026-09-28: the popup commits only on close or a switch, and reopening seeds from the closed text, so there's nothing to repaint; the column row repaints its draft. The real `trimEnd` hazard was an unterminated string (`CONCAT("a ` became `CONCAT("a)`); the closer now leaves it for the parser. Was: FormulaPopup commit: `committedRef` gets the closed text but `textRef` keeps the raw
      text; does the visible editor repaint with the `)`? Also `trimEnd()` before appending
      strips trailing whitespace the user may have typed inside a string.
- [x] Fixed 2026-09-28: no hint fired (counts balance); `formulaSyntaxHint` now names a `)` before its `(`. Was: `)` first then `(` (`)a(`): counts balance, nothing added, parse fails. Fine, but
      confirm the syntax hint still fires.

## 5. LAMBDA capture vs column precedence in computed columns
Commits: bee28d1c, d62c45b7, d2aa1d81, a69aa03e, 37c92d8b
Where: `nodes/lambda.ts`, `computedColumnCore.ts`, `nodes/frame.ts`, `LambdaNode.tsx`
Leaf: [[C22]] rowFormulaRefs.
Why risky: name resolution now consults a global `rowStack` at CALL time; a LAMBDA value is
cached and may be called from anywhere.
- [x] RULED: [[C22]] rowFormulaRefs Consequences fix the order "a column wins, then row/rows,
      then a LAMBDA's captured values, then an input wired into the node", and
      `tree/specs/computation/computed-columns.md` § Names spells out `readCapturedColumn`. A wired capture losing
      to a same-named column is the design. Only the card hint (`perRowParamClashes`) covers
      parameters, not captures: check whether a capture shadowed by a column gets ANY visible
      note on the LAMBDA card. If not, that is a small UX gap, not a bug.
- [x] Confirmed 2026-09-28: one LAMBDA (`@price / SUM(price)`) gives thirds over one frame and quarters over another; its captures resolve against whichever frame calls it. That is [[C22]] rowFormulaRefs' order (a column outranks a capture), so no inbox item; reported to the author. Was: `readCapturedColumn` reads the TOP of `rowStack`: a LAMBDA value built on frame A's
      canvas and called inside frame B's computed column resolves its captures against B's
      columns. That follows from the spec ("while a row context is up"), but it means the
      same LAMBDA answers differently per consumer. Confirm with two frames and one LAMBDA,
      and file an inbox item if the author hasn't seen it; don't change it.
- [x] Confirmed 2026-09-28: a LAMBDA applying a captured LAMBDA (`(g)(@price)`) resolves the inner one's `SUM(price)` against the outer frame. A call by name, `g(@price)`, is `#NAME?` by design (formula-language § LAMBDA: by-name calls apply parameters and λ sockets only). Was: Nested: computed column calls LAMBDA that calls another LAMBDA (via a captured
      LAMBDA value); rowStack top is still the outer frame. Probably fine, confirm.
- [x] Confirmed 2026-09-28: two λ columns capturing each other are `#REF!` "Circular computed columns: c1 → c2" in a few milliseconds. Was: Frame Input "orders a LAMBDA column after the columns its captures name": a capture
      naming a column that is ITSELF a LAMBDA column → cycle? Check the order function
      handles a cycle without hanging.
- [x] Confirmed 2026-09-28: the cache key holds expr and params, and the bare-and-@ note is computed at render from the card's current expr, never cached. The capture-shadowed-by-a-column note can't be static: which column shadows depends on the consuming frame. Was: Cached `LambdaValue`: `capturedVals` snapshot vs live `readCapturedColumn` — the cache
      key (`_lastBuild`) doesn't include column data, correct since columns are read live;
      but confirm the "bare AND @" flag (d62c45b7) is computed from `atColNames` on the same
      expr the cache was built from.

## 6. Cards view / Record node rework (largest UI surface)
Commits: 24fbc3cc, 211094ee, 4ab797fe, c67cab32, b05b0e6b, 391f0b86, aa4d332b, 1016f0f8,
189afe68, 3447bf74, 8858a36f, 09e61679
Where: `cardLayout.ts`, `TableCards.tsx/.css`, `TablePopup.tsx`, `RecordNode.tsx`,
`AutoCard.tsx`, `chartCards.tsx`, `recordNav.ts`, `recordCardsFromPopup.ts`, `tablePopupStore.ts`,
`chartValue.ts`, `nodes/visual.ts`, `masonryLayout.ts`, `recordLayout.ts`, `App.tsx`
Leaves: [[C114]] cardsView, [[B20]] mobileFriendly; C63 retired.
Why risky: 14-file commit, a node kind renamed (Card → Detail), a popup→node hook through
the store, seed JSONs rewritten, and "pictures are data:image only" is a security-ish rule.
- [x] Checked 2026-09-28: Rows picks and the deck's `rowNumbers` are both the frame's own 1-based rows; the popup's sort never reaches the node. Was: Record "Rows on every view, a number or a list" (391f0b86): `rowNumbers` is 1-based
      frame numbers of DRAWN rows — after a sort/filter in the popup do they map to the
      source frame or the drawn order? Both consumers (RecordNode, chartCards) must agree.
- [x] Checked 2026-09-28: no `card` view left in seeds, docs, help or the catalog. An old save with `op: "card"` draws an empty figure: the loader is forgiving by design and `graphValidate` names the unknown op (save-format § The strict validator), so it stays. Was: Renamed view `Card`→`Detail`: grep seeds and `docs/node-coverage.md`, help.md, catalog
      for the old name; [[B7]] says no alias, so an old save with `view: "card"` must fail
      loudly not silently render blank. `seeds.test.ts`.
- [x] Checked 2026-09-28: the plugin never registers the action, so the menu item doesn't show; nothing dangles. Was: `recordCardsFromPopup.ts` + `tablePopupStore.ts` hook: the plugin build (Obsidian)
      reaches Add Record through a hook; in the plugin build with no canvas, what happens on
      click — no-op, error, or dangling store entry?
- [x] Checked 2026-09-28: the grid, the Cards view and the Cube cells use `cellImageSrc` (`data:image/` only, so `data:text/html` and web addresses stay text); only the Form view and Record Detail take `recordImageSrc`'s image URLs, as the table-popup spec allows. Pinned in `visual.test.ts`. Was: `cardLayout.ts` derived rules ("pictures are data:image only"): confirm an `http(s):`
      image string is refused, not just not-rendered, and that a `data:text/html` prefix is
      also refused (prefix check must be `data:image/`).
- [x] Checked 2026-09-28: `packMasonry`, `planCards` and every Record view handle 0 rows, 1 row and 0 columns without throwing. Was: Masonry layout on 0 rows, 1 row, and a frame with 0 columns.
- [x] Ruled: [[C114]] cardsView, ratified, says Grid stays the default and Cards is an option. Was: "Every popup opens in Grid" (189afe68): the Cards choice isn't persisted — intended?
- [x] Checked 2026-09-28: nothing cites C63; the catalog and node-coverage tests pass. Was: C63 retirement touched `nodeOps.ts` + `nodes/visual.ts`: check for a dead node kind or
      a catalog entry left behind (`formulaNodeCoverage.test.ts`, `docs/node-coverage.md`).

## 7. SORT / SORTBY / FILTER / UNIQUE take tables
Commits: afbf53bc
Where: `FilterNode.tsx`, `SortNode.tsx`, `UniqueNode.tsx`, `copyPaste.ts`, `excelFunctions.ts`,
`nodeCatalog.ts`, `inputRoles.ts` (10 files)
- [x] Checked 2026-09-28: `by_col` sorts and dedupes columns, `exactly_once` keeps the singles. Found beside it: `INDEX(m, 0, c)` answers a list (a row), so `SORTBY(m, INDEX(m, 0, 2))` sorts columns and `m / INDEX(m, 0, 1)` divides the wrong way; the spec says a whole column is a list and the help leans on it, so it waits on the author (`tree/decisions/inbox/index-whole-column-is-a-column.md`). Was: "Strictly as Excel's do": SORT(table, col, order, by_col) — `by_col=TRUE` sorts
      columns; check it isn't a no-op. UNIQUE(table, by_col, exactly_once) same.
- [x] Checked 2026-09-28: a matrix `include` is `#VALUE!`; a column mask filters rows and a one-row mask filters columns. Was: FILTER(table, include, if_empty): `include` must be a 1-D boolean the height of the
      table; a matrix `include` → Excel `#VALUE!`. Check.
- [x] Checked 2026-09-28: the formulas and the List Sort / UNIQUE cards share `sortGrid`, `sortGridByKeys` and `uniqueGrid`; Frames go through the frame verbs, a separate value kind, so there is no second implementation of one thing. Was: Cards vs formulas: the frame verb Sort/Filter/Unique nodes are a different subsystem
      (`frameVerbs.ts`); do these table-taking formula forms route through the verb, or a
      second implementation? Two implementations = parity risk on desktop Polars.
- [x] Checked 2026-09-28: only `byCol` and `exactlyOnce` appended to the init field order, which is safe. Was: `copyPaste.ts` touched: a socket rename? Confirm old clipboard entries fail cleanly.

## 8. Placeholder paste + persistence refactor
Commits: 88c95dc6
Where: `copyPaste.ts`, `persistence.ts`, `nodes/placeholder.ts` (`placeholderFor`), `nodes/composite.ts`
Spec: `tree/specs/documents/save-format.md`.
- [x] Checked 2026-09-28: `savedNodeBody` gives a non-placeholder `constructor.name` as its type, so the name is unchanged; a placeholder gives its missing type, which is the right name. Was: `nodeNameStore.ensure(clone.id, type)` changed from `constructor.name` to the saved
      `type`: for a NON-placeholder clone these must be equal, or every pasted node gets a
      different default name. Assert in `copyPasteSnapshot.test.ts`.
- [x] Checked 2026-09-28: the paste remap rewrites members, hostNodeId and steps inside `savedInit` for a placeholder, as for a live node. Was: A pasted placeholder inside a group/composite: `ref = clone.savedInit` for members/
      hostNodeId/steps — the id remap must rewrite ids INSIDE `savedInit` too, or the
      placeholder points at pre-paste ids.
- [x] Checked 2026-09-28: sockets come from the node's saved cables (`deriveMissingNodeSockets`), so none means no cables to prune. Was: `placeholderFor(sn, phSockets)` with `phSockets` undefined: no sockets → cables to it
      pruned? (`tree/specs/canvas/input-cable-pruning.md`).

## 9. Frame edits and joins
Commits: 3e776d37, b4c90711, e5f51eb1
Where: `frame.ts`, `frameVerbs.ts`, `TablePopup.tsx`
- [x] Checked 2026-09-28: `1, x, blank` and an all-blank column read as Text, numbers with blanks as Number; a column already typed keeps its type when the CSV adds columns, so a later text cell shows NaN over its text ([[D72]]). Was: CSV edit "types the columns it adds from their values": the inference for a column
      with mixed `1`, `x`, blank; and a column that is all blank (text? number?). A column
      inferred number then a later edit adds text — does the column retype or error?
- [x] Checked 2026-09-28: the key rounds at the 15th significant digit of the larger term (`roundAtLargerTerm`, frame-verbs § Nest Join), so only keys equal to float precision collide; Nest Join builds a Cube in JS, so there is no Polars twin. Was: Nest Join keys "survive unit conversion noise": tolerance-based key matching. What
      epsilon, is it relative, and can two distinct keys within epsilon collide? Polars path
      vs JS oracle: does Polars join with the same tolerance? (`frameBackend.test.ts`).

## 10. Equation solver
Commits: f6f5dfac
Where: `equationSolve.ts`, `nodes/equation.ts`
- [x] Fixed 2026-09-28: the four listed forms were right (`x*x - x = 0` → [0, 1], `SIN(x) + x = 1` falls to numeric), but a piecewise form matching a line or parabola at the seven probes got a wrong "exact" answer (`MIN(x,50) + x = 200` gave 100, an `IF` switching past 41.5 gave the wrong branch's root or a false "no real solution"). Every sniffed root is now put back in (`rootHolds`), and a negative discriminant defers to numeric root-finding first (`equationSolve.test.ts`). Was: "Linear in a repeated unknown solves exactly": the linearity detector. Try `x*x - x = 0`
      (not linear), `2*x + 3*x = 10` (linear), `x/2 + x = 3`, `SIN(x) + x = 1` (falls back to
      numeric?). Check it never claims exactness on a non-linear form.

## 11. Add-menu search rework
Commits: 387543fd, ae4a4c46, c818581c, bf9d76c7, dd71077c, f38039c1
Where: `catalogSearch.ts`, `AddNodeMenu.tsx`, `nodeOps.ts`, `nodeExcel.ts`, `nodeCatalog.ts`
- [x] Checked 2026-09-28: the key is `places ?? type`, and every alias row's `places` names exactly what its `create` places (the host for its primary op, else `host__op-X`, the op row's own type), so the best-scoring row wins and places the right thing. Was: "One row per thing placed" dedup: a function that is both an op alias and a card
      shows once — which row wins and does Enter place the right one?
- [x] Fixed 2026-09-28: the 50 samples all land and no common query came back empty, but plain words for a function had lost their card with the descriptions ("uppercase", "absolute", "square root", "text length", "convert units", "remove duplicates"). Those cards got keywords, and four of them are samples now. Was: "Descriptions out of the haystack": a query that only matched a description now finds
      nothing; check `npm run search-samples` output for empty results.
- [x] Checked 2026-09-28: nothing is cached per query string (each query is parsed per call, and case or space variants give identical lists); the per-leaf prep is a WeakMap on leaf objects, rebuilt whenever the catalog is. The per-type caches are safe only because packs are code; the custom-packs backlog item now says they must clear. Was: Per-leaf/per-query caching (bf9d76c7): cache keyed on the query string; case and
      trailing-space variants, and invalidation when custom packs load.

## 12. SPARKLINE in cells and typed Cube columns (25 files)
Commits: 0a95b655, 595b3675
Where: `ArrayChip.tsx`, `CubeDisplay.tsx`, `CubeInputNode.tsx`, `CubePopup.tsx`, `FrameDisplay.tsx`,
`TablePopup.tsx`, `columnHeadControls.tsx`, `visualOps.ts` and more
- [x] Checked 2026-09-28: a sparkline is `data:image/svg+xml` text (single quotes, commas, spaces), and it comes back unchanged through CSV quoting, the Frame CSV writer and reader, the note frontmatter patch, `yamlScalar` and JSON save; Copy as Markdown gives the text, not a picture. Two of the round-trips are pinned in `sparklineFormula.test.ts`. Was: A cell holding a sparkline value: copy/paste, CSV export, save/load round-trip
      (`tree/specs/documents/save-format.md`), and the Obsidian write path — each must either serialize or refuse.
- [x] Checked 2026-09-28: a column is typed or Fx, never both (the picker replaces one with the other and `sourcePicks` skips a formula column), so an Fx column's type is what its formula answers; text in a number-typed column blanks as a Frame's does, the source keeping the text. Fx columns fill in dependency order (`@c + 1` before `c` works) and a cycle is `#REF!` naming the loop. Was: Typed Cube columns + Fx Cube columns: a column typed number receiving a formula that
      yields text; a Fx column whose formula references a later Fx column (order).

## 13. Deleted tests (verify nothing load-bearing went)
Commits: 5a5dcab9 (94 lines, 21 files), 9a419d55 (2501 lines, 215 files)
Why: "assertions that can only pass" and "tests the rest of the suite already decides" is a
judgement made in one pass over 215 files. `socketConnect.test.ts` (425 lines) went entirely;
`uiCopy.test.ts` lost 98, `composite.test.ts` 86, `distributions.test.ts` 64,
`excelFunctions.test.ts` 61, `frameVerbs.test.ts` 190.
- [x] Checked 2026-09-28, every deleted block run against current code first (all passed): composite and distributions are covered (each assertion named against a surviving one, the rest tautologies); excelFunctions' deletions copied source tables tsc already enforces, and formulaTier3 sweeps declared→dispatches; frameVerbs' 18 are the corpus's (`fixtures/frame-verbs/`) bar XLOOKUP's approximate match. Restored where nothing stood in: uiCopy's two rule-specimen tests and the approximate-match block (next-larger and the text-column refusal were unpinned), now in `frameLookup.test.ts`. Was: For each of those six: read the deleted block (`git show 9a419d55 -- tests/graph/<f>`),
      name the OTHER test that "already decides" it. If none can be named, restore the block.
- [x] Checked 2026-09-28: 425 of 491 lines went, and every deleted pair is still pinned by `socketReference.test.ts` (31 types × both directions against `docs/socket-reference.md`). That compares against a hand-written doc, so the two rule-derived sweeps (families stay apart, values widen, logical↔number the one bridge) are back in `socketConnect.test.ts`. Was: `socketConnect.test.ts`: socket lattice connect rules ([[socket-lattice]] spec). Confirm
      `socketFamilyCompleteness.test.ts` + the lattice spec tests cover every deleted pair.
- [x] Checked: `unitLattice.ts` lost only `dimensionsMultiply`, a dead always-true helper. Harmless.

## 14. Smaller items, one look each
- [x] Checked 2026-09-28: 12.12.0 (from 12.11.6, system 0.0.83) changes only the resizer: onResizeEnd always follows onResizeStart, and a fix when `shouldResize` returns false. `FlowResizeGrip` is the app's one resizer (group grips included), forwards the end only after a move, and sets no `shouldResize`. Was: 2b7596f4 `@xyflow/react` 12.12.0 bump + "bare click on a grip is not a resize": read
      the React Flow 12.12 changelog for resizer/selection changes; check group resize,
      touch-gestures spec.
- [x] Checked 2026-09-28: the root cause was a hook below an early return (rules of hooks), broken since 5915f3c. A one-off `react-hooks/rules-of-hooks` scan over `src/` and the plugin finds no other case (its one hit, `use30` in `financeOps.ts`, is a plain function whose name starts with "use"). The repo runs no ESLint, so nothing stops the next one. Was: 5e5af11d "Opening a Report no longer takes the app down": a crash fix in
      `ReportOverlay.tsx`; find the root cause commit and check no sibling overlay has the
      same pattern (boundary rule in `tree/specs/canvas/react-flow-surface-contract.md`).
- [x] Fixed 2026-09-28: negative ticks read "-1.5K" and log ticks keep three figures, but a value just under a unit boundary kept the smaller unit (999,999 read "1000K"), and the gutter measured only the two ends, so a 0–1 axis clipped its 0.25. `compactTick` now rounds before it picks the unit (and has T), `valueAxisWidth` measures the round ticks between the ends too (`niceTicks`, now shared in `chartCore.ts`); a constant axis keeps the 26 px gutter (`chartCore.test.ts`, looked at on a live canvas). Was: 7576af3d chart axis ticks/gutter: negative values, log-scale, and a 0-range axis.
- [x] Fixed 2026-09-28: negative num_chars and start 0 refuse as Excel does, but an empty find_text past one-beyond-the-end answered the last position; FIND and SEARCH now say `#VALUE!` there (`formulaTier1.test.ts`). SEARCH wildcards stay a backlog item. Was: e472fac4 LEFT/RIGHT/FIND/SEARCH "refuse what Excel refuses": negative num_chars,
      start_num 0, start_num > length. Also SEARCH wildcards are still a backlog item.
- [x] Checked 2026-09-28 against Excel's rule (366 with a Feb 29 in a span of a year or less, the average year length past a year), three cases pinned in `formulaTier1.test.ts`. Was: eea14b00 YEARFRAC basis 1 (actual/actual): leap-year spans across Feb 29 in the second
      year; Excel's rule is notoriously odd. Compare to a known table.
- [x] Checked 2026-09-28, one hand-derived Excel case each pinned in `formulaTier1.test.ts`. Was: 66367a4d GCD/LCM truncate; 802b6033 uppercase hex; b9e450ff VDB no_switch; 4315304e
      TREND/GROWTH const=FALSE: each a one-function Excel parity change; one Excel-verified
      case each in `formulaTier*.test.ts` is enough.
- [x] Checked 2026-09-28: a `knap: true` note with no tags renders as itself (`hasKnapSyntax`), one whose `{{ }}` is prose or code renders it (the switch is the author's, per note, [[D87]] knapNotes) and a parse error leaves the source with the error on top. An unknown tag stays as typed in the plugin and the Note (keepUnknown); a Report blanks it, but every Report tag is its own input, so only an unwired one is blank. Batch pages blank a mistyped `{{ record.field }}` silently, which keepUnknown can't see (the lead name `record` is known): that is a strict-fields question for the author. Live Preview cannot race autosave: a save changes no editor text, the render only reads, and a render that finishes after more typing is dropped. Was: ebd1d68b Knap notes (`noteFrontmatter.ts`, `knapTemplate.ts`, `nodes/report.ts`): a
      `knap: true` frontmatter on a note that is NOT a knap template; a template with an
      unresolved `{{var}}`; Live Preview error timing (3d0bd58a) races with autosave.
- [x] Checked 2026-09-28: with no filesystem the folder and file listings answer empty (`canReadRoot`), Write says "Writing needs the desktop app" and Preview "Preview needs the desktop app" as a card status before `writeDocumentToVault` could throw; the demo vault still reads. Was: f7a9998b / da908cda vault cards gate on `hasFs()`: the web preview has no fs; confirm
      the cards render a disabled state, not a thrown error, on Vercel.
- [x] Checked 2026-09-28: no seed or save carries `"kind": "display"`; the kind was an accent category in code, never written into a save, so there is nothing to fail loudly. Was: 80fe6cdb "display node kind goes": grep seeds + saves for `"kind": "display"`; [[B7]]
      says break, but the break should be a loud load error.

---

# Part B: 09-22 evening → 09-24 (the parallel review fleet)

Context: `main` is the 1.4.2 merge of 2026-09-22. Everything below AND everything in Part A is
unreleased and only on the preview. 09-24 alone is 297 commits: ~20 worktree agents merged into
`develop` by a Lead (`docs/agent-coordination.md`). That day's fixes overlap each other (two agents
fixed the same coercion bug differently: dbec53dd), so the merges are the first thing to audit.

## 15. Hand-resolved merge conflicts (do this first)
39 merges in the history; `git diff-tree --cc` shows seven files whose merged text differs from
BOTH parents, i.e. someone typed the resolution:
| merge | file | lines |
| f34bc6a0 | `copyPaste.ts` | 93 |
| 5cb0c58a | `nodes/obsidian.ts` | 45 |
| 5ca9413a | `activeGraph.ts` | 37 |
| 83538d61 | `valueKinds.ts` | 27 |
| e0c95f08 | `frameVerbs.ts` | 15 |
| 5b55f5aa | `nodes/text.ts` | 14 |
| 5ca9413a | `nodes/annotation.ts` | 13 |
Agent recipe per row: `git show --cc <merge> -- <file>`; then `git log <merge>^1..<merge>^2 -- <file>`
and the reverse, list each side's INTENT from its commit bodies, and confirm each intent is in HEAD.
- [x] `copyPaste.ts` (f34bc6a0): checked 2026-09-28, `copySelected` takes `copySet` and snapshots through `snapshotEntry`, and placeholder sockets go through both. Was: one side added `copySet` (group members + docked FCs, never a
      boundary marker), the other extracted `snapshotEntry`. Check the merged `copy()` uses
      `copySet` AND `snapshotEntry`, and that 49f8f572 (paste via savedNodeBody) and 88c95dc6
      (placeholder sockets) that came AFTER still go through both. `copyPasteSnapshot.test.ts`.
- [x] `activeGraph.ts` (5ca9413a): checked 2026-09-28. `allTopEditors`' one caller (`connectionStore.nodeExists`) descends itself; the real gap was `getOwningEditor` walking closed composites under the main canvas only, now every live top editor (`activeGraph.test.ts`). Was: `getOwningEditor` gained a closed-subgraph walk (depth 16)
      on one side and `allTopEditors` on the other. Does `allTopEditors` also need to descend
      into closed composites, or do its callers (auto-refresh 56687a38 "walks deep") do that
      themselves? Two different "find the node" walkers = one of them will miss a case.
- [x] `nodes/obsidian.ts` (5cb0c58a): confirmed and fixed 2026-09-28, an unchanged note now re-reads its picks and re-syncs when they changed (`importNoteRepick.test.ts`). Was: a `force` flag and an `applyFile` split were merged with
      an early-return `content === this.body` guard. A note whose content is unchanged but
      whose column picks changed (types edited in the plugin) now returns early. Check.
- [x] `valueKinds.ts` (83538d61): checked, `powerOf` has 4 call sites (formula, functions,
      scalar card, unitValue). Fine.
- [x] `frameVerbs.ts` (e0c95f08): checked, no dangling `isUnitCell`/`tagFrameCellUnit`.
- [x] `text.ts`, `annotation.ts`: swept 2026-09-28. 86 call sites by then; every card component now reads `getOwningEditor` / `getOwningView` (components floor rule 10), chrome keeps the active pair, and `sourceInvariants.test.ts` pins it with the chrome named. Was: these two files moved from `getActiveView` to `getOwningView`
      (the view that owns the node, closed composites included). `getActiveView` still has
      144 call sites. Each one that runs on behalf of a NODE (rerender, fly-to, popup anchor,
      socket flip) is wrong for a node inside a closed composite or an owned canvas. Triage
      the 144 into "UI chrome, active is right" vs "node-scoped, must be owning". Expect
      a dozen bugs of the "works on the main canvas, not inside a composite" kind.
- [x] Checked 2026-09-28: `cargo test` runs in the cloud container once WebKitGTK's dev packages are installed; all 33 engine tests pass at this head, `corpus_cases` included, and CI runs them now (block 39). Was: Also 0-line rows for merges touching `engine.rs` twice (bb6314a7, e0c95f08): both
      sides changed the Rust engine and git auto-merged. Auto-merge in Rust across two
      agents' verbs = build passed but behaviour may not. Run `cargo test` corpus cases
      (`corpus_cases`) on the desktop machine; cloud can't.

## 16. °C and affine readings (semantic rewrite, 09-24)
Commits: 6ec8102a, bc077a37, 6ccbe16c, b9cfcfe5, e1089889, 71128d54, caccb6be, 4657aa73,
753f0062, 3566d721, 1c99a751, 56e7bab7, 3d3d3f43, 8dd59513
Where: `unitDimExpr.ts` (`affineWeight`, line ~526), `unitValue.ts` (`adoptReading`,
`arithmeticCell`, `compareUnits`), `frameVerbs.ts`, `nodes/{expression,list,tableLambda,frame}.ts`
Leaves: [[C25]] firstClassUnits (D40 unitOnValue folded into it). Spec: `tree/specs/values/unit-flow.md`.
Why risky: a static "point weight" classifier replaced a run-twice heuristic; every aggregate,
comparison and arithmetic op got a reading-vs-delta rule; a bare number's meaning now depends on
the op (reading in MIN/compare, delta in +/−). That is a lot of per-op special cases.
- [x] Fixed 2026-09-28: the whole list run on the formula, the Arithmetic/Comparison/Aggregate/Math cards and GROUPBY, in °C and °F. Readings add to #UNIT!, subtract to a delta in K, average and pick as readings, spreads give deltas, and all three surfaces agree now. Two bugs: a wired plain number beside readings (`MIN(a, n)`, `MEDIAN(a, b, n)`, `IF(x, a, n)`) was #UNIT! in the formula though the card and a literal read it as a reading (`affineWeight` takes the plain-number names now, Expression passes them); and °F read back with float noise, so `a = 20` was FALSE for 20 °F and `INT(20 °F)` was 19 (`displayMagnitudeOf` rounds at the conversion's larger term). `unitWiring.test.ts`. A Frame computed column still reads a plain column beside a reading as a delta, since there a column could be a temperature difference. Was: Build a truth table and test it on the card, the formula and the frame verb: for
      a = 20 °C, b = 30 °C, n = 5 → a+b, a−b, a*2, a/2, (a+b)/2, n+a, a>n, MIN(a,n), SUM(a,b),
      AVERAGE(a,b), STDEV(a,b), ABS(a), INT(a), MOD(a,7), ROUND(a), IF(x,a,n), IF(x,a,b−a).
      Every cell: expected unit (reading / delta K / #UNIT!). Three surfaces must agree.
- [x] Checked 2026-09-28: `a * n` with a wired n is #UNIT! (a scale must be a constant the formula can read; its value isn't known before the run), a LAMBDA parameter takes its argument's weight, a reading column ref is a reading. Was: `affineWeight`: a reading scaled by a non-constant (a * n where n is a wired number) →
      weight? Commit says "scales only by a constant". A LAMBDA parameter, a column ref?
- [x] Checked 2026-09-28: unit-flow § Unit algebra states it (`25 °C > 30` is FALSE, the bare number read as a reading in the display unit), on the card and the formula alike; kelvin meant as a bare number is a Convert first. Was: `adoptReading` in `compareUnits`: `25 °C > 30` reads 30 as 30 °C. But `25 °C > 300`
      where the user meant kelvin? Confirm the ruling text in C25 covers comparison.
- [x] Confirmed 2026-09-28, not fixed: a difference is a displayless kelvin cell, indistinguishable from a kelvin reading, so Convert or the FC to °C puts the offset back (30 °C − 20 °C → −263.15 °C, and −441.67 °F). Inbox: `tree/decisions/inbox/temperature-difference-converts-by-scale.md`. Was: Spreads drop the affine display (b9cfcfe5): result unit is K (delta). Does the FC /
      Convert node then let the user convert a delta-K to °C (wrong) or to delta-°F (right)?
- [x] Checked 2026-09-28: GROUPBY SUM of a °C column is #UNIT! in every group; the native `group_sum` under `readingScale` answers `ERR_UNIT_ADD_BITS`, and `frameReadings.test.ts` plus the corpus hold both engines to it. Was: Frame verbs on °C columns (753f0062): groupBy SUM of a °C column → #UNIT!? Polars path
      never sees units; PolarsBackend sends `readingScale`; check the native `group_sum`
      returns `ERR_UNIT_ADD_BITS` for affine columns and the oracle agrees.
- [x] Checked 2026-09-28 with the truth table above: the °F-only bug was the read-back noise, fixed. Was: °F: everything above with Fahrenheit, whose scale AND offset differ from K.

## 17. #TYPE! strictness through wildcard cables
Commits: 6663ad35, dbec53dd, 95a48fdf, 4ff1d2bc, f81d2bff, 10bb4cfa
Where: `coerceInputs.ts` (`familyCells`, 309 lines), `nodes/coerce.ts`, `nodes/cast.ts`
Leaves: [[B17]] typedValueModel, [[C10]] socketLattice (D11 noAutoCross, D13 widenNeverNarrow, both folded into it).
Why risky: two agents fixed the same bug differently and the merge "kept both intents"; a
value of another family on a typed port is now a per-cell #TYPE!. Number→date still bridges,
logical↔number still bridges. The set of allowed bridges is a hand-written list.
- [x] Checked 2026-09-28: `familyCell` lets through its own family, logical↔number (the lattice's one bridge), a number into date (a date is a serial at runtime) and anything into complex; every other crossing is a per-cell #TYPE!. The lattice allows no cross-family connection beyond those, so no cable connects and then errors except through a wildcard, which is B17's rule. Was: Enumerate the bridge matrix (from family × to family) in `familyCells` and compare to
      the socket lattice spec's table. Any bridge the lattice allows at connect time but
      `familyCells` refuses at compute time is a cable that connects then errors.
- [x] Checked 2026-09-28, no per-pair tests added: the check runs in `wrapNodeData` on the receiving card, on the value alone, and never reads which card sent it, so one test per family covers every wildcard source. Was: XLOOKUP's trueany result, a passthrough Conduit, a Composite output port, a Switch:
      each wildcard source feeding each typed family. One test per pair.
- [x] Checked 2026-09-28: `["a", "b", 3]` on Arithmetic's list input answers `[#TYPE!, #TYPE!, 4]`, one error per bad cell; a scalar rung fails the node, and Aggregate's SUM answers one #TYPE! as an error in a range does. Was: "Text on a list rung is one #TYPE! cell rather than a failed node": a list-of-text
      onto a number LIST port → N #TYPE! cells, not one. Confirm shape.
- [x] Fixed 2026-09-28: Cast and VALUE share `parseValueText` and read Excel's US forms ("$5", "(5)", "5%", "1e3", " 5 ", "-$1,234.50"; "€5" and "" are #VALUE!), but "1.234,5" read as 1.2345 because every comma was dropped; a comma after the decimal point is #VALUE! now (`formulaTier1.test.ts`). European formats are not accepted, so they refuse rather than misread. Was: Cast (f81d2bff): "reads number text as VALUE does" — locale decimal comma, thousands
      separator, leading currency symbol, "1e3", " 5 " with spaces, "" (blank vs 0).
- [x] Checked 2026-09-28: no global; it `vi.mock`s `frameBackend.readFrame` to test lazy frame reads, and every `vi.mock` file is isolated by the repo's rule. Was: `coerceInputs.test.ts` is in vitest's ISOLATED list because it stubs a global before
      import. A test that must run isolated to pass is suspicious: what global?

## 18. Composite subgraphs (hydrate, ids, side tables, errors, solve)
Commits: 19090f25, 38726731, 2494d74d, db08c964, e4d1a478, 4dde1c28, a68628ed, d5d8dea4,
4f3c86f3, 945c13eb, 3896a6f6, a7c499ee, 05cad2ed, 94b25efb (part), 12bca4cb, 365e0fd7
Where: `nodes/composite.ts` (1086 lines, 17 commits in 5 days), `savedNodeBody.ts`,
`flow/drillStack.ts`, `flow/FlowCompositeOverlay.tsx`, `activeGraph.ts`
Leaves: [[C77]] compositeIsSubgraph, [[B12]] losslessSaves, [[C35]] unknownViaPlaceholder,
[[D35]] errorInErrorOut, [[D86]] blankRoles (D33 unwiredNotBlank superseded).
- [x] Checked 2026-09-28: the node-held references are an FC's `hostNodeId`, a Group's `members` and a Presentation's step `nodeIds` (all in `remapNodeRefs`), and the ports' `internalNodeId` (remapped on hydrate, mapped back on save). The other `nodeId` fields are a card's own id in an alert or a computed result, and Goal Seek names port ids. Pins, comments, formats and standoffs are side tables, restored under the fresh ids by `restoreSideTables`. Was: Id remapping (38726731): hydrate remaps Group members and FC hosts, snapshot maps back.
      Enumerate EVERY node field that holds another node's id (grep `nodeId|hostNodeId|
      members|steps.*nodeIds|targetId|sourceId` in nodes/) and check each is in
      `remapNodeRefs`. Alerts, Standoffs, Pins, Conduit sequence numbers, Record nav?
- [x] Checked 2026-09-28: a depth-3 composite computes after a reload and after a reload of that reload (`composite.test.ts`); copy and Duplicate go through the same extract and reload, which `compositeInnerSideTables.test.ts` runs. Was: Nested hydrate (19090f25): depth-3 composite save → load → Solve → value. Also
      paste of a nested composite, and Duplicate.
- [x] Checked 2026-09-28: `compositeInnerSideTables.test.ts` carries them through the snapshot, a copy, a drill-in undo, a save and load and the main undo; `relocationKeepsStores.test.ts` forgets them two levels deep on a real delete, and an undo reloads the recursive snapshot. Was: Side tables (e4d1a478): pins/comments/formats/standoffs travel with the composite.
      Delete the composite (a68628ed) → are they forgotten at every depth? Undo the delete
      → are they back?
- [x] Fixed 2026-09-28: a Solve that ran out of its four rounds while fetches were still landing (a chain longer than four, or a card on a cadence) answered as if settled. It stays stale now until the next Solve (`unsettled`, `liveCardUnmounted.test.ts`, which fails on the old code). Was: Solve waits for fetches (d5d8dea4): "up to four rounds". A chain of 5 live cards
      inside one composite → stale on first Solve, silently. Should it flag stale instead?
- [x] Checked 2026-09-28: `composite.test.ts` § an error crossing the boundary: with two lanes and one bad input, only the lane that reads it errors. Was: Error crossing boundary (2494d74d): IFERROR inside sees the error now. But a composite
      with 2 outputs and one bad input: does ONLY the dependent output error?
- [x] Checked 2026-09-28: the sanctioned list is one read (Goal Seek's seed, with its reason), and a companion test drops stale entries. The sweep matches only `inputs…?.[0] ??`, so a grep for the same shape under other names found one more, the Alert card's message text (`got?.[0] ?? lit`), unreachable in practice but now read through `readInput`. Was: Wired blank beats default (db08c964): a source sweep refuses `?.[0] ?? x` in nodes/
      and packs/. `sourceInvariants.test.ts` enforces it; check the sanctioned-per-read list
      hasn't grown into an allowlist that defeats the sweep.
- [x] Checked 2026-09-28: `reconcileFcTypes` retypes sockets and asks for rerenders but never adds or removes a cable, so a settle can't trigger another; its cost is one pass over the inner cards per cable change. Was: FC docks settle on every cable change (4f3c86f3): perf on a composite with 50 cables;
      any re-entrancy (settle → cable change → settle)?

## 19. Live cards and refresh (races)
Commits: e41ec46f, 6cfb51c3, 56687a38, d5d8dea4, 5dca7eb4
Where: `connectionStore.ts`, `nodes/connection.ts` (12 commits), `activeGraph.ts`
Leaf: D32 refreshOutsideRebuild (retired 09-24; the rule lives in `tree/specs/computation/live-connections.md`), [[C103]] untrustedContentSeams.
- [x] Fixed 2026-09-28: nine fetch sites, one pattern (a key taken before the await, compared after it) in seven; Web Source and the data feed card wrote their reply without the check, so an older URL's reply landing after the newer one's stuck the card on the old data. Both drop a reply whose key has been replaced now (`liveCardUnmounted.test.ts`, which fails on the old code). Was: Overtaken responses (e41ec46f): the token/sequence check per card. Weather, Geocode,
      Holidays, Currency, Task Notes, Vault Folder: six cards, one pattern? Or six copies?
      A copy that's missing the check is the bug.
- [x] Checked 2026-09-28: intended, the live-connections spec runs auto-refresh from the card's data(); a timer whose card is gone clears on its next fire (block 44), and a document switch clears every timer (`registerNodeForgetAll`). Was: Timer moved into `connectionStore` "kept in step by the card's data()": a card whose
      data() never runs (unwired output, collapsed, inside a never-solved composite) never
      ticks. Is that intended? And on document switch: timers of the OLD document cleared?
- [x] Checked with block 15 on 2026-09-28: `nodeExists` descends into composites itself, and `getOwningEditor` now walks every top editor, so the two walkers find the same nodes. Was: `nodeExists` walks main + drill-in + owned canvases "deep" (56687a38) vs
      `getOwningEditor`'s depth-16 walk (item 15): two walkers again.
- [x] Checked 2026-09-28: the save format carries a card's fields generically (`extractInit`), with `persistenceSweep.test.ts` holding every field saved or declared transient, so a new field needs no spec line. Was: Cadence field autosaves: a save-format change; `tree/specs/documents/save-format.md` updated?

## 20. Polars engine vs JS oracle parity
Commits: 54bd9e3b, 996a8ec1, 9bb10669, d1a4f44d, b4c90711, 94b25efb (units after native verb)
Where: `src-tauri/src/engine.rs` (2458 lines, 104 fns), `frameBackend.ts` (667),
`frameVerbs.ts` (65 exported verbs), `fixtures/frame-verbs/*.json` (19 corpora)
Leaves: [[C16]] polarsEngine, D29 oneVerbCorpus (retired; now `tree/specs/computation/frame-verbs.md` § The parity corpus), D78 textErrorsOnOracle (retired; same spec, § PolarsBackend).
Why risky: cloud sessions cannot run the Rust side, so every 09-24 engine change was verified
only by whoever had the desktop. Error cells ride as reserved quiet-NaN bit patterns.
- [x] Checked 2026-09-28, now natively: groupBy, distinct, sort, filter, fillBlanks, window and join each have error-cell corpus cases, and the groupBy and distinct ones mix `#N/A`, `#DIV/0!` and a real NaN, which stay three buckets on both engines (`cargo test`, 33 passing). Was: Reserved NaN (54bd9e3b, `ERR_*_BITS` at engine.rs:1360): a REAL NaN produced by Polars
      arithmetic (0/0 inside the engine) has bits 0x7ff8000000000000, distinct from the
      reserved codes, fine; but does any verb canonicalise NaN (e.g. `fill_nan`, sort,
      `is_nan` filters) and thereby erase the code? Also: Polars `unique`/`group_by` on f64
      compare NaN by bits or by value? Two different error codes in a groupBy key must not
      collapse; the commit claims they split by code. A corpus case per verb for that.
- [x] CORRECTED against `tree/specs/computation/frame-verbs.md` § PolarsBackend and the wire: the `["e", code]`
      tuple I saw is `encodeCell`, the GROUPING key, not the wire. The wire carries an
      uploaded error as `{"__err": code, "ref": n}` where `ref` indexes a WeakRef registry,
      so the download restores the same SolError, message and origin ([[E9]] errorsKeepOrigin
      holds). Residual check: the registry is weak. A source frame re-emitted per pass keeps
      its SolErrors alive, but a frame whose producer was recomputed between upload and a
      later download (a preview's `__ref` re-flush after `clearCollectMemo`) may find the
      ref collected, and the cell comes back code-only. Pin: upload → drop the producer's
      reference → force GC (`--expose-gc` in a test) → download → origin still present?
      An engine-computed error carries `why`, mapped through `ENGINE_ERROR_WHY`: checked,
      the JS table's six keys (domain, overflow, pct_change_from_zero, zero_total,
      readings_add, readings_scale) all appear as reason strings in `engine.rs`
      (`error_of` → `ErrWhy::Reason`). Closed.
- [x] Checked 2026-09-28: by design (frame-verbs § PolarsBackend); the row-less JS run that restores units is over the schema alone, so its cost doesn't grow with the frame. Was: D78: a frame with an error in a text/logical column "stays on the oracle on desktop".
      So desktop silently runs JS for some frames: perf cliff on a big frame with one bad
      text cell, and a unit/format path that differs (94b25efb restores units via a
      row-less JS run of the same verb: two verb executions per native call).
- [x] Checked 2026-09-28: `convert_key` in engine.rs rounds at the 15th digit of the larger term exactly as `convertKey` does, and the corpus's unit-key join case passes on both engines. Was: Join key transform with offset (d1a4f44d): `rightKeyScale/rightKeyOffset` for °C keys.
      Float equality after scaling: b4c90711 later added tolerance "noise". Is the tolerance
      applied natively too, or only in the oracle? Corpus case: 5 km vs 5000.0000001 m.
- [x] Fixed 2026-09-28: by hand only, never in CI. Run from the cloud over seven seeds (150 cases a verb), it found two native divergences: `rolling_avg`/`rolling_sum` drifted in the last bits (Polars keeps a running total; short windows are summed fresh now, as the oracle sums them), and a `sliceRows` last-n longer than the frame returned no rows after a key-less groupBy (a Polars tail bug; last-n is reverse, limit, reverse now). Both are named corpus cases; every seed passes. Worth a run at each release (`npx tsx scripts/fuzz-frame-verbs.ts <seed> 150`, then `cargo test corpus_cases`). Was: Fuzzer: "5400-case runs over six seeds agree". Is the fuzzer in CI or only run by hand?
      If by hand, the plan should say: run it on the desktop at each release.
- [x] Checked 2026-09-28: `crossJoinFrames` is `join` with `how: "cross"` (corpus cases on both engines); every JS-only verb has a unit test except `sampleFrame`, which has one now (`frameVerbs.test.ts`). Was: Fixture coverage (counted): window 56 cases, groupBy 42, filter 40, join 32, sort 17,
      filterMulti 16, pipeline 14, replaceValues 10, distinct 10, head 8, sliceRows 6, select 5,
      unpivot 4, rename 4, fillBlanks 4, drop 4, bindColumns 3, append 3, pivot 2. Thin:
      pivot (2), append/bindColumns (3). Verbs with NO fixture: nestFrame/unnestCube,
      crossJoinFrames, splitColumn, addIndexColumn, mergeColumns, promote/demoteHeaders,
      dropBlankRows, describeFrame/Column, correlationMatrix, sampleFrame, every cube verb.
      First step: which of those run natively (`engine_apply` op list in engine.rs) vs
      JS-only; only the native ones need a parity fixture, but each JS-only one needs a
      unit test that survived the item-13 cut.

## 21. TODAY / NOW / volatile freeze
Commits: 719591dd, 2c2d5b9b
Leaves: [[C44]] dateSerials, [[D46]] freezeVolatilePerCalc.
- [x] Checked 2026-09-28: block 44 answers the time zone (the local calendar day as a UTC-labelled serial, C44); at a DST fall-back NOW repeats an hour of serials, as Excel's local-time NOW does. Was: `wallClockSerial` local vs UTC: a doc saved in one TZ, opened in another: relative
      Date Input "today" changes; is that stated in the spec? Serial for NOW at DST switch.
- [x] Fixed 2026-09-28: the rollover finds TODAY/NOW in an `expr` (Expression, Computed Column, LAMBDA, Equation), a Frame Input's formula columns and composites, but not a Cube Input's formula columns (`cubeText`), which it reads now (`volatileDates.test.ts`). Was: Midnight rollover: the Today card inside a composite recalculates; a formula TODAY()
      inside a computed column? A LAMBDA host?
- [x] Checked 2026-09-28: what coalesces is the rerun a second F9 queues while a pass runs, so two presses are one recalc and one new draw; D46 freezes a card's draw across recomputes, and `RAND() - RAND()` inside one formula is two draws, as in Excel. Was: "A coalesced F9 stays exact in sketch mode" (2c2d5b9b): what is coalesced and can two
      F9 presses in one frame produce two different RAND draws in one calc? D46 says freeze.

## 22. Locked canvas
Commits: 703205c7, fa328067, 1f182781, d58772c2, 83806909
Where: `canvasLock.ts`, gated in `FlowSurface.tsx`, `canvasKeyboard.ts`, `menuModel.ts`,
`MenuBar.tsx`, `NavMenu.tsx`, `SelectionActionsBar.tsx` (7 files).
- [x] Checked 2026-09-28: every structural path is gated. RF gets draggable/connectable/selectable false; the context menu, cable drops, quick-wire and the Add menu stand down at the surface (`addMenuRequest` is gated where it is received, so the A key, the menu bar and the mobile button all stop there); the keyboard gate covers Delete, nudge, paste, Tidy, group, Wrap, rotate and undo/redo, and the menu bar, palette and touch bar press those keys (`fireMenuKey`, so the mobile Undo too); the CSS half blocks every press on card chrome (FC dock, socket flip, grips, rename, comments, standoff drags). The hole was the keyboard: a card field focused before the lock, or reached by Tab, still edited. The surface now drops focus inside a card while locked (pointer-gestures § Locking). A model-layer gate would catch a future entry point the surface misses; proposed here, not built. Was: The gate is per entry point, not per mutation. List every mutation path
      (`editor.addNode/removeNode/addConnection`, `flowModel` edits, paste, drop from the
      file system, drag from the Add menu, touch gestures, FC dock/undock, socket flip,
      resize grip, group rename, comment edit, standoff drag, undo/redo) and mark which of
      the 7 files gates it. Anything unmarked is a hole. Better: one gate in the model
      layer; propose it, don't build it.
- [x] Checked 2026-09-28: there is no file drop onto the canvas at all; Delete stands down at the keyboard gate; Enter on a field focused before the lock can't happen now, since locking blurs it. Was: Drop of a CSV/JSON file onto a locked canvas. Keyboard Delete. Enter on a draft field
      that was focused before the lock.

## 23. Draft flush (data loss guard)
Commits: b1829af0, 1463356b, 93284865, bcca0654
Where: `draftFlush.ts` (30 lines), `documentStore.ts`, `fileSession.ts`, `persistence.ts`,
`src-tauri` close listener (`core:window:allow-destroy`).
- [x] Checked 2026-09-28: `usePendingDraft` registers inside an effect whose cleanup unregisters, so an unmount (dirty or not) removes its flush. Was: The registry is keyed by object; a component that unmounts while dirty without
      unregistering leaks a flush closure that writes into a node that may be gone.
- [x] Checked 2026-09-28: each flush runs in its own try/catch, so one that throws is logged and the save still happens. Was: `flushDrafts()` runs before `captureCurrent`; if a flush throws (node deleted), does
      the save still happen, or is the whole save lost?
- [x] Checked 2026-09-28: the close handler flushes and captures synchronously (`persist` writes local storage slots, no await), so the last write lands before the window goes; `kill -9` loses what came after the last autosave, which no handler can help. The backlog's next-desktop-build check stands. Was: Desktop close: JS listener destroys the window itself. If the flush's autosave is
      async and the destroy is sync, the last write is lost. Backlog already asks to verify
      on the next desktop build; add "kill -9 vs close" and "close during a long autosave".
- [x] Checked 2026-09-28: C95's Consequences make a switch, save or close commit drafts and the background autosave never; a half-typed key committing on a switch is the rule (block 44). Was: "Idle autosave keeps drafts local so a half-typed frontmatter never prunes cables":
      but a document SWITCH flushes → a half-typed frontmatter key commits → cables pruned.
      Confirm that's acceptable or that switch should confirm.

## 24. Frontmatter and vault writes (Obsidian seam)
Commits: dea19dee, 15ed4973, fbc0fb49, d4cfe3c9, bee16b34, 58b31244, 08f8357c, 843b7aa5,
ff417bdc, 09150636, e3b0c02f, 77eaf69b, eb4dcbd3
Where: `noteFrontmatter.ts` (226), `obsidianWrite.ts` (202), `fileBridge.ts`,
`noteFrontmatterSync.ts`, plugin shares readers.
Leaves: [[C101]] onePatchPath, [[C103]] untrustedContentSeams, [[B1]] obsidianBet.
- [x] Fixed 2026-09-28: a block indented as a whole got its key appended unindented, a second key that broke the block for js-yaml; the patcher and `resolveKey` now work without the common indent and put it back (`frontmatterPatch.test.ts`). Fine as they were: `:` in values, `|`/`>` blocks, lists of maps, a tab, a BOM, empty `---\n---`, `---` inside a value and two blocks (the first fence line closes, as Obsidian does); mixed CRLF and LF re-joins with CRLF, touching the body's line ends. The reader, not the patcher, broke on CRLF: the block's last line kept its `\r` (`"true\r"`, a date lost); fixed in `parseNoteFrontmatter` (`noteFrontmatter.test.ts`). Was: Round-trip fuzz on the frontmatter patcher: keys with `:` in values, multi-line
      strings (`|`, `>`), lists of maps, tabs, BOM, CRLF+LF mixed, a `---` inside a value,
      a note with TWO frontmatter blocks, empty frontmatter `---\n---`.
- [x] Fixed 2026-09-28: every listed spelling is quoted and reads back the same in `yaml`, js-yaml and the reader, but a raw control character went out plain, and js-yaml refuses the whole block over one; it is escaped as `\xNN` now. Keys went bare where YAML reads them as something else (`007` → 7, `1.50` → 1.5, `null`/`~` dropped, `<<` a merge key that makes js-yaml throw); a key is quoted by the text rules now, `<<` always (`obsidianMarkdown.test.ts`, reports-and-notes § Frontmatter YAML). Was: `yamlScalar` quoting: `yes/no/on/off/null/~`, `0o17`, `0x1F`, `1_000`, `.NaN`,
      a value that is only spaces, a value with a trailing `#` comment.
- [x] Fixed 2026-09-28: the write path's subfolder split only on `/`, so on Windows `..\\..\\x` stayed one segment, passed the `..` filter and climbed out of the vault when joined, the same bug d4cfe3c9 fixed on the read side; it splits on both separators and drops drive segments now (`vaultSubfolderParts`, `reviewPins.test.ts`), and `statVaultFile` takes the read guard too. `%2e%2e` is a literal file name (nothing decodes it), `\\0` is refused by the filesystem, and a symlink the user made inside their own vault is followed, as their intent. Was: Path guard (d4cfe3c9): backslash fixed; also `%2e%2e`, a symlink inside the vault
      pointing out, an absolute path on Windows `C:\`, a UNC path, a path with `\0`.
- [x] Checked 2026-09-28: the taken-name sets start empty on every write and are never seeded from the vault, so numbering is a function of page order alone; a rerun gets the same names and overwrites its own files. Was: Name uniqueness (bee16b34): case-fold collision numbering is stable across TWO writes
      (a rerun must not renumber and orphan links).
- [x] Fixed 2026-09-28: ISO, `30-Feb-2026`, `02/30/2026`, `Feb 30 2026` and a non-leap Feb 29 all refuse; the one roll left was a TaskNotes timestamp with a time (`2026-02-30T10:00` read as March 2), whose date part goes through `parseDateToSerial` first now (`taskNotesApi.test.ts`). Was: Date read as text (fbc0fb49): `2026-02-30` refused everywhere `parseDate` reads;
      grep for other date parsers (`Date.parse`, `new Date(` in src/graph) that still roll.

## 25. LAMBDA naming rules
Commits: 5219ee9b, d2090f9a, c76f414e, 07abd235, 94b25efb (part)
Leaves: [[D77]] constantsAlwaysWin, [[C50]] lambdaBindsByName.
- [x] Checked 2026-09-28: one fixture, `formulaLambda.test.ts`, and it asserts the current rule (refused, `#NAME?`). D77's text said the formula answers `#VALUE!`; code and test have always said `#NAME?` on both surfaces, so the leaf's sentence is corrected. Was: Two reversals in one day (shadow-a-constant landed then was undone). Grep tests for
      `LAMBDA(e,` and `LAMBDA(pi` fixtures asserting the OLD behaviour.
- [x] Checked 2026-09-28: constants are case-insensitive, so `E`, `Pi` and `PHI` are refused like `e`; inside a computed column bare `e` is the constant and `@e` reads a column named e. Was: Case: `E`, `Pi`, `PHI` as parameter names: are constants case-insensitive? A column
      named `e` in a computed column with the item-5 precedence rule.
- [x] Checked 2026-09-28: `TRUE`/`FALSE` are refused ("LAMBDA parameters must be plain names"); a function name works as a parameter (`LAMBDA(SUM, SUM+1)(1)` is 2), since a call and a name are told apart by the parenthesis. Was: Reserved words beyond constants: `TRUE`, `FALSE`, a function name as a parameter.

## 26. Layout: no overlaps ever
Commits: 3f83b611, 244cb2f5, 83806909, 35fbead5, 524514f5
Where: `separateOverlaps`, `separateAll`, `groupPush.ts` (9 commits), `tidyArrange.ts`
Leaves: [[C112]] noOverlapsEver, [[C89]] standoffsSolveLast.
- [x] Checked 2026-09-28: 12 random scenes × three expand/collapse patterns × 50 cycles: the box grows only while starting overlaps separate (the first few cycles), then stays fixed with no overlaps, since collapse restores every card. Was: Greedy top-left placement "moves only right or down": a canvas that grows without
      bound after repeated expand/collapse cycles (drift). Run 50 cycles, measure bbox.
- [ ] NEEDS AUTHOR 2026-09-28: silent, and a layout action can create it (a locked group expanding onto another, or Tidy inside one widening it onto a locked neighbour); C112 says two locked groups that overlap are left alone. Options: keep it silent; have `separateAll` return the leftover fixed pairs and raise an alert naming both; or clamp a locked group's growth into another locked box (an exception under D63). Was: Two locked groups that overlap each other: neither moves, pass ends with overlap;
      is that reported or silent?
- [x] Checked 2026-09-28 (groups don't nest, so a selection inside a locked group): the group's corner holds, members stay inside, the neighbour the grown box covers moves right; unlocked, the grown group moves itself instead, per auto-arrange-tidy § After the layout. Was: "What the op placed is preferred": Tidy on a selection inside a group inside a
      locked group.
- [x] Checked 2026-09-28: one; every layout move schedules the history, which merges calls within 400 ms into one record (25 moves over 33 ms gave one entry, one undo back to the start). Was: Undo after a layout pass: one undo step or one per moved card?

## 27. Generator caps
Commits: 6e6bac53, 03b6662c, 63108591, 42a6a32e
- [x] Found: `MAX_GENERATED = 1_000_000` in `nodes/listOps.ts:444`, read from 4 files;
      `tree/specs/computation/formula-language.md` § The registry says each surface applies it at its own boundary
      and the 2-D builders inside their `matrixOps` kernels ([[C17]] shareImpl). So the
      check is: every generator listed there (SEQUENCE, RANDARRAY, MAKEARRAY, LINSPACE,
      REPEAT, GEOMETRIC, RANGE, PADLEFT/RIGHT, EXPAND, MUNIT, DIAGONAL, OUTER) hits the cap
      on BOTH surfaces with `#OVERFLOW!`, and RANGE caps on `rangeCount` before allocating.
- [x] Fixed 2026-09-28: every listed generator refuses past a million on both surfaces with `#OVERFLOW!` except MAKEARRAY, whose card capped at 40,000 cells and rounded its size while the formula took a million and truncated; the card takes the shared cap and truncates now. The formula's `capped` compared the unrounded count, so `LINSPACE(0,1,1000000.4)` refused with "1000000 exceeds the 1000000 element limit" where the card built it; it rounds first now (`generatorCaps.test.ts`). NEEDS AUTHOR: six generators word the message differently per surface (same code); and a computed column caps each row but not the column, so 20 rows of `SEQUENCE(900000)` hold 18M elements (2.2 s, ~150 MB): options are a running column total past which rows are #OVERFLOW!, or one refusal for the column. Was: The cap error: same code and message on card and formula? What about a cap hit
      INSIDE a computed column (per row × rows)?

## 28. Test infrastructure: shared worker (isolate: false)
Commits: 25c4dfd4, f2ab84a9, 2bb7b2fa, 31a9b662, 1dee3cff
Where: `vitest.config.ts` (ISOLATED list), `tests/setup/sharedWorker.ts`,
`tests/graph/sourceInvariants.test.ts`
- [x] Checked 2026-09-28: shuffled under seeds 101, 202 and 303 the suite passes (6686 tests); and on a single worker (`--maxWorkers=1`). Was: The suite passes at 6579 tests, but with a shared module cache a test can pass
      BECAUSE an earlier file primed state. Run `vitest run --sequence.shuffle --seed N`
      for 3 seeds and `--maxWorkers 1`; any failure is a hidden dependency.
- [x] Fixed 2026-09-28: node-keyed stores reset through `forgetAllNodes` (the live-card timers included); the canvas lock and the table and cube popups are canvas-wide and weren't reset, so a test that locked or opened one would carry it into the next file. They reset now. The drill stack hangs off each composite, so it can't leak. Was: `sharedWorker.ts` resets a hand-written list of stores. Every NEW store since 09-23
      (tablePopupStore, canvasLockStore, connectionStore timers, drillStack) must be on it.
      Diff the store list in `docs/architecture.md` against the reset list.
- [x] Checked 2026-09-28: `sharedWorker.ts` calls `vi.useRealTimers()` after every file, so fake timers can't leak whether or not a file restores them. Was: `sourceInvariants` fails any `vi.mock` file left off ISOLATED. Good. Also needed:
      any file using `vi.useFakeTimers` without restore (56687a38 hit exactly this).

## 29. 09-22 batch fixes (pre-fleet, still unreleased)
Commits: 94b25efb (nine bugs), 9c4dd3f8, 12bca4cb, 365e0fd7, ba686b25, 9afe6faf, 4b9518d9
- [x] Checked 2026-09-29: Pivot never reaches the native engine (it has no pivot verb; `PivotNode` runs `pivotFrame` in JS over columns `backend.column()` hands back with their units), so its body columns keep their units on desktop too. A 2026-09-28 by-position unit tail for a native pivot was dead code and is removed. Was: Polars keeps units by re-running each verb over a row-less schema in JS
      (`frameBackend.ts` +85): verbs whose output columns depend on DATA (pivot, unpivot,
      groupBy with dynamic names, window with a computed output name) get the wrong schema
      from a row-less run. Test pivot + unit column on desktop.
- [x] Settled by block 44 and C117: `decimalFromText` is the one reader, operators refuse text by C10, and Cast, VALUE and NUMBERVALUE call the reader. Was: "Text in arithmetic is #VALUE!" (9c4dd3f8) vs "Cast reads number text" (f81d2bff) vs
      NUMBERVALUE empty = 0 (c2adb32b): three rules for text→number; one table, please.
- [x] Checked 2026-09-28: one `fetchAll` (graphCompute, called by process) and the composite's marker pull; no third shape. Was: `processGraph` now shares `invalidate` + `fetchAll` with `graphCompute` (9c4dd3f8):
      D30 names the composite's "marker-only pull" as the one other shape. Confirm no third.
- [x] Checked 2026-09-28: the export doesn't wait for a fetch in flight, so it carries what the card shows at that moment, which is ba686b25's rule. Was: Reports export what the screen shows (ba686b25): a Report with a live card mid-fetch.

## 30. Smaller 09-23/24 items, one look each
- [ ] Test gap 2026-09-28, no bug reproduced: nothing lists what renderers read, so the reverse direction is unguarded; the one read not offered found by hand is Merge Plots over XY data (`opts.alpha`, `opts.markersize`), reach unconfirmed. Proposal: a per-op `RENDERER_READS` table beside the targets, with `reads ⊆ keys` tested. Was: e0ee9307 Chart Builder: every option offered is honored, pinned by `chartTitles.test.ts`
      key sets. The reverse: an option the RENDERER reads that the builder doesn't offer is
      only caught if the test enumerates renderer reads. Does it?
- [x] Checked 2026-09-28: A→B plus B→A keeps one direction, a self-loop stays in the payload and the renderer skips it, +10 and −10 net to nothing. Was: 06dbb7fb Sankey merges repeated From→To flows: a cycle (A→B, B→A) and a self-loop.
- [x] Fixed 2026-09-28: a stray number column (Cost) was taken as the Duration even with a Work column there (Cost 500 and Work 16 scheduled 500 days); the numeric fallback applies only with no Work column now. A Links row whose successor is inactive errored "isn't in the plan" while the same link in the row's own cell scheduled fine; it is skipped now, and Gantt already skipped it (`scheduleCpm.test.ts`). Was: Schedule (c72928bd, 60799f21, 83dd630a, 4e23e39a, b3b48373, e591588e, d741d0f7):
      `scheduleCpm.ts` took 5 commits in a day. Minutes-mode day > 16 h; Duration fallback
      "skips dates and every named column"; a Links frame with a dependency on a row the
      Schedule dropped (b3b48373 says Gantt skips it; does CPM?).
- [x] Checked 2026-09-28: `"01"` and `" 1"` read column 1, `"1.0"`, `"1e0"`, `"+2"` read nothing, a column named "2" beats index 2, and the engine uses the same digit rule. Was: 0d1a7526 column reads match by index only for plain digits: `"01"`, `" 1"`, `"1.0"`,
      `"1e0"` as a column ref. Also a column literally NAMED "2".
- [x] Checked 2026-09-28: a throw on row 1 errors that row alone, on every row every row, and a throwing LAMBDA errors its row. Was: bf4030df a throwing computed-column formula errors its ROW: a formula that throws
      on row 1 only vs every row; and a throw inside a LAMBDA called by the column.
- [x] Checked 2026-09-28: error partition keys group by code (frame-verbs § Identity keys); a one-row partition gives null for a window of 2 and itself for 1. Was: c8b1a2f0 Window runs linear per partition; Replace Values drops stale source text:
      a partition key that is an error cell; a partition of size 1 with a rolling window.
- [x] Checked 2026-09-28: `SQRT(x)=2` gives 4, roots exactly at the edge give 4, and no root gives `#SOLVE!`, never the edge. Was: 0fbb3200 numeric solve near a domain's right edge: `SQRT(x) = 2` on [0, 4]; and a
      root exactly AT the edge; and no root (must say so, not return the edge).
- [x] Checked 2026-09-28: `loadRefusal` checks the parsed content, not the path; a binary renamed .csv fails `JSON.parse` first. Was: e7b885c1 gated file refused before the library: the check runs on the path or the
      content? A file renamed .csv but holding a binary.
- [x] Checked 2026-09-28: `claim` releases the old name, and nothing in src, seeds, help or docs still says Group By; one stale line in node-coverage (Group Lists' outputs) is fixed. Was: 297ca71e name claims release the old name; 5f4017d6 rename Group By → Group Lists:
      seeds, help, catalog, node-coverage all consistent (`nodeNames.test.ts` lost 38 lines
      in the test cut, item 13).
- [x] Checked 2026-09-28 by reading: selection lives in the model, React Flow's own delete is vetoed, delete reads the model's flags, and collapse and isolate rewrite that selection. Was: 2b45f2ab collapse/isolate drop hidden nodes from the selection; 7b58971d isolate via
      RF className: a keyboard shortcut (Delete, Ctrl+C) with a hidden node still in the
      RF selection state vs the model selection.
- [x] Checked 2026-09-28: XLOOKUP over a °C column gives a reading and follows block 16's table (two added #UNIT!, their difference 10 K, SUMIFS #UNIT!, AVERAGEIFS a reading). Was: 8e957255 lookups carry the return column's unit in a formula; 71aa4d2a SUMIFS reads
      Values in the column's unit: XLOOKUP returning a °C column → item 16's table applies.
- [x] Fixed 2026-09-28: IFS and SWITCH refused units IF carries, though each answers one of its branches; they carry the branches' unit now. A retired spelling on a united input said "#UNIT! doesn't carry units" instead of its `#NAME? Use …` hint; it answers the hint now, and the dead VLOOKUP, HLOOKUP, LOOKUP and SUMIF entries are gone (`unitWiring.test.ts`). NEEDS AUTHOR: functions that only rearrange or pick values (SORTBY, VSTACK/HSTACK, TOCOL/TOROW, REVERSE, SHIFT, the FILL* family, NTHELEMENT, CLAMP, COALESCE, TRIMMEAN, WAVG, RANGE, DIFF, RUNNING) are #UNIT! on a united input; options are adding them to the preserve and pick sets, keeping them loud and listing them in the spec, or a per-function unit role in the metadata. Was: a7a51da5 unit into an unknown function is #UNIT!: the dimension pass's function list
      vs the full catalog: any function missing from the list makes a united input error.
      Diff `unitDimExpr.ts`'s known-function set against `excelFunctions.ts` registrations.
- [x] Settled with block 35 (not a flood). Was: 25c4dfd4 also fixed "demo vault cached a failed chunk load forever": confirmed
      `demoVault.ts:49` retries on every read with no backoff or cap (see item 35).
- [x] Fixed 2026-09-28: 30 error messages, formula hints and validator messages across 16 files held an em dash; all rewritten, and `uiCopy.test.ts` sweeps messages built in code now. The bare "—" empty-value glyph stays. Was: Em-dash ban (c83525f8 "enforced over every shipped string"): `excelFormula.ts:815`
      ships "Frames don't flow through formulas — use the …" with an em dash inside a
      `solError` message. So the lint doesn't reach error messages built in code. Sweep
      `solError(` / `unitError(` message literals for `—`.
- [x] Noted 2026-09-28, a warning rather than a bug. Was: Churn × size: `nodes/list.ts` 2339 lines / 29 commits, `excelFunctions.ts` 2238 / 47,
      `frameVerbs.ts` 2121 / 19, `TablePopup.tsx` 1183 / 41 since 09-13. These four are
      where parallel agents will collide next; the item-15 merges already did. Not a bug,
      a warning for the fleet plan.

## Ordering for a fleet
Independent, safe to run in parallel (different files): 15, 16, 17, 20, 24, 28.
Then 18+19 together (composite + live cards share `activeGraph.ts`), then 1+2+3 from Part A.
Part C (31–38) is live-in-production review: 31 and 32 first, the plugin has no tests at all.
Everything else is one-agent-one-afternoon. Nothing here should be patched without the leaf
(`python3 tools/dte.py find <name>`) and a test that fails first.

---

# Part C: 09-13 → 09-22 (shipped as 1.4.0 / 1.4.1 / 1.4.2, live in production)

Lower priority for review because it's been in the author's hands longer, but a bug here is
LIVE on solenoid-ngc.vercel.app and in the Obsidian community plugin. Hotspots by commit count:
the landing site (~130 commits, marketing only), `TablePopup.tsx` (24), `nodeCatalog.ts` (22),
`nodes/frame.ts`, `nodes/connection.ts`, `demoVault.ts`, the plugin.

## 31. Obsidian plugin "Solenoid Properties" (0.1.0 → 0.1.3 shipped, 0.1.4 pending)
Commits: 506ae4e0, c955cadc, 2c963d58, 40cd262b, 20ab4615, 49ce7680, 3f11532c, e227b181,
14dea0d0, b984af85, 7318edd4, 49759739, ff6cf56f (tests dropped), ebd1d68b (Knap, Part A)
Where: `obsidian-plugin/src` (14 files), `pluginColumnTypes.ts`, `obsidianTypes.ts`,
`noteFrontmatter.ts`. Leaf: [[C107]] obsidianPlugin, [[D72]] pluginSaveWritesSourceText.
Why risky: ZERO tests in `obsidian-plugin/` (author dropped them 09-22). Root `tsc` includes
`obsidian-plugin/src` and `test.yml` runs `npm run plugin:build`, so it type-checks and bundles
in CI, but nothing exercises it. It runs in another host's DOM with its own quirks (c955cadc
found three that a fake module had passed) and shares readers with the app, so a reader change
in the app silently changes the plugin.
- [x] CI covers the plugin's typecheck and bundle (test.yml). Behaviour: nothing. The only
      check is the `plugin:rig` (real Obsidian over CDP), run by hand.
- [ ] NEEDS AUTHOR 2026-09-28: probed (`yamlValue.ts` is pure). A cube coerced to a list keeps only its first scalar per row (`[{a:1,tags:[p,q],sub:[…]}]` → `[1]` on Save), a frame to a list drops its column names, a matrix to a frame takes `Col1…`; nothing is lost until Save, and Obsidian's own dialog is the only warning. The spec's "only a container in a frame cell is missing" understates it. Options: fix the sentence and accept; keep a container cell as its YAML text; or have Save refuse or warn when the coercion lost a container or keys. Was: Type switch through Obsidian's Update dialog: `coerceYaml` "reshapes anything into the
      kind": a frame → list, a cube → matrix, a matrix → frame: what is lost and is the
      user told before Save?
- [x] Checked 2026-09-28 by reading: hosts are built in `el.ownerDocument` and the sweep re-adopts the sheet on `window-open` and `layout-change`; hover popovers and canvas embeds live in their window's document, and Settings is a modal, not a window. Was: Per-document stylesheets (settings window, popped-out notes): a third window kind
      (Obsidian's "open in new window" of the settings tab itself, canvas embeds, hover
      preview popovers). Each is a new document that needs the sheet.
- [x] Fixed 2026-10-05: a mount never attached ten seconds after it was made is unmounted at the next sweep (`NEVER_ATTACHED_MS`; an age, not a sweep count, since every mount sweeps and a burst of rows would count a pending one out). Was: `main.tsx` unmounted only a mount that was once `isConnected`, so a host built and never attached stayed until the plugin unloads. Was: Mount sweep "dropped only once seen attached": a property row that is built but
      never attached (a cancelled edit) leaks a mount forever.
- [x] Checked 2026-09-28: obsidian-plugin § The app reads the picks settles it (`types.json` says what a key is; `data.json` picks refine a frame's columns), and Vault Folder and Import Obsidian Note both read through `parsePluginColumnTypes`. Was: `data.json` column types (b984af85): app reads them beside `types.json`. Two sources
      disagreeing on one key: which wins, and is it the same answer in Vault Folder and in
      Import Obsidian Note?
- [x] Checked 2026-09-28: the plugin build rewrites every free `localStorage` in app code to memory (`obsidian-plugin/vite.config.ts`), so the store never reaches real storage; the palette persists through `saveData`. Was: Palette from `data.json` (40cd262b): the app's `paletteStore` still reads localStorage;
      inside the plugin two writers to one store. Confirm the plugin path never writes it.
- [ ] Needs the rig's mobile emulation 2026-09-28; nothing to probe in node. Was: Mobile (f2ebf098 measured the rig): touch targets in the popup footer; the phone
      keyboard covering the Save row.

## 32. Frontmatter reader/writer (YAML package adoption, 8072a2d1) and note typing
Commits: 8072a2d1, 50d270a4, 20ab4615, f9174966, 47cb4d04, 3a334d10, 843b7aa5 (Part B)
Where: `noteFrontmatter.ts`, `nodes/annotation.ts` (Note), `nodes/obsidian.ts`, `vaultCube.ts`
- [x] Fixed 2026-09-28 against js-yaml 4 (Obsidian's reader): `yes`, `0755`, `0o17`, `0x1F`, `1_000`, `1:30` and `~` agree; a signed dot-float (`-.5`) was a number here and text there, and a signed or binary radix literal (`+0x1F`, `0b101`) the reverse. The reader follows Obsidian now, from the scalar's source text (`noteFrontmatter.test.ts`). `.inf`/`.nan` read as blank on purpose (`Number.isFinite`). Was: The parser went from hand-rolled to the `yaml` package: YAML 1.1 vs 1.2 differences
      the package resolves differently from Obsidian (`yes`→true, `0755` octal, `1_000`,
      sexagesimal `1:30`, `~`). Obsidian's own reader is js-yaml (1.2-ish). Compare on a
      corpus of real notes; a mismatch means the app reads a property Obsidian shows as text
      as a number.
- [x] Checked 2026-09-28: a column with `2026-13-01` beside real dates stays text as a whole, never a NaN cell (obsidian-plugin § What Solenoid reads back). Was: "Plain ISO dates become serials" at parse time, and typing decides later (b984af85):
      `2026-03-20` in a list with text stays text, alone becomes a date. A column of dates
      where one row is `2026-13-01` (invalid): whole column text, or one cell NaN?
- [x] Checked 2026-09-28, app side: `[[1,2],[3]]` pads to `[[1,2],[3,null]]`, and a Note never rewrites its own YAML, so B12 holds. Plugin side needs the rig: `matrixToYaml` keeps a ragged original, but if the popup hands Save a padded grid it writes `[3, null]`. Was: Matrix guessing (20ab4615): a list of lists "padded rectangular": `[[1,2],[3]]` pads
      with what (blank? 0?) and does write-back preserve the ragged original? [[B12]].
- [x] Checked 2026-09-28: `1e5` is 100000 in both readers, `12-34` is text, `3+4i` complex and `"3+4i"` text; a list mixing `1e5` and `12-34` is a text list. Was: Complex text `3+4i` "never a quoted one": `"3+4i"` stays text, `3+4i` is complex. But
      YAML plain `3+4i` is a string either way; the distinction is Solenoid's. A user who
      types a serial number like `1e5` or `12-34` in a plain scalar: parsed how?
- [x] Checked 2026-09-28: the reader nests to any depth (a 3000-deep nest parses without overflowing the stack). Was: Note node reading a cube row whose value is a table (2c963d58 "now nests"): depth 3
      (table in a row in a table): recursion bound?

## 33. Table popup: CSV view, suggestions, cell editors (09-19, 24 commits)
Commits: 44ee5b41, 8f08c807, 6c5c8f50, a92e5931, 88c4f1ed, 110f66c3, 845a753b, 89dcf042,
f36fc0d3, 47cb4d04, 2686eccf, 25d764dc, cde82932, a4dc1250, 3e776d37 (Part A)
Where: `TablePopup.tsx` (24 commits then 17 more), `columnHeadControls.tsx`, `csv.ts`
- [x] Fixed 2026-09-28: a newline, `"`, a leading `=+-@`, `a,b` and `1,234.50` all round-trip, and Export neutralizes formulas; but a one-column blank row wrote an empty line that read back as the final newline's phantom, so the row dropped (a lone blank cell read back as no rows). It writes as `""` now (`joinCsvRows`, `csv.test.ts`). NEEDS AUTHOR: the CSV view trims every cell on read, per the spec, while § Copy says text keeps its spaces, so one keystroke in the block trims untouched text cells; options are trimming only non-text columns, or only unquoted fields with the writer quoting edge whitespace. Was: One CSV writer for view/Copy/Export (110f66c3): a cell holding a newline, a `"`, a
      leading `=`/`+`/`-`/`@` (CSV injection into Excel), a cell that is only whitespace,
      a formatted number with a locale comma. Read-back through the CSV EDIT path
      (89dcf042 "edit in Formatted mode") must round-trip each.
- [x] Checked 2026-09-28: a focused cell edits the raw text and `decimalFromText("1,235")` is 1235; the locale is fixed en-US ([[C117]] usNumberText); unquoted `1,235` in the CSV block is two fields, as CSV is. Was: Editing in Formatted mode: the user edits "1,234.50" and types "1,235"; parsed as
      1235 or as 1 and 235 (two fields)? Depends on the format's thousands separator.
- [x] Fixed 2026-09-28: Escape reverts and blurs without committing; Tab with nothing highlighted commits the typed text. The list rescanned every text column on every keystroke (18 ms at 10k rows, 170 ms at 250k); it scans only the edited column now, once per grid (looked at live). Nothing checked `isComposing`, so an Enter that confirms an IME candidate could commit the cell; the cell editors skip keys while composing (not verifiable headless). Was: In-app suggestions replaced the native datalist (44ee5b41): keyboard nav, Escape
      closes without committing, Tab commits the highlighted vs the typed, IME composition
      (CJK), 10k distinct values in the column (perf of the list).
- [ ] NEEDS AUTHOR 2026-09-28, not a bug per computed-columns ("anything else stays a number"): `@d + 1.5`, `(@d)+1` and an IF chaining a date column read as dates; `MAX(@a,@b)`, `IF(c,@a,0)`, IFERROR, CHOOSE, IFS, `LET(x,@a,x+1)` and `DATE()+@a` read as numbers, and `addAs` can pin Date. Proposal: MIN/MAX/IFERROR/CHOOSE/IFS over all-date value arguments, LET passing a date, and DATE() read as dates. Was: Computed columns keep a date (cde82932): the type is read from the DEFINITION
      (`returns: "date"`, date ± days, IF over dates). `date - date` is a number. What about
      `MAX(dateA, dateB)`, `IF(c, dateA, 0)`, `dateA + 1.5`, a LAMBDA returning a date,
      a column referencing another computed date column? Each is a place the static reader
      may disagree with the value.
- [x] Checked 2026-09-28: the popup sort is visual and never reaches the node; the Record numbers its own order indices. Was: Popups "only the sort button sorts" (2686eccf) + Part A's `rowNumbers` (item 6):
      after a popup sort, the Record node's row numbers must be source-frame numbers.

## 34. Blank arguments, take one (7b0f3628, 09-16) — the origin of items 1 and 29
- [x] RESOLVED by the tree: [[C80]] blankArgIsExcelBlank's Consequences now name
      `ARG_ROLES` + `applyArgRoles` as the one boundary, and `tree/specs/computation/formula-language.md` § The
      dispatch ladder puts it at step 6. Nothing else to find; `inputRoles.test.ts` pins the
      declaration. (D86 supersedes D33/E15; the lookup family's old blank-is-omitted
      convention is gone per C80's Why.)
- [x] Checked 2026-09-28: MATCH answers `#NAME? Use XMATCH`, VLOOKUP, HLOOKUP and LOOKUP `#NAME? Use XLOOKUP`, and now also on a united input (block 30). Was: "MATCH / VLOOKUP / HLOOKUP are blocked spellings": the Add-menu alias rows (ae4a4c46)
      route them to XMATCH/XLOOKUP; the formula parser must still refuse them with a hint
      naming the replacement, not `#NAME?`.

## 35. Demo vault seam and seeds
Commits: c09fd5fe, 03f0426f, 4d31006d, ce54e6db, 1a96b434, 108e68af, 7dd39e3d, 25c4dfd4 (retry)
Where: `demoVault.ts` (124 lines), `src/graph/seedGraphs/` (28 files), `tests/fixtures/`
- [x] Checked 2026-09-28, not a flood: reads come from compute and refresh (nothing polls but a card's refresh timer), so a broken deploy costs one import per action or refresh period. Unverified caveat: Chromium caches a failed dynamic import, so the retry may need a reload to succeed. Was: Failed chunk load retries "on the next read" with no backoff or cap (demoVault.ts:49):
      on the preview a broken deploy = one fetch per read forever. Cap it.
- [x] Checked 2026-09-28: with no vault set, Write ends "The demo vault is read-only" and `writeTextFilePath` into the demo root throws the same (`fsDispatch` routes it to the read-only demo fs). Was: Demo vault is a FALLBACK when no vault is set (D62): a desktop user who removes their
      vault path silently gets demo data in Vault Folder. The card says "Demo vault"
      (7dd39e3d), but a Write node? Must refuse, not write into the bundle.
- [ ] NEEDS AUTHOR 2026-09-28, premise partly wrong: `seedsCompute.test.ts` runs every seed through a real engine and fails on an unexpected error cell, and 11 per-seed suites pin values (about 180 asserts); about 17 of 28 seeds have no value pinned. Options: a golden snapshot per seed, regenerated on purpose, or pins on the showcase seeds only. Was: Seeds cut 40 → 26 → now 28. Read `seeds.test.ts`: it pins STRUCTURE only (save
      version, node types known, connections resolve, group members / FC hosts / standoff
      ends exist). No computed value is pinned anywhere. So a seed whose numbers changed
      after items 1/2/3/16 passes silently. Proposal for the author: one golden-value
      test per seed (a handful of Display values each), regenerated on purpose only.

## 36. Linux desktop and CI release (09-20/21)
Commits: b56f3b15, 61b59513, b04edf2d, f9c859de, ea5352b6, 2b0a5026, 44f76acd, 1463356b (Part B)
Where: `src-tauri/src/linux_webview.rs` (FFI into WebKit settings), `tauri.conf.json` fs scope,
`.github/workflows/desktop-build.yml`
- [ ] NEEDS AUTHOR 2026-09-28 (small hardening): it turns off one feature now (`AsyncOverflowScrolling`, still present in WebKitGTK 2.52.6). An older runtime fails loud at startup (direct symbols); a renamed identifier fails silent (the loop matches nothing). Proposal: log when no identifier matched, and `bundle.linux.deb.depends: ["libwebkit2gtk-4.1-0 (>= 2.42)"]`. Was: `linux_webview.rs` FFI turns off two WebKit features by name through a settings API
      "that postdates the Rust bindings": pin the WebKitGTK version in the build image, or
      a distro update silently changes the symbol and the crisp-zoom fix dies.
- [ ] NEEDS AUTHOR 2026-09-28: every read, write, rename and stat scope sits under `$HOME`, so a vault on `/mnt`, `/media`, `/srv` or a Windows `D:\\` is denied on every OS. The dot-dir rule is not a security boundary (Script nodes run in a Worker with no `__TAURI__`). Options: widen the scope at runtime from a Rust command when the vault or CSV folder is set, or document "vault under home". Was: fs scope `$HOME/**/.obsidian/*.json`: a vault outside `$HOME` (a mounted drive, `/srv`)
      fails silently on Linux, exactly the bug f9c859de fixed for dot-dirs. And Windows:
      `requireLiteralLeadingDot` false, so the scope is broader there; is anything relying on
      the narrower Linux scope for safety?
- [ ] NEEDS AUTHOR 2026-09-28, a docs gap: no recovery path is written. A flaky run: "Re-run failed jobs" on the tag's run, and the release job follows. A code fix: delete the tag, fix on develop, merge, re-tag. Home: beside the release paragraph in CLAUDE.md or architecture.md. Was: Release on tag "once both builds pass": a Windows-only failure leaves a tag with no
      release; the recovery path (retag? rerun?) should be in `docs/`.

## 37. Charts and Chart Builder (09-15, 09-23)
Commits: 0ac39856, ddc316aa, 0917b398, 169234fd, e0ee9307, 229c4433, 289ac6b9, 9dc85a6e, 80120604
- [x] Fixed 2026-09-28: the export serialized only the plot's SVG, so the webpage Charts section and vault PNGs lost the legend and the series couldn't be told apart. `nodeChartSvgString` draws the DOM legend into the SVG as a row under the plot (`chartLegendSvg.test.ts`, looked at on a live two-series chart). The colorbar, category legend and chart title are DOM too and still drop. Was: Multi-series legend moved into the DOM below the plot (ddc316aa): export to webpage
      / Report / SVG export includes it? (338c51a1 webpage export embeds SVG values; a DOM
      legend is not in the SVG.)
- [x] Checked 2026-09-28: `[5, -5]` is one slice at 100 %, `[0, -1]` the empty dash, both per chart-figures; a single-series Pie has no legend to list a dropped category. Was: Pie drops zero and negative slices (80120604) and all-negative draws the empty dash
      (9dc85a6e): a Pie of [5, -5]: one slice at 100 %, or empty? And the legend still lists
      the dropped category?
- [x] Checked 2026-09-28 where it can run: KPI and bullet render at 210×130 and 60×40; Sankey and the dial are client-drawn recharts (UI-only); a collapsed Display shows its chip, a collapsed Gauge nothing. Was: Every renderer routed through ChartFigure (229c4433): Sankey/KPI/Gauge previously
      drew directly; check the Display node path and the collapsed-card preview still render
      them at the small size.

## 38. Pre-release items, one look each
- [x] Fixed 2026-09-28: a Note or Report template dating `'now'` renders fresh each pass (fine under D46), but the midnight rollover didn't see it, so it stayed on yesterday; `hasVolatileDates` reads `body` for a Knap `'now' | date` now (`volatileDates.test.ts`). Was: 3a334d10 Knap inside frontmatter: the socket carries the rendered value: a template
      whose render depends on TODAY (item 21) freezes per calc?
- [ ] NEEDS AUTHOR 2026-09-28: a note edited in Obsidian shows no staleness until Refresh. Options: an mtime check on window focus, a "file changed" badge from the existing `stat`, or keep manual refresh and say so on the card. Was: 947b0a24 / b2d982f0: vault file watcher dropped, refresh is manual. Import Obsidian
      Note "reloads on Refresh all connections"; a note edited in Obsidian while Solenoid
      shows it: no indication of staleness until refresh. Product call; note it.
- [x] Already in the inbox (`ghost-cables-feed-and-save`): Input Switch's pending ghosts drop the connection and feed nothing; only the other ghost kind feeds. Was: 2204d7ce Input Switch pending-reconnect ghosts; 1d83b0bc "ghosts feed data and aren't
      saved": a ghost that feeds data into a computed value that IS saved.
- [x] Checked 2026-09-28: one ladder, `measuredBox` (RF-measured, then DOM, then declared), declared only before first paint. Was: d66ef283 Tidy uses the measured box: first Tidy after load, before React Flow has
      measured (item 26's `D64 (retired)` reads stored size): two sources of size.
- [x] Checked 2026-09-28: C = π/2 rad, 90 deg and 100 grad all give c = 5; a length on the angle is #UNIT! "C is an angle"; a bare number reads as degrees. Was: fb5f8bb9 Triangle Solver reads any angle unit in degrees: radians input → wrong
      unless converted; check the unit is READ, not assumed.
- [x] Fixed 2026-09-28: `SEEDS` was a plain object, so `?seed=constructor` found a "seed" and saved a document with no graph; it has no prototype now (`seeds.test.ts`). An unknown name or path characters were already ignored. Was: 8b10122c `?seed=` deep link: an unknown seed name, a seed name with path chars.
- [x] Fixed 2026-09-28: aliases, headings, nested tags, code spans and fences and `#REF!` render right, but `a#b` chipped `#b`: marked tries the tokenizer at every offset, so the word-start check in `start` didn't gate it; the tokenizer checks the character before it now (`noteMarkdown.test.ts`). `![[pic.png|200]]` shows 200 as the alias where Obsidian reads a size (UI-only, open). Was: 5fbd3021 etc. tag chips / wikilinks in Note surfaces: a `[[link|alias]]`, a
      `[[link#heading]]`, a `#tag/nested`, a `#` inside a code span (ff417bdc says code is
      excluded for Vault Folder; the Note renderer too?).
- [x] Checked 2026-09-28: an unknown type loads as a placeholder with an error notice naming the type, so it is loud; the notice's pack hint is wrong for a rename, acceptable under B7. Was: 413c6ff0 renames Distribution → Distributions, Set → Sets: seeds and saved docs from
      before 1.4.0 fail loudly ([[B7]])? Or does the placeholder path (C35) swallow them as
      Missing cards with no message?

---

# Part D: after reading the tree and the specs (corrections and three new findings)

Read in this order before any block above: `dte-rules/CLAUDE.md`, `docs/dte.md`, `docs/mental-model.md`,
`docs/README.md` (the routing table), `docs/glossary.md`, rings A→E (`python3 tools/dte.py tree`),
then the spec the block's files route to. Several Part A/B/C items were open questions that the
tree already answers; those are marked [x] in place above with the leaf. What follows is what the
reading ADDED. `python3 tools/dte.py validate --as B` prints OK at this head (135 leaves, 125
unratified, 35 in the inbox, 0 errors).

## 39. The native parity corpus never runs in CI (new; highest priority)
`tree/specs/computation/frame-verbs.md` § The parity corpus: **MUST** "every verb both engines speak is specified by
corpus cases"; `corpus_cases` in `src-tauri/src/engine/tests.rs` runs the fixtures through Polars.
`.github/workflows/test.yml` runs `npm ci`, `plugin:build`, `tsc`, `vitest`, `cargo audit` and a
`tauri build --no-bundle`. **No `cargo test` anywhere.** So the JS half of the corpus gates every
push and the Rust half gates nothing: the 09-24 fleet's two auto-merged `engine.rs` changes
(item 15), the reserved-NaN error cells (54bd9e3b), the window/join parity closes (996a8ec1) and
the °C `readingScale` plumbing were verified only by whoever ran cargo by hand.
- [x] Done 2026-09-28: `test.yml` has a `rust` job (the desktop build's apt prerequisites, then `cargo test --manifest-path src-tauri/Cargo.toml`); frame-verbs § The parity corpus says both halves gate every push. Was: Add `cargo test --manifest-path src-tauri/Cargo.toml` (at least `corpus_cases`) to
      `test.yml`. It compiles already (`tauri build --no-bundle`), so the cost is the test run.
      Governing leaf: [[C16]] polarsEngine ("a shared set of test cases both must pass"), which
      the spec turns into a MUST that is currently *Unenforced* in CI without saying so.
- [x] Done 2026-09-28 from the cloud session: with `libwebkit2gtk-4.1-dev` and friends installed the crate builds in a container, and all 33 engine tests pass on this head, `corpus_cases` included. Was: Until it runs: an agent with the desktop machine runs it once on this head and reports.
      A cloud session cannot ([[B2]] webTryDesktopFull; CLAUDE.md § Environment constraints).

## 40. The socket-lattice sweep test is gone; the spec still cites it (new)
`tree/specs/values/socket-lattice.md` § Enforcement: "`socketConnect.test.ts` sweeps the whole family × dimension
cross product with the same `dimFlows` predicate … and pins both family-less adoption branches."
9a419d55 ("Cut tests the rest of the suite already decides") took that file from ~490 lines to
66, 5 `it`s, none of which references `FAMILIES`, `DIMS` or `dimFlows`. The removed titles
include "anytable is a 2-D wildcard", "a combo narrows into its element scalar", "blocks
narrowing back down the ladder". `rules.test.ts` still passes because the file still exists and its
line 1 is `// [[C10]]`: the test ("every MUST is enforced by a citing test or labelled
Unenforced") checks citation presence only, by design; whether a citing test enforces its MUST
is "a reader's job" (`docs/dte.md`). Confirmed, not inferred.
- [x] Done 2026-09-28 with block 13: the within-family and cross-family sweeps are back in `socketConnect.test.ts`, deriving each answer from the rule; `socketReference.test.ts` covers every explicit pair against the doc. Was: Either restore the sweep (the spec's req. 5 list is the checklist: every explicit
      cross-type edge, both family-less adoption branches) or name the test that now covers
      each removed title. `socketReference.test.ts` checks the doc's connection lists against
      `accepts()`, which is a different, weaker check (the doc could be wrong the same way).
- [x] Done 2026-09-28 with block 13 plus `formulaLambda` (its cuts have stand-ins; two old tests fail only where D85 changed the shape on purpose) and `formulaNodeParity` (its stale-pin checks guarded lists that are empty now). Restored: uiCopy's rule specimens, the lattice sweeps, XLOOKUP's approximate match. Was: Same audit for the other big cuts in item 13, now with the specs' Enforcement sections
      as the oracle: `formulaLambda`, `formulaNodeParity`, `frameVerbs` (190 lines), `composite`
      (86), `uiCopy` (98), `distributions` (64), `excelFunctions` (61). For each, open the spec
      the file routes to, find its "Enforced by / What pins this" table, and confirm the pinned
      behaviours are still asserted somewhere.

## 41. E9 provenance across the native wire: the weak registry (new, small)
See item 20's corrected bullet. The design is right; the window is a GC'd original between an
upload and a re-flushed download. Pin it or accept it in the spec with one line.
- [x] Accepted in frame-verbs § PolarsBackend 2026-09-28: once the original is collected the cell downloads code-only with the code's standard message; a forced-GC pin isn't possible under vitest.

## 42. The °C table, with the spec's expected answers (replaces item 16's first bullet)
From `tree/specs/values/unit-flow.md` § Expression and § Reducing a list, and `tree/specs/computation/frame-verbs.md` § groupBy. Three
surfaces must agree (Arithmetic/Aggregate card, formula, GROUPBY/Window): a = 20 °C, b = 30 °C,
n = 5, x a logical.
| expression | expected | rule |
|---|---|---|
| a + b | `#UNIT!` "readings can't be added" | two readings, weight 2 |
| b − a | 10 K (a delta, affine display dropped) | weight 0 |
| a * 2, a / 2 | `#UNIT!` "a reading can't be scaled" | constant factor |
| (a + b) / 2 | 25 °C | weight 1 |
| n + a | 25 °C | bare number is a delta under + |
| a > n | TRUE (5 read as 5 °C) | bare number is a READING under compare |
| MIN(a, n) | 5 °C | MIN/MAX/MEDIAN/AVERAGE keep the weight; bare beside readings is a reading |
| SUM(a, b) | `#UNIT!` | SUM adds weights; SUMIF/SUMIFS same |
| SUM(a, n) | 25 °C | one reading + delta |
| AVERAGE(a, b) | 25 °C | reading |
| STDEV(a, b), VAR, DEVSQ | delta in K (VAR in K²) | spreads answer a difference |
| ABS(a), INT(a), ROUND(a) | 20 °C | computed on the displayed reading (e1089889) |
| MOD(a, 7) | `#UNIT!` | refused on an affine display |
| IF(x, a, n) | 20 °C or 5 °C | a literal branch counts as a reading |
| IF(x, a, b − a) | `#UNIT!` | branches disagree (reading vs delta) |
| REDUCE(0, [a,b], MAX) | 30 °C | fold answers a reading each step |
| REDUCE(0, [a,b], LAMBDA(p,v,p+v)) | `#UNIT!` | accumulator changes kind |
| GROUPBY sum of a °C column | `#UNIT!` in every cell | `aggUnitPlan`; native gets `readingScale` |
| GROUPBY stdev of °C | K (delta); var → K² | scale by 5/9 per power for °F |
| Window cumsum / share / pct_change on °C | `#UNIT!`; `diff` → K | spec table |
| 20 °C + 300 K | OPEN: inbox `kelvin-is-a-reading` proposes `#UNIT!` | not yet placed |
An agent runs this table as one test per surface and reports the cells that disagree; a
disagreement is a bug against [[C25]] firstClassUnits, and the fix goes where the spec says.
- [x] Run 2026-09-28 (see block 16): every row answers as the table says on the card, the formula and GROUPBY/Window, °F included, after two fixes (a wired plain number beside readings, and °F read-back noise). REDUCE with MAX is 30 °C, a fold that adds readings #UNIT!, VAR and DEVSQ squared deltas; the window rows are pinned in `frameReadings.test.ts`. `20 °C + 300 K` stays with the inbox item.

## 43. Already in the inbox (don't re-file; cite the slug instead)
Waiting on the author (`python3 tools/dte.py tree`, PENDING PLACEMENT): `kelvin-is-a-reading`
(item 16/42), `aggregate-list-cells` (item 3, logicals in aggregates), `empty-average-unified`
(item 3, AVERAGE of nothing vs AVERAGEIF), `text-args-to-aggregates`, `selectors-see-branch-
errors`, `lock-refuses-undo` (item 22; 703205c7 already built it), `paste-carries-card-state`
(item 8), `composite-inner-names` (item 18: names inside a composite are NOT saved today, per
`tree/specs/computation/composite-nodes.md` § Save and load), `script-volatile-freeze`, `node-formula-reach-gaps`,
`flag-ill-typed-cables` (item 17: a cable that connects then errors gets no mark),
`card-growth-pushes` / `expand-overlap-with-push-off` (item 26), `preset-declared-units` and
`pack-node-input-units` (the backlog's "packs and units" line), `schedule-repeat-cap` (item 30).
A finding that lands on one of these is evidence for the author, attached to the inbox note,
not a new leaf and not a patch.
- [x] Noted 2026-09-28: findings on these slugs went into the blocks above as evidence; nothing was patched against a pending inbox item (block 38's ghost cables cites `ghost-cables-feed-and-save`).

## 44. What the specs settle that Part A/B treated as open (one line each)
- Item 1: `tree/specs/values/input-roles.md` names the three inputs NOT yet swept (column references, the as-of
  tolerance, the Slider bounds) as `[decided 2026-09-26]`; they still propagate. Not bugs.
- Item 2: [[D85]] columnsStayColumns is the leaf; `INDEX(list, 2, 1)` is `#REF!`, `SORT(list)`
  is a no-op without `by_col`, TAKE/DROP count items as columns. The author: "strict excel".
- Item 4: the lexer has no escaped quotes, no `'` strings; a doubled `"` is two strings (a
  syntax error). So `closeParens`'s `"` toggle is right for the grammar. **One real bug
  candidate, reproduced:** a bracket reference whose column name holds an unbalanced paren,
  `SUM([Unit (Price)]`, counts 2 open / 1 close and appends a stray `)`, turning a formula
  that parsed into one that doesn't. [[C115]] says "parentheses inside quoted text don't
  count"; a `[Name]` is the other place text sits. Fix shape: skip `[`…`]` runs in the count
  as the tokenizer does (text up to the first `]`). Small, and it has a one-line test.
- Item 6: closed. `nodes/visual.ts:1094` builds `rowNumbers` as `drawn.map(r => r + 1)` over
  the Record's own drawn row indices into the FRAME, and `chartCards.tsx:192` reads it with a
  `?? r + 1` fallback. Source-indexed. (The popup's Cards view sorts visually and keeps source
  indices per `tree/specs/documents/table-popup.md` § Sorting; a different path, also fine.)
- Item 7: SORT/UNIQUE `by_col`, FILTER mask shape and SORTBY key orientation are all spelled
  out in `tree/specs/computation/formula-language.md` § Matrices. Confirmed the four kernels (`sortGrid`,
  `sortGridByKeys`, `filterGrid`, `uniqueGrid`) are called from exactly two files,
  `nodes/list.ts` and `excelFunctions.ts`, so card and formula share one implementation
  ([[C17]] shareImpl). Only conformance to the spec table is left to test.
- Item 18: composites' inner NAMES aren't saved (spec says so; inbox item). Side tables are.
- Item 19: a failed fetch records its key and never retries until the key changes (by design);
  a timer whose card is gone clears itself on its next fire.
- Item 21: TODAY is the local calendar day as a UTC serial; relative phrases only on an opted-in
  Date Input ([[D54]]); every reader uses UTC getters ([[C44]]). The TZ question is answered.
- Item 23: C95's Consequences: switch/save/close commit drafts; the background autosave never
  does. A half-typed frontmatter committing on a document switch is the rule.
- Item 24: `frontmatterPatch.test.ts` "proves untouched bytes identical and a cube round-trip
  unchanged"; the `yamlScalar` quoting list in `tree/specs/documents/reports-and-notes.md` § Frontmatter YAML already
  covers yes/no/on/off, `+1`, `-.5`, `.inf`, leading `'`. Still open from my list: `0o17`,
  `0x1F`, `1_000`, `1:30` (YAML 1.1 forms the `yaml` package's core schema may read differently
  from Obsidian's js-yaml), a value that is only spaces, a trailing `#` comment.
- Item 29: "text in arithmetic is `#VALUE!`" vs "Cast reads number text" vs NUMBERVALUE is
  not three rules: `decimalFromText` is the one reader (`tree/specs/values/value-semantics.md` § Boundaries), the
  operators refuse text by [[C10]], and Cast/VALUE/NUMBERVALUE call the reader. One table exists.
- [x] Checked 2026-09-28: item 4's one bug candidate is fixed (block 4): `SUM([Unit (Price)]` closes to `SUM([Unit (Price)])`, a bracket reference's text not counted; the rest are settled lines the blocks above cite.

## Reading order for the fleet (revised)
39 (CI) and 40 (the sweep) first, they are one-afternoon fixes that make everything else
checkable. Then 15, 42, 17, 20, 24, 28 in parallel. Then 18+19, then Part A 1/2/3. Every finding
cites its leaf as `[[ID]] name`; a fix ships with the test that would have caught it
(`docs/dte.md` § Solenoid practice); an unratified leaf gets its one contest before new work under
it (DTE's own B28 oneContest, `dte-rules/CLAUDE.md`).

## Already-flagged by the repo (don't re-find)
`docs/backlog.md` § "From the 2026-09-24 review rounds": desktop close listener, composite
network-permission blank, RANDARRAY over an integer-free range, packs building bare constants
(wrong dimensions with wired units), FORECAST.ETS ignored options, unchecked case options.

## Baseline
At 37c92d8 (2026-09-27, fresh `npm ci`): `tsc --noEmit` exit 0. `vitest run`: 412 files
passed, 1 skipped; 6579 tests passed, 4 skipped. So every item above is a logic/spec review,
not a red test to chase. A finding that lands should come with the test that would have caught it.
