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

## 1.1 release build (committed 2026-07-06 — see `release-plan.md`)

**FEATURE-COMPLETE (author 2026-07-08).** Everything below in this section is
explicitly DEFERRED past the 1.1 tag by the author on 2026-07-08 — none of it
gates the cut. The only open 1.1 work is the author-run release tail
(eyeball pass, cargo on Windows, desktop build, merge, tag). The deferred set is
ORGANIZED in `1.2-plan.md` (incremental queue) and `2.0-plan.md` (flagships);
this backlog stays the per-item source of truth.

- [ ] **Keep `release-notes-features.md` current** — the curated selling list + What's-New
  slide source (author writes the final release notes). Reconciled 2026-07-08 (FRED-keyless
  copy, no FX, Simulation ≠ Monte Carlo — slides synced in `HelpDialogs.tsx`).
- [ ] **F-2 remainder (deferred)** — a UI to edit per-slot doc-palette overrides (the store
  half exists: `paletteStore.setDocPalette` overrides round-trip) + document-level FC defaults.
- [ ] **Data Feed — post-1.1 widening only** (core + date-range/frequency/quick-picks +
  the **Live Market Data** demo seed all SHIPPED; Stooq dropped — bot-blocked). Still OPEN,
  none release-gating: a richer series/symbol PICKER (today a text field + quick-picks),
  more providers. Scope: `release-plan.md` §3a.
- [ ] **iFrame / embed node** (author 2026-07-06) — a general web-embed node: FRED graph
  direct embeds, YouTube, social (Twitter/X), dashboards. Emits an embed value out the green
  `chart` socket (like Image/Mermaid) so it also embeds in a Report. **SECURITY (author-gated
  decision — this is the can of worms):** the Tauri CSP currently has NO `frame-src`, so it
  falls back to `default-src 'self'` and external iframes are BLOCKED. Enabling this REQUIRES
  loosening `frame-src` — the call is `https:` (any HTTPS embed, broad) vs. a domain allowlist
  (FRED/YouTube/Twitter…, safer but caps "other stuff"). Mitigations regardless: `sandbox`
  (allow-scripts allow-same-origin allow-popups, NO allow-top-navigation), `referrerpolicy=
  no-referrer`, https-only, and **click-to-load** (don't auto-load an embed on file open — a
  saved URL is untrusted; also the main perf lever). **PERF:** each iframe is a full browser
  context — click-to-load + don't render off-screen + cap concurrent. Reality check: most sites
  send `X-Frame-Options: DENY`, so this works for EMBED-friendly content (FRED/video/social),
  not arbitrary pages. Needs the author's CSP-posture call before build.
- [ ] **Keep `release-notes-features.md` current** — the curated selling list + What's-New
  slide source (author writes the final release notes). Reconciled 2026-07-08 (FRED-keyless
  copy, no FX, Simulation ≠ Monte Carlo — slides synced in `HelpDialogs.tsx`).
- [ ] **Seed follow-ups after the 2026-07-08 consolidation** (27 → 17, author-directed:
  six retired outright, four merged, Getting Started rebuilt with a Tables & charts
  cluster; run-graph/errorSeed tests re-anchored). Remaining author calls:
  (a) **personal-finance** (generator-locked) uses WebSource, no DataFeed/composite/trust
  section — any change goes through `gen-personal-finance-seed.cjs`; (b) **composite-workbench**
  now has two goal-seek cards but still no scenarios/data-table card.

## Needs an author decision / author-present session

- [ ] **Parity Tier 4 — the formula dimensionality cap (D2, reopened; discussed 2026-07-14)**
  — NOT decidable yet: precondition is finishing the registry unification (same motion as the
  greenlit Tier 1 work). Criteria fixed by the author: correctness + coherence only (the
  identity/auditability objection is RETIRED — don't re-litigate). When it returns, bring a
  shape-branding design for the type-agnostic evaluator + the Excel-DA broadcast-rules table
  (machine-checked, formatModel-style); endpoints: "never" vs "matrices-only, full DA
  semantics" (frames-in-formulas rejected). Full record: `docs/formula-node-parity.md`
  "Tier 4 in full". The transpiler (bundle 08) is the standing pressure.
- [ ] **First-class composite drill-in — remaining gaps** (the "active graph context"
  arc; author 2026-07-06 said proceed). BUILT: `activeGraph.ts` seam (`getActive*` /
  `getOwningEditor`, `getEditor()` stays MAIN — locked by `activeGraph.test.ts`);
  de-fullscreen so the app frame stays around the subgraph (`z-index:4`, `html.sol-drilled-in`,
  floating breadcrumb strip); chrome on the active graph (NavMenu zoom/fit, a real drill-in
  minimap, lock); keyboard: copy/paste/delete/duplicate/add(A)/nudge/undo-redo/select-all(Ctrl+A)/
  Tidy(T); right-click node menu; propagation fixes (labels/FC/type-default); `areaPresets.ts`
  shared so surfaces can't drift. **Isolate DONE 2026-07-12** (I toggles, Esc exits before
  drill-up, cleared on leave; `isolate.ts` routes through `getActiveEditor` — the drill-in
  cards read the same global `isolateStore`; `isolateActive.test.ts`). STILL OPEN:
  (a) **Group/Cleanup/Autofit/Expand** in the drill-in — main-pipe subsystems
  (membership/push/collapse/standoffs); a group there needs the group-drag reconcile pipe +
  `pushHistory`/`settleStandoffs`/GroupNode-component taught the active area, so a real (not
  static-frame) group is a bigger, DOM-verified lift — folded not half-shipped.
  (b) **Navigator + lasso** in the drill-in — navigator list/select/jump/
  rename target main (route via a new active-selection hook); lasso is a custom Canvas rebuild.
  Both folded/hidden while drilled in for now. (c) **History routing — DONE 2026-07-07:**
  `pushHistory` now targets the ACTIVE graph's history (`getActiveHistory`), so an
  extensible-row/cable-switch/group-resize edit made inside a drill-in is undone by the
  drill-in's own undo (Ctrl+Z + the mobile bar), not stranded on the main stack
  (`historyRouting.test.ts`). Remaining: a plain node-label edit isn't undoable on ANY surface
  yet (it never went through `pushHistory` — separate gap, not drill-in-specific).
  (d) **D2 proper** — reroute the real top toolbar / mobile bar to the active subgraph
  (author-present, wants live eyeballing).
- [ ] **D4 — conditional formatting for tables** (#41; deferred again 2026-07-05).
  Needs its own design pass: must clear Excel's version by a lot (author's explicit
  dislike), Display-node-only, must not step on FC format/units territory.
- **FC A4 — units by dimensionality: LANDED (core 2026-07-12, value-mutating FC
  unification 2026-07-13).** The value layer computes with dimensions end-to-end
  (tagged `UnitCell` per list element, `ColumnUnit` per frame column, true
  `#UNIT!`-on-mismatch algebra). The **Format Controller is now VALUE-MUTATING** —
  it authors the value's unit onto the `UnitCell` (`applyFcUnit`), Convert tags its
  output, and the redundant graph unit-walk (`makeUnitResolver`) is gone; the number
  FORMAT stays a display annotation. REDUCE/BYROW/BYCOL carry units over a 1-D list.
  Plan/status: `v2.0/05-units-format-controller.md` (complete). Remaining A4
  FOLLOW-UPS (author-present polish, none blocking):
  - [ ] **Per-element mixed-unit trig (author 2026-07-09):** a list mixing `deg`/`rad`
    cells into an Auto-mode trig `Math` node should interpret EACH cell in its own
    unit. `mathFnResultDim` now handles a UnitCell angle (base-radians) per cell, but
    `resolveTrigModes` still reads ONE socket-level FC unit — the per-cell path needs
    the trig `Math` node to branch on each cell's `UnitCell` angle-dim, not the socket.
  - [ ] **Cube popup FC controls:** frames + matrices + lists got the per-column
    FC format+unit controls row / in-cell units in the value popup (2026-07-15g,
    `components/fcControls.tsx` + `TablePopup`). Cubes are the remaining surface —
    gated on typed `CubeColumn` (see "Lossless frame→cube" below); the same
    controls drop in once cube columns carry type/unit.
- [ ] **Header/body border seam under zoom — UNSOLVED, parked for a human/later
  model.** See dev-notes "UNSOLVED" for constraints + the two eliminated approaches.
- [ ] **Deferred pile — RESOLVED 2026-07-05 (author ruled each):** still deferred =
  **#23 persistent compute cache** and **#35 MCP port** only. OUT for good:
  #2 publish-as-form, #6 snapshots/diff, #11 transform-by-example, #46 sealed
  models, Bet 5, list-of-frames ("this is Cube"), Go-To-Special chrome ("we
  already have multiple go-to affordances"). #48/#54 resolved as the ultra-minimal
  library-folder opener (build item below).

## Decided, unbuilt (mechanical — no design session needed)

- [ ] **Document Properties — remaining parts** (the window itself shipped 2026-07-06:
  title / author / tags / per-doc palette BASE, via `docMetaStore` + `SavedGraph.meta` +
  sidecar). Still open: (a) **per-slot doc palette overrides** — DEFERRED (author 2026-07-07);
  the window only sets the base, overrides stay hand/seed-authored on
  `SavedGraph.palette.overrides`; (b) **document-level FC defaults**
  (default places / number format — the date default `DD-MMM-YYYY` already shipped;
  toolbar-supplementals [SETTING] verdict) — a format-pipeline integration (FC reads a
  doc default), best done deliberately / author-present.

## Composite / drill-in

- [ ] **Inside-solve stale dot is uniform** (author 2026-07-06, minor): after an INSIDE Solve
  (runs on marker seeds, ignoring outside wiring) the stale dot reads green though the held result
  is seed-based, not wired — you re-solve outside to use wiring. Distinguishing the two needs a
  drill-state signal in the compute layer (couples `data()` to `compositeEditorStore`); left simple
  on purpose. Revisit only if it reads as misleading.
- [ ] **Aliasing / hidden-port promotion UI** — the data model has `hidden`/`advanced`
  per port; no UI to flip exposure or edit a hidden port's baked default. Includes the
  pack-shell "many internal ports → one shell parameter" aliasing (the stats
  confidence-level example).
## Nodes / engine

- [ ] **Units by dimensionality (D20) — COMPLETE across all five ranks; only a truly moot tail
  is unbuilt.** DONE (2026-07-15): scalar/list (`UnitCell`), frame (`ColumnUnit`), matrix (whole-grid
  Symbol tag) with the FULL op POLICY + a machine-checked completeness guard (`matrixUnitPolicy.test.ts`
  — carry / carry-if-uniform / convert / strip / na / author), INDEX + `coerceValue` re-carry, chip +
  popup display, taggable Table Input; and **cube = per-cell like a list** (`CubeCell` holds `UnitCell`s,
  frame→cube tags, cube→frame recovers the column unit). Verified NON-gaps: Convert-on-a-matrix is
  unreachable (a matrix can't wire into Convert's `numlist` input — the FC is the matrix relabeler);
  MMULT-multiplies-dims + the `unitLattice` matrix sweep are MOOT (no element-wise matrix±matrix
  arithmetic node exists, and the ×/÷·+/− dimension contract is scalar-level, already tested). The
  only genuinely-open item is MMULT-dims IF a dimensioned-linear-algebra use case ever appears — niche,
  documented-strip is the deliberate stance until then.
- [ ] **Formula ↔ node parity program — GREENLIT, build in a dedicated session** (author
  direction + decisions 2026-07-14, recorded as **D19**; supersedes the narrower "SETEQ as
  formula native" item) — converge the formula language and the node set; audit + tiers +
  decisions in **`docs/formula-node-parity.md`** (numbers regenerable via
  `scripts/formula-node-parity.ts`). Decided: legacy aliases BLOCKED (`#NAME?` + redirect
  hint — VLOOKUP dispatching today is a bug); Solenoid-native formula names = the node
  hover hint despaced (`typeHint()`, "SET RELATION" → `SETRELATION`); packs register their
  own formula functions (pack-toggle-sensitive registry). Build order: ratchet test FIRST
  (pin the 57 / the blocklist), then Tier 1 registrations, alias gate, pack seam. Tier 4
  (the reopened D2 dimensionality cap) is NOT part of this — author-present, see below.
- [ ] **Rigorous multi-column input-socket label syntax** (author 2026-07-06) — a
  frame/2-D input socket should state which columns it expects in ONE consistent
  grammar. Today it's ad hoc: Sankey reads "From+To+Value", standard charts read
  "series (2-D)" — unhelpful, inconsistent. Design a rigorous convention (named,
  ordered, positional columns) that every node feeding a frame reuses, so the label
  itself documents the expected shape. Ties to the 2026-07-06 standing rule (aligned
  columns → one frame input, not parallel sockets — SUMIFS joined that club 2026-07-09,
  so the club is now charts + SUMIFS + the frame verbs).
- [ ] **Lossless frame→cube (typed `CubeColumn`) — CORE DONE (2026-07-15, `603a58b5`); only the
  XLOOKUP follow-on remains.** `CubeColumn.type?` carried by `frameToCube`/`relateFramesToCube`/
  `subCube`; `cubeCellToken`/`CubeCellChip` render a flat cell by its type (date serial → date,
  logical → TRUE/FALSE); `CubeDisplay`/`CubePopup` pass it. So cubes now render dates as dates (the
  "cube socket eats frame types" display bug is gone). **REMAINING:** XLOOKUP's cube path could use
  the column `type` to match ISO dates, and its `rawInputs` bypass (which existed to keep the cube
  socket from type-stripping a wired frame) could then retire — a node-specific cleanup, do it if it
  pulls weight. Cube VERBS that build columns from scratch (`cubeFromColumns`/rollup) leave `type`
  undefined by design (heterogeneous); revisit only if a verb has a genuinely homogeneous output.
- [ ] **MODE.SNGL tie-break disagrees across surfaces** (found 2026-07-10 audit) — the
  standalone `ModeNode` (`stats.ts`) breaks ties by the SMALLEST modal value
  (`iterMin`, deliberately — `stats.test.ts` "returns the smallest among equally
  frequent values"), but the engine's `modeOf` (`frameVerbs.ts`, used by Group By +
  Cube Rollup) breaks ties by FIRST occurrence, documented as Excel MODE.SNGL. So the
  same data gives different "MODE.SNGL" answers (`[5,5,2,2,9]` → ModeNode 2 vs Group By
  5; Excel = 5), and ModeNode is the non-Excel one. `ModMultNode` sorts modes ascending
  too. Author call: align ModeNode to first-occurrence (Excel + engine), or keep the
  deliberate smallest-tie policy and drop the Excel-parity claim. Not changed
  autonomously — it's a tested, deliberate choice.
- [ ] **Error UX on restriction violation** — typed error out the socket vs the node
  flagging the offending input locally. Pending a call.
- [ ] **Formula re-audit remainder** — `formulaDivergence.test.ts` guards the known
  overrides (incl. the 2026-07-05 TEXT-family sweep). **Node-vs-formula sweep done
  2026-07-10:** stats (STDEV/VAR/MEDIAN/PERCENTILE/RANK/…), rounding, and math all
  agree or share the impl; fixed the two genuine drifts (Combinatorics round→floor;
  MROUND opposite-sign → #DOMAIN!). Residual, deliberately NOT fixed (obscure abuse
  cases, one deliberate): POWER `0^0`=1 (documented JS/Polars convention vs Excel
  #NUM!); CEILING.MATH/FLOOR.MATH with NEGATIVE significance (node doesn't `abs` it);
  GCD/LCM on NON-integer args (node rounds, Excel truncates, Formula.js is itself
  broken here). Still open elsewhere: distributions validated only at representative
  points — widen if accuracy is ever in doubt.

## Notes / documents

- [ ] **Obsidian vault trio** (IN, author-specced 2026-07-05): (1) a **vault
  folder selector** Setting (the `csvFolder` pattern); (2) **Import Note** node —
  picks a `.md` from the vault, renders like an existing Note but READ-ONLY,
  frontmatter → typed output sockets, refreshable; (3) **Write Note** node — a
  sink writing a Note/record back to the vault as `.md` with frontmatter
  (arm/disarm Run-button pattern, like Write CSV). Parse/serialize halves exist
  (`noteFrontmatter.ts`); desktop-only via `fileBridge`.

## Packs

- [ ] **Materials & Mechanical pack + the Interpolated Lookup primitive** — the next
  domain candidate after the 2026-07-09 pack wave (Electricity, Electromagnetism, Health,
  Fluids, Thermo & Air, Sets, Earth & Sky, Chemistry). Gated on Interpolated Lookup
  (1-D/2-D dataset interpolation node) for the table-driven half (hardness conversion,
  pipe schedules, material properties). See `pack-composite-plans.md` tail.
- [ ] **Timesavers remainder** (proposal: `archive/timesavers-pack-proposal.md`; [F] batch +
  Reverse Text + Spell Number landed 2026-07-09; **serial-interop gate cleared + Quarter /
  Days in Month landed 2026-07-10** — the date extractors are internal + serial-aware, so a
  preset Expression reads a date serial): remaining date [F] idioms that carry a config or
  judgment call (Fiscal Quarter's start-month → [C], Age/Tenure with DATEDIF's `"MD"` nuance,
  Nth Weekday), the duration trio (wants an elapsed-`[h]:mm` format first), Split Name
  (multi-output [C]), and the list-reducer CORE batch (Conditional Aggregate AND/OR,
  Multi-Criteria Lookup, Last/First Non-Blank, Rank-in-Group…).
- [ ] **Composite pack-node shape** — packs can't ship subgraphs yet; the queued
  composite pack nodes (Wheatstone, pump operating point, psychrometric state point,
  Pareto, % of Total…) are planned in `pack-composite-plans.md`.
- [ ] **Pack variant-switch reconciles the socket set** — a simple pack's variant
  dropdown must add/remove sockets like Cast/read-as do (retype + reconcile), not
  leave stale ones. (The 2026-07-09 custom nodes — E-Series, Antoine, Element — all keep
  FIXED sockets across their dropdowns, deliberately, so nothing waits on this.)
- [ ] **Pack distribution + dependency system** — LAST for 1.1 and a "maybe"; must
  land in tandem with subgraphs (`archive/v1.1-plan.md` B1 remainder). (In-app
  `dependsOn` auto-activation already works — Electromagnetism → Electricity is the
  live example; this item is about DISTRIBUTION of third-party packs.)

## Desktop shell

- [ ] **Window min/max/close controls missing** (2026-07-06, dev + release): the app replaces the
  native titlebar with `tauri-plugin-decorum`'s `create_overlay_titlebar()` (`lib.rs` setup), and
  the controls aren't rendering. RULED OUT: the accent border (`set_window_border`/DWMWA_BORDER_COLOR)
  — disabling it did NOT restore them. Needs a live devtools look (F12 console — CSP/decorum errors?)
  or a decorum/tauri version check. Fallback if unfixable: drop the overlay for native OS decorations
  (guaranteed controls, loses the themed titlebar). Worked before; regression cause unknown.

## Cables / canvas / chrome

- [ ] **`content-visibility: auto` on node roots — EVALUATED, blocked by the live-DOM-geometry
  model (2026-07-15m).** The idea: skip style/layout/paint for offscreen nodes. The blocker is
  structural, not cosmetic: socket positions are measured from live DOM geometry — `MeasuredSocketRow`
  reads `offsetTop/offsetHeight` WITHIN `.solenoid-node__content` (`NodeSocket.tsx`), rete's
  `getDOMSocketPosition` watcher recomputes a socket's center by walking offsetParents up to the node
  element, and the GPU clone (`collectSpecs` → `inner.offsetWidth/Height`) + minimap/fit all read real
  node size regardless of on-screen state. `content-visibility:auto` collapses an off-screen subtree to
  its `contain-intrinsic-size` and does NOT compute descendant layout, so those reads return the wrong
  socket offsets → cable endpoints jump as a node crosses the viewport edge (the watcher fires on the
  size change), and the GPU capture would clone at intrinsic size. An accurate per-node `contain-
  intrinsic-size` fixes the OUTER box but not the socket-WITHIN-node offset, so it doesn't unblock.
  Reopen only if the socket model stops depending on live geometry of off-screen nodes (a big rework).
  With this ruled out and SVG-picker-rasterize + collapsed-figure-unmount both shipped, the DOM-weight
  reduction lever set is EXHAUSTED — the HTML-in-Canvas GPU renderer is the remaining path at scale.
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

## Parked (superseded levers / far-future — revisit only if their trigger returns)

- [ ] **UI-scale toggle (Default / Larger)** — deferred to 1.2 (2026-07-01); subsumes
  all per-panel resize asks. Don't build per-panel resize.
- [ ] **Uncertain values (#21) + money mode (#43)** — IN but VERY LATE, sequenced dead
  last; each needs an author representation call first. Design context:
  `v2.0/12-value-model-extensions.md`.

- [ ] **WebGPU/wgpu renderer + the LOD swap** — superseded by HTML-in-Canvas as the
  zoom-at-scale lever. The Pixi/WGSL spike is parked (console-only `"canvas"` mode +
  `window.__spike`; its Help-menu item was removed 2026-07-07). The **HTML-in-Canvas
  *spike*** (`HtmlCanvasSpike.tsx` + store) was DELETED 2026-07-07 — the shipped
  HTML-in-Canvas renderer (`HtmlCanvasLayer`/`htmlCanvasRenderer`, renderMode "html")
  is the real thing and stays. The LOD hide is blocked on rete's ResizeObserver loop. Records:
  `archive/renderer-plan.md`, `archive/performance-hardening.md`. Reopen only if
  `drawElementImage` never reaches stable or a native-GPU need appears.
