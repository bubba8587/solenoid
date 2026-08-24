# A5 — node-by-node sweep, one family per claim

**Goal.** Every catalog family walked once: each node's `data()` handles a wired blank / null /
error / empty input per `docs/value-semantics.md`'s role table; its catalog description says
what the code does; its copy obeys DESIGN.md §7; its collapsed card shows the result. Fix
small on the spot and pin it; file anything big as one backlog line.

This plan is claimed PER FAMILY (the table below). One family per commit series; tick the
row here when the family's digest line is written. The plan is deleted when the table is
all ticked and the backlog lines "A5" + "Node-by-node sweep" are deleted.

**Read first (once per agent, not per family).** `docs/value-semantics.md` lines 108-284
(the role table at `:159-172` IS the contract; the three-state read `:236-241`; guard
placement `:249-268`); DESIGN.md §7 (`DESIGN.md:287-340`); `docs/code-comments.md`;
`src/graph/nodes/wiredNull.test.ts:20-32` (the pairing rule and the test shape you copy).
**Verify against code, not memory** — a 2026-08 sub-agent "confirmed" TBILL matched Excel
from recall while the code used 365 for Excel's 360 (`docs/dev-notes.md:547`).

## The procedure (per family)

1. **List the leaves.** `flattenLeaves(buildCatalog(false))` filtered by `categoryPath`
   (`src/graph/catalogSearch.ts:23`; `buildCatalog` `catalogUtils.ts:104`) — or just read
   the category block in `src/graph/nodeCatalog.ts` at the line in the table. Note which
   leaves share a class (op-selector families: `src/graph/nodeOps.ts:138` `NODE_OPS`); sweep
   the CLASS once, every op's branch.
2. **Value semantics, per input.** For each input of each class, classify its role from the
   table (operand / mode selector / shape / reduction member / check parameter / control
   bound / column reference / figure datum / presentation / filter predicate / optional)
   and read `data()` to confirm the behaviour matches. Must-haves: reads go through
   `readInput` (`nodes/shared.ts:127`) or `pickSlot` (`nodes/logic.ts:57`), never
   `?? this.literals` (`readInputSweep.test.ts` already fails on that idiom — it will not
   catch a hand-rolled `if (v === undefined)`); error branch above the blank branch; on a
   multi-op class the guard covers only the ACTIVE op's inputs (`value-semantics.md:262`);
   reductions use `forAggregate` (`valueKinds.ts:160`) or match its skip-null/first-error
   rule; per-cell work goes through `broadcast*` (`shared.ts:139+`) or honours the same
   contract; NaN/±Inf pass `guardFinite` (`valueKinds.ts:127`) where a scalar result can
   go non-finite. Empty list / empty frame in: result per the family's convention (an
   aggregate of nothing is null, a transform of nothing is empty) — check, don't assume.
3. **Description truth.** Read the catalog `description` (inline in `nodeCatalog.ts`, or
   `*_OP_META[op].description` in the node file for `*Leaf()` entries — `nodeCatalog.ts:94-139`
   lists the helpers) and every `static socketDocs` sentence. Each behavioural claim
   ("ignores empties", "1-based", "case-insensitive", "inclusive end") must be true in
   `data()`; each must be pinned in `src/graph/finePrintContract.test.ts` (one `describe`
   per claim, the file's existing shape) if it isn't already. A false claim: fix the CODE
   if the claim is the Excel behaviour, else fix the string. Check `docs/decisions.md` for
   a ruling before changing either (caseContract / D12, currentExcelParity).
4. **Copy.** Every string you touch: American spelling, no em dashes, no trailing
   parenthetical, no gesture/widget narration, third person for descriptions, Excel note
   as a plain trailing sentence ("Excel: XLOOKUP."). Run `uiCopy.test.ts`; the un-enforced
   rules (em dash, trailing parenthetical) you apply by eye to what you edit — do not
   sweep the corpus for them (that is its own item).
5. **Collapsed card.** Nothing asserts this (vitest is node, no render); it is an EYEBALL
   list for the author. Per class, from the fold rule `nodeCard.css:295-302` (survives:
   header, display value, literal field, output rows, merged input pill, `collapsed-only`
   readout): does the result survive collapse, do multi-outputs stay tellable-apart, does
   a ≥2-input class get the pill? Write one line per class you are unsure about into your
   final message; do not fix CSS.
6. **Pin.** Add `describe("<Family> — wired blank by role", …)` to
   `src/graph/nodes/wiredNull.test.ts` with the pair per input you fixed OR found
   unpinned: `node.data({ x: [null] })` → null (or the role's outcome) AND `node.data({})`
   → the literal. Frame nodes: `await` + a `FrameValue` literal (`:243`). Coercion-path
   cases wrap with `wrapNodeData` (`:16`). Description claims → `finePrintContract.test.ts`.
7. **Commit per family** (message: `<Family> sweep: <findings>`), `tsc` + the named tests +
   full suite green. One digest line in `docs/dev-notes.md` in this shape:
   `**<Family> sweep** (N leaves / M classes) → <finding>; <finding>. Pins: <files>.
   Residue: <backlog line or none>.` Tick the row below.

Stay on scope: a tempting adjacent refactor, a node-combining idea, a new op → one
Findings line, no change. Feature-shaped gaps go to `docs/deferrals.md` only if the digest
line can't hold them.

## Families (claim one; tick when digested)

Leaf counts and lines are `nodeCatalog.ts` (2026-08-24). Class file is where `data()` and
`*_OP_META` live. The two cross-file traps: `BitwiseNode` is in `finance.ts` but catalogued
under Numbers ▸ Engineering; `RandBetweenNode` is in `display.ts` but under Input.

| ✓ | Family (catalog line) | Leaves | Class file(s) | Existing pins to extend |
|---|---|---|---|---|
| [x] | Input (direct + Control) (`:180`, `:197`) | 23 | `nodes/input.ts`, `nodes/control.ts`, `display.ts` (RandBetween) | `wiredNull.test.ts:146` (control bound) |
| [x] | Input ▸ Connections (`:213`) | 10 | `nodes/connection.ts`, `obsidian.ts`, `dataFeed.ts` | `sourceInvariants.test.ts` (read only; don't loosen) |
| [x] | Output (direct, Data Quality) (`:232`, `:237`) | 4 | `display.ts`, `quality.ts`, `tornado.ts` | `SEES_ERRORS` `errorValue.ts:129` |
| [x] | Output ▸ Visuals, all subs (`:245-283`) | 34 | `nodes/visual.ts`, `tornado.ts`, `chartOptions.ts` | `wiredNull.test.ts:289` (figure sinks), `:483` (figure controls) |
| [x] | Numbers ▸ Arithmetic / Functions / Rounding / Logarithms (`:337-378`) | 32 | `nodes/scalar.ts` | `wiredNull.test.ts:209` (guard placement) |
| [x] | Numbers ▸ Trigonometry / Combinatorics / Engineering / Bessel (`:389-425`) | 41 | `nodes/scalar.ts`, `finance.ts` (Bitwise) | — |
| [x] | Numbers ▸ Complex (`:434-451`) | 24 | `nodes/complex.ts` | — |
| [x] | Lists ▸ Build / Shape (`:470`, `:486`) | 24 | `nodes/list.ts` | `wiredNull.test.ts:429` (column-list ref) |
| [ ] | Lists ▸ Transform / Find (`:518`, `:544`) | 23 | `nodes/list.ts`, `indexAccess.ts` | `finePrintContract.test.ts:30` (DROP), `:119` (Slice) |
| [ ] | Lists ▸ Aggregate + Spread & Shape + Correlation (`:561-587`) | 41 | `nodes/list.ts` (ReduceOp `:1865`), `stats.ts` | `wiredNull.test.ts:99` (reducers skip) |
| [ ] | Lists ▸ Rank / Regression / Tests / Stats (`:600-637`) | 36 | `nodes/stats.ts`, `fitOps.ts`, `forecastOps.ts`, `mlOps.ts` | `wiredNull.test.ts:492` (Z.TEST) |
| [ ] | Logic + Boolean (`:654`, `:669`) | 17 | `nodes/logic.ts` | `wiredNull.test.ts:114`, `:345` (Kleene) |
| [ ] | Finance: TVM / rate / payment / cash flow (`:685-707`) | 14 | `nodes/finance.ts`, `financeOps.ts` | `financeInvariants.test.ts` |
| [ ] | Finance: bonds / depreciation / other / coupon (`:717-751`) | 35 | `nodes/finance.ts` | `financeInvariants.test.ts`, `wiredNull.test.ts:397` (active-op guard) |
| [ ] | Distributions (`:765`) | 6 | `nodes/distribution.ts`, `distributionOps.ts` | — |
| [ ] | Date & Time (`:782-821`) | 27 | `nodes/date.ts`, `dateOps.ts`, `dateSerial.ts` | `wiredNull.test.ts:319` (date operands); the AUTHOR CALL on selector inputs (`backlog.md` "mode-selector inputs on a wired blank") — record, don't decide |
| [ ] | Text (`:837-880`) | 42 | `nodes/text.ts`, `textOps.ts`, `hashOps.ts` | `wiredNull.test.ts:34`, `:70`; `caseContract.test.ts`; same AUTHOR CALL as Date |
| [ ] | Tables ▸ Matrix math / Shape / Select (`:912-940`) | 24 | `nodes/matrix.ts`, `matrixOps.ts` | — |
| [ ] | Tables ▸ Lambda + Frames (`:947`, `:957`) | 12 | `nodes/tableLambda.ts`, `nodes/frame.ts`, `lambda.ts` | `wiredNull.test.ts:238` (column ref) |
| [ ] | Tables ▸ Table verbs, all subs (`:969-1016`) | 35 | `nodes/frame.ts`, `frameVerbs.ts` (+ Rust mirror `src-tauri/src/engine.rs` for fused verbs — a semantics fix must land on both; say so if cargo can't run here) | `wiredNull.test.ts:238`, `finePrintContract.test.ts:125-133` |
| [ ] | Tables ▸ Cubes (`:1031`) | 4 | `nodes/cube.ts` | `wiredNull.test.ts:502`; skip Unnest if B8.1 is in flight |
| [ ] | Packs (10 packs, `packs.ts:21`) | ~30 classes + presets | `nodes/electrical.ts`, `astro.ts`, `chemistry.ts`, `thermo.ts`, `fluids.ts`, `health.ts`, `triangle.ts`, `emSpectrum.ts`, `physicsConstants.ts`, `packs/*.ts` | — |
| [ ] | Other (`:1051`) + Group/Conduit/Equation/FC/Convert/Cast/Placeholder | ~9 | `composite.ts`, `equation.ts`, `formatController.ts`, `convert.ts`, `cast.ts`, `placeholder.ts` | `activeGraph.test.ts`, `unitFlow` tests — read-heavy, small fixes only |

## Done when

- Every row ticked with a digest line; `wiredNull.test.ts` / `finePrintContract.test.ts`
  grown per family; full suite + `tsc` green at every commit.
- Backlog: delete "A5" (Execution queue) AND "Node-by-node sweep" (Polish sweeps) — they
  are the same item. Delete this file.
- Each family's final message: the collapsed-card eyeball list for the author at
  http://localhost:1420 (open the family from the Add menu, collapse each card).
