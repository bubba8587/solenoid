# Bundle 08 — The Excel transpiler: open an .xlsx, see it as a graph

**Source:** scope-features #8. **Verdict:** IN — "in for sure." **Depends on:** bundle 02
(shape-checking, for range→typed-frame conversion) for the polished version; the CLI-grade
spike needs neither 01 nor 02 and can start immediately. **Sequence:** late in the queue
per the author's own note (consumes Bet 3 + the D10 redirect decisions) — start the spike
early, but the full design deep-dive stays late.

## Why Solenoid is unusually positioned

The hard parts already exist: `excelFormula.ts` contains a real Excel formula parser
(tokenizer + AST) built for the Expression node, and the function catalog already maps a
large Excel surface to nodes. A transpiler is: parse `.xlsx` (documented XML format,
libraries exist) → run each formula through the existing parser → emit nodes/cables →
let the existing Tidy/ELK layout arrange them.

## Honest scoping — the 70% strategy (author-confirmed)

Don't chase 100%. Transpile the tractable core (arithmetic, the supported function set,
contiguous ranges → frames) and drop an **Expression node containing the original
formula text** for anything that doesn't map — visible, inspectable, fixable by hand,
following the same Placeholder philosophy already used for unknown node types. A 70%
transpile that flags the other 30% beats 0%.

**D10 holds (standing rule, don't relapse):** the transpiler REDIRECTS eliminated
functions (VLOOKUP → Frame Lookup / XLOOKUP, etc.) — it never re-adds an eliminated
function just because a workbook used it.

## Build order

1. **CLI-grade spike (do this first, doesn't block on anything):** one sheet, values +
   arithmetic formulas only, emit a graph JSON, open it in the app. This is the "does
   this feel like the flagship feature it smells like" test before investing further.
2. Parser integration: run each cell formula through the existing `excelFormula.ts`
   AST parser; map cell references to cables, contiguous ranges to frames (using bundle
   02's shape-checking once available, so ranges become genuinely typed frames rather
   than untyped grids).
3. Function redirect table: eliminated-function → replacement-node mapping, reusing the
   function catalog's existing Excel-equivalents metadata. This is where D10 gets
   enforced mechanically, not just as a code-review rule.
4. Fallback path: any formula that doesn't parse/map cleanly becomes an Expression node
   carrying the original formula text verbatim (may be inert under the Expression cap —
   that's fine, same as any other Placeholder).
5. Layout: run the Tidy/ELK auto-arrange pass on the emitted graph so it isn't a pile of
   overlapping nodes at (0,0).
6. Sheets → Groups: each source sheet becomes a Group container in the emitted graph.

## Exit criteria

A real, non-trivial `.xlsx` workbook (arithmetic + a reasonable function mix) transpiles
into a Solenoid graph: mapped formulas become live nodes/cables, ranges become typed
frames, unmapped formulas surface as inspectable Expression-node fallbacks with the
original text preserved, eliminated functions are redirected (never re-added), and the
result auto-arranges into something readable, not a formless dump.
