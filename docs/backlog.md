# Solenoid — Backlog

**OPEN items only.** When an item lands, DELETE its line — git history, the session
digests (`dev-notes.md` → `archive/dev-notes-history.md`), and the archived planning
docs are the record; this file is the working queue, not a ledger. (Policy changed
2026-07-05 by the author; the old flip-to-`[x]`-and-keep convention is retired.)

Where things stand: v1.0 shipped (desktop + Polars + verbs + HTML-in-canvas);
v1.1-α (the FC function model/redesign/movement audit) shipped 2026-07-05. The
v2.0 bundle set lives in `docs/v2.0/` (built: 01-07, 09, 11-15 — reviewed; open
bundles + "verdict pending" items are listed in its README). `docs/v1.1-plan.md`
carries the remaining WS-A4/B/C/D/E detail.

---

## Needs an author decision / author-present session

- [ ] **D2 — reroute the real toolbar / mobile bar to the ACTIVE subgraph** (author's
  ask, deferred again 2026-07-05). Cross-cutting: the op singletons in `process.ts`
  bind to the MAIN editor/area; Canvas keydown stands down during drill-in; no
  drill-in Tidy. Proposed architecture (an "active graph context" bundle the overlay
  swaps on open/close) is written up in the archived dev-note "Composite drill-in —
  toolbar reroute is its own session". Wants live eyeballing.
- [ ] **D4 — conditional formatting for tables** (#41; deferred again 2026-07-05).
  Needs its own design pass: must clear Excel's version by a lot (author's explicit
  dislike), Display-node-only, must not step on FC format/units territory.
- [ ] **FC A4 — units by dimensionality (v1.1-β, the flagship vision).** The model,
  keyed to the dimensional ladder: **matrix = unit-agnostic always** (pure numbers);
  **list = units PER ELEMENT** (a row — `[3 km, 5 mi]`; a per-cell tag like the
  array-semantics `null`/`SolError`); **frame = units PER COLUMN** (a frame row IS a
  list); FCs can tag STRING-LIST header keys so Build Frame / Add Column LOCK each
  column to its header's unit (`[id, Item, Revenue ($0.00)]` + `[5,6,7]` →
  `[$5.00, …]`, per-column FC locked). Touches the value model (DESIGN THE
  REPRESENTATION FIRST — parallel unit array vs tagged cell), `unitFlow`
  (per-cell/per-column propagation), FC + display (mixed suffixes, header targeting),
  aggregators (SUM over mixed units → convert or `#TYPE!`), socket lattice. Big —
  its own milestone. Full sub-item breakdown: `v1.1-plan.md` A4.
- [ ] **Header/body border seam under zoom — UNSOLVED, parked for a human/later
  model.** See dev-notes "UNSOLVED" for constraints + the two eliminated approaches.
- [ ] **Deferred pile (end-of-walk revisit, author call each):** #2 snapshots ·
  #6 diffing · #11 transform-by-example · #23 persistent compute cache · #35 MCP
  port · #46 sealed models · #48/#54 library layer / model index (VERY deferred —
  "the OS-level chosen folder is the answer for now") · Bet 5. Context per item:
  `docs/v2.0/README.md` "verdict pending".

## Decided, unbuilt (mechanical — no design session needed)

- [ ] **Force en-US number formatting everywhere** (decided 2026-07-02: "I don't
  respect comma decimals"). Pass `"en-US"` (one shared constant) instead of
  `undefined` to every `toLocaleString` — `formatAnnotationStore.ts` (~5 sites,
  incl. `formatPrecise`/integer) + the cosmetic row-count strings in
  CubePopup/TablePopup. Inputs stay dot-decimal; display and input agree by fiat.
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
- [ ] **Persist cable shape** — `cableShapeStore` gets the localStorage pattern of
  its siblings (one key, read at init, try/catch private-mode guard).
- [ ] **String lt/gt ordering** (byte vs locale) — small P3, decide + pin when touched.

## Composite / drill-in

- [ ] **Simulation-container output series renders on the outer card only** — the
  drill-in should show it too.
- [ ] **Goal-seek run mode** — real numeric solver (bisection/secant) driving one
  exposed numeric input to a target output; `#CONV!` on non-convergence.
- [ ] **Monte Carlo run mode** — driver slot exists; blocked on bundle 12's
  distribution representation for the sampling.
- [ ] **Aliasing / hidden-port promotion UI** — the data model has `hidden`/`advanced`
  per port; no UI to flip exposure or edit a hidden port's baked default.

## Nodes / engine

- [ ] **Full XLOOKUP merge (list+frame+cube one node)** — cube-cell half shipped;
  the input-surface merge + migration is open (`v1.1-plan.md` WS-D).
- [ ] **Native CSV reader date inference** — desktop `engine_read_csv` brings dates
  in as text (Get Column read-as-Date converts); full inference parity is the follow-up.
- [ ] **Group By `total_depth` exposure** — the pivot engine already supports it via
  a no-colFields pivot; the GROUPBY node doesn't surface it.
- [ ] **Error UX on restriction violation** — typed error out the socket vs the node
  flagging the offending input locally. Pending a call.
- [ ] **Retire the now-unused `compileFormula`** (leftover from the one-core
  unification).
- [ ] **Formula re-audit remainder** — `formulaDivergence.test.ts` guards the known
  overrides; NOT yet swept: the TEXT/format family (`numberToText` vs FX TEXT) and
  node `data()` paths that don't share the registered impl; distributions validated
  only at representative points — widen if accuracy is ever in doubt.
- [ ] **(MAYBE) list-of-frames for MAP arity** — the container half is served by the
  Cube; only the pass-N-tables-to-one-MAP niche remains. Weigh against chaining MAPs;
  revisit with per-group split-apply-combine if that direction is ever owned.

## Notes / documents

- [ ] **Obsidian markdown import/export — bidirectional sync** (author 2026-06-23).
  Import a `.md` (frontmatter + body) as a Note with typed sockets, ideally
  file-watched; a markdown EXPORT node writes a Note/record back with frontmatter.
  Parse/serialize halves exist (`noteFrontmatter.ts`); needs path/vault binding +
  `fileBridge`. North-star tie-in: a vault of notes ↔ a frame of records.

## Packs

- [ ] **More domain packs** — post-v1 polish (framework + Geometry worked example
  done). Don't build unprompted.
- [ ] **I/O–visual–control node set** (proposal: `archive/io-visual-control-node-proposal.md`)
  — core gaps: KPI/stat card, Dropdown/Multi-select, real Data Table grid,
  Scatter/Bubble/Histogram, Bullet, range slider, date-range; specialist charts →
  packs behind one heavy renderer.
- [ ] **Excel Timesavers pack additions** (proposal: `archive/timesavers-pack-proposal.md`)
  — ~25 formula-data presets + ~8 custom-logic + ~3 composites.
- [ ] **Pack distribution + dependency system** — LAST for 1.1 and a "maybe"; must
  land in tandem with subgraphs (`v1.1-plan.md` B1 remainder).

## Cables / canvas / chrome

- [ ] **Cable collision avoidance** (`cable-routing.md` §2): avoid nodes; avoid
  cables (parallel runs + bridge hops); per-cable shape/avoidance overrides.
- [ ] **Grid system** — implement `grid-system.md` (soft alignment, helpers,
  primary+sub grid, modifier bypass). Gridding CABLES is a separate design question
  (see the doc's banner).
- [ ] **Moveable / resizable / hideable UI chrome** (author principle): minimap
  corner choice, panel resize, hide any chrome element; honor for every new panel.
- [ ] **Palette override editor UI** — store + persistence exist; JSON-only today.
- [ ] **Collapsed mini-preview for pure-visual nodes** — Chart/Gauge/Slicer/
  Sparkline/Heatmap are non-collapsible today; a thumbnail collapsed form would
  make collapse meaningful.
- [ ] **Optically center the last asymmetric icons** — canvas-lock toggle (reads
  low) + the cable-flourish sparkle (author's eye needed). Ink-centroid method in
  the archived dev-notes (2026-06-20).
- [ ] **Pinch-zoom on a real Mac trackpad** — should work via `e.ctrlKey` pinch
  wheel events; verify on hardware, intercept manually if not.

## External data

- [ ] **Finance connection** (GOOGLEFINANCE-ish Web Source preset) — API-key +
  rate-limit baggage; build only if wanted.

## Parked (superseded levers — revisit only if their trigger returns)

- [ ] **WebGPU/wgpu renderer + the LOD swap** — superseded by HTML-in-Canvas as the
  zoom-at-scale lever. The WGSL/Pixi spikes are BUILT and parked (console-only
  `"canvas"` mode); the LOD hide is blocked on rete's ResizeObserver loop. Records:
  `archive/renderer-plan.md`, `archive/performance-hardening.md`. Reopen only if
  `drawElementImage` never reaches stable or a native-GPU need appears.
