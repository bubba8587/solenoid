# 17 — Matrix formulas (the Tier 4 / D2 decision packet)

**Status: PREP COMPLETE, decision AUTHOR-GATED.** This is the packet the recorded
Tier 4 plan requires on the table before the decision session
(`formula-node-parity.md` → "Tier 4 in full"): a concrete shape-branding design and
the DA broadcast-rules table. Nothing here lifts the cap — the `#SHAPE!` block and
the connect-time gate stand until the author picks an endpoint.

**The question:** do formulas (Expression / LAMBDA) accept matrices, or stay 1-D
forever? The two defensible endpoints on record:

- **Never** — formulas stay 1-D glue. The 19 gap-A names are recorded as permanently
  out, INTERPOLATE grid mode and the array-returning range functions stay node-only.
- **Matrices-only, Excel dynamic-array semantics** — this packet. Frames, cubes and
  complex stay out (rung 4 was rejected outright: no Excel semantics to copy,
  competes with the verb engine, breaks lazy-FrameRef economics).

The decision criteria are fixed (2026-07-14, author ruling): correctness and
coherence only. The identity objection is retired — do not re-litigate it.

---

## Part 1 — Shape branding (what changed, what remains)

### The value grammar after the complex rebrand (VAL-15, shipped 2026-07-28)

The recorded blocker was: *"a complex `[re,im]` is indistinguishable from a 2-list —
fixing that needs a branded value + a type pass."* That is no longer true. Every
special scalar is now a tagged object, so the runtime value grammar is
**unambiguous by construction**:

| JS shape | Meaning | Ambiguity |
|---|---|---|
| `number` / `string` / `boolean` | scalar | none |
| `null` | missing | none |
| tagged object (`SolError`, `UnitCell`, `Cx`) | special scalar | none — `is*` predicates |
| `Array` of cells | **1-D list** | none — no other value is an array |
| `Array` of `Array`s | **matrix** (array of ROWS) | none — nested lists don't exist in the value model |

No branded-value wrapper and no type pass are needed: `Array.isArray` at two depths
IS the complete rank test. The "second typed engine inside strings" D2 feared does
not have to be built.

### The two residual questions (both conventions, not mechanisms)

1. **Orientation.** A 1-D list is orientation-less. When one meets a 2-D context,
   the socket lattice already ruled: **a list widens into a 2-D input as a ROW**
   (`SOCK-2`). Formulas inherit the same convention — a list is a `1×n` row wherever
   orientation matters. A column is spelled explicitly (`TRANSPOSE(list)`, which is
   itself one of the functions this unlocks). One rule, already tested, no new law.

2. **Empty `[]`.** Rank-ambiguous (empty list = empty matrix). Resolution: `[]` is
   the empty LIST; an empty matrix is `[[]]`-free — a matrix has ≥1 row by
   construction, and every matrix producer already guarantees it. Where an empty
   result's rank matters downstream, the consuming socket's declared rank decides —
   the same rule `coerceInputs` applies today.

### Where rank information lives (all three already exist)

- **At the boundary:** formula variables are typed sockets; the connect-time gate
  knows every input's rank before evaluation starts.
- **Through functions:** `EXCEL_IMPL_META.rank` — extended with `"matrix"`, the
  spelling deliberately reserved for this decision (`excelFunctions.ts`).
- **Through operators:** derived by the broadcast table below; a `bin` node's result
  rank is `max(rank(l), rank(r))`.

### The containment rule (hard line, machine-checked)

**Formula.js never sees a matrix.** A rank-2 argument dispatches ONLY to a declared,
owned registration; the Formula.js fallthrough stays 1-D permanently. The original
cap was partly containment of the weaker engine, and at rank 2 that logic still
holds — its array functions are written against 2-D *ranges* with unvetted quirks,
and it has already been caught mutating arguments in place (CHISQ.TEST). Check:
the evaluator throws `#SHAPE!` when a rank-2 value would reach `dispatch` for an
undeclared name — same shape-guard pattern as `rangeRouting.test.ts` (`SSOT-4`).

---

## Part 2 — The broadcast-rules table

Excel dynamic-array semantics, translated to a world with no grid, no spill, and no
`@`. The table is written to be transcribed into `broadcastRules.test.ts` as a
literal — every row is one test case (`SSOT-6`: the table and the test must be the
same data, not two documents).

Notation: `s` scalar · `L(n)` list of n (reads as `1×n` row where orientation
matters) · `M(m×k)` matrix. Element-wise ops = arithmetic, comparisons, `&`, unary,
percent, and every scalar function under `broadcastCall`.

| # | Left | Right | Result | Rule |
|---|---|---|---|---|
| B1 | `s` | `s` | `s` | plain call |
| B2 | `s` | `L(n)` | `L(n)` | broadcast scalar (today's behaviour, unchanged) |
| B3 | `L(n)` | `L(n)` | `L(n)` | element-wise zip (unchanged) |
| B4 | `L(n)` | `L(p)`, n≠p | `L(max)` padded | ragged pad (unchanged — see PAD) |
| B5 | `s` | `M(m×k)` | `M(m×k)` | broadcast scalar over every cell |
| B6 | `L(k)` | `M(m×k)` | `M(m×k)` | row broadcasts down the m rows (Excel: `1×k` op `m×k`) |
| B7 | `L(n)` | `M(m×k)`, n≠k | `M(m×max(n,k))` padded | width mismatch → PAD per row |
| B8 | `M(m×k)` | `M(m×k)` | `M(m×k)` | element-wise, cell by cell |
| B9 | `M(m×k)` | `M(p×q)`, shapes differ | `M(max×max)` padded | Excel broadcasts singleton axes then pads; a `m×1` column op `m×k` broadcasts across |
| B10 | `M(1×1)` | anything | as `s` | a 1×1 collapses to its scalar (Excel rule; mirrors today's singleton collapse) |
| B11 | `L(1)` | anything | as `s` | singleton collapse, already shipped for combos |

**PAD — the one deliberate Excel deviation, decided once for every row above.**
Excel fills non-overlapping broadcast cells with `#N/A`. Solenoid's existing 1-D
broadcast contract pads ragged zips with `null` (missing), pinned by
`broadcastContract.test.ts`, and `null` then flows by the app-wide value model
(aggregators skip it, element-wise math propagates it). Two options:

- **(a) `null` everywhere** — coherent with the whole app; a ragged 2-D op behaves
  exactly like today's ragged 1-D op. Deviates from Excel output where a workbook
  relied on `#N/A` padding.
- **(b) `#N/A` at rank 2, `null` at rank 1** — Excel-faithful for the transpiler,
  but the SAME mismatch now answers differently by rank, which is exactly the kind
  of incoherence the decision criteria exclude.

**Recommendation: (a).** Coherence is the fixed criterion; the transpiler can
inject `IFERROR`-style shims where a workbook genuinely depends on `#N/A` pads.
This is the packet's one open sub-decision — it needs the author's yes/no, not
design work.

**Aggregates over a matrix:** `SUM(M)` and every range function flatten row-major
and then apply their existing 1-D null/error policy (`prepRangeArgs` unchanged —
the flatten happens before it). `RANGE_RAW` / `RANGE_PAIRED` semantics carry over
verbatim; paired functions zip cell-by-cell in row-major order.

**Value-model interactions (already decided elsewhere, listed to show closure):**
per-cell `SolError` propagates by cell (VAL-6); per-cell `null` by the PAD rule
(VAL-5); a matrix carries ONE homogeneous unit (D20), so `dimEval` needs no 2-D
extension; logical↔number bridges per cell (VAL-7).

**Explicitly NOT implemented:** spill / `#SPILL!` (no grid — the result flows out a
socket), implicit intersection `@` (meaningless without a grid), `#N/A` pads (per
PAD-a), frames/cubes/complex in formulas (endpoint scope).

---

## Part 3 — What saying YES buys, and the build order

Unlocked immediately (all D2-capped today): the 19 gap-A names — MDETERM, MINVERSE,
WRAPROWS/WRAPCOLS, TOCOL/TOROW, TAKE (2-D), the LAMBDA family (MAP, BYROW/BYCOL,
MAKEARRAY, REDUCE, SCAN), RANDARRAY, SEQUENCE, FILTER, SORTBY, GROUPBY — plus
INTERPOLATE grid mode and range routing for TREND / GROWTH / LINEST / LOGEST /
FREQUENCY / MODE.MULT / UNIQUE / SORT / TRANSPOSE. The transpiler (bundle 08) stops
transpiling dynamic-array formulas inert.

Build order, if YES:
1. `broadcastRules.test.ts` from the Part 2 table, red. `rank: "matrix"` spelling +
   the containment guard.
2. `broadcastCall` grows the B5–B11 branches; `takesWholeArgs` learns rank-2.
3. Registrations in tranches, node-equality-tested like Tier 3
   (`formulaTier3.test.ts` discipline): shape ops first (mechanical), then the
   LAMBDA family (needs `compilePositional` at rank 2), matrix math last.
4. Ratchet update: gap A pins shrink as names register; `formulaNodeParity.ts`
   needs no change (the names stop being gaps by registering).

If NO: move the 19 names + the array-returning range functions to `EXCEL_GAP` with
reason "1-D cap, permanent", delete the Tier 4 sections from the parity doc, and
record the endpoint in `decisions.md`.
