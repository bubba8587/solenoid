# Bundle 06 — Execution substrate: sketch mode, calc-mode integration, engine scale

**Source:** scope-features #24 (IN), backlog's "engine execution contract" design-session
note (Bet 1 × #23 × #24 × calc mode), `v1.1-plan.md` WS-E. **Depends on:** bundle 03
(compile/fuse) — sketch mode and the CSV reader both ride the fused engine.

## #24 — Approximate-first: preview on a sample, exact on demand (IN)

**What exists:** two calc modes today (manual/automatic, `calcModeStore.ts`), the F9
ritual, a dirty chip in the StatusBar, and `__totalRows` badge plumbing on frame values.

**Build:**
1. Add a third calc mode: **sketch mode**. While editing, verbs run on a deterministic
   sample (e.g. 10k rows) via the `FrameBackend` seam; results render with an
   "≈ approximate" badge.
2. F9 (already "compute for real") runs exact regardless of mode — reuse, don't fork,
   the existing F9 path.
3. **Required UI affordance (author's explicit condition):** the sketch-mode on/off
   state and the "≈" signal need a persistent home in the **footer** (StatusBar), same
   location as the existing "Calculate" dirty chip — not just a per-value badge. This
   was the one condition attached to the VERDICT; don't ship without it.
4. Aggregates (COUNT/SUM/etc.) must scale up from the sample **visibly** (`≈ 1.2M`),
   never silently presenting a sample-sized number as if it were the real one.

## #23 — Persistent compute cache — DEFERRED, not built here

The author deferred this item; it is NOT part of this bundle's build scope. A sketch
already exists if it's revisited (hash-keyed disk cache on node config + input values,
verb tier only, desktop-only, advisory — delete it and everything still computes). Flag
to the author for a fresh IN/OUT before touching it; don't build speculatively.

## WS-E — Engine scale niceties (from `v1.1-plan.md`, folded in here)

- **Lazy-plan fusion** — this is bundle 03's own deliverable; don't build it twice, just
  confirm 03 closed it before treating WS-E's mention of it as outstanding.
- **Direct CSV→Polars reader** — skip the JS CSV parse for desktop imports, read straight
  into Polars. Independent of sketch mode; can build in parallel once bundle 03's fused
  engine exists (the reader should feed the same lazy plan, not force an eager collect).
- **Formula engine re-audit + native-math deletion** — the audit itself is DONE
  (`formulajs-vs-native-audit.md`, `FAMILY_BACKING` verdicts in `excelFunctions.ts:85-98`).
  What's outstanding is the coordinated deletion: route the `formulajs`-backed families'
  nodes through the seam and remove the redundant hand-rolled math
  (`excelFunctions.ts:26-29` already flags this). Pure hygiene, no correctness change —
  safe to do any time, doesn't block on anything else in this bundle.

## Exit criteria

Sketch mode exists as a third calc mode with the footer affordance shipped (not optional);
F9 still forces exact; aggregate badges scale visibly under sampling; the direct CSV→Polars
reader lands; the formulajs-backed native-math duplication is deleted. #23 stays untouched
pending a fresh author verdict.
