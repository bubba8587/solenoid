# C3 — Set Cell (matrix) with (Value, Row, Column) triplets · Replace Values typed sockets

Two independent items (author ask, 2026-08-24). Commit separately.

**Read first.** `.claude/skills/add-node/SKILL.md` in full; `docs/value-semantics.md:154-173`
(role table: operand / shape rows); `docs/socket-reference.md` (adoptive table rungs);
`docs/code-comments.md`.

**Backlog:** nothing to delete; digest line + delete this file when done.

---

## C3.1 — Set Cell

**Goal.** A node that overwrites cells of a 2-D table by address: input Table, then an
extensible list of (Value, Row, Column) rows, each socket individually wireable, output the
same table with those cells written. Matrix only; a Frame arm is out of scope (below).

**Where it is.**
- Variadic rows: `src/graph/components/PairedExtensibleInputs.tsx` is hardcoded to TWO in
  three places — the types `:31` `valuePairKeys: () => Array<[string, string]>` and `:36`
  `pairLabels: [string, string]`, the render body `:153-159` (two `field()` calls), and
  `removePair(aKey, bKey)` `:94-95`. `addPair()` `:83-92` already diffs the key set, and
  `pushRowAddUndo` / `pushRowRemovalUndo` (`ExtensibleInputs.tsx:36-91`) already take
  `keys: string[]`. Nothing else in the file assumes two.
- Node contract precedent: SUMIFS `nodes/list.ts:996-1022` (`column${id}` / `value${id}`,
  shared `nextPairId`), `pairIdsFromKeys` `nodes/logic.ts:70-80` (rebuilds ids on load — the
  reason at `:68-69`), persistence `copyPaste.ts:194-197` (`valueKeys`), `graphValidate.ts:150`.
- Sockets: `adoptiveTableIn` / `adoptiveTableOut` `nodes/shared.ts:28-32` (element-preserving
  table), `anyIn` `:20` (scalar, element-agnostic — the Value socket), `numIn` `:9`.
  Passthrough one-liner `passthrough = () => [{ output: "result", inputs: ["matrix"],
  combine: "single" }]` (`matrix.ts:319`); no `project` (rank preserved).
- The node to copy: `ExpandNode` `nodes/matrix.ts:634-664` (adoptive table + numIn + anyIn →
  adoptive table), kernel `expandMat` `nodes/matrixOps.ts:179-193`; `carryMatrixUnit` at
  every structural rewrite (`matrix.ts:339`, `:661`). Value normalizer `toAnyMatrix`
  `nodes/coerce.ts:62-69` (scalar → `[[v]]`, list → one row).
- Address conventions: 1-based (`tableLambda.ts:11-19`, MAP/MAKEARRAY catalog copy);
  `resolveAxes` `nodes/indexAccess.ts:30-39`; out-of-range → `indexRefError(n, max, "Row")`
  `indexAccess.ts:41-44` (`#REF!`, shared wording). `#VALUE!` is for a malformed argument.
- Catalog home: Tables & Frames ▸ Shape, next to EXPAND (`nodeCatalog.ts:938`).
- Per-row literals: `anyIn` rows need `autoLiterals = true` + both `literals` and
  `stringLiterals` (see `inlineInput.takesAutoLiteral`, and IFS/SWITCH `logic.ts:666-698`).

**Design (decided).**
- Generalize `PairedExtensibleInputs` to N-tuples in place (no new component, no rename):
  `valuePairKeys: () => string[][]`, `pairLabels: string[]`, render maps over the tuple
  (first field carries the remove button), `removePair(keys: string[])` →
  `dropInputCables(node.id, keys)`. Existing pair nodes (Filter, SUMIFS, Frame from Lists,
  IFS, SWITCH) change only their type annotations (`[a, b]` tuples still satisfy
  `string[][]`); `extensibleRowUndo.test.ts` stays green; add one triplet case there.
- `SetCellNode` (`nodes/matrix.ts`): `adoptiveTableIn("Table")` key `matrix`; rows
  `value${id}` (`anyIn`), `row${id}` (`numIn`), `col${id}` (`numIn`), `pairLabels =
  ["Value", "Row", "Column"]`, one row on construction, `pairIdsFromKeys(init?.valueKeys,
  "value")`; output `adoptiveTableOut("Result")` key `result`, passthrough single.
- Kernel `setCells(m: CellMat, writes: { r: number; c: number; v: Cell }[]): CellMat |
  SolError` in `matrixOps.ts`: copies the grid, applies writes in row order (a later row
  wins on the same address), 1-based, `indexRefError` on any out-of-range address (whole
  result errors, matching Table Select's rule). A ragged input is normalized first the way
  `expandMat` does.
- Semantics per the role table: a wired-blank Row or Column (a shape/address) → the whole
  result is null; a wired-blank Value (an operand) → that cell is written null. Unwired
  fields use the card literals. An error on any input propagates (the guards do this).
  Unit: `carryMatrixUnit(result, m)`.
- Component: `makeExtensibleNodeComponent`-style shell with `PairedExtensibleInputs`
  and `leadingKeys={["matrix"]}`; result via the table display. Collapsed: ≥2 inputs → pill.
- Copy: label "Set Cell"; description "Writes values into a table by address. Each row
  names a value and its 1-based row and column; later rows win on the same cell. An address
  outside the table errors the result. Excel has no equivalent." `socketDocs.row`/`col`:
  "1-based." Run `uiCopy.test.ts`.
- No formula registration (a variadic matrix writer has no clean formula signature; one
  Finding line). No Rust mirror (matrix ops are JS).
- Out of scope, one Finding line: a Frame arm (column by name via `getColumn`
  `frame.ts:189-201`, cell coercion via `coerceFrameCell` `:246-255`, rebuild the one
  column — the frame socket carries no element family so it would be an op-switched
  socket set like `TableReshapeNode` `matrix.ts:485-499`).

**Steps.**
1. Generalize `PairedExtensibleInputs` + type-only touches on the five pair nodes; `tsc`;
   `extensibleRowUndo.test.ts` + a triplet undo case.
2. Kernel + tests in the matrix test file (grep `expandMat` in `src/graph/**/*.test.ts`):
   single write, two writes same cell (later wins), out-of-range row/col → `#REF!` with the
   shared wording, ragged input, unit carry.
3. Node + component + kind + barrel + registry + catalog (`SKILL.md` touchpoints 1-6, 8);
   `wiredNull.test.ts` "Set Cell — wired blank by role" (row blank → null result; value
   blank → null cell; unwired → literals); `extractInit` round-trip with two rows
   (`persistenceSweep`), `catalogRegistry`, `socketReference`, `coerceInputs` sweeps.
4. Scratch seed entry (`seedGraphs/zz-scratch-new-nodes.json`) wiring a Table Input →
   Set Cell with two rows → Display. Full suite. Commit.

---

## C3.2 — Replace Values: Find / Replace stop being text-only

**Where it is.** `nodes/frame.ts:1088-1116` `ReplaceValuesNode`: `column`, `find`, `replace`
are all `strIn` (`:1099-1103`); `data()` `:1106-1115` reads via `readInput` and hands
STRINGS to `runFrameUnary({ kind: "replaceValues", … })`. Kernel `replaceValues`
`frameVerbs.ts:1680-1710` parses the string side (`Number(find.trim())` etc.); Rust twin
`src-tauri/src/engine.rs:522-529` (`WireOp::ReplaceValues`), `:1151-1178`. Tests
`frameVerbs.test.ts:469-490`, `caseContract.test.ts:85-110` (pins the description).

**Design (decided — the lowest-friction path).** Sockets `find` and `replace` become
`anyIn`; `data()` funnels each through `readFilterValue(wired, literal)` (`nodes/list.ts:814-819`
— the exact precedent Frame Filter and SUMIFS use for a typed scalar on a text criterion:
null stays null, a SolError becomes its code, else `String(raw)`). The kernel, the Polars
plan, and both test files stay byte-identical; a wired Number / Boolean / Date / Slider is
now connectable. `autoLiterals` per the IFS pattern so the card literal still types.
Known edge to state in the digest: a wired DATE stringifies to its serial (the kernel's
date arm is serial-only, `coerceReplacement` `:1666`), same as `lookupNeedle`'s behaviour.
`column` stays `strIn`.

**Steps.** Socket change + `readFilterValue`; a pin in `frameVerbs.test.ts` or the node's
test driving `data()` with a wired number `5` against a number column and a wired boolean
against a logical column; `socketConnect.test.ts` + `coerceInputs.test.ts` + `caseContract`
+ full suite. Catalog description: drop nothing, add "Find and Replace take a wired value of
any type." only if it reads naturally; otherwise leave it.

**Finding to record:** the JS oracle accepts `String(v) === find` for numbers and a
lowercased boolean match where Rust takes exact text only (`engine.rs:1168`) — a real
parity gap, not this item's scope; one backlog line under Bugs.

---

## Done when

- Both items committed separately, full suite + `tsc` green; digest lines; this file deleted.
- Author eyeball at http://localhost:1420: Set Cell card with three-socket rows, + Add adds
  a row, − removes with cables dropped, undo restores the row with its cables; a Slider wired
  into Replace Values' Find on a number column swaps the matching cells.
