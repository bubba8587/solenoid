# Bundle 07 — Headless Solenoid, file sinks, live-data refresh

**Source:** scope-features #10 (IN), #9 (IN, very limited), #3 (IN, tiers 1-2). These
three were explicitly named as one arc by the author's own doc: "in → through → out →
unattended." Build together. **Depends on:** the CLI spike needs nothing; the polished
CLI (`--set` by stable name, typed args) rides bundles 01/02 but isn't blocking a first
version.

## #10 — Headless Solenoid (IN)

**Why it's cheap:** the compute core is already UI-independent — pure `data()` methods,
a headless-tested engine (the perf suite runs graphs in vitest with no DOM already), and
the Rust engine is a plain library. The web/desktop split already forced the JS-fallback
discipline this needs.

**Build:**
1. `scripts/run-graph.ts` — load a saved graph in Node, run the engine, print named
   outputs as JSON. The vitest seed-tests are most of this already; treat it as
   *extracting* a feature, not building one from scratch.
2. Desktop-only (Polars-backed) nodes need the JS fallback path in Node — it already
   exists because the web build needed it; confirm it's reachable from this entry point.
3. Polish pass (can trail behind the spike): a real CLI — `solenoid run model.sol --set
   rate=0.05 --out results.json` — `--set` by stable name (bundle 01), typed args
   (bundle 02). Writes only where explicitly told (`--out`), same explicit-command
   discipline as the sink nodes below.

## #9 — The write side, tier 1 only (IN, KEEP VERY LIMITED)

**Explicit scope limit (author's condition):** file writes ONLY. Write-back-to-source is
OUT (revisit only if a real database source ever lands via Bet 5). The "act" tier
(webhooks/notify beyond the existing in-app Alert HUD) is OUT.

**Build:**
1. A "Write CSV/JSON" sink node — terminal node, fires ONLY on explicit command (a Run
   button on the node, never during normal recompute). Reuses the existing Tauri fs
   plumbing already shipped for other file nodes.
2. Preview-what-will-be-written pane before it fires — the pure-DAG-means-dry-run-is-free
   property is the actual safety mechanism here, not a warning dialog.
3. **Disabled by default in imported/shared graphs** — a sink node from someone else's
   graph shouldn't fire on your machine without you re-enabling it explicitly.

## #3 — Live data, tiers 1-2 only (IN)

**Explicit scope limit:** tier 3 (always-on background daemon watching) is NOT taken —
this scopes to in-app scheduling, not background execution. The database-table source
stays a separate later slice (Bet 5's "point desktop at a real DB" form, not committed).

**Build:**
1. Tier 1 — manual "Refresh" on source nodes: re-pull + recompute, no scheduler.
   File/API source flavors need nothing new to support this.
2. Tier 2 — interval refresh while the app is open (a timer that triggers the same
   refresh path as tier 1). This is the whole design-session scope named in the backlog
   ("#9 sinks + #3 scheduling") — in-app interval only, no background/daemon surface.
3. Pair with the existing Alert node (already shipped, edge-detects on status) — no new
   alert machinery needed, just confirm refresh-triggered recompute still fires alerts
   correctly.

## Exit criteria

`scripts/run-graph.ts` runs a saved graph headlessly and prints outputs; a Write CSV/JSON
sink node fires only on explicit trigger, previews before writing, and ships disabled by
default in imported graphs; source nodes support manual refresh and an optional interval,
with the existing Alert system firing correctly off a refresh-triggered recompute.
