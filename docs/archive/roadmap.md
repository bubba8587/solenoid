# Solenoid — Roadmap

Forward sequencing, organized around three milestones. This is the *strategic*
plan; the running to-do list stays in [`backlog.md`](backlog.md) and the dated
history in [`dev-notes.md`](dev-notes.md). Reconcile this file against the code at
milestone/phase boundaries (see CLAUDE.md doc-maintenance), not every session.

## Milestones (set 2026-06-24)

- **v0.9 — the web-demo era, frozen.** Everything PRIOR to the desktop transition:
  the Excel-alternative layer (scalars, lists, matrices, polyform formulas, typed
  errors, the element×dimension socket lattice, logical type, array semantics),
  the full node inventory, the canvas/UX surface, and this session's perf hardening
  + web-demo node budget. This layer is **essentially done** — v0.9 is a short
  finish-and-tag, not a build-out. It runs in the browser (the Vercel demo) and as
  the current Tauri shell; it is NOT the performance target.
- **v1.0 — first DESKTOP release (the big one).** The transition off the web demo
  onto a real desktop app, AND the marquee capability the desktop unlocks:
  **Tauri/Rust shell + native Polars relational engine + the full Power-Query verb
  set (Filter / Sort / Group By / **Join / Nest / Unnest / Pivot / Unpivot**) + the
  WebGPU renderer.** Author decision 2026-06-24: v1.0 ships the *complete* verb set,
  not just the engine plumbing — an engine without Join isn't worth shipping.
  Verb axes (author 2026-06-25 — see dev-notes / cube-node-scope): **Join** flattens
  (fan-out → flat Frame); **Nest / Unnest** is the flat ⟷ cube bridge (lossless,
  Frame ⟷ Cube — Nest Join already fuses Join+Nest, Unnest is its inverse); **Pivot /
  Unpivot** is the long ⟷ wide reshape (stays flat; pivot aggregates). All five ship.
- **v1.1 — the deferred tail.** Everything currently parked as post-v1: the Format
  Controller redesign, additional node packs, Obsidian markdown sync, the grid
  system, cable collision avoidance, moveable/hideable chrome, image bundling,
  finance connection, and the smaller polish items below. None gate v1.0.

The NORTH STAR (see dev-notes) is the **visual relational / Power-Query layer** —
Filter / Sort / Group By / Join / Nest / Unnest / Pivot / Unpivot as nodes over real
table data. The hard part is *legibility*, not the relational logic, so the early
v1.0 phases build the legibility surface first, then swap the fast engine in behind it.

---

## v0.9 — web-demo era (cut from ~current state)

**Done — this constitutes v0.9** (verify against code, do NOT rebuild): the
Excel-alternative layer end-to-end (`backlog.md` is the inventory) — array-semantics
value model (null + logical + per-cell errors + Kleene + Coalesce/Fill), polyform
formula family, the derived (element×dimension) socket lattice, ~150 nodes across
all categories, variadic logic split, visual/input/control nodes, persistence,
cinematic load reveal, theming/palettes, the Personal Finance showcase seed, and
(2026-06-24) the **performance hardening arc** (paste/delete/undo O(N²) hang fixes,
targeted recompute, parallelized load) + the **web-demo soft node budget**.

**Remaining before the v0.9 tag (author-confirmed 2026-06-24):**
- [x] ~~**Popup GRID red-badge for error cells**~~ — **SCRAPPED 2026-06-24** (author:
  "I don't mind the look, doesn't need diff visuals"). The grid stringifying an error
  cell to `#DIV/0!` text instead of a red badge is acceptable.
- [x] **List ÷0 tags a per-cell `#DIV/0!`** — done 2026-06-24 (`ArithmeticNode` +
  `broadcastErr` in `shared.ts`). Was: a scalar a÷0 gave `#DIV/0!` but the element-wise
  (list/list) path collapsed a per-cell ÷0 to NaN → surfaced as `#N/A`, inconsistent
  with both the scalar and the table+Map paths. (Surfaced alongside the scrapped
  red-badge item — the inconsistency that actually needed fixing.)
- [x] **Text → boolean parse path** — done 2026-06-24. A `logical` **Cast** target
  ("Boolean") + a Boolean **read-as** on Get Column (a logical column now exits a frame
  as a real logical list; 0/1 and true/false columns coerce). One shared parser
  `coerceLogical` (`valueKinds.ts`) backs both — completes the logical type at the type
  boundary. Reverse direction (Add Column add-as logical) is item 3 below.
  `backlog.md` "Frames / data tables".
- [x] **Frame Input is a LITERAL source + a universal Source checkbox** — done 2026-06-24
  (bonus, not originally listed). Frame Input stores the RAW text you typed (`FrameSource`
  `{name,type,cells}`) and derives the typed `FrameValue` at compute time, so it never
  rewrites your input (the "1 → TRUE" bug). `FrameColumn` gained `raw?` (the inputted text,
  pre-inference) — `inferColumn` populates it so every CSV/Web/Import frame carries it; the
  popup's **Source** checkbox shows that raw text on every frame node. See dev-notes.
- [x] **Formula.js ↔ native one-engine consolidation — DONE 2026-06-25** (commits through
  `baf43ef`). The formula path (Expression / LAMBDA / MAP / BYROW / BYCOL / REDUCE / MAKEARRAY /
  packs) now resolves through ONE registry and is consistent with the visual nodes across the WHOLE
  formula-reachable surface (full sweep, not a subset). What shipped:
  - **P5 error hole closed** — shared Formula.js→`SolError` mapping at the evaluator boundary, all hosts.
  - **Full divergence sweep** (every reachable family, node-vs-FX). Fixed: 8 broken stat names
    (STDEV/VAR/MODE/PERCENTILE/QUARTILE/RANK/PERCENTRANK/COVAR threw); RANK (#N/A), TRIMMEAN, PERCENTRANK
    (interpolate+truncate); **MOD** (divisor sign — FX bug), **ATAN2** (Excel x,y order — FX bug), domain
    errors (LN/LOG10/SQRTPI/ASIN/ACOS/ACOSH/ATANH → #DOMAIN!). Rounding/combinatorics/text/closed-form
    finance all agreed.
  - **Dotted names** — tokenizer + namespace walk, so STDEV.S / NORM.DIST / PERCENTILE.INC etc. parse.
  - **Distributions** — every Excel distribution callable; the ones FX lacks (whole T family, the
    right-tail variants, GAMMA.DIST/INV) registered with OUR impls (reuse mathUtils; formula == node).
  - **datetime** — date-returning funcs (DATE/EDATE/DATEVALUE/WORKDAY) emit our serial, not a FX Date.
  - **CONVERT** → our unit system; **NPV/IRR/MIRR/XIRR/XNPV** + **XLOOKUP/XMATCH** made range-correct.
  - **EXACT** → logical; **FIND/SEARCH** not-found → #VALUE!.
  - **Limitations established (in-app + docs):** formulas are scalar / 1-D only — a 2-D matrix is
    `#SHAPE!`; use the LAMBDA hosts for 2-D. Node-only in formulas: XLOOKUP/XMATCH advanced match modes
    (basic exact works), complex `IM*` functions, matrix algebra (MMULT/MINVERSE/…).
  **Optional remainder (NOT correctness):** delete the redundant hand-rolled math for the formulajs-backed
  families (arithmetic/scalar-math/text/closed-form-finance) — code-size cleanup only. See dev-notes 2026-06-25.
- [x] **Format Controller — ARCHITECTURAL work (not the visual redesign).** Author
  split 2026-06-24: the FC *function/architecture* is v0.9, *aesthetics* is v1.1.
  **v0.9 scope DONE 2026-06-25** (passthrough-inputs, Convert gating, upstream multi-hop);
  the function model moved to v1.1, so nothing architectural remains for v0.9.
  **Unit-propagation principles set + mostly built (author 2026-06-25):** an FC locks/controls a
  value's UNIT up + down the stream ($12 is always 12 USD); a node that only PASSES a value along
  retains its unit; a TRANSFORMATIVE node breaks it (default — anything not marked passthrough);
  dimensional math (mi/hr → mph) is explicitly OUT OF SCOPE for now.
  - [x] **passthrough-INPUTS** — DONE 2026-06-25 (`b025d26`). IF/CHOOSE/SWITCH/IFS now declare their
    VALUE-branch inputs via `unitPassInputs()` (`unitFlow.ts` is input-aware); the output carries the
    branches' COMBINED unit (unitless branch ignored; conflict → none). IF(c,$a,$b)→$, IF(c,km,mi)→none.
  - [x] **Convert backward gating** — already correct: `refreshAnnotation` consults `Convert.fromUnit`
    only when there's no superseding upstream unit (`!fedByForwarder`).
  - [x] **Upstream multi-hop** annotation — DONE 2026-06-25. An FC's lock now reaches boxes ABOVE a
    passthrough, not just the immediate predecessor, via bidirectional segment resolution
    (`makeAnnotationResolver.downstreamAnnotation` walks forward through pure passthroughs to an FC ahead;
    read-side only, so no FC-clobber). See `backlog.md` + dev-notes 2026-06-25.
  - [ ] Remaining: the **function model**
    (places / sig-figs / units / multiple value types as one coherent behavior) was **moved to v1.1**
    (author 2026-06-25), joining the **movement-functions docked-FC** correctness pass
    (push/expand/collapse/autofit/tidy/drag each re-snap a docked FC — DEFERRED to v1.1 with the big
    movement-function review). The **popup formatted/source toggle is DONE** (`TablePopup` displayMode);
    per-column FC *styling* (numbers→percentages) is v1.1. The FC visual/layout redesign + `SegToggle`
    unification stay v1.1. `backlog.md`.
- [x] **Add Column "add-as logical"** (small) — DONE 2026-06-25 (`efab1f6`). `AddColumnAddAs`
  gained `logical`; the Values input is a logicallist and the stored column type is `logical` —
  the write-side mirror of Get Column's read-as Boolean. Closes the logical type's last frame
  edge. (4th SegToggle segment needs no wider node — Get Column already ships the same 4-label
  toggle at 200px.) `backlog.md`.
- [x] **Cube — the recursive container that finishes the socket lattice — v0.9 (author
  2026-06-24).** DONE — value model + cached depth, socket lattice, producers (Nest Join, Build
  Cube), the cube/frame-aware INDEX accessor, drill-in CubePopup, and a seed. Full scope +
  cross-tool survey in `docs/cube-node-scope.md`. (XLOOKUP frame/cube mode is the one follow-up.)
  Make a frame's CELLS able to hold ANY value — a scalar, a list, a matrix, or
  another frame/cube — so it becomes the universal RECURSIVE container and the socket type
  system CLOSES: no new socket type can ever be needed, because anything is expressible by
  nesting. Author: do this in v0.9 because it "permanently finishes all socket types." **Name
  = Cube** (decided). **Shape decision = recursive nesting** (a cell = any value, incl. a
  sub-cube — the true closure; NOT a fixed 3-D "panel" or multi-frame "workbook"). **Socket
  icon = a 3-diamond hexagon** (a flat / isometric cube: a hexagon outline split into 3 rhombi
  for the top + left + right faces). Build it as a new glyph branch in
  `components/SocketComponent.tsx` (the 12×12 `viewBox` SVG that already draws circle / square /
  split-square / 2×2-grid) + a `SocketLegend` row. Touches: the value model (a `FrameCell`
  widens to any value, incl. a nested frame/cube), the socket lattice (`sockets.ts` — a `cube`
  family + `accepts()`: cube as the top type everything widens into), display (FrameDisplay /
  TablePopup render a nested cell as a chip that drills in), and the array-semantics invariants.
  Likely the largest of the four — scope it first.

**NOT in v0.9** (don't pull these forward): anything needing the engine, desktop
shell, or new renderer → **v1.0**; the deferred tail (incl. FC *visual* redesign,
pinch-zoom) → **v1.1**.

---

## v1.0 — desktop release (the spine)

> **Detailed execution plan: [`v1.0-plan.md`](v1.0-plan.md)** — file-level build
> order, the `FrameBackend` engine seam, risks, intra-v1.0 milestones, and the
> open decisions for review. This section stays the strategic phase view.

The four workstreams below are the body of v1.0. They interleave (the renderer is
independent of the engine; both depend on the Tauri shell being stood up), but the
legibility surface (Phase A's inspector/previews) is built BEFORE the engine swap
so the engine drops in behind a UI that already reads frames.

### Phase A — Tauri desktop spine + legibility surface
- [x] **Cable inspector panel** — done (`components/CableInspector.tsx`): lower-left
  popup for a single selected cable; source/target ends + the wire value via the
  source's Format Controller. Built engine-agnostic so the Polars preview drops in.
- [x] **Popup source-mode toggle** — done 2026-06-21 (`61c6b93`): Formatted/Source
  on read-only frame popups with a date column.
- [ ] Stand up the desktop build as the real target (CSV File node is already
  desktop-only). Desktop packaging / installer for **Windows** (the only current
  target — see `renderer-plan.md` "Shell decision").
- [ ] **Tauri HTTP** — route Web Source / Import HTML / Import XML fetches through
  the Rust HTTP client (`tauri-plugin-http`) to unlock CORS-blocked sites; falls
  back to browser `fetch` in dev.
- Already done, do NOT rebuild: per-node frame preview (`FrameDisplay.tsx`),
  per-step row×col counts (`FrameChip` → `[R×C Frame]`).

### Phase B — Rust relational engine (Polars)
The real cost: an engine-model change, not a dependency add. Data **lives in the
engine**; a relational node passes a **lazy `LazyFrame` handle** down its cable
(composing a query plan, not materializing). Only at display does a node
`.collect()` a **preview** (schema + head N + row count) across IPC, feeding Phase
A's inspector + previews. The frame layer becomes async/handle-passing; the
scalar/list/numeric/formula layer stays eager JS. The boundary between layers is
where a handle ↔ a materialized FrameValue.
- [x] **Engine decided: Polars** (2026-06-22) — native Rust `polars`, lazy handles.
  The web build stays a separate/degraded demo path (no production Polars WASM).
- [ ] Engine in the Tauri backend; lazy handles on frame cables.
- [ ] On-demand preview (`.collect()` head-N) → cable inspector + node preview.

### Phase C — The verbs (full set, per author decision)
- [ ] **Filter** (WHERE), **Sort** (ORDER BY), **Join** (the keystone — flat
  inner/left/right/outer, key match, schema merge, fan-out), **Group By** (GROUP BY),
  Append/Union, Distinct, **Pivot / Unpivot** (long ⟷ wide reshape; pivot
  aggregates), Rename. Get/Add Column + Slicer + 1-D Group By + Build/Split are the
  existing fragments.
- [ ] **Nest / Unnest** — the flat ⟷ nested (Cube) bridge (author 2026-06-25, full
  set decided). **Nest Join** (Join + Nest fused) already ships in v0.9; the gaps are
  a standalone **Nest** (group one flat frame by key into cells) and **Unnest** (cube
  → flat joined table, the inverse). Distinct axis from Pivot/Unpivot: nest/unnest
  changes nesting depth (lossless), pivot/unpivot changes orientation (stays flat).
- [x] **List-of-frames representation** — DONE, as the **Cube** (v0.9): a cube IS a
  list-of-frames-with-keys (Group By partitions = a cube of sub-frames), paired with
  polyform as the per-group pipeline. See `docs/cube-node-scope.md`.
- [ ] Legibility throughout: schema-aware inspector, per-step row counts,
  inspectable result at each node.

### Phase D — WebGPU renderer (the zoom-at-scale lever)
Plan FINALIZED in [`renderer-plan.md`](renderer-plan.md). Target = WebGPU + WebGL2
fallback in the webview, hybrid (DOM only for the active node), feature-gated with
the rete DOM renderer as a permanent fallback (belt-and-suspenders on Windows,
where WebView2 = Chromium). Phased: **cables→canvas first** (most isolated, reuses
`cablePaths.ts`), then node bodies at LOD, then selection/drag hit-testing.
- [ ] Phase 0 de-risk harness (render-mode store + GPU probe + transform-mirror).
- [ ] Phase 1 cables → one canvas/WebGL layer.
- [ ] Phases 2–3 (node bodies at LOD; canvas hit-testing) only if Phase 1 doesn't
  suffice. Greenlight when zoom-at-scale is a real blocker, not a stress test.

---

## v1.1 — post-v1 deferred tail (do not start before v1.0 ships)

- [ ] **Format Controller — VISUAL/layout redesign only** (the *architectural* FC
  work moved to v0.9, see above). The aesthetic half: layout rethink of the FC's
  places/sig-figs/units panel + routing its segmented toggle through the shared
  `SegToggle` for one segmented-button definition. Author split 2026-06-24:
  architecture is v0.9, aesthetics is v1.1.
- [ ] **Pinch-zoom on trackpad** — interaction parity (OS sets `ctrlKey` on pinch
  wheel; verify on real hardware). Deferred from v0.9 (author 2026-06-24).
- [ ] **Additional node packs** — the pack framework + Geometry example are done;
  more domain packs (Electromagnetics, Finance-pro) are post-v1. Needs the
  **dormant-pack persistence** (placeholder node + pack provenance) before the first
  *code* pack ships, else deactivating a pack severs saved wiring.
- [ ] **New core I/O/visual/control nodes** (`io-visual-control-node-proposal.md`) +
  the **Excel Timesavers pack** (`timesavers-pack-proposal.md`).
- [ ] **Obsidian markdown import/export** — bidirectional `.md`↔Note sync (builds on
  frontmatter→sockets; needs the Tauri fs layer).
- [ ] **Image bundling** — a bundle save format so locally-attached images survive
  reload.
- [ ] **Cable collision avoidance** — avoid nodes / avoid cables / per-cable overrides.
- [ ] **Grid system** (`grid-system.md`) — soft alignment, alignment helpers.
- [ ] **Moveable / resizable / hideable UI chrome** + the **palette override editor UI**.
- [ ] **Finance connection** (GOOGLEFINANCE-ish Web Source preset), if wanted.
- [ ] Smaller polish: pop-up "+ more" actions, collapsed mini-preview for pure-visual
  nodes, Error UX on pack restriction violation.

---

## Side lane — always on
The live-piped **bug / CSS / design-fix queue**. Runs in parallel to whatever
milestone is active; order among items doesn't matter; batched into whatever session
is open. Capture stream only — items stay ephemeral and do NOT land in `backlog.md`
unless one reveals a real feature or a recurring class of bug. The one rule: a fix
touching a subsystem with an invariant (cable routing, sockets, standoffs, group
push, tidy) is verified against `subsystem-invariants.md`, not eyeballed.

## Settled decisions (history)
- **Milestones v0.9 / v1.0 / v1.1** (2026-06-24) — above.
- **v1.0 includes the full relational verb set** (2026-06-24) — not just engine
  plumbing; Join ships in v1.0.
- **Shell: stay Tauri, not Electron** (2026-06-24) — Windows-only target, so
  WebView2 = Chromium gives Electron's GPU story at Tauri's footprint with a
  first-class Rust backend. See `renderer-plan.md` "Shell: Tauri vs Electron".
- **Renderer = WebGPU + WebGL2 hybrid, feature-gated** (2026-06-24) —
  `renderer-plan.md`.
- **Engine = Polars** (2026-06-22) — native Rust; the web build does NOT run the
  real engine (no production WASM), so the web demo lives on as a UI-test + try-it
  environment with node/backend restrictions; desktop Tauri is the full-capability
  target.
- **FC redesign SPLIT** (2026-06-24, updated 2026-06-25) — *architectural* work
  (passthrough inputs [DONE], formatted/source toggle [DONE], multi-hop annotation) is **v0.9**;
  *aesthetic*/layout redesign + SegToggle unification + the **function model** (places / sig-figs /
  units / multiple value types; moved out of v0.9 on 2026-06-25) + docked-FC movement is
  **v1.1**. (Supersedes the 2026-06-22 "whole FC redesign deferred to post-v1.0".)
- **Formula.js↔native consolidation is a v0.9 item** (2026-06-24) — to be finished
  before the v0.9 tag, not opportunistic.
