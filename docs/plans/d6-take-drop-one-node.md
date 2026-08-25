# D6 — TAKE / DROP: one rank-preserving node (list + table)

Author 2026-08-25: "list take drop" and "table take drop" are one node. Lead agrees; this is
the maximal merge (oneRunningNode pattern): ONE card, op TAKE|DROP, one data input that is a
list OR a matrix, the result at the SAME rank as the input. Head (frame row slices, `frame.ts:277`)
stays separate — frames are the verb engine's, not the list/matrix world's.

Pointers verified 2026-08-25 on develop 1e5b6002; grep the symbol if a line drifted.

## Read first
`CLAUDE.md` (Node combining; Socket lattice), `docs/socket-reference.md` (`anydata`),
`docs/value-semantics.md` "Reading an input", `docs/rules.md` selectorNamedOp + opRowDerivesFromHost
+ uniqueNameMap, `docs/code-comments.md`.

## What stands today
- `ListTakeDropNode` `nodes/list.ts:1346` — `op` take|drop + `dir` first|last, `count` literal 1,
  `adoptiveListIn`/`adoptiveListOut`, passthrough single. Component `components/ListTakeDropNode.tsx`.
- `TableTakeDropNode` `nodes/matrix.ts:594` — `op` take|drop, signed `rows`/`cols` literals 0
  (0 = Excel's omitted arg: take all / drop none), `adoptiveTableIn`/`adoptiveTableOut`,
  `carryMatrixUnit`. Component `TableTakeDropComponent` `components/MatrixNodes.tsx:177`.
- Formula `TAKE`/`DROP` `excelFunctions.ts:1990-2008` are ALREADY rank-aware through the same
  `takeSlice`/`dropSlice` kernel; a list with a `cols` arg → `#SHAPE!`. This is the oracle.
- `anyDataIn` (`nodes/shared.ts:45`, `AdoptiveSocket("anydata")`) coerces with NO rank widening
  and no element coercion (`coerceInputs.ts:165`): scalar stays scalar, list stays list, matrix
  stays matrix. There is no `adoptiveDataOut` yet — add one beside `adoptiveTableOut`
  (`shared.ts:32`): `new ClassicPreset.Output(new AdoptiveSocket("anydata"), label)`.

## The merged node — `TakeDropNode`, in `nodes/matrix.ts` replacing `TableTakeDropNode`
- `op: "take" | "drop"` (selectorNamedOp). NO `dir` field: direction is the SIGN of the count
  (Excel's convention, already the table node's and the formula's). Card label follows the op:
  `TAKE` / `DROP` (`kind: "operation"`; fx names TAKE / DROP unchanged).
- Inputs: `data` = `anyDataIn("List or table")`; `rows` = `numIn("Count (± from end)")` literal 0;
  `cols` = `numIn("Cols (± from end)")` literal 0. Output `result` = `adoptiveDataOut("Result")`,
  `passthrough` single over `["data"]` so the output adopts the wired concrete type (a date list
  stays a date list, a matrix stays a matrix).
- `data()`: wired blank on any input → `null` (value-semantics). Then by rank of `data`:
  - matrix (`toAnyMatrix` succeeds, rows of arrays): today's `TableTakeDropNode.data` verbatim,
    incl. `carryMatrixUnit`.
  - list: `takeSlice`/`dropSlice` on the elements with `rows` as the signed count; `cols ≠ 0` →
    `#SHAPE!` "TAKE of a list has no columns" (mirror the formula's text). Take 0 → `[]`;
    drop 0 → copy; drop ≥ length → `[]` (today's list semantics, `list.ts:1372-1380`).
  - scalar: treat as a 1-element list and return what the formula returns for the same call —
    `TAKE(5, 1)` in Excel is 5; pin whatever `ev("TAKE(x, 1)", {x: 5})` yields today and match it.
- Cache: one `cachedResult: unknown` field; the component picks the display by rank (below).
- Delete `ListTakeDropNode`, `LIST_TAKEDROP_OP_META`, `TakeDir`, `ListTakeDropOp` from `list.ts`
  and the whole `components/ListTakeDropNode.tsx`. Rename `TABLE_TAKEDROP_OP_META` →
  `TAKEDROP_OP_META` with labels `TAKE` / `DROP` and ONE description each, e.g.
  TAKE: "Keeps elements, rows or columns from the edges of a list or table: positive counts from
  the start, negative from the end, 0 keeps all. Excel: TAKE." (§7 voice; `uiCopy.test`).

## Component — one, in `MatrixNodes.tsx` (replace `TableTakeDropComponent`)
`OpSelect` (op) + `InlineInputs` + display by rank of `cachedResult`: `TableDisplay` for a
matrix, `ValueDisplay` (as `ListTakeDropNode.tsx` does today) otherwise. No `dir` dropdown.

## Registrations (shared files — serialize with whoever holds them; commit by pathspec)
- `nodeCatalog.ts`: delete the `list-take`/`list-drop` pair (`:492-495`) and `takeDropLeaf`
  (`:153`); ONE leaf `takedrop` label `TAKE` under the Select category (`:936`), description as
  above, keywords `"take drop list table rows columns elements edge first last head tail"`,
  `parity: true`; a SECOND hand-written leaf `takedrop-drop`, label `DROP`,
  `create: () => new TakeDropNode({ op: "drop" })`, so search shows two bare rows and no
  `TAKE: Drop` colon row. `nodeOps.ts`: replace `:173` and `:327` with one decl
  `{ type: "takedrop", ctor: TakeDropNode, kind: "operation", leafOps: ["drop"] }`.
- `nodeRegistry.ts:252,400`, `components/index.ts:63,139`, `nodes/kind.ts:102,168` (one class;
  put it in the table group — a list-only wiring still reads fine under Select).
- `nodeExcel.ts`: delete `list-take`/`list-drop` (`:237,247`) and `tbltd-*` (`:519-520`); add
  `takedrop` → `TAKE`, `=TAKE(array, rows, [cols])`, `parity: true`, note "a list takes one
  count; negative counts from the end; 0 stands in for an omitted argument", and `takedrop-drop`
  → `DROP` likewise. `formulaNodeCoverage.test` must stay green (TAKE/DROP still node-backed).
- Old saves referencing `ListTakeDrop` / `TableTakeDrop` load as Placeholders — no alias.

## Tests (update in place, add the new pins)
- `formulaMatrix.test.ts:207-217` — rewrite against `TakeDropNode`: list take ±2, drop 1, matrix
  take/drop with cols; ADD scalar and the list-with-cols `#SHAPE!` case; every case asserts
  formula result === node result (the oracle).
- `nodes/matrixReshape.test.ts:85-94,286`, `nodes/matrixUnitPolicy.test.ts:34,115` (policy
  "carry" — key the map by the new class name), `finePrintContract.test.ts:32` (drop-last →
  `rows: [-N]` now).
- `nodeOps.test`, `catalogSearch.test` ("take" and "drop" each find one bare row; "list take"
  and "table take" both find TAKE via keywords), `seeds.test`, `kind.test`, `uiCopy.test`,
  `sourceInvariants.test`; then full `npx vitest run` + `npx tsc --noEmit`.

## Docs
`docs/node-coverage.md`: the Lists paragraph loses TAKE/DROP, the matrix Select paragraph
gains "TAKE / DROP (one rank-preserving card: list, matrix or scalar in, same rank out; signed
counts)". One digest line in `docs/dev-notes.md`. Delete this file and README row 20 on landing.

## Done when
One card in the Add menu (TAKE, plus a bare DROP row), wiring a list or a matrix into it gives
the same-rank result the formula gives, no `first N / last N` dropdown anywhere, tsc + full
suite green. Author eyeball at localhost:1420: wire a List Input → TAKE with −2 (last two
elements); wire a Matrix → same card with rows 1, cols −1.
