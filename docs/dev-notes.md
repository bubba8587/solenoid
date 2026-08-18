# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### OPEN PROBLEM (2026-07-25 — a choppy zoom BAND: interior range of scales, both extremes smooth)
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
   its own symptom; it is not this one.
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

### SESSION DIGEST (2026-08-18 — the Record node: one frame row as labeled boxes)
- **New node `Record`** (Add ▸ Visuals, `nodes/visual.ts`, author proposal "form node" from
  Airtable/Grist): shows ONE frame row as labeled boxes on a CSS grid, emitting a `ChartValue`
  (`op: "record"`, `RecordPayload`) out the chart socket — so the Report embed, chart popup,
  chip, and FC font scale all came free from `ChartFigure` (one new branch). View is
  `RecordCardView` in `chartCards.tsx` (DOM, recharts-free); height is content-driven; boxes
  TOUCH and are square (author call — gap 0, −1px margin overlaps the shared 1px borders
  into one hairline, no radius). The CARD never draws the grid (squished at card width):
  its hero box carries the [Chart] chip, and the drawn card lands wherever the chart
  output goes — a resizable Display, the popup, a Report embed (author call).
- **The layout is text** (the external prior art is CSS `grid-template-areas`, adapted): one
  line per grid row, cells split on `|` (column names contain spaces, so whitespace can't
  separate), `.`/empty = gap, repeating a name merges its cells. `parseRecordLayout` resolves
  each name to its bounding RECTANGLE and emits explicit grid placements — a sloppy repeat
  degrades to its bounds instead of invalidating the whole grid the way real
  `grid-template-areas` would. Empty layout → columns stack. Unmatched names keep their
  (empty) boxes, so a layout can be drafted before the frame is wired. Layout is also a
  wired `strIn` (a Note can author it); the card textarea is the Mermaid source pattern.
- **Row is the record pick** (1-based): unwired → card literal + pager (clamped and
  mirrored, the Histogram `bins` pattern); wired → the cable wins, blank or out-of-range
  renders the boxes EMPTY per the figure-datum rule (never an error out `chart`).
- **Images render in boxes with NO new column type**: a string cell that is a `data:image/`
  or image-extension URL becomes the picture (`recordImageSrc`). The author's proposed
  Image FrameColType is evaluated in `deferrals.md` — display-layer detection delivers the
  outcome without touching the backends.
- **Seed `record-cards`** (Record Cards, order 45), ONE Record node by author order:
  Parts frame (7 columns incl. date, logical, and data-URI SVG photos) → the layouted
  card (Photo spans four rows), its Row driven by a search chain (Find SKU →
  Get Column(SKU, text) → XMATCH), its chart into a resizable Display and a Report
  `=part` embed.
- **XMATCH's sockets went wildcard** (author challenged the numeric-only typing; it was
  DRIFT, not a decision): the kernel (`xmatchIndex` + `lookupEq`) was always
  type-agnostic for exact match — case-insensitive text, Excel's lookup equality — and
  `=XMATCH("a", …)` already worked on the formula surface, so only the node's `numIn`/
  `listIn` plugs locked text out. Now `anyIn` lookup (autoLiterals dual-map literal,
  `pickSlot` exported from logic.ts as the one reader) + `adoptiveListIn` array; the
  approximate modes still compare numbers IN the kernel (targeted `#VALUE!` for text).
  Pinned in `finePrintContract.test.ts`.
- Verified in the live app via the Playwright loop (pager flip, wired-row search, report
  embed); `visual.test.ts` pins parser, image detection, formatting, and the row contract.
- **Record grew its three views + the linked-widget output** (author green-lit the
  high-confidence set; maximal merge on the ONE node): op selector Card | Gallery |
  Board (`RECORD_OP_META`). The view selector is **argument-kind** in `NODE_OPS`
  (author correction — a view is a presentation parameter of the one figure, not
  three things you'd call by name; the first cut shipped operation-kind and was
  reverted same-day). The op owns the Row / Group-by sockets — `setOp` swaps them,
  the component prunes departing cables first (SSOT-9, the ChartNode pattern).
  Gallery tiles rows as capped-width cards packed from the left (a `1fr` stretch
  read as a stacked list, not a gallery — author flagged it); Board lanes by a
  named column (blanks last as `—`, the grouping column skipped in default stacked
  cards); both cap at 60 cards with `+N more` in the payload. The `picked` output
  echoes the card view's resolved 1-based pick (Grist widget linking: wire it
  onward and downstream follows the pager). Verified live through the LazySelect
  op picker (its options mount on focus — scripted pickers must focus first).
- **The Table popup gained a FORM view** (record-at-a-time entry, the Airtable
  form; frame-source editors only, gated on `onSaveSource`): Grid | Form | CSV.
  One record as stacked labeled sunken fields with a pager and + Record /
  − Record; it rides the SAME raw-text grid truth and edit-draft path as the grid
  cells (blur/Enter commits, Escape reverts, Save persists as before), so nothing
  new touches persistence. Its cursor is a source row — it reaches rows past the
  grid's 1000-row render cap. Computed columns render read-only. Delete removes
  the CURRENT record (row order is untouched, so column sort keys stay valid).
  Field placement is the SAME Record layout text (author follow-up), and the form
  IS the record-card look made editable (second author round: no layout text
  visible in the popup): touching square boxes, label in-box, the input as the
  box's value line; the focused box lifts its accent edge over the overlapped
  hairlines. The layout is authored on the FRAME INPUT CARD exactly like the
  Record card (same textarea, blur-commit), persisted as
  `FrameInputNode.stringLiterals.layout` (the declaration is the load gate) and
  threaded FrameInputComponent → FrameDisplay → FrameChip → popup state
  read-only. Empty = stacked boxes; unmatched names keep inert boxes; columns off
  the layout are hidden from the form. The seed's Parts frame carries the Part
  card's layout. Remaining lifts stay in `deferrals.md` (select/categorical
  columns upgraded to "backlog with interest, larger 1.4 look" — author).

Swept verbatim to [`archive/dev-notes-history.md`](archive/dev-notes-history.md)
(latest sweep 2026-08-18: through the 2026-08-17 window — the architecture-map &
Inspector, wrap-style and opaque-chrome sessions). `git log` is the per-commit record.
