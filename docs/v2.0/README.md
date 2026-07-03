# Solenoid 2.0 — implementation plan set

This is the "nothing left to question" plan-doc set the backlog's feature-walk was
building toward (`docs/backlog.md` "2.0 FEATURE-WALK BOOKMARK"). Every item here was
walked individually with the author across `docs/future-directions.md` (4 architecture
bets) and `docs/scope-features.md` (63 scope items, 9 rounds), plus the already-approved
`docs/v1.1-plan.md` workstreams. This doc set reorganizes everything the author said **IN**
into build-ready bundles, sequenced by real dependency, sized to hand to one agent/session
each. Items the author left **DEFERRED** are NOT planned here — seeVverdict pending" below.

**How to use this set:** each numbered doc is one bundle. Read its "Depends on" line before
starting — bundles in Tier 0 gate almost everything else. Within a tier, bundles are
independent and can run in parallel (different agents, different sessions). Each bundle
states what exists today (grounded in code), the build steps in order, and its exit
criteria. Where a bundle still needs a real author decision before code starts, that's
flagged inline as **NEEDS AUTHOR INPUT** — don't guess past those.

Pre-alpha rules still apply throughout: break old saves/formats freely, no back-compat
shims, no migration layers (see CLAUDE.md). `tsc` + `vitest` green after every step;
UI changes get eyeballed by the author on the running dev server, never puppeteer'd.

---

## Tier 0 — Foundations (build first; nearly everything downstream leans on these)

| Bundle | What | Depends on |
|---|---|---|
| [01](01-addressable-model.md) | Bet 2 — clean addressable model + text projection | nothing |
| [02](02-shape-checking.md) | Bet 3 — static shape-checking pass | nothing |
| [03](03-compile-fuse.md) | Bet 1 — compile/fuse execution (relational + scalar) | nothing |
| [04](04-provenance.md) | Bet 4 — provenance / "why is this value what it is" | nothing (tier 1 ); frame-walk cousin wants 03 |
| [05](05-units-format-controller.md) | FC function model → units-by-dimensionality (the flagship) | nothing structurally, but do FIRST of the UI-heavy work |

These five are independent OF EACH OTHER (no bundle requires another in this tier to
start), but a large fraction of Tier 1+ bundles need one or more of them. Bet 2 (01) has
the widest fan-out — put it first if only one can be staffed at a time.

## Tier 1 — Substrate that rides the foundations

| Bundle | What | Depends on |
|---|---|---|
| [06](06-execution-substrate.md) | Sketch-mode approximate calc, calc-mode integration, lazy-plan fusion follow-through, direct CSV→Polars, formula-engine cleanup | 03 |
| [07](07-headless-write-live.md) | Headless/CLI runner, file-sink nodes, live-data refresh (tiers 1-2) | 01 (CLI `--set` by name), 02 (typed CLI args) partially — see doc for what needs nothing |
| [08](08-excel-transpiler.md) | The Excel `.xlsx` → graph transpiler | 02 (range→frame typing) |

## Tier 2 — Subgraph container and its riders

| Bundle | What | Depends on |
|---|---|---|
| [09](09-subgraph-composite-container.md) | Document-local composite/subgraph container + the five run-mode hooks (simulation, scenarios, goal-seek, Monte Carlo, data tables) | 02 (typed boundary) |
| [10](10-decision-model-sensitivity.md) | Decision Matrix sensitivity ("wiggle the weights") | 09 (Monte Carlo hook) |

## Tier 3 — Trust & data-quality nodes (mostly independent; parallelize freely)

| Bundle | What | Depends on |
|---|---|---|
| [11](11-trust-quality-nodes.md) | Expectation nodes, Problems panel, where-used highlight, Reconcile node, model fuzzing, Tornado node, node-anchored comments | 04 sharpens several of these but none hard-block |

## Tier 4 — Value-model extensions (independent; different files each)

| Bundle | What | Depends on |
|---|---|---|
| [12](12-value-model-extensions.md) | As-Of Join/Lookup (build now), uncertain values (very late), money mode (very late) | none for As-Of; 05 helps uncertain/money but doesn't block |

## Tier 5 — Report, presentation, documentation (leans on Bet 2's projection idea)

| Bundle | What | Depends on |
|---|---|---|
| [13](13-report-and-presentation.md) | Report file + inline-ref + object socket family, static HTML export, auto-doc node, Presentation node, branded output colors, Session History node | 01 loosely (stable names sharpen refs), otherwise buildable now |

## Tier 6 — Canvas & interaction polish (independent of everything; parallelize anytime)

| Bundle | What | Depends on |
|---|---|---|
| [14](14-canvas-interaction-polish.md) | Quick-wire, command palette, scrubbing, semantic zoom, conditional formatting (own design pass), align/distribute + batch collapse — plus a pointer to `v1.1-plan.md` WS-C | none |

## Tier 7 — Domain verticals (mostly positioning + a few nodes on existing machinery)

| Bundle | What | Depends on |
|---|---|---|
| [15](15-domain-verticals.md) | Engineering/scientific calc seat, BOM/nested-costing on the Cube, Parquet & Arrow | 05 sharpens the engineering seat; Parquet is standalone |

## Tier 8 — Already fully planned elsewhere (pointers, not new docs)

| Bundle | What | Where |
|---|---|---|
| 16 | Packs & extensibility (dormant-pack distribution/deps, new core nodes, Timesavers ~35 idioms, domain packs) | `v1.1-plan.md` WS-B — build as written |
| 17 | Data integration (Obsidian sync, image bundling, unified XLOOKUP) | `v1.1-plan.md` WS-D — build as written |
| 18 | The 1.0-tail queue (locale, UX/a11y batch, cargo-audit, frame P3s, persistence, broadcaster/null-contract, non-finite guard, and more) | `backlog.md` lines 23-320ish — fully decision-recorded, its own suggested build order already written, ready whenever staffed |

---

## Verdict pending — NOT planned here, needs a fresh author call first

These were **DEFERRED** or **VERY DEFERRED**, not decided IN — don't build against them.
Revisit each with a plain yes/no (or a scoped-down version) before writing a bundle doc:

- **#2 — Publish a graph as a form/API/report.** Author: "there are cons I can't
  articulate." Needs the hesitation named before this gets scoped.
- **#6 — Snapshots + diff.** Author: "I don't know if I like it."
- **#11 — Transform-by-example (Flash Fill that shows its work).** Author wants
  hands-on time with the area first.
- **#23 — Persistent compute cache.** Sketch already exists in `scope-features.md`
  (hash-keyed disk cache, verb tier only, desktop-only) — just needs an IN/OUT.
- **#35 — MCP port.** Overlaps bundle 07's CLI; revisit only if the CLI can't cover
  the live-shared-GUI-session case.
- **#46 — Sealed models (tamper-evident sign-off).** Security-scope-creep concern
  flagged; needs a much lighter "integrity checksum, not cryptographic proof" framing
  if it comes back.
- **#48 / #54 — Library layer / model index (cross-document fleet view).** VERY
  DEFERRED — the OS-level chosen folder is the answer until that genuinely stops
  being enough.
- **Bet 5 — second web engine / desktop-points-at-a-real-database.** Optional,
  standalone; only the "desktop DB source" half was even entertained, and only if
  someone wants it — not committed.

## Also NOT here — ruled OUT, no revisit needed

Named dimensions (#20), model linter (#29), synthetic data (#26), data slots (#27),
formula lens (#28), PDF/OCR intake (#33), guided-seed tutorials (#36), history scrubber
(#42), shared-definitions library (#53), structured templates (#55), commission-engine
vertical (#56), paste-anywhere (#57a), the whole Round-9 trust-machinery cluster (#58–63),
embeddable-rules-engine identity (#18), the NL layer / AI cage (#7, #19), data-drafting
its own graph, golden tests on any node. See `scope-features.md` / `future-directions.md`
for the per-item reasoning if any of these get raised again.

---

## Cross-cutting reminders for every bundle

- **Read `DESIGN.md` before any pixel** — no accent stripes, Quiet Accent Rule, no
  faux-3D. Applies hardest to bundles 05, 13, 14.
- **Prefer a node over a new panel/lens/global-UI layer** when the feature is
  naturally node-shaped (standing principle from the walk). New HUD-style panels
  extend the existing `HudStack` family (`src/graph/components/HudStack.tsx`,
  `PinLayer.tsx`, `AlertLayer.tsx`) rather than becoming a fourth standalone panel.
- **No Captain-Obvious UI strings** — a control's affordance carries its own meaning;
  don't caption it.
- **Pre-alpha, break freely** — no migration shims for save-format or node-type changes.
- **`tsc` + `vitest` green, always; the author eyeballs UI on the running dev server.**
