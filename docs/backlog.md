# Solenoid — Backlog

**OPEN items only, kept terse.** When an item lands, DELETE its line — git history and
the dev-notes digests are the record; this file is the working queue, not a ledger.
Ruled-out ideas live in `out-of-scope.md`; settled rationale in `decisions.md`.

---

## Release tail (author-run)

- [ ] **Cut 1.2**: version is 1.2.0 on `develop`, tag not yet cut (latest tag v1.1.5).
  Author performs: desktop-gated checks (cargo on Windows, path-stripped
  `release:desktop` build, exe smoke), merge → `main`, tag `v1.2.0`.
- [ ] **Keep `release-notes-features.md` current** — the curated selling list + What's-New
  slide source (author writes the final release notes).

## Needs an author decision / author-present session

- [ ] **Everyday widget nodes (v2.0 bundle 16)** — Weather / Geocode / FX / Holidays /
  TZ Convert / QR. Build is autonomous-friendly on the connection pattern, but 4 gate
  calls come first: `v2.0/16-widget-nodes.md`.
- [ ] **iFrame / embed node [1.3]** — general web-embed out the `chart` socket (FRED,
  YouTube, social). Blocked on the author's CSP-posture call: Tauri CSP has no
  `frame-src` today, so external iframes are blocked; the call is `https:` (broad) vs a
  domain allowlist. Non-negotiables when built: `sandbox` without allow-top-navigation,
  `referrerpolicy=no-referrer`, https-only, click-to-load (saved URLs are untrusted;
  also the perf lever — each iframe is a full browser context, so don't render
  off-screen and cap concurrency). Most sites send X-Frame-Options: DENY — this serves
  embed-friendly content, not arbitrary pages.
- [ ] **Parity Tier 4 — the formula dimensionality cap (D2, reopened)** — not decidable
  until the registry unification (Tier 1 of the parity program) is done. Criteria fixed
  by the author: correctness + coherence only (the identity/auditability objection is
  RETIRED — don't re-litigate). When it returns, bring a shape-branding design for the
  type-agnostic evaluator + a machine-checked Excel-DA broadcast-rules table; endpoints
  are "never" vs "matrices-only, full DA semantics" (frames-in-formulas rejected).
  Full record: `formula-node-parity.md` "Tier 4 in full".
- [ ] **Composite drill-in — remaining gaps**: (a) Group/Cleanup/Autofit/Expand inside a
  drill-in (needs the group-drag reconcile pipe + push/standoffs/GroupNode taught the
  active area — a real DOM-verified lift, folded until then); (b) Navigator + lasso
  (folded/hidden while drilled in); (c) **D2 proper** — reroute the real top toolbar /
  mobile bar to the active subgraph (author-present, wants live eyeballing).
- [ ] **D4 — conditional formatting for tables** — needs its own design pass: must clear
  Excel's version by a lot (author's explicit dislike), Display-node-only, must not
  step on FC format/units territory.
- [ ] **FC A4 tails** (author-present polish): per-element mixed-unit trig (a list
  mixing deg/rad cells should interpret EACH cell in its own unit —
  `resolveTrigModes` still reads one socket-level unit); Cube popup FC controls
  (frames/matrices/lists have the per-column format+unit row in `TablePopup` via
  `fcControls.tsx`; cubes wait on nothing now that `CubeColumn` is typed).
- [ ] **Document-level FC defaults** (default places / number format; the Document
  Properties window ships without them) — a format-pipeline integration, author-present.
- [ ] **Header/body border seam under zoom — UNSOLVED, parked** for a human/later model.
  See dev-notes "UNSOLVED" for constraints + the two eliminated approaches.
- [ ] **Traveling-cable flow pulse → maybe the app's cables** (author likes the landing
  page's marching-dash cable rendering, `LandingScenes.tsx` `.sol-cable__flow`).
  Author-gated: touches the never-degrade-cables rule and DESIGN.md's no-decoration
  stance — this would make the pulse MEANING, not decoration.
- [ ] **Feature/value copy doc** for landing/marketing — author will initiate; ranked
  candidate copy lines per feature, author ranks value.

## Decided, unbuilt (mechanical)

- [ ] **Formula ↔ node parity program (D19, greenlit — build in a dedicated session)** —
  converge the formula language and the node set; audit + tiers + decisions in
  `formula-node-parity.md` (numbers regenerable via `scripts/formula-node-parity.ts`).
  Build order: ratchet test first (pin the 57 + the blocklist), then Tier 1
  registrations, alias gate, pack seam. Legacy aliases BLOCKED (`#NAME?` + redirect
  hint); Solenoid-native formula names = the node hover hint despaced; packs register
  their own formula functions. Tier 4 is separate (author-present, above). Residual:
  distributions are validated only at representative points — widen if accuracy is
  ever in doubt.
- [ ] **Computed Column (table-timesaver Tier 3, design-first)** — row-wise formula whose
  variables are column names, appended in place (PQ Custom Column); wants a design pass
  on sharing the Expression engine.
- [ ] **Rigorous multi-column input-socket label syntax** — one consistent grammar for
  what columns a frame/2-D input expects (today: Sankey "From+To+Value" vs charts
  "series (2-D)"). Every frame-consuming node reuses it, per the aligned-columns rule
  (one frame input, not parallel sockets — charts + SUMIFS + the frame verbs).
- [ ] **Reference overlay — Socket tab → full data-model chapter** — grow the socket tab
  into a real explanation of types, units, dimensionality (the lattice, wildcard
  ladder, list-is-a-row, per-container unit granularity). Sources: `sockets.ts` +
  `socketConnect.test.ts`, D17/D20, `v2.0/05-units-format-controller.md`.
- [ ] **Data Feed widening [1.3]** — a richer series/symbol picker (today a text field +
  quick-picks), more providers. Scope: `release-plan.md` §3a.
- [ ] **Seed follow-ups**: personal-finance is generator-locked (structure via
  `gen-personal-finance-seed.cjs`; geometry owned by the tuned JSON —
  `scripts/tune-seeds.mjs`); composite-workbench still has no scenarios/data-table card.
- [ ] **Aliasing / hidden-port promotion UI** (composites) — the data model has
  `hidden`/`advanced` per port; no UI to flip exposure or edit a hidden port's baked
  default. Includes the pack-shell "many internal ports → one shell parameter" aliasing.
- [ ] **Native Polars mirrors for the eager cleanup verbs** (perf follow-up, only if a
  real workload demands): fillBlanks / replaceValues / sliceRows are trivially lazy;
  today they materialize like Split Column.
- [ ] **Obsidian follow-ups (if wanted)**: auto-reload an imported note on file change;
  write config for `![[Note]]` transclusion vs inlining an embedded note's body.

## Small calls / polish

- [ ] **Expression `/` doesn't mint a pure ratio** — the Divide NODE mints `5:1` on a
  same-dimension cancel; Expression strips UnitCells at its boundary, so `a/b` yields a
  bare number. Decide: leave (Expression is deliberately type-agnostic — likely fine)
  or make Expression unit-aware someday.
- [ ] **XLOOKUP `rawInputs` bypass retirement (optional cleanup)** — with typed
  frame→cube, the bypass is no longer needed to preserve types; the frame + cube lookup
  paths could collapse to one. Behaviour-touching refactor of a covered node; only if
  it pulls weight.
- [ ] **MMULT dimension algebra** — only if a dimensioned-linear-algebra use case ever
  appears; documented-strip is the deliberate stance (D20).
- [ ] **Error UX on restriction violation** — typed error out the socket vs the node
  flagging the offending input locally. Pending a call.
- [ ] **Provenance Tier 2 — on-demand "why is this?" walk** — a backward-derivation
  trace for any value (Tier 1, error origin + fly-to-source, shipped in
  `errorValue.ts`). Never built; idea salvaged from the archived provenance bundle.
- [ ] **Inside-solve stale dot is uniform** — after an INSIDE Solve the dot reads green
  though the held result is seed-based; distinguishing needs a drill-state signal in
  the compute layer (couples `data()` to `compositeEditorStore`). Left simple on
  purpose; revisit only if it reads as misleading.
- [ ] **Pack variant-switch reconciles the socket set** — a variant dropdown must
  add/remove sockets like Cast/read-as do. (The existing custom nodes all keep fixed
  sockets across their dropdowns, deliberately — nothing waits on this.)
- [ ] **Optically center the last asymmetric icons** — canvas-lock toggle (reads low) +
  the cable-flourish sparkle; author's eye needed. Ink-centroid method: archived
  dev-notes (2026-06-20).
- [ ] **Pinch-zoom on a real Mac trackpad** — should work via `e.ctrlKey` pinch wheel
  events; verify on hardware, intercept manually if not.
- [ ] **#7 Conduits sometimes unselectable/unmovable except via the Navigator** —
  intermittent, no repro; suspected z-order / hit-area or membership-sync issue tied to
  group membership.

## Packs

- [ ] **Materials & Mechanical pack** — next domain candidate; the INTERPOLATE gate is
  cleared (List + Grid modes shipped). Only the domain content (datasets + presets)
  remains. See `pack-composite-plans.md`.
- [ ] **Timesavers remainder**: date idioms carrying a config or judgment call (Fiscal
  Quarter start-month, Age/Tenure with DATEDIF `"MD"` nuance, Nth Weekday), the
  duration trio (wants an elapsed-`[h]:mm` format first), Split Name (multi-output),
  and the list-reducer batch (Conditional Aggregate AND/OR, Multi-Criteria Lookup,
  Last/First Non-Blank, Rank-in-Group…).
- [ ] **Composite pack-node shape** — packs can't ship subgraphs yet; the queued
  composite pack nodes (Wheatstone, pump operating point, psychrometric state point,
  Pareto, % of Total…) are planned in `pack-composite-plans.md`.
- [ ] **Pack distribution + dependency system** — third-party pack DISTRIBUTION; must
  land in tandem with subgraphs. (In-app `dependsOn` auto-activation already works —
  Electromagnetism → Electricity is the live example.)

## Desktop shell

- [ ] **Window min/max/close controls missing** — `tauri-plugin-decorum`'s
  `create_overlay_titlebar()` isn't rendering the controls. Ruled out: the accent
  border. Needs a live devtools look (F12 — CSP/decorum errors?) or a decorum/tauri
  version check. Fallback: drop the overlay for native OS decorations. Worked before;
  regression cause unknown.

## Perf levers (only when a real workload demands)

- [ ] **Figure rasterize-at-rest (recharts + KaTeX)** — the last real DOM lever; the
  remaining big subtrees are figure CONTENT (~200–400 el/chart, ~70/formula). SvgPicker
  precedent: raster at rest, live tree on hover; KaTeX needs re-raster-on-zoom for
  crispness. Quality gate: pixel-crisp at any zoom, hover indistinguishable. Per-card
  complexity is real (theme invalidation, fonts-ready, blob lifecycle).
- [ ] **#23 persistent compute cache** · **#35 MCP port** — deferred, unscheduled.

## Parked (revisit only if the trigger returns)

- [ ] **UI-scale toggle (Default / Larger)** — subsumes all per-panel resize asks; don't
  build per-panel resize.
- [ ] **Uncertain values + money mode** — in, but sequenced dead last; each needs an
  author representation call first. Design context: `v2.0/12-value-model-extensions.md`.
- [ ] **Cable collision avoidance** — spec: `archive/cable-routing.md` §2.
- [ ] **Grid system** — spec: `grid-system.md`.
- [ ] **WebGPU/wgpu renderer + LOD swap** — superseded by HTML-in-Canvas as the
  zoom-at-scale lever; reopen only if `drawElementImage` never reaches stable or a
  native-GPU need appears. Records: `archive/renderer-plan.md`,
  `archive/performance-hardening.md`.
- [ ] **`content-visibility: auto` on node roots — ruled out** while socket positions are
  measured from live DOM geometry (off-screen subtrees don't compute descendant layout
  → cable endpoints jump at the viewport edge). With SVG-picker-rasterize +
  collapsed-figure-unmount shipped, the DOM-weight lever set is exhausted — the GPU
  renderer is the remaining path at scale.
