# D5 — Columns: Select Columns + Drop Columns → one card (Keep | Remove)

Work in your own git worktree (`git worktree add ../solenoid-<agent> -b <agent>/d5-columns develop`),
commit there, then rebase onto develop and merge — never push.

**Goal.** One frame node, "Columns", with a `keep | drop` op (`kind: "operation"`, Head-style
`OpSelect` bound to `op`). Same sockets for both ops (`frame`, `columns` strlist, `frame` out) —
only the column-row label flips (Keep / Drop) and the verb dispatched changes. JS-side only: the
lazy verbs `select` and `drop` already exist (`frameVerbs.ts:56-57`, dispatch `:1434-1435`) with
their Polars mirrors — the Rust side does NOT change. Old "SelectColumns"/"DropColumns" saves load
as Placeholders.

**Precedent.** `git show a9199ac8` (Sort absorbs SortBy) for the shape; `HeadNode`
(`src/graph/nodes/frame.ts:268-312`) + `HeadComponent` (`components/FrameNodes.tsx:175-189`) for
a frame node with an `op` selector.

**Read first.** CLAUDE.md (node-combining + no-duplicate-nodes), `docs/value-semantics.md` "Reading an
input" (the wired-blank rule `readColumnList` implements), `docs/code-comments.md`.

## Pointers (verified 2026-08-25)

| What | Where |
|---|---|
| Both classes | `src/graph/nodes/frame.ts:528-587` (`readColumnList` `:532`, `SelectColumnsNode` `:538`, `DropColumnsNode` `:564`) |
| Components | `components/FrameNodes.tsx:405-423` (two identical shells), type imports `:16-17` |
| Component index | `components/index.ts:149` |
| Registry | `nodeRegistry.ts:55`, `:134`, `:431-432` |
| Catalog | `nodeCatalog.ts:50` import; leaves `:989-990` (`select-cols`, `drop-cols`) |
| nodeOps | `nodeOps.ts:181-182` (Head row — the model with op rows via `fromMeta`) |
| kind.ts | `:39` import, `:186-187` (frame kind) |
| Formula-name map | `excelFunctions.ts:260` `SELECTCOLUMNS: "Select Columns", DROPCOLUMNS: "Drop Columns"` (`FRAME_SURFACE_NAMES` — verb names REFUSED on the formula surface with a `#TYPE!` naming the node) |
| Shape resolver | `frameShapeResolver.ts:104-114` (per-class branches) |
| coerceInputs class list | `coerceInputs.ts:19` |
| Seeds | `seedGraphs/table-verbs.json:140,152` (both, with `stringLiterals.columns`), `decision-matrix.json:105` (Select) |
| Tests | `nodes/wiredNull.test.ts:538-541`, `trueAnyAdopt.test.ts:220-227`, `decisionSeed.test.ts:102` (label text only) |
| Docs | `docs/node-coverage.md:39` (Frames / Table verbs inventory line) |

## Steps

1. **Node.** In `frame.ts` replace both classes with `ColumnsNode` (`super("Columns")`, label "Columns"):
   `export type ColumnsOp = "keep" | "drop"`, `COLUMNS_OP_META` (Head pattern —
   keep: "Keep only the named columns, in the order given.", drop: "Remove the named columns; the rest pass through."),
   `op: ColumnsOp` from `init.op ?? "keep"`, sockets `frame` / `columns` (`strListIn("Columns")`) / `frame` out.
   `data()`: `cols === null` (wired blank) → null for BOTH ops (today's rule); keep with an empty list → pass-through
   (`readFrame(f)`), keep otherwise → `{ kind: "select" }`; drop → `{ kind: "drop", columns: cols }` (an empty drop
   list is a no-op verb already). Merge the two `socketDocs` into one `columns` doc that states the keep-empty
   pass-through and the `#REF!` on an unknown name under Keep (drop ignores unknowns — say so).
2. **Component.** One `ColumnsComponent` (Head pattern: `useNodeField(data, "op")`, `OpSelect` with
   `COLUMNS_OP_OPTIONS`, `InlineInputs` with `labelFor` flipping the columns row to "Keep"/"Drop", `FrameDisplay`).
   Delete the two old components.
3. **Registration.** `index.ts`, `nodeRegistry.ts`, `kind.ts`, `coerceInputs.ts:19` (one class name),
   `nodeCatalog.ts` ONE leaf `type: "columns"`, label "Columns", description in §7 voice covering both ops
   ("Excel: CHOOSECOLS" stays in the description — it's the nearest formula), `keywords: "columns select keep drop remove choosecols"`.
   `nodeOps.ts`: `{ type: "columns", ctor: ColumnsNode, kind: "operation", ops: fromMeta(COLUMNS_OP_META), create: (op) => new ColumnsNode({ op }) }`
   so both ops stay findable as Add-menu leaves. `op` persists via `INIT_FIELD_ORDER` (`copyPaste.ts:73`).
4. **Formula surface.** `excelFunctions.ts:260`: both names point at the ONE node — `SELECTCOLUMNS: "Columns (Keep)"`,
   `DROPCOLUMNS: "Columns (Drop)"` (the `#TYPE!` message names where to go). If `formulaNodeCoverage.test.ts`
   then fails on either name, add the alias to its `FORMULA_NODE_ALIAS` (`:20`) rather than inventing a leaf.
5. **Shape resolver.** `frameShapeResolver.ts:104-114` → one `ColumnsNode` branch switching on `n.op`
   (keep + empty list = input shape; else `shapeOf({ kind: n.op === "keep" ? "select" : "drop", … })`).
6. **Seeds + tests.** `table-verbs.json:140` → `"type": "ColumnsNode"` (init.op omitted = keep), `:152` →
   `"type": "ColumnsNode"` with `"init": { "label": …, "op": "drop" }`; `decision-matrix.json:105` → ColumnsNode.
   Retarget `wiredNull.test.ts:538`, `trueAnyAdopt.test.ts:220`; add in `frame.test.ts` (or wiredNull): drop op
   removes the named column and ignores an unknown name; keep with an unknown name is `#REF!`; `op` round-trips
   through `extractInit`. Run `seeds.test.ts` (a stale class name = dangling node).
7. **Docs.** `docs/node-coverage.md:39` inventory: "Select Columns, Drop Columns" → "Columns (Keep / Drop)".
8. `npx tsc --noEmit`; `npx vitest run src/graph/nodes/wiredNull.test.ts src/graph/trueAnyAdopt.test.ts src/graph/decisionSeed.test.ts src/graph/seeds.test.ts src/graph/nodeOps.test.ts src/graph/formulaNodeCoverage.test.ts src/graph/catalogSearch.test.ts src/graph/frameShapeResolver.test.ts`
   (skip any file that doesn't exist); then the full suite. One commit (paths only).

## Done when

- `SelectColumnsNode` / `DropColumnsNode` gone from every file in the pointer table; `grep -rn "SelectColumns\|DropColumns" src` is empty.
- Both ops reachable from the Add menu by name ("keep"/"drop"/"select" search hits — `catalogSearch.test.ts:127` pin).
- `=SELECTCOLUMNS(...)` / `=DROPCOLUMNS(...)` still refuse with a `#TYPE!` that names the Columns node.
- Full suite green; digest line in `docs/dev-notes.md`; delete "Select+Drop Columns" from the backlog's
  "Smaller pairs" line; delete this plan; README row struck.
- Author eyeball at localhost:1420: `table-verbs` seed — the two cards are both "Columns", one Keep, one Drop, same
  results as before; flip an op and the row label follows.
