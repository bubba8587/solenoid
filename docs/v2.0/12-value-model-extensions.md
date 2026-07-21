# Bundle 12 — Value-model extensions: As-Of time, uncertain values, money mode

**Source:** scope-features #22 (IN, build now), #21 (IN, very late), #43 (IN, defer).

---

## #22 — As-Of Join / As-Of Lookup (IN — build now, small, high value-per-effort)

**BUILT 2026-07-03 — see `docs/archive/dev-notes-history.md` for the implementation summary.**
Both halves shipped exactly as scoped below: no third node,
`asof` as a fifth `JoinHow`, the Rust `asof_join` feature enabled, and `lookupFrameCell`'s
approximate-match mode. #21 and #43 elsewhere in this bundle remain unbuilt.

**No third node.**

**Join side — exact current shape:** `JoinNode.how: JoinHow`
(`src/graph/nodes/frame.ts:230`), `JoinHow = "inner" | "left" | "right" | "outer"`
(`frameVerbs.ts:351`), `JoinOpts { leftKey; rightKey; how: JoinHow }`
(`frameVerbs.ts:352`). JS oracle: `joinFrames(left, right, opts)`
(`frameVerbs.ts:378-420`, hash-index join via `keyIndex`/`encodeCell`, pure equality, no
ordering/tolerance concept). Dispatch: `JoinNode.data()` calls `runFrameJoin(left, right,
{leftKey, rightKey, how})` (`frame.ts:252` → `frameBackend.ts:383-395`) → active
backend's `.join()`. **Rust wire struct**, `src-tauri/src/engine.rs:425-431`:
```rust
pub struct WireJoinOpts {
    #[serde(rename = "leftKey")] left_key: String,
    #[serde(rename = "rightKey")] right_key: String,
    how: String,
}
```
**Rust match arm to extend** — `verb_join(left, right, opts: &WireJoinOpts)`
(`engine.rs:891-935+`), `how` matched at lines 894-900 (`"inner"→JoinType::Inner`,
`"left"→Left`, `"right"→Right`, `"outer"→Full`, else `#VALUE!`). Row-order/driving-side
logic keyed off `is_right` (901-908).

**Build:**
1. Add `"asof"` to `JoinHow` (`frameVerbs.ts:351`) and a direction field to `JoinOpts`/
   `WireJoinOpts` (e.g. `asofDirection: "backward"|"forward"|"nearest"`, optionally a
   tolerance).
2. Add the `"asof"` match arm in both `joinFrames` (JS, `frameVerbs.ts:378-420`) and
   `verb_join`'s `how` match (`engine.rs:894-900`), using Polars'
   `LazyFrame::join_asof`/`join_asof_by` on the Rust side.
3. Enable the `asof_join` cargo feature — confirmed **not present at all** in
   `src-tauri/Cargo.toml:37` (`polars = { version = "0.46", default-features = false,
   features = ["lazy", "strings"] }`) — add `"asof_join"` to that features list.
4. JS oracle: implement as a sorted binary search (an afternoon of work per the original
   pitch) inside `joinFrames`'s new arm.
5. Add a `how`/direction control to `JoinNode`'s UI (`nodes/frame.ts:228-254`).
6. Parity test in `frameShape.test.ts`/`polarsBackend.test.ts`-style file + a
   prices/trades seed.

**Lookup side — exact current shape:** `FrameLookupNode`
(`src/graph/nodes/frame.ts:1060-1109`). Doc comment verbatim (lines 1060-1069):
> "Find the first row whose 'In column' cell equals the Lookup value, and return that
> row's 'Return' cell... A miss falls back to If-not-found..., else #N/A. **Exact match
> for v1; approximate match + a typed read-as output are the follow-ups.** (Verb:
> lookupFrameCell. Materialization-boundary op, so it stays eager JS like Get Column.)"

Verb: `lookupFrameCell` (`frameVerbs.ts:807-819`, own doc comment at 801-806 repeating
"approximate/next-smaller-larger over a frame column is a follow-up"). Implementation is
a linear scan (812-818) using `keyMatches(cell, lookup, key.type)` — **no
sortedness/tolerance support exists today.**

**Build:** add an approximate-match scan mode (nearest ≤/≥) to `lookupFrameCell`
(`frameVerbs.ts:807-819`), following the same doc-comment-flagged follow-up already
named — no new node class, extend `FrameLookupNode`'s options.

## #21 — Uncertain values: numbers with error bars that propagate (IN — VERY LATE)

**NEEDS AUTHOR INPUT before build:** pick `10 ± 2` (symmetric error bar) vs. `between 8
and 12` (interval) as the v1 scalar kind.

**Precedent now exists (not a substitute for the app-wide call):** Monte Carlo's
composite-scoped `UncertainNumber` (mean ± sd, `valueKinds.ts`, shipped 2026-07-12) is a
concrete tagged-shape implementation of exactly this kind — scoped to composite run modes,
not threaded through app-wide arithmetic. The eventual app-wide representation call can
build on it.

**Value-kind pattern to mirror — `src/graph/valueKinds.ts`:** every existing extra kind
(null/logical/error) is a plain runtime value acting as its own tag, not a wrapper
object: `Missing = null` (21-25, predicate `isMissing`), logical = raw `boolean` (29-31,
`isLogical`), error = `SolError` object (imported from `errorValue.ts`, tested via
`isSolError`). Cross-kind coercion lives in dedicated functions
(`logicalToNumber`/`numberToLogical`/`coerceLogical`, 37-65), Kleene 3-valued logic
(67-90), and one central chokepoint `forAggregate(values): AggregatePrep` (99-109) every
reducer routes through. **An "uncertain number" kind can't literally be `null`/`boolean`**
— it needs a distinct tagged shape, e.g. `{value: number; error: number}`, with an
`isUncertain(v): v is UncertainNumber` predicate, coercion helpers, and — critically —
its own propagation rule added to `forAggregate` (99-109) and every element-wise
arithmetic op, mirroring exactly how `SolError` propagates and `Missing` gets skipped.

**Authoring surface — the Number node:** `NumberInputNode`
(`src/graph/nodes/input.ts:8-24`) — fields `label: string`, `value: number`, fixed
`width=180/height=100`, one output socket (`numberSocket`) named `"value"`, `data()`
returns `{value: this.value}`. **This is where the `±` field gets added** (e.g. a new
`errorValue: number` field alongside `value`, switching the output to emit an
`UncertainNumber` when nonzero). Note: there's also a `NumberValueNode` at
`src/graph/nodes/text.ts:610` — confirm it's not the intended target before assuming
`NumberInputNode` is the only "Number" node.

**Build (once representation chosen):**
1. Add the `UncertainNumber` tagged shape + predicate to `valueKinds.ts`, following the
   exact pattern above.
2. Wire propagation into `forAggregate` (99-109) and the four arithmetic ops (sums add
   uncertainties, products compound — real error-propagation math).
3. Display: render the `±` like a unit suffix (reuse `ValueDisplay`'s formatting stack,
   detailed in bundle 13).
4. Add the `±` field to `NumberInputNode` (`input.ts:8-24`).
5. Wire as bundle 09's Monte Carlo distribution-input — an uncertain input is exactly
   what a Monte Carlo run samples; this is the connective tissue between the two bundles.

## #43 — Money mode: exact decimal arithmetic (IN — DEFER, sequence very late)

**NEEDS AUTHOR INPUT / scope check:** per-document mode, or per-unit (anything tagged
`$`)?

**Rounding-mode precedent to reuse — `src/graph/nodes/scalar.ts`:** `MRoundNode`
(425-450) rounds to nearest multiple via `Math.round(v/m)*m` (445, JS-default half-
rounding, no direction control). `RoundNNode` (454-492) is the reusable **round-direction
pattern**: `export type RoundNOp = "round" | "roundup" | "rounddown"` (454), an `op:
RoundNOp` field (458), a `switch (this.op)` inside `broadcast()` (478-486) implementing
Excel-style round-half-away-from-zero (482, explicitly not JS `Math.round`), ceil/floor-
away-from-zero for up (483), floor/ceil-toward-zero for down (484). **Money mode's
rounding-policy setting should reuse this literal-string-union + switch pattern**,
adding a `"bankers"`/half-even variant to a similar union rather than inventing a
separate mechanism.

**Build (once scope confirmed):**
1. Enable Polars' decimal dtype — same `Cargo.toml:37` features-list edit as
   `asof_join`, add `"decimal"` (confirmed absent, not just disabled).
2. Build a JS decimal arithmetic path for scalar money math (the real cost — no existing
   decimal-math code found in the JS layer).
3. Add a rounding-policy setting following `RoundNOp`'s pattern (`scalar.ts:454-486`).
4. Scope honestly: money first, not general arbitrary-precision arithmetic.

## Exit criteria

As-Of Join ships as a new `"asof"` `JoinHow` value + direction control on the existing
`JoinNode`, with the `asof_join` cargo feature enabled and a parity test; As-Of Lookup
ships as an approximate-match mode on `FrameLookupNode`/`lookupFrameCell` (no new node).
Uncertain values and money mode are NOT required for this bundle's exit — only that
their open design questions (representation; per-doc vs per-unit scope) are answered
before code starts on them.
