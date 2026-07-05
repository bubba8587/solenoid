# Node arity audit — fixed-arity nodes that should be variadic

**Goal:** find nodes whose inputs are HARDCODED to a small fixed count while the
Excel function they emulate is variadic, and convert them to the app's existing
extensible-input pattern. Scope is deliberately narrow: only high-confidence
upgrades. List/table aggregators that already take ONE list/table socket (SUM,
AVERAGE, MULTINOMIAL, …) are correct by design and are NOT in scope — the design
rule is "lists/tables → one bundled list input, not N scalar inputs."

Source-of-truth pattern: `ExtensibleInputs.tsx` + the `ExtensibleNode` interface
(`addValueInput()` / `removeValueInput()` / `nextInputId`), rendered via
`makeExtensibleNodeComponent`, persisted via `extractInit`'s `valueKeys` capture
(`copyPaste.ts:84`). Used today by `ListInputNode` and `ConcatNode`.

---

## Verdicts

| Node | File:line | Excel fn | Now | Excel max | Shape | Verdict |
|------|-----------|----------|-----|-----------|-------|---------|
| **IfsNode** | `logic.ts:418` | IFS | 3 cond/val pairs | 127 pairs | paired | **UPGRADE** (paired) |
| **SwitchNode** | `logic.ts:378` | SWITCH | expr + 3 when/then + default | 126 pairs | fixed + paired | **UPGRADE** (paired + fixed) |
| **ChooseNode** | `logic.ts:344` | CHOOSE | index + 4 values | 254 values | fixed + flat | **UPGRADE** (flat) |
| LogicalNode → **BooleanOpNode** + **IfNode** | `logic.ts` | AND/OR/XOR + IF | was capped at 2 / shared with IF | 254 | split | **DONE** — variadic booleans + standalone IF |
| GcdNode | `scalar.ts:503` | GCD/LCM | 2 list-aware inputs | 255 | binary broadcast | KEEP (binary broadcast ≠ N-ary reduce) |
| SumProductNode | `scalar.ts:691` | SUMPRODUCT | 2 lists | 255 | already-list | KEEP (2 is the case; low value) |
| Multinomial / aggregators | scalar/stats | many | 1 list | — | already-list | KEEP (correct by design) |

### Why GCD/LCM stays
`GcdNode` takes two **list-aware** inputs and broadcasts element-wise
(`gcd([12,18],[8,12]) → [4,6]`). Excel's variadic `GCD(a,b,c,…)` reduces N
**scalars** to one number — a different operation. A true N-ary GCD/LCM would be
a list aggregator (one list in, one scalar out), not an extra socket. Out of
scope unless we decide to add it as an Aggregate op; not a clean in-place upgrade.

---

## Principle: labeled slots vs a single list input

Why these stay as N labeled scalar rows and are NOT "just two list inputs":

- A variadic node uses **individually-labeled, individually-wireable scalar
  rows** when each input plays a **distinct role** — positional (CHOOSE's
  value-per-index) or **paired** (IFS/SWITCH's condition↔result). The label is
  the affordance: it tells the user what each slot does and what an edit affects.
  Feeding the same data as a raw list (`conditions[]`, `results[]`) severs the
  visible cond↔result pairing — editing element 2 of one list with no sight of
  its partner is an opaque edit. Per-slot sockets also let each input come from a
  **different** upstream node; a single list socket forces one homogeneous source.
- Use a single **list socket** only when the elements are **interchangeable** —
  same role, order-may-matter-but-identity-doesn't (SUM, AVERAGE, AGGREGATE, List
  literal). CHOOSE-by-list is already covered by `INDEX(list, n)`.
- **Litmus test:** if explaining the list would require "the 2nd element means X,
  the 3rd means Y," it should be labeled slots, not a list.

Recorded in `docs/node-coverage.md` (Labeled-slots vs list-input rule) + CLAUDE.md.

## Shared infrastructure these upgrades need

The existing `ExtensibleInputs` renders **one homogeneous value row per input**
with a single `+ Add`, and `extractInit` captures **every** input key as a value
key. Three of these nodes break those assumptions, so two small pieces of shared
infra come first (Chunk 0):

1. **A paired-row extensible renderer** (`PairedExtensibleInputs.tsx`) for IFS /
   SWITCH: each "row" is a GROUP of two inputs (cond+val / when+then) sharing one
   remove button, plus one `+ Add` that adds a pair. Keys are index-encoded:
   `cond0/val0`, `cond1/val1`, … (IFS) and `when0/then0`, … (SWITCH). A
   `PairedExtensibleNode` interface exposes `addValuePair()` / `removeValuePair(i)`
   and the pair-key convention.

2. **Mixed fixed + extensible persistence.** CHOOSE has a fixed `index` input;
   SWITCH has fixed `expr` + `default`. `extractInit` currently does
   `valueKeys = Object.keys(n.inputs)` — that would also capture the fixed keys
   and the constructor would wrongly try to rebuild them as value rows. Fix:
   the constructor re-adds its fixed inputs unconditionally and, when replaying
   `valueKeys`, **skips any key that isn't an extensible key** (i.e. only `v*` /
   `cond*`/`val*`/`when*`/`then*`). No change to `extractInit` needed if the
   constructors filter — keep the capture dumb, make the rebuild defensive. (Add
   a one-line note to `extractInit` pointing here.)

Min arity (don't let the user remove the last pair/value below the Excel
minimum): IFS ≥ 1 pair, SWITCH ≥ 1 pair, CHOOSE ≥ 2 values, booleans ≥ 2.

---

## Chunked implementation plan

**Status (2026-06-23):** All chunks (0–4) shipped to `working`. Suite green (1008).

**Chunk 0 — infra.** ✅ done — `PairedExtensibleInputs.tsx` + the
`ExtensibleInputs` `leadingKeys`/`valueKeys` generalization. `extractInit`
captures `valueKeys` for paired nodes too. `PairedExtensibleInputs.tsx` + `PairedExtensibleNode`
interface + `makePairedExtensibleNodeComponent` in `standardNode.tsx`. No node
wired yet; just the renderer + a unit-testable key helper.

**Chunk 1 — CHOOSE.** ✅ done. Give `ChooseNode` `nextInputId` /
`addValueInput` / `removeValueInput` over `v*` keys; keep `index` fixed. Custom
component renders the `index` row then the extensible value rows (or extend
`ExtensibleInputs` to take an optional `fixedLeadingKeys` it renders verbatim).
`data()` loops over present `v*` keys instead of v1..v4. Update catalog
description ("one of several values"). Drop the fixed `height`.

**Chunk 2 — IFS (the headline case).** ✅ done. Converted to `cond{i}/val{i}` pairs
via the Chunk-0 renderer; `data()` walks pairs in key order, returns the first
non-zero/ non-null condition's value, else null. Min 1 pair. Update catalog
("chained IF over as many conditions as you add").

**Chunk 3 — SWITCH (paired + fixed expr/default).** ✅ done. Fixed `expr` + `default`,
extensible `when{i}/then{i}` pairs between them. Reuse the paired renderer with
fixed leading (`expr`) and trailing (`default`) rows. `data()` matches expr
against each when in order. Min 1 pair.

**Chunk 4 — split `LogicalNode` → variadic `BooleanOpNode` + standalone `IfNode`.**
✅ done (author chose the split, 2026-06-23). The old multi-op node multiplexed IF
(a value selector needing 3 labeled sockets) and the boolean ops (capped at 2).
Resolution:
- **`BooleanOpNode`** — op selector AND/OR/XOR/NAND/NOR/XNOR over **extensible**
  operand rows (`a*`), plus NOT as the unary op (the component renders a single
  fixed row for NOT, extensible rows otherwise). ALL ops emit the logical type, so
  the op switch never swaps the output socket — only the input layout. N-ary Kleene
  fold (`foldBoolean`); XOR/XNOR = odd/even count of trues, null if any operand
  missing. Kind `logic` (purple).
- **`IfNode`** — standalone, fixed `cond`/`then`/`else`, value passthrough. Kind
  `util` (matches its siblings Choose/Switch/Ifs — they're selectors, not logical
  emitters; the old IF was only purple because it shared a class with the booleans).
- **IFS gained an "Otherwise" trailing input** (author's call) — returned when no
  condition matches, killing the fake-`TRUE,fallback` last-pair pattern. Unset →
  null (old behaviour preserved).
- Migrated the one seed (`null-and-logical.json`) Logical node → BooleanOpNode
  (`a`→`a0`). `LogicalNode`/`LOGICAL_OP_*`/`LogicalComponent` deleted.

Each chunk: keep `tsc` + vitest green, update any seed that uses the node if its
input keys changed (none of these are in seeds with wired cond/val pairs — verify
with a grep before each push), update the catalog description, push to `working`.

---

## Out of scope / explicitly KEPT (so a later pass doesn't re-litigate)

- All single-list aggregators (SUM/AVERAGE/MIN/MAX/PRODUCT/…): correct by design.
- `SumProductNode` (2 lists), `GcdNode` (binary broadcast): real Excel variadic
  but the binary form is the meaningful unit here; low value, different semantics.
- `IFERROR`/`IFNA`, `Comparison`, `Range`, `RollingNode`, etc.: fixed arity is
  correct (not variadic in Excel, or the extra args are list-shaped already).
