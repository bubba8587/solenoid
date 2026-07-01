# Solenoid dev notes — archive (2026-06-18 and earlier)

Relegated from `dev-notes.md` on 2026-06-21 to keep the live log lean: older resolved session entries + finalized reference sections (node-authoring kit, socket types, roadmap stance, technical gotchas, old TODOs). Current notes live in `docs/dev-notes.md`. Entries keep their original `## Title (date)` headings, so this reads as a topic-titled history.

---

## Perf pass off the research doc (2026-06-18)

Working from `docs/perf-optimization-research.md` (the handoff analysis). The
working branch already had: rAF-coalesced lasso selection, rAF-coalesced
group-drag member follow, memoized minimap rects. This pass added three more,
all green on the full suite (465 tests) + typecheck:

- **Pan/gesture hover gate** (`Canvas.tsx`, socket-hover handler). The per-move
  `document.elementsFromPoint()` hit-test (a synchronous layout read) now
  early-returns when `e.buttons` is set. Any held button = an active gesture
  (pan, node-drag, lasso), and hover highlight is a rest-state affordance, so the
  read is pure waste then. Cheaper than the `.solenoid-canvas--panning` class
  read the doc suggested, and covers more gestures. §3 Pan.
- **Cable path cache** (`ConnectionComponent.tsx`). The component subscribes to
  ~13 stores, most of which change only *appearance*, yet every bump re-ran
  `getCablePath` (the routeWalk/spline solve) in the render body. Added a
  module-level per-connection cache keyed on geometry (shape + endpoint coords +
  both angle hints); appearance-only re-renders (hover/selection/flow/value)
  reuse the string, only real endpoint/shape moves re-solve. NB: used a module
  cache, not `useMemo` — the two early returns before the main path mean a hook
  there would break the Rules of Hooks. Also incidentally de-fangs zoom (cable
  geometry is canvas-space, unchanged on zoom → cache hit). §4.1.
- **Lasso live-frame trim** (`Canvas.tsx`, the worst offender per the doc).
  (1) Node screen-corners cached once at lasso start (`cacheNodeRects`) instead
  of an O(N) `getBoundingClientRect` per coalesced frame — valid because a lasso
  owns the pointer so nothing pans/moves during it. (2) The precise cable
  hit-test (`getTotalLength`/`getPointAtLength` sampling, O(C×samples)) is
  deferred to release; live frames select nodes only. (3) Frame-level skip when
  the matched node-id set is unchanged, so growing the lasso over empty space
  doesn't re-render every selected node. Behavior change: cables highlight on
  release, not live during the drag — the doc endorses this. §3 Lasso.

Second sub-pass added:

- **Socket-hover fan-out narrowed** (`ConnectionComponent.tsx`, §4.2). Hovering
  one socket bumps `socketHoverCableStore` once but every cable subscribed to its
  global *version*, so all re-rendered. A standalone cable now subscribes to its
  OWN `isHovered(data.id)` boolean (Object.is-equal snapshot → no re-render on an
  unrelated hover). Ribbon members share appearance (one member lit ⇒ whole
  bundle lit), so they keep the global-version subscription via a `ribbonRef`
  gate set after `ribbon` is computed. The subscription value is a re-render key
  only; the real `socketHovered` boolean is read separately, so the mixed
  boolean/number snapshot type is harmless. Selection narrowing was NOT done —
  `ribbonSelected` couples to other members' selection and a correct per-id
  snapshot would need a ribbon lookup per notification (no clear win); the path
  cache already makes those re-renders cheap.
- **Path cache eviction** — `_pathCache` entry deleted on unmount/id-change so it
  can't grow unbounded over a long cable-churn session.

**Tauri target reality (see research doc's new section).** Deployment is a Tauri
v2 webview, NOT the dev Chrome: Windows=WebView2 (Chromium), macOS=WKWebView,
Linux=WebKitGTK (both WebKit, SVG-weak). CLAUDE.md's "Tauri ships Chromium" holds
only on Windows. Upshot: the §2 SVG→canvas migration matters MORE for the
shipping app if mac/Linux are targets; profile perf in the packaged build, not
just `vite dev`; WebView2 `additionalBrowserArgs` is a Windows-only GPU lever
(experiment, not a substitute for §2); Rust compute offload exists but compute
isn't the bottleneck. The web build doesn't have to be 100% smooth.

Third sub-pass:

- **Live standoff settle rAF-throttled** (`Canvas.tsx`, §3). The O(network²)
  solver ran on every `nodetranslated` (per pointermove); now coalesced to one
  solve/frame on the latest positions (converges identically), with the exact
  final settle still on drop and the pending rAF cancelled on drop.
- **Cable SVG bounded to its bbox** (`ConnectionComponent.tsx`, §2 partial). Each
  cable rendered into a 9999×9999 (~100MP) `<svg>` anchored at the holder origin;
  now `boundedSvgProps` positions the `<svg>` at the cable's content bbox with a
  matching `viewBox` (64px pad, `overflow:visible` covers any underestimate, so
  no path-string changes and zero interaction/flow change). Tests stay green.

  **Root-cause correction (important).** The research doc claimed the 9999² SVG
  was the keystone blocking holder GPU-promotion for pan. Reading the actual
  in-code rationale (`Canvas.tsx` ~2025-2046) shows that's WRONG: pan isn't
  promoted because the **holder (whole-graph extent) exceeds the GPU max texture
  → the layer tiles and re-rasterizes tiles on a pan-translate → flicker of heavy
  content**, a *tested-and-rejected* change, and a **mobile** constraint (desktop
  already promotes for zoom via the `IS_MOBILE` gate in `onZoomActivity`). So
  bounding the cable SVG does NOT unblock pan promotion, and I did NOT flip pan
  promotion (would reintroduce the flicker). The bounding is kept as hygiene
  (smaller invalidation rects, no 100MP smell, prerequisite for future
  per-element compositing). A full-graph `<canvas>` cable layer would hit the
  same max-texture wall for *promotion*; its real benefit is cheaper *un-layered*
  repaint (one canvas vs N SVG elements). Doc §2/§2 correction updated.

Fourth sub-pass (per-element paint, the lever that actually fits the holder-size
constraint — §2.3):

- **Gesture-gated shadow drop** (`canvas.css`). box-shadow is the most expensive
  always-on paint property and the holder isn't composited, so a pan repaints
  every node's shadow every frame. Reusing the existing `.solenoid-canvas--panning`
  class (already pauses flow beads), `.solenoid-node` and `.solenoid-group__header`
  drop their box-shadow during any pointer gesture and fade back on release (the
  card's existing `transition: box-shadow 80ms`). Selected nodes keep their accent
  glow. Pure CSS, no clipping (shadow is paint-only, no reflow).
- **Transient drag-layer promotion** (`Canvas.tsx`). On `nodepicked`, the picked
  node + selected set get `will-change: transform` (capped at 32 els, else
  repaint); cleared on `nodedragged`. Moving a heavy node (chart/big table)
  becomes a compositor translate instead of a per-frame repaint. Bounded to the
  moving set, so it sidesteps the holder-size wall that forbids holder promotion.

Not yet done: the canvas cable layer for cheaper un-layered cable repaint (large
effort, more valuable on WebKit per the Tauri note); `content-visibility: auto` on
off-screen node roots (§2.4, cheap to try but uncertain on transformed/absolute
rete nodes); group-drag direct-transform (§3, lower priority now the standoff
solver is throttled).

## Viewport culling REMOVED (2026-06-17)

`cullStore` and its wiring were ripped out. Culling decided which cables to draw
from whether *both* endpoint nodes were near the viewport, so a long cable whose
path crossed the screen but whose endpoints were both off-screen vanished while
panning — a visible, annoying bug. Culling was only ever the targeted fix for the
expanded-group raster flicker (heavy recharts/cards), not the general pan-lag fix
(node components don't re-render on pan; the LOD tiers handle the zoomed-out
case). Removed: `culledNodeComponent` wrapper, `recomputeCull`/`scheduleCull`,
the `ConnectionComponent` cull gate, and the `cullStore` files. The zoom-only
`will-change` GPU layer (`onZoomActivity`) stays. If big-graph pan flicker
returns, re-introduce culling but key cable visibility off *path*-crosses-viewport
(box spanning the endpoints intersecting the view), not both-endpoints-kept.
(The "## Pan compositing" / "### Viewport culling" sections below are historical.)
(Project knowledge lives here in the repo, not in agent memory.)

## Personal Finance flagship seed (2026-06-17)

Added `seedGraphs/personal-finance.json` — the big "killer demo" graph (96 nodes,
88 wires, 9 groups, 4 pins, 2 standoffs). Data is NOT baked into nodes: three
CSVs live in `public/data/personal-finance/` (transactions, accounts, budgets)
and load via **Web Source** nodes at the same-origin path `/data/personal-finance/*.csv`.
Same-origin = no CORS on the hosted web demo and in `vite dev`; Vercel serves
`public/` static files ahead of the SPA rewrite, so the `/data/*.csv` paths
resolve (desktop/Tauri would need an absolute URL or the CSV File node instead).

Clusters: data sources → cash-flow (sign-test + mask-multiply SUMIF, savings-rate
gauge/alert) → spending pivot (GroupBy sum/count + Chart) → net worth (GroupBy by
type, goal gauge, emergency-fund alert) → retirement projection (TVM-FV off
sliders, growth sparkline, off-track alert) → mortgage stress-test (TVM-PMT +
CUMIPMT, 28%-affordability alert) → budget-vs-actual (Slicer → reduce → over-budget
alert) → KPI Conduit into a collapsed Dashboard group. A loose "Assumptions" group
holds the stray hand-entered inputs (inflation, emergency target, take-home, years).

**Ribbons & Format Controllers (v2 pass).** KPIs leave each source group through
an *in-group* **Conduit** (`cd-cash` 4-lane, `cd-acct` 3-lane, `cd-mort` 2-lane),
so the bundle renders as one **Ribbon** across the gap into the (expanded)
Dashboard group — conduits-inside-groups → ribbons-between-groups. Money/percent
**Displays** carry a docked **Format Controller** (18 of them) so they read as
`$1,234.56` / `46%` instead of raw numbers. Implementation gotcha: an FC docked to
a Display that lives inside a group would, at its docked position, sit *inside*
the group box → `seeds.test.ts` flags it as a bystander that group-reconcile will
absorb. Fix: FCs are **not** group members and are **parked outside every group
box** in the seed (a row at y≈2780); they snap onto their host socket on load via
`dockedNodeStore` + the post-load `repositionDockedNodes` RAF, and group-push
already infers a docked node's group from its host (`groupPush.ts` ~L193), so they
follow correctly without membership.

Other v2 fixes: spending pivot is now **expenses-only** (a Slicer drops Income, so
the Chart isn't dominated by the +16910 income bar) with absolute per-category
spend; assets/liabilities pulled from the by-Type GroupBy with **INDEX**; lifetime
interest negated to a positive `$`; a **Target savings rate** slider now drives the
low-savings alert so it's interactive.

**Mobile performance pass.** The full graph is 129 nodes incl. 7 recharts-backed
viz (Charts/Sparklines/Gauges), which dragged on mobile. Fix: the six *machinery*
groups (cash, pivot, net worth, projection, mortgage, budget) now ship
**collapsed by default**, leaving Data sources + Assumptions + Dashboard expanded.
A collapsed group hides all its member nodes — so on load **every recharts node
and all three conduits are hidden** and only render when the user expands that
card; the initial canvas is ~3 input nodes + the 10-display dashboard + collapsed
cards. The collapse path is built for this: a hidden **Conduit member** whose
outputs all leave the group renders as one **ribbon trunk** fanning out of the
collapsed card (`groupCollapse.ts` L37/L232), and a grouped Display's value still
shows (formatted) via the Display→FC hop — which is why every FC was made a
**group member** (parked at its host's coords, snaps to the socket on load). It's
fully reversible (one click per card) and loses no content.

Authored in code: `scripts/gen-personal-finance-seed.cjs` emits the JSON
(coordinates + auto-sized group rects). `seeds.test.ts` validates every
node/socket/group against the real classes; `pfSeedCheck.test.ts` is a data
sanity guard (income ≈ 16910, net worth ≈ 101010 with assets 123650 / liab −22640,
expenses-only pivot excludes Income, groceries spend > the seeded budget so the
alert is primed). Group rectangles + the long cash→dashboard ribbon are rough on
purpose — meant to be hand-tidied in-app.

## Pan compositing — promote the holder layer during view moves (2026-06-17)

Big graphs (e.g. the Personal Finance seed: 129 nodes, 123 cables, ~5600px wide)
stuttered when **panning**, separate from any recompute. Cause: rete pans by
writing `transform: translate(x,y) scale(k)` to `area.area.content.holder` every
frame, and that element has no compositor-layer hint — so the browser repaints
the whole surface (every node card + cable SVG) each frame instead of just
translating a cached layer. Node React components do NOT re-render on pan (paths
are in canvas coords inside the transformed holder), so this is pure paint, not JS.

First attempt (REVERTED): set `holder.style.willChange = "transform"` while the
view moves, giving it a GPU layer. This made *collapsed* pan smooth but the
holder surface (~5600px) is larger than the mobile GPU max texture, so the layer
tiles and re-rasterizes during the transform — which **flickered the visible
heavy content** (recharts/cards) whenever a group was expanded. A layer that
flickers the on-screen nodes is worse than the original lag, so the will-change
hint was removed. The actual fix is to paint *fewer elements* (culling, below) so
a plain un-layered repaint per pan frame is cheap — no tiling, no flicker.

The zoomed-out case is already handled by the existing two-tier LOD.

### Viewport culling (`cullStore.ts`, 2026-06-17)

The holder layer alone left a regression: **collapsed** pan was smooth, but with a
group **expanded** the nodes flickered as the GPU layer re-rasterized heavy
content (recharts/cards) tile-by-tile faster than it could keep up. Collapse
doesn't help because it only sets `visibility:hidden` — every one of the 129
nodes + 123 cables stays mounted and in the display list the rasterizer walks.

`cullStore` fixes this by actually not rendering content far from the view:
- Canvas's `recomputeCull` (throttled to a rAF, run on transform, `rendered`,
  and node add/remove/translate) computes the node ids within the viewport + ~1
  screen of margin, plus the immediate **neighbours** of those nodes so every
  on-screen cable can still measure both socket endpoints. That set goes into
  `cullStore`.
- Each node is wrapped (`culledNodeComponent`, memoized per real component) and
  renders `null` when its id isn't kept; `ConnectionComponent` renders `null`
  when either endpoint isn't kept (fully off-screen cables only, by the halo
  rule). Both read their OWN membership via a boolean `useSyncExternalStore`
  snapshot, so a recompute re-renders only the few nodes/cables whose visibility
  flipped at the edge — never the whole graph.
- Culled nodes keep their JS width/height (NodeCard's ResizeObserver just
  unmounts), so the bbox stays valid and they re-mount when scrolled back toward
  view. Inactive until the first recompute and disabled on teardown, so anything
  reading it early (or tests) sees a fully-rendered graph.

Net: panning a large graph only ever rasterizes the handful of nodes/cables in
view (+margin), which both smooths pan and removes the expanded-node flicker,
collapsed or not. Kept alongside the holder layer-promotion (they compound:
fewer elements per tile → faster raster).

## Disk-primary file handling (2026-06-16)

Reworked Save/Open around real files on disk (the in-app localStorage documents
become the working store + crash-recovery + recents; a document can be bound to a
file path and Save writes straight through). Decided with the user: **disk files
primary**, and **remove all the disabled menu stubs**.

- `fileBridge.ts` gained the write side: `saveTextFileDialog` (Tauri `save` +
  `writeTextFile`; browser → blob download), `openTextFileDialog` (Tauri `open` +
  `readTextFile`; browser → file input, with focus-based cancel detection),
  `writeTextFilePath`, `fileNameFromPath`. Capability: added
  `fs:allow-write-text-file` scoped `$HOME/**` (`dialog:default` already covers
  save). **Not runtime-verified** — needs a `tauri dev` pass like the CSV node;
  saving OUTSIDE `$HOME` won't work without broadening the scope.
- `fileSession.ts` orchestrates: `saveToDisk({forceDialog})` (write-through when a
  path is bound, else dialog → bind path), `openFromDisk()` (→ `importAsDocument`
  with the path). `SolDoc` gained `filePath?` (in documentStoreCore, threaded via
  `setDocPath`/`bindCurrentToPath`/`currentFilePath`; a DUPLICATE deliberately
  drops the path — it's a new unsaved file).
- UI: File menu → Open / Save (Ctrl+S) / Save As (Ctrl+Shift+S); TopBar buttons +
  Canvas keyboard handlers (preventDefault to block the browser's own save/open).
  Removed the four dead stubs (Export CSV, Export PNG, Import CSV, Name manager).
  DocumentTitle ▾ menu now has per-row **Duplicate + Remove** (the can't-delete
  hole) and reads "Recent documents". Old `exportGraphToFile`/`importGraphFromFile`
  deleted (superseded).
- **Deferred:** a dirty/unsaved-vs-disk indicator in the title (autosave-to-
  localStorage means nothing is lost, but the disk file silently lags until Save);
  broadening write scope beyond `$HOME`; the runtime tauri check.

## Alert redesign, Alerts HUD, Image node, right-click fix (2026-06-16)

A session on the `working` branch. Invariants live in CLAUDE.md ("Alert node +
Alerts HUD", the Image annotation note, the contextmenu architecture note); the
headlines:

- **Alert node, reconceived.** Was a fixed range checker that emitted a status.
  Now a `mode` dropdown (range / equals / boolean / text) picks the trigger
  condition AND the live sockets (`ALERT_MODE_KEYS`, TVM-style hide + stale-cable
  drop). It **fires a toast + logs to a HUD** when its condition is met. Several
  rounds of getting the firing right:
  - Started with a `lastTriggered: boolean | null` baseline that swallowed the
    FIRST eval — so wiring an already-out-of-range value never fired. Fixed by
    seeding the baseline at construction.
  - "Carry-over" bug: trigger is-true with a value, switch to range, value still
    out of bounds → sat pre-triggered silently. Fixed: a mode change re-evaluates
    the new condition fresh (compare against `NO_STATUS`).
  - "LOW→HIGH should re-fire": edge detection now keys on the STATUS (`statusKey`),
    not a boolean — re-fires on any change between alerting statuses, silent on
    same-status and on return-to-calm.
  - boolean = `=== 1` (TRUE), not any nonzero — this app encodes booleans 1/0.
  - Verbiage neutralized: an Alert is a watch/notify, not pass/fail. Dropped
    ✓/⚠ for a neutral state dot; messages are plain ("150 above 100", "equals 7");
    "Target" socket → "Match".
- **Alerts HUD.** `alertStore` (capped, transient, NOT persisted) + `fireAlert`
  (logs + `pushNotice`). `AlertLayer` mirrors `PinLayer`. New `HudStack` owns the
  right-side fixed column and stacks pins above alerts, so the alerts button sits
  below all pins at any pin count; `PinLayer` lost its own portal/fixed wrapper.
- **Image node** (`nodes/annotation.ts`, in the Add menu's "Other" category). A
  sockets-less picture annotation like Note. Local-file attach OR web URL; height
  field (no socket). Web `url` persists; a local file's base64 `dataUrl` is
  session-only (kept out of the extractInit whitelist — the JSON save can't embed
  image bytes yet; **bundling is the follow-up**). Height field uses
  `useDraftCommit` — I first hand-rolled a live-clamped number input that couldn't
  be cleared to retype (the old immediate-onChange bug; always use the helper).
- **Right-click was broken on ALL nodes.** A prior patch gated the contextmenu on
  `target.closest(".rete-node")`, but that class exists only in our CSS — rete
  applies it to nothing, so the gate matched nothing. Replaced with the
  authoritative `area.nodeViews` containment check (fixes regular nodes, Notes,
  Groups uniformly). Removed the dead `.rete-node { cursor: grab }` rule and gave
  the grab cursor to the real root classes (`.solenoid-node` was `cursor: default`,
  which had overridden the dead wrapper rule anyway).
- **Table node colour.** Added a `table` node kind (`NODE_KIND_ACCENTS.table =
  #e96b3c`, matching the `--sock-table` vermilion) and routed the matrix/table-
  lambda nodes to it in `kind.ts` — they were falling through to `math` (blue)
  while their sockets were orange. Table Input's Add-menu accent was green; fixed.
  Renamed the "Frames & Matrices" category to "Tables & Frames".

## Error rollout + UI/layout pass (2026-06-15)

A session of error-system completion plus assorted UX/layout fixes. Details
live in CLAUDE.md (the invariants); the headlines:

- **Error values, finished.** Shape errors unified into the typed `#SHAPE!`
  (coercion throws → the error-value guard tags it — no more `#DIM!` string).
  Producer sweep converted the genuine null/NaN failures across finance / scalar
  / stats / convert / cast / text / matrix / list to typed `SolError`s (scalar-
  level only — lists keep per-element `null` blanks). `#CIRC!` is detected in
  `processGraph` via Tarjan SCC + engine-cache seeding (the pull engine
  DEADLOCKS on a loop, it doesn't throw). `DisplayNode` joined `SEES_ERRORS` so
  it shows AND forwards errors (it reads `cachedValue`, which the generic
  short-circuit doesn't mirror to). `TableDisplay`/`FrameDisplay` made
  SolError-aware. The **`error-codes` seed** is the showcase: each code wired
  producer → Display → ISERROR; tests in `errorSeed.test.ts` /
  `errorIntegration.test.ts`.
- **Tidy port preset.** The ELK `classic` preset staircases chains upward
  (output ports at top, input at bottom). Replaced with a symmetric preset +
  a Center/Top `tidyAlign` setting; the post-layout anchor now preserves the
  vertical CENTRE, not the top. (See CLAUDE.md "Auto-arrange / Tidy".)
- **Group autofit no longer changes membership** — only explicit drag in/out,
  select→group, or a manual box resize do (CLAUDE.md group section).
- **IS-check → "Test"**, ISLOGICAL displayed as ISBOOLEAN (op value unchanged).
- **Chrome bits:** Search button folded into the navigator's collapsed pill
  (it's just "open navigator + focus search"); "Export" → "Save As" with a new
  Save button (flushes the always-on autosave) in the toolbar + File menu;
  minimap view-rect drawn at 80% so Fit-all still shows it; mobile light-mode
  document-title colour + dropdown position fixes.

## Mobile chrome reorg — bottom action bar (2026-06-16)

The scattered floating touch controls (bottom-left undo/redo pill + a bottom-
right vertical action column) were consolidated into one **full-width bottom
action bar** (`MobileControls` → `.solenoid-mobile-bar`): **6 buttons + the
raised Add FAB** — `Search · Undo · Redo · ➕ · Select · Delete · Fit`. The
centre Add is a raised accent FAB (`translateY(-14px)`, visual-only so the bar
height is unaffected). **Delete is disabled (dimmed) when nothing's selected**
rather than appearing/disappearing, so the bar never reflows. Buttons are 40px,
FAB 54px, `justify-content: space-between` so 7 fit a portrait phone. Search →
`outlineSearch.open()`, Fit → NavMenu's `fitAll()`.

Pulling Search + Fit into the bar let the top chrome shrink:
- **Top-left search pill gone.** `.solenoid-outline__open-pill` is hidden on
  mobile — the bar's Search button opens the navigator focused on its search
  field. (Portrait only for now; landscape gets its own pass later.)
- **Canvas nav pill** (`.solenoid-nav`): horizontal, and trimmed to Zoom in /
  Zoom out / Lock — **Fit** is in the bar (`--fit` hidden) and the cable-flourish
  easter-egg (`--flourish`) is desktop-only. 38px buttons.
- **Socket legend** moved from bottom-right (which the full-width bar now covers)
  to **top-right, below the nav pill** (`top: 100px`, opens downward,
  `transform-origin: top right`), 38px launcher.
- **Light/dark toggle moves into the accent-palette popup** to save app-bar
  space: the standalone `.solenoid-apptools__theme` button is hidden on touch and
  a `.solenoid-apptools__palette-theme` row renders inside the palette dropdown
  (the popup is now a flex-column wrapper around `SwatchGrid` + that row; the lone
  accent button rounds to a full circle). Desktop unchanged. Shared glyph:
  `ThemeGlyph`.

The minimap is already hidden on mobile and the Conduit docked toolbar's
`bottom: 96px` clears the bar. Secondary floating controls now share one size
tier (~38–40px) instead of the previous 31/42/44 mishmash.

## Mobile second pass (2026-06-10)

Caught the touch experience up with everything added since the first pass
(Note / Conduit / Manifold / Ribbon / Cable Switch / Cast, flow beads, tabbed
Reference, Settings, Shortcuts, connection dialog, frame editing). Same
strategy as the first pass: desktop layout is truth, `@media (pointer: coarse)`
overrides in `mobile.css`, behavior switches via `IS_COARSE`.

- **Cables sheet section.** The TopBar's CableShapeSelector (shape segments +
  the flow-bead animate toggle) is hidden on touch and was in no menu — those
  features were unreachable on a phone. The hamburger sheet now renders a
  second `<CableShapeSelector />` under a "Cables" heading (same module
  stores, so the two instances can't disagree); mobile.css gives the sheet
  copy finger-sized segments and hides its redundant mini-label. The hide
  selector is scoped (`.solenoid-topbar .solenoid-toolbar`) so it doesn't
  reach into the sheet.
- **Note node joins the touch selection gate** (socket.css). It was missed
  when the gate was written (root class `.solenoid-note`, not
  `.solenoid-node`), so an unselected Note's body textarea swallowed
  pointerdown and blocked panning over it. Anything new that is a top-level
  rete view with its own root class must be added to BOTH gate rules.
- **Cable hit strokes widen on coarse** (`ConnectionComponent.tsx`): plain
  20→28, ribbon trunk 22→30, ribbon fans 14→24. Visible widths unchanged.
  Ribbon hover-preview stays mouse-only (it's a pre-selection nicety; tap
  selects the whole ribbon as before).
- **Corner collision:** the Conduit's *docked* toolbar pins to the viewport's
  lower-left — exactly the mobile undo/redo pill's spot — so coarse lifts it
  to `bottom: 96px + safe-area`. Anything else that docks to a corner must
  check `MobileControls.css` for who already lives there.
- **No autofocus on touch** for the Add-menu, Function Reference, and
  connection-dialog search fields (`autoFocus={!IS_COARSE}`, and the Add
  menu's open-effect focus is gated too): popping the on-screen keyboard over
  a just-opened panel hid the browsable content. Tapping the field still
  summons it.
- **Function Reference table on a phone:** the fixed columns sum past the
  viewport — the auto-width Notes column collapsed to 0 and the rest clipped.
  `.fr-scroll` is now `overflow-x: auto` for ALL viewports + `.fr-table` has a
  `min-width` (2026-06-21 overhaul), so narrow desktop windows pan too, not just
  coarse; coarse still gives Notes an explicit 240px. The row "+" add affordance
  was hover-revealed (opacity 0) — forced visible on coarse.
- **Function Reference column overhaul (2026-06-21):** Solenoid Node is now col 1
  (was Excel Function); the "Add Menu" location column is gone (dropped from
  th/td/colgroup + the search predicate's `r.location`); an "Excel columns" checkbox
  (default on, distinct from the filter pills) hides Excel Function + Excel Syntax.
  Group-header `colSpan` is `showExcel ? 7 : 5` — keep it in lockstep with the
  visible column count. Notes column is capped at 360px and wraps; the table
  `min-width` is per toggle-state (`.fr-table` 717px hidden / `.fr-table--excel`
  1067px shown = each state's column-width sum) so it pans before squashing. The
  content filters are one exclusive mode (`filterMode: all|todo|oos`): "To-do only"
  (planned) and "Out of scope" (`r.oos`) are opposite slices, so they can't both be on.
- **Tagged-error display = one shared treatment (2026-06-21).** Every `#CODE!` surface
  routes through `components/ErrorChip.tsx`: `errorTip(err)` is the single tooltip (producer
  message + `ERROR_EXPLANATIONS`) and `errorChip.css` defines `--sol-error` (the red) in
  `:root`. GOTCHA: `nodeCard.css` / `pinLayer.css` / `cableInspector.css` consume
  `var(--sol-error)` but it's DEFINED in `errorChip.css` — that file is in the bundle only
  because `ErrorChip.tsx` is imported by always-loaded components; don't delete that import
  path or the reds fall back to unset. Per CLAUDE.md "a new result display needs an
  isSolError branch" → send that branch through `ErrorChip`/`errorTip`, don't re-hardcode.
- **Palettes (2026-06-21):** Colorblind-safe is now the Okabe–Ito CVD set (slots double up —
  CVD can't do 12 distinct hues); the other built-ins (incl. new Solarized) must have all 12
  DISTINCT — `palette.test.ts` enforces it. Solarized = 8 Schoonover accents + base1 gray + 3
  blended in-between hues to fill its hue gaps.
- **`excelFunctions.ts` — the function-backing registry, increment 1 (2026-06-21).** The single
  declared home for "native impl vs Formula.js?" per `formulajs-vs-native-audit.md`. `FAMILY_BACKING`
  encodes the per-family verdict once; `FUNCTION_FAMILY` maps overlap functions → family;
  `resolveExcelFunction`/`registerInternal` are the resolution seam. PURE FOUNDATION: nothing
  consumes it yet, and `resolveExcelFunction` falls through to Formula.js exactly like
  `excelFormula.ts dispatch`, so it's behavior-identical today. The deferred next steps (A1's
  dispatch lane): Formula.js→`SolError` mapping, rewire dispatch/nodes through the seam, then
  `registerInternal` the internal families + delete redundant native math for the formulajs ones.
- **Tap-target bumps** in mobile.css for everything new and small: apptools
  buttons 34px, Manifold link toggle, Conduit Extend, SegToggle 30px,
  Cable Switch option/cycle buttons, Note/Group chevrons + swatches (with the
  matching header padding-left bumps), table-popup column-type toggle / view
  toggle / footer buttons, connection-dialog inputs (44px) / options /
  buttons, Settings close/switch (46×26 switch needs the knob translate
  re-derived: `translateX(width − knob − 2×2px inset)`), Shortcuts close, FR
  tabs/chips/close. Shortcuts grid drops to one column under
  `(pointer: coarse) and (max-width: 540px)`.
- **Verified** with Playwright (global install + `/opt/pw-browsers` Chromium,
  iPhone 13 descriptor → `pointer: coarse` matches): canvas chrome, sheet with
  Cables section, Reference tabs + table, Add menu (no keyboard pop), Settings.

## First-class LAMBDA values (2026-06-10)

Excel's `=LAMBDA` as a node (`nodes/lambda.ts` + `components/LambdaNode.tsx`),
closing the capture gap the formula-string lambdas couldn't express.

- **`lambda` socket type** (teal-green circle with a λ glyph). The DataflowEngine
  passes arbitrary JS values down cables, so the closure just travels — no engine
  change. `coerceInputs` ignores non-lattice types, so nothing mangles it.
- **`LambdaNode`**: a `params` field (comma-separated, the call signature) + a
  formula. Variables that aren't params become **captured input sockets**
  (Expression-style dynamic re-derivation via `_rebuild`/`applyLambdaChange`);
  their live values are baked into the emitted closure at `data()` time, so a
  captured edit re-emits a fresh value and consumers recompute. Emits
  `LambdaValue = { __lambda: true, params, fn }` (duck-typed `isLambdaValue`).
  Errors at the source: bad param name, syntax. No recursion (self-reference =
  graph cycle) and no lambdas of lambdas.
- **Consumers** (MAP / BYROW / MAKEARRAY / REDUCE) gained a `lambda` input that
  overrides the formula text (`resolveFn` in tableLambda.ts): params bind
  POSITIONALLY to the node's call args (MAP passes x,y,z,r,c; REDUCE acc,x,i;
  BYROW v; MAKEARRAY r,c — Excel semantics). A lambda declaring more params
  than the node passes errors on the consumer. FormulaBox dims when either
  `formula` or `lambda` is wired.
- **Display**: a lambda into a Display shows its signature (`λ(a, b)`) while the
  raw closure still passes through. Socket legend + ConnectionDialog labels added.
- `params` joined the `extractInit` allowlist; the formula popup hosts the node
  via `applyLambdaChange`. LAMBDA left `EXCEL_GAP` (was oos) → `lambda-make`
  metadata, `parity:false` (positional-only binding, no recursion).

## Shared popup chrome + array chips everywhere (2026-06-07)

- **`popupChrome.css` is the single source for floating-popup framing.** Formula and Table popups both wear `sol-popup` (card), `sol-popup__header`, `sol-popup__title`, `sol-popup__close`, and — when the host node is in a group — `sol-popup--grouped` (group-color outer border + lower-right membership triangle). Each popup keeps only its own bits (width, lock-tag, grid, footer). A new popup gets node-card-matching framing for free by adding these classes and setting `--node-accent` / `--group-color` / `--group-color-dark`, exactly like NodeCard.
  - The grouped corner triangle uses `inset: -2px` (over the *border box*, not the padding box) so its 8px-radius corner coincides with the card's outer corner and the triangle reaches the true corner instead of stopping a border-width short. (The node card's own `::before` still uses `inset: 0`; the popup version is the more-correct one.)
- **Table popups inherit group membership.** `tablePopupStore` carries `groupColor` / `groupColorDark`; `ArrayChip` reads `--group-color(-dark)` off its host card (cascaded from NodeCard) alongside `--node-accent` and passes all three when opening. So any chip opened from inside a grouped node frames its popup to match.
- **`ArrayChip` now has a `size="sm"` variant and an `onSave` editable mode.** `TableDisplay` renders the small chip in place of the old `R×C` text (the grid preview stays above it), threading an optional `onSave` to the chip. With `onSave` set the chip opens the grid popup editable and the tooltip reads "click to edit".
- **Table Input is now a single-box node** (like a scalar Input): the textarea is gone; its result box *is* the editor — the chip opens the editable grid popup and Save writes the matrix back via `tableToText` → `node.tableText`. `tableToText` (in `nodes/matrix.ts`) is the inverse of `parseTableText`.
- **Lists are rows, not columns.** A 1D list is orientation-less, but we present it horizontally everywhere for consistency: `ArrayChip`'s `to2D` opens a list as a single row (`[[…]]`), the result box shows `a, b, c`, and the popup copies `a, b, c` (`listToText`). CSV's "one line = one row" agrees. Vertical = use a Transpose node. The popup carries a `list` flag so copy uses `", "` (matching the result box) instead of bare CSV.
- **Table/List popup has a Grid ⇄ CSV toggle.** `grid: string[][]` stays canonical; CSV view uses a separate `csvText` buffer (so mid-typing isn't reshaped by blank→0 coercion) and, when editable, parses back into the grid via `parseCSV`. Copy in CSV view copies the buffer verbatim. Grid-only dim controls (+/− Row/Col) hide in CSV view.

## Frame: the named-column data table type (2026-06-07)

The bridge from "computation graph over numeric arrays" to the data-tables goal. A **Frame** is a list of named, typed columns, distinct from the numeric `table` (a matrix, for linear algebra). v1 columns are all numeric; the value shape is typed-columns from the start so a text column can be added later without a breaking format change.

- **Model (`src/graph/frame.ts`):** `FrameValue = { __frame: true, columns: FrameColumn[] }`, `FrameColumn = { name, type: "number"|"string"|"date", values: (number|string|null)[], unit? }` (date columns store serials — see the date-column entry at the top). The `__frame` brand is how display / readout / Display detect a frame flowing through an `any` cable (no structural sniffing). Helpers: `buildFrame`, `splitFrame`, `getColumn`, `addColumn`, `makeHeaders`, `frameToGrid`, `isFrameValue`.
- **A Frame = a Matrix + a header String List**, made literal by Build / Split. `makeHeaders(names, ncols)`: each column takes its given non-blank name else `Col{i+1}` **by position** (a 4-col matrix with headers `[A,B]` → `[A,B,Col3,Col4]`); then de-dupe left to right, first keeps its name, a later dup gets the smallest free integer suffix from 2 (`Date,Name,Date` → `Date,Name,Date2`).
- **Nodes (`nodes/frame.ts`):** Build Frame (Matrix + headers → Frame), Split Frame (Frame → Matrix + headers; strict numeric round-trip, text columns aren't in the matrix), Get Column (Frame + name → numeric list; name by inline text or 1-based index), Add Column (Frame + list + name → Frame; pads short lists, replaces a same-named column). All pure, so they round-trip through persistence with no extra work (name lives in `stringLiterals`).
- **Anti-redundancy rule:** frame nodes only do cross-column coordination. Per-column / per-cell work routes back through Get Column → the existing list/math nodes → Add Column, so there are no frame-side aggregation or math duplicates. (Transpose? Split → TRANSPOSE → Build.) The Frames seed demonstrates this: margin = Get Column Profit ÷ Get Column Revenue, added back as a column; total via a plain Reduce.
- **Socket + kind:** new `frame` socket (violet `--sock-frame`), strict (`areCompatible` only matches `frame`/`any`). It reuses the matrix 2×2-grid glyph, recolored violet — a header-row glyph was too busy at 12px (so `isTable` in SocketComponent covers `frame`, and `frame` is in NodeSocket's `SQUARE_TYPES`). New `NodeKind "frame"` (violet accent #8b5cf6), so frame nodes and the chip are violet automatically via NodeCard's `nodeKindOf` → `NODE_KIND_ACCENTS`.
- **Display:** `FrameChip` (`[R×C Frame]`) and `FrameDisplay` (compact name-header + 3×4 preview + chip, reusing `.solenoid-table-display` classes so collapse-to-chip works). The chip opens the existing table popup with `headers` set — the popup renders column names as the header row (`.table-popup__colhead--name`) and prepends a header line to CSV export. Display node and collapsed-group readouts both detect frames (`isFrameValue`) and show the chip instead of `[object Object]`.
- **Add menu:** the old "Tables & Matrices" category is renamed **"Frames & Matrices"** with a "Frames (named columns)" subcategory.
- **Text columns: DONE (2026-06-16).** CSV/JSON imports now infer each column's type (`inferColumn`/`frameFromCells`/`frameFromRecords`/`frameFromRows`/`frameFromColumnar` in `frame.ts`) — numeric only when every non-blank cell is a finite number (commas stripped), else a text column keeping the strings; blanks → null. The consumer side already handled it (FrameDisplay `fmtCell`, Get Column "text" mode, `frameToGrid`), so this was just the producers. Tests in `frameImport.test.ts`. **Still deferred (the verbs):** Filter Rows / Sort By (one bundled "Frame Rows" node), frame Group By, and Join.

### Frame Input — type a frame directly (2026-06-08)

A source node (`FrameInputNode` in `nodes/frame.ts`, kind `frame`), mirroring Table Input: the single result box doubles as the editor. State lives in `frameText` (round-trips through persistence via `extractInit`). `data()` rebuilds the frame with `frameFromInputText`.

Editing reuses the one grid popup rather than a second editor. `TablePopupState` gained `editableHeaders`, `columnTypes`, and `onSaveFrame`. When `editableHeaders`, header cells render an editable name input plus a per-column number/text toggle (`.table-popup__coltype`); cells edit as text or number per column (`colTypeAt`); Save builds typed columns and hands them to `onSaveFrame`. The numeric matrix path (Table Input → `onSave(number[][])`) is untouched. `FrameChip` always passes `columnTypes` (so a read-only frame with a text column renders correctly) and passes `onSaveFrame` only when given an `onSave` — so Build/Add/Split/Slicer/Group readouts stay read-only.

**Mixed-type columns (2026-06-08):** `frameText` is now JSON-encoded typed columns (`frameColumnsToInputText`); `frameFromInputText` reads that, and falls back to the legacy numeric-CSV form (header line + numeric rows) for older graphs + the default. So a Frame Input column can be text.

**Get Column read-as (2026-06-08):** Get Column gained a `readAs` dropdown (Number / Text / Date). It's the boundary where a column leaves Frame-space into the typed list world, so the *output socket type* changes with it — Number → `list`, Text → `strlist`, Date → `datelist`. (2026-06-19: read-as Number/Date now genuinely COERCE — text cells are parsed, not just re-tagged — so a text date column reads as Date; see the top-of-file entry.) The socket swap is a structural re-derivation (`applyGetColumnReadAs` in `frameEdit.ts`): drop any cable on `values`, `removeOutput`/`addOutput` with `getColumnOutput(readAs)`, `area.update`, recompute — same shape as the Expression node's socket re-derivation. `readAs` is in `extractInit`.

**Add Column add-as (2026-06-08):** the write-side mirror. An `addAs` toggle (Number/Text/Date) swaps the **Values input** socket (`applyAddColumnAddAs`) and sets the stored column type (Text → string, Number/Date → number; Date is serials). Values is the last input so the remove/re-add keeps row order stable. Both read-as toggles use `SegToggle` (`components/SegToggle.tsx` + `.css`) — the Format Controller's segmented places/sig-figs button style as a reusable full-width control; the FC keeps its own inline-row variant until its planned expansion unifies on `SegToggle` (see backlog).

**Split null-when-mixed + Get Row (2026-06-08):** `splitFrame` now returns the Matrix all-or-nothing — `null` if the frame has any text column (no clean numeric matrix; the node shows a "mixed — use Get Column" hint via `cachedMixed`), the full matrix otherwise. The header list is always every column name. **Get Row** (`GetRowNode`) pulls one row by 1-based number and outputs a **1-row Frame** — a row mixes column types, so it stays in Frame-space (the principled mirror of Get Column, which leaves it because a column is homogeneous). Still pending: XLOOKUP text-aware return.

### External connections — live data, not import (2026-06-08)

A connection node references outside data and fetches a Frame on refresh; the project file stores only the reference (a URL now; a folder-relative filename next), never the data. Phase 1 is the **Web Source** node plus the shared layer; the local-folder CSV node (needs Tauri fs/dialog) is phase 2.

- **Shared layer (`connectionStore.ts`):** mirrors the volatile-recalc pattern (`getRecalcGen`/`requestRecalc`) but for async, cached fetches. A global generation + a per-node refresh token + the reference compose a cache key (`connectionStore.key(id, ref)`). A connection's `data()` returns its cache when the key is unchanged, so an ordinary `processGraph()` (editing some unrelated node) does NOT re-hit the network. `refreshConnection(id)` bumps that node's token; `refreshAllConnections()` bumps the global gen. Status (idle/loading/ok/error + rows×cols + fetchedAt) lives in the store; node components subscribe via `useSyncExternalStore`.
- **First async `data()` in the codebase.** Rete's DataflowEngine awaits it (process.ts already `await`s `engine.fetch`). The node dedupes concurrent fetches with an in-flight promise keyed by the cache key: `engine.reset()` throws `Cancelled` into the in-flight engine fetch on an overlapping `processGraph`, but the fetch promise keeps running, so sharing it means the result is never lost. `lastKey` is set in both success and error branches (error doesn't retry until gen/token/url changes — no network spam).
- **Web Source (`nodes/connection.ts`):** URL → numeric Frame. `remoteTextToFrame` picks JSON vs CSV from content-type, then `.json` extension, then a leading `[`/`{`. JSON accepts array-of-records (keys = columns), array-of-arrays, array-of-scalars, and columnar objects. Non-numeric cells → NaN (numeric-only v1). The URL field commits on blur/Enter (not per keystroke) so typing never fires a fetch. **CSV is quote-aware** (`csv.ts` `parseCsvRows`, delimiter-detecting) — the old comma-split is gone, so quoted embedded commas (titanic.csv) no longer mis-align.
- **CORS (2026-06-16):** the fetch routes through `httpBridge.fetchText` — Tauri's native HTTP plugin on desktop (no same-origin wall, so any URL works), `window.fetch` in the browser. A browser cross-site block becomes a `CorsLikelyError` whose message points the user at the desktop app. Tauri: `tauri-plugin-http` + `http:default` capability scoped to `http://**` / `https://**` (cargo-check verified; runtime still wants a `tauri dev` pass).
- **Refresh UX:** a ⟳ button + status dot on each node, and **Data ▸ Refresh all connections** in the MenuBar. Add menu: Web Source lives under **Input** (the menu caps at 12 top-level domains, so no new "Connections" category).
- **Verified live:** iris.csv (150×5, Name → N/A) and vega cars.json (406×9, six numeric columns) both load and refresh from the browser dev server.

**Phase 2 — local CSV folder (desktop).** A **CSV File** node (`CsvConnectionNode`) reads a `.csv` from a Settings-configured target folder. Added the Tauri `fs` + `dialog` plugins (`Cargo.toml`, `lib.rs`, and `capabilities/default.json`: `dialog:default` + `fs:allow-read-text-file`/`fs:allow-read-dir` scoped to `$HOME/**`). `fileBridge.ts` wraps the plugins behind an `isDesktop()` guard so the browser build no-ops gracefully (the node shows "desktop app only"). Settings gained a `csvFolder` path field with an OS folder picker (`SettingField.type: "folder"`). The node's component lists the folder's CSVs in a native `<select>` (pointerdown-stopped per the OS-dropdown rule), bound to `node.fileName`; the same cache/refresh layer applies, with the folder + name folded into the cache key. `fileName` added to `extractInit`. **Verified:** `cargo check` passes (so the crates + capability identifiers are valid) and the frontend builds; the actual file-read path still needs a `tauri dev` run to confirm at runtime (the `$HOME/**` scope is deliberately broad and may want tightening).

### Slicer is now frame-driven (2026-06-08)

Reworked `SlicerNode` from a list/table filter into an Excel-style **frame slicer**: one `frame` input, a column dropdown, the column's unique values as clickable buttons, and a filtered `frame` output (empty selection = all rows pass). Values can be numeric or text (frame columns are `number | string`), sorted numerically or lexically. The active column + selection + multi-select persist via `extractInit` (added `selectedColumn` / `selectedValues` / `multiSelect` to its key list); `cachedColumns` / `cachedUniqueValues` are component-read only.

- **Intelligent sizing:** the value buttons wrap into a grid (`flex-wrap`), so short values pack many per row and long ones fall to fewer. On top of the automatic 240px frame tier (it has a frame socket → `nodeWide()`), the component picks a wider card for long/many values via `widthClass()` → a class passed through `NodeShell`'s `className`. Those classes (`.solenoid-node.solenoid-node--slicer-w2/-w3`) use **two-class specificity** so they beat the single-class `.solenoid-node--wide` tier; a manual inline-width resize still wins over both. This is the general pattern for a node that wants its own width tier.

### Chips work for text lists too, not just numbers (2026-06-07)

The chip + popup pattern was numeric-only; it now covers **string lists** (the `strlist` socket: Text Split / Filter / Map, and `REGEXEXTRACT (all)`), so every list-shaped socket reads and copies the same way. Scalars (number, string, date, complex) stay inline — only array-valued sockets get a chip.

- **The popup is cell-type aware via `tablePopupStore.cellType` (`"number" | "string"`, default number).** `ArrayChip` infers it from the first cell (`cellTypeOf`) and passes it. `"string"` left-aligns cells (`.table-popup__input--text`, sans-serif), preserves text verbatim (no blank→0 coercion), and CSV-quotes only cells containing a comma/quote/newline (RFC 4180 doubling, `csvField`); `"number"` keeps the right-aligned, blank→0, bare-CSV behavior. The store's `Cell = number | string`.
- **Editing stays number-only.** A `cellType: "string"` popup is always read-only (string lists are computed); `editable = !!onSave && cellType === "number"`. `onSave` is still typed `number[][]` (only Table Input uses it).
- **`ValueDisplay` routes string arrays to the chip** (`listIsString` = `Array.isArray(value) && typeof value[0] === "string"`). With a Format Controller annotation it falls back to a cased `", "` join (mirroring how numeric lists fall back to a joined value under an annotation); without one it shows `<ArrayChip>`. The three text-list components now pass the raw `cachedResult` array instead of a pre-joined `[a, b, c]` string.
- **Latent bugs this fixed:** a string-list readout in a *collapsed group* already hit `ArrayChip` (via `isArrayValue`) and would have rendered each value as `NaN`; `RegexNode` and `DisplayNode` both cast `cachedResult`/`cachedValue` down to a union *without* `string[]`, so an extracted-all / passed-through text list was mis-typed as numbers. `DisplayNode.data` also used to join a string list into a scalar string (inconsistent with how it keeps numeric lists as arrays for the chip) — it now keeps the array.

## Geometry pack: the first formula-data pack (2026-06-06)

First pack authored as pure formula data, validating the scope in
[pack-architecture.md](pack-architecture.md): a formula pack is a list of
`{label, expr}` records, not new node code. `FormulaPackEntry` + `formulaNode()`
in `packs.ts` turn each record into a catalog entry whose `create()` returns
`new ExpressionNode({ label, expr })`. The Expression node already derives input
sockets from the formula's variables and compiles through the core engine
(Formula.js for `PI()`/`SQRT()`/`TAN()`/…), so no per-node class, component, or
registry row is needed.

`GEOMETRY_FORMULAS` (12 entries: circle/ellipse/triangle/trapezoid areas, sphere/
cylinder/cone volumes, 2D distance, regular-polygon area) lands under a new
`Numbers → Geometry` Add-menu subcategory (path created on demand by the catalog
builder). Trig is radians, matching the core Trigonometry convention.

Round-trip is free and proves the doc's "a formula node is just data" claim:
`serializeGraph` keys on `constructor.name`, so a Geometry node saves as
`type: "ExpressionNode"` with its formula in `init.expr` and reloads as a plain
Expression node **even with the Geometry pack switched off** — the core compiler
evaluates it. A custom-logic pack node could not degrade this way; that's the
formula-vs-custom line the scoping doc draws.

**Locked formula, editable title.** A preset is created with `locked: true`
(new field on `ExpressionNode`, persisted via `extractInit` so it survives
save/load and copy/paste). `FormulaField` gains a `locked` prop distinct from
`disabled` (which means "wired/overridden" and dims to 0.45): locked renders the
formula at full strength, read-only. The lock indicator is a small mark in the
card body's top-right corner via a generic `cornerBadge` slot on `NodeShell`. It's
anchored to the card (the body can't be a positioning context without re-anchoring
the input sockets), and sits below the header by offsetting `top` with a measured
`--header-h` CSS var — NodeShell measures the header (which clamps to 2 lines, so
its height varies with the title) via a ResizeObserver, only when a badge is
present. The header title stays editable — it's just a label, so the user can
rename a "Circle Area" preset without touching the formula the pack guarantees.
A locked node is still a plain `ExpressionNode`, so the round-trip story above is
unchanged (it reloads locked, the core compiler still evaluates it).

**Long-formula legibility (the Expression-node tension).** The Expression node is
the one place that breaks Solenoid's "legible inputs wired to legible outputs"
identity: it embeds a textual formula, which can be long and reads as a script. A
long preset (Heron's `SQRT(((a+b+c)/2)*…)`) shrinks to illegible in the card's
small box. Rejected fixes: growing the box without limit, and hand-rewriting
formulas shorter (doesn't generalize; makes the author responsible for legibility,
not the tool). We can't drop the node either.

Built (the formula popup): a roomy popup (`FormulaPopup`, mounted in App, driven by
`formulaPopupStore` — module store since nodes render in Rete's separate React
root). Shows the equation **typeset large in KaTeX display mode** (fractions get
full vertical room) on top, the formula text below — editable, or read-only when
locked (Expression preset) / wire-overridden (LAMBDA Formula input). Chrome
**mirrors the node card**: same accent header, border, and group-membership border
+ corner triangle, from the same CSS vars NodeCard sets (`--node-accent`,
`--group-color`, …). No copy button / no variable lister — those live on the node.

**The popup is a FormulaField feature, shared by every formula-field node.**
`FormulaField` renders the expand button (top-right of the field) and opens the
popup when given `onOpen`; clicking the box opens it too, and inline editing is
suppressed (the canvas never shows a code textarea — kills the IDE bleed). Both the
Expression node and the LAMBDA family (MAP/BYROW/BYCOL/MAKEARRAY) pass `onOpen`, so
they share one popup. The popup is node-type-agnostic via `formulaHostOf(node)`
(in `FormulaPopup`), which adapts each node to `{ label, text, locked, setText }`:
Expression → `node.expr` + `applyExprChange`; LAMBDA → `stringLiterals.formula` +
`processGraph`, locked when its Formula socket is wired. The lock indicator stays a
card-corner badge on Expression presets (LAMBDA has no lock).

The card's formula box was bumped taller (54px) AND the KaTeX font-fit in
`FormulaField` now scales in **both** dimensions — down to fit a long formula
(floored 55%), up to use a tall box (capped 1.9×) — so the height bump actually
enlarges the equation. The rendered box is a FIXED height (`var(--box-h, 54px)`,
follows the resize grip) so the font-fit has a stable height to scale against; a
content-driven height would change as the font scaled and loop.

Scale-to-fit (the legibility lever in use) lives in `formulaFit.ts`
(`useFormulaFit`), shared by the card (fits width + height, scales up to fill the
taller box) and the popup (fits width). It measures the INNER content span, not
the box (a fixed-height box's scrollHeight never drops below its own height, which
would defeat height scaling). Scale-to-fit alone bottoms out at a legibility floor
on a wide formula, then scrolls.

Step-by-step evaluator — **built then shelved** (behind `SHOW_STEPS = false` in
`FormulaPopup.tsx`; fragments kept intact, flip to re-enable). `evaluateSteps(expr,
vars)` in `excelFormula.ts` walks the AST post-order, emitting one step per
operation — the sub-expression with operands shown as their computed numbers, then
the result (`3 + 4 = 7`, `7 + 5 = 12`, `12/2 = 6`, …); identical sub-steps deduped.
The popup resolves each variable's live value from its incoming cable
(`cableValueStore`, source output) or the inline literal. Scalar-only. Shelved for
now pending a decision on granularity (one binary op per step felt too fine).

**Input restrictions on pack/Expression nodes** — design lives in
[pack-architecture.md](pack-architecture.md) (restrictions as per-variable metadata
validated in `data()`, pack-authored with author-defined defaults that double as
the promotion fallback, validate-and-warn over clamp). Actionable follow-ups
(variant socket reconciliation, aliasing, typed errors, error UX) are in
`backlog.md` → "Packs / pure-formula nodes & subgraphs".

**Still open — rendering big formulas legibly.** Scale-to-fit only goes so far; a
genuinely wide formula floors and scrolls. Tried structural line-breaking
(AST-driven, stacking the top-level +/− or × chain — incl. inside a √ — as a KaTeX
`aligned` block): it worked technically but looked bad, rejected. Open question for
a future pass; needs a different idea than stacked-`aligned`.

Next formula-pack candidates by the same path: convert the Flux Calculator
electromagnetism seed into a pack; physics/finance formula bundles. Reserve real
node classes for the declared custom-logic exceptions (native libs, root-finding,
interpolation).

## Audit & simplify pass (2026-06-05)

A sweep of the non-math layer (everything the vitest suite doesn't cover), with
an eye to reuse for the coming Packs store. Done:

- **Node-component factory** — the ~75 "inputs + value box" wrappers (12 lines of
  boilerplate each) collapsed to one-line `makeNodeComponent` calls
  (`components/standardNode.tsx`). See Node authoring above. `new-node.mjs` and the
  `add-node` skill now scaffold/document the factory form, and their wiring steps
  were corrected (registry is `nodeRegistry.ts`, catalog is `nodeCatalog.ts` — both
  had been pointing at `Canvas.tsx`).
- **storeKit** (`storeKit.ts`) — every module-level external store had reimplemented
  the same listener/notify/subscribe(/version) plumbing. `createNotifier()` is that
  kernel; `createToggleStore()` is the boolean open/closed shape shared by six stores
  (FR + shortcuts overlays, mobile menu, touch-select, canvas lock, settings panel).
  18 dedicated store files adopt it. The notifier embedded in the four large
  multi-concern modules (`process`, `cableState`, `formatAnnotation`, `groupCollapse`)
  is deliberately left inline — bounded scope.
- **Dead code removed** — `socketCableHoverStore` (orphaned twin of the live
  `socketHoverCableStore`) and `notifyGraphChanged` (dead wrapper; `processGraph`
  calls `_graphChanged()` directly).

Findings logged, not acted on (judgment calls / out of scope):

- **`@types/styled-components@^5`** is dead and wrong-major: styled-components is v6
  (ships its own types) and our code never imports it directly (it's only a peer dep
  of `rete-react-plugin`). Safe to drop from devDependencies. Left for a deliberate
  dependency change + lockfile update.
- **group push duplication** — `pushNeighborsOnExpand` (single, shortest-axis, pins
  the expander) and `pushAfterMultiExpand` (multi, arrangement-preserving axis) share
  a snapshot→BFS-overlap→apply skeleton. Both are live (per-group chevron vs.
  collapse-all) and were tuned separately; a shared `cascadePush` core is possible but
  risks the just-fixed "third group drops below second" behavior, so left as-is.
- **Intentional unused exports left in place**: `UNIT_SUFFIX_LABELS` (documented
  standalone for the future Unit add-on node), `formatWithAnnotation` (FC redesign),
  `clearAutosave` (coherent persistence API), and `nodes/*` `*_META` metadata
  (pack-authoring surface).
- Skipped per request: Table/Array socket nodes (WIP) and the node-math layer.

## Packs extend the Format Controller (2026-06-05)

Packs can contribute FC **units** and **number formats**, mirroring how pack node
constructors work: registered for resolution for *every* known pack (so a saved
graph that uses a pack's unit/format still renders with the pack off), but offered
in the FC dropdowns only while the pack is **active**.

- `Pack.units?: PackUnit[]` / `Pack.formats?: PackFormat[]` (`packs.ts`).
  - `PackUnit` = `{ id, label, group, groupLabel?, prefix? }`. `group` can be an
    existing `UnitGroup` id or a brand-new group (supply `groupLabel`).
  - `PackFormat` = `{ id, label, group?, apply: (n) => string }` — `apply` is the
    render fn the core doesn't ship (e.g. the geometry pack's `D°M′S″`).
- `fcExtensions.ts` is the only module that knows both packs and the FC store:
  `initPackFcExtensions()` (called in `main.tsx` after `initPacks`) registers every
  pack's contributions for resolution; `activePackUnits()` / `activePackFormats()`
  feed the dropdowns. `formatAnnotationStore` stays pack-agnostic (just merged
  resolution maps via `registerPackUnits`/`registerPackFormats`); `packs.ts` stays
  FC-agnostic (just data).
- `FormatStyle` (closed union) widened to `FormatStyleId = FormatStyle | (string & {})`
  for the annotation/node `format` field, so a pack format id is a valid value while
  built-in members keep autocomplete. `unit` was already `string`, so units needed no
  type change.
- The built-in **Geometry** pack (off by default) demonstrates all three paths: a unit
  in an existing group (angle → turns), a unit in a new group (Geometry → px), and a
  custom format (DMS). Toggle it in Settings to see the dropdowns grow.

## Pack node placement, dedup, dependencies (2026-06-05)

Packs no longer carry their own top-level subtree — they **insert nodes into the
existing Add-menu category tree** so activating a pack never grows the top level.

- `Pack.nodes?: PackPlacement[]` (`packs.ts`); `PackPlacement = { path?: string[]; entry }`.
  `path` is the chain of category labels to insert under (e.g. `["Numbers","Functions"]`);
  omitted/empty → the catch-all **"Other"** top-level category (in `nodeCatalog.ts`,
  pruned from the menu until something lands in it).
- `catalogUtils.buildCatalog(activeOnly)` clones `NODE_CATALOG`, inserts each (active or
  all) pack placement at its path, and **dedupes by `type`**: a node claimed by several
  packs is inserted once and records every owning pack in the leaf's `packs[]`. A pack
  trying to redefine a *core* type is ignored with a dev warning. Empty categories
  (e.g. "Other") are pruned. The Add menu uses `buildCatalog(true)`; `FLAT_CATALOG`
  (resolution on load) uses `buildCatalog(false)` so deactivated packs' nodes still
  resolve.
- The subtle "from a pack" indicator is a small dim dot (`PackDot` in `AddNodeMenu.tsx`)
  shown on any leaf with a non-empty `packs[]`. Built-ins (core + Excel matchers) have
  no dot.
- **Dependencies**: `Pack.dependsOn?: string[]`. `packsStore.setActive(id, true)`
  transitively activates dependencies (cycle-guarded). Deactivating doesn't cascade.
- **Classification**: `catalogUtils.classifyType(type)` → `"matcher"` if the type maps to
  a real Excel function (`CATALOG_TO_EXCEL`), else `"core"`. Best-effort, derived from
  existing data; the dev catalog validator logs the counts. Pack nodes are classified by
  their pack, not this helper.
- **HYPOTENUSE** is the worked example of a cross-domain node: defined once and claimed
  by both the **Geometry** and **Common Excel Timesavers** packs, landing once under
  Numbers ▸ Trigonometry with the pack dot. It's deliberately neither core nor an Excel
  matcher (Excel has no HYPOT function), and it replaced the old core `twomath-hypot`
  ("HYPOT") leaf — the duplicate that prompted this work.

### Reclassifying existing core nodes (`NODE_PACK_TAGS`)

Two ways a node joins a pack: `Pack.nodes` placements add NEW pack-only nodes;
`NODE_PACK_TAGS` (`packs.ts`) re-homes nodes ALREADY in `NODE_CATALOG` — a
`type → packId[]` map the builder applies as `leaf.packs`, so a reclassified core
node gets the pack dot and hides when all its packs are off.

- **Geometry and Timesavers ship `defaultActive: true`** so reclassifying an existing
  node doesn't remove it from the default menu — the classification is organizational;
  turning a pack off declutters. (A user who had explicitly saved pack prefs before this
  change would keep those; only relevant pre-release.)
- First auto pass (best-effort: not core primitives, not Excel matchers) tagged into
  Timesavers: rolling aggregates, weighted stats, ARGMAX/ARGMIN, CONTAINS, DIFF,
  Normalize, Shuffle, Interleave, Nth Element, Geometric, Fibonacci, Repeat, Text
  Map/Filter, DECODEURL, XNOR/NAND/NOR. Fundamental list ops (Range, LinSpace, Reverse,
  Slice, Length) were left core. Refine the map freely.
- `filterInactive` is pair-aware: if only one half of an Add-menu pair survives, it's
  demoted to a single leaf (a one-child pair would break the grid layout).

## Node authoring (the kit)

Node components used to be ~50 lines of duplicated boilerplate each. The shared
chrome is in `src/graph/components/nodeKit.tsx`, and the most common shape —
"input rows + one value box" — is now a **one-line factory call** via
`src/graph/components/standardNode.tsx`:

```ts
export const ClampComponent = makeNodeComponent<ClampNode>((n) => n.cachedResult);
```

`makeNodeComponent` (inline inputs) / `makeExtensibleNodeComponent` (add/remove
rows) cover ~75 nodes. Hand-write against `NodeShell` only when the node needs an
`OpSelect`, a custom value `render`, or local state (Arithmetic, Contains,
ComplexFrom, TextSplit). This is also the primitive pack authors get.

- `NodeShell` — output sockets + editable label header + body wrapper. `leading` slot renders bare input sockets before the outputs; `labelPlaceholder` for source nodes. `hideOutputSockets` + `InlineOutputRows` for multi-output nodes (LINEST, IM Unpack, etc.).
- `useNodeField(node, key)` — controlled local state mirrored to `node[key]` + `processGraph()`. The one correct pattern for op selects / fields (see CLAUDE.md on controlled `<select>` re-render).
- `OpSelect` — drag-safe `<select>`, `options={[{value,label}]}` (bake symbols into label).
- `ValueDisplay` — renders `number | number[] | string | null`; `empty` overrides "—", `render` overrides scalar formatting.
- `InlineOutputRows` — renders labeled output rows with measured socket alignment (multi-output nodes).
- Port factories in `shared.ts`: `numIn/listIn/numListIn/strIn/dateIn/complexIn/anyIn` + matching Out variants.
- **Component registry**: `NODE_COMPONENTS` in `nodeRegistry.ts` — a `[Ctor, comp(Component)]` array. Adding a node = one row there + one line in `components/index.ts`.
- **Scaffolding**: `node scripts/new-node.mjs <Name> [--template element|list|reduce]` writes the component and prints the class + registry + catalog snippets. Also documented as the `add-node` project skill.
- **Excel metadata is on the node** (`nodeExcel.ts` `NODE_EXCEL`, or inline `excel` on a pack entry) — the single source of truth for Excel equivalence. `EXCEL_TO_CATALOG` / `CATALOG_TO_EXCEL` are **derived** from it (no hand map), and the **Function Reference is generated** from the catalog (`functionReference.ts`): Add-menu location, pack, dependency, parity, Excel name/syntax. There is no `functionReferenceData.ts` anymore — that 485-row hand-list was the maintenance sink that left LAMBDA stale.
- **Parity tracking**: `npx tsx scripts/parity.ts` lists the Excel-only gap (`EXCEL_GAP` in `nodeExcel.ts`) minus out-of-scope — the functions with no node. Self-heals: once a function is node-backed it leaves the list.
- **Catalog consistency check**: `validateCatalog()` (`catalogValidator.ts`) runs at startup in dev and warns if any `NODE_EXCEL` entry points at a catalog type that doesn't exist (stale metadata for a removed node). This is the guard that makes the LAMBDA failure mode impossible — a shipped node can't silently fall off the reference.

## Roadmap stance

- **Persistence (save/load): DONE** (`persistence.ts`, see below) — localStorage autosave + restore, plus Export/Import. **Seeds** are JSON files in `seedGraphs/` loaded via `seeds.ts` (see the seed section below), switched via the NavMenu.
- **Expression node: DONE.** `a * b + 1` auto-creates named input sockets per variable (`nodes/expression.ts` + `ExpressionNode.tsx`). `new Function()` evaluator with a math preamble (sin/cos/log/… in scope), variadic element-wise broadcast over list inputs, dynamic socket add/remove on edit. Covers the scalar-formula use case and Excel's MAP/SCAN where the lambda is 1D.
- **2D arrays: DONE (1D-simplified).** `table` socket (`number[][]`) + Table Input grid editor + MMULT, MDETERM, MINVERSE, MUNIT, TRANSPOSE, HSTACK, WRAPROWS/WRAPCOLS, TOCOL/TOROW, CHOOSEROWS/CHOOSECOLS, ROWS/COLUMNS. Still missing: the LAMBDA-over-2D family (MAP/BYROW/BYCOL/MAKEARRAY operating on a full matrix) — these need the Expression node wired as a per-cell callback, not yet built.
- **LET**: no node needed — wiring in the graph is the LET equivalent.
- **GROUPBY / REGEX: DONE.** GroupBy is the 1D parallel-list version (keys list + values list → unique-keys + aggregated outputs). Regex covers REGEXTEST / REGEXEXTRACT / REGEXEXTRACT-all / REGEXREPLACE via one op-selector node with a flags field.

## Socket types (current)

All live in `sockets.ts`. The cable and dot color is the single source of truth.

Colors are `var(--sock-*)` CSS vars (App.css; light mode lightens the dark array
variants). Shapes are what `SocketComponent` actually renders.

| Type | Color | Shape | Notes |
|------|-------|-------|-------|
| `number` | amber | circle | scalar |
| `list` | dark amber | square | number[] |
| `numlist` | amber/dark | bicolor split square | number \| number[] — broadcast-aware |
| `string` | yellow-green | circle | scalar string |
| `strlist` | dark y-g | square | string[] |
| `strcombo` | y-g/dark | bicolor split square | string \| string[] — element-wise text |
| `date` | pink | circle | date serial (like Excel) |
| `datelist` | dark pink | square | date[] |
| `datecombo` | pink/dark | bicolor split square | date \| date[] — element-wise date |
| `complex` | sky blue | circle | [re, im] tuple — engineering |
| `table` | vermilion | 2×2-grid square | `number[][]` — matrix; supertype of the numeric lattice (see below) |
| `frame` | violet | 2×2-grid square | named-column data table (`frame.ts`); Frame Input / Slicer / connections |
| `lambda` | teal-green | circle with λ | first-class function value (`nodes/lambda.ts`); LAMBDA → MAP/BYROW/REDUCE/MAKEARRAY |
| `any` | gray | circle | wildcard — Conduit, IS checks, Display |

**Adding a new socket type**: add to `SocketDataType`, `SOCKET_COLORS`, and the singleton in `sockets.ts` (+ a `--sock-*` var in App.css); add factory functions to `shared.ts`; add an entry to `SocketLegend.tsx`; optionally add a `NodeKind` entry for the node header accent color. Combos additionally need a `SOCKET_ACCEPTS` row and a `COMBO_COLORS` pair in `SocketComponent.tsx`.

### Numeric dimension lattice + boundary coercion (2026-06-05, in progress)

The numeric types form one lattice where **`table` (2-D) is the supertype**: a scalar is a 1×1 array, a list is a single **row** (CSV orientation: `[1,2,3]` → `[[1,2,3]]`, 1×3 — deliberately *not* Excel's vertical-range default, chosen for CSV portability). There is no separate strict-2-D type; every table-consuming node works on a degenerate scalar/1-D, or its genuine shape requirement (square for MINVERSE, conformable for MMULT) is a *runtime* check that already errors like Excel `#VALUE!`, not a type constraint.

- **Connections stay type-based, never shape-based.** A socket's declared type is static; its live dimensions change (a dropdown reshapes data, a formula starts returning 1×1). If cable validity depended on live shape, those changes would sever wires. So compatibility is purely the static lattice and a shape mismatch surfaces as a value-box error, not a broken cable. Implemented as one line in `sockets.ts`: `SOCKET_ACCEPTS.table = ["number","list","numlist"]` (and `areCompatible` is bidirectional, so a table output can feed a numeric input too).
- **Coercion is central, not per-node.** `coerceInputs.ts` installs a `nodecreated` pipe that wraps every node's `data()` once, normalizing each incoming value to the consuming socket's declared shape (`toMatrix`/`toList`/`toScalar` from `nodes/coerce.ts`) before the node runs. Widening (scalar/list → table) is identity for existing cables and never fails; narrowing (table → list/number) throws `ShapeError`. The engine reads `node.data` dynamically at fetch (rete-engine line ~522), so wrapping at creation takes effect everywhere.
- **~~Step 3~~ — DONE (2026-06-15): shape errors unified into the typed `#SHAPE!` value.** The old design swallowed the `ShapeError`, substituted an empty value, ran the node anyway, and set a `#DIM!` *string* on `cachedError` — which only ~5 components rendered, so the error "degraded to empty/`—`" everywhere else. Now `coerceInputs` lets the `ShapeError` propagate; the error-value guard that wraps every node OUTSIDE coercion (Canvas installs coercion first, guard second) catches it and `fromThrown` maps it to a tagged **`#SHAPE!`** `SolError` (`errorValue.ts`). That flows through the *same* path as every other error — red `#CODE!` badge on the value box (via `cachedResult`) AND propagation to downstream nodes — so a dimension mismatch now shows consistently on EVERY node, no per-node display code. `#DIM!` and the `DIM_ERROR` constant are gone (the code set never had `#DIM!`; `#SHAPE!` is the dimension-mismatch code). Made the shared table/frame result displays SolError-aware so a `SolError` in `cachedResult` renders the badge instead of crashing on `.slice`/`.columns` (`TableDisplay`, `FrameDisplay` — this also fixed a latent crash: the guard already mirrored *upstream* errors into table nodes' `cachedResult`). Filter (`list.ts`) and the LAMBDA family (`tableLambda.ts`, `lambda.ts`) now emit typed errors too: a mask/data mismatch → `#SHAPE!`, an unresolved formula → `#SYNTAX!`/`#VALUE!`/`#NAME?`, a too-large MAKEARRAY → `#RANGE!` — keeping the richer inline `cachedError` hint for in-node authoring feedback while the propagating value carries the code (tooltip = the rich message). Tests in `errorValue.test.ts` (guard maps `ShapeError`→`#SHAPE!`, Filter producers) and `tableLambda.test.ts` (lambda-family codes). **Still open**: revisit whether `list` vs `numlist` should remain two types now that `table` subsumes them (independent of the error work).

## Map / Filter decision

- **Map = broadcasting**. A node's numlist input accepts a number OR a list; if a list comes in, the op applies element-wise and outputs a list. No separate Map node. Mirrors Excel array formulas. Implemented via `numlist` socket + `broadcast()` helper in `shared.ts`.
- **Filter** is a dedicated node — broadcasting doesn't cover "keep some, drop others". `Filter → Reduce(SUM/COUNT/AVERAGE)` composes into SUMIF/COUNTIF/AVERAGEIF.
- **Sub-graph / lambda** ("approach C", per-item recipe on an inner canvas): deferred in favor of the Expression node, which covers the scalar-formula use case without needing a sub-canvas.

## Complex number system (2026-06-03)

Added a `complex` socket type (`[re, im]` tuple, sky-blue). Five node families:

- **ComplexFromNode** — COMPLEX(re, im) → complex socket
- **ComplexUnpackNode** — complex → four scalar sockets: Re, Im, |z|, arg(z). Covers IMREAL / IMAGINARY / IMABS / IMARGUMENT in one node.
- **ComplexUnaryNode** — 16 ops: IMCONJUGATE, IMEXP, IMLN, IMLOG10, IMLOG2, IMSQRT, IMSIN, IMCOS, IMTAN, IMCOT, IMSEC, IMCSC, IMSINH, IMCOSH, IMSECH, IMCSCH.
- **ComplexBinaryNode** — 4 ops: IMSUM, IMSUB, IMPRODUCT, IMDIV.
- **ComplexPowerNode** — IMPOWER(z, n) where n is a real exponent.

All math is in `nodes/complex.ts` as pure helpers (`cxAdd`, `cxMul`, `cxDiv`, `cxLn`, etc.) operating on `Cx = [number, number]`. Display uses `formatCx([re, im])` → "a + bi" string, which ValueDisplay handles as a string.

## Finance completions (2026-06-03)

- **BondPriceNode** — PRICE and YIELD. Uses Newton-Raphson for YIELD. 30/360 basis only (basis=0 hardcoded internally; other bases deferred). The internal `_bondPrice` helper is reused by the odd coupon nodes.
- **XirrNode** — XIRR. Newton-Raphson on the date-weighted NPV equation; dates as serials (wire from date nodes).
- **OddCouponNode** — ODDFPRICE, ODDFYIELD, ODDLPRICE, ODDLYIELD. 30/360 basis only. ODDF* generate quasi-coupon dates backwards from firstCoupon to locate settlement; ODDL* compute the final irregular cash flow relative to lastInterest.

## Newer node systems (consolidation pass)

- **Expression node** (`nodes/expression.ts`, `ExpressionNode.tsx`). `parseVariables()` regex-extracts identifiers minus a RESERVED set (math fns + constants + JS globals). `compileExpr()` wraps the formula in a `new Function()` with a math preamble and smoke-tests it with zeros to catch syntax errors at compile time. `_rebuild()` diffs old vs new variable sets and returns `{ added, removed }` so the component can drop cables for removed sockets before calling `removeInput`. `broadcastN()` does variadic element-wise broadcast (any list arg → element-wise; scalars broadcast against it). Inputs default to `node.literals[var] ?? 0` when unwired. `new Function()` is acceptable here — it's a desktop Tauri app where the user writes their own formulas.
- **Format Controller** (`formatController.ts`, `formatAnnotationStore.ts`, `FormatControllerNode.tsx`). A docked node that annotates a host socket with a number format + unit label. Cross-React-root state lives in two module singletons: `formatAnnotationStore` (`nodeId::socketKey → {format, unit, …}`) and `formatMismatchStore` (FC node ids with a unit clash). `MutableSocket` is a per-instance `SolenoidSocket` subclass whose `setType()` bypasses the `readonly dataType` at runtime so the FC's in/out sockets mirror the host socket's type without mutating the shared singleton. `accentOverride` on `NodeCard` lets the FC color itself from the host socket's data type (or orange on mismatch). Canvas's `rescanMismatches()` runs on both connection events and `formatAnnotationStore` changes. Docking position is maintained by `dockedNodeStore` + Canvas's `nodetranslated` pipe.
- **FC model: format backward, unit forward — one rule, no special cases.** An FC's **format always applies to the box on its input side** (`refreshAnnotation` always targets the source feeding `FC.in`, in place, exactly like a docked FC). Format never travels forward. The **unit** is the only thing that flows downstream, and it does so through the *value* (see `unitFlow.ts`), not by an FC pushing onto consumers. So to format a downstream box (e.g. a Display) you place an FC **after** that box; an FC sitting between two FCs formats the chip behind it (nothing visible) and is effectively just a waypoint — you rarely need one, because the unit propagates through the value on its own. An FC fed a value that already carries a unit **locks** to it (can re-format `3/2 mi`, never re-unit to `3/2 km`, lock icon shown); fed a unitless value it's a free author. `forwarding`/`unitLocked`/`lockedByConvert` now drive only the per-control flow arrows, not annotation direction. **Arrow language** (`FcArrow`, beside each dropdown): Format always shows ← (applies to the box behind). Unit shows the flow — defining FC `← →` (labels its box, sends downstream); inherited-from-upstream FC `→` (arrived from upstream); FC feeding a Convert `← ←` (dictated back from the Convert, applied to its box). `forwarding` = inherited from upstream value; `lockedByConvert` = dictated by a downstream Convert; both set `unitLocked` (disables the dropdown). **Flexible Decimal/Percent**: the `decimal` and `percent` styles take a digit count (`decimalDigits`) and a `decimalMode` (`"places"` | `"sigfigs"`), edited via a middle control row (number input + a places/sig-figs toggle) shown only for those two styles. `applyFormatStyle` reads those params (defaulting to 2 places); the old fixed `decimal_2/decimal_4/percent_0/percent_2` enum members are kept for back-compat but dropped from the dropdown. **Convert** dictates units both ways: an upstream FC feeding it locks to its `fromUnit` (detected via the downstream-Convert branch in `refreshAnnotation`), and it emits `toUnit` downstream through the value — **no adjacent FC required** (a Display, then an FC past it, still locks to `toUnit`). Convert's ◀/▶ arrows (`imposesUp`/`imposesDown` from `syncUnitArrows`) track only whether each socket is *connected*, since the push is unconditional; it also shows dual in/out boxes with its own format dropdowns.
- **Unit flow** (`unitFlow.ts`). A unit is a property of the *value*, not a cable, so it must survive any node that passes the value through unchanged (a Display), change at a transform (Convert), and clear elsewhere. `makeUnitResolver(editor)` answers "what unit does this output socket carry?" by walking back through the graph, memoized + cycle-guarded. Per-node rule, all duck-typed (no node-class imports): Convert (`fromUnit`+`toUnit`) → carries `toUnit`; FC (`unit`+`format`) → forwards its input's unit if one is established, else authors its own; passthrough (`passesUnitThrough === true`, set on `DisplayNode`) → carries its input's unit; everything else → none. `FC.refreshAnnotation` calls `resolver.inUnit(this.id, "in")` to decide its lock, so a unit stays locked all the way down `node→FC→Display→FC` (the trailing FC resolves "mi" through the Display). The resolver recomputes from the chain root (never from an FC's possibly-stale locked-unit cache), so the author-vs-lock split is order-independent. **To make a new node unit-preserving, set `passesUnitThrough = true`** — that's the whole opt-in. The display-annotation store (what a box renders, always written backward) stays separate from unit flow (what the value carries forward).
- **Persistence** (`persistence.ts`). Serializes the graph to plain JSON and rebuilds it, reusing copy/paste's reconstruction path. A node saves as `{ id, type: constructor.name, x, y, init: extractInit(node), literals, stringLiterals }`; connections as `{ source, sourceOutput, target, targetInput }`. **Constructor lookup** is derived from the Add-menu catalog: `ctorRegistry()` calls every `FLAT_CATALOG` leaf's `create()` once and records `inst.constructor.name → Ctor` (lazy + cached) — no hand-maintained class list. `constructor.name` is stable in prod via esbuild `keepNames`. **On load**, ids are remapped (fresh ids avoid colliding with live ones); FC `hostNodeId` is rewritten through that map, then each FC's `dockSelf` re-registers its dock after host + cables exist; the connectioncreated pipe re-derives FC annotations / Convert arrows from the wiring. Clearing the old graph (`removeNode`) fires `noderemoved` → `FC.undock`, so FC stores self-clean. **localStorage autosave**: `scheduleAutosave()` (700ms debounce, suspended during load) is hooked into `processGraph` via `setGraphChanged`, and into `nodedragged` for positions; `restoreAutosave()` runs at Canvas init and, if a saved graph exists, loads it and skips the default seed. Explicit **export/import** (`exportGraphToFile`/`importGraphFromFile`) are the NavMenu save/open buttons. Not yet persisted: collapse state, exact viewport (load does `zoomAt` instead).
- **Regex / GroupBy** are conventional kit nodes. Regex output is `anyOut` (honest — the result type is number/number[]/string/string[] depending on op); `extract_all` only operates on a single string. GroupBy is multi-output (`InlineOutputRows`): an `any` keys output preserving key type + a `list` aggregated output.

## Group nodes (feature-complete; polish only)

A **GroupNode** (`nodes/group.ts`, `components/GroupNode.tsx`, `groupLogic.ts`) is a framing container: a real Rete node (selection/drag/persistence/copy-paste all work) with no sockets when expanded. Solid colored header (thicker, bigger type), translucent tinted body with a dashed outline. It must paint **behind** its members — `simpleNodesOrder` stacks by DOM order, so the component pins the view element to `z-index:-1` each commit (`sendGroupToBack`), reinforced on `nodecreated`.

**Membership is hybrid** (`groupLogic.ts`): an explicit `members: string[]` seeded from the selection at creation (Ctrl/Cmd+G → `createGroupFromSelection`, auto-fits the box), then reconciled spatially — on `nodedragged`, `reconcileGroupMembership` adds/removes the dragged node by whether its center is inside any group box. Dragging the group header carries members along: on the group's `nodetranslated`, `moveGroupMembers` translates each member by the same delta (members moved programmatically don't fire `nodedragged`, so no spurious reconcile). `noderemoved` → `dropFromGroups`. Persistence remaps `members` through the id map (like FC `hostNodeId`); group fields (`members`/`color`/`collapsed`/`width`/`height`) are in the copyPaste/persistence allowlist.

**Drag-resize**: a bottom-right grip on the expanded frame (`onResizeDown`) sets `node.width/height` live (screen delta ÷ zoom), then `reconcileGroupBox` re-evaluates membership against the new bounds.

**Phase 2 — collapse engine** (`groupCollapse.ts`). Collapse is **visual-only**: members stay wired and computing; the chevron sets `node.collapsed` and `syncGroupCollapse` recomputes the hidden/retained sets and hides member node elements with **`visibility:hidden` + `pointer-events:none`, not `display:none`** — `display:none` collapses the element to 0×0, killing its ResizeObserver measurement and socket positions, so on re-expand (especially after a Tidy moved the collapsed box) members come back half-rendered and cables anchor at the origin. `visibility:hidden` keeps the element laid out. Hidden **cables** render `null` via `ConnectionComponent` reading `groupCollapseStore`, but only cables whose **both** endpoints are in the *same* collapsed group hide (a cable between two different collapsed groups stays visible — both ends are already redirected to their pills). The collapsed group renders a compact **readout list** of its retained terminals (label + live value, honoring FC formatting via `getForNode`). `syncGroupCollapse` runs on the chevron toggle and on every topology/membership change (connection events, `nodedragged` reconcile, `noderemoved`, load).

Retain rule (`recomputeGroupCollapse`): a **Display** is retained iff its *effective output* has no connection or that connection leaves the group. Effective output follows one **Display→FC** member hop — if a Display feeds a member FC, the FC's output is tested/exposed but the **Display** stays the visible readout. So `Display→FC→outside` is retained (shown as the Display), `Display→FC→inside` is hidden, `Display→(nothing)` is retained.

**Pill sockets** (done): crossing cables no longer hide — they redirect their hidden endpoint to an edge pill (`PillRedirect` in `groupCollapse.ts`; inbound→left, outbound→right aligned to the retained row). `ConnectionComponent` overrides that endpoint from the group's position + `pillY(index)`; the group renders matching pill dots. `COLLAPSE_LAYOUT` is the shared geometry. Only *purely internal* cables (both endpoints hidden) still hide.

**Still TODO**:
- **FC type through passthrough** (done): an FC on a Display reads the concrete type *through* the Display's `any` socket via `concreteTypeOfOutput` (so an FC on a Display fed by text gets text controls). `adaptTypeFromConnections` now handles docked + wired and runs for every FC on connection changes.
- **Tidy + groups** (done). One flow, two modes (via `withinGroup`): **global** keeps each GROUP in the ELK layout (excluding its members) and **within-group** lays out one group's members. Both reuse the docked-FC footprint reservation + edge bridging. *Global*: a group is proxied as one rectangle (its rendered box) with **empty inputs/outputs**, and every cable touching a member is remapped to its group as a **node-level ELK edge** (`tidy-gbridge-*` with an empty socket key, so `connectionToLayoutEdge` keys on the node id directly). Synthetic `g-in`/`g-out` ports were tried first and silently failed ELK port-id matching, leaving groups pinned while free nodes moved. After layout the group's net delta is applied to all its members (rigid, relative positions kept). *Within-group*: lays out the members, re-anchors to the box interior, **autogrows** the box, skips reframing. Docked-FC members snap back via `repositionDockedTo`.
- **Group color picker**: a header swatch opens a palette popover of the distinct `NODE_KIND_ACCENTS` + gray (`GROUP_PALETTE`); picking sets `node.color` and rebuilds the membership store (the member dots follow). The expanded group's `z-index` is raised to 20 while the palette is open so it isn't hidden behind other nodes.

**Group resize undo/redo**: the classic history preset doesn't track width/height, so the resize handler snapshots `{width,height,members}` before/after and pushes a custom action via `process.pushHistory` (`HistoryPlugin.add`), registered by Canvas.

**Group copy/paste**: `pasteClipboard` remaps a pasted group's `members` through an old→new id map (members not in the copy are dropped — a copied box doesn't steal the originals).

**Absorb on LIVE create only**: a node created fully inside a group's box joins it (`absorbIntoContainingGroup` on `nodecreated` — Add menu, paste, docked FCs). This is gated by `!isGraphRebuilding()`: during a graph **load** or **seed** build every node fires `nodecreated`, and membership there comes from the explicit saved/seeded `members` list, not spatial overlap — without the gate, reloading swallowed any node that merely overlapped an expanded group. `process.ts` owns the `beginGraphRebuild`/`endGraphRebuild`/`isGraphRebuilding` counter; `loadGraph` brackets its work with it (and seeds load via `loadGraph`). (Membership otherwise comes from **Ctrl+G** `createGroupFromSelection` or **dragging** into the box via `reconcileGroupMembership`.)

**Output pills are real sockets**: a collapsed group's output pills render as `NodeSocket` for the retained terminal's effective output — draggable to start new cables, and type-colored. Input pills stay ephemeral markers (group color, darkened border) that vanish when their cable breaks.

**Membership edge cases handled**: membership is **exclusive + stable** — a node stays in its current group as long as its center is inside it, so an overlapping group can't steal it (`reconcileGroupMembership` only re-homes a node once it has *left* its current box; `reconcileGroupBox` skips nodes already in another group). A **docked FC follows its host's group**: it moves programmatically with the host so it never fires its own `nodedragged` reconcile, so `reconcileGroupMembership` loops `dockedNodeStore.getDockedTo(host)` and syncs each docked FC's membership to the host's group.

**Header title focus-swap + ellipsis** (groups and normal nodes): the title is a display `<div>` (single line for groups via `white-space:nowrap`; 2-line `-webkit-line-clamp` for nodes) that swaps to a `<textarea>` only while `editing`. Both occupy the *same* flex box (`flex:1 1 auto; min-width:0`) so the truncation point and the edit caret line up. `min-width:0` is required — flex items default to `min-width:auto`, which blocks `text-overflow`. Group titles cap at `max-width:55%` to truncate before the swatch.

**Seeds are JSON files** (`seeds.ts` + `seedGraphs/*.json`): a seed is a plain JSON graph in the **same shape as Export** (`serializeGraph` → `{ v, nodes, connections }`), optionally with a top-level `"label"`. `seeds.ts` globs `./seedGraphs/*.json` (`import.meta.glob`, eager) into a `SEEDS` registry keyed by filename (`getting-started.json` → id `getting-started`, label from the file or title-cased id). `clearAndLoadSeed(id)` just calls `loadGraph(seed.graph)` (which clears + rebuilds + reprocesses + zooms). Canvas first-load uses `DEFAULT_SEED_ID` (`getting-started`, else the first seed found); the NavMenu dropdown lists `SEEDS`. To add/author a seed: build it in-app, **Export**, drop the file in `seedGraphs/`. No code change, no inline builders. Seeds CAN also be hand-authored (the `power-features` showcase was): `seeds.test.ts` validates every seed against the real node classes — types construct, connections land on existing compatible sockets, group members / FC hosts / standoff ends resolve — so a typo'd socket key fails CI instead of silently dropping at load. It also enforces **group-geometry invariants**: every member's center inside its group's box, and no non-member center inside an expanded box. Violations are the "groups absorb random nodes" bug — `reconcileGroupBox` / drag-reconcile go by center-inside-box, so a stray far member makes autofit balloon the box over bystanders (this exact rot was found and fixed in famous-math + magnetic-flux, whose boxes stopped short of their docked-FC members, and getting-started, which contained a collapsed accidental DUPLICATE of the mi→km cluster parked on the TEXTSPLIT group). (The old TS `buildShowcaseSeed`/`buildSeed*` builders were removed; the seed-rebuild guard `beginGraphRebuild`/`endGraphRebuild` now wraps only `loadGraph`.)

## Theme system (accent + light/dark)

`appTheme.ts` is a module-level singleton (same pattern as `cableShapeStore`) holding an **accent color** and a **light/dark mode**, both persisted to localStorage and applied as CSS custom properties on `<html>`: `--accent`, `--accent-soft`/`--accent-mid` (translucent), `--accent-ink` (contrast text on the accent, via `contrastInk`), plus `data-theme="light|dark"`. `initAppTheme()` runs once in `main.tsx` before render. The `AppToolbar` (top-right) hosts the accent swatch picker + a sun/moon mode toggle; it reads the store via `useSyncExternalStore(subscribe, version)`.

Theme **surfaces** are a semantic CSS-variable token layer in `App.css` — dark defaults on `:root`, light overrides on `:root[data-theme="light"]`. The neutral ramp is the source of truth: `--surface` (raised chrome: node body, menus, popovers), `--surface-sunken` (recessed fields: inputs, value/result boxes), `--surface-raised` (hover/selected fills), `--border`/`--border-strong`/`--border-subtle`, `--text`/`--text-bright`/`--text-dim`/`--text-muted`, `--shadow-card`/`--shadow-pop`. App-chrome aliases (`--app-bg`, `--canvas-bg`/`--canvas-dot`, `--panel-bg`/`--panel-border`, `--btn-*`) reference the ramp so they flip automatically. Canvas.tsx only sets the dot-grid's background size/position, so CSS owns its colors.

**All node + chrome CSS now reads these tokens** — the whole app themes (light/dark), not just the chrome. The conversion was a scripted sweep (`perl -pi` mapping the recurring grays → tokens) plus hand-fixes for context-dependent values. Deliberately **left hardcoded** (semantic, theme-agnostic): the FunctionReference category badge colors, parity oranges (`#c07830`/`#e06c2e`), the remove-red (`#e06c75`), the Slicer selection blue, and the Conduit's metallic arm grays. The `op-select` data-URI chevron stroke stays gray (`%239aa0a6`) — reads on both themes; can't take a CSS var inside a data URI.

The swatch palette is shared via `palette.ts` (`COLOR_PALETTE` = gray default + distinct `NODE_KIND_ACCENTS`, plus `hexToRgba`/`contrastInk`, moved out of GroupNode). The popover grid itself is a reusable component, `components/SwatchGrid.tsx` (+ `.css`) — both the Group header picker and the app accent picker render it; each host owns only its trigger button, open state, and popover positioning (`.solenoid-group__palette` / `.solenoid-apptools__palette` are now position-only).

**Light-mode tuning tokens** (all in `App.css`, dark default + light override):
- `--header-tint` — node header accent-tint strength (16% dark, 26% light; pale-over-white needs more). Header bg is `color-mix(node-accent var(--header-tint), var(--surface))` — opaque, so it's controllable per theme.
- `--select-ring` / `--select-glow` — selection ring + glow. Accent in dark; **neutral gray** in light (palette-colored glow looked wrong on white). Used by both node and group selection.
- Light ramp inverts the card/field relationship: `--surface` (card) is soft off-white, `--surface-sunken` (inputs/dropdowns/value boxes) is **white**, canvas a shade grayer — so fields read as familiar white inputs, not gray recesses.
- `--sock-*` — socket type colors now resolve through CSS vars (set on `SOCKET_COLORS` in `sockets.ts` as `var(--sock-…)` strings; consumed as fills/strokes/inline colors by dots, cables, conduit, legend, FC — never parsed as hex, so theming is live). Light mode lightens only the dark **array** variants (list/strlist/datelist) so they sit closer to their scalar siblings. `--socket-ring` softens the inset socket outline (was hard `rgba(0,0,0,0.4)`).
- `--conduit-*` — the Conduit's metallic arm/border/pivot grays, themed so the bar isn't a dark blob on a light canvas.
- `--shadow-pop` softened (was `…0.45`/`…0.16`) and every floating panel (NavMenu, SocketLegend, Minimap, the two top toolbars, popovers, conduit toolbar) routes through it.

Header weights settled: node headers `600` (semibold), group headers `700` (bold).

**Palette shift + dedupe** (`palette.ts`): `themeAccent(hex, mode)` nudges a color slightly darker + more saturated in light mode (HSL: `l-0.05`, `s+0.05`) so the dark-tuned accents don't glow on white. Applied at the consumption points that re-render on theme toggle: `NodeCard` (`--node-accent` + the grouped-node `--group-color` ring; now subscribes to `appThemeStore`), `GroupComponent` (display color; `node.color` stays canonical — the swatch picker still compares against the raw value), and the `Minimap` tints. `COLOR_PALETTE` now perceptually de-dupes (low-saturation colors collapse to one "gray"; saturated colors bucket by hue+lightness) — the two near-identical golds (display/format) and two muted grays (default/util) were showing as duplicate swatches.

## Documents model (2026-06-15)

The seed↔autosave overlap is fixed: the app now has a real **documents library**.

- **Storage.** `documentStore.ts` keeps `{ v, documents: [{id,name,graph,updatedAt}], currentId }` in localStorage via the same two rotating slots + save-failure notice as the old autosave (the crash-safety from `persistenceCore`). Pure library transforms live in `documentStoreCore.ts` (unit-tested): add / rename / duplicate / remove (re-points current) / updateCurrentGraph (floats to top) / `validateLibrary`. A pre-documents single autosave is migrated once into a one-doc library (named after its seed, else "Untitled").
- **Autosave** now means "serialize the live graph into the CURRENT document". `persistence.scheduleAutosave` kept its debounce + suspend gate (every caller still drives it) but delegates to `documentStore.captureCurrent()`; the slot/restore machinery moved into documentStore. `loadGraph` returns a boolean and skips `zoomAt` on an empty graph (New blank).
- **Seeds are templates now**, not the working graph. `documentStore.newFromTemplate(seedId)` forks a seed into a fresh document; `SeedSelect` (the app-bar example dropdown) and the `process.ts` seed-selection plumbing it drove are retired (a few now-dead exports there can be swept later).
- **UI.** `components/DocumentTitle.tsx` is the document hub: the current name centered in the menu bar (accent-ink), click → inline rename (Excel-style), ▾ caret → documents menu (switch / New blank / Duplicate / delete-with-confirm / New-from-template list). On mobile it moves into the **app bar** itself (left of the apptools, where the Tidy quick-action used to be — that was dropped); `.solenoid-topbar__doctitle` reveals it on touch with panel-surface ink + a left-anchored dropdown. The File menu gained New / Duplicate and relabeled Save/Open as Export/Import to file. Import becomes a new document.
- **Circular import** persistence ⟷ documentStore is intentional and safe: neither calls the other at module-eval time (only inside functions).
- Follow-ups: a name-prompt for a true "Save As" (today = Duplicate + rename via the title); a fuller manage/rename UI for non-current documents; per-document localStorage keys if the single library blob gets large.

## Ribbon — v1 shipped (2026-06-09)

A **Ribbon** node (`nodes/ribbon.ts` + `components/RibbonComponent.tsx`) — a forked, simplified Conduit. One rotatable block bundles up to `RIBBON_MAX_LANES` (8) `any` cables; lane i routes in_i → out_i (output mirrors input). Built on the Conduit's invariants:

- **Fixed hit-body, overflow the visual.** `BODY_SIZE = 72`, pivot = body centre. The block + sockets grow symmetrically around the pivot and overflow the body, so the node's top-left never moves between states — no `area.translate` recenter, no one-frame flash (the trap the old design note flagged). This is what makes the deselect-collapse free.
- **One uniform scale, not a layout change, on select/deselect.** `expanded = selected || (dragging && near)` picks `scale = 1` vs `COLLAPSED_SCALE` (0.6), and **every** dimension is base × scale (HALF_W, SPREAD, END_PAD, PIN, socket size, stripe). Must be a real layout scale, NOT `transform: scale()` — rete measures sockets from `offsetLeft/Top`, which ignores transforms, so a CSS scale would desync cable endpoints. The scaled socket size is pushed to `--socket-size` inline on the root so the dots track the body. Re-render on select/deselect (the selector's `area.update`) is what swaps the scale.
- **Connector look (per the IDC-ribbon reference photo).** Darker-gray shell (`#464b54`) + lighter-gray border (`#8a909c`) + a **pin field** (`__pin`, a grid of small dark-gray squares filling the interior — cols/rows derived from the body size, not lane count, so it never collapses to "two dots"; body floors at `MIN_BODY_LANES` so a 1–2 lane ribbon still reads as a connector) + a red **pin-1 stripe** on the lane-0 edge. Selected keeps the greys (size communicates selection) and just lights the border accent + a glow. Body, pins, and stripe all live in one `<g transform={rot}>` so they rotate together in pivot-local coords; the socket dots are HTML, rotated in JS via `place()`.
- **Geometry.** Inputs on the −x face, outputs on the +x face, pins at x=0; `place()` rotates (lx, ly) by `angle` around the pivot.
- **Rotation is quantized to 45°** (`snap45`, AngleDial `step=45`). Off-45 angles made the per-socket diagonal cable leads look bad, so the leads (`cableAngleStore` set to `angle` for every in_/out_) only ever exit on diagonal-friendly angles.
- **Inspector (selected only):** an **Extend** button — spawns a new Ribbon downstream along the flow direction and wires every current lane's output into it — and a 45°-step rotation **AngleDial**. No spacing control (unlike Conduit). No internal in→out cables.
- **Plumbing touched:** registered in `rete-nodes`, `nodeRegistry`, `kind` (util), `nodeCatalog` (Output category, `parity:false`); `extractInit` gains `"angle"`; `socket.css` adds `.solenoid-ribbon` scoped sizing + the touch selection-gating rules; `Canvas.tsx` adds `.solenoid-ribbon` to the lasso click-guard and generalises the auto-arrange port-proxy (`isConduit` → `isBundler`, generic first-key fallback) so ELK lays the Ribbon out small.

Deferred from the original (more ambitious) design below: explicit in→out remapping and cable-multiselect "add to bundle" authoring. v1 is the node itself; those build on top.

### Combo sockets + Cast node (2026-06-10)

- **`strcombo` / `datecombo`** mirror `numlist`: scalar-or-list combos (SOCKET_ACCEPTS entries `["string","strlist"]` / `["date","datelist"]`), rendered as the same bicolor split square via `COMBO_COLORS` in SocketComponent. TEXT's output moved from the interim `any` to `strcombo`. ConnectionComponent resolves combo cable colors from the live value (array → the combo's list color).
- **`formatNumberPattern`** extracted from TEXT into an export — and its decimal branch FIXED: the regex was `/^0(\\.0+)?$/`, a double-escape matching a literal backslash, so "0.00" had never actually formatted decimals.
- **Cast** (`nodes/cast.ts` + `components/CastNode.tsx`): universal type conversion to number / text / date (serial) / complex, element-wise over lists; `format` applies when casting to text (number patterns, or date patterns for date sources). Two key mechanics: `sourceKind()` reads the FEEDING socket's dataType at data() time — the only way to tell a complex `[re, im]` tuple from a 2-number list, and a date serial from a plain number; and the output socket swaps in place per target (`applyCastTarget`, same pattern as the frame nodes' read-as toggle). Replaced by it and REMOVED 2026-06-19 (were hidden/load-only): TEXT (`TextNumNode`), VALUE (`ValueNumNode`), Format Date (`FormatDateNode`); their Excel equivalences (TEXT / VALUE / VALUETOTEXT) live on the `cast` entry so Add-menu search still finds them. Kept the shared helpers `formatNumberPattern` (text.ts) and `formatDateSerial` (date.ts) — Cast + the FC use them. NUMBERVALUE stays (custom separators).
- **StatusBar** shows the node TYPE for a single selection (`nodeTypeName`, exported from nodeNames — same derivation as the header hover hint), not the user-editable title.

### The great renaming (2026-06-10, save format v2)

Product naming shifted: the old two-arm **Conduit** node is deprecated and renamed **Manifold** (`hidden: true` in the catalog — load-only, can't be added); the block node formerly called **Ribbon** is now **Conduit** (`ConduitNode`, `ConduitComponent`, `conduit.css`, `nodes/conduit.ts`); the bundled cable formerly called a **bundle** is now a **Ribbon** (`ribbonCable.ts`, `ribbonForConnection`, `ribbonHoverStore`). Saves bumped v1→v2; `LEGACY_TYPES_V1` in `persistence.ts` migrates old type names on load (version-gated because v2 reuses the name `ConduitNode` for a different class). The section below predates the renaming — read "Ribbon (node)" as Conduit and "bundle" as Ribbon.

Also from this pass: the Conduit inspector toolbar docks to the lower-left of the viewport (portal to `document.body`, fixed position — zoom-invariant); collapsed-group pills paint above the group selection ring (`z-index: 7` vs the ring's 6); selecting a separated ribbon lane pins the separation open (`pinRibbonSeparation`, keyed by the selected cable id so the pin self-expires when the selection moves on — trunk clicks don't pin, which is what keeps whole-ribbon selection bundled). If the pin behavior still feels unintuitive, the fallback design is the Conduit's red stripe as a per-node "bundling off" toggle.

### Ribbon output bundles (2026-06-09)

Ribbon **outputs render as one cable** when 2+ non-ghost lanes go to the same entity — another visible Ribbon, or one collapsed group (`ribbonBundle.ts`):

- **Trunk + fans, mirrored at both ends.** The lowest-lane connection is the *representative*: it draws the wide neutral trunk (`BUNDLE_COLOR #8a909c`, `BUNDLE_WIDTH 7.2` ≈ 4× a normal cable, fixed regardless of lane count per product direction) with **flat butt caps**, from a merge point `BUNDLE_SPLIT 24`px past the source output face to a split point 24px before the target input face. **Every** member (rep included) draws two straight fan branches — source socket → its own *slot* on the trunk's flat starting face, and its slot on the flat end face → its rete-measured target socket. Slots spread across the trunk width (`((rank+0.5)/n − 0.5)·width`), ranked by source-lane order at the start and target-lane order at the end, so branches sit side-by-side emerging from the flat cut and can never cross; no component ever needs another lane's socket position. Fans carry the lane's type colour; the trunk stays neutral.
- **Collapsed-group target: no target fan.** All crossings from one external Ribbon share a single pill row (`InputPill.lanes > 1` in `groupCollapse.ts`); the trunk terminates whole on a combined pill that reuses the collapsed-node `solenoid-node__input-pill` stadium (socket functional underneath via the `pill-socket` dot-hiding trick), coloured by the first member socket's type. Source-side fans still apply.
- **One entity.** `bundleHoverStore` shares hover across the components drawing the parts (plus all endpoint sockets light via `setCableHover`); clicking selects `repId` and every member renders selected; Canvas `deleteSelected` removes **all** member connections in one keypress. Bundle membership is computed fresh per render from the editor (`bundleForConnection`) — no derived state to sync.
- **Selecting a Ribbon separates its bundles.** `ribbonLayoutStore` carries `selected`; `bundleForConnection` returns null when either end's Ribbon is selected, so the lanes render (and delete) as individual cables while you manage them, and re-bundle on deselect.
- **Pill-shaped highlight for ALL pills.** `NodeSocket`'s dot-shaped lit flash carries `.solenoid-socket-lit`, hidden under `.solenoid-node__pill-socket`; `CollapsedInputPill` and the group combined pill draw a stadium-shaped flash themselves when any aggregated socket is highlighted.
- **Geometry plumbing.** `ribbonLayoutStore` publishes each Ribbon's live `{angle, scale}` (face centres move on expand/compress/rotate); `ribbonFacePoint` turns that + the area position into trunk endpoints. The grid constants (`RIBBON_SQ 8`, gaps 1 — tightened from 12/2/2) live in `ribbonBundle.ts`, shared by the component and the trunk math. ConnectionComponent additionally subscribes to `connectionVersionStore` + `ribbonLayoutStore` so membership/geometry changes re-render cables.
- Single-lane Ribbon→Ribbon/group links stay normal cables (bundle style starts at 2).

## ~~Future~~ Ribbon cables (design, 2026-06-07 — since built)

> **Status:** this design landed, under the post-renaming vocabulary (the
> "Ribbon node" here is today's **Conduit**; the bundled wire is today's
> **Ribbon**). Shipped: the node + deselect-compress, output ribbons
> (trunk + fans), collapsed-group combined pills, multi-cable selection,
> and Insert Conduit on selected cables (`CableContextMenu`). The open
> questions below were settled by the v1 sections above; kept for rationale.

A **Ribbon** is a planned first-class entity for bundling many connections into one thick cable — the cable-level sibling of Conduit (which bundles via a *node* in the path; Ribbon bundles via the *wire*). Motivation: when several external cables cross into a collapsed group, the group currently shows one edge input socket per crossing (one per `${target}::${targetInput}` in `groupCollapse.ts` `_inPill`). With Ribbons, a group whose every inbound crossing comes from a single Ribbon can render as **Ribbon → one entry socket**, so a collapsed group reads as taking a single record input.

Intended shape (per product direction):
- **Real, persisted entity**, wired like Conduit: connect any number of node outputs *into* the Ribbon, then **manage the Ribbon's outputs** to their destinations (an explicit in→out mapping the user controls).
- **Two visual states.** *Focused/expanded* (selected): the full management view — every wire and its in/out mapping is editable. *Collapsed* (on click-off / deselect): it compresses the bundle into one thick ribbon. The **deselect-to-collapse** interaction is the novel part — distinct from the chevron-driven group collapse and from Conduit's fixed body. (Watch the async `area.translate` / one-frame-flash trap from the Conduit pattern when the footprint changes on deselect.)
- The merged entry socket has a real referent (the Ribbon), which is what makes it cleaner than naively merging same-source sockets: re-wiring means "drop onto the Ribbon," not onto one ambiguous inner input.
- **Authoring via cable multiselect.** Select multiple cables and **add them to a Conduit or a Ribbon** with a hotkey / action (bundle existing wiring in place, rather than re-wiring by hand). Same gesture serves both bundlers. *Prerequisite:* cable selection is currently single (`cableSelectionStore` holds one id; `ConnectionComponent` sets/clears it on click) — multi-cable selection (shift-click / lasso-over-cables) has to land first, and the "add to bundle" action then operates on that set.

Open questions to settle before building:
1. **Membership / mapping model** — how inputs bind to outputs inside the Ribbon (1:1 named lanes? arbitrary fan-out?). This is also what the group collapse rule ("every inbound crossing comes from one Ribbon") tests against.
2. **Deselect-collapse mechanics** — keep a constant hit-body and overflow the visual (the Conduit resizable-content pattern), since the size changes between states.
3. **Relation to Conduit** — distinct elements, or is Conduit the node form and Ribbon the wire form of one concept? Decide before duplicating bundle logic.
4. **Type / value model** — each lane keeps its own type and live value (`cableValueStore` stays per-connection); the Ribbon is a topological + visual grouping, not a new data type. Socket legend needs a ribbon affordance.

Related deferred item: "merging same-source inbound edge sockets on collapsed groups" — Ribbons are the intended *real* solution to that, rather than ad-hoc socket dedup.

## Roadmap: performance & external data

The real performance frontier is **compute on large data**, not bundle size. These chain — data-source nodes create big tables, which motivate the stress test, which justifies the Rust offload — so sequence them in that order.

- **Table stress testing (do first — measure before optimizing).** The whole graph recomputes on every `processGraph` (`engine.reset()` clears all caches), and the 2D ops (MMULT, MINVERSE, big aggregations) are pure JS. Benchmark by cell count and op type to find where it actually falls over, so we offload the real bottleneck rather than a guessed one.
- **Rust backend (via Tauri `invoke`).** Natural since the Tauri shell already exists; move heavy ops to Rust. Design problem: the async boundary with the push-based `DataflowEngine`, whose `data()` methods are effectively synchronous today — offloaded ops return promises, so the engine/node contract needs an async path.
- **External Source nodes (CSV / file import) + Web Source nodes (URL/API).** "Real data in" — turns the app from toy into tool. Two design decisions: (1) **persistence** — serialize the imported data into the graph JSON, or store a path/URL reference and re-fetch on load? (2) **fetch** — Tauri bypasses CORS on desktop; a web build can't, so web-source nodes behave differently per target.

Also wanted (lighter): **more visual output nodes & controls** (sparkline is the first; see TODOs).

## Known bugs / polish

- ~~**Collapse: non-Display member with an external output**~~ — fixed (2026-06-05). `recomputeGroupCollapse` in `groupCollapse.ts` now runs the generalized retain rule: Pass 1 builds the special-cased visible Display readouts (incl. the Display→FC hop), Pass 2 walks every outbound-crossing connection and emits a *generic* readout row (label from `genericLabel` + live value + right pill) for any non-Display member whose output leaves the group, skipping ones already exposed by a Display. The compact box sizes to include them. This is the one-rule fix that was sketched here, not a patch.
- **Header accent overlap** (`nodeCard.css` `.solenoid-node__header`): the 2px accent border (with `margin: -1px` over the card border) slightly overlaps the gray body border at the header's bottom corners. Two attempts to fix it (outside-poke pseudo, inset frame) both made it worse and were reverted. Current baseline: `border: 2px solid var(--node-accent); border-bottom: none; box-shadow: inset 0 -1px 0 #2d2d2d; margin: -1px -1px 0; top radius 8`. Don't re-architect.
- **Add-menu title ~2px bump**: switching tree→search near the viewport bottom bumps the "Add node" heading ~2px when accent items are in the results. Low priority; don't re-architect.
- ~~**Multi-expand push, final arrangement**~~ — fixed by the `groupPushCore.ts` rewrite: clears are direction-aware (connection anchors pick the side that keeps cables shortest; unconnected boxes clear along the axis matching their position), replacing the old right/down-only `pushAfterMultiExpand`/`pushNeighborsOnExpand` pair entirely. See CLAUDE.md "Group expand push".

## TODOs

- ~~**Persistence (save/load)**~~ — done (`persistence.ts`). See below.
- ~~**MAP / BYROW / BYCOL / MAKEARRAY over 2D**~~ — done (`nodes/tableLambda.ts`, `components/TableLambdaNodes.tsx`). **REDUCE joined the family (2026-06-10)**: `ReduceLambdaNode` folds row-major over `acc`/`x` (+ 1-based `i`) from an Initial value; its `table` socket means a plain list widens automatically via the numeric lattice. Closed the last EXCEL_GAP entry — `parity.ts` now reports 0 unimplemented. Tests in `tableLambda.test.ts`. **MAP is multi-array now (2026-06-10)**: optional `y`/`z` tables zip cell-wise (Excel's `MAP(a, b, LAMBDA(x, y, …))`); an extra table must match the first's shape or be 1×1, which broadcasts — and since a wired scalar widens to 1×1, that broadcast is the stand-in for a captured constant (Excel's LET/LAMBDA closure). Capped at three arrays vs Excel's N (`parity:false` note updated). Each node embeds a formula compiled via `compileLambda` (the same `new Function` approach as Expression) over fixed variables — MAP: `x`/`r`/`c`; BYROW/BYCOL: `v` (the row/column list); MAKEARRAY: `r`/`c`. The lambda scope adds array-aware aggregates (`sum/avg/min/max/count/product/median`, all flattening their args) so a BYROW/BYCOL lambda reduces its vector while MAP/MAKEARRAY scalar lambdas still work. BYROW/BYCOL are one node with a row/col axis toggle (same sockets); MAP/MAKEARRAY are separate (different I/O shapes). No first-class function value flows down a cable — the formula *is* the per-cell/row callback. Registered in the Add menu under Tables & Matrices → Lambda; `parity:false` (formula-string lambda vs. true LAMBDA, single-array MAP).
- **Cable routing** (later): parallelize overlapping cables; route cables to avoid passing under nodes. Current stopgap: exact-duplicate-cable guard in `Canvas.tsx`'s `connectioncreate` handler.
- **Format Controller: Table socket support + extra options** (open — the main remaining FC gap). The FC mirrors its host socket's type and picks a sensible default (date special-cased in `_applyType`), and the render path formats scalars / strings / lists — but **`table` isn't handled**: `ValueDisplay` in `nodeKit.tsx` branches on scalar/string/list only, and `formatNumberWithAnnotation` is per-number, so a 2D value never gets the annotation applied per cell. Table support = (a) format each cell of the grid through the annotation wherever table values render, and (b) give the FC table-appropriate defaults when docked to a `table` socket. "Extra options" is a smaller wishlist (exact set TBD with the author).
- **Expression function source-of-truth** (decide later): the Expression/LAMBDA engine currently calls **Formula.js** (`@formulajs/formulajs`) directly via codegen — a *separate* implementation from the app's own ~150 nodes, so e.g. `ROUND()` in a formula and the ROUND node could diverge, and the function *sets* differ. Two intertwined-but-separable questions: (a) **where functions live** — move to an internal `EXCEL_FUNCTIONS` registry seeded from existing `nodes/dist-*.ts` / `mathUtils.ts` exports (consistency) vs keep Formula.js (breadth: text/date/financial/lookup we lack as nodes); a middle path is internal-first + Formula.js fallback. (b) **a dedicated Expression node + socket type** — makes a formula a pipeable first-class value and lets an "Expression Input" node validate once at the source (syntax / unknown-function / unbound-var) before it flows; independent of (a), and still carries the variable-binding contract + dynamic-sockets-from-a-value problem. Recommended first step if pursued: build the function registry (decouples "where functions live" from "how Expression is shaped").
- **LAMBDA examples seed** (later): a seed graph that replicates Microsoft's documented examples for LAMBDA and the helpers (MAP/BYROW/BYCOL/MAKEARRAY/REDUCE/SCAN) from their docs page, as a showcase + parity check now that the formula grammar is Excel.
- **Expression node resize handle** (later): the Expression formula box should be user-resizable (drag handle) rather than auto-height-only, so long formulas get room. The node-resize plumbing already exists (`nodeSizeStore`, the Conduit/resizable-node pattern); wire the Expression body to it.
- ~~**Animated cable flow mode**~~ — shipped (2026-06-09), CSS version. Toggle in the Cable toolbar (`cableFlowStore`, persisted to localStorage, init in `main.tsx`). When on, `ConnectionComponent` renders a second overlay `<path>` per live cable (real + committed only, not pseudo/ghost) with a round-capped `stroke-dasharray: 0.01 72` — the near-zero dash + round cap = a circular bead, the long gap spaces them — animated via `stroke-dashoffset` (keyframes in `canvas.css`, `.solenoid-cable-flow`). Bead tint is `color-mix(in srgb, <typeColor> 85%, #fff)`, width `baseWidth + 3.5`. Negative offset drives beads source → target (the path is drawn that way). The toolbar toggle icon uses the same dash trick with two terminal circles drawn on top so bead spawn/despawn hides beneath them. `prefers-reduced-motion` stops the animation.
  - **Scaling ceiling (do NOT pretend this is the WebGL version).** `stroke-dashoffset` is a *paint-triggering* property, not compositor-only like `transform`/`opacity`, so each flowing cable re-rasterizes its stroke every frame on the main/raster threads — cost is O(cables) per frame, 60×/s. Made worse by each cable being its own 9999×9999 `<svg>` (no batching, one DOM node each) and the flow path doubling per-cable paint. Fine into the low hundreds of cables; expect dropped frames in the high-hundreds-to-~1k range, more when zoomed in (more pixels). WebGL would be ~O(1): all cables as instanced geometry, flow as a `time` shader uniform, animating 50 or 50k costs ~the same. But it's a full rewrite of the cable layer (camera/transform sync, hit-testing, hover/selection, angle leads, collapsed-group pill rerouting all live in `ConnectionComponent` today), not a drop-in. **Cheaper mitigations before WebGL, in order:** (1) gate flow by the existing LOD tiers / a cable-count threshold (highest value, lowest effort — it's opt-in eye-candy, just turn it off when zoomed out or graph is huge); (2) one shared `<canvas>` 2D overlay drawing beads along each path under one `requestAnimationFrame` (still CPU/O(cables) but one element, controllable, ~5–10× headroom over per-cable SVG); (3) a single WebGL overlay *just for the beads*, leaving SVG cables for geometry/hit-testing — port only "draw moving dots along these polylines", the real sweet spot for GPU scaling without the full rewrite. The one-off decorative `CableFlourish` predates this and is unrelated.
- **Bundle size** (low priority): production JS is ~2.1 MB (632 kB gzip) in one chunk, eagerly imported via the registry/catalog. For the Tauri desktop build this loads from local disk and is irrelevant; only marginally relevant for a web deploy. Code-splitting by node category with dynamic `import()` is available if a web target ever needs it, but the real perf frontier is compute on large data (below), not download size.
- ~~**Touch / mobile friendliness**~~ — substantially done (2026-06-05; see "Mobile / touch" dated section below). Pan/zoom, a touch select mode, mobile chrome, and the pick-endpoints connection dialog all landed. The dialog solves touch cable-creation without needing to hit a 12px socket, so the old "enlarge socket hit areas" item is moot-by-design (not implemented; `mobile.css` leaves sockets alone). Remaining is only nice-to-have: an optional **tap-to-tap socket mode** as a lighter alternative to the dialog, a thumb-reach pass on toolbar/menus, and long-press vs right-click context menus. Not blocking.
- **Optional node function packs** (idea): opt-in bundles of domain nodes for *established* calculations that aren't in Excel, toggled on like extensions. The magnetic-flux seed nodes are the launching point — they're already non-Excel physics formulas, so they're really a proto "Electromagnetics" pack. Examples: a **Geometry** pack (a "Circle" node giving area `π·r²` / circumference, a "Regular polygon" node, surface/volume of solids), an **Extra engineering** pack (beam/stress, fluid, thermo), **Electromagnetics**, **Finance-pro**, etc. Each pack is a set of task-shaped nodes (one node exposes several related quantities, per the composability rule), `parity:false` since they have no Excel equivalent. Architecture fit: packs register their nodes into the existing catalog/registry behind an enabled-flag, ideally lazy-`import()`ed so a disabled pack costs nothing in the bundle (ties into the bundle-size code-splitting note). Open questions: where the enable toggles live (a "Packs" panel?), how a pack declares its Add-menu category, and whether packs can ship their own seed graphs as worked examples (the flux seed would become the Electromagnetics pack's demo).

## Recently completed (consolidation pass)

- **Expression, Regex, GroupBy, Format Controller** nodes added (see Roadmap stance + Node systems below).
- **`keepNames` in vite.config.ts**: node components show a type hint derived from `constructor.name` (`typeHint` in `nodeKit.tsx`), which esbuild otherwise mangles in production. `esbuild: { keepNames: true }` preserves class names. NOTE: this makes `constructor.name` reliable app-wide, but `nodeKindOf` still uses `instanceof` (clearer for behavior dispatch — leave it).
- **TVM node solve-for fix**: PMT/PV/FV/NPER is one node that *solves for* the selected quantity, so that quantity's input row is now hidden (Excel's `=PMT(rate,nper,pv,fv,type)` has no pmt arg). Op change also drops any cable wired to the now-hidden input. The pattern: a "solve-for-X" node must not display X as an input.
- **copyPaste stringLiterals**: `cloneNode` now restores `stringLiterals` alongside `literals`, so copy/paste preserves typed-in text (Text Input, Regex pattern/flags, Text Filter, …). The `extractInit` key list is a hand-maintained allowlist of constructor params — add to it when a node gains a new persistent constructor field.
- **MATCH removed**: `MatchNode` was a dead, unreachable node (registered but not in the catalog; `EXCEL_TO_CATALOG["MATCH"]` pointed at a nonexistent type). XMATCH fully supersedes it (exact is its default mode), so MATCH was deleted entirely and its Function-Reference row marked "Use XMATCH instead" — same treatment as VLOOKUP/HLOOKUP/LOOKUP.

## Group UX pass + Ctrl-drag fix (2026-06-05)

- **Ctrl-drag detaching a group from its members (fixed).** Root cause: the Ctrl/tap "toggle an already-selected node OUT of the selection" branch in Canvas's first area pipe ran on `nodepicked` and `return`ed to swallow the event. Swallowing skips the selector's `core.pick` AND our `draggingGroupId` bookkeeping — but the node's own DOM drag handler is a separate listener, so a Ctrl-*drag* still moved the body with neither member-follow (`moveGroupMembers`, gated on `draggingGroupId`; nor the selector's follow, gated on `isPicked`) engaged. Fix: defer the toggle-out to pointerup-if-click via `pendingDeselectId` (mirrors the existing `pendingCollapseId`). A Ctrl-drag now behaves exactly like a plain drag; a Ctrl-click still toggles. The reported cable glitches were the same desync (cables stretched between displaced group pills and stationary members).
- **`setGroupsCollapsed(editor, area, targets, collapse)` (`groupPush.ts`)** is the one place that collapses/expands a *set* of groups with neighbour-push applied. It sets the flags, `syncGroupCollapse`, **awaits all `area.update`s** (so footprints reflect the new sizes), then on expand calls **`pushAfterMultiExpand`** and on collapse calls `restoreNeighborsOnCollapse` (a frame apart — see below). The Navigator's collapse-all button (was applying *no* push — that was the bug), the Ctrl+Shift+E hotkey, and any future multi-group toggle route through it. Single-group toggles still call `pushNeighborsOnExpand` directly.
- **`pushAfterMultiExpand` does the multi-group push in ONE in-memory pass** (not per-group with awaits). Two reasons: (a) `area.translate` sets `.position` only *after* its async guard, so a per-group loop reads stale positions and the pushes cancel — that's why a multi-toggle first looked like it applied no push at all; (b) the push axis for each overlap is chosen from the two groups' **original (pre-expand) relative position**, not the shortest displacement, so a left-to-right row stays a row instead of cascading into an L (third group dropping below the second). Boxes still only move right/down so it converges; pushes are recorded under the top-left seed so collapse-all restores them.
- **Cleanup (Ctrl+Shift+L)** = (confirm past the same `TIDY_CONFIRM_THRESHOLD` as Tidy, counting layout units the same way — it's a bigger, harder-to-undo change) → clear selection → tidy each group's members → (settle a frame for deferred docked-FC snap-backs) → autofit each box to its members → collapse all → tidy top level (`{skipConfirm:true}`) → fit. **Tidy-all then autofit-all in separate loops with a 2-frame settle between**: the within-group tidy snaps docked FCs back onto hosts in a *deferred* rAF, so autofitting immediately would wrap the FC at its stale far-right ELK position and pad the box (didn't repro on a manual grip double-click because those FCs were already settled). **Fit reuses the navmenu's `fitAll`** (exported from `NavMenu.tsx`), which is chrome-aware (frames into the free rect between docked panels) and collapse-aware (`collapsedAwareNodesRect`); a raw `zoomAt` centered content in the full container so it landed under the panels and scaled off.
- **Per-group Tidy button** in the group header calls `autoArrange({ groupId })` — the within-group layout path already existed (Case A), just gated on selection before; now forceable. `autoArrange` grew `{ groupId?, skipConfirm? }`.
- **Double-press the resize grip → `autofitGroupBox`** (`groupLogic.ts`): wraps the box tightly to its members (shrink or grow) using the creation-time pad/header offsets; undoable incl. position. The double-press is detected **by hand** (two grip pointerdowns within 350ms) — NOT via `onDoubleClick`, because the grip's `setPointerCapture` + `preventDefault` (for the resize drag) suppress the native dblclick. Don't "simplify" it back to `onDoubleClick`.
- **Hotkeys** (Canvas keydown, all preventDefault'd like the existing Ctrl+A): **Ctrl+Shift+K** tidy, Ctrl+Shift+E expand/collapse (selected groups + selected members' groups; all if nothing selected), Ctrl+Shift+L cleanup. Documented in `ShortcutsOverlay`. (Tidy was Ctrl+Shift+T but Chrome reserves that for reopen/duplicate-tab and won't yield it to the page — moved to K.)
- **Membership corner-triangle dark-mode seam (fixed).** `.solenoid-node--grouped::before` mixed the group color into `transparent` (translucent), then overlaid the *also-translucent* membership border at the corner → the two alphas composited to a darker shade (the artifact). Light mode never showed it because both layers were opaque. Fix: mix into `var(--surface)` (the opaque card bg the border already composites over) so the triangle is opaque and the exact same shade as the border — flush, no seam.
- **Navigator connections icon** swapped off the brush-looking glyph to two sockets joined by a cable (the app's own connection metaphor).

## Mobile / touch + testing-branch merge (2026-06-05)

Merged the `claude/project-backend-no-ui-testing` branch (done on mobile) into `main` and closed the branch out. Working purely from `main` for now; proper feature branches later. What landed:

- **Touch select mode** (`touchSelectStore.ts`): a phone has no Shift (lasso) or Ctrl (accumulate), so one mobile toggle drives both. When on, a one-finger background drag draws the lasso instead of panning, and tapping a node adds/removes it from the selection. Canvas reads it; `MobileControls` toggles it.
- **Mobile chrome**: `MobileControls.tsx`/`.css`, `mobileMenuStore.ts`, `mobile.css` — mobile-only controls and a menu store, plus a mobile stylesheet wired in `main.tsx`.
- **Connection dialog** (`connectionDialogStore.ts`, `components/connectionDialog.css`): an Add/Edit Connection dialog that creates or re-wires a cable by *picking* its two endpoints (optionally prefilled from a node's socket), instead of press-dragging socket to socket. This is the non-drag answer to the old "cable creation is awkward on touch" note. Mounted once in App; the MenuBar's Insert command drives it.
- **Group expand-push** (`groupPush.ts`): expanding a collapsed group grows its footprint and can overlap neighbouring groups; each overlapping group is now pushed clear along its shortest axis (right or down) and the displacement recorded, then slid back on collapse — but only if it's still exactly where we left it (a since-moved group has its record dropped as stale, so a deliberately-repositioned group is never yanked back). Manually dragging either group also invalidates the touching records. Records are in-memory only. The "Pin the expanding group so the push can't displace it" commit fixed the case where the expander itself got shoved; this is the part now confirmed working.
- **Test suite**: `vitest.config.ts` + `*.test.ts` across scalar / list / stats / finance / distributions / convert / coerce / mathUtils and `excelFormula.test.ts`. First real automated coverage for the node compute layer.
- **Node packs framework** (`packs.ts`) + **Settings page** (`settingsStore.ts`): the opt-in node-pack framework is in place (enable toggles on the Settings page; packs register into the catalog/registry behind an enabled flag). Building more domain packs (Geometry, Electromagnetics, …) is future add-on work, not framework work.
- Support bits: `fuzzy.ts`, `nodeNames.ts`.

## ~~TODO: mobile pass for the new chrome (2026-06-06)~~

Done — see "Mobile second pass (2026-06-10)" at the top of this file, which
covered all of these plus the nodes/surfaces added after this TODO was written.

## Text boxes: quoting + whitespace (2026-06-04)

Quoting follows Excel's split between *authoring a literal* and *displaying a result*, keyed to the box's role, not to FC presence (the old rule keyed it to FC presence, which read as arbitrary).

- **Input fields** (authoring): `QuotedTextInput` frames the field with static `"` chrome (the quotes are decoration, never part of the value). The `<input>` auto-sizes to its content via the `size` attr, so a lone or trailing space shows as the gap before the closing quote (the Excel `" "` look). Used by StringInput (`variant="value"`, passes `nodeId`) and Concat's inline rows (`variant="inline"`, no `nodeId`).
- **Value boxes** (display): `ValueDisplay` shows strings with no quotes at all, identical with or without an FC. Leading/trailing/all-whitespace renders as middots (`·`); an empty string shows a dim `(empty)`. These are display-only: the copied/underlying value keeps its real whitespace (`renderTextValue` in `nodeKit.tsx`).

Literal-edit undo/redo: typing into any literal field (number or text) records one history entry per committed edit. Live keystrokes use the browser's native in-field undo (Canvas's Ctrl+Z bails on focused inputs); `useFieldHistory` (in `inlineInput.tsx`) pushes a single `pushHistory` action on **blur** when the value changed since focus.

## Node resize (2026-06-04)

Which nodes get a grip: one predicate, `nodeResizable(node)` next to `nodeKindOf` (kinds `input`/`string`/`convert` + Display + XLookup/XMatch). Easy to extend there. Non-resizable (pure compute) result boxes truncate with ellipsis instead.

The grip (`ResizeHandle`) lives **inside the value box**, not on the card, and resizes the box, not the card height:

- **Width** is applied to the card (inline `width`), so the card grows wider and the box fills it.
- **Height** is published as the `--box-h` CSS var, consumed only by the value box. The card height stays content-driven, so it grows to fit a taller box but the header and input rows keep their natural height and are never hidden or pushed out. Shrinking only shrinks the box (floor `MIN_BOX_H`).
- The `--sized` height/width rules are scoped to `.solenoid-node__display-value` and `.solenoid-node__quoted--value` so a Concat's inline literal rows (same `.quoted` markup) are not affected.
- Size is stored in `nodeSizeStore` (module store like collapseStore), persisted in `SavedNode.size`.
- The grip binds `pointerdown` as a **native capture-phase** listener: NodeCard's capture-phase suppressor would swallow a React `onPointerDown`, and rete's node-drag is a bubble listener on the node element, so a capture listener on the grip itself runs first and `stopPropagation`s both. Start width is measured from the card, start height from `grip.offsetParent` (the box).

## Technical gotchas

- **`selected` is reserved on a node.** `ClassicPreset.Node` carries a `selected?: boolean` (the editor's selection flag), so a node class must not declare its own `selected` field of another type — it fails to satisfy the `Node` constraint at the registry. The Cable Switch's live-input index is `activeIndex` for this reason.
- **Rete selection group-translate**: translating a *selected* node moves every other selected node by the same delta. Any code that programmatically moves nodes one-by-one must **clear the selection first** (capture ids → `unselectAllNodes()` → move → re-select), or placements compound into garbage. This was the subset-Tidy bug.
- **`DataflowEngine` cancellation**: `processGraph()` calls `engine.reset()`, which throws `Cancelled` on any in-flight fetch. Overlapping calls during seed load are expected — `processGraph` swallows only `Cancelled` and rethrows anything else.
- **Volatile nodes** roll a fresh value only when the recalc generation advances (`getRecalcGen()` / `requestRecalc()` in `process.ts`), so editing an unrelated node doesn't churn them. Pattern: cache the raw randomness (a `[0,1)` roll, a permutation key array) keyed by `lastGen`; re-roll when `getRecalcGen()` differs (or the input size changes), then apply live inputs (bounds, list values) on top. Each renders a `<RecalcButton/>` (the global "F9"). Covered: **RAND** (RandBetween), **RANDARRAY**, **SHUFFLE**, **TODAY/NOW** (the date one re-reads `new Date()` each recompute, so its button just forces a recompute — no gen cache).
- **Multi-input patterns** — two kinds of arbitrary-input nodes:
  1. *Extensible value rows* (built): distinct scalar/string values entered in-node with a "+ Add" button (**ListLiteral** numbers, **Concat** strings). Uses `ExtensibleInputs` + the `ExtensibleNode` interface (`addValueInput`/`removeValueInput`, plus `literals` and/or `stringLiterals`); the row renders an `InlineNumberField` or `InlineTextField` based on the input socket's `dataType`. Keys are uniform `v0,v1,…` (a private `addInputWithKey` keeps `nextInputId` past the max). **Round-trip**: `extractInit` captures `valueKeys = Object.keys(inputs)` for any node with `addValueInput`+`nextInputId`, and the constructor rebuilds those exact rows (so added rows + their literals/cables survive save/load/paste — previously lost).
  2. *Pill socket* (built for collapsed ExtensibleInputs; future for true multi-cable): an elongated stadium on the left edge. A collapsed node with >2 inputs stacks its hidden-but-functional sockets at one point under a pill (`.solenoid-node__input-pill`). A node whose arbitrary inputs *can't* be defined in-node (multiple arrays, à la Blender "Join Geometry") would need a true multi-connection socket — don't use ExtensibleInputs for that.
- **Socket vertical alignment**: output sockets center on the result box via `--out-socket-top` CSS var that `NodeCard` measures and publishes; `NodeSocket` reads it when given no explicit `top`. Multi-output nodes bypass this by using `InlineOutputRows` + `MeasuredOutputRow`, which measures each row's center after layout.
- **`anySocket` input and type dispatch at runtime**: nodes that accept any type (IS checks, Conduit) receive raw JavaScript values in `data()` — `typeof input === "string"` is the correct check; don't assume the value is always a number. The Rete engine passes values through without coercion.
- **`area.translate(nodeId, ...)` is async** — see CLAUDE.md for details. Don't pair it with size changes in a `useLayoutEffect`.
- **`Scope.use(child)` forwards events DOWN only** — to react to plugin-specific events (e.g. `connectionpick`), keep a reference to the plugin and call `plugin.addPipe(...)` directly.

## Outside-review triage (2026-06-12)

The outside review (docs/outside-review-2026-06-12.md) easy items landed in one
pass: CI test+typecheck workflow, PERCENTILE.EXC domain guard, DATEDIF MD
borrow fix + the first date test file, header-hover catalog descriptions
(describeNode in catalogUtils), collapse-state persistence (save/load +
copy/paste + collapseStore.clear on load), save-format version ceiling
(refuse v>2 before clearing the graph), README recompute claim fixed, stray
root files moved to assets/. The architecture.md complaint was stale - the
docs cleanup pass had already rewritten it for Rete.

Still open from the review, deliberately not in the easy batch:

- ~~Load-path safety (review 2.1/2.3/2.4)~~ + ~~"N nodes" surfacing (2.2)~~ +
  ~~persistence round-trip test (2.5)~~ - DONE, see "Data-safety workstream"
  below.
- Desktop CSP + fs scope narrowing (3.x) - config-only but needs a real
  desktop build to verify; don't ship blind.
- Error propagation (5.1 + 4.3) - largely DONE (errorValue.ts, see CLAUDE.md);
  remaining null-on-failure sites convert incrementally.
- ~~Store lifecycle convention on noderemoved (4.2)~~ - DONE. Collapse-state
  persistence was the easy-batch half; the leak half is now closed by
  `nodeStoreRegistry.ts`: node-keyed stores (collapse, size, cable values,
  exit angles) self-register a `forget(id)`, and the single `noderemoved`
  handler calls `forgetNode(id)` (which also covers the load-clear, since
  removeNode fires noderemoved per node). A new node-keyed store now adds one
  `registerNodeForget(...)` line instead of re-answering cleanup ad hoc.
- Incremental recompute (4.1), Canvas.tsx split (4.4), a11y (5.4),
  styled-components removal check (6).
- Locale (5.2): DECIDED against. Solenoid is en-US-numeric — no
  decimal-comma support (`1,5` is not 1.5; it parses to N/A by design).
  Quoted-CSV parsing + semicolon/tab delimiter detection shipped (Papa
  Parse), which is structural and orthogonal to number locale.

## Data-safety workstream (2026-06-15)

Closed the review's §2 cluster — the one path where a user could permanently
lose work. New pure core `persistenceCore.ts` (no rete/DOM, mirrors
`groupPushCore.ts`) holds the testable decisions; `persistenceCore.test.ts`
covers them (20 cases).

- **Build-before-clear (2.1).** `loadGraph` now snapshots the live graph
  (`serializeGraph()`) BEFORE clearing, and the clear+rebuild body is extracted
  into `rebuildGraph(g, editor, area)`. A throw during rebuild is caught and the
  snapshot is rebuilt back in (one level of rollback; if the rollback itself
  throws, a sticky error notice tells the user to reload for the last autosave).
  `loadGraph` returns a boolean (loaded vs refused/rolled-back) so callers know
  whether to persist; existing callers ignore it harmlessly.
- **Structural validation (2.4).** `validateSavedGraph` runs at the single
  choke point (top of `loadGraph`), so import + autosave-restore + seeds all
  get it. It gates on shape only (nodes array; each node has string id/type;
  connection endpoints are strings) — unknown node *types* and incompatible
  sockets are still tolerated at load and surfaced, not rejected.
- **"N nodes skipped" surfacing (2.2).** `rebuildGraph` returns the skipped
  type list; `loadGraph` shows a warn toast. The version ceiling and validation
  failures show sticky error toasts.
- **Rotating autosave + failure indicator (2.3).** Two slots
  (`autosave.a`/`.b`, each `{ seq, graph }`); writes go to the older slot
  (`chooseWriteSlot`), restore reads the newer valid one
  (`chooseReadSlot`), falling back to the older slot then the pre-rotation
  `autosave.v1` key (migrated on first read, cleared by `clearAutosave`). A
  failed `setItem` raises a sticky "couldn't autosave" notice that clears when a
  save next succeeds.
- **Notices (`noticeStore.ts` + `components/NoticeToasts.tsx`).** Toast store in
  the confirmStore mold, mounted next to `<ConfirmDialog/>`. Used instead of
  `window.alert`, which (like `window.confirm`) is unreliable in the Tauri
  WebView — this also retires the version-ceiling `window.alert`.

Not in this pass: the other swallowed `catch`es the review listed
(`appTheme.ts`, `settingsStore.ts`, `packs.ts`) are settings, not graph data, so
they keep failing silently for now — the graph autosave is the safety net that
mattered. True end-to-end `loadGraph` round-trip (id remap / FC / standoff
rewiring) still needs a real editor+area, so it stays manual-QA; the pure core
and `seeds.test.ts` (every real seed constructs + wires) cover the rest.

## Error propagation v1 (2026-06-12)

errorValue.ts landed (see CLAUDE.md "Error values" for the architecture).
First producers converted: Arithmetic scalar /0 (#DIV/0!), MathFn scalar
domain (#DOMAIN!), XLOOKUP/XMATCH miss (#N/A; XLOOKUP only when If-not-found
is unwired), Expression (#SYNTAX! parse / #VALUE! eval).

Also out of scope v1, by design: errors inside lists (whole-output error
instead), error styling on cables/wired markers (value boxes only), an
error-origin trace UI (the propagation chain of red boxes serves today).

## Error propagation — producer sweep complete (2026-06-15)

The "convert as touched" backlog from the v1 note is now cleared; the typed
error producers below are all live (commits `b21fae5` shape errors, `1fc54a2`
producer sweep, `679eb3b` Display + #CIRC! fix, plus the 06-15 XIRR/date
cleanup). Verified by `grep` of `solError(` call sites + `errorValue`,
`errorIntegration`, `errorSeed` tests (29 passing):

- **Iterative solvers** — RATE / IRR → #CONV!, XIRR → #CONV! (06-15, tracks
  `converged` like RATE/IRR), MIRR → #DIV/0! (needs both signs) + #RANGE!
  (overflow).
- **Dimension mismatches** — MMULT (A.cols ≠ B.rows), MINVERSE (non-square),
  HSTACK/side-stacks (unequal rows) → #SHAPE!.
- **Overflow / range** — combinatorics result too large (scalar.ts), base
  conversion overflow (convert.ts), MIRR overflow → #RANGE!.
- **Cast / parse** — Cast unconvertible (#VALUE!), VALUE / NUMBERVALUE
  unparseable (#VALUE!), ROMAN out of 1–3999 (#VALUE!), DATEVALUE / TIMEVALUE
  unparseable non-empty text → #VALUE! (06-15; blank still → blank).
- **Lambda family** — bad param identifier → #NAME?, body syntax error →
  #SYNTAX!, arity mismatch → #VALUE! (lambda.ts, tableLambda.ts).
- **Circular references** — #CIRC! (detected in process.ts; 3 sites).
- **Stats / lookup** — PERCENTILE/QUARTILE domain (#DOMAIN!), out-of-range
  lookup / not-found (#N/A), zero-variance correl/standardize (#DIV/0!),
  FISHER domain (#DOMAIN!).

Residual null-on-failure sentinels that are intentionally NOT errors: the
discrete-distribution pmf/cdf helpers in `dist-discrete.ts` return `null` for
out-of-support arguments, which the node boundary already treats as blank/N-A
by design (an out-of-support probability isn't a computation *failure*). If a
future pass wants Excel-strict #NUM! there, that's the only known remaining
site.

## Visual + control nodes (2026-06-15)

Six nodes landed: **Sparkline / Chart / Gauge / Heatmap** (visual, in
`nodes/visual.ts`, `display` kind) and **Date Picker / XY Pad** (control, in
`control.ts`, `input` kind). All wired through the usual six places
(class → kind → component → barrel → registry → catalog).

- **Charts use recharts** (`recharts@3`, React-19 compatible), resolving the
  "chart-lib decision pending" TODO — we are NOT hand-rolling chart SVG. The
  charts are given **explicit pixel `width`/`height`**, not
  `ResponsiveContainer`: Rete renders nodes in a separate React root and a
  node card has no naturally-sized parent, so a measured container would race
  the first paint. Fixed dims inside the (fixed) node body are deterministic.
  Heatmap needs no lib — it's a CSS-gradient swatch with a luminance-picked
  text colour.
- **The visual nodes are pass-through** (`result` mirrors the input value), so
  they drop onto a cable mid-chain like Display/Progress. Sparkline/Chart take
  a `numlist`; the input socket is drawn bare via `leading={<PortSockets
  side="input"/>}` (the Display pattern), since a list can't be typed inline.
  Gauge/Heatmap take scalar `value`/`min`/`max` through `InlineInputs` (min/max
  editable in-node, value usually wired); `data()` mirrors live min/max into
  `literals` so the component reads one source.
- **State round-trips with zero persistence changes.** Sparkline/Chart `op` is
  already in the `extractInit` whitelist; Gauge/Heatmap/XYPad keep their values
  in `literals` (spread into init + restored post-construct); Date Picker uses
  the whitelisted `value` (an Excel date serial; 0 = unset → outputs null).
  `nodes/visual.test.ts` covers construct + `data()` + round-trip.
- **XY Pad** is a multi-output node (`x`, `y`): `hideOutputSockets` +
  `InlineOutputRows` so the two dots sit on measured rows instead of stacking
  at the card centre. The handle maps screen → [0,1] via
  `getBoundingClientRect` (folds in canvas zoom); pointer-capture on the pad,
  `stopPropagation` so the drag doesn't also move the node. Y is flipped so up
  = 1.

### Visual nodes — second pass (overflow, popup, Heatmap reshape)

- **Overflow fix.** The first cut sized charts with fixed widths eyeballed
  against the card and they spilled past the body. Sparkline/Chart now opt into
  the **wide card** (`nodeWide` returns true for them; Heatmap qualifies on its
  table socket) and the plot is drawn at `W = 218` (240 wide − body padding).
  The card width is CSS-driven and a `ResizeObserver` writes the real box back
  to `node.width`, so the plot must fit the card, not the reverse.
- **Shared renderer + expand popup.** Sparkline and Chart both render through
  one `ChartView` (`components/chartView.tsx`, op ∈ line/area/bar/column, `axes`
  toggles the gridlines+axes look). A ⤢ button (`ChartExpandButton`) opens a big
  read-only view via `chartPopupStore` + `ChartPopup` — same module-store +
  mounted-in-App pattern as FormulaPopup / TablePopup. The button reads the
  card's `--node-accent` off the closest `.solenoid-node` so the popup header
  matches.
- **No tooltip.** Recharts' hover tooltip showed raw float coordinates, which
  was noise; dropped entirely from `ChartView`.
- **Heatmap is now a Table heatmap**, not a single cell: input `table`, output
  `table` (pass-through), and the component colours every cell on the cool→warm
  ramp spanning the data's own min..max (auto-scaled, no min/max inputs). Values
  print inside cells only when the grid is small enough (≤8 cols, ≤10 rows).

### Visual nodes — third pass (mobile fit + gauge scale, 2026-06-16)

- **ChartPopup fits the viewport.** The expand popup drew a fixed 620×380
  `ChartView`, which overflowed a phone screen (the popup card has no
  max-width). `ChartPopup` now computes the chart size from `window.innerWidth/
  innerHeight` — clamped to the old 620×380 desktop max, floored at 200×140 —
  and re-measures on `resize` and on each open. Still explicit pixels (no
  `ResponsiveContainer`), which is valid here because the popup is a
  viewport-centred overlay (unlike the inline node charts, which have no
  naturally-sized parent in Rete's root). Inline node charts were already within
  a phone width (≤240px), so only the popup needed it.
- **Gauge shows its scale.** The radial gauge printed only the value with no
  range reference. Added small min/max labels at the arc ends (min at the 180°
  left end, max at the 0° right end) so it reads as a range — the
  zero-learning-curve principle.

### Chart vs Sparkline: the options socket + Chart Builder (2026-06-16)

To stop Chart and Sparkline reading as redundant, **Chart** gained an `options`
string socket; **Sparkline** stays the deliberately-minimal inline chart with
no configuration. The vocabulary is **matplotlib's** (borrowed, not invented):
a flat `key=value;…` string with `title / xlabel / ylabel / color / grid /
marker / ylim / linewidth / alpha`.

- **`nodes/chartOptions.ts`** is the one source of truth: `parseChartOptions`
  (tolerant — case-insensitive keys, on/off/true/1 booleans, `ylim=min,max`
  splitting to `ymin`/`ymax` with one-sided support, unknown keys ignored) and
  `serializeChartOptions` (emits only set fields, collapses the two Y bounds
  back into `ylim`). Unit-tested in `chartOptions.test.ts`.
- **Chart** parses `inputs.options?.[0]` into `this.chartOptions` in `data()`;
  the component threads it to `ChartView` (and the expand popup via
  `chartPopupStore`). `ChartView` grew an optional `opts` param applying colour,
  grid on/off, axis labels (recharts `label` on X/Y, with margins bumped to make
  room), Y domain, line width, markers, fill alpha, and an optional title row
  drawn above the plot (stripped in the popup, whose header already shows it).
- **Chart Builder** (`ChartBuilderNode`, `display` kind) is a labelled "Concat
  for chart options": one input per matplotlib field, rendered by `InlineInputs`
  so each is *also* a wireable socket (wire a value to override the inline text —
  e.g. a computed title or a slider-driven Y max). String fields live in
  `stringLiterals`, numeric in `literals` (both persist generically — no new
  plumbing), and `data()` joins them via `serializeChartOptions` into the
  `result` string. The node shows a live monospace preview of what it emits.
  `grid`/`marker` are **checkboxes** (a `ToggleInputRow` writing "on"/"off")
  that stay wireable sockets — they show the wired source instead of the
  checkbox when a cable feeds them. (Checkbox, not SegToggle: SegToggle is for
  picking among a few static choices, not booleans.)

### Color Picker node + the colord dep (2026-06-16)

A **Color Picker** control (`ColorPickerNode`, `input` kind, `nodes/input.ts`):
three sliders in **RGB or HSV** (a `SegToggle`), an output-**format** dropdown
(hex / rgb() / hsl()), a live swatch + the output string, and one `color`
string output. All three formats are valid CSS colours, so it drops straight
into a **Chart Builder**'s Colour field. Channels live in `literals` (`c0/c1/c2`,
read per mode); `mode` + `format` round-trip via extractInit (both keys were
already whitelisted). Switching mode preserves the colour (converts the triple
rather than reinterpreting raw channels). Conversions are delegated to
**`colord`** (a new dependency — zero-deps, ~7 kB, TS-native) so we don't
hand-roll RGB↔HSV/hex maths; `colord({r,g,b})` / `colord({h,s,v})` →
`.toHex()/.toRgbString()`. Output formats are **hex / rgb only** — CSS has no
`hsv()`, and offering `hsl()` would mismatch the HSV input model (the
inconsistency that prompted dropping it). Tests in `colorPicker.test.ts`.

  **Refinement pass (same day):** the sliders paint a **colour gradient** under
  each channel track (colord computes the stops — the standard picker cue: the
  thumb position previews the resulting colour), set inline per channel with a
  CSS-class thumb (`ColorPickerNode.css`). A third mode, **Hex**, swaps the
  sliders for a hex text field (stored in `stringLiterals.hex`; commits on
  Enter/blur, swatch tracks the draft live). The colour **output socket** moved
  to sit on the swatch+string row *below* the format dropdown
  (`hideOutputSockets` + a `MeasuredSocketRow side="output"`). Chart Builder's
  output socket got the same treatment — measured onto its preview row.

  **Chart sockets:** the two input sockets used to overlap. Now the `values`
  socket is **measured-centred on the chart plot** (a `useLayoutEffect` reads the
  chart div's `offsetTop+h/2` against the card — `__body` is static, so that's the
  same reference the dot positions against — and feeds it as the socket `top` via
  the `leading` slot), and `options` is its own row below: an `InlineInputs`
  text field you can **type a matplotlib string into directly**, or wire a Chart
  Builder into (the field hides when wired). `ChartNode.data()` reads
  `inputs.options ?? stringLiterals.options`.

The **`visual-outputs` seed** gained two styled charts wired
ColorPicker → ChartBuilder → Chart: a teal HSV-picked **line** (Sine Wave, grid
+ markers, `ylim -1.2..1.2`, linewidth 3) and an orange RGB-picked **column**
(Weekly Sales, no grid, `ymin 0`, alpha 0.85) — a worked example of the
options-string pipeline. `seeds.test.ts` machine-checks the new nodes/sockets.

## Snap to grid (2026-06-15)

`gridSnapStore.ts` — a persisted module-singleton toggle (the `cableFlowStore`
mould) plus a `useGridSnap` hook, a quick toggle button in the floating cable
toolbar (`CableShapeSelector`). Snapping is **on release**: the `nodedragged`
handler in Canvas rounds the dragged node's world position to the nearest snap
point. The lead node is still selected, so `area.translate` group-moves the rest
of the selection by the same delta (relative layout preserved); groups and docked
FCs are skipped (their members / socket-anchored position wouldn't follow).

The grid is **aligned to the background dots** (24px world, the `DOT_SPACING`
constant now shared by `syncBackground` and the snap math). `GRID_SNAP_STEP =
DOT_SPACING = 24`, so every snap point lands on a visible dot (the earlier half
sub-grid was dropped 2026-06-20 — author wanted dots-only). v1 edges, by design: snap is best-effort
around standoffs (the post-drag settle pins the pre-snap position, since
`area.translate` is async) and applies to drag-release only (not paste/tidy).

## Drag modifiers (2026-06-15)

Live drag constraints, hooked in the `nodetranslate` PRE-event (rete-area-plugin
reads `data.position` after the pipe — node-view.translate line ~707 — so
mutating it there rewrites where the node lands, no recursion). All keyed off
`dragPickId` + the drag origin `pickedPos`, with modifier state in refs updated
by capture-phase window key listeners (so a key pressed mid-drag counts).

- **Shift** — project the offset-from-origin onto the nearest of H / V, plus the
  two diagonals but only past `DIAG_MIN = 48px` (an initial wobble shouldn't snap
  to 45°). Nearest line = max |dot(offset, lineUnit)|; new pos = origin + proj·unit.
- **Ctrl/Cmd** — align the dragged node's left/right + top/bottom edges to
  the matching edges of the **previously-grabbed** node (pick history:
  `prevPickedRef`, the node grabbed before this one — it's deselected, so it
  doesn't move with the drag). Per-axis nearest within `ALIGN = 8px`. Shift wins
  if both are held. The flow is: grab A normally, then hold Ctrl to align it to B.
- **Groups snap** on release like any node, carrying members by the same delta.

Known v1 edges: the reference for Ctrl-align is pick-history, not a full
smart-guide sweep of every node; multi-selection drags constrain/align off the
lead node only.
