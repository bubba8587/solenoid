# Bundle 08 — The Excel transpiler: open an .xlsx, see it as a graph

**Source:** scope-features #8. **Verdict:** IN — "in for sure." **Depends on:** bundle
02 (shape-checking, for range→typed-frame conversion) for the polished version; the
CLI-grade spike needs neither 01 nor 02. **Sequence:** late per the author's own note.

## Grounding — the parser and catalog machinery already built

**`src/graph/excelFormula.ts` exports** (the parser to run each cell formula
through; find by symbol — line numbers rot, and the module has since grown
`lambda`/`apply`/`blank`/`atcol`/`wholecol` AST nodes and `colref`/`rowref`
tokens for the D24 structured references):
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
`AutoArrangePlugin` from `rete-auto-arrange-plugin`, instantiated `Canvas.tsx:1193`,
preset registered `:1201`, actual layout call `await arrange.layout({...})` at
`Canvas.tsx:1809`. Exposed to the rest of the app via `setAutoArrange(fn)`
(`process.ts:64`, signature `(fn: (opts?: {groupId?: string}) => Promise<void>) => void`),
invoked as `await arrangeFn({skipConfirm: true})` (e.g. `Canvas.tsx:2031`). **The
transpiler's layout step should call the same accessor** (`process.ts`'s
`getAutoArrange()`/equivalent), not reimplement layout invocation.

**D10 enforcement mechanism:** the redirect rule (eliminated functions like VLOOKUP
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
   (formulas compute at rank ≤ 2 since D23 — frames/cubes stay out — so a fallback can
   still be inert; that's fine, same as any Placeholder).
5. Layout: call the same `arrangeFn({skipConfirm: true})` accessor Canvas.tsx uses
   (`process.ts:64`) on the emitted graph.
6. Sheets → Groups: each source sheet becomes a `GroupNode` (`nodes/group.ts:11-40`,
   `members: string[]`).

## Exit criteria

A real, non-trivial `.xlsx` workbook (arithmetic + a reasonable function mix)
transpiles into a Solenoid graph: mapped formulas become live nodes/cables via the
`excelFormula.ts` AST walk, ranges become typed frames, unmapped formulas surface as
inspectable Expression-node fallbacks with the original text preserved, eliminated
functions are redirected via the cross-checked redirect table (never re-added), and the
result auto-arranges via the existing `arrangeFn` accessor.
