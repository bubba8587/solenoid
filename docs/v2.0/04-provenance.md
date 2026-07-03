# Bundle 04 — Provenance: "why is this value what it is?" (Bet 4)

**Source:** `future-directions.md` Bet 4. **Verdict:** IN, two tiers. **Depends on:**
nothing for tier 1; tier 2's frame-cell walk is sharper once bundle 03's fused plan
exists (a plan is a cleaner thing to walk backward than an eager step sequence), but
doesn't hard-block. **Feeds:** bundle 11 (Problems panel entries gain "…caused by",
Reconcile's within-model change explanation), bundle 13 if report/comment features ever
want a "why" link, and — if #6/#56/#32-adjacent items ever come back — their "why did
this change" stories.

## Tier 1 — errors carry origin at mint (do first, cheap)

**What exists:** errors are already tagged (`SolError`, `errorValue.ts`) and flow
through the graph via `installErrorGuards` wrapping every `data()`. What's missing is
*where it came from* — a `#DIV/0!` in a 50,000-row table doesn't say which row, which
upstream node, which input caused it.

**Build:**
1. Extend `SolError` (or its construction site) with an optional origin tag: node id/name
   (once bundle 01 lands, the stable name), input slot, and — for frame cells — row index.
2. Populate it at the point errors are minted (the guards already wrap every `data()` —
   this is the natural interception point, add it there rather than scattered per-node).
3. Surface it in the value popup (the existing error-display branch in popups) as
   "…caused by [origin]", clickable to jump to that node (reuse `flyToNode.ts`).

This tier is cheap because errors are rare — no perf concern, no new storage model.

## Tier 2 — on-demand derivation walk (any value, not just errors)

**What exists:** none — no derivation walk exists for non-error values today.

**Build:**
1. A "why am I this?" query: given a value's location (a node's output, or a frame
   cell), walk backward through the verb chain / node graph reconstructing the chain of
   inputs that produced it.
2. **Never store this exhaustively** — reconstruct per-query. Frame cells in particular
   must walk the verb chain backward on demand (the same lazy-plan structure bundle 03
   introduces is a natural backward-walk target — a `LazyFrame` plan already encodes its
   own lineage).
3. UI: a right-click "why is this?" action on any value box or frame cell, rendering the
   walked chain (reuse the existing provenance-popup pattern from tier 1, generalized).
4. Combined with bundle 01's stable names, a derivation can be *shared* as text ("the
   discrepancy is right here: `orders.qty` × `fx.rate`, node `FX_Adjust`").

## Exit criteria

Tier 1: every `SolError` carries origin (node/input/row where applicable), shown in the
value popup with a jump-to-node action. Tier 2: any value (not just errors) can answer
"why am I this?" via an on-demand backward walk, with no exhaustive storage — verified by
spot-checking a frame chain (Filter→Join→Group By) and a scalar chain (Expression a→b→c).
