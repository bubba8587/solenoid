# Bundle 04 — Provenance: "why is this value what it is?" (Bet 4)

**Source:** `future-directions.md` Bet 4. **Verdict:** IN, two tiers. **Depends on:**
nothing for tier 1; tier 2 is sharper once bundle 03's fused plan exists but doesn't
hard-block. **Feeds:** bundle 11's Problems panel ("…caused by") and Reconcile node.

## Tier 1 — errors carry origin at mint

**What exists:** `SolError` type — `src/graph/errorValue.ts:70-75` — `{ [TAG]: true;
code: SolErrorCode; message: string }` (`TAG = "__solError"`, line 68). **No origin/source
field exists yet** — this tier adds one. `installErrorGuards(node: object): void`
(lines 156-203) wraps `node.data` once (idempotent via a `WRAPPED` symbol, lines
150/165), short-circuits on `firstInputError` unless the node is in `SEES_ERRORS`
(lines 144-148: `IFErrorNode`/`IsTestNode`/`ConduitNode`/`CableSwitchNode`/`DisplayNode`),
and turns thrown errors into tagged errors via `fromThrown` (113-123). **Wired at
`Canvas.tsx:1455`** inside a `nodecreated` pipe (import at line 40) — this is the single
interception point to add origin-tagging at, rather than scattering it per-node.

**Where errors render today (the insertion point for "…caused by"):**
`src/graph/components/ErrorChip.tsx` is the shared component: `errorTip(err)` (lines
12-15) concatenates `err.message` + `ERROR_EXPLANATIONS[err.code]`; `<ErrorChip err
className?>` (21-27) renders `.sol-error-chip` with `title={errorTip(err)}`. Already
reused by `PinLayer.tsx:42` and (via chips) `AlertLayer`. `TablePopup.tsx:6,40`'s
`toGrid()` also checks `isSolError(v)` for grid-cell rendering, but only shows `v.code`,
no tooltip there today.

**`flyToNode(nodeId: string): void`** — `src/graph/flyToNode.ts:14`. Resolves collapsed-
group ancestors then `AreaExtensions.zoomAt`. Already reused by `PinLayer.tsx:143,166`
and `AlertLayer.tsx:118` — reuse it verbatim for the "click origin, jump there" action.

**Build:**
1. Add an optional `origin` field to `SolError` (`errorValue.ts:70-75`): node id/name
   (bundle 01's stable name once it lands, id in the meantime), input slot, and — for
   frame cells — row index.
2. Populate it inside `installErrorGuards` (`errorValue.ts:156-203`) at the point an
   error is minted or passed through — this single wrapper already sees every `data()`
   call, so it's the one place to add origin tagging without touching every node.
3. Thread `origin` into `errorTip()` (`ErrorChip.tsx:12-15`) as an additional line
   ("…caused by [origin]"), and make it clickable via `flyToNode(originNodeId)`.

## Tier 2 — on-demand derivation walk (any value, not just errors)

**What exists:** nothing — no derivation walk exists for non-error values today.

**Build:**
1. A "why am I this?" query: given a value's location, walk backward through the verb
   chain/node graph reconstructing the input chain. For frame cells, the natural walk
   target is the `LazyFrame` plan bundle 03 introduces (a lazy plan already encodes its
   own lineage) — sequence this after bundle 03 if possible, though it isn't a hard gate.
2. **Never store this exhaustively** — reconstruct per query.
3. UI: extend the `ErrorChip`/value-popup pattern from tier 1 into a general "why is
   this?" right-click action on any value box or frame cell.
4. Combined with bundle 01's stable names, a derivation can be shared as readable text.

## Exit criteria

Tier 1: every `SolError` carries an `origin` field populated inside
`installErrorGuards`, surfaced via `ErrorChip`'s `errorTip()` with a `flyToNode` jump
action. Tier 2: any value (not just errors) can answer "why am I this?" via an on-demand
backward walk with no exhaustive storage.
