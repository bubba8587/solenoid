# Bundle 08 — The Excel transpiler: open an .xlsx, see it as a graph

**Source:** scope-features #8. **Verdict:** IN — "in for sure." **Depends on:** bundle
02 (shape-checking, for range→typed-frame conversion) for the polished version; the
CLI-grade spike needs neither 01 nor 02. **Sequence:** late per the author's own note.

## Grounding — the parser and catalog machinery already built

**`src/graph/excelFormula.ts` exports** (the parser to run each cell formula
through; find by symbol — line numbers rot, and the module has since grown
`lambda`/`apply`/`blank`/`atcol`/`wholecol` AST nodes and `colref`/`rowref`
tokens for the tableRefSemantics structured references):
- `Ast` type: tagged union incl. `num/str/bool/name/call/unary/percent/bin`,
  e.g. `{t:"call"; name:string; args:Ast[]}`.
- `Tok` type + `tokenize(src): Tok[]|null`.
- `extractVariables(expr): string[]`.
- `formulaToLatex(expr): string|null` (reused by bundle 13).
- `FormulaStep` type, `evaluateSteps(expr, vars)`.

**Function-name→node mapping (the redirect table's foundation) is NOT in
`excelFormula.ts` — it's `NODE_EXCEL: Record<string, ExcelEquiv[]>` in
`src/graph/nodeExcel.ts:9`**, keyed by catalog `type` string → array of
`{excel, syntax, parity, note?}` (`ExcelGapRow`/`ExcelEquiv` types). Applied onto
catalog leaves by `buildCatalog` (per `nodeExcel.ts:1-5` comment). **This is the
Excel-function-name → Solenoid-node reverse lookup the transpiler needs** — for a given
Excel function name found in a workbook formula, search `NODE_EXCEL`'s values for a
matching `.excel` field to find the target node type. `EXCEL_GAP` (`nodeExcel.ts:527`)
already lists every UNIMPLEMENTED Excel function — this is the exact "can't map, fall
back to Expression node" list; `scripts/parity.ts` already generates a report from it
and is a working example of importing/using this data outside the app.

**Auto-arrange call site (for the transpiler's "arrange the emitted graph" step):**
Tidy is elkjs called directly — `elkTidyLayout` / `makeArrangeFn` in `tidyArrange.ts`,
wired by `FlowCanvas` and exposed to the rest of the app via `setAutoArrange(fn)`
(`process.ts`, signature `(fn: (opts?: {groupId?: string}) => Promise<void>) => void`),
invoked as `await arrangeFn({skipConfirm: true})`. **The transpiler's layout step should
call the same accessor** (`process.ts`'s slot), not reimplement layout invocation.

**currentExcelParity enforcement mechanism:** the redirect rule (eliminated functions like VLOOKUP
never come back, they redirect to Frame Lookup/XLOOKUP) is enforced by simply NOT
adding an entry back to `NODE_EXCEL`/the catalog for an eliminated function — `EXCEL_GAP`
already tracks what's deliberately unimplemented. The transpiler's redirect table is a
manually-curated map (eliminated Excel fn → replacement node type), separate from
`NODE_EXCEL` (which maps to what already exists); build it as its own small lookup, and
cross-check it against `EXCEL_GAP` so a "redirect" target is never accidentally an
already-eliminated function too.

## Honest scoping — the 70% strategy (author-confirmed)

Don't chase 100%. Transpile the tractable core (arithmetic, the supported function set,
contiguous ranges → frames) and drop an Expression node containing the original formula
text for anything that doesn't map — reuse the existing `PlaceholderNode`
(`nodes/placeholder.ts:16-57`) lossless-preservation philosophy as the template for "keep
the original text even if inert."

## Build order

1. **CLI-grade spike (do first, doesn't block on anything):** one sheet, values +
   arithmetic formulas only, emit a graph JSON (`SavedGraph` shape from bundle 01's
   grounding — `persistence.ts:60-87`), open it in the app.
2. Parser integration: for each cell formula, `tokenize` → build `Ast`
   (`excelFormula.ts:20-33`) → walk the AST emitting Solenoid nodes/cables. Cell
   references become cable endpoints; contiguous ranges become frames (typed via bundle
   02's `shapeOf` once available).
3. Redirect table: build the small eliminated-fn → replacement-node map, cross-checked
   against `EXCEL_GAP` (`nodeExcel.ts:527`) and using `NODE_EXCEL` (`nodeExcel.ts:9`) for
   the "already has a direct node" case.
4. Fallback path: any formula whose function isn't in `NODE_EXCEL` and isn't in the
   redirect table becomes an Expression node carrying the original formula text verbatim
   (formulas compute at rank ≤ 2 since matricesInFormulas — frames/cubes stay out — so a fallback can
   still be inert; that's fine, same as any Placeholder).
5. Layout: call the same `arrangeFn({skipConfirm: true})` accessor the Tidy button uses
   (`process.ts` `setAutoArrange` slot) on the emitted graph.
6. Sheets → PAGES: each source sheet becomes a page of the one document
   (`20-pages.md` — Arc 1 lands first; cross-sheet references become cross-page
   connections rendered as portal stubs). Before pages exist, a `GroupNode` per sheet
   (`nodes/group.ts`, `members: string[]`) is the interim.
7. Excel Tables (ListObjects) → Frame Inputs with COMPUTED COLUMNS: structured references
   (`[@Price] * [@Qty]`, `SUM(Table1[Total])`) map onto tableRefSemantics (`@name` = this
   row, bare name = the column) — the transpiler's best-fidelity path; build it second,
   right after the arithmetic spike. Named ranges → node names; data-validation lists →
   categorical columns (`../1.4-plan.md` B2).
8. Fidelity report: per formula — mapped / redirected / fallback Expression / dropped — as
   a frame the user can filter, plus Problems entries. Parser dependency: an xlsx reader
   (SheetJS community edition or exceljs; license + bundle size are the gate; desktop-only
   import is acceptable for v1). Evaluation + sequencing: `../2.0-plan.md` Arc 3.

## Exit criteria

A real, non-trivial `.xlsx` workbook (arithmetic + a reasonable function mix)
transpiles into a Solenoid graph: mapped formulas become live nodes/cables via the
`excelFormula.ts` AST walk, ranges become typed frames, unmapped formulas surface as
inspectable Expression-node fallbacks with the original text preserved, eliminated
functions are redirected via the cross-checked redirect table (never re-added), and the
result auto-arranges via the existing `arrangeFn` accessor.
