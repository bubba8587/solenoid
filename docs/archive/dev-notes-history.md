# Solenoid dev notes — archive (2026-06-30 and earlier)

Relegated from `dev-notes.md` to keep the live log lean: older resolved session entries + finalized reference sections (node-authoring kit, socket types, roadmap stance, technical gotchas, old TODOs). Current notes live in `docs/dev-notes.md` (live window: 2026-07-01 onward). Entries keep their original heading level and text verbatim (a pure move, not a rewrite) — the source log mixes `##`/`### Title (date)` headings, so this file does too. Two sweeps so far: entries through 2026-06-18 moved on 2026-06-21; entries 2026-06-19 through 2026-06-30 moved on 2026-07-05.

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

---

### Lazy handles on cables — the WS2 perf finish + big-frame render caps (2026-06-30)
The "honest other half" of Polars: a relational verb no longer collects its full result
back to JS each step. It emits a lazy **FrameRef** (`{ __frameRef: handle }`, an object so
it's unambiguous vs a String value and a FrameValue) and chains it, so a chain of verbs
stays in the backend and is collected only at a materialization boundary.
- **The seam that kept it small:** `coerceInputs.ts` (`installInputCoercion`) wraps every
  node's `data()`. A non-lazy node that receives a FrameRef has it collected to a FrameValue
  there (async, only when a ref is actually present), so the ~20 frame consumers needed ZERO
  changes. The 11 verb nodes (`LAZY_FRAME_NODES` by class name) are exempted and get the raw
  ref to chain. `coerceValue` passes a ref / SolError through any socket untouched.
- **Lifecycle is trivial** because the Rust store is `HashMap<String, SolFrame>` of EAGER,
  independent DataFrames (not a lazy plan graph) — `engine_apply` makes a new independent
  frame, so `dropFrameRef` is always safe. A verb node drops its previous owned ref via the
  shared `emitFrame` helper on recompute, and `noderemoved` drops it on delete. A passthrough
  (no-op verb) emits a collected VALUE, never the upstream ref it doesn't own.
- **Stage B (head-N cards):** `emitFrame` sets `cachedResult` via `collectPreview` — a SMALL
  frame collects in full (raw fidelity + test parity, so seeds/tests are byte-identical), a
  LARGE one becomes a head-N FrameValue carrying the true total in `FrameValue.__totalRows`
  (shown on the chip). So an intermediate verb on a million-row chain never hauls the whole
  frame to JS. `FrameRefChip` (cable inspector + pins) resolves a ref via `collectPreview` too.
- **The win is real but bounded by the eager engine:** data stays in Rust between verbs (no
  re-source / re-collect per edge) and previews are head-N — NOT lazy-plan fusion (each verb
  still materializes a full DataFrame in Rust). Pivot / Frame Lookup / Get Column stay eager
  (they collect full); the JS CSV parse is the other scale cost. A direct CSV→Polars reader
  is the future nicety.
- **Big-frame RENDER caps (found by wiring a 250k-row CSV on the desktop build).** Several
  views rendered every cell → ~2M DOM nodes → the webview died. Capped: **TablePopup** + the
  **CubePopup** drill-in at 1000 rows (grid stays the full save-truth; edits land by index;
  dims show the true count + a terse `· first 1,000`); **FrameDisplay** / **CubeDisplay** full
  inline mode at **100** (a Display node is a card, not a browser — `…` marks the cut). These
  are the auto-render-on-click/expand paths; charts wired to raw big data are the user's call.
- Verified: tsc + 1525 vitest (`frameNodeBackend` parity, `framesSeed`, `pivotSeed`) + 19
  cargo parity tests; release desktop `.exe` (`npm run tauri build -- --no-bundle`) runs the
  verbs in Polars (`engine_ping` → `"polars"`, `initFrameBackend` at `main.tsx`). **Build gotcha:**
  a running `solenoid.exe` LOCKS the file, so cargo can't relink a frontend-only change — kill
  the process first or the build fails with "Access is denied (os error 5)" and leaves a stale exe.

### Polars engine merged onto `working` + branch cleanup (2026-06-30)
The WS2 native Polars relational engine lived on `origin/polars-integration` (3 commits, last
2026-06-26) and was never merged — `working` had moved 154 commits past it. Ported it forward:
- **Engine** (`214e8e7`): cherry-picked clean (the Rust `src-tauri/src/engine.rs` is independent of
  `working`'s churn; only a dev-notes append conflicted). polars 0.46, 18→19 cargo parity tests.
- **Frame Lookup** (`e10b333`): the table XLOOKUP/VLOOKUP node `working` lacked (it only had the
  list-based XLookup). Conflicts were import-block "both added" only — resolved to working's full set
  plus the new symbols. Eager JS (materialization boundary).
- **Verb routing** (`f9ebdc5`): redone against working's current nodes (the branch's was written
  against the OLD set). git auto-merged most node migrations; the only real conflict was **Pivot** —
  working's full PIVOTBY exceeds the engine's simple pivot op, so it **stays EAGER** (routing would
  regress desktop). The other 11 verbs route through the backend.
- Verified at each step: tsc + vitest (→1525) + cargo check + 19 cargo parity tests. Pushed to
  `origin/working`; deleted `origin/polars-integration` and a stale fully-merged
  `claude/mobile-function-reference-ux` branch. Only `main` + `working` remain.
See the WS2 entries + the Pivot reconciliation note below for the per-verb detail.

### HTML-canvas renderer — re-capture trigger audit + node-count auto-gate (2026-06-30)
Two changes to `HtmlCanvasLayer.tsx`. Both stem from the same fact: a node card / group / note
re-renders in rete's SEPARATE React root, so the canvas (which rasterizes a CLONE of that DOM)
can't see the change — it only re-captures when something tells it to.

- **Trigger audit (stop patching one-by-one).** Cross-referenced every module store the captured
  roots (NodeCard / GroupNode / NoteNode / nodeKit value box / DisplayNode) subscribe to vs. what
  the renderer rebuilds on. Two real gaps: **appThemeStore** (theme/accent + the active palette —
  palette edits funnel through appThemeStore per `appTheme.ts:61`, so subscribing it alone covers
  all retinting) and **formatAnnotationStore** (FC unit/number-format changes the displayed value
  TEXT with no value recompute). Both now `subscribe(scheduleRebuild)`. Also fixed earlier this
  session: groupMembershipStore (member "inside a group" dots) and NoteNode.pick (now fires
  area.update like GroupNode.pickColor). Documented the PRINCIPLE + full trigger set + the
  deliberately-skipped stores (socketHighlight = per-hover churn; FC-only formatMismatch/packs =
  rare) in a block comment above the subscriptions, so the next store is added there not patched.
  The two channels a card re-render reaches us by: (1) area.update("node",id) → the render pipe
  (use from a node's OWN local state — color pick, edit); (2) a useSyncExternalStore store → wire it.
- **Auto-gate below ~100 nodes.** Even with render mode "html" ON, the canvas now stays fully inert
  (returns null, no capture, no rAF, no rebuild subs) until the graph crosses `RENDERER_MIN_NODES`
  (100, live-tunable via `window.__hcMinNodes`). Native DOM pan/zoom is fine at small sizes and the
  capture/swap cost isn't worth it. `active = mode==="html" && nodeCount >= threshold`. nodeCount is
  EVENT-driven (the count only moves on add/remove/load, so a timer would re-read a static value):
  an area pipe recounts `editor.getNodes().length` on `nodecreated`/`noderemoved` AND once on bind,
  seeded synchronously from the editor at mount. recount-on-bind is the key — it reads the full
  current count the instant the area exists, so an already-loaded over-threshold graph gates without
  waiting for an event (the bug in the very first cut, which seeded 0 and only moved on add/remove).
  The editor/area are created once (`Canvas.tsx` init) and reused across document switches — load
  clears+refills the SAME editor via removeNode/addNode — so the pipe stays valid and never rebinds.
  The effect is gated on `mode==="html"` (NOT `active`) so it can notice the threshold being crossed.
  (Briefly tried a 250ms poll to fix the seed bug; reverted — wasteful for a rarely-changing value.)
- **Tick audit follow-on.** Swept the app's `setInterval`/rAF loops for the same waste. One fix:
  `MobileControls` polled selection every 200ms (full `getNodes()` scan) even on desktop, where the
  bar is `display:none` (`html.is-mobile` only) — now gated on `IS_MOBILE`. Left as-is (justified):
  `StatusBar`'s 200ms poll (zoom is genuinely continuous; cheap, deliberate — its own comment says
  so), `OutlinePanel`'s 300ms poll (gated on panel `open`, zero idle cost), `SliderInputNode`'s
  interval (animation, only while `playing`). The rAF loops are all gesture/animation-driven.

### Data-pathway audit fixes — empty/null/error/large-list (2026-06-30)
Acted on a value-model audit (SolError propagation, null-as-missing, forAggregate, large lists). Eight findings; 7 fixed, 1 left as documented.
- **#1 (app-blackout):** the complex display nodes (`ComplexFrom/Binary/Power/Unary`) rendered `formatCx(cachedResult)`, and `formatCx` array-destructures — so a SolError cachedResult (these aren't in `SEES_ERRORS`) threw during React render and blacked out the app. Added `formatCxValue` (SolError-safe) in `complex.ts`; all four route through it → red `#CODE!` badge. **`formatCx`-style destructuring formatters are the one class `formatScalar`'s defensiveness doesn't cover — always guard isSolError before them.**
- **#2:** Gauge showed `[object Object]` + a NaN arc on an error → guard with the error badge.
- **#4:** Decision Matrix scored a per-cell SolError as 0 → now propagates it (error-in → error-out, like groupBy/pivot); `null` stays a deliberate blank.
- **#5 (crash):** `Math.min(...arr)`/`Math.max(...arr)` throws RangeError past ~125k args (a big SEQUENCE → Aggregate(min) blacked out). Added reduce-based `iterMin`/`iterMax` (`mathUtils.ts`, accept any iterable incl. `Map.values()`, ±Infinity on empty = `Math.min/max()` parity); swapped every data-path spread (Normalize/Rolling/Aggregate/GroupBy + Mode/Mode.Mult). Capped SEQUENCE/RANDARRAY at `MAX_GENERATED = 1_000_000` → `#RANGE!`. (UI spreads over node counts left alone.)
- **#3 (consistency sweep):** second-tier reducers did raw math (embedded null→0, embedded error→NaN swallowed). Single-list (Quartile/Mode/Mode.Mult) → `forAggregate`. Bivariate (Correl/Covariance/Regression/Forecast/Trend/Linest/Logest) → new `forPair` (propagate first error, drop null pairs, keep NaN). Cashflow (NPV/IRR/MIRR/FvSchedule) → `cashPrep` (propagate error; **null period stays 0** — a position-discounted missing cashflow IS zero; skipping would misalign exponents). `InlineOutputRows` now badges a SolError row.
- **#6:** `relateCubeToFrame` now deepens the FIRST nested column deterministically (was silently the last).
- **#8:** Nest Join with a non-frame/cube **wired** parent → `#TYPE!` (was a silent blank); unwired parent still blank.
- **#7 (left):** `cubeColumnFromValue` takes column 0 of a multi-column cube — a documented coercion, not a bug; changing it would alter Build Cube semantics.
Tests in `auditFixes.test.ts` + additions to `decisionMatrix.test.ts`. Render-path fixes (#1/#2) aren't unit-tested (node vitest env, no jsdom).

### Decision Matrix node — DMBV port (2026-06-30)
Ported the jortscity **Decision Matrix Bases View** Obsidian plugin into one Solenoid
node, `DecisionMatrixNode` (frame kind, in Add → Table verbs). The plugin's distinctive
contribution is the **weighted-average + ranking math**, not the tables/CSS around it — so
the port keeps the math and hands everything else to existing Solenoid nodes (per the
author's "explicitly replace DMBV functions with existing Solenoid stuff" steer):

- **Raw Scores table** → the user's own **Frame Input** (not duplicated, as instructed).
- **Weighted average** = `Σ(score × weight) / Σ|weight|` per option — the keystone. The
  `Σ|weight|` denominator is what lets a **negative weight** penalise a lower-is-better
  criterion (cost/risk) without skewing the scale. Pure fn `decisionMatrix()` in
  `frameVerbs.ts` (testable, matches the verb pattern; tagged-`SolError` on no criteria).
- **Rank Raws / Normalize** (DMBV's incompatible-scale fixes) → folded into one `normalize`
  SegToggle applied to ALL criteria, cleaner than DMBV's per-column checkboxes: `none` /
  `÷max` (scale by largest magnitude) / `rank` (within-column competition rank → "$ vs
  out-of-10" comparable). This is the Solenoid "bundled task-shaped node w/ op selector" rule.
- **Ranking** (competition, ties share) computed in the node → a "Rank" column.
- **Per-criterion breakdown** → a `detail` SegToggle (Summary / Breakdown). Breakdown inserts
  each criterion's EFFECTIVE (post-normalize) value between the label and Score, so under
  "rank"/"÷max" you see the transformed value that was actually scored (the DMBV "rank shown
  alongside the raw" idea) and under "none" the raw scores. Result-column names run through
  `makeHeaders` so a criterion literally named "Score"/"Rank" can't collide.
- **Podium / rankings visual** → not rebuilt; output a frame `Option · [criteria?] · Score ·
  Rank` (best first) and the user does **Get Column "Score" → Chart** for a bar podium.
  Composable, the Solenoid way (everything per-column reuses list/matrix nodes via Get Column).
- **Scale 5/10/100, coloring, cover images, collapsible groups, fold cols** → display/Obsidian
  concerns, dropped (Solenoid has FrameDisplay + Heatmap if wanted).

Inputs: `frame` (Scores — first text column names options; **number/logical** cols are
criteria — date columns are NOT, a date serial is not a score; null/text/error cells → 0,
logical→1/0).

**Weights UX redesign (the enjoyable part — 2026-06-30 follow-up).** First cut made weights a
wired `numlist` (cable-only), so tuning a matrix meant adding a List node and aligning bare
numbers to columns by position — blind, and against our own labeled-slots-vs-list rule (weights
ARE role-distinct). Replaced with **inline, name-keyed, default-1 weight boxes**: the node
detects its criteria each compute (`decisionCriteria`, shared with the verb via `decisionColumns`
so order can't drift) into `node.criteria`, and the component renders one labeled `InlineNumberField`
per criterion writing into `node.weightMap` (criterion name → weight). Clearing a box → back to 1.
The `weights` socket stays as an OPTIONAL override (computed/slider-driven weights) — when wired it
wins positionally and the inline boxes are replaced by a one-line "driven by the wired list" hint
(`useConnectedInputs`). This is the DMBV experience: nudge a named weight, watch the rank move.

**Per-column normalize (Rank Raws restored — 2026-06-30 follow-up).** The global `normalize`
toggle alone lost DMBV's most important feature: per-column Rank Raws (rank just the $-scale
columns, leave the /10 ones raw). A boolean column in the scores frame can't carry this — it's
per-ROW data, but the flag is per-COLUMN — so the right home is a control per criterion. Added a
`normMap` (criterion name → mode) override rendered as a compact dropdown on each criterion row
next to its weight box; absent = inherit the global default. The verb takes a 5th
`normalizeOverrides` arg, resolved per column as `overrides[name] ?? normalize`. There's no
list-wise competition-rank node to compose with (the `Rank` node is Excel RANK of ONE value;
`Normalize` is 0–1 only), which is why this belongs on the node rather than "Get Column → rank →
Add Column".
**Correctness fix found while doing it:** `rank` used to emit `1..N` while `÷max` emitted `[0,1]`,
so the two modes weren't on the same scale — defeating normalization (whose whole job is letting
weights, not raw magnitude, decide influence). Both now land in **[0,1]** (rank = fraction of rows
a value strictly beats), so any mix of normalized columns is fair. DMBV dodged this by mapping rank
onto its /scale; we dropped the scale concept, so [0,1] is the common ground.

Gotchas: `normalize` / `detail` (scalars) persist via the `extractInit` whitelist; `weightMap` and
`normMap` (objects) via explicit deep-copy clauses in `extractInit` (`copyPaste.ts`) — easy to
forget on a new node field; an object field needs the clause or it silently won't save. SegToggle is
`T extends string`, so `detail` is a "summary"|"breakdown" string, not a boolean (the verb takes the
boolean). Tests in `decisionMatrix.test.ts` (21, incl. node-level weightMap/normMap, wired-override,
per-column rank, date-exclusion) + a worked example seed **`decision-matrix.json`** ("Which laptop?"
— ÷Max default with Price overridden to Rank, breakdown, named weights, Score → bar Chart podium).
**UI polish + Sensitivity (Cube) — 2026-06-30.** Decision Matrix rows are now a real mini-table:
criterion name fills, the Weight box + Norm dropdown are fixed-width and right-aligned so they line
up across rows and under a small column header (`dm-col-crit/weight/norm` classes). The global
normalize SegToggle got a caption ("default for every criterion — override per-row below") and the
detail toggle moved down by the output, so the global-vs-per-column relationship reads clearly.

Built the sensitivity node after all: **`DecisionSensitivityNode`** (frame kind) + `decisionSensitivity`
verb. Inputs: `scores` + a `scenarios` frame where each ROW is a weight scenario (first text col names
it; a number column named after a criterion is its weight, missing → 1). Output is a **Cube**, one row
per scenario: `Scenario · Winner · Margin · Ranking`, where Ranking is the full Option·Score·Rank frame
NESTED in the cell (drill in via CubePopup) — the natural Cube use (a table per row), and the reason
it's a cube not a flat frame. Margin = top − runner-up (a thin margin = fragile choice). Seed extended
with a 3-scenario demo where the winner flips (UltraSlim ↔ PowerLifter) and the Budget scenario is a
near-tie. Tests: `decisionMatrix.test.ts` now 23. Note: the sensitivity node uses ONE normalize mode
for all criteria (no per-column overrides like the matrix has) — fine for a prototype; revisit if
needed.

### HTML-in-Canvas renderer — persistence, clone staleness, selection, cables (2026-06-30)
A batch of `html` render-mode fixes the author hit using it as the day-to-day renderer:

- **Activation didn't "kick in" on reload.** `renderMode "html"` persisted fine (localStorage +
  `initRenderMode`), but the canvas stayed inert until the Settings toggle was flipped off→on.
  Cause: `HtmlCanvasLayer` is a CHILD of Canvas, so on a fresh load its effects run BEFORE Canvas's
  async rete init populates the `process.ts` singletons — `getEditor()/getArea()` are null and the
  setup effect bailed with deps `[active]`, never retrying. Toggling re-ran it after init. Fix: a
  `ready` state + a poll that flips it once both singletons exist; the setup effect now depends on
  `[active, ready]`.
- **Dropdowns showed their FIRST option** (Slicer category, FC selects). `cloneNode(true)` copies
  attributes but NOT live form-control PROPERTIES (`select.value/selectedIndex`, `input.value`,
  `checkbox.checked`, `textarea.value` — the app drives these via the `.value` property on controlled
  inputs). `HtmlCanvasRenderer.syncFormState` now walks original+clone in lockstep and copies that
  state across (also sets the `selected`/`checked`/`value` ATTRS so the capture is unambiguous).
- **Snapshot went stale on collapse / resize / group-resize.** It only rebuilt on
  `cableValueStore` + `connectionVersionStore`. Added debounced `scheduleRebuild` triggers:
  `collapseStore` (chevron re-renders in rete's root, invisible to the area pipe), `nodeSizeStore`
  (single-node resize), and an `area.addPipe` hook on `{type:'render', data.type:'node'}` — which
  catches GROUP resize (`area.update("node",id)`), value-box re-renders, and dropdown changes.
  `area.addPipe` has no unsubscribe, so a `pipeLive` flag makes it a no-op after teardown.
- **Selection: dropped the synthetic blue boxes.** `drawSelection` no longer strokes a per-node
  rectangle; instead the rAF loop detects a selection-set change and re-captures, so the REAL
  `.solenoid-node--selected::after` accent ring (already in the cloned DOM) shows — matching the DOM.
  The lasso box-select rect is the only thing `drawSelection` still draws.
- **Cable parity.** Canvas cables were flat grey; now each is stroked in its SOURCE socket's
  data-type colour (added `color` to `SnapCable` = `src.color`; `drawCables` buckets visible cables
  by colour into one `Path2D` each), at 1.8px to match the DOM's default visible stroke.
- **Quick quality knobs** (console, no UI), wired in the rAF loop like `__hcLive`: `__hcQuality = n`
  → `engine.setQuality` LOD bias (target texture px ÷ on-screen px; 1 = 1:1, >1 sharper but capped by
  the 1× capture since supersampling/REF stays disabled, <1 cheaper/softer). `__hcLive = true` is the
  only path to true crisp-beyond-1× (per-frame re-raster). `__hcOverlay = true` half-opacity over DOM.

### HTML-in-Canvas renderer — fidelity loss is OURS (clone), not the API — FIXED the anchor bug (2026-06-28)
Chasing the residual shift in canvas-rendered cards (vs the live DOM). **A first pass wrongly concluded
"API rasterization, shelved" — DO NOT trust that; it was a measurement artifact.** The real symptom,
seen on a clean canvas (one MAP node in a Group, overlay via `window.__hcOverlay`): elements toward the
TOP of the card shift DOWN and elements near the BOTTOM shift UP — content compressed toward the vertical
centre — and it's the same on every node. That's a SYSTEMATIC GEOMETRY bug in our pipeline, not random
API blur. The visibly-wrong elements are the CARD-ANCHORED chrome: chevron, header text, the f(x…)/lambda
strings, the group-membership corner indicator (all OUTSIDE `.solenoid-node__content`); the content
wrapper's internals look fine.

CAUSE (confirmed by the SCREEN-Δ diagnostic, k=1): `cloneFor` forced the cloned card to
`position: relative` (the card is normally `static`). In the live DOM the card's absolutely-positioned
chrome (collapse chevron `top:9 left:5`, group-membership corner `inset:0`) anchors to rete's node-view
div — i.e. to the card's BORDER box. Forcing the card to be the positioning context re-anchored that
chrome to the card's PADDING box, INSIDE the border. A grouped node has a 2px border, so the top-anchored
chevron dropped ~2px and the bottom-anchored corner rose ~2px (measured chevron d_top=+1.76, d_left=+1.76,
ctx=`OP:div.→div.solenoid-node…`; the rest of the 2px lost to `zoom:2` rounding). Normal-flow elements
(header, content) also showed the offsetParent change but screen Δ≈0 — re-anchoring only moves
`position:absolute` elements.

FIX (2026-06-28): `cloneFor` now keeps the card `position: static` (matching live) and reproduces rete's
node-view div with an inner `rel` box (`position:relative`, zero padding/border/margin, `width`=card
width) so its padding box == the card's border box — chrome anchors exactly as it does live. Clone tree is
now `wrap → rel → card` (the diag's `clone` ref updated to match). VERIFY on the overlay that chevron +
corner stop shifting.

Residual after the anchor fix: the katex `f(x…)`/lambda strings sat ~+0.9px low, io-labels ~0.4px high
(`d_h` ±0.88) — TEXT baseline/line-box shifts, CONSTANT in card-local px regardless of camera zoom (same
0.91 at k=1.0 and k=5.5), so it's purely the clone being laid out at `zoom: REF=2`, not an
original-vs-clone zoom mismatch. The author had tested REF=1 earlier and reverted ("zoom wasn't the
cause") — but that test was CONFOUNDED by the then-unfixed anchor bug (zoom-independent, so REF=1 didn't
help it). 

The alignment fixes that SHIPPED (2026-06-28), all proven against the SCREEN-Δ diag landing at 0:
1. **Card-anchored chrome** (above): keep the clone card's CSS `position` (do NOT force it) + add the inner
   `rel` box that reproduces rete's node-view div. Static roots (`.solenoid-node`) → chrome climbs to `rel`
   (= card border box); relative roots (`.solenoid-note`, whose `__resize` anchors to itself) → `rel`
   bypassed. Forcing one position value broke the other (forced `relative` shifted node chrome inside the
   border by the 1–2px border; forced `static` shifted the note's resize handle by 1.75px) — so don't force.
2. **`REF = 1`** (clone capture zoom): lay the clone out at true 1× so text line-boxes match the live DOM.
   REF>1 (the old `zoom:2`) rounded them differently → a constant ~0.9px text drift (same in card-local px
   at k=1.0 and k=5.5, so it was the clone's own layout, not a zoom mismatch). The earlier REF=1 test had
   been confounded by the then-unfixed anchor bug.
3. **Removed `capAspect`** — draw each card at the EXACT box `n.w+2PAD × n.h+2PAD`. `capAspect` (the
   capture's pixel aspect) existed to avoid squashing the old hair-taller `zoom:2` clone; at REF=1
   `cloneOffsetH==h` exactly, so it carried only dpr-floor ROUNDING noise (`imgH/imgW = 401/300 = 1.3367 ≠
   box 1.3333` → `dh=352.9`, card ~0.88px too tall, lower rows drifting down = "socket labels ~1px low").
   Drawing the 1× snapshot into the exact box is correctly aligned anyway — the snapshot's per-axis dpr
   scale cancels when mapped back to the box; the bug was the wrong height, not the bitmap source.
4. **CTM from the exact backing/CSS ratio, not `dpr`** — the backing store is `round(clientWidth·dpr)`, so
   the true ratio ≠ the exact `dpr` by ~1e-4 (fractional dpr). The DOM is transformed in CSS px at the true
   `k`; using `dpr` in the CTM made the canvas scale differ by `world·k·(ratio−dpr)` → distant nodes in a
   big graph drift, worse zoomed in. Store per-axis `bsx=canvas.width/clientWidth`, `bsy=…/clientHeight` in
   `resize()` and build `camCTM`/`drawCables`/`drawSelection` from them. `dpr` stays a quality heuristic.

REVERTED (2026-06-28) — perf experiments backed out at the author's request; alignment math above is what
stays. The chase for crisp zoom-in had: a raster-time `SUPERSAMPLE=2` (top mip RE-RASTERIZED via
`drawElementImage(refEl)`), `tick()` auto-live above the texture resolution, and a rAF-chunked build. The
`drawElementImage` re-raster is far heavier than the validated `createImageBitmap(snapshot)` build and
regressed large-graph pan/zoom; the whole crispness branch was reverted. So `buildMips` is back to the
fast snapshot copy, `REF=1` and the texture is therefore 1× → **zooming IN past 100% softens** (upscaled
capture). Accepted trade for faithful alignment + restored perf; the crisp escape hatch is `live` mode
(`__hcLive` / `setLive`). If crisp zoom-in is wanted later, the right design is supersampling that does NOT
re-raster the live element per node (e.g. a one-shot 2× capture, or a transform:scale wrapper) — measure
build cost on a large graph before shipping.

Why the first test lied — `offset*` has TWO blind spots that hit exactly these elements:
- **offsetParent-relative**: if cloneFor changes an element's positioning context, its `offsetTop` can
  read identical while its true SCREEN position moved. The chevron logged Δ=0 yet is visibly shifted.
- **integer-rounded**: sub-2px shifts vanish. (It still leaked the truth — header `d_top=-2,left=-2`,
  content `-1,-2`, content-internals all 0 — and that was underweighted.)
The corrected diagnostic (now in `captureRefs`, gated `window.__hcDiag`) measures
`getBoundingClientRect` relative to each CARD's rect, dividing the original by the live camera scale
`k=this.cam.scale` and the clone by `REF` → both in card-local CSS px, directly comparable. It also prints
`d_off` (screen-vs-offsetParent disagreement) and `ctx` (changed offsetParent identity) to pinpoint the
anchor shifts. Still-true diagnostic gotchas: don't hardcode class selectors (node roots vary —
`.solenoid-note`/`-group`/`-conduit`; lockstep-walk the deep clone instead); skip SVG (no clean box,
zoom-quirky bbox, vectors rasterize crisp regardless). The `__hcDiag` block stays (gated, cheap).

### HTML-in-Canvas renderer — PERF VALIDATED at scale; mipmapping was the unlock (2026-06-27)
Squeezed the HTML-in-Canvas spike (`HtmlCanvasSpike.tsx`) this session; it's now the validated
renderer path. **Result: a duplicated Personal Finance seed (280 nodes), fully zoomed out so EVERY
card draws in one frame, at the CRISPEST quality (slider q=1.5, supersampled) holds 165fps
(refresh-capped) with 0.1–0.5ms draw time** — ~12–30× headroom vs the 6ms/165fps budget, ~30–80× vs
60fps. Author expects ≤~300-node graphs, so render perf is CLOSED. The original blocker (browser
compositing thousands of DOM layers on zoom) is gone the moment the graph is one canvas;
**mipmapping killed the remaining cost** (minifying many cards when zoomed out).

What changed, in order (each a commit):
- **Cable layer**: was re-running the full router (`getCablePath`) + SVG-path parse for EVERY cable
  EVERY frame, unculled — the dominant per-frame JS cost. Now polylines + bboxes computed ONCE,
  culled by bbox, batched into one `Path2D`/`stroke` (constant 2px so cables never thicken).
- **Selection-flash fix**: the canvas holds the real cloned node DOM, so a pan drag ran a NATIVE
  text selection across it (text flashed highlighted, stole main-thread work). `user-select:none`
  on the canvas subtree + `preventDefault` on pointerdown.
- **Mipmapping** — the main event. Evolution: binary hi/lo cache → multi-level bands → decoupled the
  switch-threshold from the capture-resolution → **proper mip pyramid**.
  - GOTCHA that forced the rewrite: making a low-res level by capturing the DOM at fractional CSS
    `zoom` (e.g. 0.07×) **re-runs layout at that scale, so fixed-size UA widgets (scrollbars, focus
    rings, min-size borders) bloat** to a huge fraction of the shrunken card → giant-scrollbar
    artifact. Capturing at <1× is the wrong primitive.
  - PROPER method (how Figma/Pixi/Quadratic do it — research-confirmed): rasterize each card ONCE at
    a reference resolution (`REF`=1.5×, widgets correct), then build lower levels by **pixel-
    downscaling that snapshot** (successive 2:1 halving → an `ImageBitmap` per level), and
    `drawImage` the level matching the zoom. No fractional-zoom re-render → no widget artifacts. The
    per-frame cheap path is `drawImage(smallBitmap)`, NOT `drawElementImage`.
  - API note (flagged Chrome): `createImageBitmap(<captureElementImage snapshot>)` WORKS — the HUD
    `mip built` reached 280/280. So the snapshot is a valid `ImageBitmapSource` here; the scratch-
    canvas-rasterize fallback (and the final per-frame `drawElementImage` fallback) weren't needed.
- **Aggressiveness slider**: builds the full halving pyramid per card ONCE; the slider is a LOD-bias
  level selector (target texture ÷ on-screen size) — instant, no rebuild on drag. Used to sweep
  perf/quality. At this scale q=1.5 (crispest) is already free, so the default stays crisp.
- HUD added: zoom %, active mip level, `mip built X/N` (which capture path the API took), and exact
  zoom-preset buttons (100/65/41/25/17%) so a zoom band frames the same content every load.

**Direction**: this supersedes the Pixi hand-repro target (`renderer-decision.md` + the Pixi spike).
HTML-in-Canvas native + mipmapping is simpler — it draws the REAL cards (zero MSDF/scrape fidelity
work) and is faster to build. **Still engineering, NOT perf-risk**: the spike is render-only on a
snapshot — a real port needs live editing/drag/selection wired to the model, the floating-input
rename generalized, exact cable parity (ribbon bundling isn't in the spike), groups/conduits
interaction. **The one external risk**: `drawElementImage`/`captureElementImage` are behind
`chrome://flags/#canvas-draw-element` (Canary 149+, stable ~late 2026) — the approach rides on that
landing in stable Chrome / WebView2. A timeline bet, not a technical one.

### Seeds reworked into comprehensive domain showcases (2026-06-29)
- **`cubes.json` rebuilt** to a comprehensive Cube showcase over the SAME 36-row Orders
  fact table as the Pivot seed, plus Reps/Regions dimension tables: Nest Join (depth 1,
  Orders under each Rep) · cube-aware **multi-level** Nest Join (Region → Rep → Orders,
  depth 2) · **Cube Columns** (assemble a [count, table] cube) · Build Cube · **INDEX**
  (sub-frame + scalar) · **Unnest** (flatten back) · depth-3 wrap. `cubesSeed.test.ts`
  rewritten to check every branch end-to-end.
- **`pivot-tables.json`** gained a "Reshape the source" cluster — **Split Column** + **Add
  Index** (the new Power Query ops) on the Orders frame. Gotcha: the Date column is stored
  as date SERIALS, so it can't be string-split; added a realistic **SKU** column
  (`EL-001`) to both seeds and split THAT (→ Dept/Code). Frame-verb showcases still live
  in `table-verbs.json`; these two ops ride in the Pivot seed because they share its data.
- Seeds now carry an optional `order` (menu sort): getting-started 0, pivot 10, cubes 20.

### Cube Columns — multi-column cube assembler (2026-06-29)
`CubeColumnsNode` (`nodes/cube.ts`) builds a MULTI-column cube from N extensible `any`
column inputs + a Names CSV — the columns-wise complement of the cell-wise Build Cube.
`cubeColumnFromValue` (`frame.ts`) interprets each input: a list → its elements are the
cells; a single-column cube (e.g. a Build Cube output) → that column's cells; a
frame/scalar → ONE cell; null → empty. Columns pad to the max length. They compose:
Build Cube wraps N frames into one nested column, Cube Columns lines `[id, name, orders]`
up side by side — a Customers cube without needing a "list of frames" socket type (which
deliberately doesn't exist). Same extensible-inputs UI as Build Cube (ExtensibleInputs,
`c*` rows + a leading `names`). Kind = "math" fallback like the other cube nodes. Tests:
`cubeNodes.test.ts`.

### Cube-aware Nest Join — multi-level hierarchies (2026-06-29)
The Nest Join Parent socket is now `any` (was `frameIn`), so it accepts a FRAME (the
original depth-1 nest) OR a CUBE. Feeding a previous Nest Join's cube back in deepens the
hierarchy one level: `relateCubeToFrame` (in `frame.ts`) auto-detects the cube's nested
sub-table column (the last column whose cells are frames/cubes), and recursively
nest-joins the child into each leaf FRAME (frame → cube), descending through already-
nested cubes. So `Customer ×Order → cube`, then `cube ×LineItem → depth-2 cube`. The
join key for cube mode is the key column INSIDE the leaf sub-frames. Why `any` not
`cubeIn`: a `cube` input coerces everything via `toCube`, which would flatten a frame and
break the basic case (coerceInputs `case "cube"`); `any` passes the value through
untouched so the node can branch on frame-vs-cube. Depth is already surfaced in the popup,
so the "hidden data" worry is covered. Tests: `cubeNodes.test.ts`. Inverse (cube-aware
Unnest peel) still deferred — it needs an `any`/cube output (peeling depth-2 → depth-1
cube, not a flat frame).

### Power Query column ops: Split Column + Add Index (2026-06-29)
Two frame verbs closing the most-used Power Query gaps. **Split Column**
(`splitColumn`) splits one text column by a delimiter into N columns (max parts
across rows, short rows pad null), replacing the source column in place; names auto
("<col> 1"…) or explicit. **Add Index** (`addIndexColumn`) prepends a numeric
row-number column from a start value (default 1, de-duped name). Engine in
`frameVerbs.ts`, nodes `SplitColumnNode`/`AddIndexNode` in `nodes/frame.ts`, in the
Frames category. Tests in `frameVerbs.test.ts`. (Still missing vs PQ: fill-down on a
column, replace-values, keep bottom-N/range — secondary.)

### Pivot field editor — Excel-style 2×2 popup (2026-06-29)
The Pivot node face is now compact (the wireable sockets + a one-line summary +
"Configure fields…"); all of Rows/Columns/Values/functions/totals/sort/% moved into a
popup, `PivotEditorPopup`, opened via the `pivotEditor` module store (same pattern as
`tablePopup`/`formulaPopup`: a `createNotifier` store + a single instance mounted in
App, since the node renders in a separate React root). Key points:
- **Drag is safe because the popup is an App-level overlay, NOT inside the rete node
  DOM** — so rete's node-drag/pan pointer handler never sees it (the whole reason we put
  the editor in a popup rather than on the node). HTML5 drag moves field chips between
  the Filters/Columns/Rows/Values zones; each zone also has a "+ add field" picker
  (primary, works without drag) and chips have an × to remove.
- **The field list comes from `PivotNode.sourceColumns`** — stashed (name+type) on every
  `data()` from the incoming frame, so the popup shows real column names (discoverability:
  the win over typing names). Empty until a frame is connected.
- **Render helpers, not inline components.** `renderZone`/`fieldChip`/`valueChip` are
  plain functions returning JSX, NOT components defined in the render body — an inline
  component type remounts its subtree every render and would drop the native `<select>`
  dropdowns (func picker, totals) mid-pick. See CLAUDE.md "Native form popups".
- The popup edits the LIVE node instance and `processGraph(node.id)`s on every change
  (frame outputs are fresh refs → the node re-renders, summary + result update). The
  rowFields/colFields/values stay strList sockets (still wireable) but render cable-only
  on the node face (no inline CSV field — the popup is the editor).
- **Filters** is a real field-value include filter: drop a field into the Filters quadrant
  (or + add), click it to reveal a checklist of that column's distinct values (unchecked =
  hidden). The node stashes per-column distinct keys (`sourceColumns[].distinct`, capped
  200, same `pivotCellKey` stringification used for matching) and `filterExclude`
  (field → hidden keys); `combineFilter` compiles it to the engine row mask, AND-ed with
  any wired `filter`. Persisted via `extractInit` (deep-copied). Tests:
  `pivotNodeFilter.test.ts`.
- **No captain-obvious helper text** (author's standing aesthetic call): the zones are
  labeled empty boxes (Excel-style), no "drag fields here…" hints, no footer instructions,
  no redundant header subtitle. Affordances (grab cursor, + add, checkboxes) carry it.

### PIVOTBY — full Excel parity (2026-06-29)
Upgraded the **Pivot** node (`=PIVOTBY`) from a single index×column×value reshape to
Excel's full cross-tab. The engine (`frameVerbs.ts pivotFrame`) now takes a `PivotSpec`:
`rowFields[]`, `colFields[]`, `values[]`, per-value `funcs[]`, `rowTotalDepth`/
`colTotalDepth`, `rowSort`/`colSort`, `relativeTo`, `filter[]`.

- **Totals live in the pivot, by decision (author).** Excel computes each total by
  RE-AGGREGATING the underlying source — a grand-total AVERAGE is the average of all
  source rows, NOT the average of the displayed cell averages. So totals can't be a
  generic frame "append a sum row" (that can only reduce displayed cells, wrong for
  AVERAGE/MEDIAN/STDEV/distinct-count). `cellValue(v, rowSpan, colSpan)` aggregates the
  raw source cells for any (group-set × group-set), so body, subtotal, and grand cells
  all flow through one correct path. A naive display-only frame summary could still ship
  later as separate sugar — out of scope here.
- **Depth encoding mirrors Excel**: 0 none · 1 grand · 2 grand+subtotals · negative ⇒
  placed at top/left. Subtotal levels = outermost `|depth|−1` (needs ≥2 fields on that
  axis). `expandAxis` interleaves subtotal slots at each run boundary — anchored to the
  run's LAST leaf for bottom placement (inner-first) or its FIRST leaf for top
  (outer-first). **Gotcha fixed in review**: the first cut anchored top-placement
  subtotals to the run end → they'd land mid-group; top must anchor to the run start.
- **Multi-field headers flatten**: a flat `FrameValue` column has one string name, so
  multi col_fields / multi values compose to `"East | A"` / `"East | A | qty"`, collapsing
  to the bare value for the single-field/single-value case (preserves the old output).
  Subtotal/grand rows put a `"Total"`/`"Grand Total"` string label in the row-key columns
  (`FrameCell` allows a string in any column — type metadata is display-only).
- **Sort**: a signed 1-based index into `[fields…, values…]`. A field index orders that
  header level inside `orderLeaves` (hierarchical, contiguous outer groups); a value index
  reorders whole groups by that value's grand total (Excel "sort by sales"), applied as a
  permutation of leaves + the `cells` buckets after bucketing.
- **PERCENTOF** is the one two-arg op: `SUM(cell)/SUM(totalset)`, the total set chosen by
  `relativeTo` (0 col · 1 row · 2 grand · 3 parent-col · 4 parent-row). `aggregateGroup`
  returns null for it; the pivot resolves it.
- **N/A in this model**: `field_headers` (frames are always typed) and GROUPBY's
  `field_relationship`. GroupBy node could later expose `total_depth` for free (it's a
  no-colFields pivot); the shared `aggregateGroup` already gained the new functions.
- **UI** (`PivotComponent`): `Rows`/`Columns`/`Values` are CSV list inputs (`strListIn`,
  parsed at the coerce boundary); `Filter` is a cable-only logical-list. One op selector
  per value column (read from the parsed `values`), totals/sort/relativeTo `NumSelect`s,
  relativeTo shown only when a func is PERCENTOF. New node fields persist via the
  `extractInit` allowlist + a deep-copy clause for the `funcs` map. Seed `table-verbs.json`
  pivot kept clean (its unpivot round-trip would break under totals).
- **Seed**: `seedGraphs/pivot-tables.json` — one 36-row × 9-column **Orders** source (a
  date, five text dims, Units/Price/Revenue) feeding **8 different pivots** off the same
  frame: Region×Category SUM+totals, Revenue-by-Rep sorted high→low, per-value SUM(Units)
  & AVG(Price), Region×Month + col totals, % of grand (PERCENTOF), Region→Category
  subtotals, COUNT by Region×Channel, and MEDIAN/MAX by Rep. `pivotSeed.test.ts` runs it
  through a real editor+engine and checks every pivot's numbers.

### Renderer pivot — HTML-in-Canvas (native `drawElementImage`) over hand-repro (2026-06-26)
Author's call after I spent too long hand-reproducing node CSS on the GPU element
by element: *"there's probably tools that convert CSS/DOM to GPU without visually
examining everything."* There are. Two real ones (research in this session):
- **SVG `<foreignObject>` → texture** (`html-to-image`/`dom-to-image`): auto-captures
  CSS but produces a RASTER (blurs on zoom — the same "15px chart" problem), Safari
  taints the canvas, fonts must be embedded.
- **WICG HTML-in-Canvas** (`canvas.layoutSubtree` + `ctx.drawElementImage(el,x,y)` /
  WebGL `texElementImage2D`): the browser draws the REAL element, **re-rasterizing its
  display list at the canvas CTM** → pixel-perfect AND crisp at any zoom. Chrome-only,
  `chrome://flags/#canvas-draw-element` (Canary 149+), origin trial Chrome 148–150,
  stable ~late 2026. Author chose this — **pre-launch, targets are Chromium** (Tauri/
  WebView2 desktop + Chrome web demo); recommend graphs stay a bounded size until stable.
- **Built**: `HtmlCanvasSpike.tsx` + `htmlCanvasSpikeStore` + Edit-menu item "Renderer
  spike (HTML-in-Canvas)". Clones every live node-view into a `<canvas layoutsubtree>`
  as a paint-contained child (real graph untouched), draws groups→cables→cards under a
  camera CTM. **Uniform** — no per-type code; groups/notes/conduits/cards all just get
  drawn as the DOM shows them. Pan/wheel-zoom/pinch via the pure `Camera`; cables via the
  real router (`cablePolyline`). Feature-detects `drawElementImage`; shows enabling
  instructions when absent (verified graceful on old Chromium, 1417 tests green).
  **Can't screenshot-verify here** — the dev Chromium is too old; verify on flagged Chrome.
- **Key API constraints** (from the WICG explainer): elements MUST be direct `<canvas>`
  children; source CSS `transform` is ignored for drawing (position via CTM + dx/dy);
  draw inside the `paint` event (or after the first snapshot) — `requestPaint()` to kick.
- **Implication**: the hand-reproduction in `pixiScenes.ts`/`pixiGraphSnapshot.ts` (MSDF
  text, scraped borders/boxes/etc.) is now a *fallback/comparison* path, not the target.
  If HTML-in-Canvas holds up, the real port draws the React node components as canvas
  children directly and deletes most of the scrape/repro code.

### Pixi spike — screenshot-driven fidelity pass (2026-06-26, cont.)
Author OK'd headless screenshots to diff Rete (DOM) vs Pixi and close the gap precisely.
Harness lives in scratchpad (puppeteer-core + the pre-installed Chromium, WebGL2 via
swiftshader): seed → wait `__spike.revealPhase()==='idle'` → `dom.png`, then open spike +
"My graph" → `pixi.png`, crop/compare. Added a DEV-only `src/graph/devHarness.ts`
(`window.__spike`: open/close/seed/revealPhase/transform/mismatches). Confirmed the camera
is EXACT (mismatches()==[], xcorr dx=dy=0). The real gaps were colour/scrape bugs, fixed:
- **`color(srgb r g b / a)` parsing** (`cssColor.ts`): Chrome serializes every `color-mix()`
  result this way (header tints, the group-tinted node borders). `parseColor` returned null,
  so they fell back to a flat body fill — headers looked untinted. Now parsed (+test).
- **Real card border**: grouped nodes adopt the GROUP hue at ~0.78α, NOT the kind accent.
  Snapshot now captures the computed border colour+alpha (`SnapNode.border/borderAlpha`);
  dropped the fake drop-shadow + header divider (the DOM has neither).
- **Headerless nodes (FC)**: no phantom node-label title painted over the "Decimal" select
  (only add the fallback title when `headerH>0`).
- **Collapsed-group members**: skip any card with computed `visibility:hidden` (they keep
  layout but don't paint) — was drawing a whole hidden cluster. Drops their cables for free.
- **Group titles**: apply the `.solenoid-group__label` `text-transform` (UPPERCASE).
- **Heatmap / inline swatch grids**: class-less `<div>`s with an inline `background` — a
  generic small-leaf colour-cell pass captures them (chart/control containers excluded).
- **Table/frame value displays**: a `<table>` inside a value box was read as one concatenated
  run; now each `td/th` is emitted at its own position (grid layout matches).
- **Translucent fills composited**: a Note tints at 30%α; `flatten()` bakes any sub-opaque
  body/header onto the canvas bg (headers onto the body) so notes match the muted DOM brown.
- **Conduit**: was a harsh white square (the `borderAlpha||0.78` fallback stroked the themed
  white edge); now a subtle 0.4α neutral outline over the composited fill.
- Verified faithful on getting-started / visual-outputs / cubes / power-features: chrome,
  FCs, collapsed+uppercase groups, composited notes, line/area/column/bar charts, heatmaps,
  table grids, swatches, sliders, checkboxes, sockets, cables, LAMBDA.
- **Known remaining gaps** (niche, deferred): ribbon-cable bundling (spike does point-to-point),
  conduit floating-body position offset + lane detail, inline **bold**/emphasis inside notes
  (whole `<p>` is one run), gauge centre value + arc placement, and **large-graph DOM
  virtualization** — a 140-node seed mounts/keeps ~7 nodes visible (rest `visibility:hidden`
  for DOM perf), so the *scrape* mirrors that. The production renderer reads the model, not
  the DOM, so it won't virtualize; this is a limit of the spike's DOM-scrape, not a bug.

### Pixi spike — FULL look-and-feel coverage (2026-06-26, cont.)
Author: "do 100%, stop stopping." Drove the card fidelity broad. The model is now a
near-complete DOM scrape rendered on the GPU (all theme-aware):
- **Background**: the 24px dot grid as a GPU TilingSprite (tilePosition/tileScale).
- **Text**: every run scraped with position/size/colour/mono **+ font-weight** — generated
  **bold (wght=600) MSDF atlases** (fonttools instancer) for Next+Mono so 600 titles/values
  render bold, not thin. Tall runs **word-wrap** (notes, wrapped values).
- **Controls**: input boxes, op-select dropdowns (+caret), sliders (track+thumb), checkboxes
  (+check), **segmented toggles + Format-Controller chrome**.
- **Generic decoration scraper**: any small chrome box (buttons — incl. a generic `button`
  catch, pills, badges, dividers, quoted fields, **colour swatches**) → real bg/border/radius
  + centred label, Set-dedup'd.
- **Charts/visuals**: recharts `.recharts-surface` serialized to SVG → **GPU texture** Sprite.
- **Groups**: solid-colour header + translucent body + border + chevron + label.
- **Notes**: markdown blocks (h/p/li) at real positions. **Conduits**: rotated square body
  (node.angle), sockets at scraped positions.
- New pure tested module bits: `wrapText`, `mix`, `pickTextColor`, `socketGlyphKind`.
- Atlas regen note: `public/fonts/atkinson-{next,mono}{,-bold}.{fnt,png}` — regen via
  `fontTools.varLib.instancer <var.ttf> wght=600` then `msdf-bmfont` (see pixi/README).
- STILL needs the author's EYES (can't verify pixel-level here): exact text baselines,
  standoff connectors (niche, separate SVG layer — not scraped), isolate-dim / flow-bead
  animation states, selection glow. Run My-graph on the deploy and flag what's off.

### Pixi spike — look-and-feel pass: cards match the DOM (2026-06-26, cont.)
Author: "keep working on the actual look and feel of everything." Closed the visual gap
between the Pixi cards and the real DOM cards (all scraped from the live DOM, theme-aware):
- **Card chrome**: soft drop shadow (stacked offset rects), the accent-TINTED header (not
  a saturated bar) + header/body divider line + collapse chevron, 1.5px accent border.
- **Sockets**: the 2px inset ring (surface colour) on circle/square/split/grid — they read
  as bordered sockets, not flat blobs.
- **Controls**: input field boxes, **op-select dropdowns** (chosen option + caret),
  **sliders** (track + accent fill + thumb at value frac), **checkboxes** (box + checkmark).
  Scraped from the real `<select>`/`<input type=range|checkbox>`.
- **Cables**: per-cable stroke in the SOURCE socket's type colour; selected cable thicker/blue.
- **Groups**: solid-colour header bar + translucent body + coloured border + chevron + label
  (scraped header colour/border/height), radius 11 — matches the real group.
- Known remaining-niche gaps: color **swatchgrid** picker, **conduit rotation** (rendered
  axis-aligned for now), note markdown formatting, exact text baseline (~1–2px).
- LESSON: run `vitest` BEFORE committing — the group `g.rect()` needed adding to the test's
  fake Graphics; a stub gap failed 4 tests on one commit (fixed next commit).

### Pixi spike — full editor interactions on the GPU canvas (2026-06-26, cont.)
Author: "there's so much to port, go for everything; I'll check it all at once." So the
spike now works like a real editor (still gated, DOM untouched, all green):
- **Render breadth**: nodes + **Notes + Conduits** (generalized the snapshot from just
  `.solenoid-node` to any node-like root; notes/conduits show bbox + own bg + sockets +
  a clipped content fallback) + groups. Cables are **type-coloured** (per-cable stroke =
  source socket colour). Header is the tinted-surface + accent-border treatment.
- **Selection**: shift-click toggle, plain click = one, **box-select** (shift+drag empty),
  ring uses the node accent. Selection lives in `selectedRef`; `scene.setSelected` drives it.
- **Drag**: dragging any selected card moves the **whole selection**; persists via
  `area.translate` on release.
- **Rename**: double-click → floating `<input>` → `node.label` + `processGraph`.
- **Wire cables**: drag socket→socket; `pickSocket` (nearest within ~14 screen px) starts
  a temp cable (real router), drop on a valid opposite-side socket creates the real
  connection (`ClassicPreset.Connection` + `editor.addConnection`), recomputes, mirrors to
  the scene (`scene.addCable`). Incompatible/duplicate caught.
- **Delete**: Delete/Backspace removes the selection — connections first then nodes
  (`editor.removeConnection`/`removeNode`), `scene.removeCards` drops cards + touching
  cables, `processGraph`.
- **Minimap**: screen-space overview (bottom-right) + viewport rect, refreshed on
  pan/zoom/drag.
- Scene API grew: `addCable`, `removeCards` (+ `rebuildPicker` helper). New pure modules
  this whole arc: camera / cardLayout / picker / cableGeom / colors / socketGlyph (all
  tested). **Not yet**: cable-select/delete-by-click, hover highlight, undo/redo +
  copy/paste (need rete history wiring), the actual flag-swap onto the live canvas.

### Pixi spike — node-chrome parity pass + MSDF text (2026-06-26, cont.)
Author chose "spike-first to node-chrome parity, then flag-swap" (lowest deploy risk).
Built, all gated in the spike, all green:
- **MSDF text**: Atkinson Hyperlegible **Next** (titles) + **Mono** (values), real SDF
  atlases in `public/fonts/atkinson-{next,mono}.{fnt,png}` (gen via `msdf-bmfont-xml`,
  see pixi/README). Loaded with `Assets.load`; **graceful fallback** to Pixi's dynamic
  bitmap font on any failure (HUD shows MSDF vs fallback). ASCII charset for now.
- **Type-faithful sockets** (`pixiSocketGlyph`): circle/square/split/grid/hex by
  `dataType` (read off the rete node), coloured from `SOCKET_COLORS`' `var(--sock-*)`
  resolved off the document root (cached, theme-aware).
- **Real text runs**: dropped the hardcoded title+value; the snapshot now scrapes
  every text-bearing element (label-display / io-label / display-value / output-value /
  inline-input / value-input) with real position + size + colour + mono-ness, and the
  scene draws each in place — so multi-output / tall / input nodes render faithfully.
  The title run is flagged for the in-place rename.
- **Faithful header**: the real header is an accent-TINTED surface + 2px accent border
  (NOT a saturated bar — that's why nodes read "mostly surface"). Snapshot scrapes the
  real header bg; scene paints surface body + tinted header + 1.5px accent border.
- **Input field boxes**: `boxed` runs (inputs) get an inset field box behind them.
- Gotcha: text vertical placement uses the DOM element's rect top; BitmapText anchors
  top-left, so it's within ~1–2px of the DOM — eyeball on the deploy, nudge if needed.

### Frame Lookup node — XLOOKUP/VLOOKUP over a table (2026-06-26)
The frame half of the planned "XLOOKUP frame/cube mode" (WS3). New `FrameLookupNode`
(`nodes/frame.ts`) + pure verb `lookupFrameCell` (`frameVerbs.ts`, tested in
`frameLookup.test.ts`): find the first row whose **In column** cell equals the
**Lookup** value, return that row's **Return** cell. Match is type-aware by the key
column's type (string identity / numeric / date as serial-or-ISO / logical 0/1), a
`null`/error key never matches (join-key rule), exact only. A miss → **If-not-found**
(numeric-looking text flows as a number) else `#N/A`.
- **Output is `any`** (deliberate v1): the returned cell's type depends on the return
  column, and a node's output socket is static — so rather than the Get Column
  read-as machinery (dropdown + in-place socket retype + `retypeOutputCables`), v1
  emits on `any` and lets the value flow / Cast downstream. A typed read-as output +
  approximate match are the noted follow-ups.
- **Eager JS, not a Polars verb** — like Get Column / Get Row it's a
  materialization-boundary op (scalar out of a frame), so it runs on the already-
  materialized input `FrameValue`; no `FrameOp` / backend round-trip.
- **Add-node surface touched (the full checklist):** class in `nodes/frame.ts` (auto
  re-exported via `rete-nodes` `export *`), component `FrameLookupComponent`
  (`components/FrameNodes.tsx` + re-export in `components/index.ts`), `nodeRegistry`
  (class→component row), `nodeCatalog` (Add-menu entry `frame-lookup` + import),
  `nodes/kind.ts` (frame accent block). `stringLiterals` persist/copy like the other
  frame nodes. Blind shot — logic is unit-tested; the card layout is the author's
  Vercel eyeball. **Cube-cell lookup mode still pending.**

### WS2 — the native Polars relational engine landed (2026-06-26)
The desktop side of the `FrameBackend` seam is built: `src-tauri/src/engine.rs` (+
`engine/tests.rs`). Added the `polars = "0.46"` crate (`default-features = false`,
features `["lazy", "strings"]` — lean, no eager-pivot/regex pull-in). A handle is a
string id into a Rust-side `HashMap<String, SolFrame>`, where `SolFrame = DataFrame +
Vec<SolType>` (the per-column number/date/logical/string tag Polars' own dtype can't
fully express). Eight Tauri commands — `engine_source/apply/join/append/preview/column/
drop` — registered in `lib.rs`; `engine_ping` now reports `backend: "polars"`. The web
side: `PolarsBackend` in `frameBackend.ts` (one `invoke` per method, arg names match the
Rust params), selected once at startup by `initFrameBackend()` (called from `main.tsx`)
when `isDesktop()` **and** the ping says `"polars"` — else the in-process JS backend
stays, so the web demo is byte-identical.
- **Parity strategy.** The verbs must compute identically on web (JS oracle
  `frameVerbs.ts`) and desktop. Polars does the API-stable, order-controllable ops
  (select/drop/rename/filter/sort/join); the **order-sensitive** reshapers
  (group-by / pivot / unpivot / **distinct** / append) are computed in-engine over
  extracted column vectors so first-seen ordering + the null/empty/aggregate rules
  match the oracle exactly. `make_headers` (dedup), `aggregate_group` (count =
  non-null; sum-of-empty = 0; avg/min/max-of-empty = null; min/max preserve source
  type), and the type-distinguishing cell key are all re-implemented to mirror the
  oracle. 18 `cargo test` cases assert each verb against the oracle's documented
  behavior.
- **Gotchas / divergences (documented, acceptable for v1):** (1) an INPUT frame's
  per-cell `SolError` becomes `null` entering Polars — Polars has no error-cell
  concept; frames flowing to the engine are clean relational data. (2) string `<`/`>`
  in filter + sort is Polars' byte/lexicographic vs JS `localeCompare` (identical for
  ASCII). (3) the OUTER join's appended-unmatched-right rows aren't guaranteed to be
  in the oracle's exact tail order (inner/left/right match). (4) integral floats are
  emitted as JSON integers so an `id` reads `1` not `1.0`. (5) `polars` 0.46 has no
  `StringNameSpace::contains_literal`, so the three text predicates
  (contains/startsWith/endsWith) are the manual path.
- **Build note:** the Tauri lib won't link on this Linux container without the GTK/
  webkit dev libs (`libgtk-3-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev`) — the target
  is Windows-only, but those are needed to `cargo test` here. polars itself builds fine.
> **Reconciliation on merge into `working` (2026-06-30):** ported onto current `working`
> (the branch was 154 commits stale). One correction to the note below — **Pivot stays
> EAGER, NOT routed through the backend.** `working`'s `PivotNode` is the full PIVOTBY
> (multi-field rows/cols/values, per-value funcs, totals, sort, relativeTo) whose
> `PivotSpec` exceeds the engine's simple pivot op; routing it would regress desktop to a
> basic cross-tab. The other 11 verbs (Distinct/Head/Sort/Filter/Select/Drop/GroupBy/
> Unpivot/Rename/Join/Append) ARE routed. Frame Lookup / Split Column / Add Index /
> Decision Matrix (working-only nodes the branch never had) stay eager too. Verified: tsc
> + 1525 vitest + cargo check + 18 Rust parity tests green.

- **Node migration DONE (same day).** The relational verb nodes in `nodes/frame.ts`
  (Distinct/Head/Sort/Filter/Select/Drop/GroupBy/Pivot/Unpivot/Rename/Join/Append)
  now `await` a `frameBackend()` runner instead of calling the pure verb directly,
  so the verb runs in Polars on desktop / JS on web. The DataflowEngine already
  awaits `data()` (see `processGraph`), so the async switch was transparent.
  - **Transitional staging (deliberate):** cables still carry a full `FrameValue` —
    each runner (`runFrameUnary`/`runFrameJoin`/`runFrameAppend`) sources the input,
    composes the verb, `collect`s the WHOLE frame back, and drops its handles in a
    `finally`. So NOTHING downstream (display, cube popup, persistence, consumers)
    changed, and the migration is byte-identical on web + fully headless-testable
    (`frameNodeBackend.test.ts` asserts each runner === its pure verb; the frames
    seed test still passes through the engine). Added `collect(handle)` to the
    `FrameBackend` interface + `engine_collect` to the Rust side for this.
  - **The lazy-handle-on-cable optimization is the remaining perf step** (collect
    only at previews, cables carry handles): now a localized change — swap the
    runner's `collect` for handle pass-through + point the display at
    `backend.preview` (already built). The bridges (Build/Split/Get/Add Column, Get
    Row) + cube ops (Nest/Unnest) stay eager JS — inherently materialization points.
  - **WS3 reconciled:** all verb NODES were already built + registered in
    `nodeCatalog.ts` (the plan's checkboxes had rotted). Remaining WS3 = XLOOKUP
    frame/cube mode + the cube-awareness verb audit.

### Renderer pivot — adopt PixiJS, demote Rete to headless; the Pixi SPIKE (2026-06-26)
An outside review (docs/renderer-decision.md) concluded the WS4 hand-rolled-WGSL path
was rebuilding Figma's renderer alone, and that the "hide the DOM nodes on zoom" blocker
(rete's per-node ResizeObserver loop) is the wrong model — the fast node editors NEVER
create per-node DOM; they render everything on one GPU canvas and keep DOM only for the
ONE actively-edited field. Decision: adopt **PixiJS v8** (WebGPU + auto WebGL2 fallback,
which also dissolves the Linux/WebKitGTK fallback worry) as the rendering substrate, keep
Rete as headless model + DataflowEngine. The WS4 WGSL modules stay parked.
- **The spike (`src/graph/pixi/` + `components/RendererSpike.tsx`, buried at Edit ▸
  "Renderer spike (Pixi)") evolved from a synthetic stress test into a real proof.** Two
  modes: **Synthetic** (N grid cards 500–10k, the perf ceiling) and **My graph** (the LIVE
  rete graph snapshotted onto the GPU — faithful cards with scraped title/value + kind
  colour + real socket world-positions, the app's REAL cable router, group rects). Drag a
  live card → persists via `area.translate`; double-click → floating-`<input>` rename →
  `node.label` + `processGraph(id)` (the hidden-input pattern, the production answer to the
  blocker). Multi-touch pinch, selection, Fit, **Benchmark** (orbit+zoom 3s → avg/worst fps).
- **Pure, unit-tested core** (so the architecture is verified even though Pixi rendering
  can't be eyeballed here — only on Vercel): `pixiCamera` (world↔screen, zoom-anchor,
  pinch, fit), `pixiCardLayout` (sub-rects/sockets/bbox/rectIntersects), `pixiPicker`
  (topmost-card hit-test over the shared `SpatialGrid`), `pixiCableGeom` (reuses
  `getCablePath` → `parsePathPoints`). ~30 tests. The impure `pixiGraphSnapshot` (reads
  editor/area + DOM) is defensive — every read guarded, never throws under the overlay.
- **Two "build-both" toggles for the author to decide in the morning:** text =
  **BitmapText** (one shared glyph atlas, batched) vs **Text** (a texture per label — the
  slow path); and **LOD** (drop text below 0.35× zoom) + **Cull** (skip offscreen cards)
  on/off. BitmapText + LOD are the expected winners; the toggles let the difference be felt.
- **Gotchas:** `pixi.js` is dynamic-imported so it code-splits out of the main bundle
  (verified — its own ~880kB chunk, zero pixi in main). Socket world-pos = `view.position +
  (sockRectCenter − viewElRect.topLeft) / k` (un-scales the DOM rect; the canvas offset
  cancels). `typeof import("pixi.js")` types are erased at build, so scene builders take the
  runtime module as a param yet stay fully typed. Production upgrade still pending: MSDF
  atlas (vs dynamic BitmapText), the real selection/drag/edit parity, and the actual
  rete-render-plugin removal — the spike proves the path; it doesn't replace the renderer yet.

### WS4 PARKED — GPU renderer works; the LOD perf-hide is blocked by rete (2026-06-25)
Where the WebGPU renderer landed (author: park it for now). **Working + proven on the
build:** WebGPU cable rendering (`gpuCableRenderer.ts`) and WebGPU node-card rendering
(`gpuNodeRenderer.ts` instanced rounded-rect SDF) — author confirmed cables render and
node cards align (size/pos/kind-colour/header height). Both behind canvas render-mode
(console `__solenoidCanvasCables()`); node cards as an opt-in alignment overlay
(`__solenoidNodeCards()`, semi-transparent, drawn over the DOM). DOM is default + the
only live path; nothing ships on by default.
- **BLOCKER on the actual perf win (the LOD swap):** the win requires DROPPING the DOM
  nodes from the browser's compositing layer tree when zoomed out. The natural lever,
  `display:none` on `.solenoid-node`, **loops rete's renderer**: rete-react-plugin puts a
  `ResizeObserver` on each node (`useResizeObserver` → `setSize()` → re-render), so the
  0×0 collapse fires it and the CSS-vs-rete-remount interaction oscillates into "Maximum
  update depth exceeded". Confirmed against the rete source; it's not a React-effects bug
  on our side (multiple effect structures all looped). `visibility:hidden`/`opacity:0`
  don't loop but DON'T leave the layer tree (no win). So the perf step is genuinely hard
  and was reverted to a stable build.
- **The thesis is still UNTESTED:** because the hide never landed once, we don't yet know
  if nodes-off-DOM actually moves zoom. (Cables-only was measured negative earlier, but
  that was the 2D-canvas attempt — see the correction note below.)
- **Paths forward when resumed (ideally with interactive testing — every blind attempt
  here crashed the app and cost a revert):** (a) try `content-visibility:hidden` GATED
  behind the debug flag (rete may tolerate it better than display:none — keeps it
  opt-in so it can't break normal use); (b) render groups/notes/conduits on GPU too,
  then hide the WHOLE holder at once (one element — sidesteps the per-node observer
  storm) rather than per-node. Both need step-by-step verification on a running build.
- Leftover on ice (harmless, unused after the revert): `cableScene.setFrozen` (the
  origin-spoke guard), `nodeScene`/`nodeInstances`/`nodeGeomBus`, the hit-test
  groundwork (`cableHitTest`/`spatialIndex`/`cableHitIndex`/`nodeHitIndex`), `cssColor`,
  `cableTessellate`. Tauri has `--enable-unsafe-webgpu` wired; `@webgpu/types` added.

### WS4 Phase 2 — WebGPU node-card renderer started (2026-06-25)
Author's key point: real graphs are NODE-heavy, so a cable-only GPU layer can't move
zoom — the DOM *nodes* are the heavy half of the compositing layer tree. So the actual
win is nodes off DOM. Built the GPU node-card layer (the LOD stand-in for DOM node
bodies): `nodeInstances.ts` (pure instance packer, tested), `gpuNodeRenderer.ts` (WGSL,
instanced unit-quad, rounded-rect SDF + header/body split + AA, ONE instanced draw for
all nodes), `nodeScene.ts` (reads live world-rects from `area.nodeViews` + kind colours
from `NODE_KIND_ACCENTS`; `nodeGeomBus` bumped by Canvas's area pipe on render/move/add/
remove, NOT pan), `components/NodeCanvas.tsx`.
- **Current state = ALIGNMENT-CHECK overlay, NOT the perf win.** `NodeCanvas` draws the
  cards semi-transparent (0.55) ON TOP of the DOM nodes so the author can confirm each
  card matches its node's size/pos/colour. Toggle `__solenoidNodeCards()` (needs canvas
  render-mode on too). Regular `.solenoid-node` roots only (groups/notes/conduits skipped).
- **The actual perf win is the NEXT step — the LOD swap:** when zoomed out past a
  threshold, HIDE the DOM node elements (so they leave the compositing layer tree) and
  show the GPU cards; swap back near 1:1. That's what shrinks the layer tree the perf
  doc identified as the floor. Building it before verifying card alignment would be
  risky (hiding DOM nodes can break layout/interaction), hence the alignment step first.
- Two WebGPU contexts now (cables + nodes), each its own device — fine, will likely
  merge into one renderer/pass later. Gotcha to watch: per-frame node-rect reads are a
  reflow, so `nodeScene` reads only on `nodeGeomBus` (geometry changed), never on pan.

### WS4 CORRECTION — the slow result was 2D Canvas, NOT the GPU renderer (2026-06-25)
The "canvas cables net-negative, shelved" verdict below was measured against the **2D
Canvas API** (`CanvasRenderingContext2D` — `ctx.stroke(Path2D)`). That is the WRONG
tool and is precisely what was rejected the two prior times: 2D canvas re-tessellates
+ re-submits every bezier on the CPU every frame, so panning a big graph is slower than
DOM. The `renderer-plan.md` target was always the **GPU geometry path (WebGPU / WebGL2)**:
upload cable geometry to GPU buffers ONCE, and pan/zoom is just a transform-uniform
update + redraw (geometry never re-touched). The full renderer is GREENLIT (author).
- **Direction (author, 2026-06-25): DESKTOP-ONLY, go straight to WebGPU** — not WebGL2,
  no web fallback. So the renderer is **WebGPU/WGSL** (`gpuCableRenderer.ts`): request
  adapter+device, configure the canvas context (premultiplied alpha), one render pipeline,
  geometry in a vertex buffer uploaded ONCE per scene change, pan/zoom = rewrite a 16-byte
  uniform + submit one draw. 4× MSAA so cables stay smooth. WebView2 needs
  `--enable-unsafe-webgpu` (added to `src-tauri/tauri.conf.json` additionalBrowserArgs) —
  **so a re-measure requires a fresh `.exe` build**. `@webgpu/types` added (devDep) +
  `/// <reference types="@webgpu/types" />` in the renderer. The WebGL2 attempt was
  deleted. Reuses `overlayTransform` (added `clipScaleOffset`, tested), `cableTessellate`
  (polyline→ribbon, tested), `cableScene` + the publish mechanism, the hit-test groundwork.
- Device loss (`device.lost`) → fall back to DOM (cables never silently vanish).
- **What changes vs the 2D attempt:** geometry (cable polyline → triangle ribbon) is
  tessellated ONCE per geometry change and lives in a GPU vertex buffer; the area
  transform is a uniform; pan/zoom = set uniform + one draw call (batched across cables).
  That's the architecture the perf win actually depends on.
- The 2D `CableCanvas` painter is being replaced, not extended. Render-mode flag + the
  Settings-toggle removal stay until the GL path proves faster (then re-expose).

### WS4 canvas cables — PERF VERDICT: net-NEGATIVE, shelved (2026-06-25)
Ran the built-in frame probe (`window.__solenoidPerf=true`, zoom a dense paste-
multiplied graph, read the `[perf]` console line) in DOM vs canvas mode. Result, on
comparable (same-frame-count) zooms: DOM ≈ **43fps / 27% dropped / worst 145ms**;
canvas ≈ **11fps / 80% dropped / worst 770ms**. No improvement anywhere; worst-frame
hitches much bigger. This matches the author's note that a cable canvas was rejected
TWICE before — third strike in the cheap (hybrid) form.
- **Root cause (was flagged as the Phase-1 caveat, now confirmed):** the hybrid ADDS
  without REMOVING. In canvas mode the browser still composites the full DOM layer
  tree (every per-cable invisible hit `<svg>` is still there) AND now also clears +
  re-strokes every cable on TWO full-viewport dpr-scaled canvases on every zoom event
  (not even rAF-coalesced). Strictly more work than DOM alone → slower.
- **What it does NOT prove:** whether "cables on canvas" can EVER win. That needs the
  hit `<svg>` actually GONE (Phase 3, hit-test via the unwired `cableHitIndex`) + one
  rAF-coalesced canvas — i.e. canvas-INSTEAD-of-DOM, not canvas-ON-TOP. And even then
  the DOM *nodes* (the heavier half of the layer tree) remain until Phase 2. So a real
  test = a full Phase 2+3 spike, major work, may still come back negative.
- **Decision: SHELVED.** Removed the user-facing Settings "GPU cable layer" toggle so a
  known-slower mode can't be stumbled into; the render-mode code + the unwired hit-test
  groundwork (`cableHitTest`/`spatialIndex`/`cableHitIndex`/`nodeHitIndex`/`cssColor`)
  STAY (on ice, console-only via `__solenoidCanvasCables()`) for an eventual full
  renderer spike. DOM is default and was always the only live path — nothing lost.
  Caveat on the measurement: the DOM baseline drifted run-to-run (43→6fps, denser graph
  / thermal), so it wasn't a clean A/B — but canvas showed zero upside + worse hitches,
  so the conclusion holds.

### WS4 Phase 3 groundwork built UNWIRED — canvas cable hit-testing (2026-06-25)
Author cleared building hard-gated pieces as long as they aren't wired in. Built the
full Phase-3 cable hit-test stack, pure + tested, with NOTHING importing it (no
behaviour change): `cableHitTest.ts` (flatten an SVG `d` → polyline; point→polyline
distance; `hitTestCables`), `spatialIndex.ts` (`SpatialGrid` bucket-by-bbox + point/
radius query, so a query touches a tiny candidate set on a 5k-element graph instead of
scanning all cables), and `cableHitIndex.ts` (composes them — `update(cables)` keeps a
self-maintaining index, `hitTest(point, tol)` → nearest cable id). This is the unlock
for the limitation flagged in the Phase-1 note: it's what lets Phase 3 DROP the per-
cable invisible hit `<svg>` (the DOM layer that caps Phase 1's compositing win) for one
index query. All world-space (tolerance = screen px / k). Reusable for ANY canvas cable
design, so low-waste even if Phase 1's specific approach changes. Still gated: wiring it
(removing the hit `<svg>`, routing Canvas's cable hover/click/context-menu/lasso through
the index) is Phase 3 and needs the greenlight + the perf trace first.

### WS2/WS3: FrameBackend seam + the pure relational verb engine (2026-06-25)
Local v1.0 session. Built the data-stack foundation, all behind a seam so the live app is
untouched (nothing consumes it yet):
- **IPC surface** (`src-tauri/src/ipc.rs` + `src/graph/ipcBridge.ts`): `engine_ping` round-trip +
  an `IpcError` that serializes SolError-shaped (`{__solError,code,message}`) → a Rust `Err` arrives
  as a tagged value the app already renders. `toSolError` validates the code against the canonical
  set (`ERROR_EXPLANATIONS` keys) on BOTH the tagged and untagged paths (A3 caught a leak where a
  Rust `IpcError` always sets `__solError:true`, so a bad code rode the tagged short-circuit).
- **`FrameBackend` seam** (`frameBackend.ts`): `source/apply/join/append/preview/column/drop` over
  opaque `FrameHandle`s. `JsFrameBackend` keys handles into a Map mirroring the Polars id→LazyFrame
  model; the ONLY materialization points are `preview` (schema+head-N+rowcount) and `column` (eager
  list). Async interface (Polars is IPC); JS resolves immediately.
- **`frameVerbs.ts`** — the pure verb engine, ONE definition per verb (FrameValue→FrameValue), shared
  by `apply`, the Polars parity oracle, and (later) the verb nodes: select/drop/rename/sort/distinct/
  head/filter/groupBy/join(4 hows)/append/pivot/unpivot/nest/unnest. Reuses `compareOp` (filter) +
  `forAggregate` (groupBy) so semantics can't drift from FilterNode/Aggregate.
- **Gotchas / decisions** (A3 review): join uses **null≠null** (SQL/Polars `join_nulls=false`) —
  null/error keys aren't indexed, so JS row counts match Polars; groupBy **min/max inherit the source
  column type** (a max over a date stays a date), sum/avg/count→number; verb outputs DROP per-column
  `raw` (derived frame). **Deferred parity decisions** (for the Polars-backend / node-wiring increment):
  (a) append takes a column's type from the FIRST frame that has it — Polars vertical concat errors or
  super-types on a mismatch; pick reject-vs-relaxed when wiring. (b) `preview`/`column` REJECT with a
  tagged `#REF!`; a consuming node must `.catch` and re-emit it as a value or `installErrorGuards`
  flattens it to `#ERROR!`. Also caught + fixed a **TZ date bug** in the formula path
  (`DATE/EDATE/DATEVALUE/WORKDAY` gave fractional serials on a non-UTC box; round to the integer
  serial — `11cb1b5`).

### WS4 Phase 1 — cables on a canvas layer, BUILT but UNPROVEN (2026-06-25)
Visible cable strokes now paint on one shared `<canvas>` when render-mode is `canvas`
(`cableScene.ts` + `components/CableCanvas.tsx`), gated behind a Settings → Renderer
toggle (GPU-gated) and the `__solenoidCanvasCables()` console hook. DOM is the default
and is byte-identical (every change guarded on `renderMode === "canvas"`).

**Architecture (deliberately low-divergence):** `ConnectionComponent` stays the SINGLE
producer — it already owns rete's live socket positions + ribbon/pill/colour/selection
logic, so in canvas mode it just PUBLISHES its computed stroke (the same `d`/colour/
width/opacity it would have put on the `<path>`) into `cableScene` via a render-written
ref synced in a deps-less layout effect, and emits only its invisible hit `<svg>`. One
`CableCanvas` paints the scene. So the canvas geometry can't drift from the DOM render —
it's the same numbers. Two canvas layers (portaled into `.solenoid-canvas` like
CableFlourish): below nodes (z-index:-1) for normal cables, above nodes (z-index:100)
for selected cables (mirrors the DOM selected-cable z-jump). World-unit strokes via one
baked `deviceMatrix(transform, dpr)` setTransform → pixel-aligned at any zoom; pan/zoom
only repaints the canvas (cables don't re-render — that's the intended win). Excluded,
stay full DOM: ribbons, flow-on (the bead CSS animation), the reveal cinematic,
pseudo/in-progress cables.

**HONEST CAVEAT — this may not be "acceptable" yet, and the author has been burned twice.**
Author (relayed via A3): a cable canvas was tried ~twice before for web-demo perf and
rejected. What's *different* this time: (1) the component stays the source of truth so
fidelity/interaction don't regress (hit-testing is untouched — still DOM); (2) a single
dpr-baked world transform so pan/zoom is a pure repaint of cached Path2Ds, crisp at any
zoom; (3) it's a gated step toward the *proper* renderer (`renderer-plan.md`), not a
standalone hack. BUT the honest limitation: **we keep one invisible hit `<svg>` per cable**
(for hover/click/lasso), so the ~5k-element layer tree that `performance-hardening.md`
identified as the compositing floor is only PARTIALLY reduced — we drop the visible +
flow paths (the paint cost) but not the per-cable layer. The full compositing win likely
needs **Phase 3 (canvas hit-testing)**, which is gated. So Phase 1 ALONE could reproduce
the prior "not faster enough" verdict. **Do the Chrome perf trace (renderer-plan "Open
verification") before trusting this** — if Composite Layers doesn't drop materially with
canvas mode on the dense graph, that's the signal Phase 1 isn't sufficient and we need
the greenlight for Phase 2/3 (or to reconsider). Built it gated + off by default exactly
so this can be evaluated without risk to the DOM path.

**Gotchas:** canvas can't use CSS vars — `var(--cable-selected)` is resolved via
`getComputedStyle`, cached, invalidated on `appThemeStore` version. `isoDim` (the SVG
wrapper's opacity:0.1) is folded into the published stroke opacity since the canvas
stroke doesn't inherit a wrapper. Hooks-order constraint: the publish can't run in an
effect keyed on the post-early-return `pathD`, so it's a ref written during render +
one deps-less layout effect that syncs ref→scene (and unmount removes).

### WS4 Phase 0 — canvas-renderer de-risk harness landed (2026-06-25)
The feature-gate + transform-mirror scaffold for the GPU renderer (`renderer-plan.md`),
no visual change. Four new modules: `renderMode.ts` (persisted `dom|canvas`, default dom),
`gpuProbe.ts` (WebGPU adapter → else non-software WebGL2; SwiftShader/llvmpipe/WARP classify
as `none` so software is NEVER chosen over DOM — `main.tsx` forces mode back to dom on probe
fail), `overlayTransform.ts` (pure world↔device/css math + `deviceMatrix` for `ctx.setTransform`
+ an `overlayBus` singleton), and `components/RenderOverlay.tsx` (a transparent `<canvas>` over
the rete container, backing store sized to dpr, mirroring pan/zoom via one baked transform).
- **Coordinate math** (the thing Phase 0 exists to prove): world point → CSS px is `(wx·k+x, wy·k+y)`
  using `area.area.transform`; multiply by dpr for the backing store. The overlay canvas is itself
  UNtransformed — we bake k/x/y/dpr into a single `setTransform` and author geometry in world units,
  so it tracks the DOM nodes pixel-for-pixel at any zoom with no CSS transform of its own (which would
  blur + lag a frame). Verify on the build: console `__solenoidOverlayDebug()` draws a world-anchored
  grid + origin marker; pan/zoom and confirm lockstep with nodes. Off by default → zero visual change.
- **Canvas.tsx** touched only in-scope (render/area layer): `syncBackground` feeds `overlayBus.setTransform`,
  and `<RenderOverlay/>` mounts as a wrapper sibling. Did NOT touch node model / engine / value model /
  persistence (the WS4 scope guard).
- **Gotcha — vitest CLI path filter:** the repo path contains a space, so `vitest run <file>`
  positional filters silently match nothing ("No test files found"). Use `vitest related <path>` or run
  the whole suite. One suite failure (`excelFunctions` DATE serial) is a pre-existing TZ artifact —
  passes under `TZ=UTC`, untouched by this work.
- Phase 1 (cables→canvas) is gated on the cheap Chrome perf trace first (renderer-plan "Open verification");
  not started.

### v1.0 detailed plan written (2026-06-25)
v0.9 is an internal milestone only (not a public release) — moving to v1.0. Wrote
`docs/v1.0-plan.md`: the file-level build plan expanding the roadmap's Phase A–D spine.
Author's three pillars (Rust backend / wgpu renderer / relational DBs + extended Cube) map
to four workstreams: WS1 Tauri spine → WS2 Polars engine → WS3 relational verbs + Cube
bridge; WS4 GPU renderer is independent and doesn't gate the ship (DOM fallback is permanent).
Key architectural call recorded for review: a single **`FrameBackend` interface** with two
implementations (`JsFrameBackend` for web/dev, `PolarsBackend` over IPC for desktop) so the
node layer is backend-agnostic and the web demo keeps working — the frame layer goes
async/handle-passing, the scalar/list layer stays eager JS. Open decisions parked at the
bottom of the plan (renderer in-webview vs native wgpu; does GPU gate v1.0; solver/sweep in
or out; Windows-only). Linked from `roadmap.md` + `architecture.md`. Pure planning — no code.

### Passthrough/selector nodes show their carried format on their OWN box (2026-06-25)
Found while building the Unit Flow seed: in Lane E the IF's own result box showed a bare `80` even
though the downstream "Charged" Display showed `$80.00`. Cause: a generic node's value box
(`ValueDisplay` in `nodeKit.tsx`) only read `formatAnnotationStore.getForNode(id)` — a DIRECT/docked
write — never the resolver. So a Display (its own component) resolved the carried lock, but IF / CHOOSE
/ SWITCH / IFS (which use the generic `ValueDisplay`) didn't.

Fix: `ValueDisplay` now falls back to `makeAnnotationResolver().outAnnotation(id, outKey)` when there's
no direct annotation — but ONLY for nodes that actually CARRY one, gated by a cheap duck-type
(`passesUnitThrough === true || typeof unitPassInputs === "function"`). Sources/transforms stay raw and
never build a resolver (the resolver returns undefined for them anyway). This makes a selector that
"keeps the unit" SHOW it in place, consistent with Display. Re-renders on `formatAnnotationStore`
version bumps (upstream FC edits) and on the node's own value-update render (selector re-pick). Asserted
in `unitFlowSeed.test.ts` (`outAnnotation(E_if,"result")` is usd).

### "Unit Flow" seed — teaches the FC unit-flow rules (2026-06-25)
Added `seedGraphs/unit-flow.json` (auto-registers via the `*.json` glob; shows as "Unit Flow" in the
seed menu). A teaching graph of five labeled lanes, each a Note caption + a tiny chain, demonstrating
one rule of the unit/format-flow system:
- **A — downstream carry:** one inline FC locks `$`+2dp; every Display after it shows `$1,234.50` with
  no trailing FC.
- **B — upstream multi-hop (the new fix):** FC at the END of the chain; both Displays in front of it
  (even two hops up) show `1,200 km`; the raw input box stays unformatted.
- **C — transform breaks it:** `$10.00` ×100 → bare `1,000` (the unit drops at a transform).
- **D — Convert forwards a unit:** `mi→km` then an FC that's LOCKED to `km` (didn't pick it).
- **E — selector keeps it:** `IF(in-stock, $sale, $list)` → `$80.00`; the chosen branch's `$` rides through.

`unitFlowSeed.test.ts` builds the seed with the REAL node classes and asserts each captioned behavior
via the resolvers/store (so a future unitFlow/FC change can't quietly make a caption lie). The generic
`seeds.test.ts` already guards structural validity (types construct, connections land on compatible
sockets, FC hosts resolve). NOTE for authoring inline FCs in a seed: the value must flow THROUGH the FC
(`host → FC.in`, `FC.out → next`) for downstream boxes to inherit via the resolver — a docked FC hanging
off a non-FC/non-passthrough source does NOT carry forward, because `outAnnotation` of a plain source is
undefined (only the explicit host-box write formats that one box).

### FC upstream multi-hop — bidirectional segment resolution (2026-06-25)
Closed the last v0.9 FC-architecture gap: an FC's locked format/unit now reaches a Display two hops
ABOVE it (`Number→Disp1→Disp2→FC` formats Disp1, not just the immediate Disp2).

**The setup before:** the FC explicitly WRITES its annotation onto its immediate input source box
(`refreshAnnotation` → `formatAnnotationStore.set(inSrcId, …)`) — single-hop. Downstream boxes (AFTER
the FC) already inherited via `makeAnnotationResolver.inAnnotation`, which walks BACK through
passthroughs to find an upstream FC. The gap was a box UPSTREAM of the FC but more than one hop away:
`getForNode(Disp1)` is empty (FC only wrote Disp2) and `inAnnotation(Disp1,"in")` walks back to the
Number source (no FC) — so Disp1 showed nothing.

**The fix (read-side, no new writes):** added `downstreamAnnotation(nodeId, outKey)` to
`makeAnnotationResolver` — walks FORWARD from a box's output through PURE passthroughs
(`isPurePassthrough` = `passesUnitThrough === true`, i.e. Displays only — NOT selectors) until it hits
an FC (`hasAnnotation`) and returns its lock. Stops at any transform / selector / Convert (the value
changes there, so it's a different value). `DisplayNode` now reads
`getForNode ?? inAnnotation("in") ?? downstreamAnnotation("out")`.

**Why read-side, not extend the explicit write:** writing the annotation onto every upstream box would
clobber when two FCs sit in one passthrough segment (each FC's `_written` reconcile would fight over the
shared box). Deriving it on read keeps `getForNode` (the direct/docked write) as the always-wins layer,
so a box with its OWN FC is never overridden — the "FC-clobber edge case" the backlog flagged just
doesn't arise. Memoized + cycle-guarded like the back-walk. The only pure-passthrough node is Display
and Displays read via the resolver, so covering Displays covers every multi-hop case; the immediate
predecessor of any OTHER node type still gets the single-hop explicit write as before. Origin/transform
boxes are unchanged (they read `getForNode` only) — inserting a Display no longer "steals" formatting,
it just extends it across the Display run. Tests in `unitFlowAnnotation.test.ts`.

### In-app docs big upgrade — reference shows descriptions, Help/Notes deepened (2026-06-25)
Second pass on the Reference-window docs (Function Reference / Help / Notes tabs), a real upgrade not
just a content refresh:
- **Function Reference now surfaces each node's prose description.** Before, a node's catalog
  `description` (the "what it does", e.g. "Absolute value") was ONLY visible as the Add-menu hover
  tooltip — the reference table showed just the Excel function/syntax/note. Now `buildFunctionReference`
  carries `description` into `FnRefRow`, `FunctionReference.tsx` renders it as a muted line under the
  node name (stripping the trailing `(Excel: …)` tag via `cleanDesc`, since the Excel column repeats it)
  AND includes it in the search filter — so you can search the reference by what a node *does*
  ("running total", "absolute value"), not only by function name. `col-sol` widened 165→230px,
  `.fr-sol-desc` style added.
- **Improved the weakest descriptions** (now that they're visible): bitwise ops (use-case framing —
  masks/flags/×2ᴮ), depreciation methods (which is accelerated vs straight-line + when), EFFECT/NOMINAL
  (APY/APR + inverse), LOG2, COVARIANCE.P/.S. Edit points: `BITWISE_OP_META`/`DEPRECIATION_OP_META`/
  `INTEREST_RATE_OP_META` (finance.ts), `MATH_FN_OP_META` (scalar.ts), `COVARIANCE_OP_META` (stats.ts).
- **Help tab (help.md):** added a keyboard-shortcuts table (verified against Canvas.tsx — A/G/I/T/E/F/C,
  `[`/`]` rotate, arrow-nudge, Tab chrome, Esc isolate, the Ctrl combos), a **Format Controllers**
  how-to, isolate + pin-value, and a real **Settings** section (palette / packs / canvas / performance /
  data folder). help.md 90→149 lines.
- **Notes tab (notes.md):** added a **"From Excel — the same idea, wired"** mapping table (SUMIF →
  Filter+Aggregate, VLOOKUP → XLOOKUP, PivotTable → Group By, running total → Cumulative, array formula →
  broadcast, etc.) — squarely the zero-Excel-learning-curve principle. notes.md 175→254 lines (on top of
  the pass-1 logical/blanks/Cubes/Units rewrite). GFM tables render (marked `gfm:true`, Markdown.css
  already styles `table`).
Researched via two Explore agents (node inventory + description audit; full operational surface). The
Function Reference *parity* data (nodeExcel.ts) was already current from the formula-consolidation
session — no change there.

### FC "function model" moved to v1.1 (2026-06-25)
Author deferred the **function model** — the coherent spec for how an FC composes precision
(`decimalDigits` × `decimalMode`: places vs sig-figs), format style (`FormatStyle`), unit (separate
axis; currency is a unit), and the multiple value types it formats (number/date/text/logical, each
lighting up a different subset of controls) into ONE behavior instead of per-style ad-hoc logic — out
of v0.9 to join the other v1.1 FC work (visual/layout redesign, SegToggle unification, docked-FC
movement). The v0.9-remaining FC item is now just the **upstream multi-hop** annotation write.
Deliverable when 1.1 lands: the spec FIRST (truth table of which controls apply per value-type + the
precision×style resolution rule), THEN the redesign code. Backlog + roadmap reconciled.

### FC unit propagation — principles + input-aware passthrough (2026-06-25)
Author set the unit model for Format Controllers:
- **An FC locks/controls a value's UNIT up + down the stream.** $12 is always 12 USD.
- **A node that only PASSES a value (doesn't transform it) retains the unit.** IF(true, a, b) → if
  a or b carry a unit, the result carries it.
- **A TRANSFORMATIVE node breaks the unit** — the DEFAULT for anything not marked passthrough.
- **Convert passes a unit BACKWARD only if there's no superseding FC** upstream.
- **Dimensional math (mi/hr → mph) is OUT OF SCOPE** for now (future work).

The machinery already existed in `unitFlow.ts` (`makeUnitResolver` / `makeAnnotationResolver` walk the
graph backward; FC = lock/forward, Convert = impose toUnit, else = break). What was MISSING and is now
built (`b025d26` + `80dd70a`): **input-aware, DATA-AWARE passthrough.**
- Before, passthrough used `firstInputUnit` — for a selector that's the CONDITION, not the value.
- A selector COMPUTES which branch it returns, so the unit is KNOWN: it records the chosen input key
  in `data()` (`_selectedUnitKey`) and exposes `selectedUnitInput()`. unitFlow follows THAT branch's
  unit — `IF(true, km, mi)` is km, `IF(false, km, mi)` is mi.
- Only when the selection is INDETERMINATE (`null` — e.g. a LIST condition picking per-element) does it
  fall back to `unitPassInputs()` + COMBINE (unitless branches ignored; conflict → no unit).
- Wired up: IF → `then`/`else`; CHOOSE → the `v*` rows; SWITCH → the `then*` values + `default`;
  IFS → the `val*` values + `otherwise` (condition / selector / `when` keys excluded). Display keeps
  `passesUnitThrough: true` (all inputs).
**Convert backward gating** was already correct — `formatController.refreshAnnotation` only takes
`Convert.fromUnit` when `!fedByForwarder` (no superseding upstream unit).
**Remaining FC architectural work** (not this pass): the function model (places/sig-figs), docked-FC
movement re-snap, and the **upstream multi-hop** backward write — currently an FC writes its format only
to the IMMEDIATE box behind it; reaching boxes ABOVE a passthrough needs a backward walk and has
FC-clobber edge cases (stop at an upstream FC/Convert/transform). See roadmap.
*(UPDATE 2026-06-25: upstream multi-hop is now DONE — solved read-side via `downstreamAnnotation`, not a
backward write, so no clobber; see the later entry. The function model + docked-FC movement were MOVED to
v1.1, so NO FC architectural work remains for v0.9.)*

### Formula↔node consolidation: error mapping + stats audit (2026-06-25)
v0.9 item #2 progress (Formula.js ↔ native one-engine). Commits:
- **Shared Formula.js→SolError mapping (P5).** A Formula.js function signals failure by
  RETURNING an `Error` (`.message` = "#NUM!"/…). That leaked through formula hosts untagged
  unless the host mapped it — only Expression did. Hoisted `fxErrorToSol` + `normalizeFxResult`
  into `excelFunctions.ts`, applied at the shared evaluator boundary (`compileFormula` +
  `compileEvaluator`), so EVERY host (Expression / LAMBDA / MAP / BYROW / BYCOL / REDUCE / packs)
  now surfaces an in-formula error as a tagged SolError. Only the FINAL result is mapped — an FX
  `Error` INSIDE the formula still flows natively so FX's own IFERROR/ISERROR catch it
  (`instanceof Error`); a `SolError` plain object wouldn't be. Arrays keep their per-host element
  cleaning (scalar-level mapping).
- **Datetime extractors registered.** MONTH/DAY/HOUR/MINUTE/SECOND resolve to native impls
  reading our serial (`serialToJsDate().getUTC*`), matching DatePartNode — joined YEAR/EOMONTH.
- **Divergence audit (the load-bearing finding).** Compared every formula-reachable stat function
  (our node `data()` vs Formula.js) on varied inputs. **The vast majority AGREE** — MEDIAN,
  STDEV.S/P, VAR.S/P, GEOMEAN, HARMEAN, AVEDEV, DEVSQ, SKEW, SUMSQ, KURT, MODE, LARGE, SMALL,
  PERCENTILE.INC/EXC, QUARTILE.INC/EXC, CORREL, RSQ, COVARIANCE.P/S, SLOPE, INTERCEPT. So
  "register the internal stats family for consistency" is mostly a NO-OP (FX already matches ours).
  Only three diverge, and the audit also exposed a **breakage**:
  - **STDEV / VAR / MODE / PERCENTILE / QUARTILE / RANK / PERCENTRANK / COVARIANCE THREW
    "Unknown function" in a formula** — Formula.js exposes them only as namespaced OBJECTS
    (`FX.STDEV.S`, `FX.PERCENTILE.INC`, …) and the formula tokenizer can't read a dotted name, so
    the flat names resolved to `null`. Registered the flat Excel name → FX's namespaced impl (Excel
    flat-name defaults: STDEV/VAR sample, PERCENTILE/QUARTILE inclusive, MODE single, COVAR
    population, PERCENTRANK inclusive). They now compute.
  - **RANK** (#N/A for a value not in the list — Excel; FX returns 0) and **TRIMMEAN** (Excel rounds
    the trimmed count DOWN to a multiple of 2; FX over-trims) — OURS is the Excel-correct one, so
    registered `excelRank` / `excelTrimmean` and pointed RankNode / TrimMeanNode at the SAME callable
    (one impl both paths call).
  - **PERCENTRANK — fixed (author OK'd the behavior change).** `PercentrankNode` previously did NOT
    interpolate between data points (`below/(n-1)`) and ROUNDED to significance — both off-Excel. Now
    a shared `excelPercentRank` (interpolate between bracketing points + TRUNCATE to `sig` digits;
    exact match uses the first occurrence; out-of-range = #N/A) backs BOTH the node and the formula
    path, verified against FX.PERCENTRANK.INC/EXC. So node == formula == Excel.
  - GEOMEAN/HARMEAN on non-positive input differ only in the invalid-input sentinel (null vs 0/NaN) —
    left as-is.
- **Rounding family audited, no override needed.** Compared RoundN (round/up/down), MathFn
  (int/trunc/even/odd/floor/ceil) and MROUND against FX over negatives/halves — all AGREE with Excel
  (ROUND was already overridden for half-away-from-zero). So the only formula-reachable divergences
  in the whole sweep were the three stats functions above.
- **No other broken flat names.** Enumerated every Formula.js namespaced-object export; apart from the
  8 stats functions (fixed), the rest are distribution/test PREFIXES (NORM.DIST, CHISQ.TEST, …) whose
  flat names aren't real Excel functions — they're node-only (dotted names don't tokenize). So the
  formula-reachable surface is now consistent with the nodes wherever the two overlap.

### Formula sweep, round 2 — the FULL overlap list, not a subset (2026-06-25)
The first audit only covered the stats aggregators + rounding; this swept EVERY formula-reachable
family (scalar-math, two-input math, combinatorics, GCD/LCM, text, closed-form finance) node-vs-FX.
Real Formula.js BUGS found + overridden with our (Excel-correct) impl through the registry:
- **MOD** — Excel's remainder takes the DIVISOR's sign: `MOD(10,-3) = -2`, `MOD(-10,-3) = -1`. FX
  returns -1 and 4 (just `%`). Common function, real bug. Registered ours (`x − y·floor(x/y)`).
- **ATAN2** — Excel `ATAN2(x_num, y_num) = atan2(y, x)` (x first); FX computes `atan2(x, y)`. Registered
  ours (`Math.atan2(b, a)`).
- **Domain misses** — LN/LOG10/SQRTPI/ASIN/ACOS/ACOSH/ATANH of an out-of-domain input: our node tags
  #DOMAIN!; FX silently returns `null` for several (formula went blank instead of erroring). Registered
  ours so formula == node == the flagship error system. (SQRT already owned.)
- **MOD/QUOTIENT ÷0** — real #DIV/0! (Excel), not FX's null.
Everything ELSE agreed: ABS/SIGN/SQRT/EXP/SIN/COS/TAN/…/SINH/COSH/TANH, POWER, GCD/LCM, COMBIN/COMBINA/
PERMUT/PERMUTATIONA/FACT/FACTDOUBLE, UPPER/LOWER/TRIM/PROPER/LEN/LEFT/RIGHT/MID/SUBSTITUTE/REPLACE/REPT/
CHAR/CODE/FIXED, and ALL closed-form finance (PMT/FV/PV/NPER/RATE/IPMT/PPMT/SLN/SYD/DDB/DB/EFFECT/NOMINAL).
### Formula engine — COMPLETE + the established limitations (2026-06-25, round 3)
Finished the sweep across EVERY formula-reachable family and closed the remaining gaps. Net state:
- **Dotted names work** — the tokenizer consumes `.` inside a function name; `resolveExcelFunction`
  walks the FX namespace (FX.NORM.DIST); `FX_FUNCTION_NAMES` lists flat + dotted. So STDEV.S, VAR.P,
  PERCENTILE.INC, RANK.EQ, NORM.DIST, T.DIST.RT, … all parse.
- **Distributions** — all callable. FX has most (via the namespace walk); the ones it LACKS (whole T
  family: T.DIST/.RT/.2T + T.INV/.2T; the right-tail variants CHISQ.DIST.RT/INV.RT, F.DIST.RT/INV.RT;
  GAMMA.DIST/INV) are registered with OUR impls reusing mathUtils. `distributionFormula.test.ts` locks
  each to its node's output.
- **MOD / ATAN2** were real Formula.js BUGS (MOD ignored the divisor's sign; ATAN2 used the wrong arg
  order) — overridden with ours. **Domain misses** (LN/LOG10/SQRTPI/ASIN/ACOS/ACOSH/ATANH) now tag
  #DOMAIN! in a formula (FX returned null/Error inconsistently).
- **datetime** date-returning funcs (DATE/EDATE/DATEVALUE/WORKDAY) emit our serial, not a FX `Date`
  object (FX shares the 1900 epoch, so the value is right — just the wrapper type was wrong).
- **CONVERT** → our unit system (richer; FX errors on C→F). **NPV/IRR/MIRR/XIRR/XNPV** and
  **XLOOKUP/XMATCH** added to RANGE_FUNCTIONS so the list args pass whole; XLOOKUP/XMATCH (FX lacks
  them) registered as exact-match.
- **EXACT** now emits the logical type (TRUE/FALSE); **FIND/SEARCH** not-found → #VALUE! (Excel).

**The limitations, established for users** (formula popup engine-note + the Expression #SHAPE! message):
- **Formula scope = single values + 1-D lists.** A 2-D matrix/frame can't be a formula variable —
  that's a `#SHAPE!`. To run a formula over a TABLE, use the LAMBDA hosts (MAP / BYROW / BYCOL / REDUCE /
  MAKEARRAY): they iterate (per cell/row/col) and the HOST can output 2-D; the formula stays 1-D/scalar.
- **Node-only in a formula** (richer node UI or no clean formula form): XLOOKUP/XMATCH advanced match
  modes (basic exact match DOES work in a formula), the complex-number `IM*` functions (a `[re,im]`
  pair is indistinguishable from a 2-element list to the broadcaster — see the Expression cap), and
  matrix algebra (MMULT / MINVERSE / MDETERM / TRANSPOSE — 2-D).
- **Optional, deferred:** physically deleting the redundant native math for the formulajs-backed
  families (no behavioral effect — the sweep proved agreement).

### Cube polish + the table-verb decision (2026-06-25)
Follow-on session after the Cube shipped. Changes:
- **Nest Join (renamed from Relate).** "Relate" said nothing; the node is now
  `NestJoinNode` / catalog `nest-join` / label "Nest Join". It names the operation
  (tidyr `nest_join`) and pairs with the planned flat Join / Unnest. The
  `relateFramesToCube` helper keeps its name (internal, accurate).
- **Unified nested drill.** The cube popup is now a general nested-data viewer with
  ONE breadcrumb stack: clicking ANY nested container (cube / frame / list / matrix)
  drills in place — no second overlapping popup. Frame views format by column type;
  grid views render list/matrix cells (themselves drillable). `cubeCell.tsx`
  (CubeCellChip + frameCellNode) + `CubePopup.tsx`.
- **Cube glyph is author-drawn** (`assets/cube-socket-glyph.svg`), pulled into ONE
  source `components/cubeGlyph.tsx` (socket + legend + highlight all read it; tune
  `CUBE_SCALE` / stroke there). It's OVERSIZED past the 12-box so a hexagon reads
  the same size as the circle/square sockets — the socket SVG paints
  `overflow: visible` (the measured 12×12 span is unchanged, so cable endpoints stay
  put). Opaque matching seams + ring (`#6346a5`), unlike the grid socket's
  translucent embossed cross. The live socket nudges down 1px (`dy`); the legend
  doesn't. Chips read `[R×C×D Cube]`.
- **Two general fixes (not cube-specific):** socket dots now sit at `--node-socket-x:
  -6.5px` (centred on the card edge — the wrapper sits inside the 1px border, so the
  earlier -5/-6 landed inward; tuned live). Node titles clamp to **4 lines** (was 2),
  now that header centring is solid (`line-clamp` + `LABEL_MAX_HEIGHT`).
- **`formatScalar` hardened** to coerce non-numbers instead of `.toFixed`-throwing
  (a throw in render blacks out the app). Was hit by the Frame Input editor seeding
  its grid with raw text for numeric columns.

**Decision — the full table-verb set (author 2026-06-25):** build ALL of Join /
Nest / Unnest / Pivot / Unpivot (v1.0, the Polars era). Two distinct axes, easy to
conflate:
- **Nest ⟷ Unnest** = flat ⟷ nested (changes nesting depth, lossless). Frame ⟷ Cube.
  Nest Join already does Join+Nest in one; Unnest is its inverse (cube → flat joined
  table). A standalone Nest (group one flat frame by key into cells) is the other half.
- **Pivot ⟷ Unpivot** = long ⟷ wide (changes orientation, stays FLAT; pivot collapses
  detail via aggregation). Frame → Frame both ways. NOT the cube bridge.
So `Unnest(NestJoin cube) = flat joined table` (correct); pivot/unpivot is a separate
reshape, not the cube round-trip. See roadmap v1.0 + cube-node-scope.

### Cube SHIPPED end to end (2026-06-24)
The recursive container is live: value model + cached depth, two producers, the
upgraded INDEX accessor, the drill-in popup, and a seed. Full scope + the design
reasoning + a survey of nested-table features in other tools (and their user
frustrations) are in `docs/cube-node-scope.md`. Non-obvious bits:
- **Depth counts cube-in-cube ONLY.** A cube whose cells are frames is depth 1 (a
  frame is a leaf). Cached on the value via the single `makeCube` factory in
  `frame.ts`, read bottom-up. So a Nest Join result reads depth 1; depth climbs only
  when a cube is wrapped in a cube (Build Cube).
- **No "list of frames" socket exists** (the cube IS that type). So you can't have
  a generic "assemble a cube from many frames" node fed by one socket; the carrier
  would already be a cube. Hence the two producers: `Nest Join` (data-driven nest of
  two frames on a key) and `Build Cube` (extensible `any` cells -- multiple sockets,
  the variadic trick -- each row one cell, any value).
- **INDEX is now `any`-in/`any`-out** and reads a cell out of list/matrix/frame/cube
  (a nested frame/cube comes out whole). `any -> any` keeps every old INDEX cable
  valid. Reading by KEY is XLOOKUP's job (a frame/cube mode for it is the follow-up).
- **Dedicated `CubePopup`, not a TablePopup overload** -- the flat editor's per-cell
  `<input>` can't host drill-in cells. Frame/list cells open the table popup on top;
  cube cells drill in place with a breadcrumb. Depth shown in the header.
- **Tooling gotcha:** the Edit tool prepended a NUL byte before a non-ASCII char (an
  EMPTY-SET sentinel) in `frame.ts`, which made ripgrep flag the file binary and
  silently broke string matching. Keep code ASCII; if a NUL sneaks in, strip it with
  a byte-level pass. (The `NO_STATUS = "\x00"` in display.ts is a separate,
  intentional pre-existing sentinel.)

### Cube named + iconed (2026-06-24, decision only — build is a v0.9 item)
The v0.9 "finishes all socket types" item is named **Cube**: a frame whose cells hold ANY
value (recursive nesting — a cell can be a scalar/list/matrix/sub-cube), making it the
universal container so the socket lattice CLOSES. **Socket icon = a 3-diamond hexagon** (a
flat/isometric cube — hexagon split into 3 rhombi for top/left/right faces), to be added as a
new glyph in `SocketComponent.tsx`'s 12×12 SVG (alongside circle/square/split-square/2×2-grid)
+ a `SocketLegend` row. Shape decided = recursive nesting (NOT a fixed 3-D panel or multi-frame
workbook). Roadmap/backlog v0.9 item 4 has the full build scope.

### Frame Input is now a LITERAL source (2026-06-24)
Author bug: typing a Boolean column with both `1` and `TRUE`, then round-tripping
the editor, **forcibly rewrote `1` → `TRUE`** — an input node silently overriding
your values. Root cause: the editor coerced on SAVE (`buildFrameColumns`: `"1"`→`true`)
and re-formatted on RESEED (`toGrid`: `true`→`"TRUE"`), so the literal was lost.
Fix = separate the **edit/storage representation** from the **computed value**:
- **`frame.ts`**: the Frame Input now stores a raw `FrameSource` = `{name, type,
  cells: string[]}` per column — exactly the text you typed, never coerced.
  `deriveFrame(source)` produces the typed `FrameValue` (booleans, date serials) that
  flows downstream, at COMPUTE time (`coerceFrameCell` per type, sharing `coerceLogical`).
  `parseFrameSource`/`frameSourceToText` are the load/store; `frameFromInputText` =
  `deriveFrame ∘ parseFrameSource`. `parseFrameSource` reads the new `cells` JSON, an
  OLD typed-`values` JSON (stringified back to raw cells — old saves/seeds still load),
  and the hand-typed/legacy CSV (infer type, cells kept raw). No migration needed.
- **The editor toggle**: generalised the popup's date-only **Formatted/Source** toggle
  (`dateMode`→`displayMode`) to every literal-source column. **Source** = the raw text,
  EDITABLE (the truth); **Formatted** = the derived render (TRUE/FALSE, formatted dates),
  READ-ONLY preview. A literal-source editor opens in Source. Wired via a new
  `literalSource`/`onSaveSource` on the popup state + `source`/`onSaveSource` props on
  FrameChip/FrameDisplay; `FrameInputComponent` passes `parseFrameSource(frameText)` and
  saves via `frameSourceToText`.
- **Gotcha**: the node BODY (`FrameDisplay frame={cachedResult}`) still shows the DERIVED
  (formatted) frame — only the POPUP editor exposes raw vs formatted. `coerceFrameCell` is
  exported so the Formatted preview derives a cell without rebuilding the whole frame.
- **Principle (author, this session):** input nodes must not forcibly override what you
  type; coercion is the downstream/explicit job (Cast, read-as, deriveFrame at the boundary).
- **Source = the INPUTTED text, toggle ALWAYS shown (author, same day):** "Source" must be
  what was actually typed/imported, not a derived underlying form, and the button shows on
  EVERY frame popup (not column-dependent — it'll also drive per-column FC styling like
  numbers→percentages in v1.1). So `FrameColumn` gained an optional **`raw?: string[]`** —
  the inputted text per cell, BEFORE inference rewrote it (a date → a serial, "1"/"true" → a
  boolean). `inferColumn` populates it (→ every CSV File / Web Source / Import HTML·XML frame
  carries it), and `deriveFrame` carries the Frame Input's literal cells. The popup's Source
  view shows `state.sourceCells` (row-major raw, passed by FrameChip) verbatim; only a column
  with NO source text (a purely computed column) falls back to the underlying form (serial,
  1/0). Every frame node renders through the ONE `FrameDisplay` → popup, so this is one place.
  **Gotcha — keep `raw` aligned:** a transform that changes a column's values must drop or
  remap `raw` or the Source view misaligns. Fixed the three column-reconstructing spreads:
  Filter (`control.ts`) and Get Row (`nodes/frame.ts`) REMAP raw to the surviving/picked rows
  (so a filtered import still shows its source); Add Column's replace DROPS it (computed data).

### Text → boolean parse path (2026-06-24) — closes the logical type at the boundary
The logical type rendered/coerced/flowed everywhere except the TYPE BOUNDARY: there
was no way to PARSE text into a logical, and a logical frame column could only exit as
number (1/0) or text ("TRUE"/"FALSE") — never as a real logical list. Two entry points,
ONE shared parser:
- **`coerceLogical(v)` in `valueKinds.ts`** (the logical-type home, beside
  `numberToLogical`): boolean passthrough · "TRUE"/"FALSE" case-insensitive/trimmed ·
  a number or numeric string via the `numberToLogical` 0/1 bridge (0→FALSE, nonzero→TRUE)
  · else `null` (unparseable). The CALLER decides what `null` means.
- **Cast → "Boolean"** (`cast.ts`): a `logical` target → `logicalComboOut`. `castOne`
  calls `coerceLogical`; a `null` (the value was non-null but unparseable) returns the
  existing **`NaN` failure sentinel** — KEY trick: a logical SUCCESS is a `boolean`, which
  is never a number, so `castFailed`'s `typeof===number && isNaN` reads success-vs-failure
  unambiguously with NO new sentinel. Fail → `#VALUE!`, like every other Cast target.
- **Get Column read-as "Boolean"** (`frame.ts`): `GetColumnReadAs` gains `logical` →
  `logicalListOut`; the column reads OUT as booleans (a 0/1 mask or true/false text
  coerces). Here `null` from `coerceLogical` is LENIENT-missing (no boolean NaN; a
  missing cell reads cleaner than a fabricated FALSE) — vs Cast's strict `#VALUE!`. That
  split (explicit Cast = strict/tagged, read-as = lenient/best-effort) MIRRORS the
  existing number/date read-as, which NaNs a bad cell rather than erroring.
- **Alignment story (what the author asked to verify):** (1) the SUCCESS parse is
  identical across Cast and read-as because both call `coerceLogical` — no drift. (2) It's
  deliberately MORE liberal than column INFERENCE (`isLogicalCell` in frame.ts only
  auto-types all-TRUE/FALSE so a 0/1 mask stays numeric for the multiply-trick); once the
  user opts in by Casting/read-as, 0/1 is fair game. (3) Failure handling matches each
  node's SIBLINGS (Cast siblings all `#VALUE!`; read-as siblings all lenient). (4) Display
  is free — `formatListCell`/`DisplayValue` already render a boolean as TRUE/FALSE. (5)
  `applyCastTarget`/`applyGetColumnReadAs` already swap the socket + `retypeOutputCables`,
  so the logical↔number bridge keeps a Cast→Boolean wired into a number input connected.
  **Remaining:** the reverse — Add Column **add-as** logical — to write a logical list
  back into a frame as a logical column. Small; not a v0.9 blocker.

### Node-name + search consistency pass (2026-06-24)
Addressed "full pass on node names and IDs for consistency and searchability."
There are FOUR name surfaces per node and they drifted: the rete `super("…")` id
(save format), the default `this.label` (header), the Add-menu catalog label, and
the class-derived hover hint (`nodeTypeName` = constructor.name split). Changes:
- **Search now matches category + type id + keywords** (`catalogSearch.ts`, pure +
  tested). Was label+description+Excel only, so a CATEGORY/concept query found
  nothing — "arithmetic" → 0 (its leaves are Add/Subtract/…), "table input"
  couldn't rank the "Table" leaf. The searchable haystack + the tiered bonus now
  include the ancestor category path (so "table input" exact-matches "Table Input"),
  the kebab `type` id, and a new optional `keywords` field on `NodeCatalogEntry`.
- **Input nodes → "X Input"** (author decision): Number/List/Text/Boolean/Table/
  Frame Input, in BOTH default `this.label` and the menu label. Table/Frame/Boolean
  now also match their class hint; Scalar/String/List keep a hint divergence (class
  names ScalarInput/StringInput/ListLiteral) — gave them search `keywords`
  (scalar/string/literal) so the old term still finds them.
- **Default label = menu label for 14 standalone nodes** (audit-driven): mostly
  ALLCAPS→Title casing drift (FIBONACCI→Fibonacci, VSTACK→VStack, NORMALIZE→
  Normalize, SHUFFLE→Shuffle, …) + Angle→Angle Dial, Date→Date Picker, MRound's
  "Rounding"→MROUND. So a placed node's header reads like the menu entry clicked.
  Left intentional: op-family nodes (default=family, menu=variant — BYROW vs
  "BYROW / BYCOL"; IFERROR vs "IFERROR / IFNA") and multi-output/instance cases
  (Table Info, Conduit N).
- **The model (author's, from the FC-arch session):** the HINT (hover / status-bar
  type-name) is the ANCESTOR/family ("Arithmetic"); a cleared header title falls
  back to `nodeName` = the op-aware catalog label = the SPECIFIC variant
  ("Multiply"), surfaced in Navigator / cable inspector. Kept as-is.
- **Singleton hint reconciliation — DONE (2026-06-24).** Renamed the three classes
  whose hint diverged from their friendly label so the hint now EQUALS the label
  (author: "List Literal isn't user-friendly, no Excel muscle memory governs it"):
  `ScalarInputNode`→`NumberInputNode`, `StringInputNode`→`TextInputNode`,
  `ListLiteralNode`→`ListInputNode`. Persistence keys on `constructor.name`, so the
  saved node `type` changed too — updated 14 seed JSONs (60 refs), the PF generator
  `.cjs`, and an example asset; the `super()` ids and the two inconsistent catalog
  type-ids (`scalar`→`number-input`, `list-literal`→`list-input`) were aligned in the
  same pass. Component files/exports renamed to match. No compat shim (pre-alpha
  rule). Kept the `scalar`/`string`/`literal` search keywords for muscle memory.

### Scalar/list error tagging made UNIFORM across element-wise math (2026-06-24)
Follow-through on "I do want total consistency on the scalar list errors." The
array-semantics relaxation (2026-06-22) said lists carry per-cell `SolError`s, but
six element-wise nodes still had the OLD "errors stay scalar-level" code — a scalar
error condition tagged a `SolError`, but the same condition inside a list collapsed
to NaN/null (surfacing as `#N/A`/blank). Now uniform:
- **Mechanism:** added `broadcastErr` next to `broadcast` in `nodes/shared.ts`. Same
  broadcasting, but the element fn may return a `SolError`, and a `null` is NOT
  coerced to NaN. Call-sites map the producer's domain-`null` sentinel with
  `?? errFactory()` (note `??` only catches null/undefined, so a legit `0` survives).
  `broadcast` is unchanged and still NaN-collapses — keep it only where a bad element
  is a genuine blank, not an error.
- **Converted:** `ArithmeticNode` (÷0, done in the prior commit), `MathFnNode`
  (domain → `#DOMAIN!`), `TwoInputMathNode` LOG (domain → `#DOMAIN!`, was a silent
  null even at scalar), `StandardizeNode` (σ=0 → `#DIV/0!`), `FisherNode` (domain →
  `#DOMAIN!`), `ConvertNode` (overflow → `#RANGE!` per cell; cross-family `#N/A`).
- **Whole-node vs per-cell:** Convert's cross-family unit pick (km→kg) is a NODE
  mistake, not a per-cell condition, so it stays a SINGLE `#N/A` for a scalar OR a
  whole list — no point per-celling it. Everything else is per-cell.
- **Display:** widened the local `Displayable` alias in `standardNode.tsx` to the
  array-with-errors/nulls shape (`ValueDisplay`/`DisplayValue` already rendered it;
  only `makeNodeComponent`'s accessor type was narrow). cachedResult fields widened
  on all six nodes. tsc + 1077 vitest green (+6 new list-error tests).
- **Known remaining (not a gap, by design):** `broadcast`-based nodes with NO error
  case (RoundN, Gcd, Clamp, hypot, MRound) are untouched — their per-element `null`
  is unreachable/legit-blank, not an error.

### Three UX fixes + a scrapped task (2026-06-24)
Author's batch after reviewing the v0.9 finish list:
- **Popup-grid error red-badge — SCRAPPED.** Author is fine with the grid showing an
  error cell as plain `#DIV/0!` text. Removed from the v0.9 finish list (roadmap +
  backlog struck through, not deleted).
- **List ÷0 now tags a per-cell `#DIV/0!`** (was `#N/A`). A scalar a÷0 returned a tagged
  `#DIV/0!`, but `ArithmeticNode`'s element-wise (list/list) path ran through `broadcast`,
  which collapses a per-element `null` to `NaN` → surfaced as `#N/A`. Inconsistent with both
  the scalar case and the table+Map path (which already tag per-cell). Added a `broadcastErr`
  sibling in `nodes/shared.ts` whose element fn may return a `SolError`, and routed
  div/mod/quotient ÷0 through it. The old "errors stay scalar-level" comment predated the
  2026-06-22 array-semantics relaxation. **Known parallel, NOT fixed:** `MathFnNode` domain
  errors (sqrt(−1), log(0)) still go per-cell `null` in a list while tagging `#DOMAIN!` at
  scalar — same class of inconsistency, deferred (not reported, larger surface).
- **Tab no longer hijacks focus inside a node.** Tab is the declutter hotkey
  (`toggleAllChrome`), but it's also the browser's focus key. The `editable` guard let
  inputs through, but a focusable NON-input inside a node (a button, the chevron) fell
  through to the toggle — so Tab inside a node randomly tabbed out and collapsed the chrome.
  Now Tab only toggles chrome when focus is on the canvas **background** (`target` is
  `body`/`documentElement`/null); on any control it does native focus traversal.
- **Node-budget meter folded into the status bar.** Was a separate floating pill; now the
  footer's node counter reads `N / 100 nodes` (web demo only) with a slim inline fill bar
  behind it, coloured by level. The one-time over-budget modal moved into `StatusBar` too,
  rendered as an App-level sibling (NOT inside the strip — its `backdrop-filter` would trap
  the modal's stacking context below it). Deleted `NodeBudgetMeter.tsx/.css`; desktop shows
  the plain count.

### Milestones set: v0.9 / v1.0 / v1.1 (2026-06-24)
Named three release milestones and restructured `roadmap.md` around them. **v0.9** =
the web-demo era frozen — the Excel-alternative layer (array semantics, polyform, socket
lattice, ~150 nodes, theming, load reveal) plus this session's perf hardening + node
budget; essentially done, short JS-only finish list before tag (error-cell red-badge,
text→boolean parse, pinch-zoom). **v1.0** = the first DESKTOP release and the big spine:
Tauri/Rust shell + native Polars relational engine + **the full Power-Query verb set
including Join** (author decision — an engine without Join isn't worth shipping) + the
WebGPU renderer; the old Phases 0–3 became v1.0's Phases A–D, with the renderer as Phase
D. **v1.1** = the deferred tail (FC redesign, node packs + dormant-pack persistence,
Obsidian sync, grid system, cable collision avoidance, hideable chrome, image bundling,
finance connection, smaller polish). Backlog top now points at the roadmap as milestone
authority; the stale "v1 ship blockers" section relabeled "v0.9 blockers (all done)".
**v0.9 finish list refined (author 2026-06-24):** popup-grid error red-badge (repro +
fix-site recorded in roadmap: `TablePopup.tsx` `toGrid` stringifies `SolError`, losing
the badge), text→boolean parse, **Formula.js↔native consolidation finished in v0.9**
(not opportunistic), and **FC ARCHITECTURAL work in v0.9** (passthrough-inputs carry
units, docked-FC movement pass, multi-hop annotation, formatted/source toggle, function
model) — **FC aesthetics/layout + SegToggle stay v1.1**. Pinch-zoom deferred to v1.1.

### Renderer plan FINALIZED + web-demo node budget (2026-06-24)
Two things this session. (1) **`docs/renderer-plan.md`** fixes the outline for the deferred
renderer swap so there's no question when we proceed: target = WebGPU + WebGL2 fallback in
the webview, hybrid (DOM only for the active node), **feature-gated with the rete DOM
renderer as a permanent universal fallback — never a hard replacement.** That safety rule is
forced by a web-research finding (5 agents, primary sources): Tauri uses the OS webview, and
**WebGL2 is genuinely flaky in Linux WebKitGTK** (three.js/MapLibre "context lost" / blank
canvas, esp. NVIDIA+X11 — [tauri#6559](https://github.com/tauri-apps/tauri/issues/6559), still
open; the blank-window env-var mitigations *disable* GPU accel), and **WebGPU is absent on
Linux/WebKitGTK** (maintainer: for cross-OS WebGPU "we're better off with electron"). Windows
WebView2 = good (WebGL2 default-on; WebGPU behind `--enable-unsafe-webgpu` via
`additionalBrowserArgs`); macOS 26+ = WebGPU out of the box (OS-bound); the **web demo on real
browsers is the best case.** Phased: cables→canvas first (most isolated, reuses `cablePaths.ts`).
**Shell decided: stay Tauri** (not Electron). Current desktop target is **Windows only**, and
on Windows Tauri's webview IS Chromium (WebView2) — so it gives the identical GPU story Electron
would (WebGL2/WebGPU/DevTools) at a fraction of the footprint, keeping the Rust backend
first-class. The Tauri-vs-Electron GPU argument is a Linux/old-macOS argument, moot while we ship
Windows. Revisit only if we commit to Linux/mac desktop AND light up the GPU renderer there (same
trigger as the native-wgpu escape hatch). See `renderer-plan.md` "Shell: Tauri vs Electron".
(2) **Web-demo node budget** (`nodeBudget.ts` + `NodeBudgetMeter.tsx`): web-demo-only soft cap
(200 nodes — above the 140-node PF seed, below the ~280 choppy zone) with a meter above the
status bar + a one-time modal on the crossing (edge-detected, suppressed during load reveal).
Soft only, nothing blocked; desktop renders neither. Count polled like StatusBar (path-agnostic).

### Performance arc — CLOSED OUT (2026-06-24). Read `performance-hardening.md` "FINAL VERDICT" before touching pan/zoom.
The multi-round perf push ended with a definitive empirical conclusion. **The real,
permanent wins:** the paste / bulk-delete / undo-redo **hangs were genuine O(N²) bugs**
(per-item `connectioncreated`/`noderemoved` settle = full processGraph per cable/node) —
all fixed by gating (`withGraphRebuild` + one settle). Plus targeted recompute
(`processGraph(changedNodeId?)` → render only the downstream cone), parallelized load,
and a row of **Settings ▸ Performance** toggles. **Dense-graph ZOOM, however, is at the
DOM/rete renderer floor — proven, not guessed:** content reduction (delete charts,
direct/opaque cables, hide grid/minimap, drop chrome) was *all negligible*, AND
render-resolution scaling (≤16× smaller bitmap) *didn't help* — so the cost is neither
paint nor raster; it's compositing the ~5k-element layer structure, which no CSS/
content/transform trick can touch (DOM has no render-resolution knob — only canvas does).
**Reverted dead ends (don't retry): D1** (pan holder-promotion → border resampling),
**`--zooming` quality drops** (worse on the *promoted* desktop-zoom path — quality drops
belong only on the un-promoted `--panning` path), **mobile holder promotion** (bbox×DPR >
mobile GPU max texture → tiling), **resolution scaling** (browser rasters at effective
on-screen scale, defeating the trick). **Only remaining lever = a canvas/WebGL renderer
swap** (bounded: replace rete's render+area plugins, keep node model + DataflowEngine +
all domain logic) — greenlight when zoom-at-scale is a real blocker, not a stress test.
**Externally corroborated (2026-06-24 web research, see `performance-hardening.md`
"External corroboration"):** the React Flow core dev and co-founder both say large DOM
graphs hit "the limits of what browser compositing is capable" and recommend a
"webgl/canvas based renderer"; Rete's own answer to thousands of nodes is a Pixi/WebGL
LOD example. The DOM-level fixes others recommend target re-render storms / node-count /
style cost — all of which our experiments already excluded — so we didn't quit early. The
swap's pragmatic shape is **hybrid** (WebGL geometry + DOM only for the actively-edited
node), per kookie-flow / infinit-canvas / tldraw's own overlay→canvas migration. One
cheap pre-swap check: a Chrome perf trace confirming Composite Layers (not Recalc Style /
React commit) dominates the zoom frame.

### Performance hardening — IMPLEMENTED (2026-06-24)
Shipped the hardening from the investigation below as 8 isolated commits (branch
`claude/mobile-function-reference-ux-lzk3r6`): **C1** gate paste's connection loop
(crash fix) + `bulkSettle`; **C2** `withGraphRebuild()` + dirty-flag, gate undo/redo;
**B1** parallelize the load build loop; **B2** de-serialize `processGraph`'s render
loop; **A1+A2** `processGraph(changedNodeId?)` — targeted engine reset + render only
the downstream cone (wired at InlineInputs + slider; `processTargeted.test.ts` guards
the cone; opt-in so un-migrated call sites keep full-reset); **A3** early-cutoff within
the cone; **D1** GPU-promote the holder on a plain desktop pan (unified
`onViewportActivity`); **D2** drop the selected-Conduit drop-shadow during pan. **D3
(chunked shared-SVG cable layer) DEFERRED** — profile-gated (author 2026-06-24): it's a
large rewrite of the 735-line ConnectionComponent and D1 likely captured most of the
pan-paint win; revisit only if a post-D1 profiler trace still fingers the cable layer.
Detail + ladder in [`performance-hardening.md`](performance-hardening.md).

### Performance hardening investigation (2026-06-24)
Investigated the three observed symptoms — slow load (~2s for the 140-node/135-cable PF
seed), pan/zoom stutter even when idle, and a hard tab crash on select-all + copy-paste
into itself. Full write-up + sequenced investment ladder in
[`performance-hardening.md`](performance-hardening.md). Key conclusions:
- **The crash is a bug, not a scale limit.** `pasteClipboard` (`copyPaste.ts`) never wraps
  its add loops in `beginGraphRebuild()`/`endGraphRebuild()` the way `rebuildGraph` does, so
  every one of the ~135 `addConnection`s trips the ungated `connectioncreated` pipe
  (`Canvas.tsx:2272`) → a full `processGraph()` per cable → O(N²) main-thread freeze. **Fix:
  gate paste (and every bulk-mutation site).** Highest-ROI change.
- **Load is the build loop + final render-all, NOT the cinematic** (author: load is slow even
  when the reveal doesn't run). Levers: parallelize the 2N sequential `addNode`/`translate`
  awaits; de-serialize the final per-node `area.update` loop.
- **The big compute bet is a dirty-set.** rete's `engine.reset(nodeId)` already invalidates
  *downstream successors only* (verified in source — its JSDoc says "predecessors" but the code
  resets successors); we call the argument-less wipe-all instead. Targeted reset + render-only-
  dirty + salsa-style early-cutoff = stop recomputing/rendering the world on every edit.
- **Pan/zoom is paint-bound and nearly floored.** Confirmed no JS re-render on idle pan (path
  cache + silent store subs); cost is browser paint/composite of visible cables. Author's notes
  confirmed: **viewport culling was tried and didn't help** (cost is in-viewport), and a
  **`<canvas>` cable layer was tried and reverted** (2026-06-19 `cableCanvas.ts` — canvas
  full-clears every frame so it's a wash vs SVG's change-only re-raster, plus an AA colour-shift
  that violates "cables never change appearance"). The cheap wins (bounded SVG bbox, shadow-drop,
  flow-pause, path cache) are already in. Only untried idea: collapse N per-cable `<svg>` into one
  shared SVG (fewer layers, still SVG so no colour shift). Least tractable of the three — needs a
  profiler trace on the real build before any larger spend.

### Expression node — scope capped permanently at the type-agnostic subset (2026-06-23)
Author decision, closing the "should Expression support complex / 2-D / type-directed
formulas?" thread: **no, and never.** `ExpressionNode` (plus LAMBDA and the lambda-consumer
formulas — anything routed through `excelFormula.ts`) is FROZEN at the type-agnostic subset:
scalars and 1-D lists, broadcast element-wise. It will not grow:
- **2-D (matrices/frames)** — already blocked: `expression.ts:147` mints
  `#SHAPE!` ("A matrix can't go into an Expression yet — use MAP or REDUCE over the table").
  That block is now permanent, not a "yet".
- **Complex numbers** — the `Cx = [re, im]` representation is indistinguishable from a
  2-element list to the formula broadcaster (`Array.isArray`), and complex arithmetic is
  type-directed (it needs to KNOW a value is complex to pick `cxMul` over element-wise `*`).
  The type-agnostic evaluator can't carry that without a branded value + a type pass —
  which is exactly the line we're declining to cross.
- **Any type-directed semantics** generally.
The escape hatch for all of it is the **future subgraph / composite node**
(`docs/pack-architecture.md` "Composite pack node (a subgraph / macro node)") — an
encapsulated graph with a declared socket boundary, where the real typed engine (nodes)
does the work. So the rule for future agents: don't widen Expression to close an
Excel-parity or capability gap; add a node, or point at the subgraph feature. Recorded as a
governing one-liner in `CLAUDE.md` and in the Expression catalog `description`.

### EXCEL_FUNCTIONS registry — seam wired + a first wave of native impls (2026-06-23)
The registry foundation (Increment 1: `FAMILY_BACKING` policy + the
`resolveExcelFunction`/`registerInternal` seam) already existed but was inert —
`dispatch` still called Formula.js directly and no impls were registered. Activated it
(author: "scaffold ~5-6 functions across the breadth"):
- `excelFormula.ts` `dispatch` now routes through `resolveExcelFunction` — a registered
  native impl wins, everything else still falls through to Formula.js (behaviour-
  identical for those; full suite unchanged at 1061). This is the seam that lets the
  typed-formula path and the nodes eventually share one impl per function.
- Registered a first wave (`excelFunctions.ts`): overlap functions owned for a reason —
  **ROUND** (Excel round-half-AWAY-from-zero — the audit's flagged edge), **SQRT** (a
  tagged `#DOMAIN!` on a negative, where Formula.js returns a bare Error), **STANDARDIZE**
  (a "keep internal" stat), **YEAR** / **EOMONTH** (Solenoid's date-serial model), **LEN**
  (string→number) — PLUS Solenoid-only ones with NO Formula.js equivalent: **CLAMP**
  (number), **ORDINAL** (number→string), **BETWEEN** (logical). The registry thus ADDS
  functions to the formula language, not just overrides. Output types span number / string
  / date / logical — the scalar types the evaluator carries unambiguously; **complex is
  excluded with 2-D** (a `[re,im]` tuple is indistinguishable from a list to the
  broadcaster). `EXCEL_IMPL_META` declares each impl's `returns` + arity (+ `native`), and
  `FORMULA_FUNCTION_NAMES` unions the registry names so the autocomplete/highlighter know
  the Solenoid-only ones.
- Gotcha: the app's error codes are a fixed `SolErrorCode` set — there is **no `#NUM!`**;
  a math-domain error is `#DOMAIN!`.
- Still NOT done: Formula.js→`SolError` mapping for the library half; the rest of the
  internal families; routing the NODES through the seam; deleting redundant native math
  on a family flip. See `docs/formulajs-vs-native-audit.md` + the backlog item.


### Formula engine made EXPLICIT: Expression/Lambda run on Formula.js, not our nodes (2026-06-23)
Author flagged the real smell (already audited in `docs/formulajs-vs-native-audit.md`):
the app has TWO parallel function engines — the ~150 native nodes (hand-rolled) and
**Formula.js**, reached ONLY via `excelFormula.ts → dispatch`. So a function typed in
an Expression/Lambda runs on Formula.js, NOT the matching node's `data()`, and the two
can diverge (the audit flags stats, dates, units, and error/null handling). Chose the
"make it explicit" option (the floor) over the big "switch to a native evaluator":
- Formula popup now carries a persistent muted note: "Functions run on Formula.js …
  separate from the visual nodes — results can differ for stats, dates, units, errors."
- Expression + LAMBDA catalog descriptions (→ Add menu + Function Reference) say the same.
- **The "switch" path is the parked `EXCEL_FUNCTIONS` registry project** (audit §4): one
  registry both the formula path and the node call, + a Formula.js→`SolError` mapping —
  prerequisites, no build commitment. Not started; this just discloses the current reality.


### Formula editor: syntax highlighting + fuzzy autocomplete (2026-06-23)
Built lightweight (no CodeMirror) for the shared formula input — so it lights up
Expression, Lambda, AND the whole lambda-consumer family (MAP/BYROW/BYCOL/REDUCE/
MAKEARRAY), all of which edit through `FormulaPopup`.
- `excelFormula.ts` now exports `FORMULA_FUNCTION_NAMES` (every Formula.js
  dispatchable name, `Object.keys(FX)` filtered to UPPERCASE functions).
- `formulaSyntax.ts` (pure, tested): `highlightFormula` — a position-LOSSLESS
  tokenizer → classed spans (function / unknown-call / variable / constant / number
  / string / operator); `tokenAtCaret` + `suggestFor` (fuzzyScore over functions +
  constants + the node's own variables; a fully-typed FUNCTION still suggests to add
  its `(`, a fully-typed constant doesn't). Variables colour amber — they become
  input sockets; an unknown call colours red (a typo, or a future lambda variable).
- `FormulaEditor.tsx` — the classic overlay: a transparent `<textarea>` (real caret
  + selection) layered exactly over a coloured `<pre>` mirror (identical font/padding/
  wrapping/tab-size or they drift). Autocomplete menu drops below; ↑/↓ navigate,
  Enter/Tab accept, dismisses when the word stops matching. Caret restored after an
  accept via a `pendingCaret` ref + `useLayoutEffect` (the value is controlled).
- Wired into `FormulaPopup` (replaced the bare textarea); passes the formula's
  `extractVariables` as extra suggestions. **Interaction-only — verify on the deploy.**
- NOT done: caret-anchored menu (it's below-field for v1); FormulaField's inline
  click-to-edit path still uses a plain textarea (everything routes to the popup).


### IsCheck renamed → IS.TEST; SWITCH match is exact equality (2026-06-23)
- **Rename (author hated "IsCheck"):** class `IsCheckNode` → `IsTestNode`, `IsCheckOp`
  → `IsTestOp`, component → `IsTestComponent` (`IsTestNode.tsx`), catalog type
  `ischeck` → `is-test` + label `Test` → **`IS.TEST`** (also the default node label),
  `nodeExcel` key, `SEES_ERRORS` constructor-name string, kind/registry/index. Seeds
  (`null-and-logical`, `error-codes`) + tests updated; no persistence alias (pre-alpha
  — old saves with `IsCheckNode` load-skip). The op VALUES (`isnumber`/`islogical`/…)
  are unchanged for save compat.
- **SWITCH equality:** dropped the float-tolerance branch — match is now plain `===`
  across every type (Excel SWITCH is exact). Removes the "a date serial IS a number"
  special case: dates are a distinct type from numbers in this app, so SWITCH compares
  them the same uniform way as text/booleans.

### Value-selectors: `any` passthrough + logical conditions (CHOOSE/SWITCH/IFS/IFERROR) (2026-06-23)
Extended the IF treatment to the rest of the selector/passthrough family (author):
a node that SELECTS or passes a value through (doesn't transform it) takes `any` for
its value slots and emits `any`, and a CONDITION slot is logical.
- **IFS:** `cond*` → `logicalIn`, `val*`/`otherwise`/result → `any`. Condition test is
  `!isMissing(c) && truthy(c)` (shared `truthy` — the coerced boolean OR a raw 1).
- **SWITCH:** `expr`/`when*`/`then*`/`default`/result → `any`. Match is a general `eq`
  (number tolerance — a date serial IS a number; else strict `===`) so it matches text
  / dates / booleans, not just numbers.
- **CHOOSE:** `v*`/result → `any` (`index` stays a number).
- **IFERROR/IFNA:** `value`/`fallback`/result → `any`; `replaceCaught` was already
  type-agnostic (swaps only caught error cells), so just the sockets changed.
- IS.TEST (`IsTestNode`) was already `anyIn` (it's a transform → logical), so untouched.
- All become wire-only for the value slots (no inline literal for `any`/logical), per
  the IF decision. `cachedResult` widened to `unknown`; components cast to `DisplayValue`.
- Numeric literal-driven defaults (the SWITCH/IFS demo seeds) compute exactly as before.

### IF node sockets: logical condition + `any` value passthrough (2026-06-23)
The IF node had `numListIn` for all three inputs + a `numListOut` — wrong on both
counts (author): the **condition** is a boolean (now `logicalComboIn`, purple; the
logical↔number bridge still lets a 0/1 number or a comparison drive it), and
**then/else** just SELECT a value through (IF doesn't transform) so they're `anyIn`
with an `anyOut` result — a number / text / date / list rides through unchanged.
- **Gotcha:** with the logical socket, `coerceInputs` delivers a real BOOLEAN to
  `data()` (`numsToBools`), so the old `x !== 0` test was wrong (`false !== 0` is
  `true`!). Replaced with a `truthy(x)` = `x === true || (number && x !== 0)` that
  handles both the coerced boolean and a raw 0/1 literal.
- `broadcastEl` was generalized from `(number|null)` to a generic element type so it
  can carry `any` values (its runtime walk was already type-agnostic; only the
  signature was narrow). All other callers infer the same `number|null` as before.
- **Trade-off:** `InlineInputs` only renders an editable field for number/string
  sockets, so IF's inputs are now wire-only (an unwired input falls back to its
  literal 0). Expected for `any` — you wire the condition + values.

### ISBOOLEAN (ISLOGICAL) → pure type test (2026-06-23)
Was `typeof x === "boolean" || x === 0 || x === 1` — so `1` classified as BOTH a number
(ISNUMBER) and a boolean (ISBOOLEAN), while `"TRUE"` (text) was neither boolean. Author
chose the consistent fix: the IS-checks PARTITION by actual runtime type, no overlap, so
ISBOOLEAN is now `typeof x === "boolean"` only — rejects 0/1 (numbers) and "TRUE"/"FALSE"
(text). Matches Excel ISLOGICAL (now `parity: true` in nodeExcel.ts). The 0/1 acceptance
was a pre-first-class-logical artifact (when booleans WERE 1/0 numbers; Boolean Input /
comparisons / BooleanOp now emit real booleans). bool↔number coercion stays a separate
socket-boundary concern. Updated logic.test.ts + null-logical-verification.md.

### FC unit-locking: a locked format/unit rides through passthroughs (2026-06-23)
Author clarified the intended model: **an FC LOCKS a format+unit onto the value, and
that lock rides through every passthrough box (Display, FC, "anything similar") in the
chain — only UNLOCKING when the value enters a transformative node.** The gap: a
downstream Display only showed the unit if it had its own trailing FC (`…→FC→Display→FC`
worked, `…→FC→Display` didn't).
- `unitFlow.makeAnnotationResolver(editor)` — parallel to the unit resolver but carries
  the whole `FormatAnnotation`: an FC locks its own (`FormatControllerNode.annotation()`,
  extracted from `refreshAnnotation`), a `passesUnitThrough` node carries it across
  unchanged, a Convert (unit transform) or any other node DROPS it.
- `DisplayNode` now renders `getForNode(id) ?? resolver.inAnnotation(id,"in")` — a direct
  (docked / trailing-FC) annotation still wins, else it shows the locked inbound one.
- The Note's output `FieldRow` renders the FC annotation an UPSTREAM FC writes onto it
  (the FC formats the box behind it = the note field) — the upstream half of the lock.
- **Scope shipped = downstream + immediate box-behind.** Two follow-ups in backlog: (a)
  upstream multi-hop (a Display two hops above the FC); (b) **passthrough INPUTS** — mark
  selector nodes (IF/CHOOSE/SWITCH/IFS) so a selected `$12` keeps its unit (IF isn't a
  transform). Both recorded under backlog "Format Controller".
- Tests: `unitFlowAnnotation.test.ts` (lock rides a passthrough, breaks at a transform).

### Note hardening + frontmatter → typed output sockets (2026-06-23)
Two backlog items, done together.

**Hardening (convergence audit).** Ran a full sweep for Note special-case sites
(DOM-root class gates, `instanceof` switches, type/kind branching). Verdict: the
divergent-Note surface is far MORE converged than the backlog feared — the
recurring offenders it named are all already fixed (right-click gate uses
`area.nodeViews` containment; minimap paints the note's own palette slot at
`Minimap.tsx:83`; Tidy super-node; mobile drag). Most audit "bugs" were false
positives: they assumed a socket-less node has `undefined` outputs (crash), but
rete inits `outputs` to `{}` and every call site already guards with `?? {}` +
truthiness (`canPin`, `pinNodeValue`, endpoint enumeration are safe no-ops). The
ONE real bug: the lasso-start gate (`Canvas.tsx`) used a hard-coded
`.solenoid-node, .solenoid-conduit, …` class list that omitted `.solenoid-note`
and `.solenoid-group`, so a touch on either in select mode began a lasso.
Fixed by switching to `area.nodeViews` containment (the authoritative root test
per CLAUDE.md) — covers every root + the sockets inside them, so no future root
can be missed. Declared hardening converged; did NOT add an `isAnnotationNode`
predicate (author: existing guards are already safe, don't abstract for its own
sake). The "minimap-Note-color" backlog line was already stale (fixed in code).

**Frontmatter → typed output sockets (the upgrade).** A Note body may open with an
Obsidian-style `---`-fenced YAML block; each key becomes a typed OUTPUT socket, so
a Note doubles as a typed-record / constants source. Built in three chunks:
- `noteFrontmatter.ts` — pure parser of a small YAML subset (scalar `key: value`,
  inline flow arrays `[a, b]`, block lists) → ordered typed fields + the markdown
  body below the block. Field-type names ALIGN with `SocketDataType` so the node
  maps them by identity. Type guess: bool→logical, int/float→number,
  `YYYY-MM-DD`→date(serial), quoted→string, array→list of the first element's type.
- `NoteNode` (`annotation.ts`) — `syncFields()` reconciles one output socket per key
  (add / remove / retype), `data()` emits each value, a per-key `fieldTypes` override
  is persisted (round-trips via `extractInit`; deep-copied on clone) so a value edit
  doesn't silently re-type a pinned socket. Values coerce to the chosen family.
  `syncFields` returns removed/retyped keys so the caller drops dangling cables.
  Outputs build in the constructor so connections restore on load.
- `NoteNode.tsx` — a fields strip between header and body: per key a Socket Legend
  type-glyph (opens an override picker — the four element families at the field's
  dimensionality), the key, a value preview, and the output socket dot straddling
  the right edge. **Socket-layout fork resolved:** the strip is OUTSIDE the
  `overflow:hidden` content; each row is `position:relative` so a plain `NodeSocket`
  (no explicit top) centers via its `50%` fallback and `right:-5px` straddles the
  note edge (padding on the row doesn't move its outer edge → no measure needed).
- **Commit-on-blur:** sockets reconcile on the textarea's BLUR, never per keystroke,
  so editing the YAML doesn't churn cables mid-type (the edit-on-Enter/blur rule).
- **Key-rename fork:** a renamed key = a new socket key → its old cable drops
  (pre-alpha-acceptable, as the backlog flagged). A plain note (no frontmatter)
  keeps zero sockets and `{}` data, exactly as before.
- **Follow-up fixes (same day):** (1) the UI read `data.data()` for its preview, but
  installErrorGuards rewrites data() into `(inputs)=>…` and runs firstInputError
  OUTSIDE its try/catch — calling it with no args threw and blanked every note;
  added `NoteNode.fieldValues()` to bypass the wrapper. (2) Collapse hid the fields
  strip (and its sockets), orphaning wired cables — a data note now collapses TO its
  fields (hides only the prose). (3) Mobile edit flicker: a tap blurs the textarea,
  then the same gesture's click falls through onto the read view → re-enter; guard an
  enter-edit click within 300ms of a blur. (4) **Type propagation on retype:** a
  retype keeps a cable when the downstream input still accepts the new type (an `any`
  input always does), AND must re-adapt downstream Format Controllers so they stop
  formatting by the stale type (date→number can't stay date-formatted). Extracted the
  Canvas connection-event FC sweep into `fcReconcile.ts` `reconcileFcTypes(editor,
  area)` and call it from both Canvas and the Note's commitFields — no connection
  event fires on a pure retype, so the Canvas pipe wouldn't otherwise run.
  (5) **Generalized retype propagation to ALL in-place output retypes.** Cast target,
  LAMBDA/Expression result type, and Get Column read-as all swap an output socket in
  place and used to drop EVERY cable without re-adapting FCs — same bug class. Added
  `fcReconcile.retypeOutputCables(editor, area, nodeId, outKey)`: reads the new type
  off the (already-swapped) socket, keeps each outgoing cable the new type can still
  feed (an `any` input always survives; same-family widening too), drops only the
  incompatible ones, then `reconcileFcTypes`. Wired into Cast / ResultTypeToggle /
  Get Column; Add Column (an INPUT retype) calls `reconcileFcTypes` too. So a Cast
  date→number reformats a downstream FC the whole chain, and an `any`-input cable is
  no longer needlessly severed. (6) **Mobile editing.** The body textarea used the
  coarse-aware `stopDragStart` (a no-op on touch, so a press on the READ body bubbles
  to rete to drag the note) — but while EDITING that let rete steal focus on every
  tap, closing the keyboard. The textarea now uses an unconditional `stop` (like the
  title input, which works on touch); the read body keeps `stopDragStart`. Plus a
  300ms post-blur guard on enter-edit (see #3). (7) **Native copy/paste menu.** The
  canvas `contextmenu` handler `preventDefault`'d for every right-click/long-press, so
  a long-press in the editing textarea showed Solenoid's node menu, not the browser's.
  It now bails before `preventDefault` when the target is the focused text-editing
  element (`textarea`/`input`/`contenteditable` === `document.activeElement`). A
  non-editing note still gets the node (Isolate/Pin) menu.

### Variadic upgrade: CHOOSE / IFS / SWITCH now have extensible inputs (2026-06-23)
Audit in `docs/node-arity-audit.md`: found the fixed-arity nodes whose Excel
function is variadic. Upgraded three (the confident ones); booleans deferred.
- **CHOOSE** — was hardcoded to 4 values, now a fixed `index` + extensible `v*`
  value rows. **IFS** — was 3 cond/val pairs, now any number. **SWITCH** — was 3
  when/then pairs, now fixed `expr`/`default` + any number of pairs between.
- **Infra:** generalized `ExtensibleInputs` with `leadingKeys` (fixed rows above,
  rendered via `InlineInputs`) + `valueKeys` (which inputs are removable). New
  `PairedExtensibleInputs` + `PairedExtensibleNode` for the paired nodes (a "row"
  is two sockets sharing one remove button; `+ Add pair`). Pair `i` owns
  `${prefixA}${i}`/`${prefixB}${i}` keys; `valuePairKeys()` derives ordered pairs
  from the inputs map.
- **Persistence gotcha:** `extractInit` only captured `valueKeys` for nodes with
  `nextInputId` + `addValueInput`. Paired nodes have `nextPairId`/`addValuePair`
  instead, so the capture condition is now `addValueInput || addValuePair`. The
  constructor filters captured keys to the ones it owns (prefix match), so a fixed
  `index`/`expr`/`default` captured alongside the value keys is ignored on rebuild.
- **Why dropping back-compat is fine:** the input keys changed (`cond1`→`cond0`,
  `v1`→`v0`, …). No seed/save uses these nodes (grep'd), and pre-alpha = break
  old saves freely. An old save with a hardcoded IFS would just skip on load.
- **Null/error family aligned (2026-06-23):** the four null/error nodes form a 2×2
  — detect (Test ISNULL / ISERROR / ISNA) × recover (Fill·Coalesce / IFERROR·IFNA),
  split by missing(`null`) vs error(`SolError`). Audit found three cracks, now fixed:
  (1) ISERROR (Test) and IFERROR disagreed on a bare `NaN` — Test said "not an
  error," IFERROR caught it. Producers never leak raw NaN (they tag `#DOMAIN!` or
  collapse non-finite → null), so IFERROR's NaN-catch was vestigial; dropped it, so
  the ONE notion of "error" across the family is a tagged `SolError`. (2) the "is
  this `#N/A`?" test was inlined in 4 spots (how the drift happened) → centralized as
  `isNaError` in errorValue.ts, used by ISNA + IFNA. (3) ISNULL inlined `=== null` →
  now `isMissing`. Clean symmetry kept: Fill targets missing, IFERROR targets errors,
  no overlap (Fill's `coalesce` op = IFERROR's shape applied to null).

- **NOT split out + IFERROR/IFNA null-aware (2026-06-23, follow-up):** NOT is now
  its own `NotNode` (unary element-wise flip → logical) — it's a map, not an N-ary
  reduce, so it doesn't belong in `BooleanOpNode`'s extensible-operand family. That
  removed the op-aware single-row special-case from the Boolean component (every op
  there is now a true reducer). **IFERROR/IFNA** rebuilt for the real-null model:
  a `null` (missing) is NO LONGER treated as an error (the old IFNA "null = not
  found" / IFERROR "null → fallback" assumptions are gone — a real not-found is a
  tagged `#N/A`, e.g. XLOOKUP). They now catch PER-CELL element-wise via
  `replaceCaught` (IFERROR = any tagged error + NaN/Inf; IFNA = only `#N/A`),
  passing null + good cells through. **Gotcha fixed:** a wired input that delivers
  `null` must be read by connection-PRESENCE, not `inputs.x?.[0] ?? literal` — `??`
  treats a real null as absent and substitutes the literal, hiding the missing cell.

- **Booleans split (Chunk 4, done):** `LogicalNode` retired → variadic
  **`BooleanOpNode`** (AND/OR/XOR/NAND/NOR/XNOR over extensible `a*` rows + NOT as
  the unary op; all emit logical, so the op switch never swaps the output socket —
  N-ary Kleene `foldBoolean`) + standalone **`IfNode`** (fixed cond/then/else, value
  passthrough, kind `util` like Choose/Switch/Ifs). **IFS gained an "Otherwise"
  trailing input** (no-match fallback; unset → null). Migrated the one Logical seed
  node (`null-and-logical.json`: `a`→`a0`). The general principle from this work —
  **labeled per-slot inputs for role-distinct values, list socket only for
  interchangeable ones** — is written in `docs/node-coverage.md` + CLAUDE.md.

### Sockets hardened: header-independent via a `.solenoid-node__content` wrapper (2026-06-23)
Root-cause fix for the whole class of "sockets shift when the title/header changes"
bugs. Previously every socket `top` (measured rows AND `--out-socket-top`) resolved
against the card / rete node-view wrapper, which INCLUDES the header — so any header
height change (1↔2-line title, the display↔textarea focus swap) moved every socket
and needed a re-measure, and any mismatch showed as a slide.
- **Fix:** NodeShell now wraps everything below the header (`leading` sockets +
  output `PortSockets` + `__body`) in `<div class="solenoid-node__content">` with
  `position: relative`. That wrapper is the sockets' offsetParent, so all socket
  `top`s are measured relative to the BODY, not the card → **header-independent**.
  Header grows → the wrapper slides down and the browser carries the sockets along,
  no re-measure. rete's `getElementCenter` walks the offsetParent chain to the node
  element and adds the wrapper's offset back, so cable endpoints stay correct
  (verified the impl in rete-render-utils — it accumulates `offsetTop` up the chain).
- **Boolean Input socket fixed for free:** it has no value box, so `--out-socket-top`
  is unset and the socket fell back to `50%` — which used to be 50% of the *card*
  (header included → socket sat high above the checkbox). Now it's 50% of the
  *content wrapper* (the body) → centers on the checkbox row.
- **Why no code change to the measurements:** `MeasuredSocketRow` and
  `syncOutputSocketTop` already read `offsetTop`, which resolves to the nearest
  positioned ancestor — now the content wrapper. Same for custom `leading` nodes
  (ChartNode measures `chartRef.offsetTop`). So they became content-relative for
  free; only the wrapper + comments/invariants changed.
- **Gotchas / known minor:** the wrapper sits inside the card's 1px border, so dots
  land ~1px further inside than the old card-outer anchor — uniform, negligible,
  deliberately NOT corrected with a negative margin (it fights display-grow's
  max-content width). Header / chevron / corner-badge stay OUTSIDE the wrapper
  (card-anchored, still header-tracking). Groups + Conduits are separate components
  (not NodeShell) and unchanged — they position sockets by member geometry, no
  header coupling. CLAUDE.md socket invariants updated.
- **NEEDS DEPLOY VERIFICATION** (node-env tests don't render DOM): cable endpoints
  land on dots; collapsed nodes + their input pills; multi-output rows; Display's
  input dot; Boolean checkbox alignment; 2-line titles; the docked Format Controller.


### Node-header colours match output type; Add-menu pin-on-click + soft shape validator (2026-06-23)
- **Header colour = output type, for the type-emitting source/predicate nodes.** `nodeKindOf` (kind.ts):
  **Boolean** input amber→logic (purple — it's the TRUE/FALSE source), **Test** (IsCheck) util→logic and
  **ISEVEN/ISODD** math→logic (both emit the logical type), **DatePicker** input→date (pink — emits a date
  serial). Left Number/Color/Constant/Choose/Switch/IFError as-is (no single first-class output type, or
  amber IS the number/source colour). The menu accent is separate (set per catalog leaf), so Boolean's
  menu chip was already purple; this aligns the card.
- **Add menu: click-to-pin a submenu** (`AddNodeMenu.tsx`). Hover still navigates, but clicking a category
  now PINS its submenu open: `pinned` path-prefix gates `onMouseEnter` so straying the cursor elsewhere
  can't collapse it (you can still hover within the pinned subtree). Clicking another category re-pins;
  typing a search or any keyboard tree-nav releases the pin. Refactored TreeMenu from a raw `setPath` to
  `onHover` (gated) + `onOpenCategory` (pins) handlers. No visual indicator — "silent" per request.
- **Soft Add-menu shape validator** (`catalogValidator.ts`, dev-only, never throws): warns when a
  (sub)menu exceeds **12 rows** or nests **>3 submenu levels**. Counts ROWS (a pair = one two-column row),
  runs over `buildCatalog(false)` (every pack included, since packs extend the menu at runtime — can't be
  a hard rule). Currently flags 3 long menus (Numbers 13, Lists › Aggregate 19, Finance › Other 15);
  nothing too deep.

### Add-menu: source nodes consolidated into Input; Boolean/Lambda highlighted (2026-06-23)
Moved the literal/source nodes — **Table** (`table-input`), **Frame Input** (`frame-input`), **COMPLEX**
(`cx-from`), and **LAMBDA** (`lambda-make`) — out of their op-category homes (Tables & Frames, Complex
Numbers, the Lambda subcategory) and into the **Input** menu, grouped with Number/List/Text/Boolean. The
catalog `type` ids are unchanged, so saves and `nodeExcel`/validator mappings are untouched. Highlighted
**Boolean** (`boolean-input`) with the logical/purple accent (`NODE_KIND_ACCENTS.logic` — it's the
TRUE/FALSE source) and **LAMBDA** with green, per request.

**Kind-colour follow-up (same day):** made the green real instead of a menu-only chip, and freed it from
`list`. New `lambda` NodeKind on the green palette slot; `nodeKindOf(LambdaNode) → "lambda"` (it used to
fall through to `math`/blue), so LAMBDA's card AND menu chip are both green now. And the **`list` kind
slot moved green → gold**: a list isn't a first-class socket type (a number-list socket is still
number-coloured), so list nodes don't earn a dedicated hue — they share the neutral gold with
display/format. All the `NODE_KIND_ACCENTS.list` menu accents (List, Range, Filter, Fill, XLookup…)
follow the slot automatically, so they're gold with no per-leaf edits. NodeKind is a `Record`-keyed union,
so adding `lambda` forced updating `NODE_KIND_SLOTS` + `NODE_KIND_LABELS` (tsc enforces; ACCENTS is
derived).

### Removed T/N/TYPE; ISEVEN/ISODD → a logical-emitting Logic node (2026-06-23)
Cleanup prompted by a node audit.
- **T, N, TYPE removed entirely.** All three declared a `value` input but their components
  (`TypeCoerceNodes.tsx`) rendered `NodeShell` WITHOUT the `leading={<PortSockets side="input" />}`
  prop — and that prop is the *only* way NodeShell draws an input socket. So the socket never
  rendered → unwireable → they always computed on `null` and output null/0/"". Dead on the canvas, and
  superseded anyway (Cast does N's coercion; the socket type system + the Test/IS-family node do TYPE's
  classification; T is a niche text coercer). Deleted class + component + registry + catalog + nodeExcel
  entries. No persistence shim — old saves referencing `TNode`/`NNode`/`TypeNode` load-skip (the ctor
  registry is derived from the catalog, so a removed catalog entry just drops out of it).
- **ISEVEN/ISODD extracted from `MathFnNode` into `IsEvenOddNode`** (`nodes/logic.ts`). They were ops in
  the giant Math op-dropdown, which has one shared NUMBER output, so they could only emit 1/0. Pulled
  them into a single node (even/odd toggle, `op: ParityOp`) that emits the first-class **logical**
  (`logicalComboOut`, TRUE/FALSE, Kleene-null on missing, broadcasts over a list), moved to the **Logic**
  menu next to Comparison/Test. Catalog type `iseven-isodd`; nodeExcel now lists both ISEVEN and ISODD
  as parity:true. Removed the `iseven`/`isodd` cases from `MathFnOp`/`MATH_FN_OP_META`/the data switch.
- Gotcha for future "make X output a bool": if the op lives inside a shared-output multi-op node
  (MathFn), you can't just change its return — you must extract it to its own node so the output socket
  can be the logical family. tsc + 988 tests green, build clean.

### Mobile font fix + Function Reference mobile UX, new toolbar-supplementals doc (2026-06-23)
Two pieces of work on the `working` branch.
- **Font was never rendering off the author's desktop.** `@fontsource-variable` registers the bundled
  families as **"Atkinson Hyperlegible Next/Mono Variable"** (a ` Variable` suffix), but `App.css`
  referenced the unsuffixed names — so the app silently fell back to `system-ui` everywhere the *static*
  font wasn't installed (i.e. every phone; the desktop only looked right because the author has the
  static face installed). Fix: list the `Variable` family first, unsuffixed name as fallback. Verify by
  grepping the installed package's `index.css`, not by eyeballing — the suffix is the whole bug.
- **Function Reference on mobile**: filters were eating half the screen and unscrollable (category chips
  `flex-wrap`ped to many rows + the stats legend). Now row 1 wraps (search keeps a full line), the
  category chips are a single horizontal scroller, and the stats legend is hidden on mobile. Close was a
  faint 16px glyph styled by a stale text-`×`-era rule → now a 40px outlined chip pinned top-right, with
  the tab labels in a `.fr-tabs__scroll` so the last tab can't hide under it. Panel 96vw/91vh → 92vw/88vh
  for a tappable backdrop margin. (Remote `working` had reworked the FR filters into `.fr-filter-pill`s +
  an Excel-columns checkbox since the base; rebased onto that.)
- **New doc: `docs/excel-toolbar-supplementals.md`** — a systematic walk through every non-function part
  of Excel (the ribbon + cross-cutting features), each tagged NODE / SETTING / FORMAT / CHROME /
  STRUCTURAL / SKIP. Headline conclusions: Excel's *form controls* are already our Input/Control node
  family; its *number formats* are one Format Controller; a lot is *structural* (names→titles,
  trace-precedents→the graph, watch-window→pins); and the real new-node shortlist is Pivot/Unpivot +
  relational verbs, a **Validate/Assert** node, **Goal Seek**, and a **Data Table / parametric sweep**.
  New-setting shortlist: Calc mode (Live/Paused), show grid dots, CSV import locale, default number/date
  format. Ties into `roadmap.md` (relational arc) and `excel-pain-points.md`.

### Help/reference docs iteration + verbose-copy pass finished (2026-06-23)
Author asked to finish the verbose-copy pass, iterate hard on the help/reference docs, and check the
Function Reference Notes column for verbosity. All copy-only (no logic touched); `tsc` clean, 988 tests
green.
- **`help/help.md` — staleness, not just verbosity, was the real problem.** The shortcut list was
  pre-single-key-rework: it taught `Ctrl+G` group / `Ctrl+Shift+K` tidy / `Ctrl+Shift+E` expand /
  `Ctrl+Shift+L` cleanup. The actual bindings (Canvas.tsx ~480, 653-661) are bare **A/G/I/T/E/F/C**.
  Rewrote the "Organizing" block to the single-key set. Also fixed two other stale claims: snap is
  **dots-only** now (dropped "and the halfway points between dots" — `GRID_SNAP_STEP = DOT_SPACING`, no
  sub-grid), and the examples list named "budget" (no such seed) — replaced with real seed labels
  (seeds are auto-generated from `seedGraphs/*.json`).
- **`help/notes.md`.** Swept the **Reduce → Aggregate** rename ("Filter into an Aggregate set to SUM is
  SUMIF"; the composability example). Updated the live-connections note: text columns are **supported**
  now (`connection.ts:19` keeps strings as strings; type-infers), not "on the way". Broke the
  one-giant-run-on-sentence MAP/BYROW/MAKEARRAY/REDUCE paragraph into a bulleted list.
- **FR Notes column (`nodeExcel.ts`).** The Notes shown in the Function Reference table still said
  "Compose **Filter → Reduce** (SUM)" across ~13 EXCEL_GAP rows + SUBTOTAL + the FILTER node note — the
  aggregate node/category is **Aggregate** now (the only "Reduce" left is the lambda REDUCE node, which
  is correct). Swept them to Aggregate.
- **Descriptions.** Trimmed the two clearest remaining bloat offenders (Coalesce/Fill lost "the explicit
  opt-in to treat a gap as something"; Image de-duped). The rest of the >150-char descriptions are
  dense *reference* info (lambda var bindings, base-convert A–F caveat, multi-fn IS-check), not bloat —
  a grep for bloat-tells over every node description was empty, so the verbose-copy pass is now closed.
- **Gotcha found in passing: mojibake.** `finance.ts` had 5 corrupted em-dashes (`â€"`, the UTF-8→cp1252
  round-trip of `—`) in DDB/VDB/RATE/IRR/MIRR descriptions — they'd render as garbage in tooltips.
  Fixed with `perl -CSD`. Worth a grep (`grep -rl 'â€' src/`) if more copy gets pasted in from outside.

### UX / polish tweaks (2026-06-22)
A cluster of small author-requested changes (each its own commit; gotchas noted):
- **Group Tidy button now autofits.** The within-group arrange only auto-GROWS the box; the button
  follows it with `autofitToMembers()` (shrink-or-grow). Gotcha: the within-group tidy snaps docked
  FCs back in a DEFERRED frame, so it waits two `requestAnimationFrame`s before fitting (like Cleanup)
  — otherwise the box wraps the members' stale far-right ELK spots.
- **Wire markers mirror the source's header placeholder.** An unlabeled node shows its catalog name as
  its header placeholder (`nodeName`), and `useIncomingSources` (inlineInput) now falls back to that
  same `nodeName(src)` for the downstream `↩ …` marker instead of a bare "wired".
- **Display scalar grow-to-max-then-truncate.** A Display showing a scalar grows the card to fit a long
  number/string, capped at 360px, then ellipsizes (`--display-grow-scalar` in nodeCard.css), instead of
  clipping in the fixed 180px card. A manual resize (inline width + `--sized`) still overrides. Default
  result-value text 20→18px; table/frame COMPACT preview text +1px.
- **Verbose-copy ("claudetext") pass.** Tightened ~20 of the worst `nodeCatalog.ts` descriptions + the
  `ERROR_EXPLANATIONS`, keeping Excel-equivalent tokens + load-bearing gotchas. More remain (backlog
  "Visual polish").
- **Collapsed-node audit** (own entry below) + **Tidy height-pin fix** (below).

### Default date format → `DD-MMM-YYYY` (01-Jan-2026) (2026-06-22)
Author wants dates to read `01-Jan-2026` by default, not ISO. Added `DEFAULT_DATE_FORMAT` /
`DEFAULT_DATETIME_FORMAT` in `nodes/date.ts` (`DD-MMM-YYYY` / `DD-MMM-YYYY HH:mm`) and routed every
display default through them: the inline value box (`valueDisplayFormat`), table/matrix cells
(`TableDisplay`), the popup's formatted date view (`TablePopup`), frame cells (`formatFrameCell`),
Cast-to-text's no-format default (`cast.ts`), and the FC resolve fallback. Added a new FC date style
**`date_dmy`** (`DD-MMM-YYYY`, label "03-Jun-2026") as the FIRST option, and made a date-docked FC
default to it (`formatController.ts`, was `date_iso`). `date_iso` (`YYYY-MM-DD`) stays a selectable
style. To re-default the whole app again, edit the two constants. Updated 6 date-format test
assertions.

### Collapsed-node audit + fix (2026-06-22)
Audited every node's collapsed form. The collapse CSS (`nodeCard.css`) hides every `.solenoid-node__body`
child except the value/display box, socket dots, and the input pill — which means OUTPUT rows
(`.solenoid-node__io-row` from `InlineOutputRows`/`MeasuredSocketRow side="output"`) were hidden too,
so a **multi-output node collapsed to a blank box** (the reported Table Info degeneracy). Two fixes:
- **Output rows now survive collapse.** `MeasuredSocketRow` tags an output row with
  `solenoid-node__io-row--output`, and the collapse-hide rule exempts it. So a collapsed multi-output
  node shows its output VALUES (not a blank box), input rows still fold away. Fixes **8** nodes at once:
  TableInfo, GroupBy, ComplexUnpack, SplitFrame, XYPad, Linest, **and** ChartBuilder + ColorPicker
  (both render their result via a `side="output"` MeasuredSocketRow).
- **Pure-visual nodes are now non-collapsible** (`collapsible={false}`, matching ScalarInput / DatePicker
  / AngleDial): Chart, Gauge, Slicer, Sparkline, Heatmap — their whole point is the visual, so collapsing
  to "—"/blank was pointless; the chevron is now gone. (A richer "mini-preview / show the input value"
  collapsed form is a possible future enhancement, not built.)
Frame nodes (FrameDisplay → chip) and single-result nodes already collapsed correctly (unchanged).

### Fix: a tidied node didn't shrink when collapsed (author-reported "old saves") (2026-06-22)
Symptom: collapsing a node hid its inner content but the **card stayed full-height**; copy/pasting the
node fixed it. Root cause: **Auto-arrange (Tidy) stamps a FIXED inline `height` on the card element via
`area.resize`** (`Canvas.tsx` ~1780) — a direct DOM style that survives `area.update` (which is exactly
why `clearPinnedHeight` exists for formula edits). Collapse calls `area.update` but never cleared that
pin, so a tidied node kept its height; a fresh copy/paste has no pin, so it collapsed fine (hence the
"old data" smell — the loaded graph had been tidied). Fix: a `useLayoutEffect` in `NodeCard` clears the
inline `height` whenever the node is collapsed, so the card reflows to its value box. Not actually a
save-format issue — any tidied node hit it.

**Root fix + Tidy/Cleanup artifact audit (follow-up):** stop Tidy leaving the pin in the first place.
`arrangeFn` now drops the inline `height` on every arranged node's card right after the size-restores
(covers Cleanup too — it routes through `arrangeFn`). This turns the `NodeCard` collapse clear and
`clearPinnedHeight` (formula edits) into belt-and-suspenders. Audited the rest: **width** pins are
harmless (a node's width is fixed per CSS / React-managed for resizables — that's why
`clearPinnedHeight` only ever cleared height); the ELK **proxies** are JS `Proxy` wrappers that GC away
(never added to the editor); and **groups are correctly skipped** — GroupNode sets `height` via its
React `style` prop, so React itself clears the pin when the group collapses (the prop disappears),
whereas a regular node's NodeCard only sets `--box-h`/`width`, never `height`, so the pin was untracked
and lingered. Net: the node height pin was the only real artifact.

### GOVERNING PRINCIPLE (author, 2026-06-22): enforce TYPE separation, allow DIMENSIONAL flow
The lattice's job: **element families never auto-cross** (date / number / complex / string each stay
put — crossing requires an explicit Cast), but **a value flows freely UP in dimensionality** (scalar
→ list → matrix → frame). The ONE deliberate exception is `logical ↔ number` (0/1 ⟷ TRUE/FALSE), the
spreadsheet multiply-by-a-condition idiom. So: NO date↔number, NO number↔complex, NO string↔number
edges — those are Cast's job. The pure rank-derivation can't express the cross-TYPE *dimensional*
edges (combo→scalar, anything→frame, list/scalar→anytable), so those are added explicitly in
`accepts()` — and they're exactly what kept getting "lost" when the lattice was reworked for
extensibility. When auditing: every rank≤2 value should reach the 2-D containers (`anytable`, `frame`)
by widening; no element family should reach another.

### lower-rank → `frame` widening: a value flows up into the data table (2026-06-22)
Author expected frame inputs to accept lower-rank values — they didn't. Added the missing dimensional
edges: ANY rank≤2 value (a 2-D matrix, a 1-D list/combo, a scalar — of any family) WIDENS into a
`frame` input. `accepts()` gains `inT === "frame" && (FAMILY_VALUE_TYPES.has(outT) || outT ===
"anytable")`; `coerceInputs` builds it via `frameFromRows`: a matrix → rows×cols, **a 1-D list → a
single ROW** (CSV-input-consistent — transpose for a column), a scalar → 1×1; per-column types
inferred, auto headers Col1…. A `frame` OUTPUT still does NOT flow into a matrix input (it'd lose
headers / assume homogeneity — Split Frame first). Now every frame node (Get/Add/Split/Get-Row, the
relational verbs) takes a raw matrix/list/scalar without an explicit Build Frame. Knock-on: **Table
Info's input is now `frame`** (was `any`) — a matrix/list/scalar widens in, a frame flows in, and the
violet grid glyph reads honestly; pure 1-D length stays List Length's job.

### `any`-socket SHAPE audit — element-agnostic 2-D inputs now use the GRID socket (2026-06-22)
First pass wrongly concluded "leave them as `any`"; corrected after author feedback. The convention
(socketConnect.test) is: **a 2-D operation declares a GRID socket and a 1-D value widens IN** —
`canConnect("list","table")` is true. The matrix reshapers broke it: their OUTPUT was `anytable`
(grid) but their INPUT was `any` (scalar circle), so a TRANSPOSE looked like it took a scalar.

Fix (aligns the inputs to the grid convention, zero runtime change — the nodes still `toAnyMatrix`):
- New **`anyTableIn`** factory (shared.ts) — a 2-D, element-agnostic GRID input.
- Retyped the genuinely-2-D, element-agnostic inputs `anyIn → anyTableIn`: TRANSPOSE, HSTACK (a/b),
  reshape-flatten (tocol/torow) matrix, CHOOSEROWS/COLS matrix, MAP (x/y/z), BYROW/BYCOL, REDUCE
  *values*. LEFT as `any`: REDUCE *initial* (scalar seed), reshape-WRAP *List* (1-D-ish), GroupBy
  keys, flatten *List* output, TableInfo (also takes a **frame**, which `anytable` excludes), and the
  true wildcards (Cast / Display / IsCheck / formula+LAMBDA vars / TEXT).
- **`anytable` as an INPUT now accepts widening** from any family value of rank ≤ 2 (a 1-D list /
  scalar / combo) — new `FAMILY_VALUE_TYPES` set in `accepts()` — so `Range → TRANSPOSE` still wires
  (→ an N×1 column, per the author). As an OUTPUT it stays strictly 2-D (no narrowing into 1-D).
- Reverted the invented circle+grid-cross `any` glyph: `any` is back to the plain circle (the
  established circle/square/grid vocabulary; 2-D ops now carry the real grid via `anytable`).
- Frame → a reshaper/MAP is now rejected at the socket (`anytable` excludes the heterogeneous frame);
  it was garbage via `toAnyMatrix` before. Pre-alpha, acceptable. Tests + seeds green.

### Fix: CSV view rendered null cells as 0 (save was already correct) (2026-06-22)
The popup's CSV view/export ran cells through `cell()`, which still coerced a blank numeric cell to
`"0"` (the pre-null behavior) — so switching a table/frame to CSV *rendered* `0`s even though the
grid showed blanks and Save preserved null. Dropped the `"" → "0"` coercion: a blank stays blank in
CSV, matching `fromGrid`/`buildFrameColumns`. (Also affects 1-D list copy via `listToText` — a null
element now copies as blank, not `0`.)

### Fixes: three more deploy findings — frame IS-checks, popup type switcher, universal placeholder (2026-06-22)
- **IS-checks on a Frame collapsed to one bool.** A frame isn't an array, so `deepNull`/`deepTest`
  tested the whole frame as a single cell. `IsCheckNode` now flattens a frame to its row-major raw
  cells (`frameCells`) first, so ISNULL/ISNUMBER/… test per cell like a matrix (3×2 frame → 3×2
  grid). Tested in `logic.test.ts`.
- **Frame popup type switcher only had #/T.** Extended the column-type button to cycle all four
  kinds **Number → Text → Date → Boolean** (`COLTYPE_ORDER`/`GLYPH`/`NAME`). `buildFrameColumns`
  now parses a logical column (TRUE/1→true, FALSE/0→false, blank→null) and a date column (serial,
  ISO fallback); logical/text cells edit as text. Widened `tablePopupStore` `FramePopupColumn.type`
  + `columnTypes` + `cellType` to include `logical`, and `FrameChip` now passes each column's real
  type (dropped the old `logical→string` popup workaround). A logical column now survives a popup
  edit (the earlier "demotes to text on Save" caveat is gone).
- **Placeholder on ALL nodes (header never collapses).** Added `nodeName(node)` (catalog-label index,
  parallel to `describeNode`); `NodeShell` defaults its header placeholder to the explicit prop ELSE
  the node's catalog name. So a cleared title shows the node's name dimly and the header keeps its
  height for every node — not just the few that passed `labelPlaceholder`.

### Fixes: four author-reported array-semantics regressions (2026-06-22)
After the Inc 1–8 verification pass on the deploy:
- **A 2-D logical (`[[false]]` from ISNULL on a 1×1 table) rendered as `-∞`.** `TableDisplay`'s
  `Cell` type omitted `boolean`, so `fmtCell(false)` fell through to `fmtNum` → `!isFinite` → `-∞`.
  Widened `Cell` to include `boolean` and added a `TRUE`/`FALSE` branch (mirrors the scalar
  `ValueDisplay`, which was already correct). Also widened `tablePopupStore.Cell` + the `ArrayChip` /
  `TableDisplay` `onSave` signatures so a 2-D boolean flows to the chip/popup cleanly.
- **Table Info read a Frame as 1×1.** `TableInfoNode` ran the frame through `toAnyMatrix` (a frame is
  an object, not a row-major array → scalar). Now detects `isFrameValue` first and reports
  `frameRowCount × columns.length`.
- **Table Input edit still overwrote nulls with 0.** `parseTableText` preserved null on READ, but the
  popup's `fromGrid` coerced a blank cell via `Number("")` → `0` on SAVE. Now a blank → `null`;
  `onSave`/`tableToText`/`parseTableText` round-trip the gap (chain widened to `(number|null)[][]`).
- **Empty-label Display nodes collapsed to a tiny header.** `DisplayComponent` passed no
  `labelPlaceholder`, so `node.label || placeholder || ""` rendered an empty zero-height title.
  Added `labelPlaceholder="Display"` (mirrors Table Input's `"Table"`), and gave the seed's G/H
  Display nodes real result labels (they'd been authored blank).

## NORTH STAR (author, 2026-06-19): a visual relational / Power-Query layer

Direction the author wants Solenoid to grow toward: **Power-Query-style cleaning
queries / basic SQL / basic relational-database operations**, leaning on the
canvas's natural fit for it (proven by Alteryx, KNIME, Tableau Prep, Power Query's
applied-steps — all "a pipeline of table transforms" = a node graph). NOT full SQL
(no subqueries/CTEs/window-fns yet); "basic" = the core verbs done well.

**This frames Solenoid as TWO complementary layers** (like Power Query's table
steps + formula bar):
1. **Set-based frame verbs** — whole-table/relation ops: Filter (WHERE),
   Select/Get Column (projection), Sort (ORDER BY), Group By (GROUP BY), **Join**
   (the keystone that makes it "relational"), Append/Union, Distinct,
   Pivot/Unpivot, Rename, Add Column (computed). A pipeline of these nodes IS a
   visual query. Fragments exist (Get/Add Column, Slicer, 1-D Group By,
   Build/Split); "the verbs" (Filter/Sort/Join/Group By) are the deferred spine —
   see the 2026-06-16 "Text columns DONE" entry. Elevate from "someday" to core.
2. **Per-element formula/MAP** — the polyform layer (see that entry), for computed
   columns + cell logic.

**How the parked ideas ladder up:** the **list-of-frames type** is the natural
representation of Group By PARTITIONS (split-apply-combine) — this north star
RESOLVES its thesis-fit question (it's on-thesis, core). **polyform** is the
computed-column engine under the verbs. **Join** is the flagship + the gnarliest
node (two inputs, key match, inner/left/right/outer, mismatched schemas).

**Hardest part is legibility, not the relational logic** — borrow the precedents'
patterns: schema preview on cables, per-step row counts, an inspectable result at
each node. (Keeps faith with the "keep it legible" governing constraint.)

**Engine choice (assistant assessment, 2026-06-19; npm + crates.io verified same
day). PRIORITY CONTEXT (author):** 1.0 is **absolutely a desktop (Tauri) build for
maximum performance**; the Vite web build is a throwaway demo (look-and-try). So
the relational engine should be a **native Rust engine in the Tauri backend**, NOT
a JS library — and a portable-JS lib (Arquero) drops to at-most a web-demo nicety.

- **THE ARCHITECTURE SHIFT this forces (the real cost — an engine-model change, not
  a dependency).** For max perf you must NOT marshal whole frames across the JS↔Rust
  IPC boundary per node per recompute. Instead: **data LIVES in the engine**; a
  relational node passes a **lazy handle** down its cable (Polars `LazyFrame` /
  DuckDB relation), composing a query plan rather than materializing. Only when a
  node's result is DISPLAYED do you `.collect()` a **preview** (schema + head N +
  row count) across IPC. This keeps the "inspect at each node" legibility AND gets
  whole-chain query optimization for free. It extends the dataflow model: the
  relational/frame layer becomes async + handle-passing; the existing
  scalar/list/numeric/formula layer stays eager JS. The boundary between layers is
  where you `.collect()` a handle → a materialized FrameValue (and vice versa).
- **DuckDB — recommended primary, for the dual-target reality.** Native Rust crate
  `duckdb` v1.x (active, updated 2026-06) for the desktop 1.0 + **DuckDB-WASM**
  (active) for the web demo = ONE engine, TWO targets, identical Arrow/SQL
  semantics → no divergent code paths. Also out-of-core / larger-than-memory +
  persistence, and a free "SQL" power-node.
- **Polars — strongest on raw speed + verb→node ergonomics.** Rust crate v0.54
  (very active, ~2.8M recent dl). Fastest engine, lazy query optimizer, and
  `LazyFrame` methods map 1:1 onto verb nodes (`.filter`/`.group_by`/`.join`/
  `.sort`). Downside vs DuckDB: **no production browser WASM** (only community
  MWEs), so the web demo needs a separate/degraded path. Pick Polars if desktop
  speed + clean verb mapping outweigh dual-target consistency. (Arrow interop lets
  the two coexist: Polars hot path + DuckDB for SQL/huge data.)
- **Arquero (v8.0.3) / hand-rolled JS verbs — demoted to web-demo / small-data
  fallback only.** NOT the performance path. Arquero's cadence is also slow (last
  release May 2025). Only **Join** is hard to hand-roll (hash join, join types,
  schema merge — a few hundred lines).
- **SQLite / sql.js (v1.14.1) — pass** (OLTP row-store, SQL-string impedance, not
  analytical). **alasql (v4.17.3)** = pure-JS SQL-over-arrays, only if you want SQL
  semantics w/o WASM in the demo; less robust than DuckDB.

Net (research): build the relational layer on a **native Rust engine with lazy
handles + on-demand previews**; the hard part is the async/handle-passing engine
extension, not the library choice.

**DECISION (2026-06-22): Polars.** Author chose Polars over the doc's hedged
DuckDB-primary lean — fastest engine, and `LazyFrame` verbs (`.filter`/`.group_by`/
`.join`/`.sort`) map 1:1 onto the Phase 3 verb nodes. Accepted tradeoff: Polars has
no production browser WASM, so the **web build does not run the real engine**.
The web demo lives on as a **UI test environment and a try-it demo for new users**,
with **node + backend restrictions** — engine-backed/relational nodes are
unavailable or limited there, and the desktop Tauri build is the only
full-capability target (consistent with web-is-look-and-try). If a SQL power-node or
huge/out-of-core data ever needs DuckDB, the two can coexist over Arrow — but Polars
is the single performance path for 1.0. The DuckDB/Arquero/SQLite bullets above are
retained as the historical assessment, not the chosen direction.

## Formula engine: one array-aware evaluation core (aggregate + tagged errors) (2026-06-21)

The shared formula engine (`excelFormula.ts`) had **four** array conventions over one
compiler — Expression destructured arrays to scalars before the formula ran (so it could
map but never aggregate: `SUM(x)` summed one element at a time), while MAP/BYROW/REDUCE each
invoked the compiled scalar function their own way. Reworked into ONE value-polymorphic
tree-walking core; landed in three author-gated increments:

- **1a — aggregate (`compileEvaluator` + `RANGE_FUNCTIONS`).** `evalAst` decides
  broadcast-vs-aggregate **per call site** (Excel's grammar of arrays): a range-signature
  function gets its array whole; everything else broadcasts element-wise. So an Expression
  can finally compute `x/SUM(x)` — `x` flows whole into SUM and element-wise into the divide.
  `compileFormula`/`evaluateSteps`/LaTeX left untouched → strict-superset by construction.
- **1b — tagged in-formula errors (P5).** Scalar `1/0` is minted as `#DIV/0!` AT the divide
  and propagates through scalar operators; Formula.js error returns + bare non-finite scalars
  map to `SolError` at the Expression boundary (`#DOMAIN!`/`#RANGE!`). `errorValue.ts` only
  imported, not edited.
- **Lambda unification.** `compilePositional` (the core + a positional→env binding) is now a
  drop-in for `compileFormula`; `compileLambda` + `LambdaNode` route through it. ALL production
  formula eval now runs on the one core. `compileFormula` is production-unused (kept as a tested
  reference for now).

Gotchas worth keeping:
- **Formula.js mishandles array-RETURNING range fns on a 1-D list** — `UNIQUE([1,1,2])` →
  `[[1,1,2]]` (no dedupe), `SORT`/`FILTER` likewise (they expect a 2-D range). So UNIQUE/SORT/
  FILTER/TRANSPOSE/SEQUENCE are **excluded** from `RANGE_FUNCTIONS`; only the scalar/logical
  aggregators (which FX evaluates correctly over a 1-D array) are in. Array-returning needs its
  own list-model pass.
- **Errors are scalar-level — the boundary, not the evaluator, enforces it.** A div0/FX-error
  that lands INSIDE a list is left as an element and collapsed to `NaN` by the host's `guard`/
  `cell`, so lists never carry tagged errors. Tagging happens only on a scalar result. (Was:
  author confirmed NaN-in-list. **SUPERSEDED by the 2026-06-22 array-semantics decision below** —
  the lists-never-carry-errors invariant is to be relaxed so errors stay per-cell and propagate,
  distinct from a new `null`. Current code still collapses to `NaN`; not yet rebuilt.)
- **Strict-superset firewall:** the existing `excelFormula.test.ts` (compileFormula),
  `polyform.test.ts`, and the MAP/BYROW/REDUCE/LAMBDA suites are the regression guard — they
  stayed byte-identical-green across all three increments.

### Array-semantics policy DECISIONS (2026-06-22, author) — design only, not yet built

Settling the §4 "author's call" items from `archive/formula-engine-array-semantics.md`. These
are committed decisions; the build is still the unified-core work, unscheduled.

- **First-class `null` (missing value), distinct from `SolError`.** A new value kind meaning
  "no data here" — NOT an error and NOT `0`. Rationale (author + colleague): real datasets have
  missing values you want to *trace*, and `0` is a false sentinel (e.g. temperatures −1/0/+3 °C
  where 0 is a real reading). Matches the data-tool model (pandas `NaN`, R `NA`, SQL `NULL`,
  **Polars `null`** — our chosen engine), not Excel's `#N/A`-as-error. **Rendered literally as
  `null`.** Allowed inside lists.
- **Aggregators SKIP `null`; errors PROPAGATE.** `SUM`/`AVERAGE`/… ignore `null` (so one missing
  cell doesn't break a total; `AVERAGE` divides by the *present* count — same as Excel ignoring
  blanks, pandas, SQL `AVG`). A `SolError` in the same list still propagates through the
  aggregate, so a genuine failure (e.g. `#DIV/0!`) surfaces loudly. Net: *missing ≠ broken*.
  (A strict/propagate-nulls mode is a possible later opt-in, not v1.)
- **RELAX the "lists never carry errors" invariant.** Required by the above: a per-cell `SolError`
  must survive in a list so it stays traceable and propagates. So lists may now carry two special
  kinds — `null` (skipped) and `SolError` (propagated) — which are distinct. (Old behavior
  collapsed both to `NaN`.) `CLAUDE.md` Error-values bullet flagged accordingly.
- **P3 ragged lists → DECIDED (pad shorter inputs to the longest with `null`), but NOT
  BUILT** — the code (broadcast2 / shared.ts zips, SumProduct/SortBy/Interleave) still
  truncates to the shortest, and `excelFormula.test.ts` pins truncate (v1.0 audit finding 25
  caught the docs claiming this had landed). The decision stands (not truncate-to-shortest,
  not error, not `0`-fill; length-1 still broadcasts; the missing tail is literally missing
  data); implementing the pad is open backlog work.
- Worked trace (the one that drove the call): `A=[10,20,30,null,50] / B=[2,0,5,4,null]` →
  `[5, #DIV/0!, 6, null, null]`; `SUM` skips the two `null`s and propagates the `#DIV/0!` → the
  total is `#DIV/0!` (the real failure surfaces, the missing cells are harmless).

**Blast radius — backward-walk of the old invariant (audited 2026-06-22; verified file:line).**
What relaxing "lists never carry errors / no in-list null" touches, so the eventual build is
scoped. Good news first: **frames ALREADY carry `null`** (`frame.ts:26` `values: (number | string
| null)[]`; `frame.ts:9-16` `fmtCell` already distinguishes `null` from `NaN`; `buildFrame:82`
maps `undefined→null`) — so the list/scalar layer is what's behind, not the table layer.

- **Enforcement points that collapse to NaN (the things to change):** `expression.ts:20-24`
  (`guard`) + `:156-160` (the list-map + its "lists never carry errors" comment); `tableLambda.ts:91-94`
  (`cell`) + call-sites `:143,146,193,303` (MAP/BYROW/BYCOL/MAKEARRAY); `shared.ts:91-104`
  (`broadcast`, `out.push(r ?? NaN)`); `cast.ts:124` (`displayList` null→NaN); `frame.ts:91-102`
  (`splitFrame` non-number→NaN — must skip/propagate `null` instead); `excelFormula.ts:368-383`
  (`broadcastCall` + the boundary-clean comment).
- **Aggregators that blind-reduce (HIGHEST RISK — silent NaN if a `null`/error slips in):**
  `list.ts` `AggregateNode` (~`941`+, every SUM/AVG/MIN/MAX/COUNT/MEDIAN/STDEV/PRODUCT case),
  `RollingNode` (~`829-844`), `WeightedNode` (~`877-903`); `stats.ts` `PercentileNode` (`63-90`),
  `NthValueNode` (`36-40`, LARGE/SMALL `.sort()` treats `null` as 0); `excelFormula.ts:295-313`
  `RANGE_FUNCTIONS` handed straight to Formula.js (which has NO null-skip — SUMPRODUCT/AVERAGE
  would return garbage on an in-array null). Each needs: skip `null`, propagate `SolError`.
  (Open Q for the build: does COUNT count nulls? — `COUNT` no, `COUNTA` yes, like Excel.)
- **`isSolError` checked only at scalar level (needs a per-element check):** `expression.ts:160`,
  `tableLambda.ts:246,303`, `excelFormula.ts:321`, `coerceInputs.ts:71-75`.
- **Display (needs a per-element `null`/error branch):** `nodeKit.tsx:440-447` (`ValueDisplay` —
  scalar-only `isSolError`; needs `Array.isArray && .some(isSolError)`); `valueDisplayFormat.ts:47-56`
  + `ArrayChip.tsx:19-21` (decide: render in-list `null` as `null` text vs blank). Cable
  inspector / pins ride the same path.
- **Coercion (must NOT re-collapse a real `null`):** `coerceInputs.ts:25-53,46-49`,
  `coerce.ts:40-44,52-61` (`toList`/`toMatrix` currently pass through — keep that).
- **Persistence:** plain numeric/string literals are fine; a **per-cell `SolError` has no save
  format yet** (`persistence.ts:31-42`) — frames round-trip `null` already, but an error column
  would need a tagged field. Defer until errors-in-lists actually persist.
- **Tests that assert the OLD behavior (will need updating):** `cast.test.ts:62-63`
  (`cast("number",[1,"2","x"])` → `[1,2,NaN]`, comment "never an error inside a list");
  plus the two code comments at `expression.ts:156` and `excelFormula.ts:382-383`.
- **Highest-risk if missed:** the `AggregateNode` reducers and the Formula.js `RANGE_FUNCTIONS`
  delegation — both would *silently* fold a stray `null`/error into `NaN` rather than skip/propagate.

- **P7 boolean output → RESOLVED: a first-class logical type (full socket family).** Renders
  `TRUE`/`FALSE`, coerces to `1`/`0` in arithmetic/aggregators (Excel + Polars model). Bare
  logical results (`a>b`, `ISNUMBER`, `AND`/`OR`) stop collapsing to null. **Socket color =
  purple** — reuses the `purple` palette slot the `logic` node-kind already uses, so logical
  *type* and logic *kind* line up (author considered teal but teal is the `convert` kind; purple
  is the coherent pick). Needs `--sock-logical` + auto-shaded list/matrix siblings, an
  `isLogical` value kind, coercion rules, and a legend entry. Interaction: the Alert node's
  boolean mode (`=== 1`) must also accept a real `TRUE`. Design only; rides the array-semantics
  build. Example: `SUM(temps>30)` (a COUNTIF) → `2` instead of today's null.
- **P4 matrix-into-Expression → RESOLVED: element-wise preserves 2-D shape; aggregators
  reduce-all (whole matrix → scalar).** Matches Excel / NumPy / R / REDUCE; `x-AVERAGE(x)` over a
  matrix = centering. Per-axis (row/col) aggregation stays BYROW/BYCOL/ByAxis's job, NOT
  Expression. Replaces the loud `#SHAPE!` placeholder.
- **Variable-binding scope (author flagged):** Expression binds a var to the WHOLE input (Excel
  grammar-of-arrays); MAP/lambda bind to the CURRENT element. So `x-AVERAGE(x)` = centering in
  Expression but all-zeros in MAP (AVERAGE of a 1-element scope = itself). Not the P1 bug — it's
  each host's defining contract (MAP ≡ Expression-per-element) and matches Excel
  (`MAP(arr,LAMBDA(x,x-AVERAGE(x)))`=0 vs `arr-AVERAGE(arr)`=centered). Same core, different
  binding mode. Possible footgun → optional MAP hint when an aggregator wraps the scalar loop var.
- **P6 operator parity → RESOLVED (author 2026-06-22):** type-honest; match Excel where sane,
  diverge where Excel is incoherent. `=`/`<>` type-strict + **case-insensitive** text (EXACT =
  case-sensitive escape hatch); ordering uses dictionary collation for text, **cross-type ordering
  → `#TYPE!`** (don't invent Excel's number<text<logical order, don't return JS NaN-false); `&`
  renders logicals `TRUE`/`FALSE`, propagates errors and **propagates `null`** (TEXTJOIN skips
  null); **`null` propagates in element-wise arithmetic** (`null+5`→`null`, SQL/pandas/R/Polars
  model), while **unwired/empty inputs default to identity** (`5 + <unwired>` = `5`, the P8 knob —
  separate from null). Opt into missing-as-0 via the Coalesce/Fill node below.
- **All array-semantics policy calls (P3/P4/P6/P7) now settled.** Remaining formula-engine items
  are non-policy: P1 lambda migration (largely done), retiring `compileFormula`. The build (one
  value-polymorphic core: `null` + per-cell errors + logical type + the above) is unscheduled.

### Coalesce / Fill node — spec (part of the null build, 2026-06-22)
A single bundled node (op-selector dropdown, same pattern as Aggregate) for missing-value handling
— the explicit opt-in to "treat `null` as something." Built WITH the null value kind (doesn't
exist until then; do NOT build standalone — it operates on a value type that isn't in the code
yet). Strategies (list in → same-length list out unless noted):
- **Constant** — `fillna(c)`: replace `null` with a value (inline field or wired input). The
  common case (fill 0). Default mode.
- **Forward fill** — carry the last present value forward (pandas `ffill` / Polars forward).
- **Backward fill** — carry the next present value back (`bfill`).
- **Mean / Median / Mode** — impute with the aggregate of present values (skip-null, per P3).
- **Interpolate** — linear interpolation across bracketing present values (numeric; pandas/Polars
  `interpolate`).
- **Drop** — remove `null` elements (CHANGES length — flag in the node; nearest to `dropna`).
- **Coalesce (first present)** — the SQL `COALESCE(a,b,c,…)`: first non-null across MULTIPLE inputs,
  per position. Arity wrinkle: this mode needs extensible inputs (ExtensibleInputs pattern), unlike
  the single-list modes — so the socket layout changes with the mode (or keep Coalesce as the one
  multi-input mode and gate the extra sockets on it).
Predicates (ISBLANK / ISNULL test) stay on the existing IsCheck node, not here — this node FILLS,
it doesn't test.

### Second-ring decisions — null logic + downstream coherence (2026-06-22, author)
The core value model (P3/P4/P6/P7) is self-consistent, but it *implies* a second ring of calls.
Settled here; all design-only, same unscheduled build.

- **Three-valued (Kleene) logic — ADOPT.** Polars implements Kleene natively for boolean `&`/`|`
  on nulls; pandas (`pd.NA`) and ANSI SQL use the identical tables — one standard, no ambiguity,
  and the future Rust Polars engine gets it free. Tables: **OR** = T if any T, else N if any N,
  else F; **AND** = F if any F, else N if any N, else T; **NOT** N = N; any comparison with null
  → null; `null = null` → null (unknown, NOT true). Mnemonic: null propagates only when it could
  change the answer (`TRUE OR null`=TRUE short-circuits; `FALSE OR null`=null).
- **`IF(null, a, b)` → propagate `null`** (unknown condition → unknown result; consistent with
  element-wise propagation; matches pandas NA-mask). Alternative was SQL `CASE` → else branch;
  flip if it grates.
- **#4 (sort/filter with null) resolved by Kleene/SQL:** Filter keeps a row only when the
  predicate is TRUE → null/unknown predicate rows are **excluded** (SQL `WHERE`). Sort puts nulls
  **last** by default (pandas), nulls-first toggle later.
- **#2 logical emission:** nodes that KNOW they output a boolean (comparisons, AND/OR/NOT, IS*)
  **emit the logical type**, and also **accept scalar `0`/`1` as booleans** (0=FALSE, nonzero=TRUE)
  so multiply-by-a-condition spreadsheet tricks keep working both ways (P7's logical→1/0 coercion
  already covers the other direction). Implementation step: audit each logic-family node's accepted
  inputs; principle = bidirectional logical↔0/1. Alert's `=== 1` accepts a real `TRUE` too.
- **#3 frame layer extension (REQUIRED):** `FrameColumn` must carry the new kinds — add a
  **`logical` column type** and allow per-cell **`SolError`** (`null` already present). So
  `values` widens beyond `number|string|null` and `type` gains `"logical"`. Without it, TRUE/FALSE
  columns (from CSV or a comparison) and error cells have nowhere typed to live — the frame layer
  would lag the list/scalar value model.
- **#5 unwired default:** an unwired/empty input resolves to the consuming op's identity (Excel
  chameleon: `0` numeric / `""` string / `1` for product) — scoped to UNWIRED inputs ONLY, never a
  null *value*. Documented as the single chameleon.
- **#6 persistence:** extend the save format for the new kinds — `null` already round-trips in
  frames; add logical + per-cell `SolError` serialization (a tagged form) for lists/scalars/frames.

After this ring: the system is coherent end-to-end (CSV blank → null → skipped/propagated →
Kleene logic → typed frame round-trip → persisted). Build remains one unscheduled effort.

### Build progress (array-semantics) — increment-by-increment
- **[x] Inc 1 — value-kind core.** `src/graph/valueKinds.ts`: `isMissing`/`isLogical`, Kleene
  (`kleeneAnd/Or/Not`), logical↔number coercion, `forAggregate()` (skip null / propagate error).
  Full unit tests. `AggregateNode` routed through `forAggregate`.
- **[x] Inc 2 — scalar-output reducers.** `WeightedNode` (skip a pair if value OR weight is null;
  propagate error), `NthValueNode` + `PercentileNode` (skip null before ranking; propagate error).
  All output scalars so they display today.
- **[x] Inc 3 — display (inline value box).** Reordered AHEAD of producers: emitting null/errors
  into a list output needs the display to render them first. `DisplayValue` widened to allow
  `null` + per-cell `SolError` inside lists; new pure `formatListCell` (null→`null`, error→`#CODE!`,
  text/number as before) wired into the inline render + clipboard paths in `nodeKit`. Unit-tested.
  STILL DEFERRED (follow-up): per-cell error/null rendering inside the `ArrayChip` **popup grid**
  (`TablePopup`) and the cable inspector — the chip shows `[List]` and doesn't crash, but the
  opened grid doesn't yet badge error cells. Enough to unblock producers (the value box is the
  primary surface).
- **[~] Inc 4 — producers emit `null` / keep per-cell errors** (behavior-changing). Done piece by
  piece:
  - **[x] Expression** — list path now runs each element through the same `tagResult` as the
    scalar path: per-cell `#DIV/0!`/`#DOMAIN!` PROPAGATE (no longer collapse to `NaN`), missing /
    boolean → `null`. Flipped the old `polyform.test.ts` "div-by-zero in a list stays NaN" assertion
    to expect a per-cell `#DIV/0!`; added `#DOMAIN!`-in-list + boolean-list→null tests.
  - **[ ] `broadcast` (shared.ts)** — `r ?? NaN` → emit `null`/per-cell error for invalid elements
    (NaN subtlety: `Math.sqrt(-1)` is NaN, not null — needs an explicit finite check). Powers the
    element-wise math nodes; widens their list output to `(number|null|SolError)[]` — ripples into
    caller cached-field types.
  - **[x] `cast` (cast.ts)** — a per-element parse FAILURE → per-cell `#VALUE!`; a blank element →
    `null` (cast can distinguish failure-vs-blank, so it's correct, not a guess). `displayList`
    keeps null+error for numeric/date targets (formatListCell renders), code-as-text for
    text/complex. Flipped both `cast.test.ts` `[1,"2","x"]→[1,2,NaN]` assertions to per-cell
    `#VALUE!`. Also fixed `ValueDisplay`'s `value` prop to be `DisplayValue` (was a stale inline
    union that didn't pick up the Inc 3 widening).
  - **[ ] `broadcast` (shared.ts)** — DEFERRED: can't distinguish a domain-error from missing
    without eval-core help (fn returns `number|null`; `Math.sqrt(-1)` is NaN). Emitting plain
    `null` would conflate domain-errors with missing (the thing we separated). Pair with the P1
    eval-core unification, not a bare sentinel flip.
  - **[ ] `tableLambda` `cell`** — DEFERRED to Inc 6: `cell` returns `Cell` (number|string), and
    MAP/BYROW produce lists AND matrices, so widening `Cell` to carry null/error ripples into the
    frame/popup layer — do it with the frame extension.
  - Note: deeper "`null` PROPAGATES through arithmetic in the evaluator" (`null * 2` → `null`, vs
    JS coercing null→0) is a separate eval-core change, not these sentinel flips — track separately.
- **[~] Inc 5 — logical type.** Sub-sliced:
  - **[x] 5a — socket family foundation.** Added the `logical`/`logicallist`/`logicalcombo`/
    `logicaltable` lattice family (the accept-sets, areCompatible, canConnect all DERIVE from the
    FAMILIES row — verified by new `socketConnect.test.ts` cases). `--sock-logical` mapped to the
    **purple** slot (scalar/array/matrix) in `SOCKET_VARS`; SocketComponent renders it
    circle/square/grid; `logical*In/Out` factories in `shared.ts`; legend + ConnectionDialog label
    "Boolean". Inert until 5b — no node emits it yet.
  - **[~] 5b — emit + display + coercion.** Sub-sliced:
    - **[x] 5b-i — display booleans.** `formatListCell` + `ValueDisplay` render a logical as
      `TRUE`/`FALSE` (scalar + in-list + clipboard); `DisplayValue` allows `boolean`. Inert-ready
      (nothing emits a boolean yet). Tested.
    - **[x] 5b-ii — emit + coercion.** **ComparisonNode** + **IsCheckNode** now output
      `logicalcombo` and emit real booleans (renders TRUE/FALSE). Added the cross-family coercion
      edges **logical↔number** in `SOCKET_ACCEPTS` (rank-mirrored) + runtime `boolsToNums`/
      `numsToBools` in `coerceInputs` — so `(a>b)*10` and existing comparison→math seed wires keep
      working (seeds.test green), and a 0/1 still feeds a logic input. Alert boolean mode accepts a
      raw `TRUE` too. `broadcastLogical` helper added. **LogicalNode DEFERRED** (next): its IF is a
      value passthrough while AND/OR/… are boolean, so its output socket is op-dependent (a
      Cast-style swap) — do that separately. Tests updated (IsCheck → TRUE/FALSE; new logic.test.ts;
      coercion-edge cases).
    - **[x] 5b-ii-rest — LogicalNode** op-dependent output. AND/OR/XOR/NAND/NOR/XNOR/NOT now emit
      real booleans on a `logicalcombo` output; IF stays a value passthrough on `numlist`. The
      output socket swaps in place on op change (`applyLogicalOp`, mirroring Cast's target swap —
      drops outgoing conns only when the socket family actually changes; logical↔number coerce so
      most survive). `LOGICAL_BOOL_OPS` + `logicalOpOutput` helpers. Tested; added an AND demo to
      the seed.
  - **[x] Test node gained `ISNULL`** (author-requested) — element-wise first-class-`null` test
    (each null cell → 1 over a list, pairs with Coalesce/Fill), distinct from `ISBLANK`
    (whole-input). Added to `IsCheckOp` + data() branch + op dropdown; tested. Emits 0/1 today;
    flips to logical with the rest of IsCheck in 5b-ii.
  - **[~] 5c — Kleene wiring.** DONE for **Comparison** (a null operand → null per element),
    **LogicalNode** AND/OR/XOR/NAND/NOR/XNOR/NOT (via `kleeneAnd/Or/Not`), and **IF** (a null
    condition propagates → null). New null-aware element broadcaster `broadcastEl<T>` in logic.ts
    replaced `broadcastLogical` (removed as dead). Tested (comparison-with-null, AND/OR Kleene
    tables, IF-null). **Filter** done too: a null/unknown predicate cell → row EXCLUDED (SQL WHERE
    keeps only TRUE), `isMissing(x) ? false` in the predicate path; the mask path already excluded
    null/unknown. Filter's output TYPE stays `number[][]` (a kept null cell is a runtime value) —
    the honest `(number|null)[][]` typing waits for Inc-6 matrix-null (it ripples into TableDisplay's
    `Cell`). **5c COMPLETE.**
- **[~] Inc 6 — frames/matrix null.** Done: FrameInput CSV parse preserves null; `Cell` widened to
  `number|string|null` across `tablePopupStore`/`tableLambda`/`TableDisplay`; `tableLambda.cell`
  emits `null` (not NaN) so MAP/BYROW/MAKEARRAY carry null; `TableDisplay.fmtCell` renders null as
  "" (was "-∞"); **numeric `Mat` widened to `(number|null)[][]`** — `parseTableText` preserves blank
  cells as null (a row with content; an all-blank row is still greedily dropped → null table), and
  `asNumericMatrix` rejects a missing cell with **`#VALUE!`** (linear algebra needs complete data)
  so MMULT/MDETERM/MINVERSE guard before the pure-number kernels (`NumMat`). **Matrix per-cell
  `SolError` DONE:** `Cell` widened to `…| SolError` (`tablePopupStore`/`tableLambda`/`TableDisplay`);
  `tableLambda.cell` propagates a per-cell error so MAP `1/0` → `#DIV/0!` (not null); `fmtCell` and
  the popup `toGrid` render the `#CODE!` (toGrid guards like the boolean case, no crash). **Filter's
  output type is now the honest `(number|null)[][]`** (was held back for the TableDisplay ripple,
  now unblocked; dropped the test cast). **`FrameColumn` logical + per-cell error DONE:** added a
  fourth `FrameColType` (`"logical"`) and a shared `FrameCell = number|string|boolean|null|SolError`;
  `FrameColumn.values` carries them. `inferColumn` detects all-`TRUE`/`FALSE` (case-insensitive) → a
  logical column of real booleans (numeric runs FIRST so a 0/1 mask stays numeric, matching
  pandas/Polars import). `formatFrameCell` renders boolean→TRUE/FALSE and SolError→code; `splitFrame`
  maps a logical cell to 1/0 (error/text/null → NaN); `frameToGrid` stringifies booleans + passes
  errors through (popup renders the code, no crash — same guard as TableDisplay). `GetColumn` reads a
  logical column as 1/0 (number) / TRUE-FALSE (text) and propagates a per-cell error; `AddColumn`
  carries a null/text/error cell into the new column verbatim. Popup boundary: `FrameChip` maps
  `logical → "string"` for the popup's `columnTypes`, so the (number/text/date-only) editor shows
  TRUE/FALSE as text — **editing a logical column in the popup demotes it to text on Save** (re-infers
  on next CSV import; Get/Split/display stay logical-aware). REMAINING: the popup grid shows an error
  as code text, not yet a red badge (the only open Inc 6 polish item).
- **[x] Inc 7 — persistence: resolved by design, NO new save-format fields.** What persists is
  source data (node `init`/`literals`/`stringLiterals`, incl. a Frame Input's `frameText`); computed
  values — comparisons, logic, per-cell `SolError` — are never stored, they regenerate on recompute.
  So the only array-semantics value that needs to survive a save is a Frame Input's logical/null
  cells, and it does: a CSV `frameText` re-infers `TRUE`/`FALSE` → logical on load, and the JSON
  `frameText` form preserves an explicit `"logical"` type + `null` (parser updated). Locked with two
  round-trip tests in `frame.test.ts`. The save `v` field is unchanged.
- **[x] Inc 8 — Coalesce / Fill node.** New `FillNode` (`list.ts`) + `FillComponent` — one bundled
  op-dropdown node (`FillOp`): `constant` (fill with a wired/literal value, default 0), `ffill`/`bfill`
  (carry the nearest present value over gaps), `mean`/`median`/`mode` (impute from present values),
  `interpolate` (linear across interior gaps; open-ended/error-bounded gaps stay null — no
  extrapolation), `drop` (remove gaps, shortens), `coalesce` (first present of List then Else, per
  position — SQL COALESCE; 2-source, composable for N). Mode-gated inputs like FilterNode: `value`
  shows only for constant, `else` only for coalesce. **A per-cell `SolError` is NOT a gap** — every
  mode passes errors through untouched (it fills missing, doesn't repair errors); the statistics
  impute from present FINITE numbers only (skip null AND error). Registered (kind=list, catalog
  "Coalesce / Fill" under Lists▸Shape). Native node, no `nodeExcel` entry. Unit-tested in
  `list.test.ts` (every mode + error-passthrough + stats-skip-error).
- **[~] `any`-socket pass — LOGIC done, SHAPE audit open.** The non-ISNULL IS-checks
  (`isnumber`/`istext`/`isnontext`/`islogical`/`iserror`/`isna`) were 1-D-only (a `broadcast` over
  `number|number[]`), so a 2-D table mis-mapped over its ROWS — the same bug ISNULL had before
  `deepNull`. Rewrote them as a per-cell `deepTest` to any depth (scalar/list/matrix), each cell's
  own type answering. This ALSO fixed a latent bug: the old `iserror`/`isna` used `!Number.isFinite`,
  which flagged a per-cell `null` (now possible in lists) as an error — `iserror` is now `isSolError`
  (a gap is not an error), `isna` is `#N/A` only, `islogical` accepts real booleans + 0/1. `isblank`
  stays whole-input (per-cell missing is ISNULL's). Tested in `logic.test.ts`. STILL OPEN: the
  **socket-SHAPE audit** the author flagged — which `anyIn`/`anyOut` (rendered as 1-D split-squares)
  should be `anytable` (2-D grid) to signal they carry matrices. The matrix nodes already use
  `anyTableOut` for their 2-D outputs; the ambiguous cases (e.g. IsCheck's `logicalcombo` output now
  can carry a 2-D boolean) need the author's eye on the deploy to pin down — held for review, not
  rewired unilaterally.
- **"Null & Logical" seed extended (clusters G + H):** G = Coalesce/Fill over `1,null,3,null,5`
  (constant/ffill/drop/interpolate/coalesce, each → a Display showing the expected result in the
  node label); H = 2-D IS-checks over `[[1,null],[null,4]]` (ISNUMBER + ISNULL per-cell). Lets the
  author tick the Inc 8 + any-socket-logic rows straight off the deploy. Checklist
  (`docs/null-logical-verification.md`) updated to reference G/H.
- Note: list-OUTPUT reducers (Rolling, and any reducer returning a list with possible gaps) wait
  for the display layer (done, Inc 3) — emitting `null` into a list output needs the display to
  render it.

### Fix: editable Table Input went uneditable when its CSV parsed to nothing (2026-06-22)
Author-reported: editing a Table Input's CSV to just `,` blanked the box to `—` with no chip → the
node became wholly uneditable. Root cause: `parseTableText` (`matrix.ts`) maps each cell through
`parseFloat`, and an all-blank input → `[[NaN, NaN]]`, which the NaN-guard rejects → returns `null`
→ `TableDisplay`'s empty branch rendered `—` with no chip. Fix: `TableDisplay` keeps an editable
chip (1×1 `[[0]]` starter + an "empty" hint) whenever `onSave` is set, so the grid editor stays
reachable; the user grows it via the popup's Add Row/Col or CSV view. **Deeper follow-up (Inc 6 /
matrix-null):** `Mat` is `number[][]`, so a blank cell can't yet round-trip as a real `null` — once
matrix cells carry null, `,` should parse to `[[null, null]]` (a real 1×2 missing-cell table) rather
than collapsing the whole table to `null`. (`ISNULL` already reads the current whole-`null` value
correctly — that part's fine.)

### Fixes: ISNULL unwired-vs-null + a table-into-Test crash (2026-06-22, author-reported)
- **App blacked out** when a 1×1 Table `[[1]]` was wired into the Test node and its result chip was
  clicked. Cause: `IsCheckNode` isn't 2-D-aware, so ISNULL `.map`ped over the matrix's ROWS and
  produced a degenerate `[false]`; clicking the chip opened `TablePopup`, whose `toGrid` ran the
  boolean cell through `formatScalar` → `false.toFixed()` **throws** → the popup render crashed the
  whole React tree (black screen). Fixes: (a) `TablePopup.toGrid` renders booleans as TRUE/FALSE
  instead of feeding `formatScalar` (the actual crash guard); (b) ISNULL now tests per-CELL to any
  depth (`deepNull`), so `[[1]]` → `[[false]]`, lists and matrices both correct.
- **Unwired ISNULL read TRUE** (conflating unwired with a wired `null`). Fix: `IsCheckNode` now
  treats `raw === undefined` (no operand) as "nothing to test" → blank (`null`) output, distinct
  from a wired `null` value (`[null]`, raw === null) which still reads as null. Applies to all IS
  checks (unwired → blank).
- STILL a 1-D Any limitation: the OTHER IS-checks (`isnumber`/`iserror`/…) still use the 1-D
  `broadcast` and IsCheck's output socket is `logicalcombo` (1-D) even for a matrix input — fold
  the per-cell/2-D treatment into the queued **`any`-socket 2-D pass**.

### Seed: `null-and-logical.json` + GetColumn preserves null (2026-06-22)
Added a **"Null & Logical"** seed graph (`seedGraphs/null-and-logical.json`) — a one-load visual
checklist for the whole array-semantics batch: (A) aggregators skip a CSV-blank null (SUM/AVERAGE
denominator), ISNULL flags it; (B) a comparison emits real TRUE/FALSE on a purple socket and
coerces to 1/0 into `×10`; (C) per-cell `#DIV/0!` (`1/[1,0,2]`) and `#VALUE!` (cast `"abc"`) stay
in the list; (D) the table-into-ISNULL crash case + unwired-ISNULL-is-blank; (E) the empty editable
Table Input. To make cluster A real, **GetColumn now preserves `null`** (a blank frame cell flowed
as `NaN` before — `frame.ts` map `v === null → null`, not the `return NaN` fallback). Another
frame→list producer brought in line with the null model; unit-tested.

### Fix (Inc 6 start): FrameInput parsed a blank CSV cell as 0, not null (2026-06-22, author-reported)
The seed's CSV showed `0`s where the column had blanks, and editing a FrameInput's CSV (delete a
cell → blank) round-tripped to `0`. Root cause: `frameFromInputText`'s CSV branch did
`Number(cell.trim())` and `?? 0` (so `Number("")` → 0) AND used the numeric-matrix builder
`frameFromInput`, bypassing `inferColumn`'s null handling. Fix: route the CSV branch through
`frameFromCells` (the same type-inferring, null-preserving reader CSV import uses) — a blank cell
is now `null`, and text/date columns type correctly instead of being forced numeric. The popup's
own paths were already correct (`buildFrameColumns` blank→null, JSON save via
`frameColumnsToInputText` preserves null), so this single fix resolves both reports. Now the seed's
cluster A shows real nulls (AVERAGE 8/3, ISNULL flags). `frameFromInput` is now orphaned (left for
a later sweep). Tested (CSV blank→null + JSON round-trip).

**Queued follow-ups (after the core increments):**
- **`any` socket dimensionality pass (author-flagged 2026-06-22).** The currently-implemented
  `any` sockets (`anyIn`/`anyOut`) signal **1-D Any only** (scalar / 1-D list). Some should be
  upgraded to **2-D Any** (accept matrices/tables too) — audit every `anyIn`/`anyOut` against the
  node's real capability, especially in the blast radius of the null/logical/error changes (a node
  that now must pass null/error/logical through a 2-D structure needs a 2-D-aware Any). Decide the
  socket-lattice representation for "2-D Any" and which nodes upgrade.
- **TablePopup / cable-inspector per-cell error+null badging** (deferred from Inc 3).
- **`cast.test.ts:62-63`** flips when the cast producer lands (a bad element becomes a per-cell
  error, not `NaN`).

### Fix: complex node headers rendered blue, not sky (2026-06-22)
`nodeKindOf` (`nodes/kind.ts`) never had a branch for the `Complex*` classes — they weren't even
imported — so all five fell through to the final `return "math"` → `blue` header. The `complex`
kind (slot `sky`) existed and the catalog set `accent: CX`, but the catalog accent only tints the
**Add-menu** entry; the on-canvas header always comes from `nodeKindOf`. Added the `complex`
branch. (Gotcha for future node families: a kind in `NODE_KIND_SLOTS` does nothing until
`nodeKindOf` actually classifies the class — the two lists must stay in lockstep.)

## TablePopup formatted/source date toggle — generalization seam (2026-06-21)

Read-only frame popups with a date column now get a Formatted/Source segmented
toggle (`TablePopup.tsx`): Formatted (default) renders serials as ISO via
`formatDateSerial`, Source shows the raw serial. Display-only — `displayGrid` does
the substitution at render + copy/CSV time; the editable `grid` stays the raw
serial truth (so edit mode is hidden from the toggle and always shows serials).

**Deliberately date-only for now, but built to generalize.** The real concept is
"rendered value vs underlying stored value"; dates (serial ↔ ISO) are just the
first instance. It's scoped to dates because dates are currently the ONLY thing
the popup formats away from source — number columns render near-raw (`formatScalar`
only, no FC styles, no `unit`). A generic toggle today would look identical for
every non-date column (dead UI). **When we make the popup FC/unit-aware** (the
flagship unit feature: `0.155`↔`15.5%`, `1234.5`↔`$1,234.50`), promote this:
rename `dateMode`/`hasDateCols` → `displayMode`/`hasFormatting` and add per-type
branches next to the date one in `displayGrid`. That's the one place to extend.
Treat the FC-aware version as its own author-approved task (net-new, touches the
unit path).

## Reload the current document on demand (2026-06-21)

Browser reload doesn't re-run the startup cinematic, so `documentStore.reloadCurrent()`
gives an in-app way: it's a GENUINE reload (capture the live graph → `showCurrent(true)`,
the same teardown+rebuild path as a startup/document load), so the build→reveal plays
naturally — not an animation-only replay. Wired to File → "Reload document" and the
deliberate combo **Ctrl+Shift+L** (single-letter keys fire too easily; avoids the
browser's own Ctrl+R / Ctrl+Shift+R / F5). Guarded by `loadRevealStore.isActive()` so it
can't stack on an in-flight load. (Earlier attempt was a `replayLoadReveal()` that re-ran
only `runReveal` on the live graph + a `showCurtain` overlay flag; author wanted a real
reload on a deliberate combo, so that was dropped.)

## Color-picker popovers: dismiss on outside click, stay open on pick (2026-06-20)

The three swatch popovers — Note, Group (`solenoid-{note,group}__palette`), and the
app-bar accent picker (`solenoid-apptools__palette`) — only closed on a re-click or a
pick, and the app-bar one never closed on click-away. Author wants: click-away closes;
picking a color does NOT (so you can try several). New shared
`components/useDismissOnOutside.ts`: a CAPTURE-phase document `pointerdown` + DOM
containment (not stopPropagation, which the popover swallows and which wouldn't reach a
document listener anyway, and works across Rete's separate React roots). Gotcha: the
opening element (the swatch/paint button) MUST be in the "inside" ref list too —
otherwise a re-click on it fires the capture dismiss (close) and then onClick toggles it
back on. Settings palette switcher is a native `<select>`, no popover to dismiss.

## Socket colors built from the palette (2026-06-20)

Follow-on to the palette system below. Socket colors and the palette were two color
sets that mostly agreed; unified so sockets draw from the palette (one SoT) and follow
a palette switch. Author likes the existing socket colors, so the DEFAULT palette was
**backfit** to them where they differed (gold→`#f5b914` number, green→`#00b890` lambda,
pink→`#de7cb0` date, violet→`#8e64ed` frame; lime/sky/vermilion/gray already matched
string/complex/table/any). Node-kind headers move with their slots (Display/Format=gold,
List=green, etc.) — intended, and it makes kind headers + socket dots consistent.

`SOCKET_SCALAR_SLOTS` (palette.ts) maps each scalar `--sock-*` var to a slot.
`appTheme.apply` live-writes those vars from the active palette (mode-shifted via
`themeAccent`).

**2D variants now derived too (commit after `caa4b63`).** Originally only the scalar
sockets followed the palette (siblings stayed hand-tuned CSS). Author asked to make the
array/matrix variants programmatic from the base. Now `SOCKET_VARS` covers EVERY
`--sock-*` with a `kind`: `scalar` = the slot color, `array` = `socketArrayShade`
(RGB-multiply ×0.8), `matrix` = `socketMatrixShade` (HSL hue +6, L ×0.86). `appTheme`
writes all of them on every apply, and the `--sock-*` defs (dark + light) were REMOVED
from App.css — only `--socket-ring`/`--cable-selected` remain. So switching palette/mode
retints the whole socket family, dots + cables + legend, from one source.
- **Fit:** an RGB-multiply darken reproduces the old hand-tuned dark arrays well for
  complex/date (ΔE ~1–5) and matrices (ΔE ~4–6). The **string array** comes out a touch
  brighter than its old deliberately-extra-dark olive (anti-wash-out tweak), and
  **light mode** shifts off its former bespoke per-var values (now `themeAccent`-derived).
  Author chose fully-programmatic over keeping those exceptions. (Validated with a
  throwaway Machado/ΔE sibling-fit script — deleted.)
- `--sock-table` (numeric matrix) is its OWN scalar slot (`vermilion`), not a derived
  shade of number — so it's a `scalar` mapping, not a matrix one.
- Because all `--sock-*` are JS-written now, they're set at startup by `initAppTheme`
  before the graph paints; App.css holds no fallback.

## Stored colors are palette SLOT ids, not frozen hexes (2026-06-20)

Author spotted that note/group colors looked slightly off the palette. Root cause:
Notes, Groups, and the app accent all stored the **literal hex** picked at the time,
and the picker hexes are derived from `NODE_KIND_ACCENTS`. When the kind accents were
retuned (socket-color work `477f946`), every object holding an old hex silently
drifted off the live palette — a stored `#00b890` no longer equalled the new green
`#2fae7a`. (Confirmed: the PF seed had `#00b890`/`#c8553d`/`#c89b2a`/`#e0b84a`/`#8a909c`,
none matching current accents.)

Fix = **indirection through one live palette.** `palette.ts` now owns `PALETTE`
(`slot → hex`, e.g. `green: "#2fae7a"`) as the single source of truth; `NODE_KIND_SLOTS`
maps each kind to a slot and `NODE_KIND_ACCENTS` is *derived* from it, so kinds and
swatches can never disagree. Stored colors are **slot ids** (`"green"`), resolved to a
hex at render via `resolveColor(slot)`. Retuning a color is now one edit in `PALETTE`
and everything retints; nothing can drift again.

Touch points (resolve at the boundary, store the slot): `NoteNode`/`GroupNode` render,
`groupMembership` (stores the *resolved hex* so NodeCard/FormulaPopup are unchanged),
`Minimap` group fill, `appTheme` (accent stored as a slot, resolved when writing the
`--accent` CSS vars; default `"sky"`), `AppToolbar` dot. `SwatchGrid` deals in slots
(`value`/`onPick`), resolving each only to paint the disc. Node defaults: Note `"amber"`,
Group `"violet"`, group `majorityColor` returns a slot. No back-compat (pre-alpha):
`resolveColor` is slot-only (unknown → gray), so a pre-token save's raw hex resolves to
gray until re-picked. Re-opening a migrated seed is correct.

**Why slot NAMES, not palette indices:** the swatch order can change; a slot id is
stable. Slot ids are **opaque keys** — code must never assume `green` is green-hued.

**App switcher + per-doc overrides (author asked for both in the same session).**
`paletteStore` makes the palette dynamic: the effective map = `BUILTIN[docBase ?? appBase]`
with the open document's per-slot overrides layered on top.
- **Built-in palettes** live in `palette.ts`: `Default`, `Muted`, `Colorblind-safe`
  (Okabe–Ito-derived, first pass — tweak freely). Add a palette by adding an entry.
- **Alternate palettes** (`Muted`, `Colorblind-safe`) are tuned by feel: Muted = Default
  hues at ~0.62 saturation (an earlier 0.5 washed out); Colorblind = Default hues with
  lightness varied for CVD then COMPRESSED toward mid (full spread read too harsh; min
  CVD ΔE ~8.7 now vs ~16.9). CB is INTERIM — backlog item to re-derive from an outside
  scheme.
- **App switcher** is **Settings ▸ Appearance** (NOT the accent dropdown — author moved
  it there). `paletteStore.setActiveBase` persists to `localStorage` like dark mode and
  retints the WHOLE app. The retint trick: `NODE_KIND_ACCENTS` is mutated live by a
  `paletteStore.subscribe` in `shared.ts`, and `appTheme.ts` subscribes too → `apply()`
  (re-resolves `--accent`) + `notify()`; since every node card / note / group already
  subscribes to `appThemeStore` for dark mode, they re-render for free — no `Canvas.tsx`
  edit. The switcher handler also calls `rebuildGroupMembership` (that store caches
  resolved member-dot hexes).
- **Per-doc overrides** ride in `SavedGraph.palette` (`{ base?, overrides? }`),
  round-tripped in `persistence.ts`: `serializeGraph` writes the open doc's declaration,
  load calls `paletteStore.setDocPalette(g.palette ?? null)` BEFORE rebuild so colors
  resolve right (and clears it for docs without one, so a pin doesn't leak between docs).
  No editor UI — declared in JSON / by seeds (author's call: JSON-declared is enough).
- **Cycle-safety:** `palette.ts` is a leaf (imports only `storeKit`); `shared`/`appTheme`/
  `persistence` import IT. Subscribers run synchronously on a palette change, before
  React re-renders, so `NODE_KIND_ACCENTS` is fresh by the time anything reads it
  (subscriber order doesn't matter). `initPalette()` (called first inside `initAppTheme`)
  notifies so a persisted non-Default palette syncs at startup.

All 12 seeds with note/group colors were migrated (nearest-slot by RGB) via a one-off
script (since deleted); `gen-personal-finance-seed.cjs` updated to emit slots so the
lockstep test stays green. Chart/ColorPicker/cable-flourish colors are genuine hex
*values*, left untouched. tsc clean, 652 tests green.

**Settings UI + CVD-audited Colorblind palette.** Switcher is a `<select>` in
Settings ▸ Appearance (Lucide chevron-down, native arrow hidden via `appearance:none`)
with a read-only `SwatchGrid` legend stacked under it on the right (new `readOnly`
prop → plain spans, no buttons/hover). The Colorblind-safe palette was tuned with a
throwaway simulation tool (Machado 2009 protan/deutan/tritan matrices → CIE76 ΔE):
a naive 12-color set had pairs at ΔE ~4 (amber/lime, blue/purple) and the author
flagged teal/sky + purple/violet. Fixed by anchoring each slot to its Default hue
family and spreading LIGHTNESS (the only lever CVD viewers keep) — min pairwise ΔE
is now ≥ 16.9 across all three deficiencies. Cost: the warm band (vermilion/amber/
gold/lime) is hue-crammed, so gold→deep bronze and vermilion→deep brick to stay
distinct. Lesson: 12 fully CVD-distinct hues is impossible (Okabe–Ito caps at 8);
lightness spread is mandatory, and a hue-anchored optimizer beats hand-picking.

## Cable inspector panel — roadmap Phase 0 legibility slice (2026-06-20)

Lower-left popup (`components/CableInspector.tsx` + `cableInspector.css`, mounted by
one line in `Canvas.tsx` alongside the other self-mounting overlays). Shown when
EXACTLY one cable is selected (`cableSelectionStore.count() === 1`); multi-select
shows nothing (ambiguous to inspect). Displays both ends — From: source node title
(`node.label` ?? `nodeTypeName`) + output port label; To: target node title + input
port label — plus a VALUE row with the value on the wire.

Resolution mirrors `PinLayer`: connection from `editor.getConnections().find(id)`,
value from `cableValueStore.get(source, sourceOutput)`, rendered through the SOURCE
node's Format Controller (`formatNumberWithAnnotation`) with the same error / list /
table / frame branches (ArrayChip / FrameChip / `#CODE!` badge). Subscribes to
`cableSelectionStore`, `cableValueStore`, `connectionVersionStore` (renames/topology),
`formatAnnotationStore` (live FC restyle). From/To titles fly-to on click; × clears
selection (which also hides the panel).

Gotcha worth keeping: the wire value and the "value as received" are the SAME stored
value today — `cableValueStore` holds source OUTPUTS, and there's no per-input
transform stored, so showing it twice (once per end) read like a duplicate bug.
Collapsed to a single VALUE row; when the Phase 2 Rust engine adds coercion that can
diverge received-from-sent, add a second row THEN, not before. Verified live via
puppeteer (clicked a `.solenoid-cable-hit` path → panel showed "Full name · Result →
Name badge · In · ada lovelace"). tsc clean, 652 tests green.

Three follow-ups from the author's eyeball: (1) a RIBBON (2+ Conduit lanes bundled
under one repId) was shown as a single From→To, which misrepresents it — now
`ribbonForConnection(editor, conn)` non-null returns null, so ribbons are skipped
while a separated single lane still inspects. (2) The panel at `bottom: 16px` overlaid
the 19px status bar; moved to `bottom: calc(19px + 12px + env(safe-area-inset-bottom))`
so it clears the footer. (3) "Go to this node" flew WAY off when the node was hidden
in a collapsed group — a raw `zoomAt` targets the hidden element's stale ~0,0
position. Root cause was shared: PinLayer + AlertLayer + the cable inspector each had
their own naive `flyTo`. Factored ONE `flyToNode(nodeId)` (`src/graph/flyToNode.ts`)
that walks up via `groupCollapseStore.isNodeHidden` + `GroupNode.members.includes` to
the nearest VISIBLE ancestor group and flies there; all three now route through it
(same node→group resolution the Canvas E-collapse target picker uses).
   A SECOND collapsed-group bug surfaced after that: even flying to the group
   landed off-center. `AreaExtensions.zoomAt` → `getNodesRect` frames
   `node.width`/`node.height` when defined, and a collapsed group KEEPS its
   expanded dimensions (collapse is visual), so it framed the big expanded box,
   not the compact ~264px card. Fix: when the resolved target is a collapsed
   group, `flyToNode` passes a SIZELESS ref (`{ id }`) to `zoomAt`, which makes
   getNodesRect fall back to `view.element.clientWidth/Height` (the rendered
   compact box) — the same compact-box approach as the minimap's
   `collapsedAwareNodesRect`. Plain nodes still pass the real node (unchanged).

## Motion functions weren't persisting layout (tidy lost on reload) (2026-06-20)

Author report: tidy a graph, reload, the tidy is gone. Root cause: in Canvas's
`arrangeFn`, `scheduleAutosave()` was called ONLY inside the `if (withinGroup)`
branch — so a whole-canvas Tidy or a selection Tidy moved every node via
`area.translate` but never scheduled a save. `expandCollapseGroups` had the same
gap (collapse state persists via each Group's `init.collapsed`, but nothing saved
it). Both now `scheduleAutosave()`; the 700ms debounce reads positions at flush, so
the deferred standoff/FC settle is still captured. The other "motion functions"
were already fine: Cleanup (end of `setCleanup`), autofit (`autofitGroupWithHistory`),
arrow-nudge, and `[`/`]` rotate all schedule a save; pure view Fit changes no
persisted state (the viewport transform isn't saved).

## A combo may narrow into its element scalar — the PF "-$2000" root cause (2026-06-20)

The Personal Finance "Projected nest egg" read **-$2000** instead of ~$1.55M, and
several other cables were silently missing on load. Root cause was NOT the seed:
the polyform rework made `ExpressionNode` output the **combo** dim (`numlist`, via
`resultOut(_, "combo", _)`), and `canConnect` blocked a combo from narrowing into a
strict `number` input. So the seed's scalar-math Expressions (`ret/100/12`, `-nw`,
`term*12`, …) feeding `tvm-fv` / gauge / `cumipmt` scalar inputs — **10 cables** —
dropped at load; those nodes fell back to their default literals (`TvmNode`:
`pv=1000, rate=0.05, nper=12, pmt=0` → `FV` = -$1796 ≈ "-$2000").

**Fix (`sockets.ts`):** a COMBO (`numlist`/`strcombo`/`datecombo`/`complexcombo`)
may narrow into its element SCALAR — a combo *can be* a scalar, that's its whole
point — while a plain `list` (1-D only) still cannot. The rank model can't express
this (combo and list both `DIM_RANK` 1), so it's an explicit exception in the
`SOCKET_ACCEPTS` derivation: `map[fam.scalar].push(fam.combo)`. Runtime shape-checks
if the combo turns out to be a list (same accepted risk as `anytable`).

**Why it hid for so long (the real lesson):** `seeds.test.ts` validated connections
with the **symmetric `areCompatible`**, which passes `numlist↔number` (because
`number→numlist` widening is legal). The APP uses the **directional `canConnect`**.
So a connection can be "compatible" yet **dropped on load**. Switched `seeds.test`
to `canConnect` (out→in) — the real guard — and it instantly caught a 2nd
pre-existing drop (the error-codes `#SHAPE!` demo wired `table→number`, blocked at
connect-time so it never fired; reworked to a non-square 2×3 → `MDETERM`, a
connect-valid wiring that genuinely yields `#SHAPE!`). Lesson: seed/connection
guards must use `canConnect`, not `areCompatible`.

## Pinned values render through their Format Controller (2026-06-20)

`PinLayer`'s `renderValue` was standalone (`formatScalar`, no FC). It now takes an
optional `annNodeId` and, for numbers, formats via `formatNumberWithAnnotation`
using `formatAnnotationStore.getForNode(id)` — same path as the node's own display
and the collapsed-group readouts — so a pinned `$`/`%`/decimals value reads
formatted. Passes `pin.nodeId` (regular pin) / `t.effNodeId` (group rows); subscribes
to `formatAnnotationStore` so it restyles live. Scalars only; `ArrayChip` lists
unchanged (would need a formatter prop).

## Note: manual resize + click-to-edit header to match other nodes (2026-06-20)

Notes got a bottom-right resize grip (manual W/H like Groups; min 160×80, no max;
height now manual so the body fills + scrolls), and the title became a click-to-edit
`fit-content` display mirroring a regular node's `__label-display` — so the textless
part of the bar is a real drag surface (previously the always-on `<input>` spanned
`calc(100% - 60px)`, which is why the Note needed the coarse-aware touch-drag hack;
now it uses unconditional stopPropagation like every other node header). Resize
release snaps the corner to grid + re-settles standoffs (pinned, deferred a frame).
The Tab hotkey also folds/unfolds it (chrome-toggle registry), and the per-row
Rename pencil + navigator Position/A–Z sort shipped this session too.

## Overlay chrome: thicker border, lighter shadow (2026-06-20)

Author's eye: the right-side floating chrome read too heavy — and the socket legend
in particular looked far heavier than the minimap **despite using the identical
tokens**, because the same wide soft shadow spreads over a bigger perimeter. Fix is
a re-weighting, not new structure: lean on a defined BORDER, pull back the SHADOW.

- New token **`--overlay-border-width`** (App.css, base `:root` only — width is
  theme-agnostic, so the light ramp inherits it). Set to **2px** (author picked 2
  over 1.5). Every `--overlay-border` consumer now uses
  `border: var(--overlay-border-width) solid var(--overlay-border)` instead of a
  hardcoded `1px` — so the weight lives in ONE place: Minimap, SocketLegend (panel +
  collapsed launcher), pinLayer (trigger + chips), alertLayer (trigger + chips),
  LoadOverlay.
- **`--overlay-shadow`** softened in BOTH ramps: blur 26→14, y-offset 8→4, opacity
  ~⅓ down (dark 0.6/0.45 → 0.4/0.3; light 0.2/0.12 → 0.14/0.08).

Gotcha for next time: the border *width* was NOT tokenized before — only the color
(`--overlay-border`) was. So "make overlay borders thicker" can't be a one-line
token edit until you add the width token + repoint the consumers (done now).

## Pin action inside value pop-ups (2026-06-20)

The Table/Frame/List, Formula, and Chart pop-ups were view/edit only. They now
carry a **Pin** button in the header (beside Close) that pins the host node's value
to the HUD — the same gesture as the node's right-click "Pin value", available
without leaving the popup. It reflects the pinned state live: muted normally,
accent-filled while pinned (subscribes to `pinStore`).

How the popup learns its host node, the non-obvious part: the popups are opened
from inside a node body (a value chip, the chart expand button) which rete renders
in a separate React root, so there's no shared React tree to read a node id from.
But there already WAS one piece of context for this — `NodeFormatContext`, which
NodeShell provides (`value={node.id}`) so a value box can find a docked Format
Controller. I reused it: the chips / chart-expand button read it via a new
`useHostNodeId()` hook and tag the popup state with `pinNodeId`. The popup shows
the Pin button only when `pinNodeId` is set. The chips also accept an EXPLICIT
`pinNodeId` prop (overrides context) for the case with no NodeShell ancestor but a
known node — a **collapsed-group readout** passes its member id (`t.effNodeId`,
the node whose value the chip shows) so you can pin a group member straight from
the collapsed summary. (Watch the Rules-of-Hooks trap: `pinNodeId ?? useHostNodeId()`
short-circuits the hook — read the hook into a var first, then prefer the prop.)
- Only the **HUD pin chips** (PinLayer) render with no `pinNodeId` and outside any
  context → no Pin button, which is right: a HUD chip is already pinned.

Gotchas worth remembering:
- **Moved `NodeFormatContext` out of `nodeKit` into `components/nodeContext.ts`.**
  `nodeKit` imports the chips and the chips now need the context — keeping the
  context in `nodeKit` would be a live (module-eval) import cycle. The standalone
  module (imports only React) breaks it.
- **One `pinNodeValue(nodeId)` helper in `pinStore`** now owns the
  nodeId → (nodeId, outputKey) resolution (group → empty key; else first output
  key). Canvas's `handlePin` is just `pinNodeValue` now, and the popup button calls
  the same thing — no duplicated logic. It tests `constructor.name === "GroupNode"`
  (not `instanceof`) so a Vite hot-swap of the class doesn't silently stop matching
  live node instances (same reasoning as FormulaPopup's host detection).
- `pinStore` now imports `getEditor` from `process` — a safe one-way edge (process
  doesn't import pinStore, nor does anything it imports).

Not done (left in backlog under the same item): the original note's "+ more"
actions — export, "go to node", copy-as. Copy already exists in TablePopup.

## Arrow-nudge + group-resize snap + dots-only grid (2026-06-20)

Three small canvas-movement tweaks, all in one session.

**Arrow-key nudge.** Arrows move the selected node(s) by one grid cell (`DOT_SPACING`
= 24px), Shift = four cells (96px). Wired in Canvas's no-modifier keydown ahead of
the `!shiftKey` split (so Shift only scales the step), preventDefault decided
synchronously (the move is async). `nudgeSelection(dx, dy)` builds the move set as
a **closure over two expansions**: a selected GROUP carries its members, and
touching any node in a STANDOFF cluster carries the WHOLE cluster — both feed one
queue so they compose. The cluster expansion is the non-obvious bit: moving only
one end of a standoff and then re-settling pulls it ~half-way back (the solver
splits the violation), so a standoffed note/group nudged half as far as a free one
until the whole cluster moved rigidly. Moves go through `area.translate`, which the
history plugin auto-records as `DragNodeAction` (merged within its timing window),
so a nudge is undoable for free; docked FCs follow via `repositionDockedNodes`.

**Group bottom-right resize snaps to grid.** In snap mode, releasing the BR resize
handle lands that corner on a dot (snap-on-release, like a dropped node). The
top-left is fixed during a BR drag, so snap the corner's WORLD position
(`pos + size`) and derive width/height, clamped to the group min.

**Dots-only grid + dot phase (the subtle one).** Snap was a 12px half sub-grid
(`GRID_SNAP_STEP = DOT_SPACING/2`); author wanted dots-only, so step = `DOT_SPACING`
= 24. But the dots are drawn by `radial-gradient(circle, …)` whose default centre
is the MIDDLE of each 24px tile, so the visible dots sit at world `12 + 24·n`, and
plain multiples of 24 are the square centres BETWEEN dots. `snapCoord` therefore
carries a `DOT_PHASE = 12` offset: `round((v-12)/24)*24 + 12`. Without it, snapping
lands dead between four dots (the bug the author caught).

## Keyboard rotation: `[` / `]` rotate the selected rotatable thing (2026-06-20)

`[` / `]` now step rotation by one quantum, dispatched in Canvas's no-modifier
keydown via `rotateSelection(dir)` (dir −1 = CCW, +1 = CW). It covers everything
the canvas can rotate, picking by what's selected:
- **Standoff** (its own exclusive, standoff-local selection — handled first):
  reads the current axis angle from `ANCHOR_DIR[a.anchor]`, adds ±45°, converts
  back to the nearest compass anchor via `anchorFromVector`, `setAxis` +
  `settleStandoffs` — exactly mirroring the inspector dial's `onAngle`.
- **Conduit(s)**: `node.rotateBy(±1)` (the 45° quantum).
- **Angle Dial node(s)**: `value += ±node.step` (each node's own step, default
  15°), normalised to [0,360); `processGraph()` re-renders + propagates downstream.

The key only swallows the event when something was actually rotated (returns a
count) so `[` / `]` stay free otherwise. Matched on **`e.key`** (the produced
character), NOT `e.code` — `[` / `]` sit on different physical keys across
layouts, so `e.code` (physical position) only equals them on US-QWERTY. The
letter shortcuts get away with `e.code` (KeyA…) because letter positions line up;
punctuation doesn't. Also added to the `ShortcutsOverlay` reference — a static
hand-maintained list, it does NOT auto-generate from the keydown handler.

**Cross-React-root gotcha (the real work here).** Rete renders nodes in a separate
React root, so Canvas can't call the component's setter. The Conduit used to hold
`angle` in local `useState` seeded from `node.angle` — invisible to an external
mutation. Fixed by making the component **derive** `angle = snap45(node.angle)` and
subscribe to a new `conduitAngleStore` version bump (`process.ts`); both the
in-toolbar AngleDial and the keyboard mutate `node.angle` then `bumpConduitAngle()`,
so there's one source of truth and either path re-renders. The Angle Dial node
didn't need a new store — it already had a `useEffect([data.value, editing])` that
re-syncs from `data.value`, so the `processGraph()` re-render picks the change up
(and the `editable` keydown guard means we never rotate while its field is focused).
The standoff path needs no React plumbing — `standoffStore` is module-level and the
layer subscribes to it already.

**Arrows / Tab — RESOLVED (arrow-nudge built 2026-06-20; Tab intentionally not).**
The recommendation below was taken as-is: arrow keys nudge the selection (one grid
cell, Shift = larger, standoff-aware, undoable) — `nudgeSelection` in `Canvas.tsx`,
documented in `ShortcutsOverlay.tsx`; Tab navigation was skipped. Original reasoning
kept for the record. Canvas arrows were previously free (only the Add-menu popup
used them). My read: **arrow keys should NUDGE the selected node(s)' position**
(Shift = larger; respects grid snap)
— unambiguous, standard in design tools, and it sidesteps the "placement is
arbitrary" problem because you move the thing rather than navigate between things.
**Directional arrow *selection*** is geometrically well-defined (nearest node in
the half-plane) but collides with the stronger nudge expectation. **Tab
navigation** I'd skip: there's no natural order on a free canvas (it'd need the
position-reading-order heuristic the Navigator-sort backlog item describes), Tab is
browser-reserved/invasive to hijack globally, and with no inspector panel "focus"
just means select — low payoff. Recommendation: build arrow-nudge if anything;
leave Tab. (Done — arrow-nudge shipped, Tab left out.)

## Personal Finance seed: generator drift repaired + lockstep guard (2026-06-20)

The backlog feared the committed `personal-finance.json` had lost connections to
the cycle's node reworks. It hadn't — all 135 connections still land on live
sockets (`seeds.test.ts` was green). The real defect was in the **generator**
(`scripts/gen-personal-finance-seed.cjs`): it still emitted the deleted
`ReduceNode` for the four sum nodes (red-net / red-nw / red-g / red-bud) instead of
`AggregateNode` (the Reduce→Aggregate rename shipped with no alias, so the class is
gone). The JSON had been hand-patched to `AggregateNode` at some point but the
generator never was — a latent landmine: the *next* `node gen-…cjs` would have
re-introduced four unconstructable nodes, and on load every cable touching them
drops silently (the pre-alpha "skip incompatible" behaviour). Fixed the four
type strings; a regenerate is now byte-identical to the committed JSON (only EOL
differs — generator writes LF, working tree is CRLF via `core.autocrlf`).

Added the guard the note asked for, but stronger than a bare count: a
**generator-lockstep test** in `pfSeedCheck.test.ts`. The generator now
`module.exports = { graph }` and gates its file-write under
`require.main === module`, so a test can `require` it without side effects. The
test asserts (a) connection count matches the committed JSON and (b) the JSON is an
exact `toEqual` re-emit of the generator. That catches silent connection drops AND
generator/class drift in one shot — verified it goes red when the `ReduceNode`
regression is reintroduced. Gotcha for the future: `require("/tmp/..")` from a Node
one-liner resolves to `C:\tmp` on Windows, not Git-Bash's `/tmp` — use repo-local
temp files when scripting comparisons.

## CI / GitHub Actions — Node.js 20 deprecation verified no-op (2026-06-20)

Audited both workflows (`.github/workflows/test.yml`, `.github/workflows/windows-portable.yml`)
against the Node 24 runner migration. All actions are already on current major versions
that support Node 24: `actions/checkout@v4`, `actions/setup-node@v4`,
`actions/upload-artifact@v4`, `Swatinem/rust-cache@v2`, `dtolnay/rust-toolchain@stable`
(always latest), `softprops/action-gh-release@v2`. Project Node version in both workflows
is already `"22"`, not `"20"`. No changes needed; backlog item checked off.

## Icon/glyph button alignment — TWO root causes, both systematic (2026-06-20)

The author flagged a batch of toolbar/panel icon buttons as off-center. There were
two independent causes; the first hid the second.

**Cause 1 — glyph buttons on the text baseline.** The `button { font-family:
inherit }` rule (App.css) changed button line-box metrics, so the `×`/`✕` GLYPH
close/remove buttons (which had only `font-size`/`line-height`/`padding`, no flex)
rode the baseline a few px off. Fixed `.sol-popup__close`, `.fr-close`,
`.solenoid-outline__collapse`, `.solenoid-pin__remove`: `display: inline-flex` +
center + square size + `padding: 0` + `line-height: 1`.

**Cause 2 — odd-sized SVG icons land on half-pixels (the real one).** The SVG icon
buttons ARE flex-centered, so the box is geometrically centered (measured dy=0).
But an **odd-sized icon in an even content-box centers on a fractional pixel**:
a 15px icon in a 28px button (content 26) → `(26−15)/2 = 6.5px` gap. That
half-pixel rasterises blurry and, tellingly, **rounds differently at each browser
zoom level** (the author's "it shifts right when I zoom" — the diagnostic clue).
14px icons (gap 7, integer) were never flagged. Every button content-box in the
app is even (26 / 32 / 18 / 22), so the invariant is simply:

> **Icon-only buttons use EVEN-sized icons** (`width`/`height` even px). Equal
> parity with the even container → integer-centred → no sub-pixel blur or
> zoom-shift. No per-icon `transform` nudges.

Rounded every odd icon to even (15→14, 13→14, 11→12) across `AppToolbar.tsx`,
`NavMenu.tsx`, `TopBar.tsx`, `OutlinePanel.tsx`. Also: the navigator open-pill's
divider was a layout `border-left` on the 2nd button → shrank its content-box to
31 (odd) → icon 0.5px off; replaced with `box-shadow: inset 1px 0 0` (non-layout)
and removed the old compensating `translateX(1px)` nudge. Verified with puppeteer:
all gaps now integer, dx/dy = 0.

**Cause 3 — text-glyph close buttons are never optically centred.** A `×`/`✕`
font character's ink isn't centred on its em (it sits low, near the math axis), so
flex-centring — which centres the *line-box*, not the ink — still leaves it low.
Fixed at the root: a shared **`CloseIcon`** (`components/CloseIcon.tsx`) renders an
SVG × (two crossed lines), symmetric about both axes → centroid IS the viewBox
centre, lands dead-centre at any size. Swapped into all 7 close/dismiss buttons
(popup Chart/Formula/Table, fr-close, outline collapse, pin remove, alert dismiss).
**Rule: use `CloseIcon`, never a text "×", for close buttons.**

**Measuring optical centre (the author asked how).** Three different centres:
(1) *literal* = viewBox centre (where the icon is positioned); (2) *geometric* =
`getBBox()` centre (tight box round the strokes); (3) *optical* = ink centroid =
centre of mass of the rendered pixels. They differ for mass-asymmetric shapes.
Method (standard): rasterise the SVG to a canvas, average the (x,y) of every
opaque pixel weighted by alpha (math equivalent: the shoelace polygon-centroid
formula). Measured offsets from viewBox centre: pushpin centroid +0/−1.38 (head-
heavy → reads high, bbox said centred); lock +0/+0.73 (body-heavy → low); alert
triangle +0/+2.09 (base-heavy → low); sparkle +0.69/−1.03 (upper-right). So
`getBBox`-centred ≠ optically centred. **Applied:** shifted the pushpin viewBox
(`0 -1.4 24 24`) so its centroid sits at centre (both `PinSvg` copies). Alert HUD
trigger/chip icons were 13px (odd) → 14px. Context-menu icon slot made a fixed
16px flex box so a text-glyph icon and the Pin SVG share one column.

**Not fixable — HUD fixed-position zoom jitter.** The pin/alert HUD is
`position: fixed; right: 12px`; at fractional browser zoom, `12px` is a fractional
number of device px and the browser rounds the element's position differently per
zoom step, so the whole button hops ±1px left/right. Every fixed element does this;
the icon stays centred *within* the button. Don't chase it as an icon bug.

Author calls the popup-header (uppercase title vs close) "fine" — left as-is
(uppercase caps ride ~1px above the line-box centre flex uses; within tolerance).

Done as agent 2 (parallel session; see `docs/agent-coordination.md`).

## Standoffs as rigid blocks through layout ops + a design-system pass (2026-06-19)

Two strands this session.

### Standoff-aware layout (the meaty one)
Standoffs now move as RIGID BLOCKS through every layout op, not just band-satisfied.
- `solveStandoffs` gained `{ forceLock }`: treat every standoff as locked (perp → 0)
  for that solve, without touching saved `locked`. `standoffClusters()` returns the
  connected components (the rigid blocks).
- Wired forceLock into expand push, collapse, Tidy (was band-only → the
  "scatter-then-half-reconcile" feel), and added the missing settle to standalone
  autofit. Drag chain-pull stays band-only on purpose (keeps a user's unlocked slant).
- **Expand push moves a cluster as a unit** (`runExpandPushes`): after the heuristic
  push, every cluster member gets the cluster's LARGEST push, so the band isn't
  violated by a lone push — fixes the "expand partly pushes a standoffed node then the
  solver pulls it partway back" bug. Attribution unioned so collapse restores the block.
- **Tidy lays each cluster out as ONE ELK super-node** (the hard part — needed two
  rounds of debugging against the live app). ELK never knew standoffs existed, so it
  scattered clusters and the settle yanked them onto each other (overlaps). Now each
  fully-loose cluster collapses to a LEADER (prefer a non-group member): the leader
  proxy is sized to the cluster bbox so ELK reserves room, follower edges remap to the
  leader (node-level, like the gbridge), and after layout every member is re-placed at
  its stored offset from where ELK put the block.
  - GOTCHA 1: groups must be ALLOWED in a cluster. The real use is notes standoffed
    above collapsed groups, so the first guard ("skip clusters containing a group")
    disqualified all of them → `qualifiedClusters=0`, zero visible effect. A group
    lays out as one rectangle, so a (group, note) pair is a valid block.
  - GOTCHA 2: the auto-arrange applier RESIZES proxy nodes to their reported size, so
    the bbox-sized note leader grew to ~3x and STUCK (its content kept sizing
    separately). Must restore the leader's real size after layout — exactly what
    `realHostSize` already does for FC hosts. This is the non-obvious one.
  - Guarded to a strict no-op when no cluster qualifies, so graphs without standoffs
    tidy byte-identically to before.

Also this session: standoff 45° rigid lock + angle dial (reused the Conduit dial,
snaps to the 8 anchor dirs); new standoffs lock by DEFAULT (snap to alignment on
create); hard 30px min band (`STANDOFF_MIN`); and the toolbar min/max inputs now
commit on Enter/blur (`useDraftCommit`) instead of recomputing per keystroke.

Deferred: a deeper edge-case sweep (D) on push/expand/collapse/autofit heavy-overlap
cases — expand/collapse are "mostly okay" per the author, so it's not urgent.

### Design-system + UI pass (impeccable)
Set up the impeccable design skill: PRODUCT.md, DESIGN.md (+ `.impeccable/design.json`
sidecar), register = product, North Star "The Instrument Panel". A critique scored the
node-graph editor 29→32 across the session. Fixes it surfaced, all committed: table /
frame / slider display colors routed to theme tokens (were near-invisible in light
mode — hardcoded inline `#ccc`/`#2d2d2d`); error-badge hover now appends the
plain-language `ERROR_EXPLANATIONS` (meaning + fix); `--text-muted` lifted to clear
WCAG AA; content popups widened (table 560→1100); **single-key graph shortcuts**
(A add · G group · I isolate · T tidy · E expand · F autofit · C cleanup; Ctrl combos
unchanged); pin chip opens the grid popup (neutral chip, type-colored popup header);
global `button { font-family: inherit }` so every control uses Atkinson (root cause of
the wrong-font buttons); refresh/conduit unicode glyphs → SVG; count badges use ink;
frame previews default to 3 cols in Atkinson mono; Note background 0.16→0.3 alpha.

## Cinematic load reveal — progress bar → staged input→output draw-in (2026-06-19)

Load no longer pops nodes in one-by-one. On **startup and File → Open only** (doc
switches still snap — author's call), a graph now: (1) builds behind an opaque
**progress-bar overlay** (accurate — counts nodes + connections), then (2) **fades
nodes in wave by wave** in rough input→output order while (3) **drawing each node's
incoming cables on** (output → input), and only (4) **computes/shows results after
everything is drawn**.

- **`loadReveal.ts`** — a module-singleton store (read from both React roots via
  useSyncExternalStore, like `cableShapeStore`): `phase` (idle/building/revealing),
  accurate `progress`, and a per-connection revealed set. Plus the pure, unit-tested
  **`revealWaves(nodeIds, edges)`** — Kahn longest-path layering (a node sits one
  level deeper than its DEEPEST source; self-loops ignored; cycle nodes flushed to a
  final wave so nothing is dropped).
- **Orchestration in `persistence.ts` `rebuildGraph(g, …, animate)`**: `begin()` up
  front (cables render hidden, overlay covers the whole build incl. the old graph's
  teardown), `bump()` progress per node/connection, then — while still hidden —
  zoomAt + syncGroupCollapse, then `runReveal()`, then `processGraph()` LAST (so
  value boxes stay blank until the structure is fully drawn — the "no results til
  drawn" requirement falls out of deferring compute).
- **`runReveal()`** fades nodes via their **area-view element opacity** — NOT
  transform, which would clobber rete's position translate (the documented
  async-translate gotcha), so nodes fade (no scale). Cables read the store: hidden
  → `opacity 0` + fully-undrawn `stroke-dashoffset`; revealed → fade in + offset→0
  animates the draw from the path start (source output) to the end (target input).
  A `finally` restores node opacity, and `loadGraph`'s `finally` calls
  `loadRevealStore.finish()` so a failed/rolled-back load can never leave the canvas
  stuck hidden.
- **Total reveal is capped** (`min(1500, max(450, n*26))ms`) so a 130-node graph
  reveals in waves, not one-by-one forever. **Ribbon (Conduit) cables** get the fade
  but not the line-draw (the draw is applied to the common single-path case only).
- Wiring: `loadGraph(g, { animate })`; `documentStore.restore()` and
  `importAsDocument()` (File→Open routes here via `fileSession.ts`) pass `true`;
  `ensureFirstDocument` passes `true` (fresh-user first run = startup); `open()` /
  `duplicate()` / `remove()` (doc switches) and seed loads snap. Non-animate path is
  byte-for-byte the old behavior (zero regression risk for switches/tests).

## Overlay chrome tokens — floating panels stand out over a busy graph (2026-06-19)

The floating overlays (socket legend, minimap, pin cards, alert cards, and the
collapsed pin/alert/legend launcher buttons) now share an `--overlay-*` token set
in App.css instead of the general `--panel-bg`/`--border`/`--shadow-pop`:
`--overlay-bg` (near-opaque, 0.97/0.98 — less see-through), `--overlay-border` (a
stronger always-on border than the subtle `--border`), `--overlay-shadow` (a
deeper, layered drop shadow). Both themes define them. Reuse these for any new
floating chrome rather than re-tuning per element; the per-element hover→accent
border behavior is unchanged.

## Display: a list collapses to a chip even with an FC docked (2026-06-19)

Bug: a list in a Display node (e.g. a Cast date list) didn't collapse to a chip
when a Format Controller was docked to the Display — it stayed the full joined
text. Cause: `ValueDisplay`'s list branch chose joined-text-vs-chip with
`(ann || full)`, so a truthy `ann` (any docked FC annotation) forced joined text
regardless of `full`. The `ann` clause is intentional for NON-Display nodes (show
an annotated list's *formatted* values inline, since the chip can't), but it
wrongly defeated collapse on the Display. Fix: `shouldRenderListInline(full, ann)`
(in `valueDisplayFormat.ts`, unit-tested) — collapsed Display (`full === false`)
ALWAYS chips; `full === true` (expanded Display) always inline; `full ===
undefined` (every non-Display node) keeps the annotated-inline behavior. Only the
Display node passes `full`, which is what makes the three cases separable.

## `anytable` (Any 2D) + element-polymorphic reshapers (2026-06-19)

Closed polyform's last gap: a MAP/MAKEARRAY text/date matrix had no consumer. The
pure-reshape matrix ops (TRANSPOSE, HSTACK, WRAPROWS/WRAPCOLS, TOCOL/TOROW,
CHOOSEROWS/CHOOSECOLS, Table Info — `matrix.ts`) now take an `any` matrix input
and emit a new **`anytable`** socket (a 2-D wildcard) — or a 1-D `any` list when
flattening (TOCOL/TOROW). So `MAP(text) → TOCOL → strlist → Add Column` works.

- **Why `anytable` and not the input-mirroring mechanism** the backlog sketched
  (re-derive the output socket from the connected input's element family): the
  wildcard keeps the one honesty that matters — it's 2-D, so `is2DType` + the
  narrowing block still keep it out of 1-D/0-D inputs — for almost no machinery.
  The trade-off: `anytable` (possibly text) can connect into a numeric `table`
  input (MMULT) and only fail at runtime; element precision is lost across a
  reshape, dimensional safety is kept. Reasonable for pure-shape ops.
- **Why `any` (not `anytable`) on the INPUTS:** reshapers also accept 1-D lists
  /scalars (widening, as before via the old `table` input), so the input must be
  the full wildcard; they promote it with the shared `toAnyMatrix` (moved to
  `coerce.ts`, dedup with the LAMBDA family). MMULT/MINVERSE/MDETERM/MUNIT keep
  numeric `table` I/O (genuine linear algebra). `anytable` accept-set =
  {table, strtable, datetable}; it renders as a gray grid (reuses `--sock-any`).
- Also this pass: **legend** rows are now label-left / swatches-right and show each
  family's full scalar/list/matrix set; **text/date matrix colors** got their own
  scalar-derived vars (`--sock-strtable`/`--sock-datetable`) — a punchier,
  hue-shifted sibling of the scalar (like `--sock-table` ↔ `--sock-number`) rather
  than the muted list shade.

## (element × dimension) lattice — accept-sets now DERIVED (2026-06-19)

Refactored `sockets.ts` so connection compatibility comes from ONE lattice rule
instead of the hand-maintained `SOCKET_ACCEPTS` map.

- **`FAMILIES`** is the (element × dim) grid — number / string / date / **complex**
  rows × scalar / list / combo / matrix cols. **`DIM_RANK`** gives each dim a
  capacity (scalar 0, list/combo 1, matrix 2). The whole policy is one inequality:
  an INPUT of dim Di accepts an OUTPUT of dim Do (same family) iff
  `DIM_RANK[Do] ≤ DIM_RANK[Di]`. `SOCKET_ACCEPTS` is now *built* from that at module
  load; combos fall out (a combo is rank-1, so it accepts scalar+list but not
  matrix, and a matrix accepts it).
- **One directional primitive `accepts(in, out)`** underlies everything:
  identity / `any` short-circuits, `anytable` is a 2-D wildcard among
  `MATRIX_TYPES` (homogeneous matrices, NOT frame), else the derived set decides.
  `areCompatible` = `accepts(a,b) || accepts(b,a)` (symmetric, for legend/grouping);
  `canConnect(out, in)` = `accepts(in, out)` (the directional guard). The old
  explicit `is2DType` narrowing block in `canConnect` is GONE — narrowing is simply
  absent from every accept-set, so it can't connect. `is2DType` stays as a public
  predicate (matrices + frame).
- **Complex was the extensibility test** (author's call): added the 4th family row
  + `complexlist`/`complexcombo`/`complextable` types, colors (App.css, scalar-
  derived like number↔list↔table), socket instances + `shared.ts` factories,
  `SocketComponent` render branches, legend row, `ConnectionDialog` labels. NO
  accept-set hand-wiring — it connects exactly like the other families
  (`socketConnect.test.ts` "complex family — derived, not hand-wired").
- **Two parked policy decisions, both settled:** (1) a plain `list` input now
  **accepts a scalar** (uniform — the rule has no exception; the coercion boundary
  already promotes via `toList`, and `coerceInputs` now also wraps a lone
  string/date/complex scalar into a singleton for `strlist`/`datelist`/
  `complexlist`). (2) `table`-accepts-`list` is KEPT (the rule yields it). The
  DimensionalityFlow explainer text ("a scalar can feed a list… input") is now
  literally true (was aspirational). No new behavior change beyond list←scalar; all
  prior connections still validate (528→532 tests, seeds.test.ts green).

## `anytable` element-type risk ameliorated — new `#TYPE!` guard (2026-06-19)

Followed up on the `anytable` trade-off above (option (a) from the backlog item).
The strictly-numeric matrix ops — MMULT (`TableMultNode`), MDETERM/MINVERSE
(`MatDetNode`) — now run inputs through `asNumericMatrix` (matrix.ts) before the
linear algebra. A text/object/`NaN` matrix returns a tagged **`#TYPE!`** ("needs
numbers, but got text") instead of silently producing `NaN` soup.

- **Added a Solenoid-specific `#TYPE!` code** (errorValue.ts + `ERROR_EXPLANATIONS`,
  which is data-driven so the IS-check explanation panel picks it up for free).
  It's distinct from `#VALUE!` (operand misuse): the value is wired correctly, it's
  just the wrong ELEMENT FAMILY for the op. Author's rationale — Solenoid's sockets
  track element families (number / text / date / complex) that Excel folds into
  `#VALUE!`, and that distinction is real: dates are serials you *can* do math on,
  so you'd want a number that merely resembles a date serial to be a `#TYPE!`, not a
  silent date op. The code now exists for any future element-type guard, not just
  this one.
- **O(1), not a full scan.** Matrix element types are homogeneous (the type
  system never mixes them), so the guard tests the **first non-blank cell** and
  returns early. Confirmed safe: `toAnyMatrix` keeps matrices homogeneous — a
  frame object degenerates to a 1×1 cell, never a mixed grid — so one cell
  classifies the whole matrix. The positive test (`Number.isFinite`) also nets the
  degenerate object/`NaN` cases, not just text.
- Options (b) soft connect-time warning and (c) full input→output element
  mirroring were deliberately NOT done — (a) is most of the value for least
  machinery. MUNIT takes a scalar `n`, no matrix to guard. Tests:
  `matrixReshape.test.ts` (text → `#VALUE!`, numbers unchanged).

## ValueDisplay formats dates from the OUTPUT SOCKET (2026-06-19)

Generalized date display so EVERY date-producing node formats serials as dates in
its own value box — scalars AND lists — instead of each node wiring an ad-hoc
`render={fmtSerial}` (which date.ts nodes did, and which never covered lists).
`valueDisplayFormat.ts` (React-free, unit-tested): `nodeOutputIsDate(nodeId)` reads
the node's `result` output socket and tests `isDateType` (the socket is the source
of truth — same signal the FC uses); `dateFormatDisplay(value, dateLike, hasAnn)`
pre-formats a numeric serial (scalar or list) to a date string (date, or
`YYYY-MM-DD HH:mm` when the serial carries a time fraction, e.g. NOW()), then the
normal text/chip rendering takes over (a date list → a chip of date strings).
Deferred to the FC when one is docked (it owns date patterns then). Read at render
time, so a socket SWAP (Cast target / polyform result type) re-detects.

Knock-on cleanups:
- **date.ts nodes** dropped their `render={fmtSerial}` and the local `fmtSerial`;
  they now format via the socket — and their date LISTS format too (new).
- **Cast** no longer formats dates itself — its date target stores raw serials
  (`displayScalar`/`displayList`) and ValueDisplay formats them (its output is
  `datecombo`). Cast still formats **complex** (`a+bi`) since no socket-driven
  path can disambiguate a Cx tuple from a 2-number list.
- **Polyform** Expression / BYROW / BYCOL / REDUCE with `resultAs: date` now show
  formatted dates in-box automatically — closes the "known gap" noted below.

## Cast display: structured value → chip, not a joined string (2026-06-19)

Cast was caching a pre-joined preview STRING (`cachedText = "[1, 2, 3]"`) and
feeding it to `ValueDisplay`, so a LIST result rendered as one long text line
instead of the chip every other list-producing node shows. Fixed by caching a
`ValueDisplay`-compatible **structured** value (`cachedResult`) and letting
ValueDisplay do its normal number/string/list/error branching (a list → chip).
Cast keeps a thin display layer (`displayScalar`/`displayList`) for complex
(`a+bi`) and text; numbers and dates flow as numeric serials (a docked Format
Controller applies to numbers; the date socket drives date formatting in
ValueDisplay — see the entry above). The data-flow output is unchanged.

## Polyform — value-polymorphic formula family + 2-D typed matrix sockets (2026-06-19, BUILT)

Shipped the design below in one pass (`b018ede`). Expression / MAP / BYROW /
BYCOL / REDUCE / MAKEARRAY / LAMBDA now loop ANY Excel function over arrays of
any element type. What landed, and the gotchas:

- **Engine.** `CompiledFn` widened to `(...unknown) => unknown` (excelFormula.ts);
  the codegen was already type-agnostic. Expression's `broadcastN` is polymorphic
  via a `guard(v, scalar)`: a string passes through, a finite number (date serial
  included) passes through, everything else (non-finite number, **boolean
  comparison**, undefined) collapses to the empty sentinel (`null` scalar / `NaN`
  in a list) — so numeric+boolean behaviour is byte-identical to before. The
  shared numeric `broadcast` (Add, scalar/stats/convert/logic) is DELIBERATELY
  untouched — those ops are inherently numeric, and widening it would ripple
  through dozens of call sites for no gain.
- **2-D lattice row finished.** Added `strtable` / `datetable` socket types (the
  text / date counterparts of `table`); `frame` stays the heterogeneous
  cross-type. `is2DType()` in sockets.ts now centralizes the "is this 2-D" test
  the narrowing block uses (was a hardcoded `table || frame`). Each matrix widens
  in from its OWN element family only (`strtable` ← string/strlist/strcombo). They
  render as grid squares reusing the list shade + grid glyph (no new CSS vars).
- **Result-type selector.** `ResultType` + `resultSocket(dim, t)` / `resultOut`
  in shared.ts; `ResultTypeToggle` + `applyResultAs` (components) swap the output
  socket IN PLACE at the node's dimensionality and drop now-incompatible outgoing
  cables — same mechanics as Cast's target toggle / Get Column read-as. `dim` is
  per node: REDUCE = scalar (number/string/date/any), Expression + BYROW/BYCOL =
  combo (numlist/strcombo/datecombo/any), MAP/MAKEARRAY = matrix
  (table/strtable/datetable/any). `auto` → `any`.
- **Inputs → `any`.** The mapped value inputs (Expression vars, MAP x/y/z,
  BYROW/REDUCE values, LAMBDA captures) are `any` — genuinely polymorphic, like
  Cast's input; the OUTPUT type (declared) keeps downstream honest. Because
  coerceInputs only normalizes the numeric lattice, MAP/BYROW/REDUCE promote an
  `any` value to a matrix internally (`toAnyMatrix` — generic over element type,
  scalar→1×1, list→single row CSV orientation).
- **Lambda Input stays type-agnostic** (author's explicit point): `LambdaValue.fn`
  is `(...unknown)=>unknown`, output socket unchanged (`lambda`); the evaluator
  node owns the result type.
- **Persistence:** `resultAs` added to the `extractInit` whitelist, so the swapped
  socket round-trips on save/clone. Old saves (no `resultAs`) default to `number`
  → identical sockets to before, so nothing breaks.
- **Display:** `TableDisplay` takes a `kind` and renders text cells (left-aligned)
  / formats date serials; `ValueDisplay` already handled strings + string lists,
  and now formats date scalars/lists from the output socket (see the "ValueDisplay
  formats dates from the OUTPUT SOCKET" entry above — closed the date-in-box gap).

Original design notes (kept for the rationale):

## DESIGN: value-polymorphic formula family — "polyform"

Goal: let MAP / Expression / LAMBDA loop ANY function over an array, not just
math over numbers — Excel parity (`MAP(dates, DATEVALUE(x))`, `MAP(names,
UPPER(x))`, `MAP(ids, VLOOKUP(x, …))`). Approved direction (2026-06-19); designed
+ de-risked, ready to execute as ONE focused family-wide pass.

**The reframe — it's a TYPING limit, not a function-library limit.** All of
Expression, MAP/BYROW/BYCOL/REDUCE/MAKEARRAY, and LAMBDA compile through one path,
`compileFormula` in `excelFormula.ts`, which already dispatches to **Formula.js**
(`@formulajs/formulajs`, hundreds of Excel fns) and whose codegen already handles
string literals, `&` concat, and calls returning any type. The ONLY gate is that
the plumbing is monomorphic on `number`: `CompiledFn = (...number) => number`,
numeric `broadcast`, and numeric sockets (`numlist`/`table`). So a text/date array
can't connect and a string/date result can't flow out — the engine is ~80% there.

**Enabling facts (verified against code):**
- MAP (`tableLambda.ts` `resolveFn`) and `lambda.ts` BOTH `as unknown`-cast
  `compileFormula`'s result, so widening `CompiledFn` to `(...unknown)=>unknown`
  won't break them.
- `evaluateSteps` (step explainer) + `formulaToLatex` are number-only — leave them
  number-only; they only fire for numeric formulas.
- Result-type swap has a proven pattern to mirror: Get Column read-as
  (`applyGetColumnReadAs`) + Cast (`applyCastTarget`) — drop cables on the port,
  removeOutput/addOutput with the new socket, `area.update`, recompute.
- A typed result must surface its type via the SOCKET (the date serial / datecombo
  lesson + `isDateType`), so the FC/display format it right.

**Staged plan:**
1. Engine: `CompiledFn → (...args: unknown[]) => unknown`; make `broadcast`/
   `broadcastN` value-polymorphic (map over any element type; the `Number.isFinite`
   guard applies only to numeric results). Runtime codegen is unchanged.
2. **Producers** (Expression, MapTable=MAP, ByAxis=BYROW/BYCOL, MakeArray) get a
   **result-type selector** (Number / Text / Date / Auto) that swaps the output
   socket — `numlist` / `strcombo` / `datecombo` / `any` — via the read-as
   mechanism. Their **var/value inputs widen to `any`** so text/date arrays connect.
   **REDUCE** outputs a scalar of the chosen type.
3. **Lambda Input stays type-agnostic** — it just carries the formula; the
   evaluator node that APPLIES it owns the result type (author's explicit point —
   the selector belongs on producers/evaluators, not the Lambda value).
4. Per node: component selector UI + socket re-derivation + `resultAs` in
   `extractInit`/persistence. Error semantics: a type mismatch (`UPPER(number)`)
   → Formula.js error → `#VALUE!` via the existing error guards.
5. Tests per node; numeric behavior must stay identical.

Do it as ONE coherent pass (not an Expression-only slice — that creates the
family inconsistency the author flagged). Builds naturally on the date column type
(date arrays in) + `isDateType` (date results out).

## DESIGN: factor sockets into (element × dimension) lattice

UPDATE (2026-06-19): polyform (above) FILLED the 2-D row — `strtable` / `datetable`
now exist alongside `table`, so all three element families (number/string/date)
have scalar / list / combo / matrix, and `is2DType()` centralizes the narrowing
test. The accept-sets are still hand-written in `SOCKET_ACCEPTS` (not yet derived
from one lattice rule); that mechanical refactor — deriving accept-sets + combos
from `(element, dim)` so a 4th family is a one-liner — remains the open work below.

Author's question (2026-06-19): now that we have a strict socket *dimensionality*
paradigm (the `table`/`frame` → 1-D narrowing block in `canConnect`), do we still
need the **combo** sockets (`numlist`/`strcombo`/`datecombo`)? Assistant answer:
**yes, keep them** — combos and the narrowing block solve *different* problems and
are orthogonal:

- **Narrowing block** = 2-D→1-D collapse only (a `table`/`frame` output into a
  `list`/`number` input is a guaranteed runtime `#SHAPE!`, so reject at the socket).
  Says nothing about scalar↔list.
- **Combo** (`numlist`, split-square) = a **runtime-resolved union**, and it's
  load-bearing on the **OUTPUT** side. The element-wise nodes (Add, Expression, …)
  don't know their output dimensionality until they see their inputs: `Add(2,3)=5`
  must leave as a **scalar** (so it can feed a circle/scalar-only input), while
  `Add([1,2],[3,4])=[4,6]` must leave as a **list**. A plain square output would
  block the scalar case (square→circle is narrowing); a plain circle output would
  block the list case. Only the union type is honest. So the lattice doesn't make
  combos redundant — the combo IS the lattice's one genuine join point.
- Note the current premise gap: a plain `list` input does NOT accept a scalar today
  (`list` isn't in `SOCKET_ACCEPTS`, so `canConnect("number","list")` is `false`).
  The square is a commitment to 1-D.

**The real simplification the dimensionality model unlocks** (not deleting combos —
*generating* them): there are 3 element families × 3 dims = 9 socket types
(`number/list/numlist`, `string/strlist/strcombo`, `date/datelist/datecombo`), each
with a hand-written `SOCKET_ACCEPTS` entry, even though the dimension axis is
identical across all three. Model a socket as `(element, dim)` and **derive** the
accept-sets from ONE lattice rule (widen-allowed, narrow-blocked, combo = "accepts
the dim below me"). Then combos + their accept-sets fall out for free, and adding a
4th element family (e.g. `bool`) is a one-liner instead of three. `table`/`frame`
sit at dim 2 of the number family.

**Two policy decisions PARKED for later** (author, 2026-06-19) — both are widening
rules, decide them when doing the refactor:
1. Should a plain `list` input accept a **scalar** (broadcast a scalar → singleton
   list)? Convenience, input-side only; doesn't remove the combo.
2. Should a `table` input accept a **list** (a list as a single row / 1×n)? Already
   true (`table: ["number","list","numlist"]` in `SOCKET_ACCEPTS`) — confirm/keep
   it under the lattice. The open part is whether the same widening should be
   *uniform* (scalar→list→table all auto-widen) vs explicit reshape.

## First-class `date` column type in Frames (2026-06-19)

`FrameColumn.type` is now `number | string | date`. A **date column stores Excel
serials** (numbers) like a numeric column — the `type: "date"` tag is the signal
that those numbers are dates, so they display formatted and flow as dates (the
same "a serial is just a number; the type carries date-ness" principle as
sockets' `isDateType`). Pieces:

- **Conservative inference** (`inferColumn`): a non-numeric column whose every
  non-blank cell matches an unambiguous **ISO** form (`YYYY-MM-DD`, optional time)
  becomes a date column, parsed to serials via `parseDateToSerial`. Bare numbers /
  years / locale-ambiguous `1/2/26` are deliberately NOT auto-detected (Get Column
  read-as Date is the manual escape hatch for other formats).
- **`frameHasTextColumns` now means STRING-only** — date columns hold serials, so
  they don't block Split's numeric matrix (a number+date frame still splits).
- **`formatFrameCell(type, v)`** (frame.ts) is the one display formatter: date
  serials → date strings, else raw. FrameDisplay uses it; Get Column read-as Text
  on a date column formats (not raw `46025`); read-as Date passes serials through.
- **Add Column add-as Date** now stores `type: "date"`. Persistence is transparent
  (the type is just a JSON string).
- `frame.ts` imports the date primitives from `nodes/date.ts` (acyclic — date.ts
  pulls only shared/sockets/errorValue, none import frame).
- **Deferred:** the table-editor popup shows/edits a date column's raw serials
  (the type round-trips on save; pretty in-popup date editing is a follow-up).

## Get Column read-as is now a COERCION, not a filter (2026-06-19)

Bug: a frame's date column imported from CSV is a **text** column ("2026-01-03"),
and Get Column read-as Date ran `typeof v === "number" ? v : NaN` — it only passed
through cells already stored as serials, so a text date column read as Date → all
#N/A. Read-as was a *filter* (reinterpret existing numbers), not a *coercion*.

Fix: read-as Date now PARSES text cells to serials, read-as Number parses numeric
text — both element-wise, unparseable → NaN. So the flow is just **Frame → Get
Column (as Date) → serials**, no extra nodes. Backed by one canonical parser,
`parseDateToSerial` (date.ts), now shared by DateValue (DATEVALUE, floors to
date-only), Cast(date), and Get Column — they all agree on what a date string
means. Tests in `getColumnReadAs.test.ts`.

**Why the dead-ends were dead-ends** (and what they say about the architecture):
- DATEVALUE is scalar-only; it can't take a column.
- MAP/the table-lambda family is numeric-only: input socket is `table` (a strlist
  can't connect) and the formula engine is numeric, so `DATEVALUE(x)` over a text
  list is structurally impossible. **Cast** is the one element-wise text→typed
  converter (input `any`, maps over lists) — `Get Column (as Text) → Cast(date)`
  already worked; the read-as fix just makes it the default, obvious path.

**Same root, downstream end — the Format Controller showed Cast(date)'s serial
(46025) as a raw number.** A date serial is just a number, so the SOCKET TYPE is
the only signal to format it as a date. The FC auto-selected a date style only for
`date`/`datelist` sources — but Cast(date) (and the element-wise date nodes) output
`datecombo`, which was omitted (the check was duplicated in `formatController.ts`,
`FormatControllerNode.tsx`, and `cast.ts`, and `datecombo` kept getting forgotten).
Added one shared `isDateType(dt)` (sockets.ts) = date | datelist | datecombo, and
routed all three through it. Regression test ties Cast(date)'s actual output socket
to `isDateType` so this can't silently drift again (`cast.test.ts`).

**Deferred (the larger gaps, not blocking the above):** frames still have no
*date* column type — dates are serials or text, so a date column displays as raw
serials or strings depending on storage (read-as bridges it, but a first-class date
column would be cleaner). And the lambda family (MAP/BYROW/REDUCE) is numeric-only;
element-wise text-formula ops would be a separate feature (TextMap covers
string→string today). Both parked in backlog.

## Deprecated-baggage cleanup (2026-06-19)

Acting on the "Pre-alpha — break freely" policy, removing dead/deprecated code.
Staged:

- **FC legacy FormatStyle modes** — dropped `decimal_2`/`decimal_4`/`percent_0`/
  `percent_2` (fixed modes superseded by the flexible decimal/percent
  places/sig-figs styles; no producer, no seed use).
- **Cast-superseded coercer nodes** — removed `TextNumNode` (TEXT), `ValueNumNode`
  (VALUE), `FormatDateNode` (Format Date), all three hidden/load-only. KEPT the
  shared pure helpers they exported (`formatNumberPattern`, `formatDateSerial`) —
  Cast and the FC depend on them. The `error-codes` seed demoed `#VALUE!` via
  `VALUE("abc")`; migrated it to `String Input "abc" → Cast(number)` (same
  `#VALUE!`), so `errorSeed.test.ts` / `seeds.test.ts` stay green.
- **Manifold node** (the big one) — fully removed: the deprecated two-arm
  bundler superseded by Conduit (was hidden/load-only). Deleted `nodes/manifold.ts`,
  `ManifoldComponent.tsx`, `manifold.css`, and `manifoldGeometry.ts` (Conduit only
  borrowed `normaliseAngle`, now a local in `ConduitComponent`; the `arm*` geometry
  helpers were Manifold-only). Stripped every `instanceof ManifoldNode` branch from
  the shared cable/socket/canvas code (Canvas isBundler/pin/link gates,
  ConnectionComponent src/tgt-block, errorValue SEES_ERRORS, kind.ts,
  ConnectionDialog isPlumbing) — a real simplification, not just deletion. Renamed
  the mis-named `pairedManifoldKey` → `pairedLaneKey` in highlightUtils (it was
  always generic `in_i`/`out_i` lane pairing the Conduit uses too). Removed the dead
  `--manifold-*` CSS vars + `.solenoid-manifold` rules across App/canvas/mobile/
  socket CSS. No persistence change needed — `LEGACY_TYPES_V1` was already swept, so
  `ManifoldNode` saves just load-skip. Reattributed the surviving shared concepts
  (resizable-body pattern, perpendicular-face sign, cableAngleStore) to the Conduit
  in CLAUDE.md + subsystem-invariants. 467 tests green, typecheck clean.

## Within-group Tidy now triggers the group push (2026-06-19)

A within-group Tidy (`autoArrange({ groupId })`) autogrows `group.width/height`
to wrap the freshly laid-out members, but it used to grow silently — the box
could expand over neighbouring nodes/groups with no push. Now, if the box grew,
Canvas calls the new `pushForGrownGroups` (groupPush.ts), which reuses the
existing `runExpandPushes` engine fed the pre-grow size as `preSizes`. So tidy-
grow shoves neighbours off the grown edges. Unlike the expand-on-uncollapse push,
it's PERMANENT: `pushForGrownGroups` passes `record:false`, so no restore record
is written and a later collapse leaves the neighbours where Tidy parked them — a
Tidy is a deliberate manual action, so re-parking should stick (the user's call).
Gated by the `groupPush` setting.

Gotcha worth noting: `buildWorld` reads a group's box from `n.width/height` when
its id is in `expandedIds` (else from the rendered element). `runExpandPushes`
puts every `changed` group in `expandedIds`, so feeding it the just-grown group
makes the push see the grown size automatically — no extra plumbing.

**Cleanup (Ctrl+Shift+L) opts out** via a new `arrangeFn({ skipPush: true })`: it
runs its own per-group autofit-shrink → collapse (which restores) → top-level
re-tidy, so a transient per-group push mid-Cleanup is just churn. Selection /
whole-canvas Tidy doesn't push either (it moves groups as whole units).

## Legacy save/format compat swept out (2026-06-19)

Following the "Pre-alpha — break freely" policy (now in CLAUDE.md), pruned the
read-old-format machinery that nothing in the repo actually exercises:

- **`LEGACY_TYPES_V1` + the `legacy` gate** (`persistence.ts`) — the v1→v2 type
  renames (ConduitNode→ManifoldNode, RibbonNode→ConduitNode). NO current seed uses
  the mapped names (checked), and the v1 seeds' node types are all current, so the
  gate resolved to `sn.type` unchanged for every repo artifact — removing it is
  behavior-identical here. Load loop now does `reg.get(sn.type)` directly. Also
  removed the duplicate of the same map in `seeds.test.ts`.
- **`migrateLegacyAutosave()` + `LEGACY_AUTOSAVE`** (`documentStore.ts`) — one-time
  migration of a pre-documents single-graph autosave (`solenoid.graph.autosave.*`)
  into the document library. Long since served; `restore()` now reads only the
  current `solenoid.docs.lib.*` slots.

**Kept (NOT legacy baggage):** the save-format `v` field + the forward-guard that
refuses a file claiming `v > CURRENT_SAVE_VERSION`. Those are current-format
hygiene / forward safety, not backward migration.

**Deliberately left alone this pass:**
- **frame.ts "legacy numeric-CSV"** reader — it's a LIVE dual-format input (the
  comment even says "*and the default*"); it's forgiving CSV-paste, not save-compat.
- **chartOptions `"bar"`→`"column"`** — a live input-alias normalization.
- **formatAnnotationStore "legacy fixed" modes** (`decimal_2/4`, `percent_0/2`) —
  truly dead-except-old-saves (no current producer), but the FC is mid-redesign;
  fold their removal into that work rather than churn it now.
- **Deprecated load-only NODES** (Manifold superseded by Conduit; TEXT/VALUE/Format
  Date superseded by Cast — `hidden:true` in the catalog). Still functional, a
  separate concern from save-format shims; left for an explicit "drop deprecated
  nodes" decision.

## Reduce node renamed → Aggregate (2026-06-19)

The fixed-op 1-D list reducer (`SUM`/`AVERAGE`/`MEDIAN`/`STDEV`/… — 19 ops) was
the class `ReduceNode`. Its header title was already "Aggregate", but the **type
hint** (hover header + status bar) is derived from `constructor.name`
(`nodeNames.ts` `nodeTypeName`), so it presented as "Reduce" — which wrongly
implies the table-taking `REDUCE` lambda (`ReduceLambdaNode`) and confuses users
when a `table` output won't connect to its `list` input. Renamed the class
`ReduceNode` → `AggregateNode` so the identity is "Aggregate" everywhere (no
"code says X, UI says Y" split).

Touched: `nodes/list.ts` (class + `super("Aggregate")`), `components/ReduceNode.tsx`
→ `AggregateNode.tsx` (`ReduceComponent` → `AggregateComponent`),
`components/index.ts`, `nodeRegistry.ts`, `nodeCatalog.ts`, `nodes/kind.ts`,
`list.test.ts`, and the 5 seed JSONs that stored `"type": "ReduceNode"`.

**No save-compat shim** — pre-alpha, single user, old saves are expendable (see
CLAUDE.md "Pre-alpha"). Old files storing `type: "ReduceNode"` just skip that node
on load. (An initial pass added a `resolveSavedNodeType` alias for it, then
removed it as needless baggage.) Internal op tokens (`ReduceOp`, `REDUCE_OP_META`,
the `reduce-${op}` catalog ids) keep their names — never user-visible.

Not changed: `AggregateNode` stays a 1-D `list` input by design (the
dimensionality rule: it's a list reducer, not a table op). To aggregate a 2-D
table, flatten first or use `REDUCE`.

## Socket-dimensionality audit — DONE, no changes needed (2026-06-19)

Cleared the v1 ship-blocker "per-node socket-dimensionality audit". Walked every
input on every node (~30 files in `nodes/`, ~470 inputs) against its `data()`. The
socket type does double duty — it gates connections (`canConnect` in `sockets.ts`)
AND drives engine-boundary coercion (`coerceInputs.ts`: `number`→toScalar,
`list`→toList, `table`→toMatrix, `numlist`→passthrough) — so a wrong socket isn't
just a loose guard, it changes runtime behavior. That's why I verified `data()`
usage rather than trusting labels.

**Result: the declarations were already correct everywhere — zero socket changes.**
Fanned the survey out to parallel read-only agents (one per file group), then
verified every candidate + every wide-socket usage (`table`/`frame`/`any`/raw
`numlist`) myself. The codebase already follows a single coherent rule, which I
wrote down as the **Input-dimensionality rule** in `docs/node-coverage.md` so new
nodes follow it. The key distinction that makes the rule unambiguous:

- **Element-wise operand vs. structural control.** Both can be "a number next to a
  list", but an *operand* (paired with each element via `broadcast()`) is `numlist`
  — per-element vectors are intended (`=ROUND(A1:A10, B1:B10)`); a *structural
  control* (count/index/window/order/base/flag) is `number` — a list there is a
  real mistake to block. This resolves the only borderline cases: `RoundN.digits`,
  `Clamp.min`/`max`, `MRound.multiple` are operands (correct as `numlist`, same as
  ArithmeticNode's `b`), while `Take.count` / `Rolling.window` / `Combinatorics.n`
  are controls (already `number`). A first-pass agent flagged the former as
  mismatches; they are not — narrowing them would break list broadcasting and
  diverge from the math family.

One false positive worth recording: FilterNode's `mask` is `list`, and its `data()`
annotates the param `number[][]` — that's just rete wrapping a `list` socket
(`mask?.[0]` is the 1-D vector), not a 2-D input. Correct as-is.

## Canvas cable layer — TRIED AND REVERTED (2026-06-19)

Built a `<canvas>` cable renderer (`cableCanvas.ts`, gone now — see git history
around this date) and reverted it. The idea: move the visible cable bodies off SVG
onto one canvas, since rasterizing large SVG curves is the dominant per-frame
paint cost when zoomed in. `ConnectionComponent` published each cable's finished
`d`+style; the canvas stroked the same `Path2D` (so geometry was identical); only
idle cables went to canvas, selected/hovered/ribbon-active/flow stayed SVG. The
in-holder viewport-following trick (redraw the backing store at native resolution
each frame) did keep it crisp at any zoom.

**Why it was reverted — don't re-attempt without a different plan:**
- **No reliable perf win.** Canvas is immediate-mode: it redraws EVERY visible
  cable every frame. SVG only re-rasterizes the cables that actually *changed*. In
  a group-drag (the target case) only a few cables move, so SVG repaints a few
  while the canvas repaints all — a wash, sometimes worse. The earlier "feels
  smoother" impression didn't hold up against an A/B toggle. (Canvas only clearly
  wins when nearly everything repaints at once, e.g. huge graphs.)
- **Slight colour difference.** Canvas and SVG rasterize a thin semi-transparent
  stroke with subtly different anti-aliasing → a visible colour shift on toggle.
  Cables must not change appearance (hard rule — see the reverted
  straight-line-during-drag experiment), so even a slight shift is disqualifying.
- A subtle bug it had: toggling the layer flipped canvas `display` synchronously
  while the SVG strokes swapped on the async React re-render → both painted for a
  few frames → overlapping semi-transparent cables visibly darkened. (Fixed by
  decoupling, but noting the class of bug.)

If revisited: a canvas only pays off with dirty-region/partial redraw (not
full-clear every frame) or at a scale where everything repaints anyway. The
appearance-safe, same-render-cost wins from this session were KEPT and are the
real improvements: per-connection path-solve cache, narrowed socket-hover
subscription, bounded per-cable SVG bbox, gesture hover-gate, rAF lasso +
standoff throttle, gesture shadow-drop, transient drag-layer promotion.



---

## Static shape-checking pass (2026-07-03, docs/v2.0/02-shape-checking.md Bet 3)

Built the static sibling of the relational verbs: `shapeOf(op: FrameOp, input: Shape)`
(`frameShape.ts`) computes column name+type ahead of running anything, one arm per
`FrameOp` member (select/drop/rename/sort/distinct/head/filter/groupBy/unpivot/pivot),
mirroring `frameVerbs.ts`'s real reshaping logic exactly — plus standalone siblings for
the ops outside the `FrameOp` union: `shapeOfJoin`, `shapeOfAppend`, `shapeOfAddIndex`,
`shapeOfSplitColumn`. A `Shape` is `{ columns: {name, type}[] }`, reusing
`FrameSchemaColumn` (already `frameBackend.ts`'s runtime preview schema) rather than a
new taxonomy. Row-only ops (sort/distinct/head/filter) return the input unchanged — the
column set never moves. Two verbs are genuinely DATA-dependent (PIVOTBY's cross-tab
width, Split Column's max part count) — those set `Shape.dynamic: true` and report only
what's certain (pivot: the row-key columns; split: the untouched columns), rather than
pretending to know a count that isn't knowable without running.

`frameShapeResolver.ts` is the graph walk (`makeFrameShapeResolver(editor)`, same
duck-typed/memoized/cycle-guarded shape as `unitFlow.ts`'s resolvers): it reads each verb
node's OWN literal config — `stringLiterals` CSV/text (the same bag `InlineInputs`
lazily creates and `coerceInputs.ts` injects when a list socket is unwired) plus public
fields (`op`/`how`/`funcs`) — never a wired dynamic column name, since that can't be
resolved without actually running the graph (same "no engine call, no IPC" constraint
the doc specifies). `FrameInputNode` is the one literal SOURCE (its typed-in `frameText`
gives an exact shape via `frameFromInputText`); a runtime-loaded source (CSV/Web Source)
or Build Frame's data-dependent matrix width resolves to `null` (unknown) — same
treatment as a misconfigured verb (a thrown `#REF!`/`#TYPE!`/`#VALUE!` is caught and
also reads as unknown, mirroring how a bad config shows an error VALUE at runtime, not a
crash).

Scoped OUT on purpose: Nest/Unnest (cross into Cube — a different container, no Frame
shape to report) and Frame Lookup (returns a scalar cell, not a table). `CableInspector.tsx`
shows the computed shape as a new row (name · type pairs, "+ more" when `dynamic`) below
the existing Value row, only for a `frame`-typed cable.

`frameShape.test.ts` (new, `frameBackend.test.ts`'s describe/it convention) checks every
covered verb's declared shape against the ACTUAL columns the JS oracle (`frameVerbs.ts`)
produces for the same op+fixture, including the thrown-error cases (#REF!/#TYPE!/#VALUE!
match code-for-code). `frameVerbs.ts` is also the reference oracle `engine.rs`'s Rust
verbs are parity-tested against (see its own `src-tauri/src/engine/tests.rs`, ~28 tests
asserting the same column name/type contract per verb) — so the two are transitively
aligned, though a literal single-file cross-language check isn't possible (vitest can't
invoke Rust). **Deferred**: explicit new Rust tests mirroring `frameShape.test.ts`'s exact
fixtures 1:1 (skipped this session — a from-scratch Polars compile is a multi-minute cost
not spent here); "refuse-to-run on a shape mismatch" mode (the doc's step 6, explicitly
non-blocking).
