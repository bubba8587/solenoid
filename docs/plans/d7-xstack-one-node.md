# D7 — XSTACK: one stacking node (matrix VSTACK/HSTACK + frame Append/Bind Columns)

Author 2026-08-25: "give me XSTACK (did you combine VSTACK and HSTACK nodes? good candidate)".
Four cards do one thing today — stack inputs along an axis: `VStackNode` + `HStackTableNode`
(matrices) and `AppendNode` + `BindColumnsNode` (frames). This is the maximal merge
(oneRunningNode pattern, D6 precedent): ONE card, `op` = VSTACK | HSTACK, extensible rows that
take a matrix/list OR a frame, the result at the SAME kind as the inputs.

Pointers verified 2026-08-25 on develop f6533e62; grep the symbol if a line drifted.

## Read first
`CLAUDE.md` (Node combining; Socket lattice), `docs/rules.md` NAME-3 / NAME-4 / selectorNamedOp /
onePrunePath, `docs/socket-reference.md` (`trueany`, adoption), `docs/value-semantics.md`
"Reading an input", `docs/code-comments.md`. The D6 landing (commit 597e961d, `TakeDropNode`
in `nodes/matrix.ts:597`) is the shape to copy for "one op, rank/kind-preserving".

## What stands today
- `StackNodeBase` `nodes/matrix.ts:366` — extensible `t<n>` rows of `anyTableIn`, `unitAware`,
  `passthrough` agree over the rows, `matsOf` (drops empties, `demoteUnitCells`), output
  `adoptiveTableOut("Stacked")`. `HStackTableNode` `:419` → `stackH` + `sharedMatrixUnit`;
  `VStackNode` `:436` → `stackV`. Components `components/VStackNode.tsx` and
  `HStackTableComponent` (`components/MatrixNodes.tsx`), both `ExtensibleInputs` + `TableDisplay`.
- `AppendNode` `nodes/frame.ts:863` / `BindColumnsNode` `:912` — extensible `f<n>` rows of
  `frameIn`, `runFrameAppend` / `runFrameBindColumns` (`frameBackend.ts:538` / `:524`), one frame
  → `readFrame` pass-through, `emitFrame`. Components `AppendComponent` / `BindColumnsComponent`
  `components/FrameNodes.tsx:530` / `:539`.
- Formulas `HSTACK` / `VSTACK` `excelFunctions.ts:1856` share `stackH` / `stackV` (matrix world;
  frames never enter formulas). `APPEND` / `BINDCOLUMNS` are refused frame verbs
  (`FRAME_SURFACE_NAMES` `excelFunctions.ts:258`, values "Append" / "Bind Columns").
- Catalog: `hstack-table` / `vstack-table` leaves (`nodeCatalog.ts:924-925`, Tables & Frames ›
  Shape); `append` / `bind-columns` (`:979-980`, Frames › table verbs). `nodeExcel.ts:199,245`.
  Registry `nodeRegistry.ts:252,395,433,434`; components index `components/index.ts:57,149`.
- Seeds referencing the old types: `table-verbs.json` (1 node), `zz-scratch-new-nodes.json` (1).
- No `nodeOps` declaration for any of the four (no `op` today).

## The merged node — `StackNode`, in `nodes/matrix.ts`, replacing all four classes
- `op: "vstack" | "hstack"` (selectorNamedOp). `STACK_OP_META = { vstack: { label: "VSTACK", … },
  hstack: { label: "HSTACK", … } }` — the labels are the real Excel names (NAME-4 satisfied).
- The card is **XSTACK**: one collapsed catalog leaf `xstack` labelled "XSTACK" in Tables & Frames ›
  Shape (the op is a dropdown, ops hidden — search rows "XSTACK: VSTACK" / "XSTACK: HSTACK" are
  generated). `nodeOps.ts`: `{ type: "xstack", ctor: StackNode, kind: "operation", ops:
  fromMeta(STACK_OP_META), create: (op) => new StackNode({ op }) }` — no `leafOps`, so the host
  name titles the card (NAME-3). Register the formula `XSTACK(axis, a, b, …)` (`axis` = "v" |
  "h", case-insensitive; matrices/lists only, like HSTACK/VSTACK) so the all-caps card name is a
  callable claim: `registerInternal` + `EXCEL_IMPL_META` (`returns: "any", rank: "matrix",
  matrixArgs, listArgs, arity [2, 256]`) + `formulaSignatures.ts` + a `nodeExcel.ts` `"xstack"`
  entry carrying VSTACK, HSTACK (parity true, keep the existing notes) and XSTACK (parity false,
  "Solenoid: one function, axis first"). `nameCase.test` / `formulaNodeParity` gap C then pass.
- Inputs: extensible rows keyed `t<n>` (keep the `t` prefix so `StackNodeBase`'s key logic and
  the `valueKeys` init shape survive), each `trueAnyIn("Table")`. Output `trueAnyOut("Stacked")` +
  `passthrough` agree over the rows: a set of frames adopts `frame`, a set of number matrices
  adopts `table`, a date list row adopts its date-table, exactly as `StackNodeBase` does today.
- `data()`: classify the wired rows (blank rows drop, as `matsOf` does now):
  - every row a frame (`FrameInput`) → one row `readFrame`, else `runFrameAppend` (vstack) /
    `runFrameBindColumns` (hstack), emitted through `emitFrame` (async, as Append does);
  - every row a list/matrix (`toAnyMatrix` succeeds) → `stackV` / `stackH` with the unit handling
    of today's classes (`demoteUnitCells`, `withMatrixUnit(out, sharedMatrixUnit(mats))`);
  - a mix of frames and matrices → `solError("#TYPE!", "XSTACK: frames and tables can't stack
    together")`; anything else non-tabular (cube, lambda, chart) → `#TYPE!` naming the row.
  - no wired rows → `null` result.
- Component: ONE `StackComponent` (`components/MatrixNodes.tsx`, delete `VStackNode.tsx` and the
  two frame components): `ExtensibleInputs` + `OpSelect` bound to `op` + a display that switches
  on the cached result's kind (`FrameDisplay` for a frame, `TableDisplay` otherwise — the
  `TakeDropComponent` in the same file already does the matrix/scalar switch; `FrameDisplay`'s
  contract is in `FrameNodes.tsx`). Op switch swaps no sockets, so no `dropInputCables` needed.
- Catalog: delete `hstack-table`, `vstack-table`, `append`, `bind-columns`; add the `xstack`
  leaf (description in §7 voice: what it does, "Excel: VSTACK / HSTACK."; keywords "stack append
  bind columns rbind cbind concat rows side by side vertical horizontal"). `FRAME_SURFACE_NAMES`:
  `APPEND: "XSTACK", BINDCOLUMNS: "XSTACK"` (typed names still redirect). Registry + components
  index + `nodeExcel` keys updated; `catalogRegistry.test` will list what you missed.
- Seeds: rewrite the two old-type nodes to `"type": "StackNode"` with `"op"` and `t<n>` keys
  (re-key `f<n>` → `t<n>` in the node's `init.valueKeys` AND in the connections that target it);
  `seeds.test.ts` catches a dangling cable. Old saves load as Placeholder — no alias.

## Tests
- Move the existing VStack/HStack/Append/BindColumns node tests (grep the class names under
  `src/graph/nodes/*.test.ts` and `src/graph/*.test.ts`) onto `StackNode` with the op set; keep
  every assertion (ragged padding, unit carry, empty rows dropped, frames by name/position).
- Add: mixed frame+matrix → `#TYPE!`; one frame row passes through unchanged; output adopts
  `frame` vs `table` (a `trueAnyAdopt.test.ts`-style check); `XSTACK("h", a, b)` ≡ `HSTACK(a, b)`
  and `XSTACK("v", …)` ≡ `VSTACK(…)` in `formulaMatrix.test.ts` (node === formula).
- Run after every step: `nodeOps.test.ts`, `cardTitle.test.ts`, `nameCase.test.ts`,
  `catalogRegistry.test.ts`, `frameSurfaceNames.test.ts`, `formulaNodeCoverage.test.ts`,
  `formulaNodeParity.test.ts`, `seeds.test.ts`, `uiCopy.test.ts`; full suite before the commit.

## Done when
One commit, tsc + full suite green, rebased onto develop: four classes gone, one `StackNode`,
one XSTACK card, XSTACK callable, `docs/node-coverage.md` reconciled, one line under the
2026-08-25b digest, this file deleted and README row 21 struck.
