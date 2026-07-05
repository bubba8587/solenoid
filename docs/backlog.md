# Solenoid — Backlog

**OPEN items only.** When an item lands, DELETE its line — git history, the session
digests (`dev-notes.md` → `archive/dev-notes-history.md`), and the archived planning
docs are the record; this file is the working queue, not a ledger. (Policy changed
2026-07-05 by the author; the old flip-to-`[x]`-and-keep convention is retired.)

Where things stand: v1.0 shipped (desktop + Polars + verbs + HTML-in-canvas);
v1.1-α (the FC function model/redesign/movement audit) shipped 2026-07-05. The
v2.0 bundle set lives in `docs/v2.0/` (built: 01-07, 09, 11-15 — reviewed; open
bundles + "verdict pending" items are listed in its README; the shipped v1.1 plan
is archived).

---

## Needs an author decision / author-present session

- [ ] **D2 — reroute the real toolbar / mobile bar to the ACTIVE subgraph** —
  APPROVED 2026-07-05, as its own AUTHOR-PRESENT session (not the autonomous
  plan). Cross-cutting: the op singletons in `process.ts`
  bind to the MAIN editor/area; Canvas keydown stands down during drill-in; no
  drill-in Tidy. Proposed architecture (an "active graph context" bundle the overlay
  swaps on open/close) is written up in the archived dev-note "Composite drill-in —
  toolbar reroute is its own session". Wants live eyeballing.
- [ ] **D4 — conditional formatting for tables** (#41; deferred again 2026-07-05).
  Needs its own design pass: must clear Excel's version by a lot (author's explicit
  dislike), Display-node-only, must not step on FC format/units territory.
- [ ] **FC A4 — units by dimensionality (the flagship).** Author 2026-07-05: IN,
  "big boy — we should go through it together when building" — DEFERRED to a
  dedicated AUTHOR-PRESENT arc (not the autonomous plan). Representation decided
  (tagged cells), `dimension.ts` algebra core landed. THE plan:
  `v2.0/05-units-format-controller.md`.
- [ ] **Header/body border seam under zoom — UNSOLVED, parked for a human/later
  model.** See dev-notes "UNSOLVED" for constraints + the two eliminated approaches.
- [ ] **Deferred pile — RESOLVED 2026-07-05 (author ruled each):** still deferred =
  **#23 persistent compute cache** and **#35 MCP port** only. OUT for good:
  #2 publish-as-form, #6 snapshots/diff, #11 transform-by-example, #46 sealed
  models, Bet 5, list-of-frames ("this is Cube"), Go-To-Special chrome ("we
  already have multiple go-to affordances"). #48/#54 resolved as the ultra-minimal
  library-folder opener (build item below).

## Decided, unbuilt (mechanical — no design session needed)

- [ ] **FC advanced options for TEXT values** (author idea 2026-07-06): put these
  in the Format Controller's advanced tier for a string-typed value —
  **text alignment** (left / center / right; the display-value default stays
  right-aligned, which reads fine for short text and clears the left-side Copy
  button, so this is an override not a default change), **render as source vs
  markdown**, and a **monospace toggle** (the value box is already mono; a text FC
  could opt a prose value OUT of mono). Design-first: fits the A2 advanced-tier
  expander; must respect the format-model truth table (`formatModel.ts` — text
  family currently exposes only `textCase`).

- [ ] **UX/a11y mechanical batch** (approved as one batch 2026-07-02; PARTIALLY
  landed — CloseIcon + focus-visible bits shipped; VERIFY each against code before
  building the rest): socket-dot hover `title` naming the type (the only colorblind
  path); `prefers-reduced-motion` honored by the load reveal; `Ctrl+/` matching
  `e.key` not `e.code`; Group/Note title editors through draft-commit; modal focus
  traps; Settings `Switch` accessible name; socket-legend open-state persistence.
- [ ] **Frame P3 pair** (decided 2026-07-02): (a) Rust builds the byte-identical
  oracle key — replace `Cell::key()` + `\u{1}` joins with `serde_json` of the SAME
  tagged-tuple encoding as JS `encodeCell`; cargo parity test with a `\u{1}` fixture.
  (b) Infinity first-class in frames — IPC gains a non-finite sentinel
  (`{"__nf":"inf"|…}`) BOTH directions; aggregates apply the scalar `guardFinite`
  rule in both backends; parity tests. Also: document the desktop source-freeing
  GC-timing behavior in subsystem-invariants (decided ACCEPT, docs-only).
- [ ] **String lt/gt ordering** (byte vs locale) — small P3, decide + pin when touched.
- [ ] **Minimap position 3-way** (decided 2026-07-01, NOT four corners): one
  Bottom · Top · Hide setting absorbing `perfHideMinimap`; the Socket Reference
  legend slides to fill freed space; Top sits below the Zoom pill.
- [ ] **Popup `⋯` overflow menu** (decided 2026-07-01): Export CSV + Copy as
  Markdown on Table/Frame/List popups; move the existing Copy-CSV into it.
  (The "Go to node" half shipped 2026-07-05 as the Go-to-source crosshair.)
- [ ] **Collapsed mini-previews, per-node** (decided per-node 2026-07-01):
  Slicer → a summary string ("X of N"); Sparkline → a minimal small square
  (reuse the collapsed-Group minified-square rendering); Gauge → investigate
  (3 input sockets must stay anchored); standard Chart + Heatmap → NOT in scope.
- [ ] **App-wide "Custom…" palette editor** (decided + spec'd 2026-07-01): palette
  dropdown gains "Custom…" → editor with per-slot color circles, a "Load template"
  seed-from-preset, and a live sample (sample node in a Group + a Lorem Note);
  writes the app-wide custom base (`paletteStore`). Per-DOC palette editing goes
  to a future Document Properties window (raw JSON text box) — later, bigger; that
  window is also the home for doc metadata (title/author/tags) and **document-level
  FC defaults** (default places / number format — the date default `DD-MMM-YYYY`
  already shipped; toolbar-supplementals [SETTING] verdict).

## Composite / drill-in

- [ ] **Simulation-container output series renders on the outer card only** — the
  drill-in should show it too.
- [ ] **Goal-seek run mode** — real numeric solver (bisection/secant) driving one
  exposed numeric input to a target output; `#CONV!` on non-convergence.
- [ ] **Monte Carlo run mode** — driver slot exists; blocked on bundle 12's
  distribution representation for the sampling.
- [ ] **Aliasing / hidden-port promotion UI** — the data model has `hidden`/`advanced`
  per port; no UI to flip exposure or edit a hidden port's baked default. Includes the
  pack-shell "many internal ports → one shell parameter" aliasing (the stats
  confidence-level example).

## Nodes / engine

- [ ] **Full XLOOKUP merge (list+frame+cube one node)** — cube-cell half shipped;
  the input-surface merge + migration is open (design notes: `archive/v1.1-plan.md` WS-D).
- [ ] **Error UX on restriction violation** — typed error out the socket vs the node
  flagging the offending input locally. Pending a call.
- [ ] **Formula re-audit remainder** — `formulaDivergence.test.ts` guards the known
  overrides (incl. the 2026-07-05 TEXT-family sweep); NOT yet swept: node `data()`
  paths that don't share the registered impl; distributions validated only at
  representative points — widen if accuracy is ever in doubt.
- [ ] **BUG (FIXED, awaiting author eyeball) — Treemap/Sankey blank box.**
  Root cause found (`d824373`): recharts 3.x's `content`/`node` prop needs the
  FUNCTION form to receive each cell/node's real geometry — a static element
  renders once with no geometry, so every rect/node collapsed to 0×0. Fixed in
  both `TreemapView`/`SankeyView` (`chartRender.tsx`). Verified against
  recharts 3.8.1's types + tsc/vitest; not yet eyeballed live (no-puppeteer
  rule). Repro/verify via the `chart-showcase` seed. **Delete this line once
  the author confirms it renders.**

## Notes / documents

- [ ] **Obsidian vault trio** (IN, author-specced 2026-07-05): (1) a **vault
  folder selector** Setting (the `csvFolder` pattern); (2) **Import Note** node —
  picks a `.md` from the vault, renders like an existing Note but READ-ONLY,
  frontmatter → typed output sockets, refreshable; (3) **Write Note** node — a
  sink writing a Note/record back to the vault as `.md` with frontmatter
  (arm/disarm Run-button pattern, like Write CSV). Parse/serialize halves exist
  (`noteFrontmatter.ts`); desktop-only via `fileBridge`.

## Packs

- [ ] **More domain packs** — post-v1 polish (framework + Geometry worked example
  done). Don't build unprompted.
- [ ] **COMPLETE RECHARTS** (author 2026-07-05: "grab everything from Recharts —
  simple goal: complete Recharts"; supersedes the 2026-07-01 scoped list): the
  Chart family covers every recharts chart type — existing column/bar/line/area
  PLUS **Pie**, **Scatter**, **Bubble** (scatter+size), **Radar**, **RadialBar**,
  **Funnel**, **Treemap**, **Sankey**, **Composed** — in the existing Chart node's
  op surface where the input shape fits, new nodes where it differs
  (Sankey/Treemap take structured data). Plus the still-standing 07-01 adds:
  **KPI/Stat card** (big number + delta), **Histogram** (binning + bar),
  **Bullet graph**, **date-range picker**. Mermaid stays the diagram escape
  hatch. All lazy via the existing `chartRender.tsx` split. Ships a showcase SEED.
- [ ] **Input Switcher upgrade** (author 2026-07-01): editable slot titles (reads
  as named choices) + a multi-select mode collecting selected values into a Cube.
- [ ] **Pack variant-switch reconciles the socket set** — a simple pack's variant
  dropdown must add/remove sockets like Cast/read-as do (retype + reconcile), not
  leave stale ones.
- [ ] **Excel Timesavers pack additions** (proposal: `archive/timesavers-pack-proposal.md`)
  — ~25 formula-data presets + ~8 custom-logic + ~3 composites.
- [ ] **Pack distribution + dependency system** — LAST for 1.1 and a "maybe"; must
  land in tandem with subgraphs (`archive/v1.1-plan.md` B1 remainder).

## Cables / canvas / chrome

- [ ] **Cable collision avoidance** — DEFERRED for later (author 2026-07-05).
  Spec: `archive/cable-routing.md` §2 (avoid nodes; parallel runs + bridge hops;
  per-cable overrides).
- [ ] **Grid system** — DEFERRED for later (author 2026-07-05). Spec: `grid-system.md`.
- [ ] **Moveable / hideable UI chrome** (standing author principle): honor for
  every new panel; the decided piece (minimap 3-way) is queued above.
- [ ] **Optically center the last asymmetric icons** — canvas-lock toggle (reads
  low) + the cable-flourish sparkle (author's eye needed). Ink-centroid method in
  the archived dev-notes (2026-06-20).
- [ ] **Pinch-zoom on a real Mac trackpad** — should work via `e.ctrlKey` pinch
  wheel events; verify on hardware, intercept manually if not.

## External data

- [ ] **Finance / economic-data connection** (IN, author-reshaped 2026-07-05):
  a connection-node family with **user-supplied API keys** (a Settings key store;
  never bundled keys): **FRED** (series id → date/value frame; free user key),
  **stocks** via a keyless/free source where possible (Stooq CSV needs no key;
  Alpha Vantage as the keyed option). Rides the same `connectionStore` refresh
  layer as Web Source; desktop CORS reach via `httpBridge`.

## Parked (superseded levers / far-future — revisit only if their trigger returns)

- [ ] **UI-scale toggle (Default / Larger)** — deferred to 1.2 (2026-07-01); subsumes
  all per-panel resize asks. Don't build per-panel resize.
- [ ] **Uncertain values (#21) + money mode (#43)** — IN but VERY LATE, sequenced dead
  last; each needs an author representation call first. Design context:
  `v2.0/12-value-model-extensions.md`.

- [ ] **WebGPU/wgpu renderer + the LOD swap** — superseded by HTML-in-Canvas as the
  zoom-at-scale lever. The WGSL/Pixi spikes are BUILT and parked (console-only
  `"canvas"` mode); the LOD hide is blocked on rete's ResizeObserver loop. Records:
  `archive/renderer-plan.md`, `archive/performance-hardening.md`. Reopen only if
  `drawElementImage` never reaches stable or a native-GPU need appears.
