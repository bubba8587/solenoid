# Bundle 12 — Value-model extensions: As-Of time, uncertain values, money mode

**Source:** scope-features #22 (IN, build now), #21 (IN, very late), #43 (IN, defer).
Grouped because all three extend "what a value/lookup can be," but they have very
different urgency — split accordingly.

---

## #22 — As-Of Join / As-Of Lookup (IN — build now, small, high value-per-effort)

**No third node — this is the key finding from the walk-through investigation.**

- **As-Of Join** = a new `how` value (plus a direction control: backward/forward/
  nearest) on the EXISTING `JoinNode` (`src/graph/nodes/frame.ts:228`) — same frame+frame
  → frame shape Polars' `join_asof` already matches.
- **As-Of Lookup** (single date → single cell) = the approximate-match mode
  `FrameLookupNode` (`frame.ts:1071`) already flags in its own code comment as the
  planned follow-up. No new node there either.

**Why nearly free:** Polars ships `join_asof` natively — it's a one-line cargo feature
flag (`asof_join`), not a new engine capability. The JS oracle side is a sorted binary
search — an afternoon of work.

**Build:**
1. Enable the `asof_join` cargo feature.
2. Add the `how` value + direction control to `JoinNode`.
3. Add the approximate-match mode to `FrameLookupNode` (its own flagged follow-up).
4. JS oracle parity implementation (binary search) + a parity test.
5. A prices/trades seed demonstrating both.

## #21 — Uncertain values: numbers with error bars that propagate (IN — VERY LATE)

Sequence this dead last, alongside #43 below — it's a real design session, not a quick
add. **This is also where bundle 09's Monte Carlo driver needs its distribution-input
representation decided** — do this design session before or alongside finishing Monte
Carlo, not after.

**NEEDS AUTHOR INPUT before build:** the value representation. Scope-features suggests
`10 ± 2` (symmetric error bar) or `between 8 and 12` (interval) — pick one as the v1
scalar kind; don't build both without a reason.

**Build (once representation is chosen):**
1. An `uncertain number` scalar kind, following the same pattern as the existing
   value-kind machinery (null/error/logical as distinct kinds riding one wire —
   `valueKinds.ts`).
2. The four arithmetic ops propagate correctly (sums add uncertainties, products
   compound them — real error-propagation math, not a hack).
3. Display renders it cleanly (the `±` reads like a unit suffix); any downstream
   consumer can ask for the interval explicitly.
4. Authoring UX: a "±" input on the Number node — that's the whole authoring surface,
   no new node needed.
5. Aggregators later (not required for exit criteria) — follow the `forAggregate`-style
   rule pattern already established for null/error handling.
6. Wire as bundle 09's Monte Carlo distribution-input: an uncertain input is exactly
   what a Monte Carlo run samples — this is the connective tissue between the two
   bundles, make sure the representation serves both.

## #43 — Money mode: exact decimal arithmetic (IN — DEFER, sequence very late)

**NEEDS AUTHOR INPUT / scope check before build:** confirm the trigger — per-document
mode, or per-unit (anything tagged `$`)? Scope-features leans per-unit; get an explicit
nod before building since it changes the representation significantly.

**Build (once scope is confirmed):**
1. Polars has a decimal dtype (not compiled in — same one-cargo-flag story as Parquet/
   As-Of Join). Enable it for the frame side.
2. The JS side needs an actual decimal arithmetic path for scalar money math — this is
   the real cost of this item, not the Rust flag.
3. An explicit rounding policy setting (half-up vs. banker's rounding) — this is an
   accounting requirement, currently an accident of the CPU's float behavior.
4. Scope honestly: money first, not general arbitrary-precision arithmetic. One target
   sentence: "the spreadsheet where the cents always foot."

## Exit criteria

As-Of Join/Lookup ship as `how`/mode additions to existing nodes (no new node type), with
a parity test and a seed. Uncertain values and money mode are NOT required for this
bundle's exit — they're correctly sequenced last; this bundle's exit criterion for those
two is only that their design-input questions (representation; per-doc vs per-unit scope)
are answered before code starts on them.
