---
name: add-node
description: Add a new computation node to Solenoid (the node-graph app). Use when the user asks to add a node, op, or Excel function to the graph editor — covers the class, the React component, registration, and the Add menu.
---

# Add a Solenoid node

A node is a class + a component + three registration lines + a catalog entry.
The component is usually boilerplate (the node kit carries it), so the real
work is the Rust body, the field declarations, the tests, and the catalog copy.

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
   `convert.ts` `complex.ts`. `nodeClasses.ts` is the barrel — existing domain
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
   - **The body is Rust.** The class's `data()` is `return nodeOnCore(this, inputs)`;
     the body lives in `crates/solenoid-core/src/nodes/<family>.rs`, reached by
     `nodes::run` by class name, and a class whose `data()` is only that goes in
     `nodes::DIRECT` (kept sorted) so the engine calls it in Rust
     (`tree/specs/computation/node-bodies.md`). Element-wise bodies use the
     family broadcasters in `nodes/kit.rs` (`broadcast_err` and kin), which share
     the ragged-zip and per-cell error/blank contract. A body that answers the
     same as a formula calls the formula's kernel or the function by name.
   - **Errors**: the input boundary (`crates/solenoid-graph`) runs the error guard
     around every call: an incoming error short-circuits to the outputs unless the
     class is in `SEES_ERRORS`, and a throw becomes `#ERROR!`. For the node's OWN
     failures the body answers an error value (`#VALUE!`, `#DOMAIN!`, `#SHAPE!`…);
     never NaN as an error.
   - **Units**: an algebra node sets `unitAware = true` and its body does the unit
     math; everything else gets bare magnitudes from the boundary. Do NOT
     hand-unwrap.
   - **The formula twin**, when there is one, is its own set of declarations
     (`call_traits.json`, `FUNCTION_ARITY`, `ARG_ROLES`, a unit class): the map of
     everything a new function touches, and the spec governing each piece, is
     `tree/specs/floors/node-classes.md` § A new function across the app.
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
   zero-learning-curve rule. A `keywords` string boosts Add-menu search; the everyday words people mean the card by ("mean", "running total") go in `CARD_TAGS` (`src/graph/catalogTags.ts`), which rank first. A tag is never the card's label or a formula/Excel name.
   No Captain-Obvious phrasing (CLAUDE.md).
7. **Excel metadata** (only for Excel-function nodes) → `src/graph/nodeExcel.ts`:
   `"foo": [{ excel: "FOO", syntax: "=FOO(x)" }]` (+ `parity: false` + `note`
   if it differs). The Function Reference derives from this; the dev catalog
   validator flags a mapping to a missing node. Omit for Solenoid-native
   nodes; pack nodes declare it inline on the catalog entry instead.
8. **Tests** → a vitest file at the class's MIRRORED tests/ path
   (`tests/graph/nodes/foo.test.ts` for `src/graph/nodes/foo.ts`) pinning
   `data()` behavior: happy paths, the error cases, and an `extractInit`
   round-trip (see `colorBlend.test.ts` / `colorPicker.test.ts`). Every node
   family has one; a node without tests is not done.

## Persistence — how node state survives save/copy/undo

- `extractInit` (`nodeInit.ts`) snapshots constructor-arg fields listed in
  **`INIT_FIELD_ORDER`** — `label`, `op`, `mode`, `format`, `value`, `width`…
  **Reuse an existing field name when one fits** (e.g. call your dropdown
  `mode` or `op`); a genuinely new field must be APPENDED to that list, which
  is shared with `textForm.ts`'s byte-identical writer — extend, don't reorder.
  The constructor must accept the same fields back (guard stale enum values
  from old saves — fall back, don't crash).
- **Reading an input** happens in the Rust body: `slot` / `read_role` /
  `Call::unwired` (`nodes/list.rs`, `nodes/scalar.rs`), never a cable's value
  with the card's literal patched in. What a wired blank DOES follows the
  input's role (propagate / skip / fall back), per
  `tree/specs/values/value-semantics.md` § Reading an input.
- **Every field declares what it is when empty** ([[D96]] emptySlotShowsItsValue,
  `tree/specs/documents/inline-literal-maps.md` § What an empty field is): a
  **Fallback** (a value, shown muted upright, that the card computes with), a
  **Behavior** (`[word]` in brackets, upright), an **Example** (a muted italic
  hint; the card computes nothing from it) or **Required** (nothing shown; a
  named error). No hidden defaults: a value the body computes from when the
  field is empty is that field's Fallback, shown. Fallback over Example by
  default, 0 / FALSE / "" usually, another value where it reads better. Where it
  goes:
  - a **setting** declares it through its role: `static inputRoles` with
    `rolesFrom("FN", { key: argIndex })` when the card has a formula twin (the
    role then lives once in `ARG_ROLES`, `inputRoles.ts`, and the call table),
    else `setting(value)` or `setting(LEFT_OUT, "word")` (the word a value-like
    one shows, e.g. `"5"`);
  - any other field is a row in `EMPTY` (or `EMPTY_BY_OP` when it differs per
    op) in `crates/solenoid-core/src/nodes/fields.rs`, and the body reads it only
    through `Call::unwired`.
  `emptyFieldKinds.test.ts` fails a card leaf with an undeclared field, and a
  Fallback that disagrees with the formula twin's empty slot. A field that only
  appears after a mode switch isn't swept: declare it all the same.
- **A mode that swaps the input shape** (a list vs a table) follows INTERPOLATE:
  a `mode: ShapeMode` field, `_rebuildSockets()` building each mode's full set
  (the existing mode's sockets unchanged), and the component calling
  `applyShapeMode` (`components/shapeMode.ts`), which drops every cable first.
  A grid that reaches a body takes `matrixArgs` in the call table, and a
  dynamic matrix socket goes in `matrixUnitPolicy.test.ts` by hand.
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

## Inspector declarations (both opt-in, both static on the CLASS)

- **`static socketDocs: Record<string, string>`** — one plain-English sentence
  per socket KEY, shown under that socket's row in the Inspector. Only for
  sockets whose behavior isn't obvious from label + type name (wired-blank
  semantics, which duplicate wins, coercion quirks); most sockets need nothing.
  Reader: `socketDocs.ts`; worked example: `SubsystemNode`. DESIGN.md §7 voice.
- **`static frameHints`** (`frameHint.ts`) — a tiny example frame per frame
  input; shows on socket hover AND with that socket in the Inspector.

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

`npx tsrs --noEmit` clean; the Rust checks and binaries per `CLAUDE.md` §
Testing (`bash scripts/check-rust.sh core`, `cargo test --release --lib`,
`--test nodes`, `--test conformance`; a moved answer is refrozen and each moved
case checked against the change); `npm run build:wasm` once; then the `nodes`
bucket (`node scripts/test-bucket.mjs nodes`) plus the buckets of whatever else
the change touched. A new card or function crosses tiers (catalog, formulas,
saves), so run the full `npx vitest run` once before pushing: the sweeps
(`socketConnect`, `coerceInputs`, `seeds`, `emptyFieldKinds`,
`formulaNodeCoverage`, `settingsAudit`) are what catch a declaration gap. A
pack description edit also needs `node scripts/prerender-site.mjs`. The node then
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
