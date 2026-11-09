# docs/archive — finalized & inactive docs

**Nothing LIVE lives here.** If a section is still the reference for current work —
routed from the code→spec table, or the standing evidence behind code that ships — it
belongs in the working set, and the finished record stays behind. Split the doc rather
than parking a live section in a finished one: an agent is told archive is done, so a
live pointer into it is a pointer that gets skipped (`docsPointers.test.ts` fails the
routing table on any `archive/` target).

Docs that have **done their job** — point-in-time research, resolved scoping, shipped
specs, and forward proposals not picked up. Kept out of the top-level `docs/` so the living
docs (architecture, subsystem-invariants, dev-notes, backlog, the per-subsystem references)
stay the working set. Several once-here docs were **deleted** in the 2026-07-21 cleanup
(perf-research, roadmap, strategy-threads, v1.0-audit, verb-nodes-spec, visual-design), and the
2026-11-06 pre-1.6 cleanup deleted every finished record nothing live cited (the shipped plans
and release views, the renderer and performance records, the parity audits, the built v2.0
bundles 17 to 19 and 05); **git history has them.** Several kept ones were **condensed** to their
load-bearing core; the full originals are likewise in git history.

### Kept
- [`future-directions.md`](future-directions.md) — the architecture bets with the author's IN / OUT / PARKED verdicts.
- [`cube-node-scope.md`](cube-node-scope.md) — *archived 2026-08-07, shipped.* The Cube model + node set rationale; live summary in `../node-coverage.md`, deferred slices in `../deferrals.md`.
- [`reference-packs.md`](reference-packs.md) — the reference-pack licensing decision + candidate pack menu.
- [`1.4-plan.md`](1.4-plan.md) — the 1.4 workbench release plan (shipped 2026-09-16); the rubric and the HOLD/deferred item specs that `../deferrals.md` still cites.
- [`scope-features.md`](scope-features.md) — the 63-item verdict index (so every `scope-features #NN` citation resolves) + the full #23 (persistent compute cache) & #35 (MCP port) sketches + the Alteryx teardown.
- [`timesavers-pack-proposal.md`](timesavers-pack-proposal.md) — the [F]/[C]/[M] build-shape taxonomy, the don't-duplicate ledger, and the still-unbuilt remainder.
- [`v1.1-plan.md`](v1.1-plan.md) — the B1 pack-distribution + dependency-system remainder (backlog cites "B1 remainder").
- [`16-widget-nodes.md`](16-widget-nodes.md) — *archived 2026-11-06.* The everyday widget-node bundle (Weather, Geocode, FX, Holidays, TZ, QR); Tier 1 shipped in 1.4, the Tier 2 leftovers are a `../backlog.md` line.
- [`grid-system.md`](grid-system.md) — *archived 2026-11-06.* The unbuilt soft-grid design spec, parked in `../deferrals.md`.
- [`rust-gpu-ui-findings.md`](rust-gpu-ui-findings.md) — *archived 2026-11-06.* The 2026-10 survey of Rust GPU UI libraries against React Flow and the DOM cards, and the spike that would decide it (its images stay in `../assets/rust-gpu-ui/`).

### Dev-notes history
- [`dev-notes-history.md`](dev-notes-history.md) — the swept session log (everything through 2026-08-04a + the old reference sections). The live `../dev-notes.md` holds open problems + the latest session window only.
