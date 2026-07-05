# docs/archive — finalized & inactive docs

Docs that are **done their job** — point-in-time research, external reviews,
resolved scoping, shipped specs, forward proposals not picked up, and the older
dev-notes history. Kept for reference (git keeps them anyway) but moved out of the
top-level `docs/` so the living docs (architecture, subsystem-invariants,
dev-notes, backlog, the per-subsystem references) stay the working set. Organized
by topic:

### Research & landscape
- [`node-graph-ux-research.md`](node-graph-ux-research.md) — UX synthesis across node editors (Blender, Houdini, …).
- [`competitive-landscape.md`](competitive-landscape.md) — why no existing tool fits the niche.

### Reviews
- [`outside-review-2026-06-12.md`](outside-review-2026-06-12.md) — dated external review (its actionable items were triaged; see dev-notes history "Outside-review triage").

### Performance
- [`perf-research.md`](perf-research.md) — the perf optimization research handoff + the merged perf-testing notes.

### Design
- [`visual-design.md`](visual-design.md) — early color/surface/accent decisions.

### Resolved scoping
- [`formula-engine-array-semantics.md`](formula-engine-array-semantics.md) — the formula-engine array/error scoping. P1/P2/P5 + the lambda-core unification shipped 2026-06-21 (see `dev-notes.md` "one array-aware evaluation core"); kept as the design record. Still-open policy calls (P3 ragged / P6 operator parity / P7 boolean) are tracked in `backlog.md`.

### Shipped specs (design records, the feature is built)
- [`verb-nodes-spec.md`](verb-nodes-spec.md) — the WS3 relational verb-node spec; every node built + merged onto `working` (2026-06-30).

### Forward proposals (not built; revisit only if the feature is picked up)
- [`io-visual-control-node-proposal.md`](io-visual-control-node-proposal.md) — proposed input/output/visual control nodes.
- [`timesavers-pack-proposal.md`](timesavers-pack-proposal.md) — an Excel-timesavers node pack.
- [`reference-packs.md`](reference-packs.md) — candidate reference node packs.

### Resolved audits
- [`formulajs-vs-native-audit.md`](formulajs-vs-native-audit.md) — formula.js vs native-math coverage audit.
- [`null-logical-verification.md`](null-logical-verification.md) — null / logical 3-valued behavior verification (the model shipped).

### Renderer decision journey
- [`renderer-decision.md`](renderer-decision.md) / [`renderer-plan.md`](renderer-plan.md) — the path to the current renderer. Live answer: HTML-in-canvas (the `html` render mode); its invariants live in `htmlCanvasRenderer.ts` / `HtmlCanvasLayer.tsx` comments + `dev-notes.md`. The WGSL/Pixi plan here is parked.

### Strategy
- [`roadmap.md`](roadmap.md) — the phase-level strategy view; superseded at 1.0.
- [`future-directions.md`](future-directions.md) / [`scope-features.md`](scope-features.md) — the architecture bets + the 63-item feature walk (all verdicts inline; walked to completion 2026-07-03; the IN items became the `docs/v2.0/` bundle set).
- [`strategy-threads.md`](strategy-threads.md) — DISCARDED IN FULL by the author 2026-07-03 ("barely right"); point-in-time record. (The standing rejections live on in `docs/out-of-scope.md`, which stays in the working set.)

### Shipped plans & audits (moved 2026-07-05)
- [`v1.0-plan.md`](v1.0-plan.md) — the 1.0 execution plan; shipped.
- [`v1.0-audit.md`](v1.0-audit.md) — the adversarial 1.0 audit; fix pass landed 2026-07-02, remainder triaged into the backlog.
- [`performance-hardening.md`](performance-hardening.md) — the perf investigation + the final renderer verdict (HTML-in-canvas won; WGSL/Pixi parked).
- [`isolate-pin-multiview-scoping.md`](isolate-pin-multiview-scoping.md) — isolate/pin/multiview scoping; §1–2 built, portals scoping parked here.
- [`node-arity-audit.md`](node-arity-audit.md) — the variadic-node audit + the labeled-slots-vs-list-socket rule (rule also lives in node-coverage.md).

### Dev-notes history
- [`dev-notes-history.md`](dev-notes-history.md) — the dev-notes per-item history (three sweeps: through 06-18, 06-19–06-30, and the 07-01–07-05 per-item entries), plus the old reference sections (node-authoring kit, socket types, roadmap stance, technical gotchas, old TODOs). The live `docs/dev-notes.md` holds session digests + open problems only.
