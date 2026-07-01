---
name: add-node
description: Add a new computation node to Solenoid (the node-graph app). Use when the user asks to add a node, op, or Excel function to the graph editor — covers the class, the React component, registration, and the Add menu.
---

# Add a Solenoid node

A node is four things in four places. The component is now boilerplate
(the `nodeKit` carries it), so the only real work is the `data()` method
and the catalog copy.

## First decide: standalone node, or a new op on an existing node?

Solenoid bundles multi-op families behind one node with a dropdown
(`OpSelect`). **Do not add a standalone node for something that's an op
of an existing family** — add it to that family's op union instead:

- unary math (abs/sqrt/sin/round…) → add a `MathFnOp` + a `case` in `MathFnNode.data` + a row in the Math catalog. No new files.
- two-input arithmetic (+−×÷ % ^) → `ArithmeticOp`.
- comparisons → `ComparisonOp` (and it flows to Filter via `compareOp`).
- list aggregates (sum/avg/min/median…) → `ReduceOp`.
- boolean logic → `LogicalOp`.

Only make a **standalone** node when its shape is genuinely its own
(distinct inputs/outputs or UI): e.g. Convert, IFERROR, RANDBETWEEN,
GCD, QUOTIENT, a lookup.

## Scaffold a standalone node

```
node scripts/new-node.mjs <PascalName> [--template element|list|reduce] [--kind math|list|logic|convert|input|util|display]
```

- `element` — flexible `numlist` in/out, `broadcast()` element-wise (list-aware). Default. Use for anything element-wise.
- `list` — `list` → `list` (Sort/Reverse/Slice shape).
- `reduce` — `list` → `number` (Length/aggregate shape).

It writes `src/graph/components/<Name>Node.tsx` and prints the three
snippets to paste. The generated component renders *all* of the class's
inputs through `InlineInputs`, so adding more inputs only means editing
the class — the component needs no change.

## The six places (what the script's snippets cover)

1. **Class** → the appropriate domain file in `src/graph/nodes/`:
   - `scalar.ts` — arithmetic, math functions, rounding, combinatorics
   - `list.ts` — list construction, shaping, lookup
   - `stats.ts` — statistics, distributions, regression
   - `finance.ts` — bitwise, interest rate, depreciation, TVM, cashflow
   - `logic.ts` — comparisons, boolean logic, IF/IFERROR/IS-checks
   - `input.ts` — source nodes (no inputs, just output)
   - `display.ts` — sink/output nodes, RAND variants
   - `lookup.ts` — MATCH, XLOOKUP
   - `convert.ts` — unit conversion
   Use the port factories (`numIn/listIn/numListIn/numOut/listOut/numListOut`).
   The `data()` method is the only non-boilerplate. Element-wise ops should
   go through `broadcast(fn, ...args)`. Cache result on `this.cachedResult`
   (`number | number[] | null`) or `this.cachedList`.
   Re-export the new class from `src/graph/rete-nodes.ts` (the barrel file —
   each domain file is already re-exported there via `export * from "./nodes/…"`
   so if you add to an existing domain file you don't need to touch rete-nodes.ts).
2. **Kind** → `src/graph/nodes/kind.ts`. Add an `instanceof` branch in
   `nodeKindOf()` so the node is assigned the right color/category. The
   fallback at the bottom of the function is `"math"`, so math nodes can
   skip this step; all others must add a branch.
3. **Component** → `src/graph/components/<Name>Node.tsx`. A standard
   "inputs + one value box" node is a one-line factory call:
   `export const FooComponent = makeNodeComponent<FooNode>((n) => n.cachedResult);`
   (use `makeExtensibleNodeComponent` for add/remove input rows; `cachedList`
   for list outputs). Nodes that need an `OpSelect`, a custom value `render`,
   or local state hand-write the component against `NodeShell` instead — see
   `ArithmeticNode.tsx` / `ContainsNode.tsx`.
4. **Barrel** → one line in `src/graph/components/index.ts`:
   `export { FooComponent } from "./FooNode";`
   (`nodeRegistry.ts` imports everything from this barrel.)
5. **Registry** → one row in `NODE_COMPONENTS` in `src/graph/nodeRegistry.ts`
   (two import lines in that file + the row):
   `import { FooNode } from "./rete-nodes";`
   `import { FooComponent } from "./components";`
   `[FooNode, comp(FooComponent)],`
6. **Catalog** → one entry in `src/graph/nodeCatalog.ts`, in the right
   category. Description should carry the Excel equivalent
   (`(Excel: =FOO(…))`) — the zero-learning-curve goal in CLAUDE.md.
7. **Excel metadata** (only if the node maps to an Excel function) →
   `src/graph/nodeExcel.ts`, the single source of truth for Excel
   equivalence:
   `"foo": [{ excel: "FOO", syntax: "=FOO(x)" }],`  (add `parity: false` +
   `note` if it differs). `EXCEL_TO_CATALOG` / `CATALOG_TO_EXCEL` and the
   **Function Reference** all derive from this — do not hand-edit a separate
   list. Omit entirely for a Solenoid-native node. A *pack* node declares this
   inline as `excel: [...]` on its catalog entry instead.

The Function Reference is generated from the catalog (`functionReference.ts`):
Add-menu location, pack membership, dependency, parity, and the Excel metadata
above. There is no parallel reference file to maintain. The dev catalog
validator (`catalogValidator.ts`) warns if Excel metadata points at a node that
doesn't exist — so a node can't silently fall off the reference.

## Verify

`npm run build` (runs `tsc` then `vite build`). A clean build means the
node is registered and type-correct. Then it appears in the Add menu. In dev,
the console catalog validator confirms the Excel metadata resolves.

## nodeKit reference (`src/graph/components/nodeKit.tsx`)

- `NodeShell` — output sockets + editable label header + body wrapper. `leading` slot for bare input sockets (Display/Convert); `labelPlaceholder` for sources (ScalarInput).
- `useNodeField(node, key)` — controlled local state mirrored to `node[key]`, recomputes the graph on change. Use for op selects and any node field.
- `OpSelect` — drag-safe `<select>`; `options={[{value,label}]}`. Bake any symbol into the label string.
- `ValueDisplay` — renders `number | number[] | null`: `empty` overrides the "—" placeholder; `render` overrides scalar formatting.
- `PortSockets` — map a node's inputs or outputs to socket dots.
