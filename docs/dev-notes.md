# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems. Per-item entries are
swept to `archive/dev-notes-history.md` once digested — read a digest first;
drill into the archive (or `git log`) only for the mechanics of a specific item.

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

### GPU renderer — the pan-perf regression ROOT CAUSE (2026-07-16, fixed `e3097921`)
`__hcStats()` on the PF-seed benchmark read `built: 0, failed: 114` — NO mip pyramid ever built, so
every visible node re-rasterized via drawElementImage on EVERY pan frame (fps 165 → ~45; drawMs≈0 is
misleading — the raster cost lands in the browser's paint, not the measured JS). Cause is WICG API
drift, confirmed against the current html-in-canvas spec: **`ElementImage` is only
`{width, height, close()}` — NOT an ImageBitmapSource** — so `createImageBitmap(captureElementImage(el))`
(which early builds tolerated) rejects in Chrome 149/150 origin-trial builds. Fix: when the bitmap
paths fail, raster each clone into the MAIN canvas during the `paint` event (spec: draws land in the
current frame; rendering is explicitly read-back-allowed), snapshot the region with
`createImageBitmap(canvas, …)` (copies at invocation), build the pyramid from that; drawFrame clears
within the same paint task so scratch pixels never present. Batched 16/paint, retries for clones that
missed the latest rendering update, a one-shot blank-readback validation (a deferred-raster build can
never cache blank textures), in-flight marking. Diagnostics that found it and stay in: `__hcStats()`
(built/failed/slow/domOnly), `__hcTriggers` (rebuild causes), `__hcProbe()` (verbose per-stage pipeline
probe with real error text). Untested secondary suspect (author): drill-in alternate-canvas overhead —
if pan is still rough with `built≈total`, compare a composite-free doc against the PF seed.

### SESSION DIGEST (2026-07-16f — 1.2 author-eyeball round 1 fixes: GPU renderer, drill-in cable-drag, chart polish)
Author walked items 1–19 of the release eyeball; this session fixed what it surfaced.
- **GPU renderer (HTML-in-Canvas) regressions:** (1) collapsed-group members drew during pans —
  group collapse hides members via inline `visibility` and fires `area.update` for the GROUP only,
  so once targeted re-capture landed nothing ever dropped the member bitmaps; `HtmlCanvasLayer` now
  subscribes `groupCollapseStore` → full rebuild. (2) Canvas-drawn figures (Surface + the whole
  2026-07-16 chart wave, Point Plotter/Curve/Grid Painter pads) captured BLANK — `cloneNode` copies
  a `<canvas>` element but not its buffer; `syncCanvasState` blits each original's pixels onto its
  clone. (3) `buildMips` starvation: work arriving mid-build (updateNodes during an async build)
  early-returned on the `building` guard and those nodes never got pyramids — permanently on the
  slow per-frame `drawElementImage` path; the build now loops until no unbuilt node remains
  (`mipFailed` marks permanent createImageBitmap failures so it can't spin). (4) Diagnosis for the
  reported "renderer hangs — is something rapid-firing?": `window.__hcTriggers` counts every full-
  rebuild cause + targeted render-pipe update; read it while reproducing.
- **Drill-in cable-drag flag:** the composite mount's ConnectionPlugin never got Canvas's
  `connectionpick`/`connectiondrop` pipe, so `cableDragStore` never flipped inside a drill-in — the
  Conduit's expand-on-drag-near / phantom-lane grow never triggered (author report), the
  `--cabling` touch CSS never applied, and an uncommitted text edit wired stale. Mirrored the pipe
  (quick-wire stays main-only, D2).
- **Charts:** height colormap is now PALETTE-DERIVED (`heightRampColor` in palette.ts — slots
  violet→blue→teal→green→gold on a forced lightness ladder; viridis-look preserved in Default,
  retints on palette switch, grayscale in Equinox; `SurfaceView.heightColor` delegates). Vector
  Field arrowheads are filled triangles (the two swept strokes blobbed at small magnitudes; tiny
  arrows draw a bare shaft, shaft width scales with magnitude). Calendar heatmap caps shown weeks
  to what the box renders at ≥3.2px/cell (most recent first) + a dim "last N wk" truncation hint.
  Contour's corner coordinate hints moved into real top/bottom gutters (they overlaid the fill —
  illegible at Report sizes). PresentationComponent never subscribed to appThemeStore, so palette/
  theme switches left its accent stale — subscribed.
- **Waterfall "can't render below 0" RESOLVED:** author's test data (2+4−6) summed to exactly 0 —
  not a bug, the chart was right. `__hcTriggers` readout confirmed no runaway rebuild trigger
  (render-pipe counts climb only on group expand/collapse — one event per member re-render).
- **Dimension-keyed joins (author decision: tagged units do NOT match across dims or bare):**
  Nest/relate keys are now (dimension symbol, BASE-SI magnitude, +currency code) — `dimKeyId` in
  frame.ts; `keyId` handles per-cell `UnitCell`s (ratio keys bare), `keyIdInColumn` dimensions a
  united frame column's bare cells, `cellKeyId` takes the child column's unit. So 5 km == 5000 m
  but ≠ 5 kg ≠ bare 5, and $5 ≠ 5€. Pinned in cubeNodes.test.ts; backlog entry closed.
- **Popup formatted view is now EDITABLE (author request):** a literal source's (Frame/Table
  Input) Formatted view edits through a focus draft — at rest the cell shows the derived render,
  focus swaps in the RAW text (Excel's formula-bar-in-cell idiom), blur commits to the raw grid
  and re-renders formatted (units/dates/number formats); Enter commits, Escape reverts. The
  Source view is unchanged; the formatted CSV view stays a read-only projection.

### SESSION DIGEST (2026-07-16e — 1.2 release run: movement pass, composite parity pass, PF seed, release docs)
Author's release directive: punt all puntables (iFrame, Data Feed widening, drill-in nav/lasso/group
tools, F-2 doc-level FC defaults → 1.3), then movement pass, composite parity pass, PF seed, docs,
release prep; author gates the merge to `main`.
- **Movement pass (`dad24aa`):** the Align Bar's `measuredBox()` (nodeSize.ts) is now the ONE size
  read across the movement stack (tidy/push/standoffs/splice/focus — five ad-hoc variants replaced;
  OutlinePanel had a REVERSED read that centred on a collapsed group's stored expanded box). **The
  wonky-Tidy-around-expanded-groups root cause (1.2-plan Tier 1): stale expand-push restore records
  re-armed by the merge path** — programmatic moves (Tidy/Cleanup/align) fire no `nodedragged`, so
  records survived with ancient preX/preY; the merge now voids-and-replaces a record whose node moved.
  Plus: frozen-member-card fix (hostFootprint restricted to layout targets), ELK restores before the
  anchor measurement, integer autogrow dims. New: `groupPushRecords.test.ts` +
  `tidyArrangeGroups.test.ts` (headless real-ELK harness, 7 invariants).
- **Composite parity pass (`a980ea5`):** new `getOwningArea()` seam twin; seven main-graph escapes
  fixed — drill-in cables (color/ribbons/z), NodeCard re-measure, FormulaPopup (silently never opened
  inside a composite), Conduit (lanes/z/extend spawned on MAIN canvas), Go-to-source/flyToNode, Align
  bar gated off while drilled in. Known folds left (IsolateEndpoints terminals, CableInspector, pins
  for internal ids, menu Add-connection = D2).
- **PF seed (`6898315`):** "New in 1.2" section — budget Waterfall, January daily-spend Calendar,
  Fill Down → Group By un-merge chain (generator-locked).
- **Release docs (`abfa36f`):** `release-notes-features.md` rewritten for 1.2 (1.1 → archive):
  8 slides (units flagship, Monte Carlo, draw-your-data, terrain & fields, 7 new charts, Obsidian
  both ways, table cleanup, scrub) + body sells + GitHub changelog bullets + pruned Known Issues;
  in-app What's New slides + WHATS_NEW_VERSION → 1.2; punts recorded.
- **Verify:** tsc clean · vitest 2983/2983 (+1 skipped) · cargo 72/72 · seeds round-trip. Version
  bumped to 1.2.0 on develop; the author performs merge → `main` + `v1.2.0` tag + desktop build.

### SESSION DIGEST (2026-07-16d — fun-nodes waves: charts, draw-controls, 7-seg; scrubber fix)
Author picked from a brainstorm ("widgets, controls, fun charts" — inspired by Surface/Grid
Interpolate); rejected: Play node (the Slider already has play+speed), Choice node, standalone lamp
(→ Alert if anything). Shipped in three pushes (`46e4903`, `9f5ed78`):
- **Chart wave (7 nodes, all canvas-drawn like SurfaceView, ChartValue payloads → Report-embeddable,
  one shared component factory `FigureNodes.tsx`, views in `chartCanvasViews.tsx`):** **Contour**
  (Surface's flat twin — same bordered grid, bilinear bands + marching-squares iso-lines),
  **Waterfall** (Label+Delta frame → bridge with computed Total), **Candlestick** (Date+OHLC frame,
  the Data Feed shape), **Boxplot** (per numeric column; PERCENTILE.INC quartiles, Tukey whiskers,
  outlier dots — `boxplotStats`/`quantileSorted` exported + tested), **Calendar** (weeks×weekdays year
  grid; date column read as raw serials), **Waffle** (10×10 largest-remainder shares; single 0..1
  value = fraction), **Vector Field** (u/v matrices → arrows, viridis magnitude). Visuals pane
  regrouped (Distribution / Proportion / Grids & Fields / Time & Finance); Contour/Quiver = "na" in
  the matrix-unit POLICY table.
- **Controls wave:** **Point Plotter** (click/drag/right-click-delete points on a plane → X/Y lists),
  **Curve** (draggable control points, Fritsch–Carlson monotone spline — no overshoot — sampled to a
  list + X positions), **Grid Painter** (brush-paint a matrix; right-drag erases to null), all
  persisting as TEXT (`pointsText` added to INIT_FIELD_ORDER; Grid Painter reuses `tableText`).
  **7-Segment** readout (flat: accent segments over faint ghosts, NO flap/skeuomorphism per author +
  DESIGN.md; all-dash overflow; pass-through like Gauge).
- **Scrubber fix (author-reported):** Number Input's main field had NO scrub handlers (only inline row
  literals did) — extracted `useNumberScrub`, wired it in; fine-step math fixed (Math.round(steps ×
  mult) could only yield integers, so Alt-0.1× was a slower integer scrub).
- **Table-timesaver wave (author-approved from the research): Tier 1+2 SHIPPED.** New eager frame
  verbs (pure fns in `frameVerbs.ts`, Split-Column-pattern nodes, NO engine changes — eager like the
  existing half of the verb set; native Polars mirrors backlogged as a perf follow-up): **Fill Down**
  (down/up, columns or all — the PQ report-un-merge; errors are values, not blanks), **Replace
  Values** (whole-cell — numbers match numerically, replacement coerces to the column type — or
  substring on text; case-sensitive per our key convention), **Merge Columns** (inverse of Split
  Column; formatted cells + separator, sources drop), **Promote/Demote Headers**, **Drop Blank Rows**
  (all-blank spacers / any-blank). **Head** gained First/Last/Skip/Range modes (first-N stays the
  lazy verb; the rest eager). **Add Index** gained the two-way `grid` OUTPUT: the data indexed on
  both axes as the coordinate-bordered matrix Surface/Contour/Grid Interpolate read
  (`borderedGridFromFrame`). **Frame Sort**: no multi-key build needed — both engines' sorts are
  STABLE (JS spec; Rust `maintain_order(true)`), so chaining Sort nodes IS multi-key (documented in
  the catalog description). Table verbs pane: new ▶ Clean subcat; Columns subcat took Merge/Promote
  (12 rows exactly). Tier 3 (Computed Column, Data Table sweep) → backlog, design-first.
- **Post-ship fixes (author-reported):** Curve black-carded — its component called `data.data()`
  bare and the coerceInputs wrapper does `Object.keys(inputs)` on undefined; extracted pure
  `sampleCurve` (rule: components NEVER call node.data()). Point Plotter/Curve pads overflowed the
  card — `.solenoid-node` is a FIXED 180px and a class `width` field is only the layout mirror;
  both joined the wide tier in `nodeWide()`. 7-Segment output: pass-through → CHART value
  (SevenSegPayload; view shared via chartCanvasViews for Report embeds).
2973 green; tsc clean.

### SESSION DIGEST (2026-07-16c — Add-menu pane budget + search fix) [audit session, author-requested]
Author goal: every Add-menu pane ≤ 12 rows (no scrollbars; the panel scroll-caps at ~392px). Seven
panes were over (worst: Table verbs 20, Aggregate 19, Geometry-with-packs 15). All now ≤ 12 with packs
active (verified against `buildCatalog(true)`):
- **Pairs** (row-halving, kept opposites/kin): RAND|NA (Input), Note|Report + Convert|Cast (Output),
  SLICE|Pad (List Shape), ACCRINT|ACCRINTM (Finance Other), WORKDAY|NETWORKDAYS (Date & Time),
  Select|Drop Columns + Nest|Unnest (Table verbs).
- **Merges**: Hyperbolic → Trigonometry (sinh beside sin); Bitwise → Engineering (Excel files BITAND
  there too); the 2-row Probability category (PHI/GAUSS/STANDARDIZE) moved to **Distributions ▸
  Normal** with their NORM.* kin (kept `keywords: "probability"` so search still finds them).
- **New subcategories**: Aggregate → *Spread & Shape* (stdev/var/skew/kurt…) + *Correlation*
  (correl/covar/fisher/paired sums); Table verbs → *Columns* (select/drop/rename/split/index),
  *Reshape* (PIVOTBY/Unpivot/Nest/Unnest), *Analyze* (Decision Matrix/Sensitivity/Reconcile).
- **Misplacement fixed**: XNPV moved from Finance▸Other to Cash flow analysis, beside XIRR.
- **Geometry pack** placement now by subject not wave: first-wave circle/solid formulas file under
  Circles & Arcs / Solids; Distance (3D) + Box Diagonal surface beside Distance (2D). Arrays unchanged
  (tests slice by wave); only `placeFormulas` paths partition by type id.
- **Search fix (author-reported)**: "+ Add"/"× Multiply" glyph labels only earned the word-start tier,
  so "add" ranked Add Column/Add Index above the Add node. `scoreLeaf` now also scores the
  glyph-stripped label (`stripGlyphPrefix`) — exact tier restored; pinned in catalogSearch.test.
No type ids changed (saves unaffected); Select/Drop Columns keep their full labels. 2939 green.

### SESSION DIGEST (2026-07-16b — commit-walk audit of develop, newest-first) [audit session]
Standing audit walk (author-authorized refactors; author reviews at session end). Reviewed so far,
newest-first: `f90a850` docs · `57831f8` integer dims · `8d4b416` radius pass · `9f3c760` TPS forecast ·
`86f3de3`/`6a92675` Import-from-Obsidian · `060a345` Write-to-Obsidian · Surface series (`de76ec6` →
`e3d10e1`, renderer math + node verified: depth convention, painter's sort, wall pick all correct) ·
`7f3d375` Forecast toggle (labels already reconciled by the TPS commit). Fixes shipped (`8622a72`):
- **Write-to-Obsidian chart export was silently broken**: `rasterizeSvg` string-prepended
  `width`/`height` onto a root that (recharts) already has them — duplicate XML attrs are a fatal
  parse error on an `image/svg+xml` blob, so every recharts chart ref exported as "". Now sets attrs
  on a parsed DOM root + `XMLSerializer`.
- Vault subfolder fields drop `.`/`..` segments (a stray `..` wrote outside the vault).
- `componentForNode` in nodeRegistry: exact-constructor Map first, ordered `instanceof` fallback —
  the `86f3de3` "subclass must precede base" ordering rule is no longer load-bearing; a
  catalogRegistry test pins every registered class → its own component.
- Group dims integer-rounded in `makeGroupFromSelection` + `autofitGroupBox` (the 57831f8 pass missed
  both, so an autofit re-introduced fractional dims); `GROUP_MIN_W/H` now shared constants.
- surfaceFit: loop min/max (spread blew the arg limit on huge grids). Radius stragglers: nbmodal
  panel + mobile menu sheet → 8px.
Checks: `tsc` clean, 2911 green. Sink-node invariant verified on WriteObsidian (`enabled` not in the
copyPaste whitelist — loads start disarmed).
**Turn 2:** reviewed `1cdb519` (neutral cycle — solid, tested), `ec53ed7`/`d43313c` (document socket),
`8008311`/`bf00b79` (DocumentValue plumbing), `03051f8` serializer, INTERPOLATE chain's converged
state, SurfaceView projection math. Fixes: **the `document` socket had skipped the socketConnect full
sweep** — object-family tests now loop `OBJECT_TYPES` (lambda/chart/document; identity-only + no
cross-connect + wildcard lists include document), so the next object socket is covered by extending
one array; `yamlScalar` quotes leading YAML indicators (`*anchor`, `&ref`, `- item`, `.5`, `.inf` —
were emitted unquoted = misparsed frontmatter), tests pinned; `NEUTRAL_HEX` null-prototype (a stray
stored slot like "constructor" hit `Object.prototype` and returned a function from resolveColor's
"total function" path). **Turn 3:** reviewed `063e256` (typed CubeColumn — solid) and found the SAME type-drop it fixed in
`cubeRowAt` at two sibling sites: **`nestFrame` dropped the key column's type** (so a NESTed cube —
the natural producer of key-columned cubes — lost date-matchability in cube XLOOKUP) and INDEX's
whole-row cube slice (`list.ts`) dropped per-column types. Both carry `type` now; test pins nest.
`relateFramesToCube`/`subCube` already carried it. MODE consolidation (`3e35bfd`) reviewed — sound;
aggregate-side single-value is inherent (cell = scalar). Author queued two items → backlog: Frame
socket unique glyph; Reference overlay Socket tab → full data-model chapter (types/units/
dimensionality/coercion). **Turn 4:** reviewed `6343f4d` (WORKDAY holidays — Excel-correct), `636308c` (matrix-unit policy
guard), `39b487a` (cube per-cell units). Findings: **the policy guard's completeness sweep only saw
matrix.ts** — registry-wide there are 16 matrix-taking nodes; the sweep now walks NODE_COMPONENTS
and the policy table covers the escapees (visuals na, 2-D lambda family strip, BuildFrame strip
w/ note). **INTERPOLATE grid mode now CARRIES the D20 grid unit** (was silently dropping; dynamic
socket, kept in POLICY by hand + behavior test). **Re-surfaced the flagged-but-dropped
dimension-blind cube join key** (check-in #4) → backlog entry (design call, both key sides must
change together — not patched blind). **Turn 5:** reviewed composite run-mode/marker readouts (clean, tested), `b2250c3` coercer unit fix
(complete — only the `table` case rebuilds), `4533964` unified passthrough system (well-designed;
one source of truth held), `9ad1037` adoptive base-rung coercion (well-pinned). Fix: **Fill/Coalesce
was never opted into the passthrough system** — IFERROR (its 2×2 recover-sibling) passed units,
Fill didn't; now declares coalesce=`agree` over list+Else rows, impute modes=`single` on the list.
Pinned in passthroughSystem.test.ts. **Turn 6:** author decisions applied: EXPAND unwired Fill pads `null` not #N/A (`74b7af4`; NA node
recovers Excel's form; VSTACK/WRAPROWS ragged #N/A confirmed KEPT — signals a real misfit). Reviewed
`7f2e3b3`/`91352f8` selection fixes (lasso + belt-and-suspenders in group/composite-from-selection
— verified Ctrl+A's exposure is fully guarded downstream; select-all-delete/copy legitimately means
everything), `52472f3` dimensionless-adopts (found an undecided edge: **adoption is at BASE-SI face
value** — `SUM(5 km, 3)` reads 3 as 3 m; backlogged as an author call, display-unit adopt vs
document). **Turn 7 (author-directed):** **D21 recorded** — selection surfaces act on what you can SEE, and
audit calls default to FIX. Ctrl+A now skips collapsed-group-hidden members AND isolate's receded
non-focus nodes (opacity .08, pointer-events none); the lasso gains the isolate filter too (it
already skipped collapse-hidden). Deleting a collapsed group never deletes members, so nothing
becomes unreachable.
**Turn 8 (incl. the author-directed formula-editor work, `d843b27`):** formula editor gained curated
signatures + a param-hint bar (arg-count surfacing, author request), targeted parse-failure messages
(braces/=/semicolons/parens — the user's exact trap), lambda-family inline formulas reject unknown
names with the LAMBDA-capture guidance, and the function NAME LIST was fixed (registerInternal names
+ two-level dotted + function-attached namespaces were missing → XLOOKUP/XMATCH/INDEX/T.DIST/NORM.S.*
worked but never autocompleted; the D10-eliminated classics are now excluded from autocomplete).
Units-run audit: ratio minting + Convert primacy clean; **custom FC unit axes made case-INSENSITIVE**
("Widgets"+"widgets" #UNIT!'d as different dimensions; display keeps typed case); the Expression-`/`-
no-ratio follow-up moved from a digest line into the backlog. Byte-order sort verified (data plane
all through compareStrings; remaining localeCompare = UI lists only). **WALK VERDICT: diminishing
returns below 2026-07-14** — older history (the 1.2 overnight build, v1.0/1.1) had contemporaneous
audits and its current state is exercised by the guards added this session. **Turn 9 (author items):** Table Input blank-row fixes (`13bc58b`, `d0bb446` — blank rows are data
wherever they sit; only the final-newline TERMINATOR + trailing all-blank COLUMN trim; the
never-coerce-the-Source rule recorded in CLAUDE.md; popup save no longer destroys them; round-trips
pinned). **Item B SHIPPED:** the Reference Socket tab is now a data-model chapter — new
`help/data-model.md` (rendered after the DimensionalityFlow visual): exact flow edges (combo narrows,
frame/cube outputs, logical bridge, Any ladder + hollow-ring adoption, object family), the coercion
boundary (list = ONE ROW, blank = null, never-coerce-the-Source), and the UNITS chapter (per-rank
carrier table — list per-element vs matrix whole-grid vs frame per-column; adoption, ratio, no-FX
currencies, custom dims, format-vs-unit split). **Turns 10-12 (author-driven, rapid-fire):** Table Input trailing blank rows kept (`d0bb446` — only
the newline TERMINATOR + trailing blank COLUMN trim; single-col trailing blank row gets its own
terminator in rawCellsToText). Omitted formula args = BLANK (`9a7f425` — `IF(x,,y)` parses to a
`blank` AST node → null; internal IF keeps null branches (Formula.js coerced to 0; Excel's omitted
arg IS 0 — author chose null); IF joined NULL_INSPECTING; missing CONDITION still propagates).
MUNIT 0-vs-blank SegToggle (same commit). **Filter `is blank`/`not blank` ops** (`12b5f3c` — all
three condition cards; passesFilter pre-null-guard; errors are present-not-blank; Rust parity via
is_null/is_not_null, cargo lib suite RUN IN-ENV (GTK deps + -j2): 72 green; value field hides;
the "not written yet" guard skips only valued ops). **Grid Interpolate contested-box rule**
(`4c7c930` + `204d855` — a bilinear box/span containing other known data defers to the spline; the
sine-diagonal + 0-corners case now interpolates through the diagonal, edges curve too; hole-fill is
now a spline fill, same value to float-epsilon on the pinned fixture). **Item A SHIPPED: the Frame
socket glyph** — sheet-with-a-header (solid band + one column divider), own render branch in
SocketComponent + legend `frame` kind + pixi `frame` GlyphKind (glyph test re-pinned), docs updated
(data-types.md, CLAUDE.md legend line). **Turn 13 (author, tan-grid):** Grid Interpolate widening search CAPPED at 4 steps/side (`9092ac0` —
the contested rule made scattered grids exhaust O(lines⁴) boxes per cell; 40×40 tan diagonal now
fills in 73ms) + ONE shared forced-scientific rule (`extremeSci` in format.ts: |n| ≥ 1e12 or nonzero
< 1e-4 → trimmed e-notation) wired into formatScalar / TableDisplay cells / the popup's auto format;
explicit user formats untouched. **Turn 14 (author decisions):** wakeup loop STOPPED (author). **Bare-number adoption now reads in
the DISPLAY unit** (author: SUM(5 km, 3) = 8 km): `adoptMagnitude` in unitValue (resolver hook —
parseUnit default, unitBridge upgrades to the full FC table at load; scale only, never the affine
offset; unresolvable/custom ids keep face value) wired into forAggregateUnits (two-pass so a leading
bare adopts), arithmeticCell +/−/mod (×/÷ keep face — a factor is a factor), and compareUnits.
Backlog flag closed. **Popup cell fit for forced scientific**: per-column min-width computed from
CONTENT length × the mono font's true advance (27/42 em from the shipped .fnt metrics) — inputs
contribute no intrinsic width, so sci values clipped in the 72px floor; only wide columns widen
(200px cap, text columns untouched). REMAINING author call: dimension-blind cube join key.

### SESSION DIGEST (2026-07-16 — UI corner-radius reduction pass)
Node cards 8→6px; group/note/conduit and Note/Group-derived cards (Presentation, Report, Image,
SessionHistory, SvgPicker) brought in line (inner header/footer corners track their card). Overlay chrome
swept: 8→6px panels/popups/toasts/menus/HUD, 12/10→8px dialogs (command palette, socket legend, minimap,
cable inspector, dialogs, value popups, add menu); pills (999px) + count badges left. Node resize grip
z-orders above the group-membership corner. Settings + Add menu scroll an INNER region (`overflow:hidden`
+ radius on the outer, scroll on the inner) so the native scrollbar is cleanly clipped by the rounded
corner; add-menu `max-height` nudged 384→392 so the default 12-item tree doesn't spawn a scrollbar.
Commits `8d4b4160`, `57831f8e`. Left the selection-ring 0.5px artifact OPEN (above).

### SESSION DIGEST (2026-07-15k — Matrix homogeneous units (D20): author → flow → display) [Agent 1]
Threaded S3 (matrix units) from the tagged-representation foundation to an end-to-end slice. **The
model:** a numeric matrix carries ONE unit for the whole grid (D20) as a non-enumerable symbol tag on
the outer array (`matrixUnitOf`/`withMatrixUnit`/`carryMatrixUnit` in `unitValue.ts`); cells stay bare
as-typed numbers (5 for 5 km), exactly like a Frame Input column. **Fixed the mutation bug Agent 3
flagged** (`0acdb709`): `applyFcUnit`'s matrix branch tagged `value` IN PLACE, but rete-engine's
DataflowEngine hands the same cached array to every consumer — so an FC tagging a matrix stamped the
unit onto the UPSTREAM node's cache and two consumers raced. Now tags a `.slice()` copy (rows/cells
stay shared, only the outer array is fresh). **AUTHOR** (`906cc347`): a NUMBER Table Input is a
unit-taggable source — persisted `unit` field (FC unit id / "none"), `data()` tags via `applyFcUnit`,
the popup matrix bar's unit dropdown persists through a new `onSaveMatrixUnit` on `TablePopupState`;
`unit` was already whitelisted so it round-trips free. (The FC also authors a matrix unit, unchanged.)
**FLOW** (`ce9e045e`): the unambiguous matrix→matrix structural reshapes re-carry the tag onto their
fresh output arrays — TRANSPOSE, CHOOSEROWS/CHOOSECOLS, TAKE/DROP (table), EXPAND (`carryMatrixUnit`,
a no-op when untagged, so plain/text matrices stay plain). **DISPLAY** (`e9af4b05`): `ArrayChip`
appends the unit to the chip label ("3×4 Table · km") + passes it as `columnUnits[0]`; the popup
matrix bar shows a static unit label (read-only) or the dropdown (taggable source); `colHeaderLabel`
guards matrix mode so the unit rides the bar, not column A. **Then the domain refactor (author: "do the right thing, risky rewrite authorized, don't half-ass"):**
after mapping the whole units domain (an Explore agent's report), the smell was ONE concept with a
carrier per rank + one gap. Rejected a `MatrixValue` wrapper — the fragility is LOCALIZED to array-
rebuild sites (`toMatrix`/`toAnyMatrix` pass a genuine matrix through unchanged), so wrapping the
universal coercers would be domain-wide churn for a niche gain; the right fix is a complete, self-
guarding discipline. **The real INDEX bug** (`b2250c30`): my first INDEX fix passed a direct-data()
test but not the live graph — a numeric matrix wired into INDEX's adoptive trueany input makes the
socket adopt "table", so `coerceValue`'s `table` case ran `toMatrix` (rebuild) and dropped the tag
BEFORE INDEX ran; fixed by carrying the tag across that rebuild. **Closed every matrix-op gap +
the guard** (`636308c8`): VSTACK/HSTACK carry-if-uniform (`sharedMatrixUnit`); TOCOL/TOROW→list and
WRAPROWS/WRAPCOLS←list now CONVERT carriers (`taggedListFromMatrix`/`matrixCellsFromList`, TableReshape
is `unitAware`); `matrixUnitPolicy.test.ts` — a per-op policy table (carry/carry-if-uniform/convert/
strip/na/author) with a COMPLETENESS sweep that fails the build if a matrix.ts node ships without a
policy (the anti-recurrence mechanism). **Cube = units PER CELL, like a list** (author call, `39b487a4`, supersedes an interim
unit-blind attempt): a cube is heterogeneous per cell = the list's shape, so `CubeCell` includes
`UnitCell`; `cubeCellsFromColumn` tags a frame column into the cube (both flattening paths),
`inferColumn` recovers a uniform column unit on cube→frame (reusing `matrixCellsFromList`), the
viewer renders "5 km". D20 + subsystem-invariants "Unit flow" amended with the per-rank carrier map
+ the guard + the cube-per-cell call.
Storage note recorded: scalar/list `UnitCell.value` is BASE-SI, frame/matrix cells are AS-TYPED, so
crossing carriers CONVERTS. Verified NON-gaps afterward: Convert-on-a-matrix unreachable (a matrix
can't wire into Convert's `numlist` input — the FC relabels matrices), MMULT-dims + unitLattice-matrix
MOOT (no element-wise matrix arithmetic node). **Units domain COMPLETE across all five ranks.**
**Follow-ups landed same session:** (1) **popup flow-arrows + locks** (`02ad50dd`, ⏳ author visual
review pending): the value-popup format/unit dropdowns adopt the FC's ←/→ language — authored (← →,
editable) for a taggable source's unit + the format, inherited (→ →, LOCKED disabled picker) for a
derived frame/matrix unit (`FcArrow`+`FcFlow` factored into `fcControls`, FC node uses the shared
copy; the derived unit moved from the column-header parenthetical into the format row). (2) **Typed
`CubeColumn`** (`603a58b5`): `CubeColumn.type?` carried by `frameToCube`/`relateFramesToCube`/`subCube`
so a flat cube renders dates-as-dates / logicals-as-TRUE-FALSE (`cubeCellToken`/`CubeCellChip` render
by type); the "cube socket eats frame types" display bug is gone (XLOOKUP cube-path date-matching +
`rawInputs` retire is the remaining node-specific follow-on). tsc clean, 2837 green throughout.

### SESSION DIGEST (2026-07-15m — Surface node: shaded 3-D plot of a bordered table) [Agent 2, off-theme]
New chart node (`nodes/visual.ts` `SurfaceNode`, Charts category) pairing with Grid Interpolate: it reads
the SAME coordinate-bordered table (row 1 = X coords, column 1 = Y coords, interior = Z; `parseBorderedGrid`,
exported + tested) and emits a `surface` `ChartValue` (new `SurfacePayload` in `chartValue.ts` + a
`ChartFigure` dispatch branch, so it embeds in a Report like any chart). Rendered by `components/
SurfaceView.tsx` to a **`<canvas>`** (one DOM element regardless of grid size — deliberate, keeps DOM
weight flat): axonometric projection, each cell a flat-shaded quad (per-face Lambert light + a viridis
height colormap), painted back-to-front; a null Z cell is a hole. **Reference frame** (author asked, then
"too basic — just overlays"): a light gridded FLOOR + two BACK walls drawn BEHIND the surface so it sits
inside the box and the near parts are occluded (matplotlib/plotly look), X/Y/Z labels on the box edges —
NOT lines floated on top. **Rotation (author):** the fixed axonometric projection became a yaw/pitch
orthographic CAMERA (yaw about Z, pitch = elevation); a D-pad of 4 arrows in the figure corner steps yaw
±45° / pitch ±45° (both wrap 0–360 — pitch flips all the way over), with a centre Home button resetting to
the default 45°/45° (symmetric, so the 45° steps land on clean multiples). Occlusion is recomputed from the rotated cell centroid and the two back frame walls are re-chosen by
depth, so the box stays correct at any angle. Angles live in `literals` (persist via extractInit spread +
ride into the payload, so a Report embed shows the same view). **Quality:** supersampled backing store
(`scale = min(4, dpr·2)`) + round line joins + slight surface translucency (`SURFACE_ALPHA` 0.86) so the
frame shows through. Theme-aware (reads `--text`, redraws on `appThemeStore`). Card mirrors Sankey (collapsible, ChartChip
when collapsed, `!collapsed` figure gate). Weight stays default 1 (a canvas is one element). Standard
node-add surface: chartValue + visual.ts + 2 components + chartView branch + index/registry/catalog + kind.
tsc clean, 2886 green. Commits `de76ec66` (node) + `270f967a` (3-D frame).

### SESSION DIGEST (2026-07-15m — INTERPOLATE node: piecewise-linear lookup-table interpolation) [Agent 2, off-theme]
New core node clearing the 1-D half of the Materials-pack "Interpolated Lookup" gate. **INTERPOLATE**
(`stats.ts` `InterpolateNode`, Regression category, `parity:false`): Known Ys / Known Xs lists + an X
QUERY → Interpolated Y. The query + result are a **numlist COMBO** (scalar-or-list, `numListIn`/
`numListOut` + `readInput`) — a single X in yields a SCALAR y, a list of Xs yields a list (result
mirrors the query shape, the standard broadcaster convention; author flagged the first cut's list-only
output). It does true lookup-table interpolation instead of a regression fit: for each query x, the y on
the straight segment between the two bracketing known points,
**clamped** at the ends (below the smallest known x → first y, above the largest → last y — a lookup
table doesn't extrapolate). Excel has NO direct equivalent — LOOKUP/XLOOKUP are STEP matches, FORECAST/
TREND fit a line through the cloud. Pure exported core `interpolateLinear(xs, ys, queryXs)` (sorts pairs
by x so known data can arrive unordered; duplicated x → first-seen y, no /0; NaN query stays NaN). Node
`data()` reuses in-file `forPair` for known-data errors/null-drop, propagates a query SolError, and keeps
a null query missing IN PLACE (position preserved). Use cases: hardness conversions, pump curves, pipe
schedules. Wiring surface was small — `export *` re-exports the class, ctor registry derives from
`FLAT_CATALOG` (catalog leaf auto-registers load/round-trip), one-line `makeNodeComponent`, index +
nodeRegistry entries; NO copyPaste change (no new persisted fields) and it falls through to the `math`
kind like its siblings. NO copyPaste change (no new persisted fields) and it falls through to the `math`
kind like its siblings. **GRID mode added (2026-07-15, one node, List/Grid dropdown) — the Interpolated
Lookup gate is now fully CLEARED (1-D + 2-D).** Design arc worth recording: a first cut took three
PARALLEL aligned inputs (Xs list + Ys list + a Z matrix) → resampled table; the author rejected that —
it violates the "user can't see or align parallel inputs" convention (same reason charts/SUMIFS/verbs
fold parallel columns into one frame), and our Matrix type has no inherent x/y coordinates to lean on
(and promoting a matrix's top row into Frame headers is the awkward conversion we avoid). The shipped
design is a **coordinate-BORDERED single table**: first row = X coords, first column = Y coords (corner
ignored on input, blanked on output), interior = Z with **blank cells to fill**. ONE Numeric Table in,
ONE out — coordinates sit next to their data, nothing to align. "Resample to a new point" = add a
coordinate + a blank row/column; the node fills it, unifying fill-holes and upsample. Fill is **true
BILINEAR interpolation** — the standard lookup-table method (MATLAB `interp2` / SciPy
`RegularGridInterpolator`, method="linear"). Two earlier attempts were WRONG and the author caught both:
(1) separable row-then-column degenerated to ROW-ONLY (a cell reachable along its row flat-filled, column
pass then skipped it); (2) averaging the row + column 1-D estimates was an ad-hoc heuristic that
over-smoothed and isn't a real method. The shipped version: the KNOWN cells define a coarse grid; each
blank is the bilinear blend of the four surrounding known corners, bracketing its X among the data
columns and Y among the data rows, and **widening the bracket past a blank corner** so a hole
interpolates ACROSS it. A cell that no four known corners enclose (a genuinely incomplete/L-shaped grid)
stays blank — honest, matching interp2's NaN. Per-cell error/NaN reads as a blank to fill; whole-grid
error propagates. **Forecast option (`InterpolateNode.forecast`, checkbox, ON by default — author):** a
TWO-PASS fill. Pass 1 = bilinear, but ONLY for cells ENCLOSED by known data (`sides()` returns null when
the query is past the data on an axis — no clamp/extrapolation there). Pass 2 (forecast only) = fit a
smooth surface through ALL known points and fill every still-blank cell — a **thin-plate spline**
(`surfaceFit.ts` `fitSurface`: passes through every point exactly, extrapolates a linear trend at the
edges), falling back to a ridge-regularised least-squares **plane** for degenerate data (<3 points or
collinear, where the TPS system is singular). So forecast fills the scattered gaps AND beyond the data;
OFF leaves them blank. Author's scattered 11-point test grid (data in every row/col so no global edge)
was the driver — the earlier linear-edge-extrapolation forecast did nothing there because nothing was
past the global extent. `surfaceFit` = a small Gauss–Jordan solve + the TPS kernel r²·log r, capped at
~220 points. Persists via the `"forecast"` whitelist entry. `surfaceFit.test.ts` pins interpolation +
planar-reproduction + collinear fallback. Verified: Z=x+y upsample exact, x·y hole
interpolated across = 1, edge clamp, incomplete-grid honest blanks. The mode dropdown reconciles the socket set (`_rebuildSockets`
+ `applyInterpolateMode` drop-cables-then-rebuild, the `applyEquationChange` pattern — the two modes are
different ops); `mode` persists via the existing init whitelist. Pure core `fillBorderedGrid` (replaced
the interim `bilinearGrid`). Commits `dc8c3602`/`9ab3e481` (1-D + combo), `3e35bfd6` (grid v1 bundled by
A1 during a stats.ts collision), `601b0403` (bordered-grid redesign). tsc clean, 2867 green.

### SESSION DIGEST (2026-07-15m — Unmount collapsed viz figures: finish + reconcile) [Agent 2, off-theme]
Closed the backlog "Unmount collapsed viz nodes' live figures" item — collapse is CSS `display:none`
(nodeCard.css:208), so a hidden recharts tree stays MOUNTED unless React gates it. Audited every
figure-bearing card: **Chart / Histogram / Sankey / Treemap** (the four the item named) + **Gauge /
Sparkline** ALREADY gate on `!collapsed` (done in a prior session, line never deleted — doc-rot).
**KPI / Bullet** are `collapsible={false}` + plain CSS/SVG (no recharts, nothing to unmount). The
4×4-capped **TableDisplay** grid is ≤16 cells, trivial. Two genuine stragglers, now fixed with the same
pattern: **Tornado** — `TornadoBars` (a full recharts BarChart per sensitivity row) stayed mounted while
collapsed; gated the Run button + bars on `!collapsed`, the `ValueDisplay` hero survives as the collapsed
readout. **Slicer** (scope extension, same spirit) — its interactive block (column dropdown + up to
dozens of value pills) stayed mounted behind the "X of N" summary; gated `.slicer-node` on `!collapsed`.
Filtering/selection is unaffected — state lives on the instance + the still-mounted component, only the
inner DOM unmounts. Render-only (no vitest surface, node-env). tsc clean, 2834 green. Backlog line deleted.
**Then swept the DOM-weight lever list closed:** (a) **SvgPicker weight 15 → 2** (`kind.ts`) — a stale
over-count. Since the rasterize-for-display change (2026-07-15i) an SVG Picker at rest is a single
`<img>`; the heavy inline SVG mounts only on hover, which never overlaps a pan/zoom gesture (the only
time the engage gate reads the weight), so its steady-state DOM is a light figure, not the old 15-tier
worst case. `kind.test.ts` updated (no longer "heaviest of all"; now grid-tier < chart). A doc of SVG
pickers now trips the gate at its true DOM cost, not ~10× early. (b) **`content-visibility: auto`
EVALUATED and ruled out** (backlog rewritten from "untried" to "blocked, here's why"): socket positions
are measured from live DOM geometry (`MeasuredSocketRow` offsetTop within `.solenoid-node__content`,
rete's `getDOMSocketPosition` offsetParent walk, the GPU clone's `offsetWidth/Height`, minimap/fit) —
`content-visibility` collapses off-screen descendants to `contain-intrinsic-size` and skips their layout,
so those reads return wrong socket offsets → cables jump at the viewport edge; an accurate intrinsic-size
fixes the outer box but not the socket-within-node offset, so it can't unblock. **With rasterize +
collapsed-figure-unmount shipped and content-visibility ruled out, the DOM-weight reduction lever set is
EXHAUSTED — the HTML-in-Canvas GPU renderer is the remaining path at scale.**

### SESSION DIGEST (2026-07-15l — Composite drill-in marker polish) [Agent 2, off-theme]
Two boundary-marker fixes from an author eyeball of the By-Row work. (1) **Input marker shows the real
input:** an externally-wired input marker now renders a read-only `CompositeBoundaryValue` chip of the
actual incoming value (any kind), not the editable seed number field — the seed only ever showed its own
default (misleading when wired; a number field can't represent a wired list/frame). Gated by a transient
`CompositeInputNode.externallyWired`, stamped each pass in `data()` from the container's `inputs`
(topology-only, so current even on a held heavy pass); an unwired port keeps the editable seed (goal-seek
seed / MC center still settable). (2) **Marker socket dots adapt:** the Input/Output markers used the
SHARED static `trueAnySocket` singleton (unmutatable → always the hollow ring). Each marker now owns a
per-instance `MutableSocket("trueany")`; `syncMarkerSocketTypes()` (called in `data()`) mirrors the shell
input port's adopted type onto the input marker and the internal source node's output type onto the
output marker. DISPLAY ONLY — plain MutableSockets stay OUT of the trueany adoption fixpoint (only
`AdoptiveSocket` participates), and the runtime value flows through untouched regardless of the dot's
shown type; the type re-derives on the next `data()` so no persistence needed. tsc clean, 2820 green.
Commit `6b2c76a2`. **(3) Goal-seek marker readouts (`70be5aba`, author idea — "the markers serve the
run mode, they don't have to stay plain"):** in goal-seek the driver INPUT shows a "solves to N" readout
and the target OUTPUT a "target N" readout (a small `MarkerNote`), so the drill-in explains the solve.
The solver no longer writes its answer back onto the driver's SEED (`defaultValue`) — that WAS the
"updates itself" — the solution now lives in transient `CompositeInputNode.solvedValue` (read by the
readout) and the seed stays the user's starting guess; `#CONV!` shows "no solution". New transient
`goalDriver`/`solvedValue` (input) + `goalTarget` (output), stamped in `data()` from the run
mode/config, cleared on leaving goal-seek. **(4) Extended to every run mode (`09964f51`):** a transient
`CompositeInputNode.modeNote {tag,text}` (stamped in `data()` via `inputModeNote`) makes each input
marker explain its role in the ACTIVE mode — Monte Carlo shows its ± spread + distribution, By-Row the
iterated port reads "one run per row", Scenarios "varies", Data Table "N values". Same `MarkerNote`
renderer; goal-seek keeps its richer solvedValue readout (modeNote is null there). The markers are now
genuinely run-mode-aware surfaces rather than plain seed boxes.

### SESSION DIGEST (2026-07-15k — Composite By-Row run mode) [Agent 2, off-theme]
Author-specced (2026-07-14) backlog item — the node-level "for each." A new Composite `CompositeRunMode`
`"by-row"`: pick an exposed INPUT port (`byRowPortId`, `ByRowEditor` "For each row of" dropdown) and the
subgraph runs once per ROW of that port's wired value, the row bound to that port while the others stay
fixed; each output collects a per-row series. Reuses `collectMultiple` (like Scenarios/Data Table) with
one override per row. Row semantics = pure exported `byRowValues`: a frame → one single-row frame per
row (`frameFromRows`, keeps the port frame-typed for downstream frame ops), an array → its outer
elements (1-D list → scalars, 2-D matrix → rows), a scalar → itself, null → none. Heavy (arm-and-run)
when a port is set; `BY_ROW_MAX_ROWS = 500` safety cap since each row is a full internal-engine reset (a
huge wired frame would freeze Solve — the Polars verb chain stays the bulk path). Persistence via the
copyPaste whitelist + `solveKey`; `byRowPortId` cleared in `removeInputPort`. **Known limitation:** the
500-row cap silently drops extra rows — replace with a Problems-panel warning later (no clean surface
from `data()` today). UI eyeball pending (mode + picker). tsc clean, 2816 green. Commit `f684815d`.
**Follow-up `a1799db3` (author eyeball):** the outer card shows a numeric-series output with a
`MiniSparkline` (pre-existing, all multi-run modes — NOT added for By-Row), but the DRILL-IN marker
showed only the last pass's value — `collectMultiple` left the marker's `cachedResult` at the final
runPass, never the series. Now it mirrors the collected series onto each output marker (same as
`runSimulation` already did), so inside==outside for By-Row / Scenarios / Data Table.

### SESSION DIGEST (2026-07-15j — Simulation "Stop when" condition) [Agent 2, off-theme]
Author-approved (2026-07-14) simulation follow-up. A Composite in Simulation mode gets a "Stop when
[output] [op] [value]" condition (`stopWhenPortId`/`stopWhenOp`/`stopWhenValue`, persisted via the
copyPaste whitelist + `solveKey`); `runSimulation` checks it after each round and halts the round
`output <op> value` holds, so `simulationSteps` becomes a CAP. The stopping round IS recorded (the
series ends on the state that satisfied it) — a model self-terminates instead of hand-tuning the count.
`stopConditionMet` (`>=/<=/>/</=/!=`) reads a logical output as 1/0; null/undefined/NaN never stop
(guard null FIRST — `Number(null)` is 0). **UX note (author eyeballed mid-build):** the first cut only
let you pick an OUTPUT (assuming you'd pre-build a logical signal inside the subgraph) — the author
flagged "no condition for said output", so the comparator+threshold was added; it subsumes the logical
case ("solved?" output → stop at "= 1"). Two eval paths in `stopSignalTrue`: an output fed straight off
a loop node reads from the round snapshot; a downstream OBSERVER (an "is-solved?" check / running total
reading loop outputs, NOT itself on the cycle) resolves by resetting the internal engine, seeding THIS
round's loop outputs into its cache, and fetching — safe because loop stepping uses direct `data()`
calls, never the engine, and the reset stops a prior round's observer value leaking. UI:
`SimulationEditor` (`CompositeNode.tsx`) — port dropdown + op dropdown + value; step label reads "Max
steps" once set. **Type-aware picker (`791f6938`, author question):** output markers are `trueany` +
adopt the wired type, so the port dropdown filters by the ADOPTED socket type — only number/logical
families (+ unresolved scalar wildcards) appear, hiding frame/string/date/cube/list outputs a numeric
threshold can't compare. The NODE stays general (not constrained); the guardrail is UI-only (runtime
already no-ops a non-numeric value). The whole Stop-when control hides when no comparable output exists;
a current pick is always kept. Possible follow-up: rewire the sudoku-solver seed (hand-tuned 25 steps)
to a "solved?" stop output (seed-generator change, left for the author). tsc clean, 2804 green. Commits
`99f21e06` (port) + `8fc79bfc` (comparator) + `791f6938` (type-aware picker).
**Convergence readout (`bb11b252`):** `runSimulation` records `simLastSteps` (rounds actually run) so
the SimulationEditor shows "stopped at step K" (K < cap → the condition converged) vs "ran all N steps
(never met)" — otherwise whether a fixpoint converged or just ran out of steps was invisible. Transient,
re-derived each solve.

### SESSION DIGEST (2026-07-15i — SVG Picker: rasterize for display, inline only on hover) [Agent 2, off-theme]
`SvgPickerComponent` permanently mounted the source markup via `well.innerHTML = source` — a
US-county-map SVG ≈ +40k live DOM elements sitting on the canvas at all times (the single biggest DOM
lever the 2026-07-08 audit flagged). Now the well shows a rasterized `<img>` (blob URL of the source)
as the IDLE display — one element — and the heavy inline SVG mounts ONLY while the pointer is over the
well (`hovering` state, `onPointerEnter`→mount / `onPointerLeave`→unmount), for hit-testing + the live
hover glow, then drops. The selected-layer STEADY glow is preserved when idle by baking it into the
raster: `bakeSelectionGlow` parses the source, applies `selectedGlow`'s `filter: drop-shadow` to the
named element, re-serializes (no-selection → source unchanged, no parse). Raster rebuild is debounced
80ms (a colour drag doesn't re-parse a big SVG per tick; the lag hides behind the hovered live SVG);
blob URLs revoke prev-once-new-exists (no blank gap) + on unmount. SVG-in-`<img>` stays vector/crisp
so no zoom re-raster needed. `resolveLayer`/`elementName` (`svgLayer.ts`) unchanged; Report `SvgFigure`
embeds still inline. NB the drop-shadow-in-img idle glow is the one thing an author eyeball should
confirm — if a future engine drops it, only the idle glow is lost (hover glow + pick + hero text
unaffected). Shipped bundled into commit `0e5e5ae1` (a concurrent `git commit -a` swept my uncommitted
files — see coordination doc). tsc clean, 2793 green.

### SESSION DIGEST (2026-07-15h — HTML-in-Canvas engage gate weighted by node kind) [Agent 2, off-theme]
The `"html"` renderer auto-engaged on a RAW node count (`getNodes().length >= 100`), which
undercounts DOM cost: one recharts figure is a large SVG subtree, an inlined source SVG (SvgPicker,
a county map) is tens of thousands of elements, a frame grid is a small table, while a scalar/logic
card is a handful of elements — so a chart-heavy graph read as "10 nodes" and never tripped the
renderer though it was as DOM-heavy as 100 scalars. New `nodeDomWeight(node)` in `nodes/kind.ts`
(coarse per-kind: inlined SVG 15, full chart/diagram 10, grid-of-cells/inline-bar 6, small figure 3,
frame/table/cube grid preview 2 — detected from OUTPUT sockets so any new grid node counts —
everything else 1). `HtmlCanvasLayer.tsx` sums it (`graphDomWeight()`) in the engage gate instead of
raw length; the recount effect resums off the same nodecreated/noderemoved pipe. A plain scalar graph
still needs ~100 nodes to trip (each weight 1), so the threshold's feel is unchanged for the common
case; ~10 charts now engage. `__hcMinNodes` stays the live knob (now a weighted-unit threshold). Node
weight can drift on an in-place retype (Cast scalar→frame) without an add/remove — accepted, self-
corrects on next add/remove or reload. `kind.test.ts` pins the tier ordering. tsc clean, +6 tests.

### SESSION DIGEST (2026-07-15g — Value popup: reusable FC format+unit dropdowns per column)
The value popup (`TablePopup`) gained a Format-Controller controls row between the header and the body
for READ-ONLY frames and matrices, plus in-cell units for lists. The FC's own number-format and unit
dropdowns were factored into `components/fcControls.tsx` (`useFcFormatOptions` hook +
`FormatStyleSelect`/`DateStyleSelect`/`UnitSelect`); `FormatControllerNode` now consumes the same hook,
so the menus (incl. active-pack units/formats) can't drift. **Frames** (`FrameChip` passes
`formatControls: "columns"` + `columnUnits`): each number column stacks format-over-unit (FC order), a
date column a date-style select; the unit converts the column's base-SI values into the chosen
commensurable unit (`fcUnitToUnit` + `dimEqual` guard), the number format renders in-cell — the unit
SYMBOL stays in the dropdown, not the cells. **Matrix** (`ArrayChip` passes `formatControls: "matrix"`
for a read-only numeric 2-D value): one format+unit pair side by side (homogeneous); the format works,
the unit is a display label until matrix units (D20) tag the value. **Lists** render dimensioned cells
in-cell ("5 km", "5 m/s") from EVERY entry point — `toGrid` now formats a raw `UnitCell` (pins / the
cable inspector pass the un-unwrapped value; the hero-box path already unwrapped). All DISPLAY-ONLY:
the dropdowns re-render the on-screen grid only; the value and Copy/CSV stay raw (like the list
Row/Column toggle). Popup-local state (`colFmt`), seeded from each column's `ColumnUnit`, reset per
open. **Cubes deferred** — `CubeColumn` carries no type/unit (the "Lossless frame→cube / typed
CubeColumn" backlog item is the prerequisite) and the cube popup uses a node-based cell renderer; the
same controls drop in once cube columns are typed. Visual — author eyeball pending. tsc clean, 2781
tests green.

### SESSION DIGEST (2026-07-15f — List popup: display-only vertical (Row/Column) layout)
The List popup (`TablePopup`, `state.list`) gained a **Row / Column** toggle in the footer: Column
renders the list DOWN a column (one value per line, nicer to read for a long list) instead of across a
row. Pure DISPLAY — the value is untouched: a list is stored as a single ROW (`[[1,2,3]]`, the flat
comma-separated value), and only the rendered `<table>` transposes (`viewGrid`/`viewCols`); `copy` /
CSV / Markdown / export / save all still read the flat `displayGrid`/`grid`, so `1,2,3` never becomes
`1\n2\n3` in the value. Lists are read-only in the popup (no `onSave` — only Table Input's matrix is
editable), so no edit-index remap is needed. Sticky within a session (state persists across opens, not
reset on reseed), default Row. Vertical view caps at `MAX_VISIBLE_ROWS` like a tall table; the dims
header reads `N×1`. Visual — author eyeball pending.

### SESSION DIGEST (2026-07-15e — Socket Reference hover pills)
Each dot in the Socket Legend / Reference now shows an INSTANT hover pill with its precise
per-dimension name (Numeric / Numeric List / Numeric Matrix, …, Frame, Cube, LAMBDA, Chart,
Any Scalar / Any List / Any Matrix, True Any). Design (author-specced): NOT OS-native (no
hover delay — `onMouseEnter` → render), a tight SVG STADIUM (not CSS shapes), body fill = the
socket type colour, border = `--socket-ring` (the same edge-darken the sockets use), text =
`contrastInk(colour)` (the adaptive ink the menu bar uses). `SocketLegend.tsx`: `SocketDot`
became a glyph (`SocketGlyphSvg`) + hover wrapper; `SocketTip` renders the pill via a portal to
`<body>` (fixed position — escapes the legend's `scale(0.85)` transform + overflow), width from a
shared-canvas `measureText`, colour→ink via a `getComputedStyle` probe (resolves `var(--sock-*)`
+ palette overrides to the exact rendered hex), horizontal clamp so it can't clip the viewport
(legend is bottom-right). Chose "Matrix" over "Table" for the homogeneous 2-D types (matches
`SOCKET_LABELS` "Matrix (any)"; distinguishes from Frame/Cube). Visual — author eyeball pending.

### SESSION DIGEST (2026-07-15d — the passthrough system: ONE declaration for type + unit flow)
Killed the drift where "what flows to my output" was re-declared in four places (trueany TYPE
adoption's `instanceof` chain, UNIT flow's `passesUnitThrough`/`unitPassInputs`/`selectedUnitInput`
duck markers, the type-default DISPLAY walk, coerceInputs' keep-tags boundary) — so Expect / Cable
Switch / IFERROR passed TYPE but silently not UNITS. **A node now declares passthrough ONCE**
(`nodes/passthrough.ts` `PassthroughSpec`: output key, value-branch inputs, combine `single`/`agree`/
`active`, optional data-aware `selected()`, `pure` flag). `trueAnyAdopt` (dropped its instanceof
chain entirely), `unitFlow`, `valueDisplayFormat`, `nodeKit`, `coerceInputs` all read it. Adding a
type-agnostic node is now one method; type and unit sets can't diverge. Behavior-preserving for type;
Expect/CableSwitch/IFERROR **gained** unit passthrough (the fix). `passthroughSystem.test.ts` pins each
declaration. **Then opted the element-preserving, same-rank, single-value-input agnostic ops into it**
(B): Reverse/Slice/Take/Drop/Shuffle/NthElement/Pad (list) + TRANSPOSE/CHOOSEROWS/CHOOSECOLS/table
TAKE-DROP/EXPAND (matrix) got adoptive IN + OUT sockets + a `passthrough()` — so a reversed/transposed
date list/matrix keeps its element type downstream (was neutral `anylist`/`anytable`, losing type-
default date formatting), and their input dots color to the wired type. Adopted coercion is equivalent
for these (bool↔num are no-ops on matching values). **NOT yet opted in** (follow-ups, backlog): the
multi-input APPEND family (Concat/Interleave/HSTACK/VSTACK — need `agree` combine), the RANK-CHANGING
reshapers (TOCOL/TOROW/WRAP — need element-family-remap with a rank change), and Filter (2 outputs +
predicate). The global `anyIn`/`anyListIn`/`anyTableIn`→adoptive flip (broad input color — the user's main ask)
LANDED: all element-agnostic input dots now colour to the wired type and revert on disconnect. The
`coerceInputs` risk (it runs the adopted concrete type's coercion) proved theoretical — the full suite
stayed green, so the adopted coercion is equivalent to the neutral one for these. VISUAL change across
many nodes (MAP/REDUCE tables, Concat rows, Cast, Set, …) — author eyeball pending.

### SESSION DIGEST (2026-07-15c — Boolean op operands are logical, not numeric)
`BooleanOpNode` (AND/OR/XOR/NAND/NOR/XNOR) operand rows + `NotNode` input were `numListIn`
(numeric combo) — should be logical (author). Swapped to `logicalComboIn` (the symmetric combo
rung, purple split-square): native logicals connect (Comparison/IS.TEST/logicallist) AND a number
still bridges in (0/1 ⟷ FALSE/TRUE), so nothing existing breaks. Combo↔list are both rank 1, so a
Comparison's `logicalcombo` output connects fine. Rows are now WIRE-ONLY (added `logicalcombo` to
`ExtensibleInputs` `isWireOnly` — only BooleanOp uses that type there; NotNode's `InlineInputs`
renders no field for logicalcombo automatically), matching IfNode's condition. The BooleanOp inline
number editor was already non-functional (wrote `strLiterals`, which `coerceInputs` injects only for
`strlist/datelist/logicallist`, not `numlist`), so no real loss; `data()` still honors any stored
numeric `literals` as an unwired fallback. Migrated the `null-and-logical` seed's `andB`: dropped its
hidden `{a0:0,a1:1}` literals and WIRED a `Number(1) → a1` so the "1 coerces to TRUE" demo is visible
(a number flowing into a logical operand — the bridge in action). Full suite 2764 green.

### SESSION DIGEST (2026-07-15b — Build Frame / Frame from Lists type-by-adoption + adoptive-socket base)
"Build Frame = upgrade a table into a frame by slapping headers on it" (author), so it should
accept ANY homogeneous matrix, not just numeric — and type the columns by the matrix's element
family. Key realization (author): a matrix is HOMOGENEOUS with a socket-known type, so per-column
value inference was the wrong model, and specifically **`date` can't be recovered from values** (a
serial looks numeric) — the type must come from the SOCKET. Done "the right way" for BOTH sibling
constructors so they stay coherent:
- **Generalized `AdoptiveSocket` to carry a `base`** (default `trueany`; `reconcileOnce` now reverts
  to `sock.base`). New `adoptiveTableIn`/`adoptiveListIn` = adoptive with an `anytable`/`anylist`
  base: accept any element family AND adopt the wired cable's concrete type (via the existing
  `settleWildcardTypes` universal input-adoption), while staying restricted (a frame/scalar is
  refused, unlike a `trueany` hole).
- **Build Frame** `matrix` input → `adoptiveTableIn`; **Frame from Lists** each `vals` input →
  `adoptiveListIn`. `data()` reads the adopted socket type → `colTypeForSocket` → `FrameColType`.
  New core helpers `typedColumn` + `buildFrameTyped` (frame.ts). A NUMERIC matrix still routes
  through the unchanged `buildFrame` (byte-identical — units, all-null-col→number, every seed/test).
  `null` (not-yet-adopted `anytable`/`anylist`, or `complex`) → value inference (number/logical/
  string). Removed `columnFromCells` + FFL's "dates arrive as numbers, retype downstream" note.
- **Adoption runs before compute on load** (`loadGraph` calls `settleWildcardTypes` at
  persistence.ts:496, like conduits/FCs), so a saved `datetable→BuildFrame` builds date columns.
  Headless `run-graph.ts` (no settle) degrades to value inference (date→number) — acceptable.
- INDEX was NOT the issue (its Array input is already `trueany`); the numeric-`table` audit found
  MMULT/MDETERM/MINVERSE/Heatmap correctly numeric, only these two constructors needed widening.
Tests in `frame.test.ts` (colTypeForSocket/typedColumn/buildFrameTyped + node-level adoption via
`setType`). Full suite 2764 green.

### SESSION DIGEST (2026-07-15 — INDEX whole-axis form)
INDEX (`ListIndexNode`) gained Excel's whole-axis form (author request): a BLANK or
0 Row = the whole COLUMN, blank/0 Column = the whole ROW (`INDEX(range, 0, col)`),
both blank = the container passes through whole. The Row/Column literal fields now
default EMPTY with an **`[all]`** placeholder — done purely via the socket-label
`(default …)` convention (`splitDefaultLabel`), zero component work. Slice shapes
mirror the existing accessors: frame row → ONE-ROW FRAME (Get Row / XLOOKUP `*`),
frame column → values LIST (Get Column), cube slices stay CUBES (nested cells
whole), matrix slices → 1-D lists; a flat list is n×1 (Column > 1 = #REF!), and
0-based bounds still #REF!. BEHAVIOR CHANGE, checked against every usage: a 2-D
input with Column unset used to read the cell at (row, 1) — now it slices the whole
row; the cubes seed sets both literals explicitly on all three INDEX nodes and no
test/seed relied on the old implicit col-1 (the null-and-logical #REF! demo is a
flat list). New default is pass-through (fresh node = [all]/[all]). Tests in
`cubeNodes.test.ts`; catalog description + NODE_EXCEL syntax/note updated.

### SESSION DIGEST (2026-07-14 — formula↔node parity: audit + design frame; D2 reopened)
Author set a new direction: the formula language and the node set should CONVERGE ("people
will be expecting that and we've kind of let it stagnate") — and explicitly REOPENED the
written-down restrictions in this area (D2's "permanent" Expression cap, the broadcast
assumptions): the project is fluid, keep an open mind. Deliverables: **`docs/
formula-node-parity.md`** (mechanics of the two surfaces, measured gaps, four tiers
cheapest-first, proposed parity RATCHET test, four author questions) + **`scripts/
formula-node-parity.ts`** (regenerable numbers; companion to `scripts/parity.ts`).
Headline findings: 266/626 catalog leaves are formula-callable; **57 Excel-named nodes
whose name isn't dispatchable** (TEXTSPLIT/TAKE/SEQUENCE/XLOOKUP/dotted distributions/
bond block — Formula.js predates them; the sharpest "users will expect this" gap); **75
untracked formula-only legacy names** — incl. VLOOKUP dispatching fine despite being
D10-oos ("superseded"), i.e. D10 is violated on the formula surface by DRIFT, not
decision; the native-impl registry sits at 25 entries (the stalled "first wave").
Doc updates: D2 amended with the reopening (cap stands as working default until parity
Tier 4 decides), CLAUDE.md cap bullet softened to match, backlog: By-Row run mode
refined per author (user SELECTS which input port to iterate rows of), Simulation stop
condition author-approved, SETEQ item superseded by the parity program entry.
**Round-1 decisions landed same day (D19):** legacy aliases BLOCKED on the formula
surface (`#NAME?` + redirect; VLOOKUP dispatching = now a bug); Solenoid-native formula
names = the node header hover hint DESPACED (`typeHint()` in `nodeKit.tsx`; "SET
RELATION" → `SETRELATION`; multi-op-class naming is a build-session call under that
rule); packs register their own formula functions (pack-toggle-sensitive registry).
Tier 4 (the reopened cap) explicitly NOT decided — author-present, queued in backlog.
Mechanical work GREENLIT but scoped OUT of this session (start with the ratchet test).
**Tier 4 discussion held (same day):** dug out the ORIGINAL cap rationale from the
2026-06-23 archive — the `#SHAPE!` block said "yet" before the decision hardened it; the
technical core is the TYPE-AGNOSTIC EVALUATOR (no branded values — `[re,im]` ≡ 2-list,
and `[[1,2]]` ≡ list-of-lists is the same ambiguity for matrices); the cap was partly
CONTAINMENT of the two-engine divergence flagged the same day. Since then: `fxErrorToSol`
landed and the 2026-07-10 sweep + `formulaDivergence.test.ts` pinned agreement — the
audit-§4 precondition is HALF-met; the structural registry unification is the missing
half (and coincides with D19 Tier 1). Author fixed the DECISION CRITERIA: correctness +
coherence only — the identity/auditability objection is RETIRED ("someone who wants
everything in a tiny compact formula will just use Excel already"). Endpoints when it
returns: "never" vs "matrices-only, full Excel-DA semantics"; frames-in-formulas
rejected outright. Recorded in the parity doc ("Tier 4 in full"), D2's note, backlog.
**D20 (same day) — homogeneous matrix units:** the author corrected the A4 record
("Matrix = unit-AGNOSTIC always" carried no rationale and didn't match intent): a matrix
gets ONE unit tag per value, tracking the type plane (one element family per matrix ⇒ one
unit, like a frame column). Lists STAY per-cell — reaffirmed on the load-bearing
list⇄frame-row duality (Get Row yields legitimately mixed units). Governing principle
recorded in D20: *units attach at the granularity where the container guarantees
homogeneity*. Op rules queued in backlog (element-wise = scalar algebra on the tag; MMULT
multiplies dims; reshapes carry; MDETERM/MINVERSE = `dimPow` or documented-strip; uniform
list widens carrying, mixed widens stripped). Also closes most of Tier 4's units fork.

### SESSION DIGEST (2026-07-13c — Sudoku Solver seed: a matrix-algebra constraint solver in a Simulation composite)
New seed `sudoku-solver.json` (+ `sudokuSeed.test.ts`): a full Sudoku solver built from EXISTING
nodes only — no engine changes. The whole solver is pure matrix algebra over an **81×9 candidate
matrix** (cell × digit), iterated to a fixpoint by a **Simulation-mode composite** (the bounded-
feedback loop doing the work a dataflow graph otherwise can't). One deduction round = 20 loop nodes
(MAP element-wise formulas + MMULT against constant incidence Table Inputs: peer adjacency A 81×81,
unit membership U 27×81): naked singles (`A·P`), hidden singles (`Uᵀ·(U·C = 1)`), and **naked pairs**
vectorized as `E = ((A·M)⊙A)·CP` with `M = (CP·CPᵀ = 2)⊙A` — pairs are load-bearing (the seed puzzle
stalls on singles alone; unique solution verified by exhaustive search, asserted exactly in the test).
Non-obvious bits worth reusing: (1) the **loop-entry "prev or initial" idiom** — a MAP with formula
`IF(value2=value2, value2, value)`, exploiting that an unwired extra table arrives as NaN and
`NaN = NaN` is FALSE in `applyOp`, so round 1 falls back to the static initial matrix; (2) internal-
node ARRAY ORDER = Gauss-Seidel evaluation order in `runSimulation`, so a topologically-ordered
`internal.nodes` gives one full deduction round per simulation step; (3) MAP's `col` variable as a
free digit index (`IF(value=col, 1, 0)` builds the candidate tensor without a digits matrix).

### SESSION DIGEST (2026-07-13b — units regression fix: the unit-blind boundary + revived FC locks)
Author verdict on the first A4 wiring: "nothing propagates or locks correctly" — CONFIRMED
and root-caused. A raw `UnitCell` reaching any node that doesn't run the dimension algebra
coerced to **NaN** (`coerceNumber` is unit-blind), so `Comparison(5 km > 3)` returned FALSE,
and where a number did get through it was the **base-SI magnitude** (5 km → 5000), so
thresholds/charts/frames were 1000× off. Only 4 node files were unit-aware; ~90% of the
engine silently broke downstream of any FC. The fix (all in `unitCoercion.test.ts`):
- **The unit-blind boundary** (`unitBridge.stripUnitCells`, applied centrally in
  `coerceInputs.wrapNodeData`): a non-unit-aware node's inputs get every `UnitCell`
  unwrapped to its **display magnitude** (the number the user typed — "5 km" ⇒ 5, offsets
  honored), restoring exact pre-units behavior for the whole unit-blind node population.
- **Who keeps tags**: `unitAware = true` class marks (Arithmetic, MathFn, Aggregate,
  Convert, Expression, FC, the 5 table-lambda hosts, Conduit) + the existing passthrough
  duck markers (`passesUnitThrough` / `unitPassInputs` — Display, IF/CHOOSE/SWITCH/IFS), so
  the algebra and display propagation are untouched. Adding a unit-aware node = one field.
- **FC lock states revived on the value layer**: `data()` probes the incoming value's first
  `UnitCell` — present ⇒ this FC INHERITS (`forwarding`, → → arrows) or, when
  `refreshAnnotation`'s upstream walk finds a Convert through pure passthroughs
  (`fedByConvert`), is DICTATED (`lockedByConvert`/`unitLocked`, ← ←, dropdown locked). The
  inherited display id mirrors into `unit` when unauthored ("none") or dictated, so the A2
  dropdown+arrows read honestly again with zero component changes.
- **Dimensionless ADOPTS the operation's unit (author decision 2026-07-13)**: a bare number in
  any commensurability-requiring op takes the other side's unit instead of `#UNIT!` — `$5 + 2
  = $7`, `$5 × 2 = $10`, `SUM($5, $2, 3) = $10`. Only TWO genuinely different real dimensions
  still separate. Applied in `arithmeticCell` (+/−/mod), `dimEval` (+/− + comparison),
  `forAggregateUnits`, and the `dimensionsAdd` lattice contract. ×/÷/quotient + the aggregators
  also PRESERVE the display id when the result stays in an operand's dimension (so `$` rides
  through `× 2` and `SUM`, no bare `¤`); a dimension-changing op (`m × s`, PRODUCT, VAR) reverts
  to the derived symbol.
- **The Number node is a plain literal source** — the unit picker + `unit` field were removed
  (author: units are the FC's job only). The `units-by-dimension` seed's lane A now sources
  m/s from docked FCs (the `unit-flow` pattern).
- **PURE RATIO — cancellation is a first-class kind (2026-07-13, author call)**: `10 m ÷ 2 m`
  now mints a `UnitCell` with `ratio: true` (empty dim) instead of a bare number — the ONE
  exception to "dimensionless ⇒ bare". It renders **`5:1`**, computes as a plain number
  everywhere (strip boundary → magnitude; adopt rules treat it as bare), formats naturally as
  percent — but an FC CANNOT re-label it with a physical unit (`#UNIT!`: a known-dimensionless
  number isn't money). Minted in `arithmeticCell` div/quotient only (a blanket "{} from
  dimensioned inputs" rule would false-positive COUNT-style results; Expression's `/` is a
  flagged follow-up). `guardCell` preserves the brand (tagDim would collapse it).
- **Equation node derives the unknown's UNIT (2026-07-13)**: `unitAware = true`; knowns keep
  their tags on passthrough outputs, the numeric engine runs on BASE-SI magnitudes, and the
  solved variable is tagged via `dimEval` over the ISOLATED expression (`V = I·R` for R ⇒
  dim(V)/dim(I) = Ω; `x² = A(m²)` ⇒ both roots in m — `dimEval`'s `^` now constant-folds a
  pure-number exponent subtree like the isolated `1/2`). Check mode validates dimensional
  consistency FIRST (`1 km = 1000 m` holds; `m = s` is `#UNIT!`). A multi-occurrence unknown
  (true quadratic) has no isolated form → unit stays underived (bare, honest). Goal seek needs
  none of this — its driver's unit is authored on the input marker. `equationUnits.test.ts`;
  Unit Flow seed lane J.
- **Convert PRIMACY restored on the value layer (2026-07-13)**: (1) every Convert unit id
  registers with the display bridge (`registerDisplayUnits` — no import cycle), so Convert-to-yd/
  psi/km_h tags a display that actually renders (was: display-less cell → base-SI metres downstream);
  (2) the A2 ← ← lock direction was WRONG-WAY after the revival — corrected: an FC FEEDING a Convert
  (through pure passthroughs, `refreshAnnotation` downstream walk → `dictatedFromUnit`) is dictated
  the Convert's fromUnit — dictation FILLS an unauthored dropdown + locks while following, but NEVER
  overwrites an authored unit (the pick stands; a true clash surfaces as the Convert's #UNIT! —
  primacy OR an error, never a silent rewrite/pass). An FC AFTER a Convert simply forwards (→ →).
- **Unit Flow seed upgraded to 9 machine-checked lanes** (`unitFlowSeed.test.ts` asserts every
  caption): A carry · B upstream format reach · C transform drops format/unit rides · D Convert
  authors · E selector keeps · F algebra (5 m ÷ 1 s = 5 m/s + cancellation) · G adopt ($5+2=$7,
  $ list SUMs to $60) · H Convert primacy (dictated FC + the #UNIT! clash lane) · I custom unit
  (widgets/s).
- **Custom units are OPAQUE dimensions (2026-07-13)**: an FC `custom` free-text unit ("poop")
  now tags a `custom:<name>` dimension axis instead of being ignored (which made `poop ÷ s`
  collapse to `1/s` = Hz). `Dim` widened to `Record<string, number>` and the algebra helpers
  (`dimMul/Div/Pow/Equal`, `isDimensionless`, `formatDim`) are KEY-AGNOSTIC — they fold over
  every base + custom axis, so a custom axis survives ×/÷ and renders by name (`poop/s`,
  sorted for a stable label). `poop + poop = poop`, `poop + s = #UNIT!`, two different customs
  separate, a bare number still adopts. Custom cells carry no `display` id (formatDim renders
  the name); a blank custom name is a no-op. See `unitBridge.applyFcUnit` + `unitWiring.test.ts`.

### SESSION DIGEST (2026-07-13 — FC A4 units by dimensionality: wired into the value engine)
The pure unit-value foundation (`unitValue.ts`, `unitDimExpr.ts`, `dimension.ts`) is now
WIRED LIVE. A number carries a physical dimension and computes with it: `5 m ÷ 1 s = 5 m/s`,
`mass·accel → N`, `metres + seconds → #UNIT!`. The mechanism, end to end:
- **Storage**: a list element is a base-SI `UnitCell` (magnitude + dim vector), tagged the
  way `valueKinds` carries `null`/`SolError`; a bare number is dimensionless (so untagged
  graphs are unchanged). A frame column carries ONE `ColumnUnit` (cells stay bare base-SI).
  A matrix is unit-agnostic. `FrameColumn.unit` replaced the vestigial `UnitSuffix`.
- **Bridge** (`unitBridge.ts`): FC unit ids ("m","km","usd","mph") ⇄ `dimension.ts` Units —
  the one lookup between the display-unit layer and the value-dimension layer.
- **Algebra at the ops** (`shared.ts` `broadcastUnit` + `anyDimensioned` gate — plain data is
  byte-identical): `ArithmeticNode` (× adds exponents, ÷ subtracts, +/− demand commensurability,
  pow scales, cancellation → bare); `MathFnNode` per-op dimensional signature (SQRT halves,
  ABS/ROUND preserve, SIGN → number, trig needs an angle, log/exp need dimensionless → #UNIT!);
  `ExpressionNode` runs `dimEval` in parallel with the numeric evaluator (strips UnitCells to
  magnitudes for the math, tags the result with the computed dim).
- **Aggregators** (`forAggregateUnits`): `AggregateNode` re-tags with the op's result dim
  (sum/avg/min/max preserve, var/sumsq square, product dimⁿ, count/moments dimensionless);
  mixed units → #UNIT!. `SumIfsNode` re-tags from the values column's unit.
- **Frame ↔ list bridge**: a `Name (unit)` header (`Revenue ($0.00)`, `Distance (km)`) locks
  a column via `buildFrame`/`addColumn` (`unitColumn.ts` parses the parenthetical); `GetColumn`
  tags each cell with the column's dim so the unit rides OUT into a list.
- **Entry point**: `NumberInputNode` gained a `unit` field + a grouped picker (dimensional ids
  only); a discrete pick mints a base-SI `UnitCell`. Persists via the existing `unit` init key.
- **Display**: `unwrapUnitCells` renders a dimensioned cell as "magnitude symbol" (`5 m/s`), or
  unwraps to a docked FC's display unit (base → that unit) so the FC formats + labels it.
- **Lattice** (`unitLattice.ts` + full sweep): units are the finer-grained sibling of the
  element-family separation, but a value's dimension is RUNTIME — it can't gate a static socket
  `accepts()`, so the separation is a COMPUTE-time `#UNIT!` (×/÷ always combine = dimensional
  flow; +/−/compare/aggregate require the same dim = type separation).
- **The FC is now VALUE-MUTATING (unification landed later 2026-07-13 — see the digest below).**
  The earlier pass KEPT `unitFlow.ts`'s display-lock walk; the flagship's last mile then re-expressed
  the unit half on the value layer and DELETED the walk.
- 45 new tests; full suite green (2690). Seed: `units-by-dimension.json` (+ `unitsSeed.test.ts`
  drives its two lanes through the real nodes).

### SESSION DIGEST (2026-07-13 — FC A4 flagship last mile: the Format Controller becomes value-mutating)
The two parallel unit representations are UNIFIED on the value layer. The FC no longer records a
display-only unit string resolved by a graph walk — it AUTHORS the value's unit.
- **`UnitCell` gained an optional `display` id** (`unitValue.ts`). The stored value stays base SI;
  `display` is the FC unit id it renders in. It rides the value through passthroughs/selectors and
  DROPS at a transform, because every algebra result funnels through `tagDim` (which carries no
  display) — the carry/break semantics are now a PROPERTY OF THE VALUE, not a graph walk. `guardCell`
  preserves `display` through the broadcaster.
- **`applyFcUnit` (`unitBridge.ts`)**: dimensionless number + a real unit → base-SI tag (interpret AS
  the unit, like the Number picker: `5` + km → 5000 m, display km); already-dimensioned + a
  COMMENSURABLE unit → re-display (base kept, display swapped); INcommensurable → `#UNIT!` (author's
  call: a true dimension clash is honest-wrong, not silently re-asserted); none/text/matrix/frame
  pass through. `FormatControllerNode.data()` runs it; `Convert.data()` tags its output too (a
  base-SI `UnitCell` + toUnit display, so a downstream FC AGREES on the value's unit); `NumberInput`
  carries its picked unit as the display id.
- **`makeUnitResolver` DELETED**, plus the FC forwarding / Convert-lock logic in `refreshAnnotation`
  (no more inherited/dictated unit arrows — the value carries the unit; the user may always pick, and
  a clash surfaces `#UNIT!`). `unitFlow.ts` now carries only the number-FORMAT annotation
  (`makeAnnotationResolver`, which a downstream passthrough box still inherits) + `resolveValueOrigin`
  (kept). `trigMode` reads the incoming FORMAT annotation's unit (the bare-degree annotationFor path;
  a genuinely dimensioned angle is already base-radians and computes directly).
- **Objective 2**: REDUCE / BYROW / BYCOL carry units over a 1-D list — strip tagged cells for the
  numeric fold, `dimEval` the formula (fold/aggregate vars bound to the element dim) to get the result
  dim, re-tag (preserving the display when the dim is unchanged). Mixed units / formula clash → `#UNIT!`;
  a dimensionless-yielding formula (COUNT) strips to a plain number. MAP/MAKEARRAY/SCAN stay agnostic.
- **Author-review flags**: (1) chose `#UNIT!` over silent re-assert on a dimension clash; (2) lane C of
  the Unit Flow seed was re-authored — under real dimensional algebra `$10 × 100 = $1000` KEEPS the
  currency dimension (only the number FORMAT + the specific `$` display break at the transform), so the
  lane now teaches "format is display, the unit is physical" rather than "the unit vanishes"; (3) the
  three-state FC flow arrows collapse to plain "authored" (forwarding/Convert-lock states are gone with
  the walk). Re-authored the Unit-Flow seed test + `unitFlowAnnotation` + Convert output assertions.
  Full suite green (2702, +new value-mutating + LAMBDA-host tests); tsc clean.

### SESSION DIGEST (2026-07-12 — drill-in Stream B: Isolate + trueany/trig inside composites)
First-class composite drill-in, three of the four Stream-B items landed green;
the other two flagged as author-present/entangled (see below).
- **trueany adoption + Auto-trig INSIDE a composite** (was MAIN-editor-only). The
  composite's internal graph is its own world — the main canvas's connection-pipe
  settle never touches it — so it now runs the same passes scoped to
  `internalEditor`: `resolveTrigModes(internalEditor)` at the top of
  `CompositeNode.data()` (Auto deg/rad trig inside a subgraph reads its unit, was
  always rad), and `settleWildcardTypes(internalEditor)` on every live internal
  topology change (internal-editor pipe, `_hydrating`-gated), once at the end of
  `hydrate()`, and once after `createCompositeFromSelection` wires the ports.
- **Composite shell OUTPUT ports now ADOPT** (were static `trueAnySocket`): each is
  an `AdoptiveSocket` that takes the concrete type feeding its internal Output
  marker (`adoptBoundaryTypes`), reverting to trueany when unwired — the mirror of
  the shell INPUTS adopting from outside. Never drops an outer cable (D17). 4 new
  cases in `composite.test.ts`.
- **Isolate works inside the drill-in**: `isolate.ts` entry points route through
  `getActiveEditor()` (the drill-in cards read the same global `isolateStore`); the
  overlay keyboard gained `I` (toggle) + Esc precedence (menu → exit isolate →
  drill up) + isolate-cleared-on-leave. `isolateActive.test.ts`.
- **FLAGGED, not shipped** (SAFE-FALLBACK — a green partial over a broken whole):
  (1) **Group/Cleanup/Autofit/Expand** in the drill-in — a REAL group needs the
  group-drag reconcile pipe + `pushHistory`/`settleStandoffs`/GroupNode-component
  all taught the active area; a half-wired group is a static frame, which the brief
  said NOT to ship. (2) **Navigator + lasso** — entangled with main selection
  singletons + a custom Canvas gesture, no unit-testable surface (vitest is
  node-env). (3) **D2 toolbar reroute** — the repo's own 1.2-plan marks D2 an
  author-present 2.0 item; left for live eyeballing.
### SESSION DIGEST (2026-07-12 — Composite run modes: Monte Carlo + uncertainty + solver params; Stream C of the overnight 1.2 build)
Built the composite what-if tail (`1.2-plan.md` Tier 2, `docs/v2.0/12` #21). Everything
here is SCOPED to composites (author call this session): the uncertain-value kind + Monte
Carlo exist for a composite's internal inputs and its MC output, NOT the app-wide Number
node or general graph arithmetic — blast radius kept inside the composite subsystem.
- **`UncertainNumber` kind decision — SYMMETRIC ERROR BAR `{value, error}` (author-confirmable).**
  Picked `10 ± 2` over the interval `[8,12]` alternative per the doc's guidance — simplest
  to propagate (sums add errors in quadrature, products compound relative error) and it IS
  what Monte Carlo needs (mean + sd). `error` is a 1σ, normalized non-negative. Added to
  `valueKinds.ts` as a tagged object (`kind:"uncertain"` brand — unlike bare null/logical it
  MUST be a wrapper, like SolError): `isUncertain`, `uncertain()`, `asUncertain`,
  `uncertainCenter`, and the analytic propagation ops (`add/sub/mul/divUncertain`).
  `coerceNumber` collapses an uncertain to its `.value` (the one degradation path when an
  error bar meets a numeric context). Deliberately did NOT touch `forAggregate` or the
  arithmetic ops (Stream A's turf + out of scope) — the addition is self-contained to ease
  the A→C merge. The propagation math is unit-tested but not yet wired into any node (it's
  the closed-form companion to the numeric MC sampler).
- **Monte Carlo** (`monteCarlo.ts`, pure/seeded): mulberry32 PRNG + Box–Muller normal +
  uniform draws + `summarizeSamples` (mean ± unbiased sd, carries raw draws) + `histogram`.
  Determinism is seed-based (same seed → identical result), tested end-to-end. A composite
  input marker gained `uncertainty: number|null` + `distribution: "normal"|"uniform"`
  (drill-in-only authoring; persisted only when spread>0). New `montecarlo` run mode:
  `runMonteCarlo` samples every uncertain input N times, re-runs `runPass`, and emits each
  output port as an `UncertainNumber` (mirrored into the output marker's cachedResult like
  simulation). Heavy/arm-and-run + stale-key wired exactly like goal-seek (uncertainty edits
  restale). No uncertain input → collapses to a single pass.
- **Solver params (advanced tier)**: optional `maxIterations`/`tolerance`/`boundsLo`/`boundsHi`
  on `CompositeGoalSeek` (undefined = defaults, so the existing round-trip test is untouched);
  `solveGoalSeek` honors them (bounds clamp the secant + bisect the `[lo,hi]` window directly
  instead of expanding). MC sample-count + seed in a matching tier. FC-style chip-foot
  expander (`AdvancedFoot`, local-state open). Simulation `steps` already surfaced.
- **D-2 inner display**: `MiniSparkline` for a numeric per-step series renders above the
  list chip INSIDE the drill-in output marker AND on the card (numeric-series-gated). MC's
  first output distribution shows as a `MiniHistogram` in the MC editor.
- **Seeds**: added Monte Carlo / Scenarios / Data Table cards to the Composite Workbench
  seed; `compositeSeed.test.ts` covers all three (MC determinism, scenario side-by-side,
  data-table grid). All seed/textForm round-trips stay green.
- **Left + flagged**: inside-solve stale dot (backlog "Composite / drill-in" — distinguishing
  a seed-based inside-Solve from a wired one needs a drill-state signal coupling `data()` to
  `compositeEditorStore`; the backlog deems it fragile, left simple on purpose).
### SESSION DIGEST (2026-07-12 — Stream D: data-quality + mechanical fixes)
Four independent 1.2 Tier-1/Trust items (backlog "Trust-node audit" a/b/c + "String lt/gt").
- **Per-cell errors now surface** (task a): `errorValue.findCellError` + `sampledCellIndices`
  do a BOUNDED head-plus-stride scan (`CELL_SCAN_HEAD`=64 + 32 tail samples per container,
  matrices recurse under the same per-row bound) — full-cell scans were rejected on perf.
  Wired into `reportOut` (Problems panel) and `modelFuzz.badValue` (now frame-aware). A
  systematic whole-column error is always caught; a lone buried cell can be missed (the cap).
  Nulls are deliberately NOT flagged (missing is first-class-legit).
- **Fuzz "+ Clamp" seeded** (task b): the sweep captures, per node, the [min,max] of the value
  arriving on its clamp-target input across CLEAN samples (safeRanges + an inputSource map);
  `boundsFromSafeRange` (only a non-degenerate finite range) seeds the inserted Clamp's
  min/max literals. Heuristic, limited to extreme-bound problems (a Clamp can't exclude an
  interior bad point like a 0 divisor).
- **Tornado keeps + marks diverged leaves** (task c): raw swing stays the ranking key
  (author's lean, not normalized); `TornadoResult` gains inputLow/inputHigh + basis +
  diverged; `rankTornado` surfaces diverged leaves at the top (muted full-width bar), never
  lets their NaN swing corrupt the finite order; the bar tooltip shows the input swing + basis.
- **String order pinned to BYTE order** (task d): one shared `stringOrder.compareStrings`
  (JS `<`/`>`, ≈ Polars UTF-8 byte order) replaces `localeCompare` at the four data sites
  (Frame Sort, Frame Filter, formula `<`/`>`, Slicer uniques) — deterministic + closes the
  documented web(JS)/desktop(Polars) divergence. UI list ordering keeps locale. engine.rs
  header comment updated (comment-only Rust; author verify on next desktop build).

### SESSION DIGEST (2026-07-10 — FC lambda/chart families + Chart Builder reach)
Author brief: FC options for LAMBDA (view-as) and Chart (font scale) sockets;
"think about upgrading" Chart Builder beyond the standard Chart node.
- **Two new format families** (`formatModel.ts` familyOf/controlsFor + the
  format-model.md truth table): `lambda` → a view-as dropdown (`lambdaView`:
  signature default · KaTeX · highlighted syntax · monospace), `chart` → a text
  scale dropdown (`chartFontScale`: ×0.8…×2). Both display-only annotation
  fields riding exactly like `logicalStyle`; FC node fields persisted via
  INIT_FIELD_ORDER. No hidden-string plumbing was needed — the flowing
  LambdaValue already carries `expr`/`params`/`descriptions`.
- **Lambda render surfaces**: shared `components/LambdaView.tsx`
  (LambdaValueView — KaTeX via formulaToLatex/useKatexRender, highlighted via
  highlightFormula, mono source; token colors re-scoped `.fx-editor` →
  `.fx-tokens` so non-editor surfaces can use them). Wired into the Display
  node's lambda branch + the Report embed (LambdaFormula honors the annotation;
  its no-annotation default stays KaTeX). **The Lambda node's own hero box
  deliberately stays the compact signature** (author call mid-session: the
  authoring card doesn't self-format).
- **Chart text scale end-to-end**: `fontScale` threads ChartFigure → ChartView /
  Treemap / Sankey / Composed / Bubble (hardcoded px × scale) and KPI / Bullet
  (a `--chart-fscale` CSS var into chartCards.css calc()s). Surfaces resolving
  the annotation: Chart node card, Display chart branch, ChartPopup (via
  pinNodeId), Report ChartBody. Composes with the new **`fontsize` ChartOptions
  kwarg** (matplotlib points, 10 = built-in) rather than replacing it.
- **Chart Builder reach**: KPI / Bullet / Treemap / Sankey gained the same
  `options` string socket Chart/Histogram had (their previously-dead
  `chartOptions` field now actually populated; `title` overrides the label as
  figure title); Chart Builder gained the `fontsize` field. Inapplicable
  options are inert per node, matplotlib-style. NOT extended: Mermaid (author
  decision 2026-07-04: no chart-options socket), Sparkline (deliberately
  minimal), Gauge (fixed 0–100% by design), Tornado (own renderer, not a
  ChartValue).
- Regression tests: `fcLambdaChart.test.ts` pins the annotation reaching a
  downstream Display with REAL node classes in both directions (upstream FC via
  inAnnotation, trailing FC via downstreamAnnotation) for both new fields;
  formatModel.test extended for the two families.
- **Two root-cause fixes found while live-debugging with the author:**
  (1) `DisplayNode.data()` STRINGIFIED a lambda into `cachedValue`
  (formatLambda) — the component's lambda branch was unreachable, so no view
  ever applied and an FC's textScale shrank the signature via the generic text
  path. data() now keeps the value; the component renders by kind. (2)
  `removeFcInline` on a hand-wired (never-docked) FC deleted its downstream
  cable outright — the reconnects were host-gated; it now bridges FC.in's
  source to FC.out's consumers. Debugging lesson recorded: a wedged long-lived
  Vite watcher was chased first — restart the dev server before trusting
  "still doesn't work" symptoms that contradict the on-disk code, but ALSO
  don't stop there (both real bugs sat underneath).

### SESSION DIGEST (2026-07-10 — whole-codebase refactor pass)
Author brief: "refactor duty — make the code itself better; no bug/perf hunt required."
All pure code motion / dedup, zero behavior change (one deliberate exception, noted),
tsc + vitest green at every commit, 2526 tests unchanged.
- **Canvas.tsx split 3798 → ~1980 lines.** The separable subsystems moved to focused
  modules, each wired back through a small deps object: `canvasKeyboard.ts` (the whole
  key map), `canvasLasso.ts` (shift-drag lasso), `canvasContextMenu.ts` (right-click
  routing), `canvasActions.ts` (deleteSelection / insertConduitForCables /
  linkStandoffBetween / deleteCables / attachFormatController), `tidyArrange.ts`
  (lazy-ELK loader + arrangeFn + Cleanup as factories), `fcDocking.ts` +
  `canvasGeometry.ts` (FC dock/splice + screen↔canvas math), and syncSemanticZoomFor
  → `semanticZoomStore.ts`. What stays IS the canvas component: rete construction,
  the event pipes (selection/drag/dock bookkeeping — genuinely coupled shared-state),
  handleMenuSelect, and JSX. Deliberate fix en route: the bare-Enter palette guard
  read `menu` through a mount-frozen closure (always null, never blocked); it now
  reads a live menuRef — the guard's documented intent.
- **Store layer deduped onto storeKit.** New `createValueStore<T>` absorbs the eight
  popup/dialog stores' identical open/close/subscribe plumbing (chart/table/cube/
  formula popups, connection dialog, element picker, help dialog, pivot editor —
  public surfaces unchanged, extras layered on the core). Seven hand-rolled listener
  Sets replaced with `createNotifier` (compositeStale, commentsPanelUi, problemsPanelUi,
  formatAnnotation + formatMismatch, isoEndpointSelect, groupCollapse, computeOverlay).
  The four legacy useState+useEffect store hooks now use `useSyncExternalStore`.
- **Shared helpers extracted.** `components/useEscapeToClose.ts` replaces the copy-
  pasted window-keydown Escape handler in 14 overlays (capture sites all also
  preventDefault — one `{capture}` option covers every site; HelpDialogs keeps its own,
  it also drives arrow nav). One `clamp()` in `nodes/mathUtils.ts` (pixiCamera
  re-exports; ~12 inline forms migrated; standoffs' band-ordering expression is NOT a
  clamp and stays). `valueKinds.coerceNumber` replaces the duplicate spreadsheet
  coercer in excelFunctions/composite. `components/chipStyle.ts readChipPopupStyle`
  factors the chip popup accent/group-color getComputedStyle block (ArrayChip/
  FrameChip/CubeChip/ChartChip/Pivot; ChartExpandButton reads inline style — different
  semantics, left).
- **PopupShell** (`components/PopupShell.tsx`): the shared overlay/card/header/Escape
  scaffold, DOM-identical migration of all six popups (Chart/Cube/Table/Formula/
  PivotEditor/ElementPicker). Deviations expressed as props: `headerExtra` (dims/Depth/
  Locked), `headerActions` (Table's overflow menu), `onEscape` (Cube drills up),
  `pinNodeId` gating the GoTo/Pin pair.
- Not touched, deliberately: the init-effect pipe bodies (drag/selection mutable state
  is genuinely shared), nodes/list.ts's size (organized by category, splitting is
  churn), the flat src/graph directory (the docs are the map).

### SESSION DIGEST (2026-07-10, overnight — autonomous robustness/parity pass)
Unattended loop pass; brief = "iterate, review existing code/design vs new additions,
keep tsc + vitest green, commit to develop." Three defects fixed, one feature shipped,
one subtle behavior pinned by tests, plus a broad clean audit. (Loop mechanics: the fast 15-min `CronCreate` is session-only
and dies on container reclaim; a durable hourly claude-code-remote Routine self-binds to
the session, survives reclaims, and re-arms the fast cron — that combo is what keeps the
overnight loop alive.)
- **`Math.min(...)`/`Math.max(...)` RangeError on data-scale arrays — CLOSED.** The
  spread form throws past ~125k args, and `mathUtils.iterMin/iterMax` exist precisely
  for this (the doc comment names Aggregate(min)). Two stragglers still on the spread:
  **MINIFS/MAXIFS** (`SumIfsNode`, list.ts) over a large frame column, and
  **`histogramBins`** (visual.ts) over a big series — both would black out on render.
  Swapped to the helpers; `list.ts` already used them everywhere else. Swept the whole
  `src` tree: every other `Math.min(...)`/`Math.max(...)` is over a bounded structural
  count (matrix/column counts, socket keys, 3 triangle vertices) — safe. Class closed.
- **CHOOSEROWS/CHOOSECOLS out-of-range → #VALUE!, not a NaN-padded row** (`TableSelectNode`,
  matrix.ts). It padded a bad pick with raw NaN — unlike Excel (any zero/out-of-range
  index errors the whole call) and unlike its sibling EXPAND (whole-result #VALUE!
  SolError) in the same file; its `cachedResult` type didn't even admit a SolError, and
  chooserows crashed on a fractional in-range index (`[...m[1.5]]`). Now truncates the
  1-based index (negatives from the end), bounds-checks, and returns one #VALUE!.
- **Audited clean (no changes):** the append ladder (VSTACK/HSTACK #N/A padding,
  WRAP/TAKE/DROP/EXPAND), the SUMIFS family's Excel empty-match parity, the Equation
  solver (symbolic isolation, quadratic roots, closest-to-zero numeric fallback) +
  TvmNode zero-rate limit, Triangle Solver (SSS/SAS/ASA/AAS + ambiguous-SSA #SOLVE!),
  trueany adoption, and INDEX/XLOOKUP (all out-of-range branches already #REF!;
  approximate nextSmaller/nextLarger + not-found #N/A correct). The recent code is as
  solid as the audit culture implies — real bugs were rare and narrow.
- **QUARTILE.EXC out-of-domain → #DOMAIN!, not clamp to min/max** (`stats.ts`). The EXC
  branch clamped the interpolation position to [0, n-1], silently returning the smallest/
  largest element for an out-of-domain quartile; Excel returns #NUM!. QUARTILE.EXC(q) is
  PERCENTILE.EXC(q/4), whose EXC branch was ALREADY fixed for exactly this — mirrored it
  (domain [1/(n+1), n/(n+1)]). Found by an audit subagent.
- **parseDateToSerial timezone-independence PINNED** (test-only). The one canonical text→
  date parser's most subtle logic (zone-less text rebuilt as UTC wall-clock; a zone
  designator = absolute instant; ISO date-only = UTC midnight) had no direct coverage —
  the exact code a "simplify" could break into a machine-TZ off-by-one-day. Tests built
  against UTC references so they hold on any runner.
- **Timesavers: Quarter + Days in Month** (feature). The date-serial [F] idioms were held
  "pending the Formula.js serial-interop check". Cleared it: the date extractors
  (MONTH/DAY/EOMONTH…) are OWNED internally by excelFunctions.ts on Solenoid's serial
  model — NOT Formula.js — so a preset Expression reads a date serial correctly (verified
  end-to-end). Shipped the two zero-config, zero-judgment idioms with no single Excel
  function (`ROUNDUP(MONTH(date)/3,0)`, `DAY(EOMONTH(date,0))`); the config/judgment ones
  (Fiscal Quarter start-month, Age's DATEDIF "MD" nuance, Nth Weekday) stay for the author.
- **Also audited clean:** date arithmetic (DATEDIF incl. the MD borrow, 30/360, yearfrac),
  the text nodes (FIND/SUBSTITUTE not-found → #VALUE!, Roman↔Arabic), the scalar math
  domain-error tagging (√/log/arc-fns → per-cell #DOMAIN!, overflow → #OVERFLOW!, the
  combinatorics NaN caught), and the coerceInputs type-coercion seam.
- Non-bug flags for a later author call: (1) **ModeNode MODE.SNGL tie-break** breaks ties
  by SMALLEST modal value (deliberate, tested) while the engine's `modeOf` (Group By /
  Cube Rollup) uses FIRST occurrence per Excel — same data, different answers; recorded in
  backlog, not flipped (tested deliberate choice). (2) `TableSelectNode`/INDEX round-vs-
  truncate a fractional index differently (trunc vs `Math.round`); both Excel-rare edges.

### SESSION DIGEST (2026-07-09, evening — pack enhancement wave: domain tools beyond formulas)
Author brief: "walk the new packs as their domain's user — beyond equations, what
tools/tables/charts does solving problems in this domain actually need?" Six
task-shaped additions, one per pack, each with pinned tests:
- **Element picker (chemistry — the author's own example, built as agreed):** the
  118-entry dropdown became a button (`26 · Fe — Iron`) opening a popup (module
  store + App mount, the TablePopup pattern): a fuzzy-search field (symbol exact >
  symbol prefix > name prefix > substring > atomic number — `searchElements`) over
  a CLICKABLE periodic table, symbols only, real 18-column layout with the
  detached f-block (`elementCell(n)`, collision-free by test). Quiet Accent Rule
  holds: cells are neutral; color marks only the current pick + best match.
- **Resistor Color Code (electricity):** 4/5-band SegToggle, per-band dropdowns,
  and a live resistor GLYPH drawing the actual band colors (information, not
  decoration — fixed IEC 60062 hexes like chart data colors) → Ω + tolerance %.
  Band picks live in `stringLiterals` (free round-trip).
- **EM Spectrum Band (electromagnetism):** frequency OR wavelength → the named
  band (Radio…Gamma; visible names its color) + both quantities via c.
- **Heart-Rate Zones (health):** age / optional resting HR (switches to Karvonen)
  / optional max override → a five-zone Low/High FRAME — the pack's chartable,
  lookupable table ("organize data", not just compute).
- **Pipe Roughness (fluids):** the 13-material textbook ε table (mm); a diameter
  makes it emit ε/D straight into Colebrook/Swamee–Jain — the number every Moody
  problem starts with.
- **Triangle Solver (geometry):** wire ANY three parts (≥1 side; degrees) → all
  six + area + perimeter. SSS/SAS/ASA/AAS; the genuinely ambiguous SSA case is
  an honest #SOLVE! instead of a silent pick. **Reworked same evening (author):
  the card now IS the current Equation design** — `EquationVarRow`/
  `EquationOutRow` exported from EquationNode.tsx (shared, not copied; the
  Check row deduped onto it) give each part ONE dual-socket hero row; a logical
  **Valid** output mirrors Equation's Check (3 parts → solve, TRUE/FALSE;
  >3 parts → solve from the side-richest subset and CHECK the rest agree at
  1e-6); <3 parts pass through quietly. And the card **draws the triangle to
  scale** (letters only — numbers live in the rows; neutral stroke).
- **Per-variable explanations on Expression + Equation (author ask):** each
  variable can carry a prose description (`varDescriptions` map on the node),
  kept OUT of the formula string so KaTeX never renders it. Shown as a hover
  tooltip on the card's variable rows (Expression via a new InlineInputs
  `titleFor`; Equation via `EquationVarRow desc`) AND as an editable legend
  under the big KaTeX in the FormulaPopup (a Variables section — name typeset,
  description field; editable even when the formula is locked, since it's a
  note not the formula). Persists via extractInit (LIVE-var-filtered, blanks
  dropped) + INIT_EXTRA_FIELD_ORDER; textForm round-trips it generically.
  `FormulaPackEntry.varDescriptions` lets presets ship them — seeded on Ohm's
  Law, ideal gas, Nernst, wavelength↔frequency. **Extended to LAMBDA (author
  follow-up, same session):** LambdaNode carries `varDescriptions` (a `varNames`
  getter = params + captured lets extractInit filter uniformly), the value
  carries them (`LambdaValue.descriptions`), and a **LAMBDA wired into a Report
  renders its formula as KaTeX with a muted "where:" legend beneath** (params
  first, then described captures) — the report home the Expression/Equation
  embeds lack (those still embed as values).
- **Trig deg/rad/Auto + Triangle broadcast (author follow-up):** a `Math` node's
  trig ops (sin/cos/tan/cot/csc/sec + asin/acos/atan/acot; NOT hyperbolic) gained a
  **deg/rad/Auto** SegToggle. Forward trig converts the input deg→rad; inverse trig
  converts the result rad→deg and tags the real `deg` unit on its output. **Auto
  (default) reads the incoming unit** — a °-tagged value (a Triangle angle, an
  FC-locked deg, an inverse-trig-deg output) computes in degrees, else radians =
  Excel parity. The unit read is `trigMode.ts` `resolveTrigModes`, run from
  processGraph before the engine pull, stamping a transient `_resolvedAngleMode`
  data() reads — the FIRST and only place compute consults the unit plane; a manual
  Rad/Deg pin ignores it; early-outs when no auto trig node exists. To make that
  read see producer units, `makeUnitResolver` gained the same `annotationFor`/
  `annotation` branches `makeAnnotationResolver` already had (unit plane now agrees
  with annotation plane; FC keeps its forward/author branch). **Triangle Solver
  sockets → numlist** (Equation-family parity, the flagged inconsistency): parts
  broadcast element-wise (parallel lists → a triangle per index, Valid a logical
  list, figure draws index 0); the angle annotation switched from custom "°" to the
  real `deg` unit so the resolver reads it as an angle. Runs main-editor only inside
  a drill-in (backlog, same as trueany/FC reconcile).
- **Per-output unit locks + per-socket FC boxes (author follow-up):** unitFlow
  gained the per-OUTPUT producer seam — `annotationFor(outKey)`, checked before
  the node-level `annotation()` — so the **Triangle Solver's angles carry °**
  (sides bare) and **Element's mass carries g/mol** (Z bare; the exact case the
  Pack-Duty digest recorded as blocked on per-output annotations). And the FC
  now reaches INDIVIDUAL hero boxes: the write side always was per-socket
  (`nodeId::socketKey`; findDockTarget snaps to the nearest socket), the READ
  side caught up — `ValueDisplay` takes a `socketKey` and hero rows
  (EquationVarRow/EquationOutRow) pass theirs, reading `get(node, socket)`
  instead of the any-socket `getForNode`, with the per-output producer lock as
  the resolver fallback so ° shows on the Triangle's own rows too.
- Pack-level descriptions + node-coverage inventory updated; new node classes in
  `nodes/{emSpectrum,health,triangle}.ts` + additions to electrical/fluids/
  chemistry; cards in `PackToolNodes.tsx`/`ElectricalNodes`/`ChemistryNodes` +
  `ElementPicker.tsx` (+ css). NOT built (still composite-shaped, planned in
  `pack-composite-plans.md`): Wheatstone, pump operating point, psychrometric
  state point; Materials pack stays gated on Interpolated Lookup (backlog).

### SESSION DIGEST (2026-07-09, overnight — Pack Duty: 8 domain packs + pack infra)
- **Pack definitions split into `src/graph/packs/`** (one file per pack on
  `packs/packShared.ts` — authoring types + `formulaNode`/`placeFormulas`; `packs.ts`
  stays the registry/activation store, public surface unchanged). `FormulaPackEntry`
  gained `resultAs`/`excel`/`keywords`; `NODE_PACK_TAGS` now derives from per-pack
  `tags`. `packs/formulaTestKit.ts` evaluates presets exactly as placed — every pack
  ships a vitest file asserting its formulas against hand-checked reference values
  (several of MY first-guess references were wrong and the tests caught me, not the
  formulas — the kit earns its keep).
- **Six new domain packs, all `defaultActive: false`:** Electricity & Circuits
  (26 [F] + Parallel Combine, E-Series, AWG; electrical FC units + an SI-prefix
  format), **Electromagnetism** (21 [F] + the CODATA Physics Constant node; the first
  real `dependsOn` — activating it pulls in Electricity), Health & Fitness (20 [F]),
  Fluid Mechanics (20 [F] + the Colebrook root-finding node), Thermodynamics & Air
  (21 [F] + ISA standard atmosphere (7 layers, derived base pressures) + Antoine
  vapor pressure (9 substances, each triple test-verified by reproducing its normal
  boiling point)), Earth & Sky (8 [F] + NOAA Sun Position / Sunrise-Sunset + Moon
  Phase), Chemistry Basics (13 [F] + Element (118 IUPAC weights) + Molar Mass (real
  formula parser: nesting, hydrates)). Existing packs got waves too: Geometry +15
  (circles & arcs, solids), Timesavers +7 [F] + Reverse Text + Spell Number.
- **Sets & Membership pack + core companions** (the backlog's parked Set/relational
  scoping, built as scoped): Is In (membership mask → logical list) + Tally (value
  counts → Frame) in the pack; COUNT DISTINCT as a new `ReduceOp` (pack-tagged);
  **semi/anti `JoinHow` on the core Join** — JS oracle + native Polars
  (`JoinType::Semi/Anti`, new `semi_anti_join` cargo feature), left-columns-only in
  `shapeOfJoin`, cargo parity test (69 rust tests green).
- **Formula-grammar gotcha for pack authors:** `e` is Euler's constant, not a
  usable variable name (an EM formula silently read e² as 7.389 until the value
  test caught it — use `ef`, `ev`, etc.).
- Composite-shaped pack ideas (Wheatstone, pump operating point, psychrometric
  state point, Pareto, % of Total…) deliberately NOT hand-rolled — planned in
  **`docs/pack-composite-plans.md`**; backlog Packs section reconciled (Set pack
  line deleted, Timesavers remainder + Materials-pack/Interpolated-Lookup lines).
### SESSION DIGEST (2026-07-09, day — Equation node, append ladder, Filter redesign, the wildcard split)
- **Morning follow-ups (author-directed):** the **EQUATION NODE** — type `V = I * R`,
  every variable is an input AND an output plus an always-present logical `Check`;
  one unknown → solved (symbolic AST isolation → unparse → recompile, so lists
  broadcast free; numeric log-grid + bisection fallback, new `#SOLVE!` code); all
  known → tolerance truth check. **Decision D14** records why it's a SIBLING of
  Expression with a FIXED socket set (no morphing output — the retype minefield),
  and why no CAS library. `parseFormula` is now exported from excelFormula;
  `OutputRowDef` accepts logical/list values. — **Add menu:** top-level **Packs**
  row (domain packs moved out of Numbers; Timesavers/HYPOTENUSE stay woven with
  their pack dots); **Control folded into Input** to free the row. — **Constants
  carry units:** `PhysicsConstantNode.annotation()` rides the unit (" m/s") through
  passthroughs exactly like an FC lock — the unitFlow duck-type seam took ONE
  method; Element deliberately skipped (two outputs, one unitless — needs
  per-output annotations first). — **Packs now use Equation presets**
  (`FormulaPackEntry.equation: true` → a locked EquationNode): every
  rearrangement-REDUNDANT group collapsed to one node — Ohm's law trio and
  dBm↔W pair (electricity), wavelength↔frequency (EM), the ideal-gas quartet
  (thermo), moles↔mass + pH↔[H⁺] (chemistry); 12 directional presets → 6
  bidirectional ones. Groups that are NOT rearrangements of one relation (the
  power trio P=VI/I²R/V²/R — different variable sets) stay directional
  Expressions on purpose. The Equation seed (order 15) demos the node with
  non-pack equations. **Quadratics (author, same morning):** a residual that is
  quadratic in the unknown — sniffed by numeric probing (7 points; the 3-point
  fit is exact for a true polynomial), so ANY arrangement counts — returns EVERY
  real root ascending (x² − 36 = 0 → [−6, 6]); double root scalar, negative
  discriminant #SOLVE!. Intercepts BEFORE symbolic isolation so the principal
  branch can't eat the negative root; non-polynomials (SQRT/1/x/trig in the
  unknown) fail a probe and keep the old behavior. D14 amended; seed gained the
  x² − 36 block. — **Lists→tables gap closed (author):** VSTACK was a 1-D list
  concatenator, so stacking two lists could never make a table. Now VSTACK is
  HSTACK's true sibling (element-agnostic anytable in/out; a list widens to ONE
  ROW, so two lists → a 2×n table; equal column counts or #SHAPE!); the old
  append behavior lives on honestly named as **Concat Lists**. NEW **Frame from
  Lists** (`FrameFromListsNode`) is the fast lists→Frame path: paired extensible
  rows (typed column name + anylist), TYPE-PRESERVING per column (no
  re-inference — "01" stays text), ragged pad, makeHeaders naming, identity-
  stable memo (audit-42 contract). PairedExtensibleInputs learned string-socket
  text fields for it. — **Complex × Equation:** deliberately NOT integrated (the
  evaluator's [re,im]-is-a-list ambiguity — D2's own wall — plus socket
  morphing); instead **Quadratic Roots** joined the Complex family (a,b,c → x₁,
  x₂ complex outputs; conjugate pair on negative discriminant; −0 normalized).
  Equation's #SOLVE! message stays the real-domain answer. — **Equation card
  rework (author, 4 corrections):** variables lost the typeable literal fields —
  each is now a HERO ROW (value box + chips) with its input socket on the left
  edge and output socket on the right of the SAME row (dual-socket rows via a
  local `useRowTop`, same content-relative math as MeasuredSocketRow); "Holds?"
  renamed **Check** (output key stays `holds`); the "=" prefix stripped
  (`FormulaField` `noPrefix`); editing routes through the syntax-highlighted
  FormulaPopup like Expression (`formulaHostOf` equation host, no "=" prefix,
  solve-semantics engine note). — **Finance conversion sweep (author: "sweep
  non-pack nodes for Equation conversion"):** the 4-op TvmNode + the RATE Newton
  node collapsed into ONE `TvmNode extends EquationNode` (locked annuity
  relation; wire any four of rate/nper/pmt/pv/fv; **payment timing stays a
  CONFIG dropdown** — it swaps which locked relation is compiled (end/beg), the
  template for future Equation subclasses via `EquationComponent`'s new `config`
  slot; rate = 0 delegates to the exact zero-rate limit relation so
  zero-interest loans solve/check exactly; RATE's guess input gone).
  PDURATION/RRI → **Compound Growth** and EFFECT/NOMINAL → **Effective Rate**,
  plain locked EquationNode catalog presets (pinned in finance.test.ts).
  `solveNumeric` policy change: bisect EVERY bracket, return the
  SMALLEST-MAGNITUDE root (the ascending-scan-first policy would have returned
  the spurious 1+r < 0 crossing for RATE). NODE_EXCEL remapped (PMT/PV/FV/NPER/
  RATE → `tvm`; PDURATION/RRI/EFFECT/NOMINAL → the presets); the
  personal-finance seed GENERATOR (`gen-personal-finance-seed.cjs`) rewired
  (tvm nodes drop `op`, outputs `result` → `fv`/`pmt`, mortgage fv as a literal
  0) — remember the committed JSON is a re-emit check, edit the generator.
  Surveyed, NOT converted: Depreciation (period-discrete), IPMT/PPMT/CUMIPMT/
  ISPMT (derived quantities), DOLLARDE/FR (piecewise), bonds/T-bills (date
  sockets), DIST/INV pairs (no closed-form CDFs). D14 amended again. —
  **The append ladder (author: "heavy thinking pass over the appending
  nodes"), recorded as D15:** ONE N-ary element-agnostic append node per
  container rank, all on the BooleanOp extensible-row pattern (`valueKeys`,
  add/remove undo): **Concat Lists** (anylist rows → anylist; scalar widens to
  1-element list, so "push one value" is free), **VSTACK/HSTACK** (anytable
  rows; ragged inputs now PAD WITH #N/A cells like Excel — the old
  whole-result #SHAPE! made "stack a 3-list on a 5-list" unusable; VSTACK pads
  right, HSTACK pads down), **frame Append** (frame rows, union by column
  name — runFrameAppend was always N-ary, the node now exposes it).
  WRAPROWS/WRAPCOLS joined the #N/A padding rule (they disagreed: ragged short
  row vs NaN fill). `ExtensibleInputs` gained a WIRE-ONLY row branch
  (container-typed rows show position / "↩ source", never a literal field).
  Deliberately not unified: Interleave (2 distinct roles), Pad/Repeat
  (fill/self-append utilities), Add Column (single named column; bulk = Frame
  from Lists, keyed = Join), Build Frame vs Frame from Lists (different
  constructors), add-a-row = Get Row → Append (a positional list into a
  by-name append is a refused footgun). Socket keys changed (top/bottom→f*,
  a/b→t*/l*) — table-verbs seed rewired; old saves load those cables dropped
  (pre-alpha). Full reasoning in D15. — **Follow-up wave (same day, author
  approved the queue):** (1) **Filter gained a PERMANENT `Dropped` output** —
  the exhaustive complement by position (null-predicate cells land in Dropped,
  nothing vanishes); author asked "dropdown mode on Filter?" — answer NO, a
  dropdown that toggles a socket kills downstream cables on switch (the
  fixed-socket rule), and the complement is free in the same pass, so it's
  always there. Frame Filter's Dropped landed the same day: `filterMulti`
  gained a `complement` flag through the verb seam (JS oracle keep-set flip;
  Rust BOTH paths — the text-scan hand-roll and the lazy expr fold, where
  `fill_null(false).not()` keeps null-predicate rows in the complement), the
  node publishes a SECOND lazy ref with emitFrame's stale-pass/prev-ref
  lifecycle minus the preview (`_refDropped`, freed on noderemoved too), and
  the card shows just the Dropped socket row — materializing a chip for it
  would collect a frame nobody asked for. Cargo 69→71. (2) **TAKE/DROP (table)** — Excel's real 2-D edge cuts
  (rows+cols, negative = from end, 0 = omitted arg) as one op node; the 1-D
  list Take/Drop stay and their NODE_EXCEL parity claims were corrected.
  (3) **EXPAND** — the 2-D pad (grow to R×C, wired Fill or #N/A, shrink =
  #VALUE! like Excel); retired the old "list-pad ≈ EXPAND" mapping.
  (4) **anylist coherence sweep**: Reverse/Slice/Take/Drop/Shuffle/NthElement/
  Interleave/Pad are position-only, so they're now element-agnostic
  (text/date/logical lists reverse and slice like numbers). Sort/Cumulative
  stay typed (comparison/arithmetic semantics). (5) **`Cell` type hygiene**:
  the matrix cell alias widened to the honest runtime union (± boolean/null/
  SolError) — zero tsc fallout, the #N/A-padding casts deleted. — **Table Input
  rebuilt as a LITERAL source (author: Frame Input's model is the desired
  behavior)**: raw `tableText` is the stored truth, the typed matrix derives
  through coerceFrameCell — the SAME coercion as Frame Input, so bad cells are
  NaN (the carefully-designed quiet dirty-data affordance, 1.0-tail #6 — NOT an
  error badge; author explicitly guarded this) and blanks are null; the grid
  popup edits RAW cells via a new lean `onSaveRaw` literal mode (the old
  parse→tableToText round trip silently coerced bad text away — deleted, with
  parseTableText/tableToText). ONE element type per table via a
  Num/Text/Date/Bool SegToggle (the List Input retype pattern; mixed columns =
  Frame Input's job). — **Type-by-COLOR (author chose color over glyph
  shorthand):** chips now tint by ELEMENT family when the container is
  homogeneous — explicit socket knowledge (`elem` prop; date serials are
  numbers by value) or a cell scan; mixed/unknown keeps the container color (a
  chip must not guess). CSS: `--elem-{string,date,logical}` (+`-table`)
  modifiers on the --sock-* vars; numeric keeps the current look. And
  **List/Table Input header accents track the SegToggle** (NodeShell grew the
  accentOverride passthrough NodeCard already had; SOCKET_COLORS values, the
  FC-header precedent). — **The Filter-family redesign (D16, author-led over
  several rounds; ship only after explicit agreement):** the old list/table
  Filter was FOUR tools in one card (own-value predicate, parallel-list mask,
  table rows/cols, Excel FILTER). Now: **Filter = 1-D only**, the frame
  Filter's shared condition engine (`passesFilter` exported; extensible AND/OR
  op+value rows, per-row Match case, anylist, Kept+Dropped); the **mask and
  the table socket are DELETED** (the socket advertised `table` while the
  predicate refused genuine 2-D — the incoherence that triggered this).
  **Tables filter through the frame Filter** — a matrix widens into its frame
  input as Col1..N (already true in the lattice; pinned by test). **The
  parallel-list pattern got a task-shaped node: SUMIFS**
  (SUMIFS/COUNTIFS/AVERAGEIFS/MINIFS/MAXIFS; Values + paired criteria rows,
  AND-only, Excel's empty-match parity — AVERAGEIFS #DIV/0!, MIN/MAXIFS 0).
  Non-aggregating parallel-list filtering = Frame from Lists → Filter Rows
  (mixed-family parallels can't share a matrix anyway). Seeds rewired
  (lambda-helpers lost its mask demo — MAP reads temps directly;
  null-and-logical + the personal-finance generator moved to condition rows).
  Full reasoning incl. the per-cell/flatten/hole-punch rejections in D16.
- **The wildcard ladder (D17, author challenge):** `any` had been BOTH the rank-0
  untyped rung and the accept-everything supremum; the author called it ("that's
  why we have any, any list, and any matrix"). Split: **`any` = element-agnostic
  SCALAR** (accepts family scalars/combos; output widens anywhere data flows),
  **`trueany` = the supremum** (accepts/flows-to everything) with a new HOLLOW
  gray circle glyph (DOM + pixi "ring" + legend). ~30 call sites re-sorted:
  passthroughs/selectors/Cast/Report/composite ports/unwired lanes → trueany;
  Expression/LAMBDA variables + Regex text + Group Lists keys + wrap/flatten →
  anylist (the Expression cap now enforced at CONNECT time); SWITCH expr/when +
  Expand fill stay `any`, now honest. `isWildcardType()` centralizes the
  resolve-past-untyped checks (FC adoption, type-default display, conduit trace).
  MAP/MAKEARRAY Auto output → `anytable`. Full sweep rewritten in
  socketConnect.test.ts; details in D17.
- **Filter Value rows → `any` scalar** (both Filters): strIn had been a functional
  regression (a Slider couldn't drive a threshold — number→string refused).
  Wired scalars stringify via `readFilterValue` (wired null = "not written yet";
  wired SolError = its code text, matches no rows) so both engines see exactly
  what a typed literal would say.
- **trueany is ADOPTIVE (D17 amended, author):** every trueany placeholder port
  adopts the wired cable's type and reverts on disconnect — `AdoptiveSocket`
  (per-port instances, never the shared singleton) + `trueAnyAdopt.ts`
  (`reconcileTrueAnyTypes` fixpoint; `settleWildcardTypes` alternates it with the
  Conduit reconcile — reconcileFcTypes and the load path both route through it).
  Inputs adopt universally; outputs only where honest (Display/Expect/Input
  Switch pass through; IF/IFERROR/CHOOSE/SWITCH/IFS results adopt when all wired
  branches agree; INDEX/XLOOKUP results stay static). Never drops cables
  (mismatch scan flags), never persists. So the hollow ring on canvas always
  means "nothing has flowed here yet".
- **Rename (author picks):** Frame Filter / List Filter / Frame Sort / List Sort
  replace Filter Rows / FILTER / Sort / SORT — the pair relationship reads
  directly off the Add menu. Also pinned MAP/MAKEARRAY result sockets by test
  (Number default = numeric matrix; Auto = anytable — the numeric socket on a
  fresh card is the declared default, not a D17 regression).
- **SUMIFS rebuilt onto ONE FRAME (D16 amended)** — the author caught it violating
  the 2026-07-06 aligned-columns standing rule (parallel criteria lists, with the
  silent short-list misalignment hazard the rule exists to kill). Now: frame in,
  Values-column field (hidden for COUNTIFS), criteria rows column+op+value — the
  frame Filter's row UI plus an aggregate op selector; missing column → #REF!;
  catalog entry moved to the frame verbs, node kind frame.

### SESSION DIGEST (2026-07-08, night — DOM-weight investigation + reductions)
- **Measurement methodology (the load-bearing finding).** Chrome's Performance-Monitor
  "DOM Nodes" is NOT "elements on the page": it counts every live DOM node in the
  renderer — detached trees retained by JS (Vite HMR retains whole old component trees
  per hot reload; a hard reload's old document lingers until GC), plus text/comment
  nodes (~2.3× the element count). And the HTML-in-Canvas renderer keeps an ATTACHED
  clone of every visible node (what `drawElementImage` rasterizes), so the GPU toggle
  ~doubles node DOM by design. The honest metric: hard reload, GPU toggle OFF,
  `document.querySelectorAll('*').length`. Blank canvas = 312 real elements (the
  monitor read 36k — all artifact). Per-type attribution: tally elements by first
  class token (snippet in the archived session), plus `.katex`/`.recharts-wrapper`
  subtree sums.
- **Reductions shipped (all pixel-identical):** Famous Math 15,237 → 10,826 (−29%);
  Personal Finance reads 8,401 (~86/node, already lean). (1) **KaTeX `output:"html"`**
  (`katexRender.ts`) — the default `htmlAndMathml` emits a hidden MathML duplicate of
  every formula (−~850 on FM). (2) **`LazySelect`** (`components/LazySelect.tsx`) — a
  closed `<select>` renders ONE option; the full list mounts on pointerenter/focus
  (both precede the mousedown/keydown that opens the native picker) and unmounts on
  blur/un-focused pointerleave, NEVER while focused (the open OS popup breaks if
  options vanish). Invisible `<option>`s were the #1 bucket: ~3,400 elements, 24% of
  FM — the FC's full unit catalog + format groups per card. **Width invariant:** cards
  are max-content-sized, so the WIDEST option held the card wide — LazySelect mounts
  the full list for one pre-paint pass, measures, locks the natural width as inline
  `min-width`, THEN drops to one option (re-measures when the option set changes —
  async file lists, pack units). Converted: OpSelect, all FC selects, Convert,
  Connection nodes, Mermaid template; popup/panel singletons stay native. (3)
  **Semantic-zoom span** mounts only while the Settings toggle (default off) is on —
  the zoom-crossing swap stays pure CSS. (4) **Sparkline/Gauge single-mount** — each
  rendered TWO recharts trees (live + square-collapse mini) with CSS showing one;
  now conditional on `collapseStore` (recharts animations are globally off, so the
  remount is instant).
- **Deliberately NOT done (quality-gated, don't retread blind):** socket SVG → CSS
  circle (~1,200–1,500 el; the SVG exists to kill subpixel ovals — SocketComponent
  header comment); ValueDisplay copy button (it is a VISIBLE at-rest affordance,
  opacity 0.45, not hover-only); recharts ink (dots/axes/grids are content); KaTeX
  spans (the typeset formula itself). Remaining honest levers → backlog: SVG Picker
  rasterize-for-display (its `innerHTML = source` inlines ~3k+ paths for a county
  map — the single biggest lever when present), `content-visibility: auto`
  experiment, collapsed Chart/Histogram/Sankey/Treemap live figures.

### SESSION DIGEST (2026-07-08 — SVG Picker node)
- **New node: SVG Picker** (`SvgPickerNode`, Add menu "Other" → "SVG"). An interactive
  picture that doubles as a visual data slicer: load an SVG (local `.svg` or a URL,
  inlined so inner shapes are live), CLICK a shape/layer → the `Layer` string output
  emits its name → feed a Filter to slice a dataset by the clicked region. Also emits an
  `SvgValue` on the `chart` socket so a Report embeds the picture (highlighting the same
  pick). Layer name = element `inkscape:label`/`data-name`/`aria-label`/`id`
  (human-first, walks up to the nearest named ancestor; pure `svgLayer.ts`). Highlight
  colour adjustable; hover/select glow is an imperative `drop-shadow` (not per-move
  React state). Markup persists in `stringLiterals.source` (Mermaid pattern, no bundling
  — SVG is text). Full wiring in node-coverage "Annotation → SVG Picker". Shared
  read-only renderer `SvgFigure.tsx` reused by Display/CableSwitch/Composite/Report.
  Open: cross-origin URL fetch is CORS-limited (local file is the reliable path);
  non-collapsible for now; single-select only (multi-select → list is a natural
  follow-up). Kind is `input` — flip if the author prefers a display-family header.
  `tsc` + full vitest green (2252).

### SESSION DIGEST (2026-07-08, evening — What's New resell + 1.2/2.0 plans)
- **What's New rebuilt around the author's sell bar** ("a shiny thing a user will go
  discover and play with / would inspire a download on social media; What's New is not
  a changelog"). 6 slides → 11: What-if analysis (recast — composites exist to run
  isolated what-ifs; editor/main-canvas parity is machinery, NOT the sell), Command
  palette, Live market data, Mobile redesign (the three-zone chrome), Reports,
  Presenter mode, Mermaid diagrams, Set operations, More chart types, Align &
  distribute bar, Palette editor. Dropped as sells per the author: charts-follow-the-
  palette as its own line, type-colored chips, Document Properties, composite-editor
  parity. The bar itself is now written into `release-notes-features.md`'s header and
  the slide list there mirrors the deck. About gained the type-enforcement + unit-lock
  sentence. (Judgment call left to the author: the model fuzzer/trust set reads as
  slide-worthy by the same bar; it stayed in the release-notes body, not the deck.)
- **American spelling in shipped strings** (author): three nodeCatalog descriptions
  carried "colour"/"coloured"; respelled. Code comments keep whatever they have.
- **Post-1.1 work organized into two release views:** `docs/1.2-plan.md` (tiered:
  known-issue fixes with tidy/cleanup-around-groups as the backbone, half-built tails
  F-2/D-2/goal-seek-params/drill-in-subsystems, widening incl. the CSP-gated iFrame
  node, unscheduled candidates, parked items) and `docs/2.0-plan.md` (the author-
  present flagships A4 → transpiler → D2 → D4, the Monte Carlo gate, verdict-pending
  #23/#35; bundle detail stays in `v2.0/`). backlog.md remains the per-item source of
  truth; docs/README index + release-plan pointers updated.

### SESSION DIGEST (2026-07-08, latest — Writing & Copy pass over every shipped string)
- **Full copy pass (author order): every user-facing string held to DESIGN.md §7 + the
  Captain-Obvious rule; internal docs exempt.** ~700 strings rewritten across seven
  surfaces by parallel agents on disjoint files, then audited centrally: nodeCatalog
  (223 of 303 descriptions — these render in the Add menu + Function Reference),
  nodes/*.ts op metas (~315, mostly the trailing "(Excel: =FOO)" idiom → the plain
  sentence "Excel: FOO."), top-level chrome (~40: menus, StatusBar, Settings, notices,
  error prose), components A–L (~48) and M–Z (27), seed titles/notes/comments (~50 +
  the PF generator's ten notes, re-emitted in lockstep), README's two em dashes.
- **New style rule codified (author 2026-07-08): no trailing parenthetical.** A string
  may not end with "(…)"; fold the aside in, promote it to a sentence, or delete it.
  Added to DESIGN.md §7 with the "Excel: XLOOKUP." convention as the worked example.
- **Deliberately unchanged, for the next pass to know:** shortcut-hint parens
  ("Save (Ctrl+S)") are functional key names, not prose; the paired
  "Align center (vertical/horizontal)" command names disambiguate two identical labels
  and are synced between SelectionActionsBar and CommandPalette; the bare "—"
  empty-value glyph is typography; math notation (Σ(score × weight), (m×n)) is not an
  aside; genuinely informative mechanism contrasts ("stores the URL, not the data")
  survive the no-antithesis rule; code comments/console.warn are dev-facing.
- Twin-string traps found by the audit: process.ts carried its own copy of the #CIRC!
  message (now matches errorValue's); "Grand (at start)" existed in both
  PivotEditorPopup and FrameNodes (fixed consistently on both surfaces).

### SESSION DIGEST (2026-07-08, later — seed consolidation 27→17 + release odds & ends)
- **Seed set consolidated 27 → 17 (author-directed "rebuild from scratch" pass).**
  Retired outright: mortgage (PF §6 is a mortgage stress test), investment, break-even,
  stats, bom-costing (the same 5-step chain built twice), frames. Merged: as-of/lookup
  corner → **Table Verbs** (order 65); visual-outputs' unique widgets (Sparkline/Gauge/
  Heatmap/ChartBuilder styling) → chart-showcase, retitled **"Charts & Visuals"** (its two
  bare Chart lanes dropped as gallery duplicates); magnetic-flux → **Famous Math** as "The
  namesake" cluster + intro note; error-codes tour → null-and-logical as a side-by-side
  column, retitled **"Errors, Null & Logic"** (cluster ids preserved — `errorSeed.test.ts`
  just repointed its import and still drives all 11 codes through the real engine).
  **Getting Started rebuilt:** the collapsed amber trig/averages group (11 hidden nodes)
  DELETED per the author; in its place a Tables & charts cluster (Quarterly-sales frame →
  column Chart; Get Column → SUM → $-Display) + one comment pointing at Ctrl+K / the
  example menu. `run-graph.test.ts` re-anchored its headless assertions on that cluster
  (frames.json was its fixture). **Cube Rollup kept a demo**: a rollup row added to the
  cubes seed (SUM of each Rep's nested orders.Revenue) since bom-costing was its only
  appearance. **Composite Workbench** gained a second goal-seek card ("Retirement deposit
  finder": Solve the monthly deposit → $500k in 30 yrs at 7%, annuity-FV Expression
  inside; probed FV(300)=**$365,991** via tsx). bomCostingSeed.test + framesSeed.test
  retired with their seeds.
- **Mobile command palette fixes** (author-reported): the persistent (always-on) bar sat
  at z-index 300 ABOVE the Settings/help/shortcuts modal band (200) — persistent scrim
  now 150 (ambient chrome yields to dialogs; the explicitly-invoked modal palette keeps
  300); mobile top anchor 64px → **92px** (the 82px top-chrome edge + 10, level with the
  nav pill). layout-chrome.md ladder + mobile-offsets table synced.
- **Known-issues section** added to `release-notes-features.md` (GitHub release body ONLY,
  not in-app — author call): tidy/cleanup-around-groups wonkiness, drill-in main-only
  subsystems, label-edit undo gap, zoom seam, web CORS limits on Data Feed, Problems-panel
  per-cell blindness, Tornado ranking caveats, fuzz Clamp, Set-node complex identity
  compare, private-browsing reload loop, Android status-bar tint.
- **`working` branch formally retired**: its CLAUDE.md now opens with a redirect banner
  to `develop` (stale copies of main's CLAUDE.md still name `working`; main self-corrects
  at the 1.1 merge). Commit identity verified: all session commits are
  `Claude <noreply@anthropic.com>` author+committer; the earlier hook warning referenced
  pre-rewrite hashes that no longer exist.
- **agent-coordination.md swept to dormant** — it still carried the entire 2026-07-05
  autonomous-run claims board (all landed long ago).

### SESSION DIGEST (2026-07-08 — 1.1 release build: finance seed, seed overhaul, bump)
- **Live Market Data seed** (`seedGraphs/live-market-data.json`, order 45): the committed
  §3a demo — FRED UNRATE (since 2015) → line chart + Get Column → Aggregate average
  ("it's the data, not a picture"), FRED MORTGAGE30US monthly → chart, and an Alpha
  Vantage AAPL cluster that intentionally demos the add-a-key state when no key is stored.
  GOTCHA: a hand-authored seed MUST say `"v": 2` (`CURRENT_SAVE_VERSION`) — `seeds.test.ts`
  doesn't validate the field and a higher value is refused at load, silently from the
  test suite's point of view.
- **Seed overhaul (release-plan §3b) — DONE.** Four parallel review agents over all 27
  pre-1.1 seeds (story/currency/copy; structure already machine-checked). Retired
  `value-semantics-tail.json` (internal 1.0-QA framing, superseded by null-and-logical)
  and `layout-test-mixed-heights.json` (dev fixture in the user menu — seeds.ts globs
  everything, there's no exclude mechanism). Content bugs fixed: null-and-logical
  cluster F claimed `[1,null,3,4] > 2` → `FALSE, null, FALSE, TRUE` (correct:
  `FALSE, null, TRUE, TRUE`); pivot-tables title said 9 columns (10 since SKU);
  asof-join-lookup's note called XLOOKUP "Frame Lookup" (never a user-facing name).
  Menu orders added (composite-workbench 12, asof-join-lookup 55 — headliners were
  sinking to the alphabetical tail at default 1000). getting-started: named the three
  bare "Group" groups, pruned the Concat node's dead `a/b/c/d` literals (old 4-slot
  shape). Retitles: Visual Outputs → "Gauges, Sparklines & Chart Styling",
  Dimensional Flow → "Types & Shapes" (menu-collided with Unit Flow). Author-call
  residue → backlog ("Seed follow-ups from the 2026-07-08 overhaul").
- **What's New / feature-list copy corrected:** FRED is keyless (say so — it's the
  selling point), FX quotes don't exist, and composite Simulation is iterative
  loop-stepping, not Monte Carlo (2.0-reserved). `HelpDialogs.tsx` slides synced with
  `release-notes-features.md`.
- **Version bumped to 1.1.0** in lockstep: `package.json`, `tauri.conf.json`,
  `Cargo.toml` + `Cargo.lock` (hand-edited — the cloud container can't build Tauri:
  no GTK dev libs, so `cargo test` must run on the author's Windows machine before
  the tag). README's desktop line de-versioned ("Windows, v1.0" → "Windows").
- **Remaining to tag** (all author-run): eyeball pass on the Vercel preview, `cargo test`
  on Windows, release desktop build, merge `develop` → `main`, tag `v1.1.0`.

### SESSION DIGEST (2026-07-07 — commit-walk audit, ~130 commits newest-first)
Eight fixes across four commits (`e9184b0`, `9bab17b`, `30b6cfa`+`7bdba07`, `ef641de`):
- **anylist gaps:** `coerceInputs` had no `anylist` case (a scalar reached Set's `for...of` raw —
  number threw, string iterated PER CHARACTER); List Input's type switch pruned only OUTPUT cables
  (a wired row kept a type-illegal cable after Num→Text); Expect "In list" used the number-only
  `listIn` so a TEXT allowlist couldn't be wired (now `anyListIn`).
- **Heavy-composite stale dot lied:** arm-and-run keyed staleness on inputs/config/seeds only — an
  INTERNAL edit (drill-in value change / rewire) held the old solution under a green dot. Added
  `internalEditSeq` to `solveKey`, bumped by an internal-editor topology pipe + process.ts's
  retargeted pass (`markInternalEditChain` marks every nesting level). Tests for both funnels.
- **Drill-in resolver sweep misses (9316c2d follow-up):** CableSwitch (mode retype/prune against
  MAIN), inlineInput's `useConnectedInputs`/`useIncomingSources` (wired rows read unwired inside a
  drill-in), NoteNode `commitFields` (frontmatter cable prune + reconcileFcTypes on the wrong graph),
  ResizeHandle (grip didn't render at all for internal nodes). All routed through
  `getOwningEditor`/`getActive*`. Remaining `getEditor/getArea` component imports verified main-only.
- **Collapsed groups never gain members (author report: wrong membership near collapsed groups):**
  a collapsed group renders as a small card with members hidden, but all three membership editors
  treated the card as a drop target — a node dragged/created over it silently joined and was hidden
  by the next syncGroupCollapse (visibly vanished). reconcileGroupMembership skips collapsed join
  targets; absorbIntoContainingGroup skips collapsed groups; reconcileGroupBox no-ops while collapsed
  (its card-box would DUMP every member). Membership edits require the group expanded. The suspected
  duplicate-"Group"-label cause was ruled out: runtime membership is id-based, saves use the minted
  unique names (per-prefix counter), labels are never identity.
- **Docked FC never let go (author report):** two holes — (1) cutting the FC↔host glue cable did
  NOTHING (no code path reacted; the FC kept trailing the host + annotating its socket): the
  connectionremoved pipe now dissolves the dock (full undock), skipped while graph-rebuilding;
  (2) drag-to-empty cleared only the dockedNodeStore entry — the stale hostNodeId persisted into
  the save and load-time dockSelf() RESURRECTED the dock: new FC.releaseDock() (forget dock
  identity, keep annotation) runs on the drop-to-empty path.
- Open observations (not fixed, judgment calls): Set-node membership compares complex `[re,im]`
  cells by REFERENCE (equal complexes from different sources never intersect); the stale-chunk
  reload guard can loop on a genuine outage in private browsing (sessionStorage throws → the 10s
  guard never persists — an in-memory fallback would close it).

### SESSION DIGEST (2026-07-07 — Data Feed widening + Trust-node audit)
- **Data Feed widening:** FRED gains start/end date fields (cosd/coed) + a frequency dropdown
  (fq + fam=avg); Alpha Vantage gains a frequency dropdown that swaps the TIME_SERIES_* function +
  its own symbol quick-picks. Quick-picks generalized to `preset.quickPicks`; refinements live in
  `stringLiterals` (round-trip), fold into the URL (→ cache key → re-fetch), reset on provider switch.
  `buildUrl` gained an optional `opts` arg (existing 2-arg calls unchanged).
- **Trust-node audit** (background subagent, 9 findings; comments / Reconcile-PVM / Expect-persistence
  found clean). FIXED: **Tornado** produced all-zero swings in manual/sketch calc mode (drove the sweep
  with plain `processGraph` — no rebuild-gate, so the manual short-circuit no-op'd every perturbation)
  AND fired real Expect/Alert HUD alerts from synthetic values AND left a leaf pinned on a mid-sweep
  throw — now wrapped in `beginGraphRebuild` + `beginForceExact` with a per-leaf `try/finally` restore,
  mirroring modelFuzz. **model-fuzz** was leaving synthetic `#DIV/0!` etc. in the Problems "compute" log
  (`reportLive` now gated on `isGraphRebuilding`, load-safe — the post-load settle is outside the gate).
  **Expect** not-null now flags a per-cell SolError. **fuzz** no longer reports a downstream Expect's
  rejection of a synthetic extreme (circular noise). Remaining follow-ups → backlog (per-cell errors in
  Problems, Reconcile non-shared cols, fuzz Clamp bounds, Tornado ranking normalization).
- **Trust demo seed** (`seedGraphs/trust-data-quality.json`): three clusters exercising the set —
  Expect (not-null + range 0–50 over a sensor frame with a blank + an 88 → red badge + 2 Problems),
  Reconcile (Jan→Feb price/qty frames, PVM key=SKU → changed/added/removed + PVM), Tornado (3 sliders →
  a Profit expression → sensitivity; run-on-demand), plus two node-anchored comments. Loads clean +
  textForm round-trips (auto-registered via the seedGraphs glob).

### SESSION DIGEST (2026-07-07 — What's New + About, renderer-spike cleanup)
- **What's New overlay + About Solenoid** (`helpDialogStore.ts`, `HelpDialogs.tsx` + CSS):
  one modal slot for both Help dialogs. What's New is a 6-slide carousel (the `[slide]`
  headliners from `release-notes-features.md`) with dots/Back/Next, auto-shown ONCE per
  `WHATS_NEW_VERSION` (localStorage `solenoid.whatsNewSeen`; first-ever visitors recorded
  silently so the modal never lands over a new user's first load; deferred 1.4s past the load
  reveal). About shows the wordmark, `pkg.version`, the tagline, and a "What's new" button.
  Help menu gains "What's new…" and enables "About Solenoid" (was disabled). Mirrors the
  shortcuts-overlay chrome; shared `CloseIcon`.
- **Renderer-spike cleanup:** deleted the HTML-in-Canvas SPIKE (`HtmlCanvasSpike.tsx` +
  `htmlCanvasSpikeStore.ts` + its App mount + Edit-menu item) — the shipped HTML-in-Canvas
  renderer (`HtmlCanvasLayer`/`htmlCanvasRenderer`, renderMode "html") is untouched. Removed the
  Pixi spike's Edit-menu item too (hidden; the `RendererSpike`/`pixi/*` code + `window.__spike`
  dev hook stay). Backlog + WebGPU parked note updated.

### SESSION DIGEST (2026-07-07 — stale-chunk reload guard)
- **"Failed to fetch dynamically imported module" (autoarrange/ELK):** not an autoarrange bug —
  the classic stale-chunk-after-redeploy race (a new deploy rotates the hashed chunk names; an
  already-open tab 404s the old hash the moment a lazy import fires — ELK Tidy, Mermaid, charts,
  KaTeX are all code-split). Added a `vite:preloadError` handler in `main.tsx` that reloads ONCE
  to pull fresh chunk refs, sessionStorage-guarded so a real network outage can't loop. Autoarrange
  stays lazy on purpose (ELK is ~1.5 MB / ~471 KB gzip, kept out of the main chunk — `4635e54`).

### SESSION DIGEST (2026-07-07 — mobile status bar + HUD overlap)
- **Command palette Android autofill bar killed:** the palette search input showed Chrome's
  password/card/location autofill bar despite already carrying `autocomplete="off"` + `name` +
  the off-flags (Chrome ignores `autocomplete="off"`, and a `name`d `type="text"` reads as a
  fillable form field). Switched it to a semantic `type="search"` (no `name`) — Chrome drops the
  credential/payment/address prompts for a real search field; native clear-button hidden in CSS.
- **Accent status bar (Android) — SOLVED 2026-07-07, and the earlier "Chrome auto-update"
  conclusion was WRONG.** The variable was the PHONE's dark mode all along: Chrome for Android
  ignores `theme-color` on its normal-tab toolbar whenever the BROWSER UI is in dark theme
  (system dark / Chrome theme setting / battery saver) — long-standing documented behavior, not
  a 2026 regression. In light mode the accent tints fine (author-confirmed on device); fullscreen
  has no toolbar, so the status bar tints in BOTH modes there. The 07-07 session's three fixes
  (drop the color-scheme meta, color-scheme root→body, media theme-color variants) and the
  "byte-identical config → Chrome auto-updated, platform limit" proof were chasing a phone
  setting; the diff couldn't see it because the phone's theme isn't in git. (Chrome also doesn't
  honor `media` variants on theme-color — that's Safari — so that experiment couldn't
  discriminate.) Baseline (single media-less meta + root color-scheme) is correct and stays.
  Nothing to fix; do NOT reopen a fix hunt for the dark-toolbar case — a PWA manifest is the one
  real lever and the author declined it.
- **HUD (pins/problems/alerts) overlapped the Fit/Lock pill on mobile:** the stack was pinned at a
  fixed `top:124px` (desktop, no safe-area) while the mobile pill sits at `92px + notch` — worse in
  fullscreen where the safe-area shifts but a fixed top can't track it. Added a mobile override
  `top: calc(136px + env(safe-area-inset-top))` (+ width cap), tracking the SAME safe-area as the pill
  so the gap holds in both modes.

### SESSION DIGEST (2026-07-07 — composite drill-in: collapsible controls + mobile pass)
Vercel preview of `develop` (mobile session). tsc + full vitest (2281→2282) green.
- **Drill-in undo history routing (backlog gap c, DONE):** node components push undoable
  edits via the global `pushHistory` (extensible rows, cable-switch, group resize), which
  Canvas had hard-wired to the MAIN history plugin — so an edit made INSIDE a drill-in was
  recorded on the main stack and the drill-in's own undo (Ctrl+Z / the mobile bar, which
  routes there) couldn't reverse it. Rerouted the registration to `getActiveHistory()?.add`
  (the drill-in's `mount.history` while a subgraph is active, main otherwise). The undo/redo
  closures already refreshed via `getActiveArea()`, so this one line completes it.
  `historyRouting.test.ts` locks the contract.
- **Run-controls panel is collapsible** (`CompositeEditorOverlay`): a head bar showing the
  current run mode + a chevron folds the body (`CompositeRunControls`) away; starts COLLAPSED
  on mobile (`IS_MOBILE`) where a 240px open panel blanketed the small canvas. New
  `__controls-head` / `__controls-body` structure; scroll/max-height moved to the body.
- **Drill-in mobile pass:** the mobile CSS block was DEAD — it targeted `__panel` / `__header`,
  classes from an older full-panel design that the current strip/controls structure dropped, so
  the drill-in had effectively no mobile styling. Replaced with real rules, then corrected against
  the real mobile chrome heights (author testing): breadcrumb strip now clears BOTH top rows
  (accent ~30 + toolbar 52 = ~82px + notch; was hiding under them at 56px); run-controls panel
  sits ABOVE the ~86px bottom pill (it was pinned to bottom:10px → behind the pill → "not present");
  drill-in minimap hidden on mobile (no room, overlapped chrome). `+ Input/Output` finger-sized.
  Strip width capped to `calc(100vw - 130px)` so it clears the right-anchored Fit/Lock pill
  (`.solenoid-nav`, ~110px) it shared a row-band with (author: breadcrumb overlapped the pill).
- **Backlog reconcile:** "Simulation output series renders on the outer card only" was already
  resolved by `334bdf4` (2026-07-03, "sim marker value") — `runSimulation` sets
  `marker.cachedResult = series` and both the outer card and the drill-in marker render it via
  the SAME `CompositeBoundaryValue`. Deleted the stale line.

### SESSION DIGEST (2026-07-07 — Gauge percentage + FC text advanced tier)
Vercel preview of `develop` (mobile session; `develop` is the deploy branch now). tsc +
full vitest (2280) green.
- **FC advanced tier for TEXT values** (backlog "FC advanced options for TEXT"): a
  string-typed Format Controller now has an expander (reusing the number tier's
  `advancedOpen` / `toggleAdvanced` + chevron) with three display-only controls —
  **alignment** L/C/R (SegToggle; the display box is right-aligned by default, so
  this is an override), **Markdown** (renders the value as sanitized BLOCK markdown
  via `marked.parse` + DOMPurify — `# h` → real `<h1>`; styled by a compact
  value-box `.solenoid-node__md` class, untrusted strings from shared files), and
  **Monospace** (text renders sans by default; opt into `--font-mono`). Two follow-up
  fixes after author testing: the mono checkbox spread a `fontFamily: undefined` that
  clobbered the base sans → forced mono on ALL FC-text (now only emits the key when
  ON); Markdown was `parseInline` (no headers) → block `parse`. New
  `FormatAnnotation` fields `textAlign` / `textMarkdown` / `textMono` (+ `TextAlign`
  type), FC node props + `annotation()`, `controlsFor().advanced` now true for text,
  applied in `nodeKit.tsx` ValueDisplay (the same surface as the existing case/B/I/size
  attrs), persisted via `copyPaste.ts` INIT_FIELD_ORDER. Format-model doc truth table +
  `formatModel.test.ts` updated.
- **Doc-rot fix (author called it out):** the Data Feed node shipped 2026-07-06 (`5675c48`
  + `bf4f531`) but the backlog still marked it "unreachable / never registered." Reconciled
  the line to the genuine remainder (symbol picker, date-range/frequency, more providers,
  demo seed). Verified the rest of the 1.1 section against code — iFrame node + What's New
  overlay are genuinely unbuilt (correctly open).
- **Gauge is now a single-value percentage dial.** Dropped the Min/Max inputs — the node
  takes ONE `value` read as a fraction of 100% (1 → 100%, 1.5 → 150%). The arc always spans
  0→100% and fills the clamped fraction (150% overfills to a full arc); the centre label shows
  the true percentage (`formatPct`), and the end labels are a fixed `0%` / `100%`. Node class,
  component, catalog description, and `visual.test.ts` all updated.
- **Gauge track contrast:** new `--gauge-track` token (both themes) for the unfilled arc —
  `--border-subtle` was near-invisible against the node body; `chartCore` `track` reads it.
- **Gauge minifies** (copies the Sparkline pattern exactly): `squareCollapse` on the NodeShell
  + a `collapsed-only` mini `GaugeArc` (46×24, cropped). Single input via `InlineInputs`, so the
  socket survives the fold (`data-socket-side`) and re-wiring works while collapsed. This closes
  the "Collapsed Gauge mini-preview" backlog item — the last of the per-node minified set.
- **Seed fixups for the new percentage model:** `visual-outputs` slider → 0–1 range (shows 72%);
  `layout-test-mixed-heights` gauges → 0.64 / 0.8; **personal-finance** rewired — the two
  toward-goal gauges (`gauge-nw`, `gauge-proj`) that used a dollar Max now feed through new
  `ratio-nw`/`ratio-proj` ExpressionNodes (`nw / goal`, `fv / target`) so the gauge reads a real
  progress fraction; `gauge-rate` already carried a 0–1 savings rate. The seed is generated —
  edited `scripts/gen-personal-finance-seed.cjs` and regenerated the JSON (pfSeedCheck lockstep).

### SESSION DIGEST (2026-07-06 late — composite drill-in polish + editable input markers)
Local dev server. tsc + full vitest (2279) green. A long interactive pass over the
Composite drill-in with the author. Highlights:
- **Add composites like any node:** the catalog entry was `hidden: true` (Ctrl+Shift+G-only);
  un-hidden — drop an empty Composite and Edit contents (the drill-in is first-class now).
- **Run-mode/Solve/config controls INSIDE the drill-in:** extracted `CompositeRunControls`
  (run-mode selector + Solve/status + the active mode's config editor), rendered on the outer
  card AND a floating panel top-LEFT under the breadcrumb in the overlay (top-right is the
  Zoom pill / HUDs). `emit` is outer-only (the goal-seek Solution socket anchors to the outer
  node); inside it's a plain display.
- **Editable input markers (`CompositeInputNode.defaultValue`, persisted via INIT_FIELD_ORDER):**
  the marker gets the Number-Input field (`value-input`, commit on blur). It's the input's value
  when the port is unwired + the goal-seek seed. runPass fallback: override → wired → marker seed →
  port default. **Inside-vs-outside solve:** `requestSolve(insideOnly)` — an inside Solve
  (`CompositeRunControls insideOnly`) runs on the seeds, IGNORING outside wiring; an outside Solve
  uses the wired values. **Writeback:** a goal-seek writes the solved driver back onto its marker,
  cleaned via `formatScalar` (integer/4-dp — no raw float tail). `solveKey` includes the seeds;
  `lastSolveKey` is recomputed AFTER the solve (the writeback would otherwise read stale next pass).
  KNOWN: the stale dot is uniform (external inputs + seeds), so post-inside-solve it reads green
  though the result is seed-based — re-solve outside to use wiring (needs a drill-state signal in
  compute to distinguish; left simple — see backlog).
- **Immediate label propagation:** `syncPortLabels()` runs at the top of `data()` (cheap, every
  pass) so a marker rename updates the port-label-driven controls (goal-seek Set/By) on blur; the
  overlay subscribes to `compositePassStore` to reflect it. Outer card still updates on drill-up.
  syncPortLabels now falls back to the marker PLACEHOLDER (Input/Output) on a cleared label.
- **Pointer/zoom parity:** the drill-in used rete's stock zoom (fixed-step + double-click zoom);
  extracted `CappedZoom` + `installSurfacePointer` (dblclick swallow) into `areaPresets.ts`, called
  from getDrillMount; Canvas uses the same shared `CappedZoom`. (Full mobile touch select/lasso is
  the separate lasso item.)
- **Green boundary markers:** new `boundary` node kind → green ("special"); Composite stays gray.
- **Goal-seek visual:** Solution is the SOLE hero (output boxes suppressed) and wireable (target
  port socket on it, emitting the solution); status circle is an SVG (round) with 3 states — amber
  ring (stale) / red (`#CONV!` no solution) / green (solved); `#CONV!` renders via ValueDisplay
  (same red badge as every error). Driver input socket kept (feeds the seed).

### SESSION DIGEST (2026-07-06 late — goal-seek hero/socket + arm-and-run for heavy composites)
Local dev server; commit freely, no pushes. tsc + full vitest (2277) green.
- **Goal-seek is single-hero + wireable:** the composite card suppressed the output-port
  value boxes in goal-seek mode (`runMode !== "goal-seek"` guard) — the achieved output
  just equals the target, so the **Solution** is the sole hero. It then needed its socket
  back: the Solution hero now carries the target output port's `MeasuredSocketRow`, and
  `runGoalSeek` EMITS the solved DRIVER on that port (`row[gs.outputPortId] = solved`), so
  the composite's output IS its solution — wire the break-even units downstream, not the
  trivially-zero profit. Tests updated to the new semantic (output == solution).
- **Arm-and-run for heavy modes (author ask — "Calculate button instead of auto fire; they
  get heavy"):** goal-seek / scenarios / data-table / simulation each do many internal
  passes; in automatic mode they re-solved on every upstream tick. Now `CompositeNode.data()`
  gates on `isHeavyMode()`: solve once (first run OR `requestSolve()`), then HOLD `cachedOutputs`
  and set `stale = key !== lastSolveKey`. `solveKey` is a CHEAP signature — object inputs
  (frames) → a stable ref token via a `WeakMap`, not a deep serialize — so the per-tick cost
  is trivial. `runActiveMode` holds the original dispatch. All arm state is session-transient
  (not persisted): a fresh load solves once, matching the load reveal.
- **Stale indicator:** `compositeStaleStore` (module store) drives it — a HELD composite's
  output doesn't change, so processGraph's changed-output re-render pruning would skip the
  card; the card subscribes to the store instead. UI = a Solve (play) button + an ALWAYS-present
  status circle (so it never resizes the button): amber ring (#d9822b, the alert tone — reused,
  not a new colour) while stale, filled green (`--sock-lambda`, semantic positive) once solved.
  Tooltip "Stale"/"Up to date", no instructional copy.
- **Still open (author raised, not built):** solver PARAMETERS — goal-seek max-iterations /
  tolerance / driver bounds; simulation step count is `simulationSteps` already; Monte Carlo
  (unbuilt) sample count + seed. Fits an advanced-tier expander per mode. See backlog.

### SESSION DIGEST (2026-07-06 late — first-class composite drill-in)
Local dev server; commit freely, no pushes. tsc + full vitest (2276) green.
Author asked to upgrade the Composite drill-in from a second-class overlay to a
first-class canvas ("copy paste, titles not propagating, right click… make it open
in the main app like its own graph"), and to trust my method. Two phases below.

**Phase 2 — the app frame STAYS and follows you in (the real ask).** Phase-1 kept a
separate full-bleed overlay + rebuilt weak chrome inside it; author clarified they
meant the MAIN app frame should stay, only the canvas surface swaps. So:
- **De-fullscreen:** the subgraph canvas now sits at `z-index:4` (above the main
  graph z0, below the chrome z5-6) instead of a fixed inset:0 z9000 panel. Header,
  toolbar, status bar, minimap all stay visible around it. The overlay's bespoke
  header (undo/redo/delete/close/+Node) is RETIRED — keyboard + real chrome cover it.
  What's left is one floating **strip**: breadcrumb (drill-up) + `+Input/+Output`
  (port promotion), accent-tinted as a "you're in a subgraph" cue. `html.sol-drilled-in`
  root class marks the state.
- **Chrome pointed at the active graph:** NavMenu zoom/fit + the minimap/fit geometry
  (`minimapNodes`) read `getActive*`; the drill-in got its OWN `MinimapPlugin` (colored
  preset, collapse-aware, subgraph viewport); canvas **lock** mirrored onto the host so
  subgraph nodes go view-only. Fit bug fixed (a hidden panel's zero-rect made the right
  inset the whole viewport → zoomed way out; null out zero-area rects in `visibleInsets`).
- **Drill-in keyboard extended:** Ctrl+A select-all (via a captured `selectable` handle
  on the mount) and **Tidy (T)** — a self-contained `AutoArrangePlugin` on the drill-in
  area (lazy-imported, cached on the mount, same symmetric ELK port preset). Canvas
  keydown already stood down while a composite is open, so the drill-in owns shortcuts.
- **Extensibility (author asked):** `activeGraph.ts` documented as THE canvas-substitution
  seam (register on mount / clear on unmount / read via getActive*; nested surfaces work
  by REPLACE-not-stack since the breadcrumb stack lives in compositeEditorStore; single
  slot is correct until two live surfaces ever coexist). Extracted the render preset +
  connection veto both surfaces hand-copied into **`areaPresets.ts`** (`solenoidClassicRenderSetup`
  / `makeSolenoidConnectionFlow`) — they had ALREADY drifted (drill-in flow missed the
  lock veto); now one source, used by Canvas + getDrillMount + any future surface.
- **NOT done (main-bound subsystems, would be broken not just unwired):** Group/Cleanup/
  Autofit/Expand (membership + push + collapse + standoffs live in Canvas's main pipes — a
  group made in the drill-in would be a static frame that doesn't push/absorb), Isolate
  (`isolateStore` hides MAIN nodes by z-order, no subgraph scope), navigator + lasso (sizeable:
  navigator list/select/jump/rename all target main; lasso is a custom Canvas rebuild). These
  are folded/hidden while drilled in, not half-shipped. Also still: drill-in **history routing**
  (row/socket/label edits push to MAIN history) + Edit-menu undo/redo on the active graph.

**Phase 1 — the resolver + propagation.** Approach = **B1-surgical**:
keep `process.ts` `getEditor()/getArea()` MAIN-only forever (228 call sites incl.
persistence/serialize — routing them through an override would autosave the subgraph
over the document), and add a NEW resolver the ACTION layer uses.
- **`activeGraph.ts` (the keystone):** `setActiveGraph(ctx|null)` registers the drill-in's
  current level; `getActiveEditor/Area/History` resolve override-else-main; `getOwningEditor(id)`
  returns the drill-in editor when it holds the node, else main (never routes a MAIN node to
  the override). The overlay's mount effect calls `setActiveGraph({internalEditor, area, history})`,
  cleanup clears it. Locked by `activeGraph.test.ts` — the cardinal split (action layer follows
  the drill-in, `getEditor()`/persistence stays MAIN).
- **Drill-in affordances wired:** copy/paste (Ctrl+C/V at cursor, routed through getActive*,
  pasteClipboard has a subgraph branch), A-to-add at cursor, arrow-nudge, and a **right-click
  node menu** (`DrillNodeMenu` in the overlay — Edit-contents (composites) / Duplicate / Delete;
  the main canvas's node menu is isolate/pin/standoff, all MAIN-only, so the drill-in gets its
  own focused set). Duplicate reuses copy/paste by transiently isolating the target on the
  `.selected` flag; markers stay on the add/remove-port gesture.
- **"Titles/formats/types not propagating" — the systemic root + fix:** render-time cross-node
  resolvers (value-box FC annotation in `nodeKit`, `displayedType`, Display FC) and in-node
  socket/row actions (Cast, Chart, Alert, TVM, Extensible + Paired rows, Build Frame rows,
  Get/Add/Split retype, Expression/LAMBDA rebuild) all read `getEditor()/getArea()` (MAIN) —
  so for an internal node they resolved the wrong graph and silently no-op'd. Rerouted the
  display resolvers + unit-flow relocks (Convert/FC) through `getOwningEditor`, and the
  socket/row actions through `getActive*`. `cast.ts` `sourceKind()` left as-is (compute-time,
  not render/action — coupling compute to the drill-in override is a layering smell + only
  helps the drilled-in case).
- **STILL OPEN (see backlog "First-class composite drill-in"):** drill-in render parity
  (minimap, grid-snap, Tidy), factoring Canvas's full keydown onto the active graph, drill-in
  **history routing** (row/socket/label edits still push to MAIN history, so drill-in Ctrl+Z
  doesn't undo them), lasso parity, and D2 proper (reroute the real toolbar — author-present).

### SESSION DIGEST (2026-07-06 evening — command palette overhaul + D-1 goal-seek)
Local dev server; commit freely, no pushes. tsc + full vitest (2271) green.
- **Command palette overhaul:** extracted a shared `menuModel.ts` (one source for the
  menu bar AND the palette — every menu action is a palette command, incl. Document
  properties, which also moved to the File menu); dropped the per-node catalog entries
  (Add node… + the `A` hotkey cover browsing); added an **always-on docked palette**
  setting (click-through scrim, focus→suggestions, Enter/Esc keep it docked); moved the
  align/distribute pill to the top-centre (clears the header at 76px); a persisted
  `commandRecents` MRU feeds the **3 most-recent actions** to the head of the no-query
  suggestions (recorded from palette OR menu bar). Chips now carry their TYPE colour
  (lists/tables gold, frames/cubes violet, charts green) via a `--chip-accent` modifier,
  everywhere incl. Reports. Equinox palette added (all-gray monochrome). Cube glyph seams
  derive from the fill (color-mix) not a hardcoded violet.
- **D-1 Goal-seek run mode (`composite.ts`):** a new `CompositeRunMode` "goal-seek" —
  drives one exposed input until a chosen output hits a target. `runGoalSeek` uses `runPass`
  as the objective (`{[inputPortId]: x}` → read `outputPortId`), solved by a secant-then-
  bracketed-bisection solver (`solveGoalSeek`); `#CONV!` on non-convergence goes to the
  target output + `goalSeekResult`. Config `{inputPortId, outputPortId, target}` persists via
  the `extractInit` deep-copy branch (rides the node line's "rest" catch-all — no textForm
  change). UI: a `GoalSeekEditor` on the card ("Set X To v By changing Y" + solution line),
  auto-inits on mode select. `composite.test.ts` covers convergence/negative/#CONV!/round-
  trip/port-removal. Seed: `composite-workbench` gains a **break-even finder** (profit =
  units×$25 − $500 → solves Units = 20). NOTE: Monte Carlo run mode still blocked on bundle
  12's distribution rep; simulation-inner-display + aliasing UI (D-2/D-3) still open.

### SESSION DIGEST (2026-07-06 pm — autonomous: C-4 XLOOKUP · C-2 Input Switcher · F-1 custom palette · F-2 doc properties)
Local dev server (HMR); commit freely, no pushes. Every commit tsc + full vitest green (→2263).
Five bundles + one incidental persistence bugfix; NOT pushed. Sections newest-first.

**F-2 Document Properties window (v1) — `docMetaStore.ts` + `components/DocumentProperties.tsx`.**
Opened from the DocumentTitle menu ("Document properties…"). Reuses the Settings modal
chrome. Fields: **Title** (the documentStore name, via renameCurrent), **Author** + **Tags**
(new `docMetaStore` → `SavedGraph.meta {author?, tags?}`, carried in the text-form sidecar,
applied on load in `loadGraph`, captured on edit via `documentStore.captureCurrent()`), and
**Color palette (this document)** — a base dropdown ("Follow app" | built-in names) over
`paletteStore.setDocPalette` (preserves any hand-authored overrides; retints live + rebuilds
group dots + captures). Commit-on-Enter/blur text rows; CloseIcon (not a text ×). Tests:
`docMeta.test.ts` (store trim/serialize + sidecar round-trip). DEFERRED (backlog): per-slot
doc palette OVERRIDES editor + document-level FC defaults (a format-pipeline integration).
**Persistence bug FIXED (surfaced by F-2).** `serializeGraph` round-trips through the text
form, which carried `palette`/`meta`/etc. but NOT `comments`/`reportPalette` — both are set
in `buildRawSavedGraph` yet silently dropped by the round-trip. Since the per-doc autosave
uses `serializeGraph` (via `captureCurrent`), node-anchored **comments** (shipped 2026-07-03)
and the report/export palette were being LOST across a save / doc-switch. Added both to the
text-form sidecar (comments name-address their `nodeId` like pins); `docMeta.test.ts` locks
the round-trip.

**F-1 custom palette editor (`palette.ts` + `components/PaletteEditor.tsx`).** A user-authored
full 12-slot palette, selectable as the app base ("Custom" in the dropdown), edited in a
dedicated modal.
- Model: `_appBase` is now `PaletteChoice = PaletteName | "Custom"`; `_customMap` persists
  separately (`solenoid.palette.custom`), seeds from Default. `recompute`/`recomputeReport`
  route through `baseMapFor` (Custom → the user map). Store API: `activeBase()`/`setActiveBase`
  accept "Custom"; `customMap()`, `loadCustomTemplate(name)`, **`setCustomMap(map)`** (commit a
  whole map at once — the editor's Save), `paletteEditorPanel` (modal open flag). Doc/report
  palettes stay built-in-name-only (a doc pin still wins over app Custom). `initPalette` loads both.
- UI (`PaletteEditorModal`, mounted at App level, opened from Settings' **"Edit custom…"** button):
  a real MODAL you enter/exit + Save/Cancel — NOT the old always-inline editor. **Edits live in a
  local DRAFT** that previews ONLY in the sample; the whole app retints ONCE on Save (`setCustomMap`
  + `setActiveBase("Custom")`), never live on every color-drag tick (the reported lag — the old
  onChange→setCustomSlot retinted the whole app per tick). 12 role-labelled color wells
  (Number/Text/Date/…), Load-template buttons, and a sample built from the **REAL** node/group/note
  chrome (`.solenoid-node`/`--grouped` in a `.solenoid-group`, a `.solenoid-note`) colored from the
  draft via the same inline vars the real components set — not a hand-drawn mockup. Only the 12 base
  slots edit; array/matrix stay derived siblings (DESIGN.md Sibling Rule). `palette.test.ts` covers it.
  EYEBALL: Settings → Appearance → **Edit custom…** → edit a well (canvas does NOT retint mid-edit,
  only the sample) → **Save** applies to the app; Cancel discards. Load a template to start from one.

**C-2 Input Switcher upgrade (`CableSwitchNode`).** Two features:
- **Editable per-slot titles** — each input row has a title field (draft-commit via
  `useDraftCommit`), so slots read as named choices; `titleFor(key)` falls back to
  "Input N". Rendered by a new `SwitchOptionRow` sub-component so the per-row title hook
  count stays stable as rows add/remove.
- **Many mode** — a One/Many `SegToggle`. In Many the numbered route buttons become
  checkboxes (`selectedKeys`); the output is a **Cube** collecting the checked inputs — a
  `name` column (titles) + a `value` column (each wired value WHOLE), one row per slot, in
  slot order. Nothing checked → null. `SwitchValue` already renders a cube (CubeChip).
- Persistence: `titles` (object) + `selectedKeys` (array) added to `copyPaste.ts` (deep-copy,
  live-keys-only to keep the text form byte-identical); `multiSelect` was already whitelisted.
  `removeValueInput` drops the slot's title + selection. Seed: `power-features` — `switch-1`
  gained Plan A/Plan B titles, and a new **Many-mode `switch-many`** collects Plan A/B/C into
  a cube (eyeball: the card shows the collected cube chip). `cableSwitch.test.ts` covers it.

**C-4 unified XLOOKUP merge (`frame.ts` `XLookupNode`).**
- **REAL merge, not a wire-driven socket swap.** The author vetoed
  inventing a node whose sockets change based on what's wired in (the Explore-scoped
  duck-typing plan). The legitimate merge came from the author's OWN 2026-07-06 standing
  rule: XLOOKUP's two arrays must be ALIGNED, and aligned columns belong in a FRAME, not
  two loose sockets. So the frame/cube lookup IS the universal XLOOKUP; the two-loose-lists
  `XLookupNode` (list.ts) was DELETED — aligned lists reach XLOOKUP via Build Frame.
- **What shipped:** `FrameLookupNode` (frame.ts) renamed → `XLookupNode`, fixed sockets
  (source, Lookup, In column, Return, If not found). Added: **`searchMode`** (first /
  last — Excel search_mode 1/-1, which duplicate wins; binary 2/-2 omitted — on a
  materialized column it finds the same row linearly) and **Return = `*`** → the whole
  matched row (single-row Frame, or single-row Cube with nested cells intact).
- **Verb refactor (`frameVerbs.ts`):** extracted `lookupFrameRowIndex` / `lookupCubeRowIndex`
  (shared by cell- and whole-row-return so both agree on the row); `lookupFrameCell` /
  `lookupCubeCell` are now thin wrappers (existing signatures + default first → frameLookup.test
  stays green); added `frameRowAt` (via `reorderRows`) / `cubeRowAt` (via `cubeFromColumns`);
  moved `asLookupSource` here.
- **Footprint:** deleted `nodes/lookup.ts` + `components/XLookupNode.tsx`; component merged into
  FrameNodes' `XLookupComponent` (match + search SegToggles); one catalog entry (the "Find"
  XLOOKUP, retyped, accent frame, `new XLookupNode()`; frame-table `frame-lookup` entry removed);
  registry/kind/barrels repointed; seed `asof-join-lookup.json` type → XLookupNode; errorValue.test
  XLOOKUP block rewritten to the frame form; frameLookup.test gained search-last + whole-row cases.
- **Author EYEBALL:** open the **As-Of Join & Lookup** seed — the lookup card is now titled
  XLOOKUP with BOTH a match (Exact/≤/≥) and a search (First/Last) toggle; it still resolves the
  35-qty row to discount **0.05** (≤ next-smaller tier). Try typing `*` in its Return field →
  the whole matched tier row comes out (a 1-row frame). Add-menu: "XLOOKUP" under Find (violet
  frame accent); the old "Frame Lookup" entry is gone.
- **Source socket = `cube`, not `any` (author call, follow-up).** The source uses the `cube`
  socket (lattice supremum → accepts Frame + Cube, rejects lambda/chart a bare `any` allowed,
  shows the cube glyph). Its coercion is BYPASSED via a new `RAW_CONTAINER_INPUTS`
  (`coerceInputs.ts`) so a wired Frame reaches `data()` UNCOERCED — a plain `cube` socket would
  `toCube()` it and strip typed date/logical columns (ISO-date approximate lookups would break).
  Runtime guard rejects a non-tabular source (scalar / bare 1-D list) with `#VALUE!` — cube (like
  any) accepts lower-rank widening at connect-time, so the value-layer guard is where "needs a
  table" is enforced. `anytable` ("Any 2-D") was NOT viable — it rejects both Frame and Cube.
  Inputs left as `string`: Lookup + If-not-found keep the inline text box (type-aware matching
  covers every column type); wiring a computed key = Cast-to-text (author OK).
- **Per-input coercion policy generalized (`node.rawInputs`).** The ad-hoc
  `RAW_CONTAINER_INPUTS` class-name map is retired: a node now declares
  `rawInputs: ReadonlySet<string>` and `coerceInputs` passes those inputs through
  UNCOERCED. The principle (author-aligned): ACCEPTANCE is socket/lattice-driven, but
  COERCION is a NODE decision — default "widen to the declared shape" (95% of nodes),
  `rawInputs` opt-out for a polymorphic node that branches on the runtime shape (XLOOKUP's
  `frame`; any future multi-dimensional INDEX/reshaper). Backlogged the deeper fix: a typed
  `CubeColumn` making frame→cube lossless (would let the bypass retire entirely).
- **Backlog line deleted** (delete-on-done). NOT pushed (local session).

### SESSION DIGEST (2026-07-06 — author-present, chart-node polish + standing rules)
Local dev server (HMR); commit freely, no pushes. Every commit tsc + full vitest (2241) green.
- **STANDING DESIGN RULE (author 2026-07-06): a node that needs several lists/columns
  ALIGNED for its purpose takes a 2-D input (frame/table), NOT parallel list sockets the
  user has to line up by hand.** Don't make the user build a frame, split it into columns,
  and re-wire each column in — take the frame. Generalizes the Sankey/Treemap change below.
  Apply to any new/edited node with position-aligned inputs.
- **Sankey/Treemap take one frame** (edge table From/To/Value; label/value table), read
  positionally, replacing the old parallel list sockets. Chart-showcase seed rewired to a
  Frame Input per figure. Also: Treemap/Sankey/Histogram get the wide (240) card (they draw
  a fixed ~218px plot but their list sockets don't trip the frame/table width heuristic);
  Sankey label side + full-width (dropped a dead 70px right gutter).
- **Chart shows only the op's data socket** — Values (1-D) vs Series (2-D matrix), never
  both; switching op FAMILIES drops the now-dead cable. Output socket now centers on the
  chart figure (a `.solenoid-node__figure` measurement hook, matched first in NodeCard's
  out-socket-top query) so input+output align on pie/radar/etc.
- **No more `[object Object]`:** `describeValueKind` (`valueKindLabel.ts`) labels any
  object-valued kind (chart/frame/cube/diagram/image/lambda); wired as the safety net in
  `ValueDisplay` (the universal fallback → protects every surface), the collapsed-group
  readout, and the Input Switch (which now renders by kind like Display). Chart popup can
  now render a full ChartValue via ChartFigure (chip foundation).
- **Collapse + `[Chart]` chip:** Chart/Treemap/Sankey/Histogram are collapsible — collapsed
  they show a hero box with a right-aligned `[Chart]` chip (`ChartChip`, opens the popup);
  the Display does the same for a wired chart, and the collapsed-group readout shows the chip.
  NodeCard centers the output socket on the first VISIBLE box (so a hidden collapsed figure is
  skipped). **Sparkline minifies to a HEADERLESS SQUARE** (`squareCollapse` prop → NodeShell/
  NodeCard; chevron fades in on hover, spark is `pointer-events:none` so it's inert + the
  double-click-to-expand reaches the card).
- **Input Switch:** renders rich values by kind (chart/cube as compact chips so they don't
  overflow the narrow card, in a display-value box so the collapsed stadium pill centers on
  them); collapsed, its option rows fold into the shared input pill.
- **List Input** rows now take CSV numeric lists (numlist sockets, CSV text via `stringLiterals`)
  and concatenate for the output; 8 seeds migrated `literals`→`stringLiterals`. Surfaced a latent
  bug: a list-node `#CIRC!` loop member showed a stale list — the seeding now sets `cachedList`
  too (was `cachedResult`/`cachedValue` only).
- **Display resize (author flagged FRAGILE — done carefully, incrementally):** ONE universal
  grip on the node BODY (Group's icon/style), **Display-only** (`nodeResizable` narrowed).
  `--box-h` drives the body height; the last body child fills+scrolls, so ANY content type
  resizes without per-type wiring. Cables update LIVE (dropped the drag-time `area.update`
  suppression — the grip drags off window listeners, not pointer capture). **Charts scale to
  fill** (`MeasuredChart`, gated on the Display being sized so measuring a content-driven card
  can't oscillate; the Sankey oscillation was exactly that); **Mermaid fills** (override its
  inline max-width when sized); clamps to a **per-content-type min** (chart 230×150, diagram
  200×120, frame 200×90, else global floor — published to `nodeSizeStore`); the text/scalar
  360px auto-grow cap lifts when sized.
- **Sparkline reworked (not a pass-through anymore):** ops are line/column/**win-loss** (area
  dropped; win-loss = a column chart of the signs); output swaps the numlist pass-through for
  the `chart` value socket (this app passes through only Display + the FC). Retired ops
  normalize on load (area→line, bar→column).
- Small: socket legend clears the footer when the minimap hides; collapsed-group edge sockets
  align with their readout rows (the summary's flex `gap` wasn't in `pillY`).
- **Late stretch (colour system + polish):** `prefers-reduced-motion` snaps the load reveal
  (reuses the doc-switch instant path); dropped the now-dead `nodeSizeStore` dragging flag.
  **Colour consolidation:** the Table (numeric-matrix) socket moved off `vermilion` → `amber`
  (distinct orange from gold/Number in default/solarized; coincides only in the colourblind
  set — no free CVD hue), freeing `vermilion` to be the semantic ERROR red — `appTheme` now
  writes `--sol-error` from the `vermilion` slot so a custom palette retints every error
  surface (default value unchanged). Reordered `COLOR_PALETTE` (the SWATCH PICKER only — chart
  series use a separate `SERIES_SLOTS`): gold-led, gold/gray + green/red column pairs, rest
  alternating. **Sparkline win/loss colours by sign** (up = palette green, down = the palette
  error red) — resolved to hex (recharts fills are SVG attrs), reaching the node AND the expand
  popup; still plain in a Report/Display embed (would need `winloss` as a first-class op — a
  deliberate small follow-up, author OK). Minified sparkline made slightly rectangular + tighter
  vertical padding so the spark fills its height and clears the edge sockets.
- OPEN (parked): **#7 Conduits sometimes unselectable/unmovable except via the Navigator** —
  intermittent, no repro yet; author suspects it's tied to getting group membership (likely a
  z-order / hit-area or membership-sync issue). **FC advanced text options** (alignment /
  markdown-vs-source / mono) logged to backlog for a design-first FC pass.

### DAYTIME SESSION DIGEST (2026-07-05, ~13:00 onward — author review, decisions, FC v1.1-α)
The author reviewed the overnight/extended work (eyeball list passed) and drove decisions
live. Every commit verified tsc + full vitest (now 2184 green); tree clean, nothing pushed.
- **Dev env repair:** node_modules had been gutted by a disk-cache cleanup (app served a
  black screen off a stale Vite) — reinstalled, server recycled. A wiped Rust `target/`
  just rebuilds on the next cargo run.
- **Popup crosshair → "Go to source"** (author catch: flying to the HOST is a no-op — you
  just clicked its chip): `resolveValueOrigin` (`unitFlow.ts`) walks upstream through FCs,
  pure passthroughs, and data-aware selectors (actually-chosen branch) to the producing
  node; stops at transforms (Convert included), indeterminate/ambiguous selectors.
  `2457396`.
- **Image bundling — decision (b), amended:** a plain shared `images/` folder beside the
  saved doc, ORIGINAL filenames (`name (2).ext` only on a true collision, content-hash
  last resort, identical bytes reuse the file). `imageAssets.ts`: bundle on save —
  `saveToDisk` resolves the destination FIRST (`pickSaveGraphPath`) so the JSON written
  after carries the assetPaths; the Image component self-hydrates `dataUrl` on mount
  (covers load/paste/restore with no per-load-path hook). New Tauri fs grants scoped to
  `$HOME/**/images{,/*}` (not dialog-picked → static grants required). Desktop-only; web
  stays session-only. Needs a DESKTOP build to exercise. `fb81d23`.
- **No-century-guessing now covers named-month dates** (author bug report: `20-Mar-26`
  coerced to 2026 in a Frame Input): `parseDateToSerial` requires a 4-digit year run in
  ANY form — bare `Mar 20` (JS guessed 2001!) also rejected; one general guard replaced
  the two numeric-form regexes. `736382c`.
- **FC v1.1-α COMPLETE** (WS-A minus A4; see `docs/format-model.md` + the archived v1.1 plan):
  - **A1 — function model.** Spec `docs/format-model.md` (4-stage pipeline, family table,
    ONE precision×style rule) + `formatModel.ts` as the truth table in code, exhaustively
    machine-checked over the whole SocketDataType union (a new socket type won't compile
    until it declares its family). Scientific honors the precision row (was hardcoded
    `toExponential(3)`); logical sockets gained **show-as** (TRUE/FALSE · 1/0 · Yes/No ·
    ✓/✗, honored by value box/clipboard/inspector/Report refs); complex = reduced style
    list; structural sockets a quiet dash. `c9ffd1f` `f59761c`.
  - **A2 — redesign.** Flow arrows re-audited against the v0.9 semantics (the format
    row's backward-only claim was stale — the whole annotation rides forward): one
    three-state language, `← →` authored · `→ →` inherited · `← ←` Convert-dictated.
    SegToggle unified (the FC's private seg CSS deleted; pixi snapshot selector updated).
    Symmetric arrow-or-spacer gutters align all rows. The chip wears the node header's
    accent ring (a body tint was tried and REJECTED). **Advanced tier** behind a small
    mid-chip expander (persisted `advancedOpen`): 1,000-separator toggle, negative styles
    (paren wraps OUTSIDE the unit, accounting style `($1.2M)`; red = render-layer color
    via `annotationRendersNegativeRed` — first cut silently no-op'd by referencing a
    nonexistent `--danger` var; the real token is `--sol-error`), K/M/B scale. Formats
    cluster ABOVE the unit row (formats re-format freely downstream, units lock — never
    interleave the two). `6fa5874` `82eb80b` `9f24060`.
  - **Light-mode state ramp** (author direction): selection ring nerfed 32%→20% toward
    black, hover made a real step (12%), header/body divider accent-dark. Dark untouched.
    `48b60ac`.
  - **A3 — movement audit.** Most ops were ALREADY correct (the plan's "uneven" claim was
    stale): drag/group-move/tidy/autofit/expand-push/tidy-grow/restore/de-overlap/
    standoff-settle/cleanup all carry docked FCs (`translatePushed`), and the push world
    reserves an output-FC footprint. Two REAL gaps fixed: **collapse hid MEMBERS only**
    (an FC docked to a member but never absorbed floated over the collapsed box → docked
    satellites are now VIRTUAL members: hiding, the Display→FC hop, pills, expand settle;
    `groupCollapse.test.ts`), and the **bug-lane FC-mis-dock** (`findDockTarget` compared
    SCREEN px against a fixed 34px radius — zoomed out that spans a huge canvas area; now
    canvas units, `dist ÷ zoom`, zoom-1 unchanged). `6f53e6a`.
- **Header/body border seam: UNSOLVED, parked** — see the standing entry below; two
  cheats tried and reverted same-day, both eliminated paths documented there.
- **Decisions:** D2 (composite toolbar reroute) and D4 (conditional formatting) DEFERRED
  by the author. Next in WS-A when picked up: A4 units-by-dimensionality (v1.1-β,
  design-the-representation-first).
- **Decision walk + the autonomous plan (~17:00):** the author ruled EVERY open
  input item (see backlog for per-item stamps). Headlines: A4 units IN but
  author-present later ("big boy, together"); D2 reroute approved, author-present
  later; D4/seam stay parked; deferred pile collapsed to #23+#35 (rest OUT);
  #48/#54 became an ultra-minimal library-folder opener; COMPLETE RECHARTS is the
  new viz goal ("grab everything recharts has"); AND/OR Filter IN; Go-To-Special
  OUT; Obsidian vault trio IN (folder setting + read-only Import Note + Write
  Note sink); Finance connection IN reshaped (user-supplied keys, FRED, keyless
  Stooq); grid + collision avoidance deferred again. **`docs/build-plan.md`** is
  the ratified autonomous plan (Tiers A–F, per-bundle footprints/seeds/sequencing);
  the coordination board is live with staged queues (A2 → C-1 Recharts, A3 →
  commit duty + Tier A; Lead → Tier B Rust). STANDING ORDER: anything visual
  ships/extends a SEED (cleanup pass last-minute pre-release). Author note taken:
  the overnight "backlog exhausted" call missed the decided-unbuilt queue buried
  in the old ledger — the open-only backlog + this plan exist to kill that
  failure mode.
- **Parity-doc mining (follow-up ask):** swept toolbar-supplementals + the archived
  pain-points for verdicts that never became queue items. New backlog entries: a
  multi-predicate AND/OR Filter (pain-points §1/§14), pie in the Chart node, "Go To
  Special" select-all-errors chrome, grid-dots visibility toggle, doc-level FC
  defaults (into the Document Properties window item) — the first three flagged
  "rule in/out". Everything else in both docs verified shipped/queued/ruled;
  toolbar-supplementals' closing sections reconciled (its 4 open questions are all
  answered now), pain-points stays archived research.
- **Doc consolidation (author-mandated, aggressive):** dev-notes → digests-only (75
  per-item entries swept to archive); **backlog rewritten to OPEN ITEMS ONLY** (1823 →
  ~170 lines; new standing policy: a landed item's line is DELETED, git + digests are
  the record); 8 finished docs moved to `docs/archive/` (scope-features, v1.0-plan,
  v1.0-audit, performance-hardening, future-directions, strategy-threads,
  isolate-pin-multiview-scoping, node-arity-audit) with all live references repointed;
  CLAUDE.md's doc-maintenance section rewritten to the new policy.


### EVENING AUTONOMOUS RUN DIGEST (2026-07-05, ~18:00 onward — 3-agent crew on `docs/build-plan.md`)
Running digest — agents EXTEND this as bundles land. Every commit tsc + full vitest
green (cargo where Rust moved); commits FIFO through A3. Pushed once mid-run on a
direct author order (`f926fa6..aa5ab34`).
- **Tier A (A3):** locale + cable-shape persist + grid-dots toggle (`d630a43`);
  library-folder opener (`fa6080b`); minimap 3-way position (`c5fc842`); the a11y
  verify-and-finish batch — socket titles, reduced motion, focus traps on the 3 real
  modals, Switch aria-label, legend persistence (`c556b84`).
- **Tier B (A1):** B-1(a) Rust row-key = serde_json tagged tuples, byte-identical to
  the JS oracle (`1efa87d`); B-1(b) Infinity first-class in frames — `__nf` wire
  sentinel both directions, `{"__err":code}` upload contract, NaN present-but-dirty,
  aggregate guard in both backends (`aa2a623`); B-4a compileFormula codegen retired
  (`aa5ab34`); B-4b TEXT-family divergence sweep (text fns coerce numbers via
  numberToText; TEXT "@"/General/zero-pad/scientific patched; VALUE strict; NUMBERVALUE
  owned; DOLLAR accounting parens) + Group By totals (totalDepth → no-colFields pivot)
  — queued; B-2 AND/OR multi-predicate Filter COMPLETE — the filterMulti verb in
  both engines (fused lazy when all-comparison; text predicates collect + mask
  with zero-drift shared exprs), then the Filter Rows node rebuilt as extensible
  condition rows (per-row op + Aa match-case, AND/OR SegToggle at 2+ rows,
  pair-row undo, valueKeys/condConfig persistence); B-3 native CSV date
  inference (engine_read_csv applies the JS unambiguous-ISO gate post-read;
  zone-less = wall-clock as UTC; cargo 68/68). **TIER B COMPLETE.**
- **Tier C (A2):** C-1 COMPLETE RECHARTS — op surface (pie/scatter/radar/radial/
  funnel) + Histogram (`09bc120`); KPI/Bullet/Treemap/Sankey payload figures + shared
  ChartFigure (`7315441`); DateRange dual-date control (`5bd7105`); finale (composed +
  bubble multi-series + `chart-showcase.json`) queued. C-3 popup ⋯ overflow scoped.
- **Author EYEBALL list (accumulating — check on the live app):**
  - `table-verbs` seed: the Group By card has a second select (totals); the
    "Group By Rep → SUM(Amount)" node now shows a **Grand Total** row (555).
  - `chart-showcase` seed (once the finale commits): every new chart type renders.
  - Minimap position setting (Bottom / Top / Hide) in Settings.
  - Desktop only: a frame holding Infinity shows `∞`-ish cells (not blanks) — the
    B-1b sentinel; `formatScalar`'s ∞ glyph itself is still the open [decided] detail.
  - Desktop only: importing a CSV with an ISO date column (`2026-03-15`) now
    yields a real DATE column (renders `15-Mar-2026`), not text — B-3.
  - `table-verbs` seed: Filter Rows is now CONDITION ROWS — the original filter
    (one condition, no toggle visible) plus a new "Region = N OR Amount > 150"
    node (4 rows kept; AND/OR SegToggle appears at 2+ conditions; per-condition
    Aa match-case toggle on text ops; + Add condition).

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

### EXTENDED SESSION DIGEST (2026-07-05, ~08:40 onward — "keep going" + a 20-min loop)
Continuation of the block below; per-item entries in the archive. Everything verified
per commit (tsc + full vitest, now 2124; cargo 46/46 where Rust moved).
- **Built:** cube-child Nest Join (A2 — nest a pre-built hierarchy whole); popup
  "Go to node"; per-doc autosave keys landed just before this block.
- **Undo-correctness arc (audit-driven):** extensible-row add/remove is undoable
  (`b0066df` — the generic same-Input-object/key-order helpers); Note frontmatter key
  removal undo-coherent (A2 — confirmed WORSE than flagged: body edits pushed no
  history at all, the zombie cable never self-healed); CableSwitch lane restored on
  undo; F9 exempted from the presenter/drill-in keyboard gates (was a manual-mode
  dead end with all fallback chrome hidden).
- **New standing guards:** textForm reader fuzz (800 mutants — clean rejection or
  round-trip closure); ELK Tidy integration test (A2 — elkjs under vitest, the
  no-overlap invariant through the real arrange→standoff→separate chain).
- **Hygiene/docs:** guarded clipboard writes (non-secure contexts); 6 Rust dead-code
  warnings → 0 (parity-only verbs `#[cfg(test)]`-gated); architecture.md file-map
  fully reconciled (A3, incl. errorValue/textForm/documentStore gaps); dev-notes
  archival sweep (A3 — live window = 2026-07-01+); subsystem-invariants gained the
  per-doc-autosave + drill-in-mount sections; backlog verification sweep (A2 — ~35
  open items checked against code, 1 rot catch flipped).
- **Standby state (superseded by the daytime session above):** the autonomously-
  actionable backlog was EXHAUSTED; the queued author decisions were then resolved
  same-day — image bundling BUILT, FC v1.1-α BUILT, toolbar reroute + conditional
  formatting DEFERRED.

### OVERNIGHT SESSION SUMMARY (2026-07-05, ~03:30–08:30 — 3-agent autonomous crew)
22 commits on develop (NOT pushed — local session). Every commit: tsc clean + full
vitest green (2044 → 2110 tests, +67); cargo 46/46; production build healthy (main
chunk ~2.0 MB after the ELK split); desktop release exe builds. All 26 seeds swept
crash-free through the headless runner. Detailed entries for each item are in the
archive; per-item "author eyeball" notes are inline there (the list passed author
review in the daytime session).

**Features built (all previously author-approved):**
- Frame Filter case-insensitive text matching + "Match case" (the D12 build) — `9ffc8e0`
- Coalesce/Fill full N-ary (extensible Else rows) — `540bba0`
- Per-doc autosave keys (per-doc two-slot pairs + light index) — `ce94761`
- Align/distribute selection action bar (A2) — `3172bc8` · ELK lazy-loaded, ~1.5 MB out
  of the main chunk (A2) — `4635e54`
- Cube-cell XLOOKUP on Frame Lookup (A2) — `5d4eac6` · drill-in dropped-cable notice
  (A2) — `d06517d` · quick-wire memoization (A2) — `1a10863`
- Popup "Go to node" — `4e75b68` · cargo-audit CI workflow (A3) — `7c069a7`

**Audit program (4 review agents + Lead's own passes; every confirmed finding fixed
same-night):** sketch bookkeeping leak `75c62c9`; round 2 `3141e10` (presenter left all
canvas shortcuts live; docked-Report squeeze orphaned on delete/doc-switch; Expect
blind to frames; model fuzz no-op in manual mode + fired real alerts; Problems relapse
suppressed forever; textForm broke SAVING on a frontmatter key with a space); round 3
`ce22c73` (composite drill-in leaked LIVE React roots — auto-refresh intervals ran
forever after close/delete; scrub-unmount cursor lock; stale add-menu on doc switch;
semantic zoom invisible in the canvas renderer; Write double-click race;
connectionStore.forget never wired) + the add-menu refinement `c22a6a3` (close on doc-ID
change only — autosave's notify was yanking open menus); Reconcile honesty fixes (A2)
`94bcbd9` (skipped-key rows surfaced; PVM excludes errored cells).

**New standing guards (A2):** `layoutInvariants.test.ts` (~1650 seeded fixtures — the
no-overlaps rule is now machine-checked; NO violation found) `11397dd`;
`formulaDivergence.test.ts` (the node-vs-Formula.js sweep is now a durable CI tripwire;
no new drift) `253727a`.

**Author decisions (resolved in the daytime session):** image bundling → BUILT (option
b, amended); composite toolbar-reroute → DEFERRED (architecture write-up in the
archived drill-in entry). Eyeball list passed review.

---

## Older entries archived

Per-item entries live in [`archive/dev-notes-history.md`](archive/dev-notes-history.md).
Sweeps: through 2026-06-18 (on 06-21) · 2026-06-19–06-30 (on 07-05) · the
2026-07-01–07-05 per-item entries (on 07-05, the session digests stayed here).
