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
- [ ] **D-2 simulation inner display (deferred)** — the series renders inside the drill-in.
- [ ] **Goal-seek solver parameters (deferred)** — max-iter / tolerance / bounds.
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
- [ ] **Trust-node audit — remaining follow-ups** (audit DONE 2026-07-07; comments/Reconcile-PVM/
  Expect-config-persistence found clean). Fixed this pass: Tornado all-zero in manual/sketch mode
  (no rebuild-gate/force-exact) + no try/finally restore + synthetic alerts; model-fuzz polluting the
  Problems "compute" log (reportLive now gated on isGraphRebuilding); Expect not-null now catches a
  per-cell SolError; fuzz no longer reports a downstream Expect's rejection of a synthetic extreme
  (circular noise). STILL OPEN (design/perf calls): (a) **Problems panel + fuzz miss per-cell errors
  inside frames/lists** — `errorValue.reportOut` + `modelFuzz.badValue` only see top-level SolError;
  scanning every frame cell each pass is a perf tradeoff, hence deferred. (b) **Fuzz "+ Clamp" inserts
  an UNconfigured pass-through Clamp** — seed it with bounds from the finding (needs safe-range capture
  during the sweep). (c) **Tornado ranking conflates sensitivity with perturbation width** (Slider
  full-range vs Number ±10%) + drops a leaf that diverges at an extreme — normalize / mark diverged
  (semantic call: a tornado traditionally shows raw swing, so normalizing may not be wanted).

## Needs an author decision / author-present session

- [ ] **First-class composite drill-in — remaining gaps** (the "active graph context"
  arc; author 2026-07-06 said proceed). BUILT: `activeGraph.ts` seam (`getActive*` /
  `getOwningEditor`, `getEditor()` stays MAIN — locked by `activeGraph.test.ts`);
  de-fullscreen so the app frame stays around the subgraph (`z-index:4`, `html.sol-drilled-in`,
  floating breadcrumb strip); chrome on the active graph (NavMenu zoom/fit, a real drill-in
  minimap, lock); keyboard: copy/paste/delete/duplicate/add(A)/nudge/undo-redo/select-all(Ctrl+A)/
  Tidy(T); right-click node menu; propagation fixes (labels/FC/type-default); `areaPresets.ts`
  shared so surfaces can't drift. STILL OPEN: (a) **Group/Cleanup/Autofit/Expand + Isolate**
  in the drill-in — main-pipe subsystems (membership/push/collapse/standoffs, isolate z-order);
  a group there would be a static frame, so folded not half-shipped; needs those subsystems
  taught the active area. (b) **Navigator + lasso** in the drill-in — navigator list/select/jump/
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

- [ ] **String lt/gt ordering** (byte vs locale) — small P3, decide + pin when touched.
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
- [ ] **Solver parameters (advanced tier per heavy mode)** (author 2026-07-06, after
  arm-and-run shipped): goal-seek **max iterations / tolerance / driver bounds**
  (bounds both aid convergence and cap a runaway search — the honest analog of Excel
  Solver constraints); Monte Carlo **sample count + seed** (seed = reproducible draws);
  simulation step count is `simulationSteps` already, just surface it consistently.
  Fits the FC-style advanced-tier chip-foot expander. Arm-and-run + the Solve button /
  amber-ring-vs-green stale dot already shipped (`compositeStaleStore`).
- [ ] **Monte Carlo run mode** — driver slot exists; blocked on bundle 12's
  distribution representation for the sampling.
- [ ] **Aliasing / hidden-port promotion UI** — the data model has `hidden`/`advanced`
  per port; no UI to flip exposure or edit a hidden port's baked default. Includes the
  pack-shell "many internal ports → one shell parameter" aliasing (the stats
  confidence-level example).

## Nodes / engine

- [ ] **Rigorous multi-column input-socket label syntax** (author 2026-07-06) — a
  frame/2-D input socket should state which columns it expects in ONE consistent
  grammar. Today it's ad hoc: Sankey reads "From+To+Value", standard charts read
  "series (2-D)" — unhelpful, inconsistent. Design a rigorous convention (named,
  ordered, positional columns) that every node feeding a frame reuses, so the label
  itself documents the expected shape. Ties to the 2026-07-06 standing rule (aligned
  columns → one frame input, not parallel sockets).
- [ ] **Lossless frame→cube (typed `CubeColumn`)** (author-flagged 2026-07-06, bigger
  project) — the ladder is "a Frame IS a Cube with all-flat cells," but `toCube(frame)`
  (`frameToCube`) drops column types because `CubeColumn` is `{name, cells}` with NO
  per-column `type`. Give it an optional `type` so frame→cube preserves it: cubes could
  render dates as dates, XLOOKUP's cube path could match ISO dates, and the whole class of
  "cube socket eats frame types" bugs disappears (the XLOOKUP `rawInputs` bypass could then
  retire). Touches cube representation + `CubeDisplay`/`CubePopup` + the cube verbs + unit
  flow. Do it only if typed cube columns pull weight beyond this one node.
- [ ] **Error UX on restriction violation** — typed error out the socket vs the node
  flagging the offending input locally. Pending a call.
- [ ] **Formula re-audit remainder** — `formulaDivergence.test.ts` guards the known
  overrides (incl. the 2026-07-05 TEXT-family sweep); NOT yet swept: node `data()`
  paths that don't share the registered impl; distributions validated only at
  representative points — widen if accuracy is ever in doubt.

## Notes / documents

- [ ] **Obsidian vault trio** (IN, author-specced 2026-07-05): (1) a **vault
  folder selector** Setting (the `csvFolder` pattern); (2) **Import Note** node —
  picks a `.md` from the vault, renders like an existing Note but READ-ONLY,
  frontmatter → typed output sockets, refreshable; (3) **Write Note** node — a
  sink writing a Note/record back to the vault as `.md` with frontmatter
  (arm/disarm Run-button pattern, like Write CSV). Parse/serialize halves exist
  (`noteFrontmatter.ts`); desktop-only via `fileBridge`.

## Packs

- [ ] **Set / relational pack** (author 2026-07-07 — parked as a pack idea, don't build
  unprompted). The core set nodes ship in-app: **Set** (union/intersect/difference/symmetric
  diff → `SetOpNode`) + **Set relation** (equal/subset/superset/disjoint → `SetRelationNode`).
  Candidate pack members surfaced while scoping, NOT built: (1) **"Is in" membership mask** —
  elementwise Contains: for each item in A, TRUE/FALSE if it's in B → a logical list aligned to
  A (the `ISNUMBER(MATCH())` pattern; pairs with Filter to keep original rows + their columns;
  the scalar `ContainsNode` only does one needle); (2) **Count distinct** — best as a new
  `ReduceOp` on `AggregateNode`, not a node; (3) **Anti / semi join** — new `JoinHow` modes
  (rows of A whose key is / isn't in B, keeping A's columns — the table-level set diff/intersect);
  (4) **Tally / value counts** — distinct value → count as a Frame (a bare-list shortcut; GroupBy
  already does it for frames). Skipped as niche: multiset (dup-respecting) ops, power set,
  Cartesian product, combination/permutation generation, Jaccard similarity.
- [ ] **More domain packs** — post-v1 polish (framework + Geometry worked example
  done). Don't build unprompted.
- [ ] **Pack variant-switch reconciles the socket set** — a simple pack's variant
  dropdown must add/remove sockets like Cast/read-as do (retype + reconcile), not
  leave stale ones.
- [ ] **Excel Timesavers pack additions** (proposal: `archive/timesavers-pack-proposal.md`)
  — ~25 formula-data presets + ~8 custom-logic + ~3 composites.
- [ ] **Pack distribution + dependency system** — LAST for 1.1 and a "maybe"; must
  land in tandem with subgraphs (`archive/v1.1-plan.md` B1 remainder).

## Desktop shell

- [ ] **Window min/max/close controls missing** (2026-07-06, dev + release): the app replaces the
  native titlebar with `tauri-plugin-decorum`'s `create_overlay_titlebar()` (`lib.rs` setup), and
  the controls aren't rendering. RULED OUT: the accent border (`set_window_border`/DWMWA_BORDER_COLOR)
  — disabling it did NOT restore them. Needs a live devtools look (F12 console — CSP/decorum errors?)
  or a decorum/tauri version check. Fallback if unfixable: drop the overlay for native OS decorations
  (guaranteed controls, loses the themed titlebar). Worked before; regression cause unknown.

## Cables / canvas / chrome

- [ ] **Weight the HTML-in-Canvas auto-engage threshold by node KIND — heavy charts
  should count for more than one node** (author 2026-07-08). Today the `"html"` renderer
  auto-engages purely on RAW node count: `HtmlCanvasLayer.tsx` `active = mode === "html"
  && nodeCount >= RENDERER_MIN_NODES (100)`, where `nodeCount` is
  `editor.getNodes().length` (the Setting is the master on/off; ON already MEANS
  "auto-engage at 100 nodes", it doesn't tune the threshold; `window.__hcMinNodes` tunes
  it live). The problem: raw count undercounts DOM cost. The DOM renderer's cost tracks
  total **DOM element count**, and **heavy charts dominate it** — one recharts figure is a
  large SVG subtree, so ~10 charts can be as DOM-heavy as 100 scalar nodes yet the graph
  reads as "10 nodes" and never trips the renderer. (Mermaid, inlined SVG — the new
  SvgPicker — and frame grids are the other heavy DOM producers; scalar/logic nodes are
  light.) Fix: replace the raw `nodeCount` in that gate with a **kind-WEIGHTED count**
  (chart/mermaid/svg/frame contribute >1 toward the 100; scalars = 1), so a chart-heavy
  graph engages the GPU renderer sooner. Keep it cheap (a per-kind weight table summed off
  the same nodecreated/noderemoved recount, not a live DOM element count). Exact weights
  TBD ("to some degree"). Hook: `HtmlCanvasLayer.tsx` (the `active`/`nodeCount` gate) +
  `nodeKindOf`. The companion DOM-reduction investigation LANDED 2026-07-08 (dev-notes
  digest "DOM-weight investigation": −29% on Famous Math, pixel-identical); remaining
  levers are the three items below.
- [ ] **SVG Picker: rasterize for display, inline only for hit-testing** (from the
  2026-07-08 DOM audit — the single biggest DOM lever when a big picture is on canvas):
  `SvgPickerNode.tsx` `well.innerHTML = source` permanently mounts every path of the
  source document (a US county map ≈ +40k elements). Display via `<img>` (blob URL,
  re-rasterized on zoom for crispness); swap the real SVG in on pointerenter for
  hit-testing/highlight, out on leave. Report embeds (`SvgFigure`) may keep inlining.
- [ ] **`content-visibility: auto` on node roots — untried experiment** (floated in the
  archived perf notes, never attempted): skips style/layout/paint for offscreen nodes
  without touching DOM count or visuals. Risks to check: rete's socket measurement
  (`offsetTop` queries force layout), minimap/fit reading sizes, the GPU clone capture.
- [ ] **Unmount collapsed viz nodes' live figures** (small, same pattern as the shipped
  Sparkline/Gauge single-mount): Chart/Histogram/Sankey/Treemap keep their full recharts
  tree mounted while collapsed (CSS-hidden); render it `{!collapsed && …}` off
  `collapseStore`. Only pays off on docs that keep collapsed charts around.
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
