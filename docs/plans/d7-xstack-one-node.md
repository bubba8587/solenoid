# D7 — XSTACK: one matrix stacking node (VSTACK | HSTACK)

Author 2026-08-25: "give me XSTACK … XSTACK can just be v and h". `VStackNode` and
`HStackTableNode` are one card with an axis op. The frame verbs Append / Bind Columns stay
separate (Lead call, author-approved): they match columns by NAME and fill blanks, a stack pads
by POSITION with #N/A, and frames are the verb engine's (the D6 Head precedent).

Pointers verified 2026-08-25 on develop 2acf45d4; grep the symbol if a line drifted.

## Read first
`CLAUDE.md` (Node combining), `docs/rules.md` NAME-3 / NAME-4 / selectorNamedOp,
`docs/code-comments.md`. `TakeDropNode` (`nodes/matrix.ts:597`, D6) is the shape to copy.

## What stands today
- `StackNodeBase` `nodes/matrix.ts:366` — extensible `t<n>` rows of `anyTableIn`, `unitAware`,
  `passthrough` agree over the rows, `matsOf` (drops empties, `demoteUnitCells`), output
  `adoptiveTableOut("Stacked")`. `HStackTableNode` `:419` → `stackH` + `sharedMatrixUnit`;
  `VStackNode` `:436` → `stackV`. Components `components/VStackNode.tsx` and
  `HStackTableComponent` (`components/MatrixNodes.tsx`): `ExtensibleInputs` + `TableDisplay`.
- Formulas `HSTACK` / `VSTACK` `excelFunctions.ts:1856` share `stackH` / `stackV`.
- Catalog leaves `hstack-table` / `vstack-table` (`nodeCatalog.ts:924-925`, Tables & Frames ›
  Shape); `nodeExcel.ts:199,245`; registry `nodeRegistry.ts:252,395`; components index
  `components/index.ts:57`. Seeds with the old types: `table-verbs.json` (1),
  `zz-scratch-new-nodes.json` (1). No `nodeOps` declaration (no `op` today).

## The merged node — `StackNode`, in `nodes/matrix.ts`, replacing both classes
- Fold `StackNodeBase` into `StackNode`: `op: "vstack" | "hstack"` (selectorNamedOp),
  `STACK_OP_META = { vstack: { label: "VSTACK", description }, hstack: { label: "HSTACK", … } }`
  (real Excel names, NAME-4). `this.label = init?.label ?? ""` (NAME-3). Rows, passthrough,
  output and unit handling unchanged; `data()` picks `stackV` / `stackH` by `op`.
- The card is **XSTACK**: one collapsed leaf `xstack` labelled "XSTACK" in Tables & Frames › Shape
  (op dropdown; ops hidden, so search generates "XSTACK: VSTACK" / "XSTACK: HSTACK" and the host
  name titles the card). `nodeOps.ts`: `{ type: "xstack", ctor: StackNode, kind: "operation",
  ops: fromMeta(STACK_OP_META), create: (op) => new StackNode({ op }) }`, no `leafOps`.
- Register `XSTACK(axis, a, b, …)` (`axis` = "v" | "h", case-insensitive; else `#VALUE!`) sharing
  `stackV` / `stackH`, so the all-caps card name is a callable claim: `registerInternal` +
  `EXCEL_IMPL_META` (`returns: "any", rank: "matrix", matrixArgs: true, listArgs: true, arity:
  [2, 256], native: true`) + `formulaSignatures.ts` + `nodeExcel.ts` `"xstack"` carrying VSTACK and
  HSTACK (parity true, keep the notes) and XSTACK (parity false, "Solenoid: one function, axis
  first"). `nameCase.test` and `formulaNodeParity` gap C then pass.
- Component: one `StackComponent` in `components/MatrixNodes.tsx` (`ExtensibleInputs` +
  `OpSelect` on `op` + `TableDisplay`); delete `components/VStackNode.tsx` and
  `HStackTableComponent`. The op swaps no sockets — no `dropInputCables` needed.
- Catalog: delete the two leaves, add `xstack` (description in §7 voice, "Excel: VSTACK /
  HSTACK."; keywords "stack vertical horizontal rows side by side rbind cbind"). Registry,
  components index, `nodeExcel` keys, `node-coverage.md` updated; `catalogRegistry.test` lists
  anything missed.
- Seeds: rewrite the two nodes to `"type": "StackNode"` + `"op"` (keys stay `t<n>`, cables
  survive); `seeds.test.ts` confirms. Old saves load as Placeholder — no alias.

## Tests
- Move the VStack/HStack node tests (grep both class names under `src/graph/**/*.test.ts`) onto
  `StackNode` with the op set; keep every assertion (ragged padding, unit carry, empties dropped,
  a bare list is one row).
- Add: `XSTACK("h", a, b)` ≡ `HSTACK(a, b)` and `XSTACK("v", …)` ≡ `VSTACK(…)` in
  `formulaMatrix.test.ts` (node === formula); a bad axis → `#VALUE!`.
- Run after every step: `nodeOps.test.ts`, `cardTitle.test.ts`, `nameCase.test.ts`,
  `catalogRegistry.test.ts`, `formulaNodeCoverage.test.ts`, `formulaNodeParity.test.ts`,
  `seeds.test.ts`, `uiCopy.test.ts`; full suite before the commit.

## Done when
One commit, tsc + full suite green, rebased onto develop: two classes gone, one `StackNode`, one
XSTACK card, XSTACK callable, `docs/node-coverage.md` reconciled, one line under the 2026-08-25b
digest, this file deleted and README row 21 struck.
