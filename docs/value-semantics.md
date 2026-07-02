# Value semantics — null, NaN, Infinity, and errors, across every domain

The one-stop spec for the value model's special kinds: what each one MEANS, what
produces it, how it propagates through each computation context, and how it renders.
Consolidates the 2026-06-22 array-semantics build (decision D5) and the 2026-07-02
step-by-step rulings (decisions D10–D13; build items in `backlog.md` "Post-audit
tails"). Mechanics/invariants live in `subsystem-invariants.md` "Error values"; this
doc is the SEMANTICS reference.

**Status honesty:** rules marked **[shipped]** are in the code today; rules marked
**[decided 2026-07-02]** are settled-but-unbuilt (the backlog carries the build items).
When building one, flip its tag here.

## The kinds

| Kind | Meaning | It is… |
|---|---|---|
| value | a real number/string/date/logical/complex | the normal case |
| `null` | **missing** — no value was ever there | data, not a failure |
| `SolError` | **failure** — a computation could not answer (tagged code, 14 incl. `#OVERFLOW!` [decided 2026-07-02]) | loud until caught |
| `NaN` | **undefined number that leaked** — not an error, not missing | residue; computation may not produce it [decided 2026-07-02] |
| `Infinity` | **definable infinity** — deliberately declared (Constant node) or derived from an infinite input | a first-class value [decided 2026-07-02] |

The load-bearing distinctions:

- **null vs error**: a blank cell is *data you don't have*; an error is *an answer that
  failed*. Aggregators skip null but propagate errors; Filter drops null-predicate rows;
  Fill/Coalesce recovers null, IFERROR/IFNA recovers errors. The detect/recover 2×2:
  ISNULL / ISERROR / ISNA × Fill/Coalesce / IFERROR / IFNA. **[shipped]**
- **NaN vs `#N/A`**: unrelated, despite the letters. `#N/A` is a real tagged error
  ("no result exists"), minted by XLOOKUP not-found, the NA node, and IFS/SWITCH
  no-match [decided 2026-07-02]; IFNA catches it. NaN is IEEE float residue with no
  special status (the finding-13 settlement) — IFNA does NOT catch it, and it must
  never render as "N/A" [decided 2026-07-02: renders `NaN` with a muted-chip affordance].
- **Infinity vs overflow**: `10^400` is a really big *number* the app can't represent —
  that's `#OVERFLOW!`, not infinity. Infinity is only ever deliberate. [decided 2026-07-02]

## Production rules — where each kind comes from

- **Errors mint at the failure site, with the specific code**: `#DIV/0!` at the divide,
  `#DOMAIN!` at sqrt/log/pow domain failures, `#N/A` at not-found/no-match, `#SHAPE!`
  at coercion, `#CIRC!` at engine-cache seeding, `#OVERFLOW!` at representation
  overflow [decided]. Never a raw NaN as a failure signal.
- **The non-finite guard** (one shared helper in the compute layer) [decided 2026-07-02]:
  for any numeric op — result `NaN` → `#DOMAIN!` (indeterminate: `(-8)^(1/3)`, `∞−∞`,
  `∞/∞`, `0×∞`, or a NaN input entering the op); result `±Inf` from all-FINITE inputs →
  `#OVERFLOW!`; result `±Inf` with an infinite input → passes through (definable).
  Consequence: computation cannot PRODUCE NaN — the only NaN source left is dirty
  imported data.
- **null** comes from data (blank cells, CSV holes), from ragged-list padding
  [shipped 2026-07-02], from empty aggregations (`AVG([])`), and from Kleene logic
  that genuinely cannot answer.

## Propagation — by computation context

Which rule applies is decided by the CONTEXT, not the function's name. The contexts:

| Context | Error | null | Where |
|---|---|---|---|
| **Element-wise numeric** (operators, mapped functions) | propagates UNMORPHED, per cell, first-in-arg-order | propagates (`null+5` = `null` — the SQL model, NOT Excel's blank-as-0) | shared broadcasters; formula ops [shipped], functions + node layer [decided 2026-07-02] |
| **Element-wise logical** (Comparison, BooleanOp, IF, NOT) | propagates unmorphed [decided] | goes INTO Kleene — `FALSE AND null` = FALSE, `TRUE AND null` = null | `broadcastEl`; Kleene tables in `valueKinds.ts` [shipped] |
| **Reduction / aggregate** (SUM, AVG, formula AND/OR, Aggregate node) | propagates (first error wins) | SKIPPED (Excel range semantics, SQL aggregates) | `forAggregate`, `prepRangeArgs` [shipped] |
| **Paired / index-aligned** (SUMPRODUCT, CORREL, SUMIF…) | propagates | a null in ANY range drops that whole row pairwise; ragged ranges keep the min-length zip (pad-then-drop ≡ truncate) | `RANGE_PAIRED` [shipped] |
| **Positional lookups** (XLOOKUP, XMATCH, INDEX) | propagates | nulls STAY PUT (dropping would shift indices) | `RANGE_POSITIONAL` [shipped] |
| **COUNT family** | classified, not propagated (COUNT skips, COUNTA counts) | COUNTBLANK counts them | `RANGE_RAW` [shipped] |
| **Ragged element-wise zip** | — | pad-to-longest with null; a padded position is missing | all broadcasters [shipped 2026-07-02] |

The sanctioned divergence (decision D11): formula `AND(x)` is a *reduction* (nulls
skipped → Excel behavior); the BooleanOp node is *element-wise* (Kleene). Same word,
two contexts, both correct. Any OTHER node-vs-formula disagreement is a bug.

## Boundaries and bridges

- **Logical↔number bridge** (`coerceInputs.ts`): 0/1 ↔ FALSE/TRUE; **NaN → null**
  (unknown truth value — R/pandas lineage) [decided 2026-07-02]; aligned with
  `coerceLogical` (one spec).
- **Wired null vs unwired input** [decided 2026-07-02]: `undefined` (unwired) falls
  back to the node's literal; a WIRED `null` propagates as missing. The `?? literal`
  read idiom must not swallow wired nulls.
- **IPC / frame boundary**: NaN normalizes to null crossing to Polars [shipped]. The
  frame engine's own non-finite behavior (silent `inf`) is a separate open P3.
- **List ops vs relational verbs** (D12's line, second instance): list UNIQUE never
  dedupes error cells (each is an independent problem — the sanity-check reading);
  frame Distinct dedupes by error CODE (errors as values, SQL identity semantics).
  List/frame Sort both put nulls AND errors LAST, both directions, stably [shipped
  2026-07-02].

## Display

- **null** → rendered `null` (muted) [shipped].
- **SolError** → the red error badge with its code [shipped]; `#OVERFLOW!` joins the
  inventory (14 codes; update the subsystem-invariants count + error-showcase seed)
  [decided].
- **NaN** → literal `NaN` with a QUIET affordance: muted background tint (not error
  red, not ArrayChip-like) + fixed-text structural tooltip [decided 2026-07-02].
  Never "N/A".
- **Infinity** → spot-check `formatScalar` (∞ glyph is a candidate — author eyeball)
  [decided, open detail].

## Pointers

Decisions: D5 (the value model), D10 (current-Excel-only parity), D11 (surface
harmony + the reduction/element-wise line), D12 (comparisons vs identity; list vs
relational), D13 (engine consistency over Excel quirks) in `decisions.md`. Build
items: `backlog.md` "Post-audit tails". Mechanics: `subsystem-invariants.md` "Error
values". Related-but-separate: case sensitivity (D12), date year rules (backlog).
