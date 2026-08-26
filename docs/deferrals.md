# Deferrals — the parked / author-gated set (1.3 review list)

Everything the author has marked deferred, parked, author-present, or
only-if-triggered, gathered in ONE place. The backlog carries a single item —
**Deferral review** — that points here; nothing in this file is scheduled work
until that review promotes it. Ruled-out-forever ideas stay in
`out-of-scope.md`; the 2.0 flagships stay in `2.0-plan.md` (this list doesn't
duplicate them, just names them for the review).

## Pushed to 1.4 / 2.0 (the 2026-08-07 pivot — 1.3 ships as-is)
- **Headless card metrics (author 2026-08-27, via pretextjs.dev)** — every layout consumer
  (Tidy, docking, standoffs, lasso, minimap, HIC) sizes cards from mounted elements, which is
  what blocks RF `onlyRenderVisibleElements` (virtualization; the memory lever). A DOM-free card
  metric — `NodeCard`'s fixed row geometry as arithmetic, Pretext (pure-JS text layout, zero DOM
  reads) for the wrapped value/text boxes — would size unmounted cards and unlock virtualization,
  fit-before-paint and HIC painting labels itself. 2.0-shaped. First step landed 2026-08-27:
  `Surface.measured` (RF's post-layout measure) is the first tier of `measuredBox`, so layout
  math no longer forces reflows for mounted cards.

Feature-shaped backlog items moved here wholesale. **2026-08-23: the author reopened the
scope** — the engine/logic entries that were never really parked (distribution fitting,
correlated MC, trajectory capture, column profiling + summary footer, Tidy options, the
editing-surface kernel, lazy handles, value-popup gaps, eager-verb Polars mirrors, cube
Unnest, the XLOOKUP bypass) moved to `backlog.md`'s Execution queue; what stays here is
design-gated, author-present, or UI-eyeball work.

- **Solenoid-wide steal map** (competitor dive round 2, 2026-08-18 — author widened
  the scope past the Record family; sources in the session digest). Surveyed the
  Alteryx-pattern incumbents (KNIME/Alteryx, @RISK/Crystal Ball, Mathcad,
  Quantrix/Causal, Stella/Vensim, Power Query) plus canvas-UX donors (n8n,
  Blender, marimo/Observable). Every candidate below was verified ABSENT from the
  code and clear of `out-of-scope.md`, `decisions.md`, and the existing plan set.
  Already ours, no action: scenario sets, data-table sweeps, goal-seek, and
  simulation are composite RUN MODES; unpivot is a verb; stale dots, isolate,
  Tornado, As-Of, Note annotations all shipped; provenance Tier 2 and the
  compute cache are already parked entries.
  - **Pin a node's output** (n8n data pinning, KNIME caching): freeze a slow or
    live branch as its last value, visibly marked, recompute passes it through.
    Interacts with calc modes, the parked #23 compute cache, and the provenance
    story (a pinned value is a labeled literal) — needs its own design pass.
  - **Mute/bypass a node** (Blender M-mute, n8n deactivate): pass-through
    without unwiring for what-if surgery. Socket-lattice pass-through rules for
    multi-port nodes are the real design work.
  - **Peek any socket** (Blender viewer pattern): one gesture wires a floating
    preview to any output; today a peek needs a Display node or the right popup.
  - **Constrained optimizer** (Excel Solver, Mathcad solve blocks): min/max an
    output subject to constraints — the Solver-parity gap; Equation (equationNode)
    deliberately solves only `=`. Sibling-node-sized, its own author call.
  - **Fusion indicator** (Power Query folding indicators): show which verb chain
    fused into one Polars round trip vs materialized in JS — inspection surface
    for the engine seam; the lazy-handle engine work landed 2026-08-25.
  - **Dependency-cone hover brush** (marimo reactive highlighting): soft
    highlight of a node's upstream/downstream cone on hover; isolate is the
    heavy version, this is the glance version.
- **Record-family & adjacent display-surface steals** (author-ordered research
  dive 2026-08-18, rounds 1 and 3, across Airtable / Grist / Notion / Baserow /
  NocoDB / SeaTable / Coda; session digest has the sources). Candidates, best
  fit first — all display-side, none make the figure edit its frame:
  - **Gallery tile click → picks the row**: highlight the clicked tile and drive
    the card view's row from it, so gallery → card master-detail goes live
    (Grist's linked card-list pattern). The `picked` row output shipped with the
    Gallery/Board ops and was removed 2026-08-19, so this needs a channel that
    isn't a data output socket. A figure gaining an input gesture is an author
    call.
  - **Cover image**: a designated image field drawn full-bleed at the card top,
    label-less, with Airtable's crop/fit distinction (`object-fit` cover/contain).
    Universal in the genre (Airtable/Notion/Baserow/SeaTable). Authoring surface:
    an options key or a layout-text marker.
  - **Title row**: one field rendered label-less and prominent (Airtable primary
    field, Notion page title, Grist themes all have it).
  - **Card size presets**: S/M/L options key scaling the gallery track band
    (Notion/Airtable both offer exactly three sizes).
  - **Board lane polish**: per-lane card count, collapsible lanes (Airtable
    kanban has both; lane DRAG-reorder and card drag stay out — moving a card
    would edit the frame).
  - **Hide-empty option**: skip null-valued boxes in gallery/board cards
    (dense-card practice across the genre); the card view keeps its fixed layout.
  - **Wrap/clamp option**: line-clamp long values on tiles (Notion's wrap toggle
    inverted); the popup already shows the full card.
  - **Color-by field** (Airtable "color records"): conditionalFormatting-ADJACENT — conditional
    color is author-gated; goes nowhere without that session.
  - **Two-axis board (swimlanes)**: Airtable kanban notably LACKS it (their
    timeline has it) — a differentiator if the board ever grows; biggest scope
    of the set.
  Round 3 (author steer: UI surfaces around the record/gallery family):
  - **List view as a fourth Record op** (Notion list / Airtable list): one line
    per record, title field + trailing fields, dense browsing between card and
    gallery. Fits oneRecordNode exactly — views are ARGUMENTS of the one Record node.
  - **Grouped gallery sections** (Airtable gallery grouping): a group-by column
    renders labeled sections inside the gallery, the masonry packing per
    section — the board's lanes turned horizontal bands.
  - **Lane / group summary line** (Airtable GRID group summary bars; their
    kanban notably lacks it): per-lane or per-section count plus one aggregated
    column (sum/avg of a named column) in the lane header. Display-only, and a
    place to EXCEED the genre.
  - **Image lightbox** (Airtable attachment preview): click an image box in any
    record surface → full-size overlay with prev/next through the record's
    images or the gallery's cards. Today images render inline and clicks do
    nothing.
  - **Record navigation in the popup** (Airtable expanded-record prev/next):
    the card popup carries the pager so records flip without closing; keyboard
    arrows included.
  - **Peek dock** (Notion side peek): open value/figure popups docked to the
    right instead of center-overlay, canvas stays interactive; the Inspector
    dock (`sol-inspector-docked`) is the shipped precedent. Per-surface default
    like Notion (gallery → center, table → side) if it lands.
  - **Chip hover preview** (macOS Quick Look pattern): hovering a value chip
    shows a transient mini-preview before committing to the popup.
  - **Frozen header / first column in the table popup**: sticky header row and
    optional first-column freeze while scrolling wide frames; no such
    affordance exists in the popup grid today.
  - **Calendar figure** (Airtable calendar view, as a pure display figure):
    date-keyed records on a month grid, chips per day. SAME FAMILY as the
    timeline/Gantt figure the author MAJORLY deferred (2026-08-18, "loves
    Gantt, not now") — treat that ruling as covering this sibling until the
    author says otherwise.
  Not steals: drag-and-drop card layout editing (our layout is TEXT by design —
  wireable, Note-authorable), in-view search/sort/filter (upstream verb nodes
  are the Solenoid answer), form entry (its own program; entry widgets already
  landed 2026-08-18), timeline/Gantt (already author-deferred above), row
  tinting / color-by (author-gated conditionalFormatting).

- **Record-family lifts, remaining set** (Airtable/Grist sweep proposed with the
  Record node, 2026-08-18; author: "mostly fine". Standing constraint: every view
  lands ON the one Record node — ops, never a sibling node. The Gallery/Board ops
  and the Table-popup Form view (record-at-a-time entry) landed 2026-08-18; the
  `picked` row output landed with them and was removed 2026-08-19. Still queued:
  (1) select/categorical columns — author verdict 2026-08-18: "potential there for
  sure but needs a larger 1.4 look; backlog with interest". Two halves when that
  look happens: the DISPLAY half (per-value tinted chips for a string column's
  distinct values — opt-in "Chip" entry in the popup's per-column format row so
  the color stays user-authored under the Quiet Accent Rule; hues from the
  categorical chart palette, assigned by first appearance) and the FUNCTIONAL
  half (constrained entry: a datalist of the column's distinct values on grid
  and Form-view string inputs — cheap, no color, arguably the better lift). The
  larger question for 1.4: whether these become a real enum column semantic or
  stay display+entry sugar on string columns;
  (2) a timeline/Gantt figure from Task/Start/End columns — MAJORLY deferred
  (author 2026-08-18: loves Gantt, not now; Mermaid's gantt text remains the
  interim route). Author 2026-08-18b: probably a MUST eventually for the
  all-in-one feel; deferred on sheer scope. Scope note for the review: what
  makes competitor Gantts app-sized is the EDITOR half (drag-to-reschedule,
  reflow, resource leveling) — excluded here by the figures-display-only
  covenant. The Solenoid decomposition is (a) a display figure in the
  Waterfall class, (b) a Schedule computation (forward pass over
  Task/Duration/Depends; WORKDAY math already in `date.ts`) as a verb or
  composite preset, (c) no bar-editing ever — edits happen in the table.
  Not doing: linked-record columns (Join/XLOOKUP carry the semantics); row
  tinting (that is author-gated conditionalFormatting).
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
- **Document-level FC defaults** (default places / number format) — a
  format-pipeline integration, author-present.
- **Top-bar decorative art slot** — `TopBar.tsx` holds the empty middle-gap div;
  needs author art.
- **Moveable / resizable / hideable toolbar chrome** — customisation slice.
- **Computed Column UX tail** — shared column-picker component (Sort/Get Column/
  Join name columns as free text today), output-column format/unit controls on
  the CC node's card (popup half shipped), λ view-as on the card.
- **Aliasing / hidden-port promotion UI** (composites) — the data model has
  `hidden`/`advanced` per port; no UI to flip exposure or edit baked defaults.
  Includes the pack-shell "many ports → one shell parameter" aliasing.
- **AI palette later-if-wanted** — streamed reply rendering; OAuth-style connect
  instead of a pasted key.
- **Packs (the whole program)** — Materials & Mechanical (INTERPOLATE gate
  cleared; domain content remains — `pack-composite-plans.md`); Timesavers
  autonomous idioms landed (`packs/timesavers.ts`); the config-carrying date idioms stay an author call (below); composite pack-node shape (packs can't ship subgraphs yet); pack
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

- **compositeToolbarReroute — composite toolbar reroute** (top toolbar / mobile bar drive the
  active subgraph). Wants live eyeballing.
- **conditionalFormatting — conditional formatting for tables** — own design pass; must clear Excel's
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

- **Choppy zoom BAND (parked by the author 2026-08-25: "something we've been chasing
  our tail on massively").** An interior range of camera scales zooms choppier than both
  extremes; not pinned to a `k` range. The full record — what is ruled out (gesture-exit
  settle, element count, the HIC mip curve) and the untried T1–T8 plan — moved verbatim to
  `archive/dev-notes-history.md` (sweep 2026-08-25). Reopens only on the author's say-so,
  and then starts at T1/T2 (pin `k`, trace inside vs outside the band), nothing built before.

## Only if the trigger returns

- **Figure rasterize-at-rest (recharts + KaTeX)** — the last real DOM perf lever;
  SvgPicker precedent (raster at rest, live on hover; KaTeX re-rasters on zoom).
  Quality gate: pixel-crisp at any zoom, hover indistinguishable. Only when a
  real workload demands.
- **#23 persistent compute cache** · **#35 MCP port** — verdict pending a fresh
  author call (`v2.0/README.md`).
- **MMULT dimension algebra** — only if a dimensioned-linear-algebra use case ever
  appears; documented-strip is the deliberate stance (unitGranularity).
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
