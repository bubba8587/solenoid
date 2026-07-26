# docs/archive — finalized & inactive docs

Docs that have **done their job** — point-in-time research, resolved scoping, shipped
specs, and forward proposals not picked up. Kept out of the top-level `docs/` so the living
docs (architecture, subsystem-invariants, dev-notes, backlog, the per-subsystem references)
stay the working set. Several once-here docs were **deleted** in the 2026-07-21 cleanup
(perf-research, roadmap, strategy-threads, v1.0-audit, verb-nodes-spec, visual-design) — they
were fully superseded; **git history has them.** Several others were **condensed** to their
load-bearing core (noted below); the full originals are likewise in git history.

### Anti-relapse records — decisions + eliminations, so work doesn't relapse
- [`performance-hardening.md`](performance-hardening.md) — *condensed.* The final dense-graph zoom verdict (it's at the DOM-compositing floor) + the "DO NOT re-attempt" reverted-experiment list + external corroboration.
- [`renderer-decision.md`](renderer-decision.md) — *condensed.* The HTML-in-Canvas decision + diagnosis (mipmap-once-at-1.5×, headless Rete). The PixiJS-adoption pitch is dropped — the pixi renderer is deprecated (author 2026-07-19).
- [`renderer-plan.md`](renderer-plan.md) — *condensed.* The renderer feature-gate safety rule (implemented in `src/main.tsx`), the Linux WebKitGTK hazard, and the Tauri-vs-Electron decision.
- [`future-directions.md`](future-directions.md) — *kept.* The architecture bets with the author's IN / OUT / PARKED verdicts.
- [`type-resolution-consolidation.md`](type-resolution-consolidation.md) — *complete 2026-07-25.* The audit + five work items that made ADOPTION the single type resolver (the display walk is deleted, `noWidenInputs` and the adopted-vs-base coercion exception are gone, the `anycombo` rung closed the ladder). Read before reworking `trueAnyAdopt` / `coerceInputs` / `displayedType` — it records what was removed and why, including a before-picture of the five overlapping graph walks.
- [`node-arity-audit.md`](node-arity-audit.md) — *condensed.* The labeled-slots-vs-list-socket KEEP verdicts (rule also lives in `node-coverage.md`).

### Still-consumed reference — kept whole; cited by live code / docs
- [`excel-pain-points.md`](excel-pain-points.md) — the Excel pain-point / function-gap research that seeded the parity work.
- [`formulajs-vs-native-audit.md`](formulajs-vs-native-audit.md) — the per-family formula.js-vs-native verdicts cited by `excelFunctions.ts`.
- [`reference-packs.md`](reference-packs.md) — the reference-pack licensing decision + candidate pack menu.
- [`compute-architecture.md`](compute-architecture.md) — the browser-thin / desktop-native compute rationale (shipped as the JS oracle + native Polars behind the `FrameBackend` seam).

### Condensed rationale — design records trimmed to the load-bearing part
- [`cable-routing.md`](cable-routing.md) — the React-Flow-era cable spec; the still-open collision-avoidance spec (§2) is the live remnant.
- [`io-visual-control-node-proposal.md`](io-visual-control-node-proposal.md) — the custom-widget / input-visual-control pack rule.
- [`isolate-pin-multiview-scoping.md`](isolate-pin-multiview-scoping.md) — the unbuilt split-screen / multi-window / Portals scoping (§1–2 built).
- [`release-notes-1.1.md`](release-notes-1.1.md) — the reusable release-notes **bar** (a sell vs a changelog; slide vs body); `../release-notes-features.md` points here.
- [`scope-features.md`](scope-features.md) — the 63-item verdict index (so every `scope-features #NN` citation resolves) + the full #23 (persistent compute cache) & #35 (MCP port) sketches + the Alteryx teardown.
- [`timesavers-pack-proposal.md`](timesavers-pack-proposal.md) — the [F]/[C]/[M] build-shape taxonomy, the don't-duplicate ledger, and the still-unbuilt remainder.
- [`v1.0-plan.md`](v1.0-plan.md) — WS2's `FrameBackend` interface rationale (JsFrameBackend oracle vs PolarsBackend desktop); cited as "v1.0-plan.md WS2".
- [`v1.1-plan.md`](v1.1-plan.md) — the B1 pack-distribution + dependency-system remainder (backlog cites "B1 remainder").

### Shipped plans — the feature is built; kept as the design record
- [`units-format-controller.md`](units-format-controller.md) — the shipped A4 units-by-dimensionality plan (the FC flagship; live truth is `formatModel.ts` + subsystem-invariants "Unit flow" + D20).
- [`1.2-plan.md`](1.2-plan.md) — the executed 1.2 build queue (author-run release tail tracked in `../backlog.md`).
- [`release-plan-1.1.md`](release-plan-1.1.md) — the shipped 1.1 release view, kept for the cut-process shape (readiness / checklist / decision structure).

### Dev-notes history
- [`dev-notes-history.md`](dev-notes-history.md) — the swept session log (everything through 2026-07-19 + the old reference sections). The live `../dev-notes.md` holds open problems + the latest session window only.
