# Deferrals — the parked / author-gated set (1.3 review list)

Everything the author has marked deferred, parked, author-present, or
only-if-triggered, gathered in ONE place. The backlog carries a single item —
**Deferral review** — that points here; nothing in this file is scheduled work
until that review promotes it. Ruled-out-forever ideas stay in
`out-of-scope.md`; the 2.0 flagships stay in `2.0-plan.md` (this list doesn't
duplicate them, just names them for the review).

## Pushed to 1.4 / 2.0 (the 2026-08-07 pivot — 1.3 ships as-is)

Feature-shaped backlog items moved here wholesale; none are 1.3 work.

- **Tidy options — expose ELK's layout knobs on the Tidy call** (author direction
  2026-08-12; the trigger was "9 nodes → 1 node should be able to lay out 3×3
  instead of one 9-high column"). Today `arrangeFn` hardcodes four options
  (`layered`, `RIGHT`, `nodeNodeBetweenLayers 55`, `nodeNode 38`); everything below
  is an ELK option we already pay for and don't offer. Measured on a 9→1 fan
  (uniform 180×120 cards, baseline 459×1408):
  - **Width cap / "wrap a wide fan"** — `layering.strategy: COFFMAN_GRAHAM` +
    `layering.coffmanGraham.layerBound: 3` → a clean 3×3 at 929×987, **on 0.8.2,
    no upgrade**. `MIN_WIDTH` + `minWidth.upperBoundOnWidth` also exists but
    layered raggedly (2/4/3). `elk.aspectRatio` has no effect on `layered`.
    elkjs 0.12's `layerUnzipping` does the same job better (929×**710**) and more
    surgically — normal layering, then ONE over-wide layer split into sublayers
    preserving crossing-minimized order, vs Coffman-Graham replacing the layering
    algorithm for the whole graph. See the elkjs item in `backlog.md`.
  - **Direction** — `elk.direction` RIGHT/DOWN/LEFT/UP. We hardcode RIGHT; a
    left-to-right vs top-to-bottom toggle is the most obvious control of the set.
  - **Density** — the two spacings as one Compact/Normal/Airy dial.
  - **"Don't scramble my arrangement"** — `layered.considerModelOrder.*`
    (`strategy`, `components`, `longEdgeStrategy`, `noModelOrder`, the crossing-
    counter influences). Available today; 0.12 adds `groupModelOrder.*` (8 options)
    and `portModelOrder` for much finer control.
  - **Straight cables vs compact** — `nodePlacement.strategy` (NETWORK_SIMPLEX /
    BRANDES_KOEPF / LINEAR_SEGMENTS / SIMPLE) + `favorStraightEdges`,
    `bk.fixedAlignment`, `bk.edgeStraightening`.
  - **Per-node pins** (a canvas affordance, not a panel row): `layering.
    layerConstraint` FIRST/LAST pins a node to the first/last layer;
    `layering.layerChoiceConstraint` / `layerId` assign an explicit layer. 0.12
    adds `crossingMinimization.inLayerPredOf` / `inLayerSuccOf` for "keep this one
    above that one" WITHIN a layer.
  - **Also there, unexplored**: `separateConnectedComponents`,
    `compaction.postCompaction.strategy`, `layering.nodePromotion.strategy`,
    `thoroughness`.
  OPEN QUESTION no ELK option answers: with a fan split across 3 sublayers, the
  first sublayer's cables must route PAST the later ones. ELK's edge routing is
  unused — `cablePaths.ts` routes with LENGTH as the primary sort key — so whether
  a 3×3 reads as a tidy block or as spaghetti is OUR router's business and needs
  eyeballing on a real canvas before any of this is worth shipping.

- **Record-family lifts, remaining set** (Airtable/Grist sweep proposed with the
  Record node, 2026-08-18; author: "mostly fine". Standing constraint: every view
  lands ON the one Record node — ops/outputs, never a sibling node. The `picked`
  output, the Gallery/Board ops, and the Table-popup Form view (record-at-a-time
  entry) landed 2026-08-18; still queued:
  (1) per-column summary footer on the Table popup (sum/avg/min/max/count via
  `forAggregate`);
  (2) select/categorical columns — author verdict 2026-08-18: "potential there for
  sure but needs a larger 1.4 look; backlog with interest". Two halves when that
  look happens: the DISPLAY half (per-value tinted chips for a string column's
  distinct values — opt-in "Chip" entry in the popup's per-column format row so
  the color stays user-authored under the Quiet Accent Rule; hues from the
  categorical chart palette, assigned by first appearance) and the FUNCTIONAL
  half (constrained entry: a datalist of the column's distinct values on grid
  and Form-view string inputs — cheap, no color, arguably the better lift). The
  larger question for 1.4: whether these become a real enum column semantic or
  stay display+entry sugar on string columns;
  (3) a timeline/Gantt figure from Task/Start/End columns.
  Not doing: linked-record columns (Join/XLOOKUP carry the semantics); row
  tinting (that is author-gated D4).
- **Image as a real FrameColType** (author proposal with the Record node, 2026-08-18;
  evaluated and deferred). A first-class `image` column touches every layer that
  switches on `FrameColType` — both FrameBackends and the cargo parity corpus, CSV
  read/write, coercion, socket coloring, the popup editor — for a payload Polars
  cannot compute on. What the proposal was FOR (a picture rendering inside a Record
  box) shipped without it: `recordImageSrc` detects `data:image/` and
  image-extension URLs in plain STRING cells at the display layer. Reopen only if
  images need to behave differently from strings inside the ENGINE (e.g. an
  attachment store bundling frame images the way the Image node bundles its file);
  the next cheap slice would be the same detection in `TablePopup` cells.
- **iFrame / embed node** — web-embed out the `chart` socket. Gate call: CSP
  `https:` vs domain allowlist. Non-negotiables when built: `sandbox` without
  allow-top-navigation, `referrerpolicy=no-referrer`, https-only, click-to-load,
  no off-screen render + capped concurrency.
- **Data Feed widening** — real symbol-search picker + more providers (shipped
  baseline: FRED keyless / Alpha Vantage keyed). Stays Excel STOCKHISTORY scope —
  no crypto/FX/real-time/options/fundamentals.
- **Editing-surface kernel — make the canvas installable, and the drill-in a
  second instance of it** (author direction 2026-08-13, "why do we not just spawn
  a second canvas?"). The drill-in already IS a second rete stack (`getDrillMount`
  builds its own Area/Connection/React/History/Minimap plugins over the composite's
  `internalEditor`); what can't be spawned twice is `Canvas.tsx`, whose behavior
  set lives as closures inside one `init()` effect married to module singletons
  (`setEditorRefs`, `documentStore.restore()`, and ~10 one-slot callbacks —
  `setAutoArrange`/`setDeleteSelected`/`setBulkSettle`/`setStandoffSettle`/…). A
  second mount would fight over every slot and restore the document into the
  subgraph. `activeGraph.ts` was the answer for chrome OUTSIDE the canvas (and it
  works); nothing rescues the behaviors INSIDE the init closure, which is the whole
  of the drift below.
  - **Phase A — extract the kernel.** Grow `areaPresets.ts` into
    `installEditingSurface({ editor, area, container, history, selector, hooks })`,
    moving Canvas's closures out one at a time, parameterized rather than ref-bound:
    gesture/tap record + selection semantics (click-collapse, deferred Ctrl-toggle,
    right-click-preserves); **drag-guard patching — now a scheduled 1.3 BUG with a
    measured repro, see `backlog.md` "A finger pan is DEAD inside a drill-in"; it lands
    first and drags the tap-to-select companions with it**; the connectionpick/drop
    pipe; the `connectioncreate` enforcement pipe
    (duplicate / self-loop / socket-type / FC-unit conflict / collapsed-extensible
    reroute); semantic zoom + zoom-settle promotion; minimap rAF coalescing; grid
    snap, Shift axis-lock, Ctrl align-snap; cable-deselect-on-background. Canvas
    consumes each extraction immediately, so every step DELETES main-canvas code
    instead of adding a drill-side copy. Main-only layers stay behind: engine +
    `setEditorRefs` + document restore, groups/standoffs/FC-docking/conduits/isolate
    snapshot.
  - **Phase B — swap the drill mount onto it**, then delete the hand-copied
    connectionpick mirror and most of the keyboard fork; `canvasKeyboard.ts` flips
    from "bail while drilled" to "act on the active graph" behind a capability mask
    for what a subgraph genuinely lacks (G/groups, standoffs, pins).
  - **Phase C — pin it**: kernel unit tests (the behaviors are functions by then) +
    extend `surfaceParity.test.ts`'s drift pin from three installers to the full set;
    extend `activeGraph.test.ts`'s lock.
  - **Phase D — the parity tail**, each trivial once the kernel exists: quick-wire
    in the drill-in; socket/cable context menus scoped to what applies inside the
    `any` boundary (conduit insert, attach-FC); command palette while drilled;
    PER-NODE re-render on a pass instead of the whole-level sweep (the run-gate
    landed 2026-08-13 — this is the finer cutoff, needing a per-internal-node
    changed-output signal like the main pass's `changedOut`/`sinks`).
  - Still out at every phase, unchanged: (a) Group/Cleanup/Autofit/Expand inside a
    drill-in (needs group-drag reconcile + push/standoffs/GroupNode taught the
    active area); (b) Navigator + lasso while drilled in. The toolbar reroute (D2
    proper) stays in its own author-present entry below.
- **Document-level FC defaults** (default places / number format) — a
  format-pipeline integration, author-present.
- **Top-bar decorative art slot** — `TopBar.tsx` holds the empty middle-gap div;
  needs author art.
- **Moveable / resizable / hideable toolbar chrome** — customisation slice.
- **Lazy-handle-on-cable** (`frameBackend.ts`) — retire the `collect()` bridge so
  handles flow and materialization happens only at `preview`/`column`.
- **Computed Column UX tail** — shared column-picker component (Sort/Get Column/
  Join name columns as free text today), output-column format/unit controls on
  the CC node's card (popup half shipped), λ view-as on the card.
- **Aliasing / hidden-port promotion UI** (composites) — the data model has
  `hidden`/`advanced` per port; no UI to flip exposure or edit baked defaults.
  Includes the pack-shell "many ports → one shell parameter" aliasing.
- **Value-popup gaps** (author parked all, 2026-07-27): sort only covers the
  loaded 1,000-row window (the one that can quietly mislead); Copy/CSV/Export
  emit source order under a visual sort; `− Row`/`− Col` remove the last DATA
  row; the grid has no keyboard path (largest gap vs "zero learning curve").
- **AI palette later-if-wanted** — streamed reply rendering; OAuth-style connect
  instead of a pasted key.
- **Packs (the whole program)** — Materials & Mechanical (INTERPOLATE gate
  cleared; domain content remains — `pack-composite-plans.md`); Timesavers
  remainder (config-carrying date idioms, duration trio, Split Name, list
  reducers); composite pack-node shape (packs can't ship subgraphs yet); pack
  distribution + dependency system (saves don't record required packs; owns the
  ABSENT-pack formula diagnosis + `initPackFormulas()` re-run on folder reload).
- **Distribution accuracy widening** — representative-point validation only
  today; widen if accuracy is ever in doubt.

## Needs an author decision before any build

- **Everyday widget nodes (v2.0 bundle 16)** — Weather / Geocode / FX / Holidays /
  TZ Convert / QR. Tier 1 is autonomous-friendly and could be 1.3, but 4 gate
  calls come first: `v2.0/16-widget-nodes.md`.

- **Timesaver date idioms needing a config widget or a judgment call** — Fiscal
  Quarter (start month), Age (DATEDIF "MD" nuance), Nth Weekday. The zero-config
  idioms (Quarter, Days in Month) already shipped in `packs/timesavers.ts`.

- **Expression `/` doesn't mint a pure ratio** — the Divide NODE mints `5:1` on a
  same-dimension cancel; Expression strips UnitCells at its boundary, so `a/b`
  yields a bare number. Decide: leave (Expression is deliberately type-agnostic —
  likely fine) or make Expression unit-aware someday.
- **Error UX on restriction violation** — typed error out the socket vs the node
  flagging the offending input locally. Pending a call.
- **Traveling-cable flow pulse → maybe the app's cables** (author likes the landing
  page's marching-dash rendering, `LandingScenes.tsx` `.sol-cable__flow`).
  Touches the never-degrade-cables rule and DESIGN.md's no-decoration stance —
  it would make the pulse MEANING, not decoration.
- **Feature/value copy doc** for landing/marketing — author will initiate; ranked
  candidate copy lines per feature, author ranks value.
- **INDEX — marked for later (2026-07-01, `archive/cube-node-scope.md`)**: output
  socket should express Cube (today singular `any`); Excel range forms
  (`row=0`/`col=0` whole row/col, the reference form) — Solenoid INDEX is cell-only.

## Author-present build sessions (2.0 flagships — see `2.0-plan.md`)

- **D2 proper — composite toolbar reroute** (top toolbar / mobile bar drive the
  active subgraph). Wants live eyeballing.
- **D4 — conditional formatting for tables** — own design pass; must clear Excel's
  version by a lot; Display-node-only; must not step on FC format/units territory.
- **Excel `.xlsx` transpiler** (`v2.0/08`) — deliberately sequenced late.
- **v2.0/10 decision sensitivity** — buildable (its Monte Carlo hook shipped);
  needs re-triage / an author pick.
- **v2.0/12 uncertain values + money mode** — sequenced dead last; each needs an
  author representation call first.

## Author-present polish

- **FC A4 tails**: per-element mixed-unit trig (a list mixing deg/rad cells should
  interpret EACH cell in its own unit — `resolveTrigModes` still reads one
  socket-level unit); Cube popup FC controls (frames/matrices/lists have the
  per-column format+unit row in `TablePopup` via `fcControls.tsx`; cubes wait on
  nothing now that `CubeColumn` is typed).

## Parked bugs (explicitly parked by the author — records in `dev-notes.md`)

- None currently. (The header/body border seam and the note-family selection-ring
  overhang, formerly parked here, were both SOLVED 2026-08-05 — one-paint SVG
  `CardFrame` and border-recolor rings; see the dev-notes digest.)

## Only if the trigger returns

- **Figure rasterize-at-rest (recharts + KaTeX)** — the last real DOM perf lever;
  SvgPicker precedent (raster at rest, live on hover; KaTeX re-rasters on zoom).
  Quality gate: pixel-crisp at any zoom, hover indistinguishable. Only when a
  real workload demands.
- **Native Polars mirrors for the eager cleanup verbs** (fillBlanks /
  replaceValues / sliceRows are trivially lazy; today they materialize like
  Split Column). Only if a real workload demands.
- **#23 persistent compute cache** · **#35 MCP port** — verdict pending a fresh
  author call (`v2.0/README.md`).
- **XLOOKUP `rawInputs` bypass retirement** — with typed frame→cube the bypass is
  unneeded; the frame + cube lookup paths could collapse to one.
  Behavior-touching refactor of a covered node; only if it pulls weight.
- **MMULT dimension algebra** — only if a dimensioned-linear-algebra use case ever
  appears; documented-strip is the deliberate stance (D20).
- **Provenance Tier 2 — on-demand "why is this?" walk** — backward-derivation
  trace for any value (Tier 1, error origin + fly-to-source, shipped in
  `errorValue.ts`). Idea salvaged from the archived provenance bundle.
- **Inside-solve stale dot is uniform** — after an INSIDE Solve the dot reads green
  though the held result is seed-based; distinguishing needs a drill-state signal
  in the compute layer (couples `data()` to `compositeEditorStore`). Left simple
  on purpose; revisit only if it reads as misleading.
- **Pack variant-switch reconciles the socket set** — a variant dropdown would
  add/remove sockets like Cast/read-as do. (The existing custom nodes all keep
  fixed sockets across their dropdowns, deliberately — nothing waits on this.)
- **Obsidian follow-ups (if wanted)**: auto-reload an imported note on file
  change; write config for `![[Note]]` transclusion vs inlining an embedded
  note's body.
- **Cube-aware Unnest (peel ONE level)** — the inverse of cube-aware Nest Join;
  needs an `any`/cube output (a peeled depth-2 cube is a depth-1 cube), so a
  socket-shape change, not just an engine tweak (`archive/cube-node-scope.md`).
- **Group-by-into-nesting / a top-edge "grid" Build Cube** — considered-and-dropped
  ideas the cube doc keeps on the table; add only on demand.

## Parked features (revisit only if the trigger returns)

- **UI-scale toggle (Default / Larger)** — subsumes all per-panel resize asks;
  don't build per-panel resize.
- **Cable collision avoidance** — spec: `archive/cable-routing.md` §2.
- **Grid system** — spec: `grid-system.md`.
- **`content-visibility: auto` on node roots — ruled out** while socket positions
  are measured from live DOM geometry (off-screen subtrees don't compute
  descendant layout → cable endpoints jump at the viewport edge). With
  SVG-picker-rasterize + collapsed-figure-unmount shipped, the DOM-weight lever
  set is exhausted — the GPU renderer is the remaining path at scale.
