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

### SESSION DIGEST (2026-07-20e — REVERSAL: gesture cables return to the canvas)
Author call: the zoom-time cable artifacting isn't a flash/thrash problem after all —
**partially translucent thin strokes inherently shimmer under scale**, so keeping every cable
as live DOM through gestures (37995b5, 2026-07-18) was chasing the wrong thing. Reverted: the
engine cable pipeline (`setCables`/`relayoutCables`/`drawCables`) is back, canvas-resolvable
cables draw on the canvas during gestures, and only conduit cables / snapshot-unresolvable
ones (e.g. into a collapsed group) stay DOM. Known fidelity gaps return with it (opaque
stroke vs 0.72 idle opacity, no ribbons/hover/dimming mid-gesture) — accepted over the AA
shimmer. KEPT through the revert: the post-collapse conduit-ghost fix (override-aware
show/hide + old-set clearing — independent bug), the 2026-07-20d zoom settle-holds (both
renderers), and 2681cb9's lasso/gesture separation. This also mostly retires 2026-07-20d's
"during-zoom cable repaint" backlog item (deleted): the per-notch DOM re-raster now covers
only the conduit subset. The 2026-07-19 digest below records the reverted state — superseded.

### SESSION DIGEST (2026-07-20d — GPU renderer: why zoom is worse than panning; settle-hold fix)
Diagnosis (measured in a live browser, DOM-mode proxies on PF — headless raster inflates the
magnitudes, the ASYMMETRY is the finding). Three stacked causes, all zoom-only:
1. **Pan is composite-only; zoom re-rasters.** A pan translates the composited layer (p95
   17ms/frame regardless of content). A zoom notch changes the raster SCALE, which repaints
   painted DOM at the new scale (full DOM p95 117ms, worst 283ms per notch).
2. **The live-DOM gesture subset is cable-heavy.** During a GPU-mode gesture the canvas carries
   the cards, but ALL cables + conduits stay live DOM (by design, 37995b5) — and the cable layer
   ALONE measured p95 67ms/notch under zoom (92 cables on PF) vs 17ms under pan. This is why
   collapsing nodes doesn't help: collapse removes card paint, not cables.
3. **The 140ms gesture-exit timer thrashes under notchy wheel zoom (FIXED).** A pan gesture is
   held by `pointerDown` even when motionless; zoom has no held-pointer signal, so wheel notches
   arriving slower than 140ms exited + re-entered the gesture PER NOTCH — each exit re-showing
   the full DOM at a NEW scale (cause 1's worst case, repeatedly, mid-zoom). Fix: a gesture that
   changed the camera scale now settles on a longer quiet period (`ZOOM_SETTLE_MS` 420ms vs
   `PAN_SETTLE_MS` 140ms, `HtmlCanvasLayer.tsx` `gestureZoomed`), paying the scale-change
   repaint ONCE at the true settle. Could not be exercised end-to-end in this container —
   headless Chromium 141's API drifted to `drawElement`/`drawHTMLElement` with a
   child-of-canvas model and no `captureElementImage`, so the html layer can't engage here
   (a THIRD drift shape after e309792/9f11cea — the desktop pin is what matters).
Remaining lever (author call, backlog): the during-zoom cable repaint (cause 2).
**Follow-up (same day): the DOM renderer had the IDENTICAL thrash — the reported
"cables still flash during zoom with GPU off".** `Canvas.tsx`'s `onZoomActivity` promotes the
holder (`will-change: transform`) per zoom and demoted it on a pan-tuned 160ms quiet timer;
notchy wheel zoom flipped promote↔demote PER NOTCH (measured: 16 will-change flips over 8
notches at 200ms), and each flip re-creates the compositor layer + re-rasters the holder — the
un-rastered-layer frame is the cable flash (thin strokes blink hardest). Fixed with the same
constant as the GPU side (`ZOOM_SETTLE_MS` 420ms → one promote/demote pair per zoom, A/B
16→2 flips), AND the settle timer now refreshes only on real `zoomed` events — with the longer
window, a `translated` refresh would have kept the holder promoted through a follow-on pan
(the tile-reveal flicker the pan-no-promotion NOTE exists to avoid); a pinch's interleaved
translates are covered by its own zoomed stream.

### SESSION DIGEST (2026-07-20c — PF seed internals modernized to the current node set)
Author call: the Personal Finance seed still taught the pre-D16 patterns. Via the generator
(structure) + committed-geometry adoption (layout), all values verified identical in a live
browser (Income 16,910 · Net 7,758.99 · rate 46% · NW 101,010 · Assets 123,650 · Debt −22,640):
- **FILTER + REDUCE → SUMIFS** ×4: cash-flow income/spend and net-worth assets/debt are now one
  `SumIfsNode` each, straight off the frame (`values`/`column0`/`value0` stringLiterals +
  `condConfig` gt/lt + `valueKeys:["column0"]` — the valueKeys is REQUIRED or the ctor ignores
  condConfig). The advisor's outflow feed rewired to `sumif-out`.
- **Parallel-lists list-GroupBy → frame Group By** ×3: the spending pivot (sum + count) and the
  asset-class pivot now run `GroupByFrameNode` (native Polars on desktop) with Get Column pulling
  chart/spark lists; the grouped FRAME shows directly on a Display chip (click → table popup),
  replacing the separate keys/values list displays. `col-type` deleted (nothing else read it).
- Notes rewritten to teach SUMIFS/the frame verb. New nodes sit at the tuned coords of the chains
  they replaced (inside the tuned group boxes — seeds.test's geometry invariant); a future
  tune-seeds pass may polish spacing. 175 → 171 nodes, 188 connections.

### SESSION DIGEST (2026-07-20b — Chart Builder targets; doc-switch curtain; minimap → canvas)
- **Chart Builder chart-type dropdown**: a `target` select (Chart / Histogram / KPI / Bullet /
  Treemap / Sankey / Waterfall / Candlestick / Boxplot / Calendar Heatmap / Waffle) shapes the
  form to the option keys that figure's RENDERER actually reads — truth table
  `CHART_BUILDER_TARGETS` in `chartOptions.ts`, derived from ChartView / the payload figures
  (title+fontsize) / the canvas figures (title only), machine-checked in `visual.test.ts`.
  A wired-or-valued row stays visible (dimmed, "Not read by X") so switching type never hides
  live state; serialization stays FULL-WIDTH — inert keys are matplotlib-ignored, one builder
  can feed several charts. Not per-type catalog nodes (author call).
- **Doc-switch Loading curtain** (`persistence.ts` `rebuildGraph`): a document switch with real
  work on either side (teardown+build > 60 nodes+connections) now runs behind the same
  LoadOverlay as File→Open — progress counts the CHUNKED TEARDOWN too (it dominates leaving a
  big doc; it used to show as a dead half-blank canvas) — and snaps to idle from loadGraph's
  finally, never entering the reveal. Small docs still swap with no flash.
- **Minimap node rects → one `<canvas>`** (`Minimap.tsx` `drawMinimapNodes`): was a div per
  visible node (N elements + N style-diffs, scales with the graph). Same coordinate origin,
  same geometry+fill signature gating so pan/zoom frames still skip the redraw; viewport box
  stays DOM (drag target). Verified pixel-painted + A/B'd against the old divs in a live
  browser (PF).
- **DOM re-measure (the levers stand)**: hard-load `querySelectorAll('*')` — PF ≈9.6k
  (175 nodes, median ~43/node), FM ≈4.5k (median ~38). Per-node chrome is lean; the big
  remaining subtrees are figure CONTENT (recharts ~200–400/chart, KaTeX ~70/formula) →
  "figure rasterize-at-rest" queued in backlog with the SvgPicker precedent. `style:~95`
  bucket = Vite-dev artifact (one tag per CSS file; bundled in prod). content-visibility
  stays ruled out (unchanged).

### SESSION DIGEST (2026-07-20 — Color Blend node + add-node skill rewrite; bundle 16 scoped)
- **Color Blend node** (author ask): two color-string inputs (typeable literals or wired; anything
  `colord` parses — the `names` plugin is now extended globally, so named CSS colors work in every
  color field incl. ColorPicker hex) × a blend-mode dropdown (W3C separable formulas per RGB channel,
  A = backdrop) → hex out the string socket on a ColorPicker-style swatch row. Class beside
  ColorPicker in `nodes/input.ts`; kind `string`; Control catalog next to Color; `colorBlend.test.ts`.
- **`.claude/skills/add-node` rewritten against current reality** — it predated the split of
  LogicalNode (still said "→ LogicalOp"), packs, the literals load gate, INIT_FIELD_ORDER
  persistence, error guards, unitAware, the wildcard ladder, and the tests-required step. Now
  documents all of those + points at Color Blend as the compact worked example.
- **v2.0 bundle 16 scoped** (`docs/v2.0/16-widget-nodes.md`): everyday widget nodes (Weather /
  Geocode / FX / Holidays / TZ / QR), dashboard-framed; 4 author gate calls listed there.


## Older entries archived

Swept verbatim to [`archive/dev-notes-history.md`](archive/dev-notes-history.md)
(latest sweep: everything through 2026-07-19, on 2026-07-21). `git log` is the
per-commit record.
