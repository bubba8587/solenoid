# Autonomous build plan — 2026-07-05 (author-ratified) — ARCHIVED (shipped)

> **STATUS (2026-07-06): DONE except a handful of items now tracked in `../backlog.md`.**
> Verified against code: Tiers A (A-1…A-4), B (B-1…B-4), C-1/C-3 (bar the Gauge-collapse
> sub-item), C-2, C-4, D-1, E-2, F-1, and the F-2 window all SHIPPED. Still OPEN and moved
> to the backlog: **D-2** (simulation inner display), **D-3** (aliasing/hidden-port UI),
> **D-4** (pack variant-switch reconcile), **E-1** (Obsidian vault trio), the **F-2 remainder**
> (per-slot doc palette overrides + document-level FC defaults), and the **Gauge collapse
> preview**. This file is kept for the footprint/sequencing detail on those; the forward-looking
> queue is `../backlog.md` and `../release-plan.md`.


Every item here was individually decided by the author this session (see the
daytime digest). **No design forks remain** — where a judgment call surfaces
mid-build, pick the option consistent with the specs below and note it; don't
stall. NOT in this plan (author-present, later): **A4 units** (`v2.0/05`),
**D2 toolbar reroute**, D4 conditional formatting, the border seam, #21/#43,
grid system, collision avoidance, transpiler.

**Standing rules for every bundle:**
- `tsc` + full `vitest` green per commit; `cargo test` where Rust moves. NEVER push.
- **SEEDS (author 2026-07-05): anything needing visual confirmation ships or
  extends a demo seed** — that's the eyeball vehicle. A seed-cleanup pass happens
  last-minute before the release, so don't polish seeds, just make them exist and
  load clean (the generic `seeds.test.ts` loop must stay green).
- Accumulate "author eyeball" notes in the session digest, not scattered.
- DESIGN.md before any pixel; no Captain-Obvious strings; commit-on-Enter/blur;
  nodes-over-panels; even-sized icons; delete the backlog line when a bundle lands.
- Shared-file policy: one editor per CODE file at a time — each bundle lists its
  footprint; overlaps are called out as sequencing edges.

## Tier A — mechanical (small, parallel-safe)

**A-1 · Locale + tiny persistence** — `en-US` shared constant into every
`toLocaleString` (`formatAnnotationStore.ts` ~5 sites incl. `formatPrecise`/integer;
CubePopup/TablePopup row counts); cable-shape persist (`cableShape.tsx`, sibling
localStorage pattern); grid-dots visibility toggle (Settings row + the canvas
background). Footprint: formatAnnotationStore, cableShape, settingsStore,
Canvas/App css bg. Tests: format tests re-pin (grouping strings now locale-stable).

**A-2 · A11y verify-and-finish batch** — VERIFY each against code first (some
shipped): socket-dot hover `title` naming the type; `prefers-reduced-motion` on the
load reveal; `Ctrl+/` via `e.key`; Group/Note title editors through draft-commit;
modal focus traps; Settings `Switch` accessible name; socket-legend open-state
persistence. Footprint: scattered small UI files — claim per-file on the board.

**A-3 · Library-folder opener** — File-menu action + a Settings-row button that
opens the OS file manager at the chosen docs folder (opener plugin; `openExternal`
pattern in `fileBridge.ts`). Ultra-minimal by decree.

**A-4 · Minimap 3-way position** — `Bottom | Top | Hide` enum replacing
`perfHideMinimap`; Socket Reference slides into freed space (verify the existing
hide path already does this); Top sits below the Zoom pill. Footprint:
settingsStore, Minimap.css/SolenoidMinimap, SocketLegend layout.

## Tier B — Rust / engine (one Rust-capable agent; serialize within-tier)

**B-1 · Frame P3 pair** — (a) Rust oracle key: replace `Cell::key()` + `\u{1}`
joins (distinct + group_by paths in `engine.rs`) with `serde_json` of the SAME
tagged-tuple encoding as JS `encodeCell`; cargo parity test with a `\u{1}` fixture
asserting literal key equality. (b) Infinity first-class: IPC non-finite sentinel
(`{"__nf":"inf"|"-inf"|"nan"}`) BOTH directions; aggregates apply the `guardFinite`
rule in both backends; parity tests. Plus the docs-only ACCEPT note
(source-freeing GC timing) into subsystem-invariants. NOTE: `src-tauri/target/`
was wiped — first cargo run rebuilds (~minutes).

**B-2 · AND/OR multi-predicate Filter** — extensible condition rows
(`PairedExtensibleInputs`) + AND/OR mode on the frame Filter; per-condition
Match-case; JS oracle (`frameVerbs.ts`) + Polars (`apply_step` + `verb_filter`)
parity incl. the text-scan path; catalog + text-form round-trip. AFTER B-1
(same `engine.rs` footprint). Extend a seed (personal-finance or a filter demo)
with an OR case.

**B-3 · Native CSV date inference** — `engine_read_csv` gains date-column
inference matching the JS `inferColumn` ISO gate; parity test vs the JS path.

**B-4 · Engine hygiene** — retire `compileFormula`; TEXT-family divergence sweep
(`numberToText` vs FX TEXT → pin or override in `formulaDivergence.test.ts`);
Group By `total_depth` exposure (engine supports it; surface on the GROUPBY node).

## Tier C — nodes & viz

**C-1 · COMPLETE RECHARTS** (the big one; ships a showcase SEED) — Chart family
covers every recharts type: Pie, Scatter, Bubble, Radar, RadialBar, Funnel,
Composed into the existing Chart op surface where the (series) input shape fits;
**Treemap + Sankey as new nodes** (structured inputs — hierarchy / flow edges);
**Histogram** (binning + bar, bin-count config); **KPI/Stat card** (big number +
label + delta ↑/↓ with color); **Bullet graph**; **date-range picker** (dual date
control node). All behind the lazy `chartRender.tsx` chunk; dataviz rules per
DESIGN.md (palette categorical set, no decorative fills). Report embeds get the
new types for free via ChartValue — verify one in the seed.

**C-2 · Input Switcher upgrade** — editable per-slot titles (draft-commit); a
multi-select mode collecting the selected inputs into a Cube (Cube assembly via
the existing builders). Seed row in the showcase seed.

**C-3 · Popup ⋯ overflow + collapsed previews** — popup header `⋯` menu holding
Export CSV (file save via fileBridge) + Copy as Markdown + the existing Copy-CSV
moved in; Table/Frame/List popups. Collapsed previews per the decided per-node
list: Slicer → "X of N" summary string; Sparkline → minimal small square
(reuse the collapsed-Group minified rendering); Gauge → INVESTIGATE (3 input
sockets must stay anchored — report findings, build only if clean); Chart/Heatmap
stay non-collapsible.

**C-4 · Unified XLOOKUP merge** — one node for list + frame + cube (input-surface
merge; design notes in `archive/v1.1-plan.md` WS-D). Old node types load as the
merged node or Placeholder per pre-alpha rules.

## Tier D — composite & packs

**D-1 · Goal-seek run mode** — bisection/secant driving one exposed numeric input
to a target output; `#CONV!` on non-convergence; UI = target value + which
input/output (the run-mode surface pattern). Seed: a loan-payoff goal-seek lane.

**D-2 · Simulation inner display** — the output series renders inside the
drill-in, not just the outer card.

**D-3 · Aliasing / promotion UI** — flip a port hidden/exposed + basic/advanced,
edit a hidden port's baked default; covers the pack-shell many-ports→one-param
aliasing. Footprint: composite components + pack panel.

**D-4 · Pack variant-switch reconcile** — variant dropdown add/removes sockets
like Cast/read-as (retype + `reconcileFcTypes`/`retypeOutputCables`).

## Tier E — integrations (each is its own agent-session)

**E-1 · Obsidian vault trio** — vault folder Setting (the `csvFolder` pattern);
**Import Note** node (pick a `.md`, renders like a Note but READ-ONLY body,
frontmatter → typed output sockets, refresh re-reads); **Write Note** sink
(record/Note → `.md` with frontmatter; arm/disarm Run button, excluded from the
persistence whitelist like Write CSV). Desktop-only via fileBridge; capability
grants for `$VAULT/**/*.md` mirror the images/ pattern. Seed: skip (needs a local
vault) — eyeball checklist instead.

**E-2 · Finance/FRED connection** — a Settings **API-key store** (per-provider
keys, localStorage, never bundled); **FRED** series fetch (id → date/value frame,
user key); **stocks** keyless via Stooq CSV (daily OHLC; no key) with Alpha
Vantage as the keyed option. Rides `connectionStore` refresh + `httpBridge`.
Provider presets on one connection node family, not N bespoke nodes. Seed: a
FRED demo wired to Chart (loads gracefully without a key — shows the "add key"
state).

## Tier F — bigger UI (one agent each, DESIGN.md heavy)

**F-1 · Custom palette editor** — palette dropdown "Custom…" → per-slot color
circles, "Load template" seed-from-preset, live sample (sample node in a Group +
Lorem Note; group/note colors editable); writes the app-wide custom base.

**F-2 · Document Properties window** — doc metadata (title/author/tags), the
per-doc palette override JSON text box, and document-level FC defaults (default
places / number format; date default already shipped). Persisted on SavedGraph;
text-form sidecar carries it.

## Sequencing / conflict map

- B-1 → B-2 (`engine.rs`). A-1 before anything re-pinning format tests.
- C-3 touches popup files only; C-1 owns `visual.ts`/chart files; keep apart.
- D-1/D-2/D-3 share composite files — one agent takes Tier D serially.
- F-1/F-2 both touch Settings/palette surfaces — one agent, serial.
- Everything else parallel-safe. Claim per-bundle on `agent-coordination.md`;
  code files one-editor-at-a-time; commits FIFO via the board's queue.

## Exit

All bundles landed + green; the showcase seed loads with every new chart type;
eyeball list consolidated in the digest for one author pass; backlog lines
deleted per the delete-on-done policy. THEN (author-present, separately): the
seed-cleanup pass, A4 units, D2 reroute.
