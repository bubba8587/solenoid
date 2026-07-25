# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### OPEN PROBLEM (2026-07-24 — a choppy zoom BAND: interior range of scales, both extremes smooth)
Zoom chop is **not** monotonic in graph size or zoom depth. There is a specific interior range of
camera scales that is markedly choppier than BOTH very close zoom AND very far zoom. Observed by
the author on the Vercel preview of `develop` (desktop browser → DOM renderer; `drawElementImage`
is not in stable Chrome, so the HTML-in-Canvas layer never engages there). Not yet pinned to a
numeric `k` range — that is test T1 below.

**This supersedes the framing in `archive/performance-hardening.md`.** That doc's ledger is still
correct about what it measured, but every lever in it was tested without knowing a band existed,
so any ablation may have been run OUTSIDE the band and read as "negligible" for that reason. Treat
its negative results as *unconfirmed inside the band*, not as foreclosed.

**Ruled out — measured, do not retread:**
1. **The gesture-exit settle.** Held `ZOOM_SETTLE_MS` at 3000ms on a live preview (`dc96159`,
   reverted here). The band survived the long hold unchanged, so it is NOT the per-notch
   exit/re-enter scale-change repaint that 2026-07-20d diagnosed. That 420ms fix stays valid for
   its own symptom; it is not this one. Recorded as a negative result in `zoomSettle.ts`.
2. **Element count / DOM weight.** `semanticZoom` defaults OFF (`settingsStore.ts`), so at far-out
   zoom EVERY card is on screen and fully painted — and that is the SMOOTH case, while the choppy
   band has strictly fewer elements on screen. Element count is *maximal* in the good case, so it
   cannot be the driver. This also retires "unmount the semantic-zoom body subtree" and
   viewport-culling as fixes for THIS symptom (they may still be worth doing for load/idle cost).
3. **The HIC mip curve.** `computeIdealMipLevel` saturates to level 0 for every scale
   ≥ `1/(quality·dpr)` — so ≥0.5 on a dpr-2 display, ≥1.0 on dpr-1. Close zoom is pinned at level 0
   regardless of the curve, and `REF = 1` caps the source capture so raising `quality` cannot make a
   sharper texture either. Irrelevant on the preview anyway (HIC does not engage).

**Instrumentation (all live in a deployed preview, no redeploy):**
- `window.__solenoidPerf = true` → on each pan/zoom gesture end, `fpsProbe` (`Canvas.tsx`) logs
  frames, mean/fps, **worst frame + the `k` it happened at**, the **`k` range covered**, and the
  dropped-frame count. The `k` tagging was added for this problem — it is how T1 gets answered.
- `window.__zoomSettle = <ms>` → re-A/B the settle window (`zoomSettle.ts`, default 420).
  **Gotcha if you set this long in HIC mode:** `exitGesture` is timer-only and the holder is
  `visibility:hidden` for the whole gesture — which is not hit-testable — so nodes are unclickable
  for the entire hold. Harmless at 420ms, a dead canvas at 3000ms. A pointerdown escape in
  `onPointerDown` fixes it (was written and reverted with the experiment, `55b6449`); re-add it
  before running a long-settle test on the desktop build, and remember it perturbs touch pinch
  (one extra exit/enter at pinch start).
- `window.__hcMinNodes = <n>` → HIC engage threshold (weighted units) for the desktop-build tests.

**Tests to run, in order. T1 and T2 gate everything else — the rest are guesses until those land.**
- **T1 — Pin the band numerically.** `__solenoidPerf = true`, then zoom slowly across the whole
  range on a named seed (Famous Math, and Personal Finance as the lean control). Record the `k`
  values the worst frames cluster at, and the `k` where chop starts/stops. Deliverable: a
  `k_low–k_high` range per seed. Everything below is phrased against that range.
- **T2 — Chrome Performance trace inside vs outside the band.** The decisive measurement. Compare
  the time split across *Update Layer Tree / Paint / Rasterize / Composite Layers* at a `k` inside
  the band against one outside it. **If Paint+Rasterize dominates inside the band → T3/T4/T8. If
  Composite Layers / Update Layer Tree dominates → T5/T6.** Do not build anything before this.
- **T3 — Does the band track TEXT size?** Hypothesis for an interior maximum: visible glyph count
  grows as ~1/k² while per-glyph raster cost falls as glyphs shrink, so the product peaks in the
  middle — lots of glyphs that are still large enough to fully rasterize. Test: change the base
  font size (or the browser's own page zoom, which rescales CSS px) and see whether the band's `k`
  range shifts inversely. Band moves with text size → glyph rasterization is the driver.
- **T4 — Does the band depend on DPR?** Repeat T1 on a dpr-1 and a dpr-2 display (or force it via
  devtools). Raster work scales with dpr², so a band that shifts with dpr points at a raster-budget
  threshold rather than a content-count effect.
- **T5 — Does the band depend on the GRAPH BBOX?** The promoted holder's backing store is
  `graph bbox × k × dpr`. Compare graphs with the SAME node count but very different spread, and a
  small graph against Famous Math. Band shifts with bbox → the holder is crossing a tile/texture
  budget and the fix is to stop promoting a whole-graph-sized layer (viewport-sized layer, or cull
  the holder's content box). Known related datapoint: mobile holder promotion already tiles and
  flickers because `bbox × dpr` exceeds the mobile GPU max texture.
- **T6 — Is the promotion itself the mechanism?** A/B `holderEl.style.willChange = "transform"` in
  `onZoomActivity` (`Canvas.tsx`) on/off while zooming through the band. `performance-hardening.md`
  argues promotion makes content cost irrelevant; if the band DISAPPEARS un-promoted, the promotion
  is the mechanism (Blink re-rastering a very large promoted layer at its sharpness thresholds),
  and that reframes the whole problem.
- **T7 — Does the band exist in HIC mode?** Desktop build only (the Blink flag is wired there via
  `additionalBrowserArgs`). During a gesture HIC draws cards as cached bitmaps, so: band persists →
  it is not card content at all (look at cables/conduits or the compositor); band vanishes → it is
  card paint, and HIC is already the mitigation.
- **T8 — Content ablation INSIDE the band.** Re-run the two cheapest ablations from the old ledger
  at a `k` known to be inside the band: hide all cables, and hide all card bodies. Both previously
  read "negligible" — but see the supersession note above.

**Do not retry** (already eliminated, `archive/performance-hardening.md` "Reverted experiments"):
holder promotion on plain pan, `--zooming` quality drops on desktop, render-resolution scaling,
mobile holder promotion. Add to that list: the long zoom settle (1 above).

### OPEN PROBLEM (2026-07-16 — note-family selection ring ~0.5px off on right/bottom)
A note-family card's selection ring (`::after`, `inset:-2px`, e.g. `.solenoid-note--selected`,
`.solenoid-pres--selected`) can render ~0.5px too wide on the RIGHT and/or BOTTOM edge (left/top stay
flush) — the ring overhangs the card on that side. Reproduces on default Notes (varies with how you
resize) and Import-from-Obsidian; base nodes (ring `inset:0`, so ring & card share the same edge) don't
show it because there's no offset to mismatch. **Tried & did NOT fix (57831f8e):** rounding stored
resize dims to integers (Note/Group/Import/`ResizeHandle`, live + snap branches) — so the cause is not a
fractional STORED width/height. Prime remaining suspect: the card's CONTENT-driven layout size landing
on a sub-pixel (Presentation has no stored height at all), so the card edge and the `inset:-2px` ring
edge round independently. Possible directions not yet tried: draw the ring so it shares the card's edge
(e.g. `inset:0` + account for the 2px border, or a box-shadow ring) instead of a 2px-offset `::after`;
or pixel-snap the card box. Radius itself is correct; don't re-touch it. Parked by author.


### UNSOLVED: header/body border seam under zoom (2026-07-05 — parked for a human/later pass)
The node header's 2px accent frame abuts the card's 1px border on the same outer edge;
under the canvas zoom transform the two strokes rasterize with different width-phases →
a subpixel crack at the vertical junction and, at some zooms, a whole-pixel jog in the
bottom edge. **Tried and ELIMINATED — don't retread:**
1. Unify both at 1px (`d713900`, reverted `3be29b2`) — fixes the seam but thins the
   accent band; author rejected the look change.
2. Split the 2px accent into a 1px real border + 1px inset box-shadow ring (`ff3a896`,
   reverted `25ff69a`) — WORSE: Blink rasterizes borders (width-snapped) and inset
   shadows (not snapped) differently, so the two accent layers themselves drift apart
   under zoom.
Constraints: keep the exact current look (2px accent header, 1px body border). Leads
NOT yet tried: one SVG overlay child spanning the full card that draws BOTH strokes in
a single paint (one rasterization pass; needs --header-h published unconditionally —
today it's only measured when a corner badge exists, nodeKit.tsx:314); `border-image`
on the card; drawing frames in the HTML-in-canvas renderer only; quantizing the
area-plugin zoom k to device-pixel-friendly steps (would help every 1px hairline
app-wide, but touches feel of zoom).


### SESSION DIGEST (2026-07-24 — cables see through Conduits: inspector + run selection)
A Conduit is wiring, not computation, so a single cable is a SEGMENT of a longer run.
Both cable-legibility surfaces now work on the run instead of the segment.
- **`conduitPath` (`conduitTrace.ts`, unit-tested)** — the run a cable belongs to: climb
  lanes upstream to the real producer, then fan out downstream FROM THAT ORIGIN to every
  real consumer, collecting the segment ids and the Conduits crossed. Walking downstream
  from the *clicked* cable instead of the origin was the trap: a fan-out branch would
  hide its siblings and two segments of one run would resolve differently.
- **Cable inspector** now reports the run's ends — From = origin producer (its value,
  FC annotation and frame shape too, instead of the opaque Conduit lane), one To row per
  terminal input, and a quiet `Via` row naming the Conduits in between. It also accepts a
  whole-run multi-selection (previously any multi-select showed nothing); the ribbon bail
  now only applies to a lone ribbon cable, since a run's ends are resolved.
- **Double-click a cable selects its whole run** — the entire path highlights, and Delete
  takes all of it. Detected from `e.detail >= 2` inside `onClick`, because the canvas
  swallows native `dblclick` in capture phase to kill rete's zoom-on-dblclick, so React
  never sees a synthetic double-click here. Ctrl/Cmd double-click adds the run to the
  selection; a cable with no Conduit either side is its own run and double-click leaves
  the first click's selection alone rather than toggling it off.

### SESSION DIGEST (2026-07-23 — GPU renderer: WICG API re-research + perf/sync build)
Author complaint: html-in-canvas mode feels worse than DOM on mobile. Re-researched the
API itself (primary sources), then built the fixes the drift implies.
- **API status (2026-07):** origin trial Chrome 148–150, Android DevTrial since 138; the
  rename (drawElement→drawElementImage / texElementImage2D, old names dead past M145) is
  final and we're on the new names; **`ElementImage` is spec-final as
  `{width,height,close()}` — NOT an ImageBitmapSource**, so the 2026-07-16
  `createImageBitmap(refImg)` rejection is permanent spec behavior, not build drift; the
  privacy update strips subpixel-AA/system-color content with no opt-out (a fidelity
  floor, not a bug — `live` mode stays the crisp escape hatch); spec paint model: canvas
  children are snapshotted just BEFORE the `paint` event, and drawElementImage outside a
  paint handler draws the PREVIOUS snapshot.
- **Engine perf (htmlCanvasRenderer):** double paint-listener fix (`onpaint` +
  addEventListener registered the same handler twice → two full draws per paint on API
  builds); paint frames re-read the live camera at paint time (`setTransformSource`);
  any frame that must call drawElementImage routes through requestPaint (in-paint =
  current snapshot); the paint handler draws cached mips when possible (was an
  unconditional live re-raster of every visible node); the paint-raster fallback
  shelf-packs each batch into ONE atlas region → ONE canvas read-back per paint instead
  of one per node (the expensive pattern on mobile GPUs), per-node textures cropped
  bitmap→bitmap (`rasterAtlas.ts`, pure + tested).
- **DOM-trails-canvas pan fix (getElementTransform):** the engine now reports the
  PRESENTED camera — from the WICG sync matrix (drawElementImage's return /
  getElementTransform, plausibility-gated against bookkeeping) — and during a gesture
  the layer steers the holder onto that frame, restoring rete's byte-identical
  serialization on settle (`domSync.ts`, pure + tested). Coarse pointers additionally
  get per-element `willChange` promotion for small DOM-only elements (≤1024 CSS px; the
  holder-wide promotion stays disabled there — texture-limit corruption), so conduits
  stop trailing during pans.
- `__hcProbe()` reports getElementTransform's location + identity mapping. Stale
  API-status comments reconciled (htmlCanvasSupport, Settings copy, decisions D6).

### SESSION DIGEST (2026-07-22d — post-1.2 reorient: backlog → 1.3, deferrals.md born)
v1.2.0 tagged and released; docs/planning reoriented around 1.3 (author directive: all
deferred/for-later work collapses into ONE review item; the queue focuses on bugs +
decided-unbuilt work).
- **`docs/deferrals.md` created** — every deferred/parked/author-gated item gathered in
  one reviewable list (author-decision gates, author-present polish, parked bugs,
  only-if-triggered, parked features). `backlog.md` rewritten as the 1.3 queue: bugs &
  verifications, the author's 2026-07-16 punt list (iFrame/embed, Data Feed widening,
  drill-in nav/lasso/group tools, doc-level FC defaults), the decided-unbuilt build
  queue, packs, ONE **Deferral review** item pointing at deferrals.md (same sitting:
  ratify `out-of-scope.md`), and the 1.3 release tail. CLAUDE.md + docs/README.md maps
  updated.
- **Full-docs sweep vs code (subagent-assisted) — reconciled the stale claims:** the
  Reference data-model chapter SHIPPED (`help/data-model.md` covers lattice/wildcards/
  list-is-a-row/unit granularity — backlog item deleted); composite-workbench seed HAS
  scenarios + data-table cards (item deleted); Nest/Unnest shipped (`cube-node-scope.md`
  marked [done], unified-XLOOKUP contradiction fixed); `#OVERFLOW!` shipped + toured
  (value-semantics now says 15 codes); pack-architecture "4 of 5 run modes" → full set;
  format-model per-column-units non-goal dropped (A4 shipped); node-coverage FC "under
  active redesign" dropped; docs/README "1.2 tag pending" cleared.
- **Real gaps promoted into the queue** (found by the sweep, previously un-backlogged):
  extend targeted recompute to topology changes (D8 follow-through); trueany adoption
  absent in drill-in composites; `readInput` sweep beyond scalar.ts; passthrough opt-in
  for Concat/Interleave/TOCOL/WRAP; FC complex-family spec-lag verify; pack-architecture
  prerequisites folded into the distribution item. D10's residual formula-surface
  violation (pre-2010 stats family via Formula.js) noted inside the parity-program item.
- `release-notes-features.md` reset to the 1.3 shell (1.2 list shipped; git history
  keeps it, per the 1.1 precedent). Dev-notes 07-20 digests swept to the archive.

### SESSION DIGEST (2026-07-22c — tablet zoom corruption: holder GPU-layer promotion)
Author report: zooming on the tablet drew GREEN SQUARES / broken raster, in BOTH render
modes. That's Chrome's raster-tile allocation failure — a promoted compositor layer
sized holder-bounds × zoom × dpr exhausts mobile GPU tile memory. Two promotion sites
were keyed on the UI mode (IS_MOBILE) instead of the GPU class, so a tablet (desktop
UI, mobile-class GPU) took the desktop branch:
- **DOM mode** (`Canvas.tsx` `onZoomActivity`): the desktop pinch promotes the WHOLE
  holder (`will-change: transform`) for the gesture — the code's own comment already
  documented that mobile GPUs can't take this. Gate flipped `IS_MOBILE` → `IS_COARSE`;
  touch devices zoom un-layered (a touch choppier, stable).
- **Canvas/GPU mode** (`HtmlCanvasLayer.tsx` `enterGesture`): promoted the holder on
  EVERY gesture with no device gate at all. Now `if (!IS_COARSE)`; the conduit may
  trail a frame mid-gesture on touch — corruption is worse.
Rule of thumb recorded in both comments: promotion decisions key on the DEVICE
(IS_COARSE), interaction decisions on the UI mode (IS_MOBILE).

### SESSION DIGEST (2026-07-22b — tablet mode: dvh viewport + fullscreen on the desktop pill)
Author report from tablet Chrome: desktop UI (correct — tablet UA is non-mobile), but the
bottom chrome (status bar, minimap, navigator) sat below the usable screen, and the zoom
pill lost the mobile view's Fullscreen button. See layout-chrome.md "Tablets" section.
- **`.solenoid-app` → `100dvh` app-wide** (`App.css`, `100vh` fallback): the dvh fix was
  gated on `html.is-mobile`, but a tablet runs the DESKTOP stack in the same toolbar-
  bearing mobile browser — 100vh (layout viewport) overshot the visual viewport by the
  URL-bar height, sinking every bottom-anchored descendant. mobile.css's own override
  removed (redundant now).
- **`vh`+`dvh` pairs on tall overlays** (FR panel, Report window, Settings/Shortcuts/help,
  table/pivot popups, add menu, palette, drill-in controls): dvh ≤ vh always, no-op on
  desktop browsers. Keep the pair for new tall overlays.
- **Fullscreen button gates on `IS_COARSE`, not `IS_MOBILE`** (`NavMenu.tsx`): any
  touch-primary device gets it (no F11 key); mouse desktops keep F11/browser-native.

### SESSION DIGEST (2026-07-22 — Query node: Manual refresh run mode + Composite preset)
Author idea, ratified as D22: the Power Query analogue reuses the Composite + drill-in.
- **`"manual"` run mode** (`nodes/composite.ts`): one `runPass`, but `isHeavyMode()` is
  unconditionally true — the existing arm-and-run hold gives Power Query's refresh model
  for free (upstream ticks → stale dot; the button — relabelled **Refresh** with a
  refresh-cw glyph in this mode — re-runs). `requestSolve(insideOnly)` deliberately drops
  `insideOnly` in manual mode: frame ports have no numeric seeds, so a drill-in Refresh
  always re-runs on the real wired inputs.
- **Query catalog entry** (`nodeCatalog.ts`, paired with Composite; `type: "query"`): the
  same `CompositeNode` pre-seeded — exposed **Table** marker wired to a **Result** marker,
  manual mode. Saves/loads as a plain CompositeNode; no new class, no new persistence.
- **Add paths hydrate now** (Canvas menu `handleMenuSelect`, `addNodeByCatalogType`
  (duck-typed — catalogUtils imports no node classes), drill-in add menu): a pre-seeded
  entry ships a pending internal snapshot, which previously only load/paste/unpack/open
  hydrated. No-op for every other node.
- Tests: manual-hold semantics + insideOnly override + Query preset hydration/round-trip
  in `composite.test.ts` ("manual refresh mode" / "Query catalog preset" describes).

### SESSION DIGEST (2026-07-21 — zoom, Tidy/FC bugs, KaTeX loop, scroll-lag, socket rings)
Targeted UI/UX fixes from an eyeball-driven bug sweep:
- **Zoom pill buttons** (`NavMenu.tsx`): `ZOOM_STEP` 1.08 → 1.4 so a click crosses noticeably more range;
  wheel/pinch stay fine-grained.
- **Tidy widened an FC host every click** (`tidyArrange.ts`): the docked-FC footprint restore captured
  `measuredBox().w` — an `offsetWidth` (border-box, INCLUDES the 1px border) — and re-stamped it via
  `area.resize` as `style.width` on the CONTENT-box `.solenoid-node` card, so each Tidy grew the host (and
  any group autofitting around it) by the border width. Repro: `num → Display + Format Controller`. Fix:
  the pin-drop loop now clears the inline WIDTH too (it only cleared height before), re-applying a
  `nodeSizeStore` manual width where one exists. Regression: `tidyDisplayFcWidth.test.ts` (a content-box
  fake area; fails pre-fix, stable across 3 Tidies after).
- **KaTeX "flashing" render loop** (`formulaFit.ts`): the `useFormulaFit` ResizeObserver recorded the
  PRE-fit box size, but `fit()` changes the box size (fontSize scales the content of a content-driven box),
  so every self-induced reflow read as an external change → infinite refit, box ping-ponging natural↔scaled.
  Only bit with `useHeight` + a content-driven box (the formula field). Fix: compare against the SETTLED
  post-fit size with a 1px tolerance, so only a genuine external resize refits.
- **Scroll-lag on backdrop-filtered overlays** (Settings, then swept): a panel with a full-screen
  `backdrop-filter` + an inner `overflow:auto` scroller re-rasterizes the frosted blur every scroll frame, so
  the controls lag. Fix (same as the Navigator list did long ago): give the scroll container its own
  compositor layer — `transform: translateZ(0); contain: paint`. Applied to `.solenoid-settings__body`,
  `.solenoid-helpdlg__panel`, `.solenoid-shortcuts__panel`, `.table-popup__grid-scroll`, `.conn-dialog__menu`.
  The other backdrop-filter users (TopBar/StatusBar/NavMenu/MobileControls/conduit toolbar/align bar/banner)
  have no inner scroller — left alone.
- **Group Tidy crept the box down/right on repeat clicks — a docked FC's sub-pixel dock** (`fcDocking.ts`):
  the group Tidy button runs the within-group arrange then `autofitGroupBox`, which wraps every member incl. a
  docked FC. `computeDockedCanvasPos` placed the FC via a SCREEN round-trip (getSocketScreenCenter →
  screenToCanvas ÷ zoom), landing it on sub-pixels — it docked a hair right + up, and, being a fractional edge
  that shifts with the host, it made the FC the box's moving extreme edge, so repeat Tidies chased it and the
  group crept. Repro: creep only with a docked FC as the lowest/rightmost edge; undocked, none. Fix: round the
  dock position to whole canvas px — snaps out the visible misalignment and makes the FC a stable edge the box
  can wrap without drift. (An autofit-skips-docked-FCs attempt and a 1px-hysteresis attempt were both rejected:
  the skip let the FC poke outside the box, and the hysteresis was defeated by the arrange step's box-grow.)
- **Socket glyph border contrast made consistent** (`palette.ts` / `appTheme.ts` / `SocketComponent` /
  `SocketLegend`): the ring was a single fixed translucent black (`--socket-ring`), so its visible contrast
  drifted with fill lightness — crisp on the light scalar dots, faint on the dark array/matrix/frame ones.
  New `socketRingShade` (a fixed HSV value-drop, `RING_VALUE_DROP = 0.23` — the tuning knob) computes a
  per-fill `--sock-*-ring`; each glyph points its `--socket-ring` at the ring matching its own fill, so every
  border darkens its fill by the same step. The Cube was drawing its seams with its OWN `color-mix` (why it
  read darker than the rest) — now it uses the shared `--socket-ring` too, so it aligns. The global
  `--socket-ring` stays as the fallback for untyped sockets.

### SESSION DIGEST (2026-07-21 — the big docs/comments cleanup)
Author directive: aggressive prune/rewrite of all supporting docs + code comments so they
reflect what SHIPPED and constrain future work, without fossilized one-time approvals.
- **dev-notes** swept to this shape (open problems + latest window); **backlog** rewritten as a
  terse open-only queue (landed items deleted, duplicates merged, §3a Data-Feed scope inlined).
- **CLAUDE.md rewritten rules-first**: the What's-working/Still-to-build changelogs became a
  capability map + standing constraints; every trap/invariant/alias/UX rule kept.
- **decisions.md**: D14/D16/D17/D18/D20 compressed to ruling+guard+reversal; stale claims fixed
  (calcModeStore tested, date-parser UTC landed, VLOOKUP formula-blocking shipped).
- **Archive triage**: deleted 12 spent docs + all 11 built v2.0 bundles (git history keeps
  them); condensed 12 more to their load-bearing core (scope-features 2028→159 keeping the
  #NN index + #23/#35 sketches); release-plan/1.2-plan/v2.0-05 archived; archive README is
  now the single archive index (architecture.md's doc table lists live docs only).
- **Comment sweep** (src, src-tauri, scripts, help): history narration → current facts;
  relapse-guards kept. Real staleness fixed: SocketComponent + help still described the
  pre-F-glyph Frame socket; help/notes.md claimed units "don't multiply out" (A4 shipped) and
  images "don't survive reload" (desktop bundling shipped). DESIGN.md gained the logical
  purple family + F-glyph/trueany-ring in the socket vocabulary.
- **Notes for later (ambiguities deliberately left):** `inlineInput.tsx` "numeric lists keep
  their single-number field for now" — unconfirmed settled-vs-pending; `nodeHitIndex.ts` stays
  an unwired Phase-2/3 foundation (claim verified true); `out-of-scope.md` still says DRAFT —
  author could ratify; two thin unbuilt ideas from deleted bundles (auto-doc-on-Groups #50,
  engineering-calc/BOM seeds #15/#16) were let lapse into git history rather than backlogged.
- tsc clean, vitest 3057 green before and after.


## Older entries archived

Swept verbatim to [`archive/dev-notes-history.md`](archive/dev-notes-history.md)
(latest sweep: everything through 2026-07-20e, on 2026-07-22). `git log` is the
per-commit record.
