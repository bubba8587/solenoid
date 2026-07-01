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
- [`roadmap.md`](roadmap.md) — the phase-level strategy view; superseded at 1.0 by `v1.0-plan.md` (what's left) + `backlog.md`.

### Dev-notes history
- [`dev-notes-history.md`](dev-notes-history.md) — dev-notes entries from 2026-06-18 and earlier, plus the old reference sections (node-authoring kit, socket types, roadmap stance, technical gotchas, old TODOs). Current notes are in `docs/dev-notes.md`.
