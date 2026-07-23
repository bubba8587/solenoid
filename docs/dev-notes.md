# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

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
