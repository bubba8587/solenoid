---
name: add-node
description: Add a new computation node to Solenoid (the node-graph app). Use when the user asks to add a node, op, or Excel function to the graph editor — covers the class, the React component, registration, and the Add menu.
---

# Add a Solenoid node

A node is a class + a component + three registration lines + a catalog entry.
The component is usually boilerplate (the node kit carries it), so the real
work is the `data()` method, the tests, and the catalog copy.

**Worked example:** the Color Blend node (2026-07-20, commit history) touches
every step compactly — class in `input.ts`, hand-written component, kind
branch, registry, catalog, vitest file.

## First decide: standalone node, op on an existing family, or pack content?

Solenoid bundles multi-op families behind one node with a dropdown. **Do not
add a standalone node for something that's an op of an existing family** —
add it to that family's op union + `data()` switch + `X_OP_META` table +
catalog row instead. The meta table is the ONE place the op is named: the
card's dropdown and the Add-menu search row both read it, and its
`satisfies Record<XOp, …>` is what makes tsc tell you the op is missing.
Never write a label anywhere else — a second copy is how ISBOOLEAN on the
card shipped as ISLOGICAL in search (2026-07-28). The families:

- unary math (abs/sqrt/sin/round…) → `MathFnOp` (`scalar.ts`)
- two-input arithmetic (+−×÷ % ^) → `ArithmeticOp` (`scalar.ts`)
- comparisons → `ComparisonOp` (`logic.ts`; flows to Filter via `compareOp`)
- list aggregates (sum/avg/min/median…) → `ReduceOp` (the Aggregate node, `list.ts`)
- boolean logic → `BooleanOp` (`logic.ts` — the old `LogicalNode`/`LogicalOp` is gone, split into BooleanOp/Not/If)

**Domain formulas** (physics, chemistry, finance rearrangements…) are usually
NOT node classes at all — they're formula/equation presets in a domain pack
(`src/graph/packs/*.ts` on `packShared.ts`; a rearrangeable relation ships as
ONE locked Equation preset). A pack can also ship custom-logic nodes; those
declare Excel metadata inline as `excel: [...]` on their catalog entry.

Make a **standalone** node only when its shape is genuinely its own (distinct
inputs/outputs or UI): Convert, XLOOKUP, RANDBETWEEN, Color Blend.

## Scaffold (optional)

```
node scripts/new-node.mjs <PascalName> [--template element|list|reduce] [--kind math|list|logic|...]
```

Writes `src/graph/components/<Name>Node.tsx` (a one-line `makeNodeComponent`
factory call importing from `./standardNode`) and prints paste-point snippets
for the other steps. Its printed guidance is current — trust it. Skip the
script when the component needs hand-writing anyway (op select, custom render).

## The places

1. **Class** → a domain file in `src/graph/nodes/` (~55 files — pick by
   cohesion with the family it extends, e.g. color nodes live in `input.ts`
   next to ColorPicker). Common homes: `scalar.ts` `list.ts` `stats.ts`
   `logic.ts` `text.ts` `date.ts` `finance.ts` `frame.ts` `matrix.ts`
   `cube.ts` `input.ts` (sources) `display.ts` (sinks) `control.ts` (widgets)
   `visual.ts` (chart-socket content) `connection.ts`/`dataFeed.ts` (fetchers)
   `convert.ts` `complex.ts`. `rete-nodes.ts` is the barrel — existing domain
   files are already `export *`'d, so adding to one needs no barrel edit.
   - **Ports**: use the factories in `nodes/shared.ts` — every socket family
     has typed in/out helpers (`numIn`, `strIn`, `dateIn`, `logicalIn`,
     `complexIn`, plus `list`/`combo`/`table` variants, `frameIn`, `cubeIn`,
     `lambdaIn`, `chartIn`…). **An ELEMENT-WISE OPERAND takes the family's
     COMBO, not its scalar** — `numListIn` / `strComboIn` / `dateComboIn` /
     `logicalComboIn` / `complexComboIn`, and the matching `…Out`. All five
     families were swept onto their combo rung (2026-07-25), so a new
     element-wise node on `strIn`/`dateIn` is a regression, not a style
     choice. Reserve the scalar rung for a MODE or a structural control param
     (a window size, a separator, a return-type flag) — the full test is
     node-coverage.md's input-dimensionality rule. Wildcards are a LADDER (see
     CLAUDE.md "Socket lattice"): `anyIn` (adoptive element-agnostic scalar),
     `adoptiveListIn`/`adoptiveTableIn` (1-D/2-D), `trueAnyIn/Out` (the
     hollow-ring supremum). A new socket TYPE is a bigger, derived edit —
     follow the `anylist` worked example in CLAUDE.md.
   - **`data()` is the only non-boilerplate.** Element-wise ops broadcast, and
     WHICH broadcaster depends on the element type: `broadcast(fn, …)` /
     `broadcastErr` for numbers and dates (a date serial is a number);
     `broadcastCells(fn, …)` (`shared.ts`) when operands or results are text /
     booleans / mixed families (LEN is string→number); `broadcastComplex`
     (`complex.ts`) for complex, whose values are themselves `[re, im]` arrays
     and so need an exact shape test plus per-operand tags. All three share the
     ragged-zip + per-cell error/missing contract. Cache the result on the
     instance — `cachedResult: BroadcastResult` (= `CellResult<number>`) or
     `CellResult<T>` for another element type, or `cachedList` / `cachedString`
     — whatever the component reads. `ValueDisplay` renders a scalar and a
     broadcast list from the same field, so this needs no component branch.
   - **Errors**: `installErrorGuards` wraps every `data()` at `nodecreated` —
     an incoming `SolError` short-circuits to the outputs automatically, so
     your `data()` sees clean inputs (unless the class opts into
     `SEES_ERRORS`). For the node's OWN failures return
     `solError(code, message)` from `errorValue.ts` (`#VALUE!`, `#DOMAIN!`,
     `#SHAPE!`…) — never throw strings, never emit `NaN` as an error.
     Container values can carry per-cell `null` (missing) + `SolError`s —
     see `valueKinds.ts` before hand-rolling skip/propagate logic.
   - **Units**: an algebra node (one that computes on numbers that may carry
     units) sets `unitAware = true` and funnels through `broadcastUnit`
     (`shared.ts`); everything else gets unit-cells unwrapped centrally by
     `coerceInputs` — do NOT hand-unwrap. See CLAUDE.md "unit-blind boundary".
2. **Kind** → `src/graph/nodes/kind.ts`: an `instanceof` branch in
   `nodeKindOf()` assigns the accent/category (`"input"`, `"string"`,
   `"list"`, `"util"`…). The fallback is `"math"`, so math nodes skip this.
3. **Component** → `src/graph/components/<Name>Node.tsx`. A standard
   "inputs + one value box" node is one line:
   `export const FooComponent = makeNodeComponent<FooNode>((n) => n.cachedResult);`
   (from `./standardNode`; `makeExtensibleNodeComponent` for add/remove input
   rows). Nodes needing an `OpSelect`, custom value render, or local state
   hand-write against `NodeShell` — see `ArithmeticNode.tsx` (minimal) or
   `ColorBlendNode.tsx` / `ColorPickerNode.tsx` (custom output row).
4. **Barrel** → one line in `src/graph/components/index.ts`.
5. **Registry** → `src/graph/nodeRegistry.ts`: add the class + component to
   the import blocks, one `[FooNode, comp(FooComponent)],` row in
   `NODE_COMPONENTS`. (This also feeds the ctor registry persistence uses.)
6. **Catalog** → one entry in `src/graph/nodeCatalog.ts`, in the right
   category. The `description` IS the node's Function Reference entry AND its
   hover tooltip — carry the Excel equivalent where one exists, per the
   zero-learning-curve rule. A `keywords` string boosts Add-menu search.
   No Captain-Obvious phrasing (CLAUDE.md).
7. **Excel metadata** (only for Excel-function nodes) → `src/graph/nodeExcel.ts`:
   `"foo": [{ excel: "FOO", syntax: "=FOO(x)" }]` (+ `parity: false` + `note`
   if it differs). The Function Reference derives from this; the dev catalog
   validator flags a mapping to a missing node. Omit for Solenoid-native
   nodes; pack nodes declare it inline on the catalog entry instead.
8. **Tests** → a vitest file NEXT TO THE CLASS (`nodes/foo.test.ts`) pinning
   `data()` behavior: happy paths, the error cases, and an `extractInit`
   round-trip (see `colorBlend.test.ts` / `colorPicker.test.ts`). Every node
   family has one; a node without tests is not done.

## Persistence — how node state survives save/copy/undo

- `extractInit` (`copyPaste.ts`) snapshots constructor-arg fields listed in
  **`INIT_FIELD_ORDER`** — `label`, `op`, `mode`, `format`, `value`, `width`…
  **Reuse an existing field name when one fits** (e.g. call your dropdown
  `mode` or `op`); a genuinely new field must be APPENDED to that list, which
  is shared with `textForm.ts`'s byte-identical writer — extend, don't reorder.
  The constructor must accept the same fields back (guard stale enum values
  from old saves — fall back, don't crash).
- **Reading an input**: use `readInput(inputs.x, this.literals.x ?? default)`,
  NEVER `inputs.x?.[0] ?? this.literals.x`. `??` can't tell "no cable" from "a
  cable carrying blank", so it substitutes the card's value for the graph's
  answer. Then decide what a wired blank DOES from the input's role —
  propagate / skip / skip-the-check / fall back — per the table in
  `docs/value-semantics.md` "Reading an input". Pin both halves in a test
  (wired blank AND unwired default); `nodes/readInputSweep.test.ts` fails on a
  new `?? literal` read.
- **`literals` / `stringLiterals`**: declare the map on the class IFF the card
  edits those values inline — that declaration is the LOAD GATE (persistence
  restores the maps only onto declaring classes, so a save can't hardcode a
  value the user can't see). `literals` entries are spread into the init
  snapshot; `stringLiterals` ride persistence's own channel. A typeable-list
  input (strlist/datelist/logicallist) implies a `stringLiterals` declaration
  (machine-checked in `coerceInputs.test.ts`).
- Object-valued config (a per-row map, a ports array) needs its own deep-copy
  block in `extractInit` — copy the object, and keep only LIVE rows' entries
  (orphans from undo break the text form's second-write identity). Follow the
  `condConfig`/`titles` examples there.

## UX rules the component must follow

- **Typed fields commit on Enter/blur** via `useDraftCommit`
  (`inlineInput.tsx`) — NEVER call `processGraph()` from a text field's
  `onChange`. Discrete picks (dropdowns, checkboxes, slider drags) apply
  immediately; `OpSelect` is already drag-safe (stopPropagation) — any other
  popup-opening control needs `onPointerDown`/`onMouseDown` stopPropagation.
- **`InlineInputs` renders literal fields for you**, keyed by socket type:
  number *or* `numlist` → `InlineNumberField` (backed by `literals`), string
  *or* `strcombo` → `InlineTextField` (backed by `stringLiterals`), typeable
  lists → a CSV field. A combo edits as ONE value in place — it only becomes a
  list when a cable brings one in. Wired inputs automatically show the
  "↩ source" chip instead.
- Multi-output values → `InlineOutputRows` (collapse-safe). Role-distinct
  variadic inputs → `ExtensibleInputs`/`PairedExtensibleInputs`; interchangeable
  elements → a single list socket (see `docs/node-coverage.md` design rules).
- Custom result rows (a swatch, a glyph) sit inside a `MeasuredSocketRow`
  (`NodeSocket.tsx`) with `hideOutputSockets` on `NodeShell` — the
  ColorPicker/ColorBlend pattern — so the socket dot rides the row.
- Anything visual: read `DESIGN.md` first. No Captain-Obvious strings.

## Verify

`npx tsc --noEmit` clean + `npx vitest run` green — the FULL suite, because
the machine-checked sweeps (`socketConnect.test.ts`, `coerceInputs.test.ts`,
`seeds.test.ts`) are what catch a wiring/declaration mistake. The node then
appears in the Add menu and the Function Reference (both generated from the
catalog). The author eyeballs UI on their own dev environment — do NOT build
render/screenshot tests (vitest env is `node`, no jsdom).

## nodeKit / component-kit reference

- `NodeShell` (`nodeKit.tsx`) — sockets + editable-label header + body.
  Props: `leading` (bare input sockets), `labelPlaceholder` (sources),
  `hideOutputSockets` (when you render your own `MeasuredSocketRow`).
- `useNodeField(node, key)` — controlled state mirrored to `node[key]`,
  recomputes on change. For op selects and any persisted node field.
- `OpSelect` — drag-safe `<select>`; `options={[{value,label,group?}]}`.
- `ValueDisplay` — renders `number | list | SolError | null` with chips;
  `render`/`empty`/`full`/`socketKey` overrides.
- `PortSockets` / `InlineOutputRows` / `MeasuredSocketRow` — socket plumbing.
- `makeNodeComponent` / `makeExtensibleNodeComponent` (`standardNode.tsx`).
- `InlineInputs`, `useDraftCommit`, `InlineNumberField`, `InlineTextField`
  (`inlineInput.tsx`).
- `SegToggle` — segmented toggle (mode switches, per ColorPicker/Table Input).
- `ErrorChip` (`ErrorChip.tsx`) — render a `SolError` in a custom row.
