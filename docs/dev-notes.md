# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### FINDING (2026-08-24 — should we virtualize the table/cube popups? — author's call)
Decider for the backlog "Virtualize the table/cube popups" item. Measured, not built.

TablePopup already caps at `MAX_VISIBLE_ROWS = 1000` — a 50k-row frame is sorted then sliced
to 1000, so 1000 rows IS the worst case the popup ever renders. But **every cell is an
`<input>`** — read-only popups render `<input readOnly>`, not plain text (TablePopup.tsx ~942)
— and **cells are not memoized**, so a keystroke's `setGrid` re-renders all 1000×N of them.

DOM build + layout cost, median of 7, Edge headless on the real dev page (app CSS applied),
via `scripts/table-popup-probe.mjs`. `build` = time-to-open floor; `rebuild` = current
non-memoized keystroke (whole tbody rebuilt); `retouch` = value-only update (the floor a
per-cell memo would reach). These are DOM-only — React element-creation/reconciliation is
ON TOP, so the real keystroke is worse than `rebuild`, never better.

| cols | 1000-row cells | open (`<input>`) | open (plain text) | keystroke (current) |
|-----:|---------------:|-----------------:|------------------:|--------------------:|
|   3  |          3,000 |          ~38 ms  |          ~19 ms   |            ~43 ms   |
|  10  |         10,000 |         ~110 ms  |          ~46 ms   |           ~122 ms   |
|  30  |         30,000 |         ~310 ms  |         ~125 ms   |           ~350 ms   |

Reading:
- **The `<input>` IS the cost: ~2.5× plain text**, flat across column counts. Read-only
  `<input readOnly>` costs the same as an editable one (measured within noise) — read-only
  popups pay the full input tax for nothing.
- **Cost is linear in cells (rows×cols).** Narrow (3-col) frames are fine everywhere (~40 ms).
  Wide frames are the problem: at 30 cols a keystroke drops ~350 ms of main-thread work
  per character (+ React on top) — clearly janky; 10 cols (~120 ms) is already noticeable.

Two independent wins:
1. **Virtualize rows** (render only the ~20-30 visible rows, not 1000). The general fix —
   helps open AND keystroke, editable and read-only, and cuts the numbers ~30× (sub-15 ms
   even at 30 cols). Biggest lever; also the most work (sort/slice/scroll interplay, the
   sticky header, the measured column widths at ~406). **STILL OPEN — author's call** (Path A
   window-it-ourselves vs Path B react-window grid; see the backlog item).
2. **Render read-only cells as plain text**, not `<input readOnly>`. **LANDED 2026-08-24.**
   A cell with `canEdit` false (read-only popups + computed cells) renders a plain-text
   `<div class="table-popup__input table-popup__input--ro">` — reuses the input's font/align/
   error/nan styling, stays keyboard-navigable (tabIndex −1 + data-vi/data-c, same arrow mover),
   editable cells unchanged. Before/after (ro-div variant, same probe): **~50% off every
   read-only popup** — 30-col open 260→132 ms, keystroke rebuild 290→141 ms; 10-col 91→45 ms;
   3-col 34→17 ms. Doesn't touch editable popups (still `<input>`). Note: read-only TEXT columns
   now auto-size to their visible content instead of clipping at 120px (numeric columns are
   pre-sized by `colMinWidths`, so they're pixel-identical) — an eyeball item.

Numbers reproduce with `node scripts/table-popup-probe.mjs` (dev server must be up; `input-ro`
= old, `ro-div` = shipped). Cube popup shares the grid render path, so it inherits both the
profile and win (2).

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

### SESSION DIGEST (2026-08-24b — parallel plan execution from docs/plans/)

- **Series node absorbs Geometric / Fibonacci / Repeat (no-duplicate-nodes).** All three were
  standalone list-generator nodes doing what the Series op-selector already does; folded in as
  ops (`SERIES_OP_META` + `SERIES_SPECS` rows, `data()` branches). The SeriesComponent is generic
  over the op meta, so the selector + the onePrunePath (`keysDroppedBySwitch`→`dropInputCables`
  before `setOp`) needed no change. Formula parity holds — REPEAT/GEOMETRIC/FIBONACCI already
  existed with matching names (label despaces to the fx name, no `fx` override). Repeat/Geometric
  gained the sequence op's `#OVERFLOW!` MAX_GENERATED guard (the old nodes were unguarded; the
  formulas already capped). Deleted the 3 classes + 3 one-line component files; catalog leaves
  keep their `list-repeat/geometric/fibonacci` types (nodeExcel keys). RandArray stays separate.
  Old saves load as Placeholder. Full suite green. No backlog line existed to delete.
- **Popup read-only cells → plain text (the cheap popup-perf win).** TablePopup cells with
  `canEdit` false (read-only popups + computed cells) render a `<div class="table-popup__input
  table-popup__input--ro">` instead of `<input readOnly>`; editable cells unchanged. Keyboard
  nav preserved (tabIndex −1 + data-vi/data-c; `focusGridCell` generalized off `input[...]`).
  ~50% off every read-only popup (probe, 30-col open 260→132 ms). Read-only text columns now
  auto-size to content (numeric pre-sized by colMinWidths — identical); eyeball item. See the
  FINDING above; virtualization for wide editable frames stays open.
- **HYPOT de-duplicated (no-duplicate-nodes rule).** The standalone `HypotenuseNode` (class in
  scalar.ts, component, registry, the geometry/timesavers pack leaf) duplicated TwoInputMath's
  `hypot` op (both √(A²+B²)). Deleted the node; `HYPOTENUSE_ENTRY` now `type: "twomath-hypot"`,
  `create: () => new TwoInputMathNode({ op: "hypot" })`, label/description from `TWO_INPUT_MATH_OP_META`
  (keywords keep "hypotenuse/pythagoras" discoverable). No alias — an old "Hypotenuse" save loads as a
  Placeholder. No seed used it (the "Hypotenuse c" matches were labels). formulaNodeParity +
  catalogRegistry + seeds + uiCopy green.
- **C5 correlated outputs → one frame (plan 14, the five outside stats.ts).** Index-aligned
  parallel list outputs now leave each node as ONE `frameOut`, per the author's "Node design" rule.
  Point Plotter x/y → `result` Points frame (X, Y). Curve values/xs → `result` Curve frame (X first,
  Value). Find Peaks positions/values → `result` Peaks frame (Position, Height). Outliers flags/clean
  → `result` Result frame (Value typed by the input's element family via `inferColumn`, logical
  Outlier). Group Lists keys/values → `result` Groups frame (Key adopts the keys' family, numeric
  Value); its `keys` passthrough + adoptive output deleted (dropped from `trueAnyAdopt`). Each: one
  output socket (old keys gone, pre-alpha no-alias), component swapped to `FrameDisplay`, a wired blank
  datum → null frame, the matching FORMULA (FINDPEAKS/ISOUTLIER/GROUPBY) unchanged, catalog copy names
  the columns. HELD for the author (change nothing, per the plan): the three scalar-broadcast nodes IM
  Unpack, Triangle Solver, Quadratic Roots (a one-row frame for a scalar input is the wrong shape).
  Agent 4 owns the stats.ts pair (Decompose landed a9035642, Forecast ETS in flight) + the scratch-seed
  rewire (99d409da). The plan file deletes when all seven land.
- **elkjs 0.8.2 → 0.12.0; Tidy width cap rebuilt on layerUnzipping.** The old cap used
  `COFFMAN_GRAHAM` + `coffmanGraham.layerBound`, which ELK dropped. New mechanism: `tidyLayoutOptions`
  sets the GLOBAL `elk.layered.layerUnzipping.strategy = ALTERNATING` when capped; the port preset's
  per-node `options(id)` hook stamps `elk.layered.layerUnzipping.layerSplit` (the sublayer COUNT — set
  on the root it's ignored). Shared `tidyLayerSplitFor(nodeCount, cap) = max(1, ceil(count/cap))`; the
  arrange fn stashes it in a module var (`tidyLayerSplit`) from `proxyNodes.length` just before
  `layout()`, and `layoutTidyIntegration.test.ts` calls the same helper (drift-pinned). count is the
  whole layout's node count (per-layer widths unknown pre-layout) so it can over-split, erring SAFE:
  widest layer W ≤ count ⟹ W/split ≤ cap, never exceeds. Empirically layerSplit=N → N columns on a
  9-fan. Tests re-pinned to the CONTRACT (no row > cap, wrapped, shorter cross-extent) not exact column
  counts. `third-party-licenses.txt` flips MIT → `EPL-2.0 OR GPL-3.0-or-later` (elkjs's license).
- **Write CSV + Write JSON → ONE "Write File" node (no-duplicates rule).** `WriteCsvNode`/`WriteJsonNode`
  collapse into `WriteFileNode` with a `format: "csv" | "json"` field; `WriteFileNodeBase` folded in (one
  concrete class now). csv/json is a serialization CONFIG, not the family op — so the component's toggle is
  a `<SegToggle arg>` (selectorNamedOp: a `format`-bound picker must carry `arg`) and the node keeps its
  util accent, NOT `kind: operation` (that'd need an `op`-named field + NODE_OPS machinery, wrong for a
  sink and fighting the one-leaf intent). `format` rides the existing INIT_FIELD_ORDER slot so persistence
  is automatic; sink discipline unchanged (Run-only writes, `enabled` never persisted). One catalog leaf
  `write-file` (keywords keep csv/json findable); old `write-csv`/`write-json` saves load as Placeholder
  (pre-alpha, no alias). sink.test.ts rewired; full suite green.
- **CSV File + Parquet File → ONE "Local File" node (no-duplicates rule).** `CsvConnectionNode` +
  `ParquetConnectionNode` collapse into `LocalFileNode` (`nodes/connection.ts`); the file EXTENSION picks
  the reader — no format control (author: extension-driven, no picker). `.parquet` → `engine_read_parquet`
  lazy `FrameRef` (native-only, `#REF!` on failure); anything else → CSV (Rust `readCsvFrame` on desktop,
  JS `csvToFrame` on web, null on failure). One `data()` branches on `endsWith(".parquet")`; owns/drops the
  Parquet handle and drops it on a switch to CSV. Rust side untouched (both commands already existed). The
  merged card keeps the CSV node's auto-refresh (Parquet gains it). `listLocalFiles` lists csv+parquet
  (`listFilesByExt` now takes an ext array); one catalog leaf `local-file`. Old `csv-connection`/
  `parquet-connection` saves → Placeholder (no seed used them). tsc + full suite green.
- **`rete-area-plugin` 2.1.5 → 2.3.2.** Bump verified against `CappedZoom` (`areaPresets.ts`): the base
  `Zoom` internals our subclass relies on are all intact in 2.3.2 — `pointers`, instance-field `wheel`/`down`
  (ours override the base's), `element`/`onzoom`/`intensity`, and `initialize(container,element,onzoom)` /
  `destroy` with the same listener set (stock `destroy` still removes `pointerdown` WITHOUT the capture flag,
  so our capture-flag removal is still needed). The 2.3.1 `Selector.add` change (unselect all except the
  re-picked) does NOT reach us: we never use the plugin's `Selector`/`selectableNodes` — selection is fully
  custom (`selected` flag + `selectNode`/`unselectAllNodes`; touch via `tapSelect.ts`'s own `select`
  callback). 2.2.x now normalizes wheel deltas (deltaMode→px→clamped, the same shape as ours) but tuned for
  a mouse (8/24px, `intensity/8` per px ≈0.0125, cap `intensity`≈0.1/notch); we KEEP our curve (0.0028/px,
  cap 0.24) — gentler trackpad slope + higher notch cap, tuned during the smooth-zoom work — since `wheel`
  replaces the handler wholesale and the per-px slope and cap move together (not a one-`intensity` swap).
  Per-100px notch: ours ≈+0.24, upstream ≈+0.10. Rewrote the stale "stock fixed ±intensity" comment (it now
  overrides a WORKING impl). pointerGesture + surfaceParity green.
- **OS-dropdown precaution SETTLED (desktop): the `<select>`-swallow is REAL, and `zIndexNodesOrder` is
  NOT adopted.** The "native `<select>` inside a node needs a pointerdown swallow" claim was untested. A
  native popup is OS chrome (not DOM) so it can't be observed by CDP; instead `scripts/dropdown-reorder-probe.mjs`
  measures the two DOM-observable CAUSES a close would have. Finding (desktop, `table-verbs`): (a) a
  card-body mousedown re-appends the picked node to the DOM END (`simpleNodesOrder`; node jumped doc-index
  5→22) — independently confirmed by `Canvas.tsx:1022-1027`, which re-appends docked FCs BECAUSE the pick
  moves the host to the end; (b) the pick's selection re-render PRESERVES the `<select>` element (an expando
  set before the pick survived it — same DOM node). So the re-append is the SOLE thing that reparents an
  open `<select>`, and reparenting a focused element closes a native popup in Chrome → the precaution is
  real, the swallow is load-bearing. `zIndexNodesOrder` (no re-append) would avoid it, but it's NOT worth
  adopting for this: a big refactor (Canvas drag-layers + the 1022-1027 docked-FC re-append, `groupLogic`
  z=−2, the standoff/group/conduit −3/−2/−1 ladder all assume DOM order/hybrid; it puts nodes at z≥1) with
  "no overlaps ever" risk, and it deletes ZERO swallows anyway (`stopDragStart` on a control is needed for
  DRAG-prevention regardless). So: keep `simpleNodesOrder` + the swallows; backlog trimmed to the still-open
  MOBILE case (touch/tapSelect path not probed) and a standalone click-stability `zIndexNodesOrder` line.
  **Author eyeball to confirm the one unobservable link:** open a node's `how`/Chart-type dropdown, then
  mousedown the card body — today the open list should close (precaution real); it would stay open only if
  we ever switch to `zIndexNodesOrder`.
- **Series Range → INCLUSIVE of Stop (author 2026-08-24).** `rangeCount`/`rangeList` (`listOps.ts`)
  end ON Stop: `n = floor((stop−start)/step + 1e-9) + 1`; step 0 → `start===stop ? 1 : Infinity` (still
  the `#DOMAIN!` cap); values are `start + i*step` (not accumulated) with the last snapped exactly onto
  Stop (so 0→1 by 0.1 ends on 1). The RANGE formula shares the kernel. SERIES_OP_META copy + the Range
  tests flipped. Also a small copy fix (Lead ask): REDUCE_OP_META first/last drop the repo-retired "No
  Excel equivalent" phrase and the §7 second-person aside (f42b42d0).

- **B7 Tidy options (plan 10) — three persisted knobs, read by BOTH ELK call sites.**
  `tidyLayoutOptions({direction, density, widthCap})` maps to ELK: `elk.direction` RIGHT/DOWN,
  the spacing pair (compact 36/24 · normal 55/38 = today's · airy 80/56), and a width cap via
  `COFFMAN_GRAHAM` + `coffmanGraham.layerBound` ("off" omits both, since `layerBound` is inert
  without the strategy). `tidyOptionsFromSettings` reads the settings; the main canvas AND the
  composite drill-in now pass it (the drill-in used no options before — a behaviour change).
  `symmetricPortPreset(direction)` became a factory (RIGHT WEST/EAST down the height, DOWN
  NORTH/SOUTH across the width); the plugin re-invokes it per layout so a setting change needs no
  re-register; the hand-copied drill-in port preset is deleted. The post-layout anchor transposes
  under DOWN (TOP edge + horizontal center vs LEFT + vertical center), and the within-group clamp
  guards the left pad instead of the header, so tidy→autofit stays a fixed point either way
  (pinned: `tidyArrangeGroups.test.ts` idempotence under DOWN and cap 3; `layoutTidyIntegration.test.ts`
  the exact option map per combo + a 9→1 fan where cap 3 → 3 layer columns/rows, off → 1). Chrome:
  three `segment` rows in Settings ▸ Canvas + a `.solenoid-tidy-options` popover off a chevron beside
  the top-bar Tidy button (reuses Settings' segment-pill styles, Escape + clickaway close, z20 local
  to the topbar — registered in `layout-chrome.md`). `tidyWidthCap` stores the string `"off"/2/3/4`
  (segment control), mapped to the numeric cap at the call site. Backlog "B7" + the dangling elkjs→
  `deferrals.md "Tidy options"` pointer resolved; elkjs stays 0.8.2 (layerUnzipping is the 0.12
  follow-on). AUTHOR EYEBALL: Settings ▸ Canvas shows the three rows; the top-bar chevron opens the
  popover, matches Settings, closes on Escape/clickaway; a 9→1 fan with Width cap 3 lays out 3×3 —
  the open question is whether the cables through our router read as a block or spaghetti (do not
  touch `cablePaths.ts`; report what you see).

- **Frame-hint hover was dead (author report) → cross-root enter.** React's synthetic
  `onPointerEnter` never fires when the pointer arrives from a different React root, and rete
  renders each node in its own root, so a socket on the card edge (hovered straight from the
  canvas) never opened the hint; native `pointerenter` did (headless mouse probe: native
  listeners fired, React's did not, the handler raised the layer when called by hand). Fix:
  `useNativeEnterLeave` (`nativeHover.ts`) on the socket wrapper and the value-box hover; trap
  recorded in CLAUDE.md. `LazySelect` / `SvgPicker` sit inside the body (pointer crosses the
  same root first) so they were unaffected. Inspector's inline hint bumped to panel-scale
  type (11px). Author eyeball: hover a Chart's Data socket → mini-table; Inspector shows the
  larger one.

**A2 — formula-surface containment, safe slice (plan 1).** An undeclared Formula.js name
(no `EXCEL_IMPL_META`, not internally registered) that receives a rank-2 matrix now returns
one clean `#SHAPE!` instead of broadcasting into an array of per-cell `#VALUE!`s: a fourth arm
in the matrix gate (`excelFormula.ts` `case "call"`). A genuinely unknown `NAME(...)` returns
`#NAME?` via an early `resolveExcelFunction` short-circuit rather than a `dispatch` throw
leaking as `#ERROR!`. Rank-1 list broadcast of undeclared scalar names is unchanged.
Pinned in `broadcastRules.test.ts` "the matricesInFormulas containment rule" (+3); `rules.md`
`hideMatrixFromVendor` amended. Findings (on scope, not touched): backlog's "~232 declared
meta" was stale → fixed to 377 (actual `EXCEL_IMPL_META` size); its "~445 advertised" is also
off (`FX_FUNCTION_NAMES` is 880 incl. dotted names) — left for the allowlist-flip follow-on.

**C — evict live material still cited from `docs/archive/` (plan 2).** The four code citations
of archived docs are gone: `scripts/formula-node-parity.ts` and `formulaNodeParity.test.ts`
(header + the user-facing failure message) now point at `rules.md` formulaNaming/uniqueNameMap
and state the ratchet rule inline; `nodes/cube.ts`'s comment deleted (now a routed file — new
`docs/README.md` routing row → `subsystem-invariants.md` § Socket lattice, the accurate home for
the recursive-container invariant, not the `rules.md` the plan defaulted to); `frameLookup.test.ts`
keeps its behavioral sentence, drops the "See archive" clause. Step-3 check: neither archived doc
holds a still-true rule missing from the live set (the cube socket rules are in `rules.md`/§ Socket
lattice; the parity ratchet is pinned in the test + formulaNaming), so nothing moved. `docsPointers.test.ts`
still references `docs/archive/README.md` — that IS the enforcer of the boundary, correct to keep, so
the done-when grep is "nothing but the enforcer" rather than literally empty. `formulajs-vs-native-audit.md`
had zero code citations (backlog claim was stale); `FAMILY_BACKING` already carries its verdicts.

**B6 — Table popup per-column summary footer + profile (plan 3).** Factored `describeColumn(values,
type) → ColumnProfile` out of `describeFrame` (byte-identical output, pinned) — the popup and the
Describe node now share one kernel; `ColumnProfile` adds an `error` count (present = valid + error).
The frame Table popup gets a sticky two-row `<tfoot>` (mirrors the format-row chrome): a profile row
with a 3-segment valid/error/empty bar (error = `--sol-error`, empty = transparent + hairline) and
`n distinct`, and a summary row — number columns show a mono `sum/avg/min/max` stack, others a count.
Computed over the WHOLE dataset (read-only reads `state.data`, editable reparses `buildFrameColumns`,
computed columns read their derived cells); skipped for list/vertical popups. `describeColumn` unit
tests added beside the `describeFrame` corpus. Finding (per plan, not fixed): `colSummaries` recomputes
per render, and an editable popup re-renders per keystroke — but editable popups are hand-typed (small),
so no measured lag; memoize only if a large editable frame ever lags. AUTHOR EYEBALL below.
(Agent-1 review 18404080-era fixes: colSummaries is now a ref-cache keyed on grid/state identity;
the profile-bar tooltip lost its dynamic counts — tooltips are structural only.)

**B0 — Python/R gap remainder (plan 4, one commit per sub-item).**
- **B0.1 str_wrap → Wrap Text.** `wrapText(t, width) → string[]` kernel in `textOps.ts` (greedy,
  whitespace-collapsing, a long word alone on its line unbroken, width clamps to 1, blank → []);
  `WrapTextNode` (text + width, `strListOut`; width < 1 → `#DOMAIN!`), `WRAPTEXT(text, width)`
  formula. Meta carries NO `rank: "list"` — like TEXTSPLIT, a scalar-in/list-out function is not a
  list-arg op, and declaring the rank trips formulaTier3's "list-returning ⟹ takes args whole"
  (the plan's "rank: 1" note was off for this shape). Pinned in `textOps.test.ts`; run-graph on the
  scratch seed wraps the sample sentence at 16.
- **B0.2 Histogram 2-D — folded into the Histogram node as a MODE (author directive, not a second
  node — no-duplicate-nodes).** `histogram2d` / `histogram2dGrid` kernels in a NEW rete-free
  `visualOps.ts` (had to move off `visual.ts` — it imports rete, and `formulaPathIsReteFree` bans
  that from the formula path, so the formula couldn't import the kernel otherwise). HistogramNode
  gains `mode: "1d" | "2d"` (SegToggle marked `arg` per selectorNamedOp — a shape pick like Bin's
  mode, not a NODE_OPS family op); 2-D adds Y + Y-bins inputs (`dropInputCables` before
  `removeInput`), carries `bins` across as the X count, and draws the count grid as a **contour**
  density plot (reused the existing chart op — a new discrete-heatmap chart op was rejected as
  scope creep; contour of a count grid is a valid 2-D density figure). `HISTOGRAM2D(xs, ys, kx, ky)`
  formula returns the bordered-grid matrix (shared kernel); mapped to the node's 2-D mode in
  `formulaNodeCoverage`. The `chart` output socket centers on the figure via `.solenoid-node__figure`
  (author ask). Kernel tests in `visual.test.ts`; scratch seed has a 2-D Histogram over two lists.
  AUTHOR EYEBALL: the 1-D Histogram component was rebuilt on the Surface-node pattern (SegToggle +
  InlineInputs + ChartFigure), so its Values input moved from plot-centered to an inline row and the
  in-card expand button became the collapsed [Chart] chip — confirm 1-D still reads right, then flip
  to 2-D.
- **B0.3 ODE integrate — RK4 (plan 4).** Rete-free `rk4(f, y0, t0, t1, steps)` kernel in a new
  `odeOps.ts` (fixed-step classic RK4; steps clamp 1..100000; a null/non-finite derivative or a
  blow-up aborts to null). `OdeIntegrateNode` (in `stats.ts`, by Decompose). Two author rulings
  reshaped it after the first commit (ce111e34): (1) t and y are CORRELATED → ONE `{t, y}` frame
  output, not two lists (the seed plots straight into a Chart, t as labels, under C2's label rule);
  (2) the derivative is a LAMBDA of (t, y), not a string-expression socket — it mirrors the MAP
  family: `lambdaIn("dy/dt")`, `lambdaSig {vars:[t,y], required:2}`, `resolveFn(byName)` so a wired
  `LAMBDA(t, y)` binds by param name, fnError/cachedError codes (#SYNTAX!/#NAME?/#VALUE!), and the
  card's inline field is the λ-family `FormulaBox` bound to `stringLiterals.formula` (`resolveFn` +
  `FormulaBox`/`FormulaError`/`FORMULA_KEYS` exported for reuse). Divergence → `#DOMAIN!`. NODE-ONLY:
  no formula compiles a text-expression string on the formula surface (this closes the
  string-expression-socket rule — ODE was its only violation). Pinned in `odeOps.test.ts` (kernel +
  the node's frame output + error codes); scratch seed integrates dy/dt = y → e^t into a Chart. The
  ce111e34 stats.ts commit also carried Agent 2's C4 InterpolateNode grid-axes rewrite (shared file,
  coordinated split); the rework landed at 46c71976 + baae4eb4.
- **B0.4 STL decomposition (plan 4, last B0 item) — 88c8a724.** STL is a third `model` on the
  Decompose card (not a new node): rete-free `stlDecompose` in `forecastOps.ts` implements R
  `stl(s.window="periodic")` — the seasonal is EXACTLY periodic (per-phase mean, centred) and the
  trend is a LOWESS fit of the deseasonalised series with NO blank ends (unlike the classical 2×MA),
  reached by a periodic-mean ↔ loess fixed-point iteration (~15 passes; a clean trend+season drives
  the residual < 1e-4). The node's `model` selector + the `DECOMPOSE` formula's third model string
  both route to it (multiplicative-STL-via-log left for later). Pinned in a new `forecastOps.test.ts`.
  Landed with the ODE card fixes (same stats.ts): the ODE dy/dt λ socket moved to LAST so its
  cable-only row sits on the FormulaBox row (MAP layout), and OdeIntegrateNode joined FormulaPopup's
  host set so the pop-out opens (author bug report).

**C5 — correlated outputs → one frame (plan 14, author rule). My two stats.ts nodes.** Decompose's
trend/seasonal/residual are correlated per time step, so they ride ONE `decomposition` frame (columns
Trend/Seasonal/Residual) instead of three list sockets (a9035642; component → FrameDisplay). Forecast
(ETS) is the same: the point forecast and its ± prediction interval → one `{Forecast, Interval}` frame,
while the detected season stays a scalar output (it's a fit diagnostic, not per-step) (dbff6936). The
shared scratch seed was rewired for every C5 frame node — decomp, Outliers, Find Peaks (mine, 99d409da),
then Forecast ETS (dbff6936) — each multi-output display cluster collapsed to one frame Display. Jeff
(Agent 5) owns the other five list/control C5 nodes; the seed handoff and one HEAD-red episode (his
fd4947d7 swept my Decompose frame-test in before my frame-node landed) are recorded in the coordination
messages. Also folded into dbff6936: the Grid Interpolate Xs/Ys fix (InterpolateNode `stringLiterals`
xs/ys → typeable CSV lists, using Agent 1's 494abae2 numlist-CSV opt-in).

**C2 — the base Chart renders multiple series from a frame (plan 11, author ask). 3 commits.**
`ChartValue.series` + `ChartNode.data()`: column 0 is ALWAYS the x-axis label at ≥2 columns (a
numeric col 0 is a real axis — live-market-data feeds are `(date-or-number, value)`; the "label only
when non-numeric" first cut regressed that, Agent-1 plan fix 273e08fd); the NUMBER columns after it
are named series; `values` mirrors the first so 1-D consumers are untouched; a legend at ≥2.
`MultiSeriesView` (chartRender) draws one child per series for column/bar/line/area/scatter/radar
with a recharts `<Legend>` + a multi-value tooltip, palette-colored (Options `color` stays
single-series). Step 3 deleted the redundant `Series` (anyTable) socket + `CHART_MATRIX_OPS` +
`ChartValue.matrix` — every op reads the one `values` frame; Composed reads the columns as
bar-then-lines, Bubble bypasses the label rule and takes the first three NUMBER columns as x/y/size.
chart-showcase's `TableInputNode matrix` → a `FrameInputNode [Step, A, B]`. `Legend` is the first in
`src/`. Pinned in `chartValue.test.ts`; renderer is author-eyeball (node vitest env has no DOM).
AUTHOR EYEBALL: `getting-started` / `decision-matrix` charts unchanged; a Frame Input `Month, Sales,
Target` → Chart shows two colored series + a legend (line too); chart-showcase Composed/Bubble look
as before from the new frame source. Out of scope (one Finding each): stacked, per-series color
overrides, secondary y-axis, legend toggling.

**A6 — shared node drag guard + tap-select on BOTH editing surfaces (plan 6).** The composite
drill-in had NO drag guard, so a finger press grabbed a card and a finger pan over cards was dead
(the reported sudoku-solver "flickering"). Canvas's inline `patchDragGuard` is now
`areaPresets.installNodeDragGuard(area, editor, {groupBand?})` — the lock / touch-transparency /
non-primary-button / `isPinching` branches port verbatim; the expanded-group edge band stays a
Canvas `groupBand` callback so `areaPresets` never imports `GroupNode`. Its touch companion (the
window pointer census + pointerup tap-to-select, without which a drag-transparent card is
untouchable) is `tapSelect.installTapSelect`, sharing a mutable `TapCensus` the Canvas area pipe
still reads for its off-canvas / form-control branches. Both surfaces install both; the drill-in
gets no `groupBand` (no groups in a subgraph). Main-canvas behavior unchanged — the tap-select pipe
is added BEFORE `selectableNodes` so its swallow still beats the background deselect (in select
mode that ordering is what preserves an accumulating tap). **The pre-exist bug the probe caught:**
a drill-in's internal nodes are loaded with the doc BEFORE the mount, so the `nodecreated` pipe
never fires for them — installing the guard only from that pipe left the drill-in doing nothing
(same dead pan as before). The backfill loop now patches every view it adds
(`mount.patchDragGuard(n.id)` beside `addNodeView`); the pipe still covers nodes added while
drilled in. `surfaceParity.test.ts` pins both installers on both surfaces, the
`installNodeDragGuard…isPinching()` shape in areaPresets, AND the backfill path (guard applied to a
view, not only on nodecreated). **Probe** (`scripts/touch-pan-probe.mjs`, agent-run per the backlog
line's "headless CDP touch emulation, not author-watched" — a measured behaviour check, not the
visual eyeball the no-puppeteer rule covers; mobile-emulated so `IS_MOBILE` is genuinely true):
MAIN canvas finger-drag on a card → cam Δ(120, 90), 0 nodes moved; DRILL-IN → cam Δ(120, 90), 0
nodes moved (was: nothing); a stationary tap selects exactly one card. tsc + full vitest (4703)
green. One deviation kept from the plan: step 6 said delete the drill-in lock-class mirror
(`CompositeEditorOverlay.tsx`) — but the MAIN canvas ALSO applies `.solenoid-canvas--locked`
(`Canvas.tsx:755`) and that CSS disables field/socket/cable pointer input, which the drag guard does
NOT cover, so deleting it would leave a locked drill-in editable. Author eyeball: on a phone or touch
emulation open a composite, finger-pan over cards, pinch, tap a card to select, toggle the lock pill.

**A4 — retire the XLOOKUP `rawInputs` bypass (plan 5).** `XLookupNode`'s `frame` input swaps
`rawInputs` (skip ALL coercion) for `noWidenInputs` (skip only rank widening). The plan's premise
that "coercion would `toCube` a wired Frame and strip its typed columns" is STALE — `frameToCube`
carries `type: col.type` now (typed CubeColumns), so nothing strips. But full removal (option 1)
still fails: `toCube` silently WIDENS a scalar/1-D into a 1×N cube, and the node's shape guard then
sees a cube and can't reject it, degrading the clean "Build Frame two aligned lists first" `#VALUE!`
to a `#REF!`. `noWidenInputs` is identity for a `cube`-typed socket (no element family), so a Frame
stays a typed Frame, a Cube a Cube, and a scalar/1-D reaches the guard un-widened and is rejected
`#VALUE!` — behavior-preserving, and the frame input no longer bypasses the coercion pipeline
wholesale. `persistenceSweep` allowlists `noWidenInputs` (transient); the stale `asLookupSource`
header comment (claimed the socket was `any`) is corrected. Pins: `frameLookup.test.ts` "XLOOKUP
node coercion — retiring the rawInputs bypass" (typed-date survives coercion; scalar + 1-D rejected,
driven through `wrapNodeData`). **The chart nodes (`visual.ts`) are now the only `rawInputs` users**
— feeds B8's "collapse the frame+cube lookup paths." Full suite green (bar Agent 4's in-flight B0).

**A3 — the popup grid's keyboard path (plan 7).** The Table popup grid now moves like a
spreadsheet. Pure mover `gridKeyboard.ts` (`gridKeyOf` classifies a keydown, `nextCell` returns
the target VISUAL position or null): Enter/Shift+Enter down/up (clamped); Tab/Shift+Tab next/prev
cell wrapping across rows and SKIPPING computed columns, null off either end (falls through to the
browser's default Tab); arrows clamp and can land on a computed cell (read-only, not unreachable);
Home/End jump to the first/last column. Wired in `TablePopup.tsx`: every cell input carries
`data-vi`/`data-c`, the mover focuses the target by `querySelector` on a single table ref (no
per-cell refs). Excel's Enter-mode / Edit-mode split without an F2: arrows/Home/End move the CARET
while a cell is mid-edit (draft ≠ committed), navigate otherwise; Enter/Tab always commit-then-move
(explicit `setCell`, so blur is a no-op). A commit can re-rank the row under the caret (sort); the
move targets the visual position from BEFORE the commit — accepted. Escape moved to the shell:
`PopupShell` gets `onEscape` (capture, fires before the cell's keydown) — mid-edit it reverts the
draft and stays open, otherwise it closes; the per-cell Escape branches (grid + form view) are
deleted. Computed cells stay Tab-skipped but arrow-reachable. No new strings; `ShortcutsOverlay`
gets no popup section (the keys are the universal spreadsheet set). Pins: `gridKeyboard.test.ts`
(every key from every edge/corner of a 3×3, Tab-skip, wrap, clamp, modifiers→null, 1×1, zero dims).
tsc + full vitest (4734) green. AUTHOR EYEBALL below (incl. the still-unverified >1,000-row sort /
Copy-CSV check carried over from the old A3 backlog line).

**C3.1 — Set Cell node (plan 12, item 1).** A matrix node that overwrites cells by 1-based
address: input Table, then an extensible list of (Value, Row, Column) rows, output the same table
with those cells written. `PairedExtensibleInputs` GENERALIZED from pairs to N-tuples in place
(`valuePairKeys: () => string[][]`, `pairLabels: string[]`, `removePair(keys[])`, a `rowNoun` prop
for the add/remove copy) — the five existing pair nodes needed ZERO changes (their `[a,b]` tuple
types already satisfy the widened interface; the plan expected type-only touches). Kernel
`setCells(m, writes)` in `matrixOps.ts`: normalizes a ragged grid (blank pad, like EXPAND), applies
writes in row order (later wins on a repeated address), 1-based, `#REF!` (shared `indexRefError`
wording) on any out-of-range address = whole result errors. `SetCellNode` (`matrix.ts`,
`adoptiveTableIn`→`adoptiveTableOut`, passthrough single, `carryMatrixUnit`) reads Row/Column as
ADDRESSES (wired-blank or unset → whole result null) and Value as an OPERAND via `pickSlot`
(wired-blank → null cell; unwired → the number/text card literal, `autoLiterals`). No formula
registration (a variadic writer has no clean signature) — added to `FRAME_SURFACE_NAMES`
(`SETCELL` → recognized-but-refused, since it sits under Tables & Frames) and the matrix-unit
policy table (`carry`). Pins: `setCells` kernel cases in `formulaMatrix.test.ts`; the triplet
undo case in `extensibleRowUndo.test.ts`; the unit-carry assertion in `matrixUnitPolicy.test.ts`;
"Set Cell — wired blank by role" in `wiredNull.test.ts` (landed in Jeff's Finance commit — we
co-edited that file). Sweeps (catalogRegistry / socketReference / coerceInputs / frameSurfaceNames)
green. **Findings:** (1) skipped the scratch-seed entry — that file is high-contention and a QA
convenience, not test-required; drop a Set Cell node from the Add menu to eyeball. (2) A Frame arm
(column by name) stays out of scope, as the plan noted.

**C3.2 — Replace Values: Find/Replace stop being text-only (plan 12, item 2).** The `find` and
`replace` sockets are now `anyIn`, so a wired Number / Boolean / Date / Slider connects; `data()`
funnels each through `readFilterValue` (a wired scalar stringifies the way a typed literal would;
a wired blank stays unknown → null result). `column` stays `strIn`. The node gains `autoLiterals`
(+ a `literals` map) so its card fields render as auto (number OR text) through `InlineInputs` —
and a `findReplaceLiteral` reader stringifies either literal map for the kernel. The kernel, the
Polars plan, and both engines' test files are byte-identical. Pins: `frameNodeBackend.test.ts`
"Replace Values — Find/Replace take a wired value of any type" (wired number vs a number column,
wired boolean vs a logical column, wired-blank → null). Catalog description left as-is (the typed
sockets self-document; a "takes any type" sentence would be Captain-Obvious and would churn the
`caseContract` pin).

**Replace Values match rule unified + parity-pinned (601e864c).** The C3.2 Finding claimed a
web-vs-desktop gap, but the Rust (`lazy_replace_values`) has matched numbers numerically and
booleans case-insensitively since B5 (7805985f) — it was never exact-text-only. The real residue was
on the JS side: `replaceValues` carried a redundant `String(v) === find` on numbers (it would match a
`NaN` cell against find `"NaN"`, which Rust never does) and a doubled boolean form, both of which
merely *read* as divergence. Simplified the JS to the one rule Rust already follows — number →
numeric equality against the parsed find (non-numeric find hits no number cell), boolean → TRUE/FALSE
case-insensitive (never 1/0), string → exact text; dates are serials → number arm. No Rust production
change; added a corpus parity test on both sides (`frameVerbs.test.ts` "the shared match rule",
`engine/tests.rs` `replace_values_match_rule_parity`). cargo green (30), tsc + vitest green. Residual
micro-edge left as-is: JS `Number()` accepts hex/binary literals ("0x10") that Rust `f64::parse`
rejects — absurd as a Replace target, not worth reimplementing Rust's float grammar in JS.

**Settings Node Packs section — was already built; verified, copy-fixed, pinned.** The backlog line
"Settings: Node Packs section — planned, unbuilt" was stale: `Settings.tsx` `PacksSection` already
lists `allPacks().filter(builtin)` with a per-pack switch, wired to the live `packsStore`
(`isActive`/`toggle`, its OWN `solenoid.packs` persistence + dependency activation), and the Add menu
already rebuilds `buildCatalog(true)` on `packsStore.version` (Canvas.tsx) — so a toggle live-filters
the menu and a deactivated pack's constructors stay registered (saved graphs still load). Two fixes:
(1) copy — dropped the `help={p.description}` sentence from each pack row (the descriptions read
"…On by default. Turn off to declutter.", Captain-Obvious under a clear pack name; §7). (2) pin — the
Add-menu filtering had no test (only the formula-name seam in `formulaExtensions.test.ts`), so added
`catalogSearch.test.ts` "a disabled pack's node leaves leave the tree": a fixture pack's leaf appears
in `flattenLeaves(buildCatalog(true))` only while active. NB the pin lives with `packsStore`/the
catalog, NOT `settingsStore` — packs have their own store, so folding them into settingsStore would
be a second source of truth. Left the "Browse pack store…" disabled stub + custom-packs note as-is
(loader still stubbed).

**katex 0.17 → 0.18.4 (9d9c220d).** The 0.18 breaking change ("prefix css classes", #4229) prefixed
GENERIC internal classes (`.base` → `.katex-base`, `.strut`/`.sizing`/`.html` likewise) but kept the
public `.katex` wrapper and `.katex-display` — the only two we override (`FormulaPopup.css`,
`LambdaView.css`, `SetOpNode.css`), verified by rendering under 0.18.4 — so no selector changes. The
bundled `katex.min.css` and rendered HTML are both 0.18 (self-consistent); `renderToString` API
unchanged (`katexRender.ts`). marked's major (14→18) was already done; only an in-range 18.0.9→18.0.11
patch remains. Install now requires `--legacy-peer-deps` — pre-existing elkjs 0.12 vs
`rete-auto-arrange-plugin` peer `^0.8.2` (the elkjs bump), NOT katex. Verified: tsc katex-clean,
`obsidianMarkdown`/`noteFcPropagation` green; a clean FULL-suite confirmation was blocked by a peer's
in-flight CSV/Parquet `connection.ts` refactor (CsvConnectionNode exports mid-rename) — re-run once
that lands.

**Gauge absorbs Bullet — one "value on a scale" card, Dial or Bar (fc0ecd4a; author combine).**
CONTRACT CHANGE (author eyeball): Gauge no longer forwards its number — it emits a chart VALUE now
(the same pass-through → chart move 7-Segment made), so a Display/Report downstream sees the figure,
not the value; old Bullet saves load as Placeholders. The Bullet graph folded into Gauge under an op
selector (Dial/Bar, `kind:"operation"`, the field is `op` per selectorNamedOp). One unified
`ScalePayload {style,value,target,min,max}` replaced `BulletPayload`; the chart op `"bullet"` →
`"scale"`; the chart-card renderer branches on `style` — `ScaleDial` (arc + percent, shared by the
node card AND the popup/Report so both draw the same dial) or `BulletBar`. Dial reads Value as a
fraction (fixed 0→100%, square-collapse kept); Bar plots Value on a 0→Max track with a Target tick.
The Dial/Bar switch prunes the bar-only cables (`dropInputCables`) before `removeInput`; `value`
carries. NO enumerated nodeOps rows (both are just "Gauge" in the Add menu, and a "bar" op would
collide with Chart's) — "bullet"/"dial"/"bar" ride the leaf's keywords for search. `BulletNode` +
component deleted; the `chart-showcase` seed's Bullet became a Gauge/Bar. Pins updated:
`visual.test` (dial + bar payloads, `op` extractInit round-trip), `wiredNull` (Bar wired-blank),
node-coverage. Full suite green (4814). No Rust mirror (figures are JS).

**Set Cell extends by SHAPE — scalar cell / list row / matrix block (83c5a339; author ask).** Each
per-row Value now extends by rank from its (Row, Column) anchor: a scalar fills one cell, a 1-D list
a rightward row segment, a 2-D matrix a block (numpy `A[r:r+h, c:c+w] = B`). Kernel `setCells`
(`matrixOps.ts`) takes `v: Cell | Cell[] | Cell[][]`, normalizes by toAnyMatrix-style rank detection
(scalar/null → 1×1, list → one row, 2-D → as-is), and errors `#REF!` (`indexRefError` naming the
OVERFLOWING axis — `r+h-1`/`c+wdt-1`) if a segment/block runs past an edge; no clipping; later writes
win cell-by-cell on overlap; a wired-blank Value still writes one null cell. Socket: the per-row Value
went `anyIn` → `anyDataIn` (anydata rung, rank ≤ 2), and `takesAutoLiteral` (`inlineInput.tsx`) now
includes `anydata` so the scalar inline literal field stays (a typed literal is a scalar; a
list/matrix only arrives by wire — a wildcard sink/relay stays wire-only by leaving `autoLiterals`
off, so the widening can't affect it). Pins: `formulaMatrix.test.ts` kernel (row, block, overflow
naming Row/Column, overlap order, empty-list no-op); `wiredNull.test.ts` node list-write +
wired-blank; `matrixUnitPolicy.test.ts` grid-unit carry across list + block writes; coerceInputs
sweep green. The one nodeCatalog description line ("a list writes a row, a table a block, from that
cell") is handed to Agent 4 (they hold nodeCatalog.ts for the Local File merge). No Rust mirror
(matrix ops are eager JS).

**C4 — grids take a plain Z + optional Xs/Ys; bordered format retired (plan 13, 2 commits).**
The coordinate-BORDERED grid (row 0 = X, column 0 = Y, interior = Z) is gone everywhere for one
convention: coordinates ride BESIDE the Z matrix. New shared kernel `gridAxes(z, xs, ys)`
(`mathUtils.ts`) normalizes: z → rectangular `(number|null)[][]`; an unwired axis is the 1-based
index; a wired-blank axis leaves the shape unknown → null; a wired list must carry exactly one
finite number per column/row, else `#SHAPE!`/`#VALUE!` (the old parse silently dropped bad-axis
lines — now a loud error). `fillGrid` replaces `fillBorderedGrid` (same bilinear + surface-fit
algorithm over a plain Z). Commit 1 (d01f6d10 + Lead's 474f8724 null-arg fix): the kernel + the
INTERPOLATE formula's grid arm `INTERPOLATE(table, xs?, ys?, forecast?)`; InterpolateNode's grid
sockets grid→z/xs/ys landed in Agent 4's stats.ts (ce111e34, co-edited). Commit 2 (4184d711 + the
nodeCatalog copy on Agent 4's OdeIntegrate commit): SurfaceNode/Contour on gridAxes
(`parseBorderedGrid` deleted); HISTOGRAM2D returns the plain kx×ky count matrix (bin edges leave
the formula surface; `histogram2dGrid` deleted); AddIndex's second "bordered grid" output +
`borderedGridFromFrame` removed; Surface/Contour/Interpolate/Help/landing copy dropped the bordered
wording; the landing demo feeds a plain Z with holes. `grep -rn bordered src/` is empty (the last
ref, a stats.ts comment word, rides Agent 4's stats.ts commit). Seeds: none changed (pivot-tables'
AddIndex never cabled the grid output; the null-and-logical Interpolate is list mode). Ports:
stats.test.ts (a `filled` re-border helper keeps the interior assertions), formulaMatrix.test.ts,
visual.test.ts, matrixUnitPolicy.test.ts. Coordination note: heavy 4-agent contention on stats.ts
(Agent 4 OdeIntegrate) / nodeCatalog / frame.ts / visual.ts — resolved by pathspec commits split
along file ownership, flagged in each message. AUTHOR EYEBALL: Table Input (3×3 with holes) → Grid
Interpolate (nothing on Xs/Ys) fills them; wire a 3-item Xs list and the fill changes; Surface from
the same table draws with 1,2,3 axes; `INTERPOLATE(table)` in an Expression matches the node.

**B8.1 — Unnest peels ONE cube level (plan 8, sub-item 1).** `unnestCube` (`frameVerbs.ts`) gains a
branch: it detects the nested column's child kind from the cells — all FRAMES → flatten to a Frame
(the existing path); all CUBES → peel one level to a shallower Cube (parent columns repeat per
child row, child columns copied as-is so a child's OWN nested column stays nested); a mix is a
`#TYPE!`. A depth-2 cube used to yield a silent EMPTY frame — that's the bug it fixes. `UnnestNode`'s
output is now `staticTrueAnyOut` (the result rank depends on input depth); keyed `frame` still, so
seeds/`cubesSeed` read `.frame` unchanged. Sanctioned in `catalogRegistry.test.ts`
`trueanyNeedsPassthrough` (not an input passthrough — a depth-dependent producer). The component
renders `CubeDisplay` vs `FrameDisplay` on `isCubeValue`. `column` blank still yields empty (NOT the
first-container default — that would be a second convention next to relateCubeToFrame; Finding, not
built). Pins: `frameVerbs.test.ts` (depth-2 peel → cube depth 1 + child intact; peel-then-unnest =
two-step inverse to flat rows; mixed → #TYPE!; depth-1 round-trip unchanged). tsc + full vitest
(4795) green. B8.2 (SUMIFS all/any + Aggregate First/Last) and B8.3 (XLOOKUP path collapse, A4
landed) still to come.

**B8.2 — Timesavers remainder (plan 8, sub-item 2).** Two ops/toggles on existing families, no
new nodes. (a) **SUMIFS all/any** — `SumIfsNode` gains a `match: "all" | "any"` field (default all,
persisted via `INIT_FIELD_ORDER`, a `SegToggle` shown only past one criterion); the criteria fold's
`crits.every` becomes `every`/`some` on the selector. No Rust mirror (SUMIFS is JS-only — engine.rs
has no `sumifs`). (b) **Aggregate First / Last** — `AggregateOp` gains `first`/`last`; since the
caller blank-skips before the fold, they're `arr[0]`/`arr[n-1]` (all-blank → null, an error cell
propagates). `fx` declared `FIRSTNONBLANK`/`LASTNONBLANK` (no Excel equivalent), grouped under
"Basics", dim carries like min/max (`aggregateResultDim`). Pins: `list.test.ts` (first/last on
leading/trailing nulls + all-blank + error; SUMIFS any = union of matched rows vs all = intersection;
any/all with zero criteria both null). **Held out (Findings, built nothing):** Duration trio wants an
elapsed `[h]:mm` FC format first (format-model question, `pack-composite-plans.md`); Split Name is a
new multi-output node with an output-shape call (parked); Multi-Criteria / Lookup-All reopen the
recorded XLOOKUP-shape decline; Fiscal Quarter / Age / Nth Weekday are author calls (`deferrals.md`).
B8.2 files green in isolation (208); the full suite has 2 PEER-owned failures in the scratch seed
(Jeff's Find Peaks output-merge left `d_pk_val` wired), flagged to him — not from B8.2. (Since
resolved by Agent 4's 99d409da — seed now green.)

**B8.3 — XLOOKUP frame+cube path collapse LANDED (a03eeba3, net −23 lines).** Frame and cube
XLOOKUP had duplicate row-finders + cell-getters. Since a frame is a legal cube input and
`frameToCube` carries `col.type`, they merge: `lookupRowIndex` + `lookupCell` take a CUBE, and a
frame source reaches them via `frameToCube` (`lookupFrameRowIndex`/`lookupFrameCell` deleted). The
orderable check now uses the shared `isOrderableKey`; one error string. `XLookupNode.matchOne` keeps
exactly ONE fork — the whole-row (`*`) return, where a frame source must still yield a Frame row
(`frameRowAt`) and a cube source a Cube row (`cubeRowAt`); the single-cell path is fork-free.
`frameLookup.test.ts` + `frameVerbs.test.ts` frame arms feed `frameToCube` through a local adapter,
every case kept. No Rust mirror (XLOOKUP is JS-only). Full suite green (4801). Plan 8 complete —
plan file deleted.

**A5 Input (direct + Control) sweep** (23 leaves / ~19 classes) → one wired-blank bug: Color
Blend treated a blank on a color operand as an "isn't a color" `#VALUE!` instead of propagating
blank; now `readInput` reads the raw value, `null` → blank out (error still outranks blank, and a
typed-empty `""` card still errors). Everything else already correct: Slider's control-bound
fallback, RAND/COMPLEX shape+operand propagation, Input Switch / Slicer relay-and-frame
propagation, and the pure sources (Number/Text/Boolean/Date/Table/Frame/Constant/NA/dials/pads).
No false description claims. Pins: `wiredNull.test.ts` "Input family — wired blank by role" (+4).
Residue: none. Collapsed-card eyeball list in the final message.

**A5 Input ▸ Connections sweep** (10 leaves) → all pure sources (Web Source, Data Feed, CSV,
Parquet, Import HTML/XML/Obsidian) + sinks (Write CSV/JSON/Obsidian). No operand inputs, so no
wired-blank exposure: sources return `idle`/null on an empty ref/URL; the three sinks cache a
blank frame/document as null and refuse to write ("Nothing to write. Connect a…"), which is the
figure/sink-datum disposition and already pinned (`sink.test.ts` "refuses to write with nothing
on the input cable", `obsidian.test.ts`). Descriptions + `socketDocs` verified against `data()`;
§7 clean (mid-sentence Settings glosses only, no trailing parentheticals or em dashes). No code
change, no new pins. Residue: none.

**A5 Output (direct + Data Quality) sweep** (4 leaves: Display, Alert, Expect, Tornado) → one
wired-blank bug: Expect's `allowed` check parameter reverted to the card's allowlist on a wired
blank instead of skipping the check, unlike its own min/max/pattern (which already skip). Now it
reads the slot the `readInput` way: unwired → card list, wired blank → unknown → skip; `socketDocs.allowed`
gains the blank-skip sentence for parity. Display (pure relay + SEES_ERRORS forward), Alert
(`scalarish`→`readInput`, per-op null guards, unknown never fires), Tornado (pure relay, no
literal) already correct. Pins: `wiredNull.test.ts` "Output family — wired blank by role" (+2).
Note: the plan row's class-file list (`sink.ts`, `report.ts`) is stale for this row — the 4 leaves
at catalog :232/:237 are Display/Alert/Expect/Tornado; the write sinks were swept under Connections
and Report/Note belong to a later row. Residue: none.

**A5 Output ▸ Visuals sweep** (34 leaves / ~24 classes) → NO bugs; the whole figure family
already honors the value-semantics role table (the data() comments cite the roles by name). Every
datum reads `?? null` → empty figure, never a SolError out `chart` (SEES_ERRORS); every Options
reads `readInput(..., stringLiterals.options ?? null)` → neutral `{}` on a wired blank, card string
only when unwired (ChartNode/Record handle the wired-SolError/number nuance); figure SHAPES
(Histogram/Histogram2D bins, Surface contour levels) empty the figure on blank and mirror to the
card only when UNWIRED; figure CONTROLS that must render (Bullet `max`) keep the card bound;
optional comparison (KPI `prev`) blanks to no-comparison; ChartBuilder omits every unset
presentation field. Pins: `wiredNull.test.ts` extended "figure sinks" with the KPI-prev
optional-comparison case (+1). Overlap flagged: Agent 4's B0 is mid-refactor of `visual.ts`
(new `visualOps.ts`, `Histogram2DNode.tsx`, a HISTOGRAM2D formula) — additive, orthogonal to the
wired-blank contract, so this sweep's conclusion stands for the existing nodes.
Combine candidates: Gauge + Bullet → one value-on-scale figure with a style selector (they are
already a catalog `pair`); Treemap + Waffle → one proportion figure (both take a 2-col label/value
frame) with a layout selector; Histogram + Histogram2D → one binning figure with a 1-D/2-D
selector (coordinate with B0, which is touching Histogram2D).

**A5 combine-candidate backfill** (author directive 2026-08-24): Input — none strong (hand-drawn
widgets Point Plotter / Curve / Grid Painter emit different shapes; scalar controls Slider / Angle
Dial / XY Pad are distinct widgets). Connections — Write CSV + Write JSON → one "Write File" with
a format selector (already share `WriteFileNodeBase`); CSV File + Parquet File → one "Local File"
with a format selector; Import HTML + Import XML (+ maybe Web Source's auto CSV/JSON) → one "Web
Import" with an extractor selector (table N / XPath / auto). Output — none strong (Display / Alert /
Expect / Tornado are distinct roles).

**A5 Numbers ▸ Arithmetic/Functions/Rounding/Logarithms sweep** (32 leaves / 7 classes:
Arithmetic, MathFn, MRound, RoundN, Gcd, Clamp, TwoInputMath) → NO bugs. Every operand
propagates a wired blank: the two-operand classes guard `a !== null && b !== null` (or lean on
`broadcast`'s null short-circuit, as Gcd/RoundN do for the second operand), MathFn guards the
single `in`, Clamp separates unwired-absent (no bound) from wired-blank (unknown) per its
socketDocs. Domain/÷0 errors are the node's own `#DOMAIN!`/`#DIV/0!` (per-cell in a list); a
wired-in SolError is handled upstream by `installErrorGuards`, so the both-null guard never has to
rank error vs blank itself. Descriptions/`socketDocs` verified (INT floors to −∞, EVEN/ODD away
from zero, MROUND multiple-of-zero → 0, MROUND sign guard scoped to nearest). Pins:
`wiredNull.test.ts` "Numbers ▸ Arithmetic/Functions/Rounding — operands propagate" (Arithmetic /
MathFn / MRound, +3). Combine candidates: MRound (to a multiple) + RoundN (to N digits) + MathFn's
trunc/int/even/odd (to integer forms) → one "Round" node with a target selector (nearest-multiple /
N-digits / integer-form); the family is otherwise already maximally op-merged (MathFn alone unifies
~35 single-input functions). Residue: none.

**A5 Numbers ▸ Trigonometry/Combinatorics/Engineering/Bessel sweep** (41 leaves) → NO bugs. Trig
reuses MathFnNode (already swept); the rest (Combinatorics, Multinomial, SeriesSum, BaseConvert,
Bitwise, Bessel, Hypotenuse, TwoInputMath's delta/gestep) all guard their operands to null →
propagate, list inputs `?? null` with no literal to resurrect. CombinatoricsNode is the exemplar of
the active-op guard: FACT/FACTDOUBLE never read `k`, so a wired-blank `k` doesn't blank them, while
COMBIN (reads both) blanks — pinned. Domain/overflow are the node's own `#DOMAIN!`/`#OVERFLOW!`.
Descriptions verified (INT/EVEN/ODD, BaseConvert digit-out-of-base → null, Bessel domain). Pins:
`wiredNull.test.ts` "Combinatorics — active-op guard" (+1). Combine candidates: none strong (already
op-merged); one dedup FLAG — `HypotenuseNode` (HYPOT) and `TwoInputMathNode`'s `hypot` op are two
implementations of √(A²+B²) (the TwoInputMath one isn't a catalogued leaf, likely formula-only), so
collapse to one. Residue: none.

**A5 Numbers ▸ Complex sweep** (24 leaves / 7 classes: ComplexFrom [swept under Input], Unpack,
Unary×16, Binary×4, Power, PolyRoots, QuadraticRoots) → NO bugs. Every complex op routes operands
through `cxOp`/`numOp` + `broadcastComplex`, whose per-cell short-circuit propagates a wired blank
to null; the two classes with card literals (Power `n`, Quadratic `a/b/c`) read them via `readInput`
so unwired uses the literal, wired blank blanks. Per-cell domain errors (a=0 quadratic, √ branch,
non-finite) tag `#DOMAIN!` alone. socketDocs verified (arg in radians −π..π, coeffs highest-degree
first, leading zeros ignored). Pins: `wiredNull.test.ts` "Complex — operands with literals" (Quadratic
Roots, +1). Combine candidates: none strong (Unary/Binary already op-merged; PolyRoots vs Quadratic
differ in output shape and purpose — Quadratic is the Equation-companion two-labeled-root form).
Residue: none.

**A5 Lists ▸ Build/Shape sweep** (24 leaves / 21 classes) → NO bugs. Shape/scalar params read via
`readInput` and guard null → propagate (SeriesNode is the exemplar: every range/sequence/linspace
param guards null → blank list, degenerate range → `#DOMAIN!`/`#OVERFLOW!`, and it distinguishes
Range's legitimately-unset Stop from a wired blank). Whole-list operands read `inputs.list?.[0] ??
[]` for transforms (empty in → empty out) or `?? null` for length/propagate, consistently by role.
FilterNode is the filter-condition exemplar: a wired blank comparison value blanks the whole result
(not the unfiltered list), while an empty literal skips the condition — matches frame Filter. Pins:
`wiredNull.test.ts` "Lists ▸ Build/Shape" (Series linspace + List Filter, +2). Combine candidates:
the list generators SeriesNode (range/linspace/sequence) + Geometric + Fibonacci + Repeat + RandArray
→ one "Generate List" node with a rule selector; Sort + SortBy → one Sort with an optional by-list;
SetOp + SetRelation share two-list-set inputs but differ in output type (list vs boolean). Residue: none.

**A5 Lists ▸ Transform/Find sweep** (23 leaves) → NO bugs. Transform nodes (Diff, Running, Normalize,
Bin, Outliers, Smooth, FindPeaks, Shift, Ewma, Convolve, Rle, Trapz, Spectrum) read list operands
`?? []` and scalar params via `readInput` with a null-guard → propagate; mode-scoped (Bin guards `n`
only in quantiles). Find: ListIndexNode is the canonical three-state read (unwired-untyped → whole
axis, wired blank → null, number → that 1-based position) — the reference for "absent is not
unknown"; ArgMinMax/Contains/XMatch all blank a wired-blank operand/needle (Contains: "a blank needle
can't be looked for"; XMatch: `pickSlot` + `val === null → null`, #N/A only when the array is wired).
Pins: `wiredNull.test.ts` "Lists ▸ Find — INDEX three-state" (+1). XLOOKUP (frame.ts) deferred to the
Tables ▸ Table verbs sweep to avoid overlapping Agent 2's fresh A4 refactor. Combine candidates: DIFF
(gradient) + Integrate (trapz) are inverse ops → one "Calculus" node with a differentiate/integrate
mode; the family is otherwise well op-merged (ArgMinMax unifies argmax/argmin/argsort/which; Smooth
unifies savgol/lowess/gaussian). Residue: none.

**A5 Lists ▸ Aggregate/Spread&Shape/Correlation sweep** (41 leaves) → NO bugs. AggregateNode is the
reducer exemplar: COUNTBLANK counts missing cells (answers even when all blank); every other op runs
`forAggregateUnits` — a SolError PROPAGATES, a null is SKIPPED (not zeroed), the socketDocs claim
holds. WeightedNode guards both lists → null. The Correlation ops (Correl/Covariance/Fisher, plus
SumProduct) use `forPair`/`readInput`: a blank on either paired list drops the pair or blanks the
result, per-cell domain errors tag alone. Pins: `wiredNull.test.ts` extended the reducers-skip block
with AggregateNode (SUM skips null, error propagates, COUNTBLANK counts, +1). Combine candidates:
Correl + Covariance (+ SumProduct's paired sums) share the two-list `forPair` shape → one "Bivariate"
node with an op selector (correl/spearman/kendall/rsq/cov.p/cov.s); otherwise heavily op-merged
(Aggregate alone unifies ~24 reduce ops). Residue: none.

**A5 Lists ▸ Rank/Regression/Tests/Stats sweep** (36 leaves) → NO bugs. Uniformly exemplary:
RankPercentileNode and HypothesisTestNode read each active op-family's params via `readInput` with a
scoped null-guard (LARGE's k, PERCENTILE's p, QUARTILE's q, Z.TEST's x/σ, proptest/binomtest params)
and their lists via `forAggregate` (skip null, propagate error) or `forPair` (drop blank pairs). The
regression nodes (Forecast, Linest, Logest, Polyfit, Trend, ETS, Decompose, Interpolate) guard the
query operand and use `forPair`; zero-variance → `#DIV/0!`. Documented deviation confirmed: an
out-of-range INC quartile blanks on the node vs the formula's `#DOMAIN!` (kept from before). Pins:
`wiredNull.test.ts` "Rank & Percentile — active-family param guard" (+1). Combine candidates: the
curve-fitters LINEST + LOGEST + PolyFit + TREND (+ FORECAST.LINEAR) → one "Fit/Regression" node with
a model selector (linear/exponential/polynomial) + predict; ETS + Decompose share seasonal
decomposition. Otherwise heavily op-merged (HypothesisTest unifies 12 tests). Residue: none.

**A5 Logic + Boolean sweep** (17 leaves) → NO bugs; the family is the reference implementation of the
value-semantics contract. `pickSlot` is the audited reader for every `autoLiterals` wildcard
value-selector (IF/IFS/SWITCH/CHOOSE), with `isSet` separating a set slot from unset for the #N/A
-on-unmatched rule. IfNode: a blank condition → null (no branch pickable). ComparisonNode: comparing
an unknown is unknown (Kleene null), unit-aware, `=`/`≠` still answer on incommensurable pairs while
`<`/`>` give `#UNIT!`. IFErrorNode reads by connection-presence so a wired null survives and passes
through (not an error); IsTestNode distinguishes UNWIRED (nothing to test → blank) from a wired blank
(ISBLANK → TRUE). BooleanOp/Not are Kleene (already pinned). Pins: `wiredNull.test.ts` "Logic —
unwired-vs-wired-blank" (ISBLANK, IF, +2). Combine candidates: Comparison + Between + IsClose are all
numeric boolean predicates → one "Test" node with a mode (compare / between / isclose); IF is a
special case of IFS (one pair + otherwise) but the fixed 2-branch card earns its Excel familiarity.
Otherwise heavily op-merged (Boolean unifies 6 ops, IsTest 8, Comparison 6). Residue: none.

**A5 Finance ▸ TVM/rate/payment/cash flow sweep** (14 leaves) → NO wired-blank bugs; this is the
area the value-semantics "Where the blank check goes" section was derived from, and it holds:
IpmtPpmt/Npv/Irr guard every operand via `readInput` → null, the active-op guard is scoped, MIRR's
error outranks blank (pinned). NPV's cash-flow list is POSITIONAL — a blank cell counts as 0 (holds
its period), documented in socketDocs and distinct from an aggregate's skip; the rate operand and
dated-mode blank dates propagate. TVM/Compound Growth/Effective Rate are acausal EquationNode presets
(the solver mechanism). Pins: `wiredNull.test.ts` "NPV — positional list blanks to zero" (+1).
FINDING (not a change, flagged to verify): NPV claims Excel parity but its blank-cell-as-zero may
diverge from Excel NPV over a range (which skips blanks) — the array-vs-range nuance; worth a parity
check before trusting it, per documentExcelDeviations. Combine candidates: NPV + IRR + MIRR (+ XNPV/
XIRR already folded as a dates mode) → one "Cash Flow Analysis" node with an op selector. Residue:
the NPV parity finding above.

**A5 Finance ▸ bonds/depreciation/other/coupon sweep** (35 leaves) → NO wired-blank bugs. Every
multi-op class (Depreciation, TBill, SecDisc, PriceDisc/Mat, Duration, OddCoupon, Coupon, bond
Price/Yield) reads params via `readInput` and scopes the null-guard to the ACTIVE op: Depreciation's
SLN returns before the `per`-check so a blank per doesn't blank it while SYD/DDB/DB gate on `per !==
null` (pinned); TBILL routes discount vs price by op. Verified against code, not memory: the historical
TBILLYIELD 365-vs-360 bug is FIXED — tbillyield now uses the 360-day money-market basis, tbilleq the
365/(360−d·dsm) ≤182-day form, both with inline "verified against real Excel" values. Formulas route
through `resolveExcelFunction` so node and formula surfaces can't drift. Pins: `wiredNull.test.ts`
"Depreciation — active-op guard" (+1). Verification note: this was a wired-blank + active-op-guard
sweep, NOT a full Excel-value parity audit of all 35 bond formulas (that is the separate parity
program); the two day-count values above were the only ones spot-checked. Combine candidates: none
strong — already maximally op-merged (Depreciation unifies 5, the *disc/*mat/duration families
paired). Residue: none.

**A5 Distributions sweep** (6 leaves) → NO bugs. DistributionNode is the oneDistributionNode
flagship: every distribution × form (CDF/PDF/PMF/tail/inverse/sample) reads its x/prob/count and
params through `readInput`, guarded to null (sample form checks `some(null)`; forward/inverse lean on
`broadcast`'s null short-circuit), form-scoped so only the active op's params are read; an
out-of-domain value → blank via the compute→null path (socketDocs holds). BinomDistRange guards all
four params; FitDistribution takes a sample list. phi/gauss/STANDARDIZE were already swept (MathFn/
stats). Pins: `wiredNull.test.ts` "Distribution — wired blank parameter" (+1). Combine candidates:
none strong (DistributionNode is already the model merge; BinomDistRange could fold in as a binomial
"range" form, minor). Residue: none.

**A5 Date & Time sweep** (27 leaves) → NO bugs. Date operands propagate a wired blank through
`broadcast` (DatePart/WeekInfo/DateDiff/DateAdd), and the construct params (DATE's Y/M/D, pinned)
propagate too. Mode-selector inputs — DateDiff `basis`, WeekInfo `return_type`, Workdays
`weekend_code` — read via `readInput` and PROPAGATE a wired blank to null, scoped to the ops that
read them (DAYS never reads basis, so a blank basis there is ignored; pinned). AUTHOR CALL (recorded,
not decided, per backlog "mode-selector inputs on a wired blank"): these selectors currently
PROPAGATE a wired blank rather than falling back to the card default — consistent across Date, Text,
and the earlier families (TEXTSPLIT delimiter, NETWORKDAYS weekend). The whole app is uniform on
this; if the author wants "blank selector → card default" it is a cross-cutting change, not a
per-node one. Pins: `wiredNull.test.ts` "Date mode-selector + active-op guard" (+1). Combine
candidates: DATE (Build) + TIME → one "DATE/TIME build" node with a mode; Epoch (parse) + DATEVALUE/
TIMEVALUE (parse text) are both to-date parsers. Otherwise well op-merged (DatePart unifies 6,
DateDiff ~8, WeekInfo 3). Residue: none.

**A5 Text sweep** (42 leaves) → NO behavior bugs; one misleading COMMENT fixed. String operands read
through `strVal`/`strScalar` (both `readInput`, so a wired blank propagates and only an unwired slot
takes the card literal — the raw-then-trim rule); numeric params via `readInput`. The fix: `strScalar`'s
docblock claimed it "DELIBERATELY still `?? literal`" and treated a wired blank as ambiguous/defaulting,
but the body is `readInput` — it PROPAGATES, same as `strVal` and the pinned TEXTSPLIT-delimiter
behavior. Corrected the comment so no one "restores" the swallow-wired-blank bug. Heavily pinned
already (UPPER/LEFT/REPT/TEXTSPLIT/TextFilter + caseContract); SUBSTITUTE's wired-blank instance
propagates while an unwired 0 replaces all (socketDocs holds). Combine candidates: SUBSTITUTE + REPLACE
→ one "Replace" node (by-match vs by-position mode); PadText + TruncateText + WrapText → one width-
based "Fit Text" node; DOLLAR + FIXED (number→formatted string) pair. Otherwise well op-merged
(TextTransform unifies 7, TextSlice 3, TextFind 2). Residue: the mode-selector AUTHOR CALL (same as
Date, recorded there).

**A5 Tables ▸ Cubes sweep** (4 leaves: BuildCube, NestJoin, CubeColumns, CubeRollup) → NO bugs;
exemplary. All four follow the "read raw, guard, THEN trim" rule for string column refs — a wired
blank name/key/column is unknown → null, while an untouched empty card reads "" and takes the default
(BuildCube's "Items", Rollup's "Total"). NestJoin: a wired parent that is neither Frame nor Cube →
`#TYPE!`, an unwired parent stays blank; socketDocs accurate. Cell rows read wired-or-literal per row
(no `??` swallow). Pins: `wiredNull.test.ts` "Build Cube — wired blank column name" (+1; CubeRollup
already pinned). Combine candidates: BuildCube (one column) is a special case of CubeColumns (many) →
one "Build Cube" node with a single/multi mode. Residue: none. (Note: no Unnest node lives in cube.ts;
the catalog's 4 Cube leaves are these four — B8.1's cube-unnest work, if it lands, is elsewhere.)

**A5 Packs sweep** (10 packs, ~17 real node classes + Equation/Expression presets) → NO bugs. Pack
entries are mostly `equation`/`expr` presets that run through the Equation/Expression nodes (already
swept). The 17 real classes (ParallelCombine, ESeries, Awg, ResistorCode, Solar/Sunrise/MoonPhase,
Colebrook, PipeRoughness, TriangleSolver, EmSpectrum, IsaAtmosphere, Antoine, PhysicsConstant,
Element, MolarMass, HrZones) all read params via `readInput` and guard to null (`typeof === "number"`
or an explicit check) → propagate; list/date operands `?? []`/`?? null`; domain errors tag
`#DOMAIN!`/`#VALUE!`. Each shares its core with the matching pack formula (e.g. `colebrookFriction`,
`awgWire`, `nearestESeries`) so node and formula can't drift, and those PackFormula impls null-guard
too (`if (value == null) return null`). No forbidden `?? this.literals` idiom anywhere in the pack
files. Pins: `wiredNull.test.ts` "Packs — domain nodes" (Colebrook representative, +1). Combine
candidates: none strong (each pack node is single-purpose; the astro trio outputs different shapes).
Residue: none.

**A5 Tables ▸ Matrix/Shape/Select sweep** (24 leaves) → NO bugs (matrix.ts stable after A2's C3).
Matrix operands read `inputs.x?.[0] ?? null` → a wired blank blanks the result (MMULT: `#SHAPE!` on
non-conformable, not a silent blank; non-numeric → error); scalar params (n, wrapCount, rows, cols)
via `readInput` guarded to null; EXPAND's Fill pads with null on a blank, the author's documented
override (wire NA for `#N/A`). SetCellNode (A2's C3.1) reads value/row/col via `readInput`/`pickSlot`
and is already pinned (its wired-blank block rode my Finance commit). Pins: `wiredNull.test.ts` "Tables
▸ Matrix" (MMULT representative, +1). Combine candidates: HSTACK + VSTACK → one "Stack" node with a
direction (the table analog of the already-merged list stack). Otherwise heavily op-merged (matDet
unifies 5, reshape 4). Residue: none.

**A5 Tables ▸ Lambda + Frames sweep** (12 leaves) → NO bugs. The lambda-apply nodes (MapTable,
ByAxis, MakeArray, Reduce, Scan) read the table/lambda operands `?? null` and shape/initial params
via `readInput`: MakeArray's blank rows/cols leave the SHAPE unknown → null ("the `<1` guard answers
it"). The frame builders/accessors (BuildFrame, FrameFromLists, SplitFrame, GetColumn, GetRow,
AddColumn, ComputedColumn): a blank frame or a blank column-reference → null (GetColumn cites
value-semantics, already pinned at :238; GetColumn also fetches ONE column lazily off a FrameRef).
Pins: `wiredNull.test.ts` "Tables ▸ Lambda" (MakeArray shape, +1). Combine candidates: REDUCE + SCAN
→ one fold node with a "keep running values" toggle (SCAN is REDUCE that emits each step); BuildFrame
+ FrameFromLists both assemble a frame (matrix+headers vs named lists); GetColumn + GetRow (pull a
column vs a row). Residue: none.

**A5 Tables ▸ Table verbs sweep** (35 leaves — the LAST family) → NO bugs (frame.ts stable after A2's
C3; no forbidden `?? this.literals` idiom anywhere in it). The relational verbs (Distinct, Head,
Sort, Filter, Join, SumIfs, Window, GroupBy, Append, BindColumns, Fill/Replace/DropBlank, the column
surgery + reshape verbs) read the frame operand `?? null` and column-reference/key params via
`readInput`/`readFilterValue`, propagating a wired blank to null while an EMPTY literal keeps its
"not chosen → pass through / all columns" reading (Sort/Join/SelectColumns already pinned). XLOOKUP
(deferred from Find) reflects A4: `noWidenInputs` keeps a Frame typed, all four column refs propagate,
`ifNotFound`'s empty literal = "no fallback" vs a wired blank = unknown, and a scalar/1-D source is a
loud `#VALUE!` not a silent blank — pinned. ReplaceValues (A2's C3.2) uses `readFilterValue` +
`autoLiterals` with the same empty-vs-blank distinction. Rust mirror (`src-tauri/src/engine.rs`): NO
semantics change needed — the wired-blank handling is entirely in the node `data()` (JS), the fused
verb kernels were untouched, so nothing to mirror (cargo not run here). Pins: `wiredNull.test.ts`
"XLOOKUP — column refs propagate" (+2). Combine candidates: SUMIFS (list.ts) and Window/GroupBy all
do grouped aggregation — a longer-term "aggregate over a frame" consolidation; Append + BindColumns →
one "Combine Frames" with a vertical/horizontal mode (the frame analog of VSTACK/HSTACK). Residue:
none.

**A5 node-by-node sweep — COMPLETE.** All 23 catalog families walked. Bugs fixed (3): Color Blend
wired-blank color operand (#VALUE! → propagate); Expect `allowed` check-parameter (reverted to card
→ skip like min/max/pattern); a misleading `strScalar` comment (claimed `?? literal`, body is
`readInput`). ~34 `wiredNull.test.ts` pins added across the families; `finePrintContract`/`caseContract`
already covered the description claims. Findings filed (not changed): NPV blank-cell-as-zero vs Excel
range parity; HYPOT exists twice (HypotenuseNode + TwoInputMath's hypot op). Recorded author call:
mode-selectors (basis, delimiter, weekend, return_type…) uniformly PROPAGATE a wired blank rather than
defaulting — a cross-cutting change if the author wants otherwise. Combine candidates fed per family
to the Lead for the next planning round. Overall verdict: the node layer already honors the
value-semantics role table; the 3 fixes were the only real defects in ~600 leaves.

**A5 Other sweep** (Convert, Cast, Placeholder + structural Group/Conduit/Composite/Equation/FC) →
NO bugs. Convert (the flagship unit control): the value is an operand, a wired blank propagates to
null; units are dropdown config, incommensurable → `#N/A`, over-range → `#OVERFLOW!` per cell;
unitAware. Cast: a wired blank stays blank (relay that SEES errors), a genuine parse failure is
`#VALUE!` per cell; the source socket's dataType witnesses date-vs-number. The structural nodes
(Group/Conduit containers, Composite drill-in, Equation acausal solver, FC unit/format author) carry
no operand→propagate value semantics and are covered by their own subsystem tests (activeGraph,
unitFlow); Placeholder relays an unknown node's wiring + data unchanged. Pins: `wiredNull.test.ts`
"Other — Cast and Convert" (+2). Combine candidates: none (each is a unique special/structural node).
Residue: none.

### SESSION DIGEST (2026-08-24 — author polish pass: Join dropdown, catalog valence, KaTeX arc trig, string-list errors, Aggregate optgroups, scratch-seed Groups)

Six author asks, each landed + committed separately. (1) **Join `how` → arg dropdown**
(8 ops outgrew the SegToggle); `OpSelect` options gained an optional per-option `title`
that rides into `<option>`. (2) **Catalog copy valence**: every "No Excel equivalent"
dropped (the R/numpy/pandas anchor already carries the positive claim); real
constructions became `Excel:` pointers (epoch math, DATE(YEAR,MONTH,1), MAX − MIN,
SQRT(SUMSQ), Fuzzy Lookup add-in). (3) **KaTeX arc trig**: `\asin`/`\acos`/`\atan` are
not KaTeX commands — `TRIG_TEX` now emits `\arcsin` etc.; pinned in
`excelFormula.test.ts` incl. a renderToString round-trip. (4) **ValueDisplay string-list
SolError**: inline join + clipboard printed `[object Object]` for an error cell (seen on
Fuzzy Match Best match with a below-threshold #N/A); now renders the code. (5)
**Aggregate optgroups**: 27 ops grouped Basics/Counts/Other means/Spread/Shape/Squares,
`Record<ReduceOp,…>` keeps the map exhaustive; descriptions ride as option titles. (6)
**Scratch seed regrouped**: 25 thematic expanded Groups over all 216 nodes, per-cluster
layered relayout from browser-measured card sizes (playwright, sanctioned path); the
3700px 200-draw display is `collapsed: true` in the save. Epoch double-card checked out
as correct-by-design (op fixed at construction types the sockets; two catalog entries).
Window node ruled NOT redundant vs Computed Column/Running: partition-by + order
(per-group rank/lag/rolling) exists only there — the SQL OVER argument.
Follow-ups the same day: (7) **chip audit** — every remaining family/formatting
fall-through closed (group readouts, pins, inspector, Display matrix branch), then
**`elem` made a REQUIRED prop** on ArrayChip/TableDisplay so socket-derivation is
compiler-enforced (tsc found 8 more forgotten hosts); cell-sniffing survives only for
an unresolved wildcard socket. (8) **Node DOM diet, −26% elements/card, zero visual
change**: socket glyphs (cube excepted), chevron, resize grips and copy icons are now
CSS-masked layers instead of inline-SVG subtrees (same vectors in mask data-URIs, same
CSS vars; combos = hard-stop diagonal gradient under a rounded-square mask; each layer
masked once — masking the span itself would square the rim alpha). Scratch seed
11693 → 8706 elements. Verified via 2×-DPR legend/closeup screenshots.

### SESSION DIGEST (2026-08-23g — the Python/R gap, Tier 2 landed; Formula.js upstream list)

**Tier 2 of `docs/python-r-gap.md` built end to end (13 new cards, 4 widened, ~25 formulas),
same discipline as Tier 1: rete-free kernel shared by node + formula, references computed
locally, every card in the scratch seed (`run-graph` verified).** Kernel homes added:
`hashOps` (MD5 / SHA-1 / SHA-256 / CRC-32 / FNV-1a / Base64 / UUID, hashlib-pinned),
`signalOps` (Savitzky–Golay, Gaussian, Cleveland LOWESS, find_peaks — scipy-pinned),
`mlOps` (k-means++, PCA via `matEigh`, logistic IRLS — numpy-pinned), `financeOps.returnsOp`,
`forecastOps.seasonalDecompose`, `mathUtils.polyRoots` (Durand–Kerner + Newton polish),
`textOps` (unaccent / slugify / pad / truncate / template). Cards: Pad Text, Truncate Text,
Returns, Bind Columns, Hash, UUID, Template, Smooth, Find Peaks, Decompose, Polynomial Roots,
K-Means, PCA, Logistic Regression. Widened: Text Transform (+UNACCENT/SLUGIFY), ARGMAX
(+ARGSORT / ARGSORT DESC / WHICH — `setOp` retypes BOTH sockets in place: WHICH takes a logical
list, the list ops emit a number list; the component prunes input cables before the swap and
`retypeOutputCables` after), Join (+`how = cross`, Polars `cross_join`, corpus-pinned),
url-encode (+Base64). **Bind Columns is a new n-ary backend verb** (`FrameBackend.bindColumns`,
`engine_bind_columns`, `BINARY_VERBS` + cargo-runner dispatch, `bindColumns.json`; cargo verified
to run it via an injected failure). Op-kind cards whose op owns extra sockets (Returns rf /
periods, Smooth window / order / frac / sigma) follow one shape: `setOp` adds/removes the
sockets, the component `dropInputCables` the departing keys first. The Template node grows an
`anydata` socket per `{name}` from data() via a microtask (`sideVars` persisted like Computed
Column); `TEMPLATE()` is positional `{0}` and a named placeholder there is `#NAME?`.
`docs/upstream-formulajs.md` lists the ten Formula.js 4.6.1 bugs behind our overrides as
ready-to-paste issues (verified, scipy-checked values) — the author submits. Open in the gap:
ODE integrate, 2-D histogram, `str_wrap`, STL.

### SESSION DIGEST (2026-08-23f — the Python/R gap, Tier 1 landed)

**`docs/python-r-gap.md` (author: "a node existing may retain a user") — surveyed, ranked,
Tier 1 built end to end: ~45 new ops/nodes, every one a node + formula on a rete-free kernel
with its numpy / pandas / scipy / R name in the catalog keywords**, pinned against scipy 1.9 /
numpy values computed LOCALLY (not recalled — the first Mann–Whitney/KS references from memory
were wrong; `pythonRGap.test.ts` carries the real ones). Kernel homes: `statsOps` (one-liners,
Spearman/Kendall, the eight tests), `listOps` (ntile, outliers, FFT via Bluestein), `dateOps`
(epoch, truncate), `matrixOps` (trace/rank/norm/solve/eigh), `textOps` (Levenshtein/Damerau/
Jaro–Winkler, fuzzy best), `forecastOps` (Holt–Winters), `financeOps` (amortization),
`frameVerbs` (describeFrame, correlationMatrix, windowFrame). Node-combining held: one-liners as
Aggregate ops, Spearman/Kendall as Correl ops, the tests as Hypothesis-Test ops (specs gained
`table` sockets), trace/rank/norm on the MDETERM card (which gained a real `setOp` output retype),
quantiles as a Bin mode. New cards: Outliers, Epoch ↔ Date, Truncate Date, Describe,
Correlation Matrix, Amortization, Solve, Eigen, Spectrum, Text Similarity, Fuzzy Match,
Forecast (ETS), Window. **Window is a LAZY FrameOp** — Polars `.over()` in `engine.rs` (`lazy_window`: row-index stamp → sort by order key nulls-last with the index as tiebreak → expr `.over(keys)` → sort back → drop), JS oracle on web, 20-case `window.json` in the parity corpus (cargo `corpus_cases` verified to catch a wrong expectation). Cargo features gained cum_agg / rank / rolling_window / diff. Reference overlay gained numpy/pandas/scipy/R/SQL/Excel chips
(`libraryTags`, derived from prose + keywords). The scratch seed wires every new node through
Displays (verified headless via `run-graph`). Excel-parity side-effect: FORECAST.ETS family
exists now (parity:false, same model family, own parameter search).

### SESSION DIGEST (2026-08-23e — backward audit of the day's commits)

**Audit walk (newest→oldest) of the 2026-08-23 commits; fixes landed, each pinned.**
`polyfitEval` paired x/y AFTER compacting each list separately (a blank on one side shifted every
later pair) — now pairs by position, result position-preserving over x. DIFF's ∇ mode was on the
class + in the alias table but NOT in the component's toggle (unreachable). Six new toggle
components were the same 26 lines → `makeToggleNodeComponent` (standardNode.tsx; read/write
accessors); DIFF/Normalize/Spell Number gained `setMode` so the output-socket label follows the
toggle. `processGraph`'s coalesced rerun dropped `force` (an F9 arriving mid-pass in manual mode
drained as an unforced call the manual gate swallowed) — carried now. SHIFT formula gained the
node's `[wrap]` arg. **The IRR / XIRR FORMULAS were Formula.js** (the digest's "finance already
shares kernels" was false for them): `IRR([-4943,-2458,285])` answered 1000 where the node answers
−0.903. Solver + cash-flow preps moved to the rete-free `financeOps.ts`, IRR/XIRR registered on it
(`listArgs`, guess ignored); NPV/MIRR joined RANGE_ZERO_FILL (a blank period is a zero flow, as the
nodes do — the aggregator null-drop shifted every later period). Cross-surface pins in
`financeIterative.test.ts`; recorded in formulajs-divergences.md. NB `FAMILY_BACKING` is the
consolidation DECISION, not the live state — ~55 "internal" names still dispatch to Formula.js
(statistics/distributions/datetime/RATE/MIRR); the backing-flip backlog item covers them.

**A1 backing flip — DONE (statistics, distributions, datetime, MIRR, CHOOSE; RATE declared).**
New rete-free kernel homes: `statsOps.ts` (Aggregate's 20 reducers, percentile/quartile/
nthExtreme, pearson/covariance/regression, modes/modeSingle, fisher), `distributionOps.ts`
(DIST_SPECS moved out of the rete-bound node file), `dateOps.ts` (DATE/TIME builders, the
parsers, weekInfo, dateDiff), `financeOps.mirr`. ~60 formula names that dispatched to
Formula.js while their family read `internal` now register on those kernels; node ↔ formula
pinned per family (`statsParity`, `distributionFormula`, `dateParity`, `financeIterative`),
plus the RATCHET in statsParity: every internal-backed overlap name is registered or named in
an honest straggler list (now: RATE — the TVM node is an Equation, no node function to share).
Unified degenerate answers: not-enough-data is a BLANK on both surfaces (the formula's
#DOMAIN! there was guardFinite catching NaN), zero variance under a division #DIV/0!,
GEOMEAN/HARMEAN ≤ 0 #DOMAIN! on both. Φ (stdNormCDF) was A&S 1.5e-7 → Cody TOMS 715 (double
precision; Φ(0) exactly 0.5) and normSInv gets one Halley step → full precision. Formula
DATE(26,…) now reads the year literally like the node (documented deviation, one answer).

### SESSION DIGEST (2026-08-23d — new data nodes, node merges, formula↔node parity)

**A big batch of numpy/pandas/R data nodes (author-directed), each a node AND a formula.** New:
DIAGONAL + OUTER + Cross Product (Matrix math); Shift, Bin, EWMA, Convolve, Run Lengths, Integrate
(new "Lists > Transform" leaf); Combinations/Permutations (Lists > Build); Poly Fit (Regression);
Between + Is-Close (Logic, broadcasting like Comparison). Kernels in `listOps.ts`/`matrixOps.ts`
(incl. a Gaussian `solveLinear` for the fit); formulas registered with signatures. A throwaway
"Scratch: new nodes" seed wires them all through Display outputs (discard later).

**Node-combining (the author's real intent behind "make combinations"), not new standalone nodes:**
Percent Change → DIFF's % mode; Gradient → DIFF's ∇ mode; Z-Score → Normalize's z mode;
GROWTH → TREND's exponential mode; ORDINAL → Spell Number's ordinal mode; Shift's blank/wrap toggle
(covers numpy roll); Combinations/Permutations one node. The standalone PctChange/ZScore nodes that
slipped in first were deleted.

**Formula↔node PARITY is now machine-checked (`formulaNodeCoverage.test.ts`).** The author's rule:
both surfaces must carry the same capability. Every declared-meta function must be node-reachable —
by name, Excel alias, or a documented `FORMULA_NODE_ALIAS` mode/op. Closed the only two curated gaps
(GROWTH, ORDINAL) and COUNTBLANK (new Aggregate op). NOT closed — the raw Formula.js passthroughs
with no declared meta (N/T/TYPE/ERROR.TYPE/SUBTOTAL/AGGREGATE and the CEILING/FLOOR dotted variants):
that's the open-by-default surface. Blocking them is unsafe/lossy (the rounding dotted names are
canonical alias targets — blocking corrupts the FX namespace walk; T/TYPE have no honest redirect),
so the real fix is the backlog's allowlist flip, still author-gated. NB the formula surface is
BLOCKLIST-based: even SUM/AVERAGE are Formula.js passthrough with no declared meta.

**Add-menu discipline:** split the 21-entry "Lists > Shape" leaf; new nodes placed ~12/leaf with
side-by-side pairs and search keywords. Reference Overlay + Inspector auto-derive from catalog
entries (native rows), so a description IS the declaration — no extra wiring.

**rete-react-plugin bumped to 2.1.2** (`flushSync` mount → layout-ready DOM). It surfaced a latent
bug: `flushSync` runs a mounting node's effects mid-rebuild, and the Conduit's
`useEffect(processGraph)` fired during `addNode` before the graph was built (`node is not
initialized`). Two-layer guard, both kept regardless of the plugin: `processGraph` single-flight
(`processReentrancy.test.ts`) + the Conduit effect early-returning while `isGraphRebuilding()`. Also
this session: Frame Input's add button → "+ Add lambda" and the Form-view layout gated behind a
"+ Add Form layout" button.

### SESSION DIGEST (2026-08-23c — IRR near-floor root fallback; Solarized ground; two parks)

**Fine-print residue CLOSED — the three unpinned claims are now pinned (2026-08-23).** All three
verified true against the code and given regression tests: Add Column pads a values list shorter
than the frame with `null` to the row count (node-level `Math.max`, not `addColumn`'s helper —
`frame.test.ts` "Add Column pads a short list"); the NUMERIC `buildFrame` path pads ragged rows to
the widest row with `null` (`typedColumn`'s ragged path was already pinned; this is the number path
— `frame.test.ts` "buildFrame — ragged rows pad"); MUNIT's blank off-diagonal fills `null` (absent,
skipped by aggregates) vs zero's `0` (present) — `formulaMatrix.test.ts` "MUNIT off-diagonal blank".
With (a) already done, the whole "Fine-print residue" backlog item is deleted.

**Solarized dark canvas returns to canonical base03 (author call 2026-08-23).** The dark
`canvasBg` had been deepened off-canon to `#002833` to force cards to lift; the author ruled
Solarized should carry no such invariant on its ground — make it match the ladder or leave it.
Set `canvasBg: BASE.b03` (`#002b36`), Solarized's own base03. Cards (base02) lift a hair less,
which is Solarized being itself (the same stance `paletteAllOrNone` already takes on its ~3:1 body
pairings). The structural `canvasBg` < `surface` invariant still holds (base03 < base02); full
palette suite green. Backlog "Solarized dark reads too flat" CLOSED.

**Card-frame clipping — PARKED indefinitely (author 2026-08-23).** The "node body/outer border
reads clipped" item is postponed with no scheduled follow-up; the full investigation record
(refuted mechanisms, the headed-on-author-hardware clear, "reproduce on THEIR document first")
lives in the 2026-08-22 digest if it ever reopens. Removed from the active backlog.

**`processGraph` is now single-flight — a mid-pass recompute coalesces instead of nesting
(root-cause hardening 2026-08-23).** A recompute requested WHILE a pass runs (any of ~7
component call sites: the Conduit's `useEffect(processGraph, [realLanes])`, CompositeNode ×4,
Date/Number input commits) used to be safe only by luck — the async DOM render fired the effect a
task LATER, after the pass drained. A synchronous render (a `flushSync` mount) fires it mid-render,
and the nested pass corrupts the shared per-pass state (engine reset/cache, collect memo, loop
set) → rete-engine's `node is not initialized`. Fixed at the shared entry, not per-component:
`_passActive`/`_rerunQueued` guard — a call arriving mid-pass flags a rerun and returns; exactly
one full follow-up pass runs after the active one settles (multiple coalesce to one; a stable
render dep can't re-queue). Inert on the current async render (no re-entrancy there); covers every
call site. Pinned in `processReentrancy.test.ts` (drives the real singleton with a stub area whose
render re-enters; verified to FAIL without the guard). Full suite green (4428).

**`rete-react-plugin` bumped to 2.1.2 (2026-08-23) — layout-ready DOM at mount, with a two-layer
guard.** 2.1.2 wraps the plugin's `mount` in `flushSync(root.render)`, so a node's root is
laid out when the mount returns. That synchronous flush exposed a latent bug: it runs a mounting
component's passive effects mid-rebuild, and the sole mount effect that recomputes —
`ConduitComponent.tsx:209` `useEffect(processGraph, [realLanes])` (audited: all ~60 other
`processGraph` call sites are user-action handlers, never mount effects) — fired `processGraph()`
during `addNode`, before the graph was built → `Dataflow2.fetch` threw `node is not initialized`
on Personal Finance. Fixed at two layers (both kept independent of the plugin): the `processGraph`
single-flight guard above, and the Conduit effect early-returning while `isGraphRebuilding()` (the
rebuild's terminal pass recomputes downstream anyway). Clean re-measure: crash gone, the earlier
pass cascade collapsed to one full pass + a cheap coalesced rerun. Cost is ~100ms on the first
171-node render (the `flushSync` synchronous-commit tax) — accepted for being on latest. Process
lesson worth keeping: the first three "2.1.0 vs 2.1.2" numbers were all a BROKEN 2.1.2 compared
against itself; there was never a clean 2.1.0 baseline, so the initial "no perf win, reject"
verdict was unearned — the bump was fine once the crash was actually fixed.

**Drill-in work is considered as ONE unit or not at all (author 2026-08-23).** The scheduled
"finger pan is DEAD in a drill-in" bug is no longer to be cherry-picked as an isolated fix — it is
Phase A of the editing-surface kernel (`deferrals.md`), and the author wants every drill-in item
looked at together before any of it lands. No code change this session; direction recorded.

**IRR/XIRR now find a root crowded against the rate floor.** `solveDiscountRate` was pure Newton
from a fixed 0.1 guess, so a series whose only real rate sits near −0.9 (where the discount curve
is near-vertical) overshot the −0.9999 floor and reported `#CONV!` on a real root. Split the kernel:
`newtonDiscountRate` stays the fast path; on its `null`, `solveDiscountRate` falls back to
`bracketDiscountRate` — a LOG-grid scan of 1+r from the floor out to r≈1e7 (dense near the floor,
still bracketing the tens-of-thousands runaway rates a linear scan to 10 would lose), returning the
first sign-change bracket bisected. Fallback runs ONLY on Newton failure, so it never overrides
which of several roots Newton already picked (the ambiguous multiple-root case stays as-is). A
genuinely rate-less same-sign series has no sign change → still `#CONV!`. Pinned in
`financeIterative.test.ts` "finds a near-floor root Newton overshoots" (3 single-root series Newton
missed).

### SESSION DIGEST (2026-08-23b — zoom clamp + minimap accent)

**Zoom now clamps to a floor/ceiling (0.05–2.5).** Added a `zoom` guard pipe in the shared
`installSurfacePointer` (`areaPresets.ts`): rete recomputes the origin-pan factor from the
CLAMPED target, so pinning at a limit leaves no drift, and one guard covers wheel, pinch,
double-tap AND programmatic `zoomAt`. `clampZoom`/`MIN_ZOOM`/`MAX_ZOOM` exported; pinned in
`surfaceParity.test.ts` (both surfaces already call the installer).

**The minimap now paints a node's REAL accent, so a retyped literal recolors.** Root cause was
two bugs stacked: (1) the minimap/html-canvas coloured by `nodeKindOf` (fixed per class), so a
List/Table Input showed its kind colour while the card recoloured with the element type; (2) the
first fix returned `SOCKET_COLORS`, but those are `var(--sock-*)` expressions and a `<canvas>`
can't paint a CSS var → it drew GRAY. Factored the accent-override rule the cards carried inline
into one `nodeAccent(node, mode)` (`nodes/kind.ts`): kind colour by default, output-socket colour
for the type-switchable literals + the FC, always a FINAL theme-resolved hex. New DOM-free
`socketVarHex` (`palette.ts`) resolves a socket var exactly as `appTheme` bakes it into the CSS
property (slot → mode → array/matrix shade), so the DOM card, the minimap and the html-canvas
snapshot all read one source and agree. The retype already fires `area.update("node")` (which
repaints the minimap) — it was only ever reading the wrong colour. Pinned in `kind.test.ts`
"nodeAccent". FC mismatch-orange stays a card-only state (minimap shows its base type colour).

### SESSION DIGEST (2026-08-23 — lookup array-spill + shared-kernel unification, dep-diff triage)

**XLOOKUP/XMATCH: an array lookup value now SPILLS (Excel parity).** Excel returns one result
per element of an array `lookup_value`; we treated the whole array as one un-findable needle
(quiet `#N/A`). Fixed in two steps the same day: first a loud `#VALUE!` interim (honest refusal
over the quiet lie), then — after confirming the dispatch returns a RANGE_FUNCTIONS array result
as-is and it stays within the rank cap (1-D in → 1-D out) — the actual spill: both registrations
map the kernel over a list needle (`pick`, `excelFunctions.ts`) and return a result list. Author
approved supporting it (it's parity, and the "deep engine" framing applied to the GENERAL
per-argument spill, not to these two). **The XMATCH NODE was swapped to match** — it shares the
`xmatchIndex` kernel, so leaving it scalar would have drifted the two surfaces: `value` socket
`any`→`anycombo`, output `number`→`numlist`, and `data()` mirrors the formula's `pick`. The
`combo→scalar` lattice exception (`dimFlows`) keeps existing downstream scalar wires legal —
INDEX/`ListIndexNode` is the precedent for a runtime-rank output. Pinned in `excelFunctions.test.ts`
"SPILLS" and `errorValue.test.ts` "XMATCH node SPILLS". **The XLOOKUP NODE spills too** (author
asked to carry it across): `lookup` socket `string`→`strcombo`, and `data()` maps `matchOne` over a
list of lookup values — one matched cell each, `#N/A`/if-not-found per element. Its frame+column-names
shape stays (the "Build Frame first" decision); only the lookup-value axis gained rank. Pinned in
`errorValue.test.ts` "XLOOKUP node SPILLS". Surface nuance (app-wide combo convention, not a lookup
drift): a SINGLETON lookup list collapses to a scalar on a node (`collapseSingleton`) while the
formula keeps a 1-element array. Node descriptions updated.

**Then the matching KERNEL was unified (author: node and formula must not diverge; the socket guard
is the only sanctioned boundary).** My earlier "different kernel by design" was wrong — the node's
`lookupFrameRowIndex`/`lookupCubeRowIndex` were re-implementing the exact/approximate + first/last
scan a THIRD and FOURTH time alongside the formula's `xmatchIndex`. Now both delegate: they parse the
lookup STRING into a typed needle (`lookupNeedle`, the node's only extra step — its lookup socket is
string-typed, which is why the value arrives as text) and hand the match to `xmatchIndex`. Behavior-
preserving for well-typed columns (the full lookup corpus + `frameLookup`/`frameVerbCorpus` stay
green); the agreement is now a TEST (`frameLookup.test.ts` "shares the XMATCH formula kernel"), not a
comment. No Rust mirror exists for the lookup, so nothing to keep in sync there. `keyMatches` became
`lookupNeedle`; the `dateAmbiguitySurfaces` sanction updated to match.

Scoped to the lookup family: a 1×N MATRIX lookup value is still `#SHAPE!` (deferred orientation),
and the general per-argument mechanism (`wholeArrayArgs`/`prepByShape`) subsumes the formula `pick`.

**Then swept for OTHER formula/node kernel divergences (same bug class) and fixed the one real
hit: the distribution family.** The Student-t CDF was written THREE times (`mathUtils.tCDF`, a
local `tCDF` in `excelFunctions.ts`, and `tDistCDF` in `distribution.ts`), and the t/chisq/F/gamma
CDF+PDF bodies were inlined separately on the formula and node surfaces. Extracted one shared set to
`mathUtils` (`tCDF` existed; added `tPDF`/`chiSqCDF`/`fCDF`/`gammaCDF`/`gammaPDF`); both the
`registerInternal` bodies and the node's `DIST_SPECS.compute` now call them — the inverses already
shared `bisectionInv`, so sharing the CDFs unified them for free. Byte-for-byte identical to the
copies replaced (verified each form); full suite + the pre-existing cross-surface pin
(`distributionFormula.test.ts`, which the audit wrongly reported absent) stay green, and that pin now
guards a STRUCTURALLY shared kernel. The rest of the audit came back clean — finance/matrix/list/
regression/stats families already share kernels; the only softer note is vendor-vs-node cases
(STDEV/VAR/COVAR/PERCENTILE/MODE) where the formula delegates to Formula.js and the node computes
inline — not intra-repo duplication, left as-is.

**Dependency-diff triage (read the diffs, not the version bumps):**
- `@formulajs/formulajs` 4.6.0 → 4.6.1 **bumped.** The whole diff is a new `TAKE` (we already
  own `TAKE` via `registerInternal`, so upstream's — which references undefined `value`/`calc`
  — never runs) and a real `SUMIFS` fix coercing text-formatted sum-range numbers, which is
  correct-and-inert against our typed columns. Full suite green on 4.6.1.
- `rete-history-plugin` 2.1.1 → 2.2.0 **NOT bumped.** `dist/` is byte-identical; the only delta
  is a new REQUIRED peer on `rete-comment-plugin@^2.2.0` (a plugin we don't use — our own
  `commentStore`). Net negative (unmet-peer warning or an unused plugin dragged into the tree).
  Recorded in the backlog so it isn't re-evaluated blind.

**Expect alert edge-detect — verified intended + pinned (backlog fine-print (a)).** The Expect
node alerts on the SET of failing CHECK KINDS (`violations.join(",")`), not on which cells or how
many failed — a coarse "failure signature". A different cell failing the same check does NOT
re-fire; a new check joining the set does; recovery re-arms. This matches the alertStore invariant
(edge-detect on STATUS, not a boolean). Pinned in `quality.test.ts` "alert edge-detect" and
negative-controlled (drop the `key !== lastStatusKey` guard → the same-check step fires twice).

### SESSION DIGEST (2026-08-22 — card frame edges, the resizable-field grip, non-finite group keys)

**Frame edges: one fix landed, one hypothesis TRIED AND REVERTED. Still OPEN.**

What is settled:
- **Candidate (a) from the old backlog item is REFUTED.** `.solenoid-node` and
  `.solenoid-node__frame` have identical `getBoundingClientRect()`s on all 28 cards of the default
  doc at every dpr. The frame is not shorter than the card.
- **`overflow: hidden` on the body frame SVG was shaving the stroke — FIXED.** The body rect's
  stroke sits exactly ON the viewport boundary (outer edge at 0 and at 100%), so the clip could
  only ever remove ink, never contain anything: the rect cannot leave its own viewport. Measured
  A/B at dpr 1, k=0.42 with the geometry pinned to its original literals: weak-bottom cards 6/27
  -> 3/27, median bottom-edge contrast 68 -> 84. This is also what made the author see the right
  border sitting a subpixel INSIDE the card background. The HEAD viewport keeps its clip — that is
  what ends the accent cap and the divider at the header/body seam (verified still correct).
- **Two CSS fixes are dead ends, do not retry.** `vector-effect: non-scaling-stroke` is a NO-OP:
  Chrome does not compensate for an HTML ancestor's CSS transform, measurements byte-identical to
  baseline. `shape-rendering: crispEdges` is WORSE — it snaps the edge away entirely (0 ink at
  k=0.45, 0.55, 0.799).
- **Publishing a custom property on every zoom frame costs a document-wide style recalc:**
  11.8ms/frame against a 6.3ms baseline across 28 cards, and the cost is the WRITE, not the rule
  reading it (a var written but unused measured the same). Quantizing + a trailing throttle got it
  to 6.55ms. Relevant to the open choppy-zoom band: any future "publish the camera scale to CSS"
  idea carries this price.

**REVERTED: the sub-device-pixel width theory (`--frame-hairline`, `hairline.ts`).** The reasoning
was that a 1px stroke lands on `k * dpr` device pixels and washes out below one, and the bench
supported it (weak-bottom 6/27 -> 1/27 at dpr 1). The author tested it and reported the Frame
Input bottom edge COMPLETELY unchanged, plus a new artifact. It also visibly fattened grouped
cards (their 2px border became 2x the floored hairline, with a beveled inner corner where the
radius went under the stroke width). Reverted whole. Keep the measurement, drop the conclusion:
sub-pixel width is real but is evidently not what the author is looking at.

**THE METHOD WAS THE BUG. Two harness faults, both of which invalidate every bench number above.**
1. **Headless rasterizes through SwiftShader, not the GPU.** Subpixel stroke coverage is exactly
   what differs. The author's machine composites through ANGLE/D3D11 on a Radeon RX 6800 XT.
2. **A fresh browser profile has empty localStorage, so the app loads the default `getting-started`
   seed — NOT the author's autosaved document.** Every measurement in this session, headless and
   headed alike, looked at a document the author was not looking at.

Ground truth from the author's display, finally taken with headed playwright-core 1.60 (the binary
is in the npx cache; `newContext({viewport:null})` is what surfaces the real dpr):
`devicePixelRatio 1.14` (2246x1264 CSS on a 2560-wide panel), default camera `k 0.6023`, dark theme.
Every card on the default doc is `--grouped`, so a 2px stroke = **1.37 device px** — comfortably
above one, so the sub-device-pixel story cannot apply there at all. A headed sweep of all 22
measurable cards found **zero** weak bottom edges (worst bottom/left ink ratio 0.85, median ~1.05),
and a live A/B of the `overflow` clip on that hardware moved Frame Input's bottom ink by **0.0%**.

So: the landed `overflow` fix is correct and helps at dpr 1, but it is a NO-OP for the author's
case, and the reported defect does not reproduce on the default document at their settings. The
next session must reproduce on the AUTHOR'S document first — launch against their real Chrome
profile (`launchPersistentContext` with their user-data-dir) or have them name the doc and node —
before touching any CSS.

**Resizable text fields now wear the app's own grip.** The Layout field (Frame Input, Record) and
the Mermaid source ran on `resize: vertical`. The native control's DRAG is fine — measured 1:1
against the pointer at k=0.42, correctly zoom-compensated, and no dead zone after an over-drag —
but it paints a bright, heavy corner glyph nothing like the card grip, which the field's 4px radius
clips. `::-webkit-resizer` CANNOT retire it: a background/mask there paints BEHIND the UA glyph
(verified in Chrome 148). So the field sets `resize: none` and wears `FieldResizeGrip`, reusing the
card grip's mark via the extracted `ResizeGripIcon`. The field also became `display: block` — as an
inline-level child it added a line box's descender gap under itself, which hung the grip ~3px below
the field's own border.

**Display's resize grip is NOT clipped** (author asked). Measured ink extent reaches 11.7 of a
12-unit viewBox and no ancestor clips it.

**#AMBIGUOUS! was being produced correctly and thrown away four times over** (author-reported:
"02-03-2026" into List Input date mode rendered 30-Dec-1899, then a blank). `parseDate` flagged
it every time; four separate layers discarded it, each for its own reason, which is why the
symptom kept changing shape as each was fixed:
1. `parseDateToSerial` — the back-compat wrapper whose own docstring admits it flattens the
   error to NaN. Typed datelist literals (`parseListLiteral`), a wired string coerced to a date
   row (`coerceElem`), and Get Column read-as-date all went through it. Now they call `parseDate`
   and let the error through; the three-way split is right (serial / `#AMBIGUOUS!` / `null` for
   genuine non-dates). Guarded by `dateAmbiguitySurfaces` in `sourceInvariants.test.ts` with a
   SANCTIONED map — the remaining callers are ISO-gated or have no error channel, each saying
   which. Cast is sanctioned but NOT silent (a failed date cast is already `#VALUE!`); the
   `frameVerbs` lookup criterion and TablePopup's CSV import genuinely cannot report and are
   backlogged.
2. `dateFormatDisplay` mapped a date list with `Number.isFinite(v) ? fmt(v) : ""`, so every error
   AND blank became an empty cell — and the branch was gated on `typeof value[0] === "number"`,
   so a VALID leading date is precisely what silenced the error after it. Now per-cell, never
   gated on cell 0.
3. `TablePopup`'s date column ran `Number(cell)` on a grid where `toGrid` writes a blank as `""`
   — and `Number("")` is 0, a real serial. That is the 30-Dec-1899: not a parse result at all,
   just an empty cell formatted as the epoch. Same shape fixed in `PivotEditorPopup`.
4. An error cell had no styling in the popup grid. `errorChip.css` already declares itself the
   single source of truth for the `#CODE!` treatment and even lists "frame/table cell" among its
   surfaces — the grid simply never applied it. The cell now adds `.sol-error-chip`; the one new
   CSS rule defines no colour, it only wins specificity over `.table-popup__input[readonly]`
   ([class][attr]) and holds the grid's own 13px. Detection is membership in `ERROR_EXPLANATIONS`
   (a total `Record<SolErrorCode, string>`), so a new code is covered the day it is declared
   rather than when someone remembers a regex (per noManualList).
Pinned end to end in `valueDisplayFormat.test.ts` — typed text → node list → rendered cells —
because every link dropped it somewhere different. Green: tsc, 4414 vitest.

**XIRR/XNPV took their dates on a numeric list — the only two such ports in the app**
(author-spotted). `dates` was `listIn("Date serials")` where every other date-valued port
across the finance and date families (60-plus: settlement, maturity, issue, first coupon,
NETWORKDAYS holidays, Get Column read-as-date) already used `date`/`datecombo`/`datelist`.
Swept the whole catalog by CONSTRUCTING every node and comparing each port's socket
dataType against its label rather than grepping — that is what showed the convention was
total and these two were the outliers. Now `dateListIn("Dates")`. Two consequences worth
knowing: the type is the only witness that survives the value (a date serial and a number
are the same `number` at runtime, so Cast's date-aware text conversion and the FC's date
styles read the SOCKET), and a `datelist` is TYPEABLE — `coerceInputs` parses and injects
the CSV a user types, but only onto a class DECLARING `stringLiterals`, which
`coerceInputs.test.ts` caught immediately when the socket changed. Both classes now
declare it, so XIRR/XNPV gained direct date entry. Pinned catalog-wide as
`dateValuedPortIsDateTyped` (`catalogRegistry.test.ts`), wildcard rungs exempt — a
formula-preset node names its free variables as ports, so `date` in "ROUNDUP(MONTH(date)/3,0)"
is an expression variable on the generic socket, not a mistyped date port.
GOTCHA for whoever writes the next guard this way: the first version of that pin silently
never matched, because a `` written through a Python heredoc landed in the file as a
literal backspace byte and read as `/dates?$/i` in every editor. It passed with the bug
deliberately reintroduced. Negative-control a new guard by breaking the thing it watches.

**One IRR was hardened, its twin was not — both now run one kernel** (aggressive-review #8).
Periodic IRR's Newton had no rate floor where XIRR clamps at −0.9999. Not cosmetic asymmetry:
below r = −1 a fractional exponent makes `Math.pow(negative, e)` NaN and an integer one flips
the discount sign every period, so an overshoot never walks back. Over 2,930 randomised
single-root series against a bisection oracle, the unfloored solve missed 217 roots the floored
one finds, and won none. The two solvers differed ONLY in the exponent (period index vs year
fraction), so they collapsed into `solveDiscountRate`. Two things the merge had to get right,
both measured rather than reasoned: (1) a step that HITS the floor must not count as
convergence, or a pinned solve returns −0.9999 as an answer — the old dated ordering happened
to avoid this (0 bogus roots in 20k), so the kernel had to keep that property, not just the
clamp; (2) convergence must be RELATIVE — with an absolute 1e-12 the merge silently dropped 34
runaway roots (rates in the tens of thousands are real answers here), and `1e-12 * (1 + |r|)`
beats the old dated solve outright: 24,647 identical bit for bit, 63 newly solved, none lost.
Pinned in `financeIterative.test.ts`. Residual known limitation backlogged: a root crowded
against the floor (~−0.95) still reports `#CONV!`, wants a bisect fallback. Green: tsc, 4405
vitest.

**Non-finite distinct/group keys de-grouped — B-1a re-cut on both engines.** `distinct` and
`groupBy` filed +∞, −∞ and NaN into ONE shared bucket, because `encodeCell` emitted `["#", v]`
and `JSON.stringify` writes every non-finite as `null`; the Polars path deliberately mirrored the
collapse with a masked-value + is-non-finite FLAG pair. Consistent web↔desktop, inconsistent with
the rest of the app — sort puts ±∞ at opposite ends and tails NaN, aggregation reads NaN as
`#DOMAIN!` while passing ±∞ through. Now each non-finite keys by NAME under the `"#"` tag
(`["#","inf"]` / `"-inf"` / `"nan"`), so the type tag keeps them clear of a string cell spelling
"inf"; null keeps its own bucket. Rust `key_num` mirrors the tokens (fixes `distinct`), and the
group-key flag became a CLASS expr carrying the same three tokens — the null cell needs the
explicit `otherwise(NULL)` arm or it lands in the −∞ bucket (a null predicate reads as false in
every `when`). Pins updated together: the byte-identical key literal on both sides,
`row_key_keys_each_non_finite_apart` (cargo), two oracle cases, and the two re-cut corpus
fixtures. Negative-controlled: reverting the group expr alone fails `corpus_cases` with the old
one-bucket sum. JOIN is unchanged — non-finite keys still never match (NaN ≠ itself; ±∞ are
overflow sentinels), and its comment no longer claims the collapse as the reason. Green: tsc,
4398 vitest, 29 cargo.

### SESSION DIGEST (2026-08-21 — Excel-behavior sweep: finance/scalar/text, oracle + real Excel)
- **Method, and its limit.** Cross-checked node values against `@formulajs/formulajs`
  as an oracle — NOT a divergence catalogue, just a second implementation with its own
  bugs. Where ours and FX agree → high confidence. Where they DIFFER, neither is
  authoritative: real Excel from the author was the tiebreaker (twice), and FX reaches
  only ~1/3 of the finance family anyway.
- **Fixed + pinned (all verified):** FACT/FACTDOUBLE single-arg no longer read `k` (a
  wired-blank k stopped blanking the result); ISPMT sign `pv·rate·(per/nper−1)` (was
  positive); securityDisc DSM honors the basis (30/360 for basis 0/4 — the default was
  mispriced; bases 0/2/3/4 now match FX exactly, basis 1 stays the ÷365.25 actual/actual
  approx per YEARFRAC); FIXED/DOLLAR round left of the point on negative decimals;
  TEXTJOIN node default → ignore-empties (oneAnswerOneDivergence — matches the formula surface).
- **TBILL, the recall trap.** A sub-agent oracle sweep concluded "ours matches Excel"
  for TBILL; reading the code showed TBILLYIELD used 365 where Excel documents 360 —
  the agent (and my own recall) had it backwards. Real Excel (0.050718512) settled it →
  fixed to 360. TBILLEQ also lacked Excel's >182-day compounding branch (SIA closed
  form) → added, verified 0.052539935.
- **PRICEMAT/YIELDMAT were broken AND not inverses** — both used DSM for the coupon
  term and dropped the accrued-interest deduction + the issue→maturity span, so YIELDMAT
  of a PRICEMAT price returned ~26 not the input yield. Rewrote to Excel's documented
  three-span formula. FOUND BY `financeInvariants.test.ts` (new): pins relationships
  needing no oracle — PRICE/YIELD, PRICEMAT/YIELDMAT, ODD* round-trips; COUP* day-count
  identities; DURATION=MDURATION·(1+y/f); VDB total/additivity. Absolute values for the
  no-oracle functions still want real-Excel goldens (backlog).
- **Table Input blank→null round-trip** was already correct — pinned it
  (`tableInput.test.ts`); backlog item was stale.
- **sourceInvariants was red on Windows only** — `rel()` returned `\`-separated paths but
  every SANCTIONED map is `/`-keyed, so `r in SANCTIONED` never matched and 4 rules
  (retypeReconciles/perInputUnitBlind/freezeVolatilePerCalc/SSOT) reported phantom violations against already-sanctioned
  files. One-line normalize. No production code was ever wrong.
- Reverted: the XMATCH/XLOOKUP formula-surface orientation change (matrixArgs was a
  blunt switch — see backlog). Corrected the stale "not yet supported" DISC/INTRATE/
  RECEIVED reference notes (the nodes ship). Full suite green (4332).
- **Shared date parser (chrono-node).** One `parseDate` (`dateSerial.ts`) backs DATEVALUE
  (formula + node), Frame/Table date columns, Date Input, and every date caller. Wider than
  the old hand-rolled numeric-only path (ISO, day-first numeric, ordinals, month names). New
  `#AMBIGUOUS!` error (`errorValue.ts`) fires only when a numeric date could genuinely read
  either way (`3/4/2026`) — symmetric ones (`02-02-2026`) parse. Relative dates ("next
  friday") blocked → NaN for now; turning them on is a parked feature (backlog). Date Input
  stores raw source text (Frame/Table model) and dual-displays (raw while editing,
  `DD-MMM-YYYY` idle). Chevron desktop-tap regression fixed (`NodeCard.tsx`, stationary-tap
  detect). Renamed Date Picker → Date Input (Inputs group); DATE → "DATE (Build)"; Save Times
  → Date & Time.
- **Stale "not yet supported" finance/text notes swept** (`nodeExcel.ts`): every shipped node
  falsely claiming it isn't implemented now carries a real parity note — ACCRINT/ACCRINTM,
  COUP* ×6, DURATION/MDURATION, PRICEDISC/YIELDDISC, PRICEMAT/YIELDMAT, TBILL* ×3, XNPV,
  ENCODEURL. Basis coverage stated per family; TBILL/PRICEMAT/PRICE tagged real-Excel-confirmed;
  ENCODEURL's `encodeURIComponent` vs Excel `! ' ( ) *` deviation documented. FINDING (not
  yet fixed): the Duration node exposes a `basis` input but `durationValue` ignores it
  (`_basis`) — the first-period fraction always uses actual days. Noted in the reference and
  backlogged; DURATION is dominated by the integer coupon count so the effect is second-order.
- **Criteria-aggregate consistency (COUNTIF/AVERAGEIF).** Decided: KEEP them dispatching (unlike
  the blocked SUMIF). SUMIF was blocked because Formula.js mis-summed a numeric-string range;
  COUNTIF/AVERAGEIF do NOT share that bug — pinned with a numeric-string guard test
  (`excelFormula.test.ts`), so a Formula.js bump can't regress them silently. Blocking correct
  Excel functions for mere symmetry fights the zero-learning-curve mandate, and the SUMIF-only
  block is a principled asymmetry (block the broken one). Data cleanup: deleted 7 DEAD `EXCEL_GAP`
  rows (SUMIFS/COUNTIFS/AVERAGEIFS/MINIFS/MAXIFS + singular COUNTIF/AVERAGEIF) — all node-backed
  by the sumifs node, so `functionReference`'s self-heal already suppressed them at render (never
  visible; they only contradicted the gap docstring). Added the singular→one-criteria-row note to
  the COUNTIF/AVERAGEIF `NODE_EXCEL` rows.
- **Easy "not supported" node gaps closed (formula already had them).** Two node-lags-formula
  asymmetries where the formula surface already accepted the arg but the node didn't: (1)
  SUBSTITUTE gained an `instance` input — blank/0 replaces every occurrence, n replaces only the
  nth (Excel's optional 4th arg; formula was already arity [3,4]); node now parity:true. (2) TREND
  New Xs made optional — an unwired socket defaults to the Known Xs (fitted values), matching the
  formula registration's `newXs == null ? xs` and Excel's omitted new_x's. Both pinned with
  node↔formula agreement tests. Skipped (not clean): WRAP `pad_with` (entangles the unit policy —
  formula has it, node workaround exists), VDB `no_switch` / TOCOL·TOROW `ignore_empty` (need an
  impl + arity change across both surfaces, not just a socket).
- **Node↔formula CAPABILITY parity — made a standing rule (capabilityParity, shareImpl extended).** Author's
  order: the node must expose everything the formula surface can; our own two surfaces
  disagreeing is a defect (Excel/FX divergence stays a judgement call). An agent audit found
  the call-site arg scan MISSES the real gaps — they come from SEPARATE impls, not truncated
  dispatch: closed DB `month` (Formula.js fall-through, no meta arity), RANDARRAY `integer`
  (a card checkbox — a persisted boolean field in INIT_FIELD_ORDER, InterpolateNode's
  forecast-checkbox pattern), REGEXEXTRACT capture-groups +
  REGEXREPLACE `occurrence` (node ran the poorer `regexApply` path; the shared `regexGroups`/
  `replaceNth` were already there, formula already composed them — just exposed on the node).
  Enforcement is BEHAVIOURAL agreement tests per function (the only reliable guard — a missing
  socket can't be exercised); `nodeFormulaArgParity.test.ts` is a partial greppable guard for
  the dispatch-through-`resolveExcelFunction` subset ONLY, and its header says so.
- **New tool: `tools/string-editor/`** (built by an agent) — a standalone local companion that
  scrapes the running dev server, lists on-screen strings, maps each to its source literal, and
  rewrites the file on edit (WYSIWYG copy editing). Launch: `cd tools/string-editor && npm
  install && npm start` → localhost:5599. Write path re-escapes + drift-guards; node_modules
  gitignored.

### SESSION DIGEST (2026-08-19b — Decision family sweep: contributions, ties, seed)
- **Decision family sweep** (author: "the Decision matrix Node and seed could be a lot
  better") **→ decisionMatrixFamily.** Breakdown columns are now SIGNED contributions summing to the
  Score (the old post-normalize values read backwards under a negative weight); rank
  runs on the round4 score so display and rank agree (round4 also flattens −0); both
  nodes default normalize ÷Max; Sensitivity lists a dead tie's every rank-1 option in
  Winner ("UltraSlim = Budget"), #VALUE!s when no Scenarios column names a criterion,
  and gained socketDocs + a scenarios frameHint. Card: wired weights render read-only
  per row (`wiredWeights`, transient), captions cut to "Normalize"/"Output", DMBV
  jargon out of shipped copy. Pins: `decisionMatrix.test.ts`; NEW `decisionSeed.test.ts`
  holds the seed's prose claims to the engine (winner order, the flip, the exact tie).
- **Seed rewritten** (`decision-matrix.json`): DMBV provenance dropped, notes state
  verified outcomes, podium is now Select Columns [Laptop, Score] → Chart — the old
  Get Column detour fed the chart a bare list and lost the option labels.
- **Horizontal bar chart label gutter** (`chartRender.tsx`): the fixed 18px category
  gutter fit index digits only, so EVERY labeled bar chart truncated labels to their
  tails ("UltraSlim" → "im"). Now sized to the widest label, capped at width/3.
  Found via the seed's podium; eyeballed via Playwright.
- **Round 2 (author ask): the seed now runs Note-frontmatter → Add Column → matrix →
  Report.** The Screen criterion arrives from a Note whose frontmatter list
  (`screen: [8, 9, 7, 5]`) is the data and whose prose records the judgment behind
  each number; an INDEX (1,1) of the ranking feeds `=winner` and the memo Report
  renders winner + podium figure + contributions table live (verified in the
  overlay via Playwright). Normalize copy rewritten in plain speech on the card and
  catalog ("divide each column by its biggest value…", "keep only each column's
  order, worst 0 to best 1"). `decisionSeed.test.ts` now assembles the frame the
  way the graph does (frontmatter parsed, column appended) and pins the report
  wiring (every `=ref` wired; INDEX literals 1,1). seeds.test.ts hard-wrap guard
  now strips a Note's frontmatter block before checking prose (field lines are
  data, one per line).

### SESSION DIGEST (2026-08-19c — keyed seed feed; the copy-inventory tool)
- **Decision seed round 3** (author: the single-list feed was fragile; the report
  caption note was noise): the Note now exports `laptop` + `screen` lists that
  build a keyed table (Frame from Lists) left-joined onto the score table by
  laptop name — row order can no longer misalign a score. The Report caption
  note is deleted. `decisionSeed.test.ts` assembles via the real `joinFrames`
  and pins note↔table key-set equality.
- **Copy-inventory tool** (author ask, for the planned hand rewrite of all
  shipped copy): `npm run copy-inventory` extract/apply — every shipped string
  in one flat file, edits written back mechanically (structured for seeds,
  quoted-form for catalog, verbatim-unique for tsx; ambiguity skips, never
  guesses). Collector shared with the voice lint via NEW `src/graph/copyCorpus.ts`
  (lint corpus unchanged). FOUND: option-table strings (`label:`/`title:`/
  `description:` object literals — 1,361 of them) were invisible to the lint
  AND the old collector; they are in the inventory now, and folding them into
  the lint corpus is a future sweep of its own. Corpus: 3,997 strings.
  Pinned by `scripts/copy-inventory.test.ts`.

### SESSION DIGEST (2026-08-19e — floating-chrome shadows, two notches down)
- **Soft-edged shadows on floating chrome softened**, a notch being 0.05 of alpha
  on the dark ladder and 0.02 on the light one. The reach is `--shadow-pop`
  (0.3→0.2) and `--overlay-shadow` (0.4/0.3→0.3/0.2) plus their light values, and
  `palette.ts` takes the same step so non-Default palettes move with them. Six
  hardcoded shadows that never routed through either token followed: the file-name
  drop-down, isolate pill, toasts, socket context menu, confirm dialog,
  presentation bar. Geometry untouched throughout.
- **Those six had no light-theme rule at all**, so they cast dark-theme black onto
  the near-white canvas — the visible pooling under the drop-down. Each now carries
  a `:root[data-theme="light"]` override tinted `rgba(20, 30, 50, …)` at the same
  0.30 light/dark ratio the tokens use, landing them at 0.09–0.12 beside the
  token chrome's 0.05–0.09.
- Fullscreen overlays (Report, Function Reference, the two docked drawers) left
  heavy by author call — they cover the canvas rather than float over it.
- DESIGN.md's Shadow Vocabulary now names both tokens and carries their light
  values; its overlay-lift entry had drifted off the shipped value.

### SESSION DIGEST (2026-08-19d — architecture map removed)
- **Architecture map killed** (author order): the seed, `SubsystemNode`, the
  generator chain (`scan-arch-deps` / `specMap` / `archGraph` / `archSeed` + their
  tests, including the same-commit file-coverage guard), the View menu entry, and
  the npm script. A precisely-specced replacement is coming from the author —
  backlog holds the placeholder.

### SESSION DIGEST (2026-08-19 — Record figure: a resized Display clipped the row pager away)
- **Record's `picked` row output removed** — an unwanted addition that rode in with
  the Gallery/Board ops (2026-08-18). Gone: the output, its socket doc, and the
  `data()` return field. Record emits `chart` only.
- **A resized Display clipped the drawn record card's row pager away** (author bug
  report): the card is content-driven and `MeasuredChart` clips a manually-sized
  Display's figure box, so the pager — last in the flow — lost its bottom edge, and
  the whole control at the 230×150 resize floor. The card view is now a flex column
  filling a definite host height (`.sol-record-card`, `chartCards.css`): the GRID
  area is the only thing that shrinks, the pager never does. Auto-height hosts (the
  unsized Display, the chart popup) resolve the `100%` to auto and measure
  byte-identical. Verified live at unsized / short / floor / tall — the arrows still
  step rows with the grid clipped hard.

### SESSION DIGEST (2026-08-18b — seed menu grouped; ONE save format)
- **Tinted chrome follows the accent** (author ask): Orchard and Blueprint declare
  the accent slot their ramp was authored against (`CHROME_HOME`: green / blue) and
  `appTheme` rotates the whole ramp to the live accent's hue — in OKLCh, chroma and
  WCAG luminance both held, so the tint stays exactly as strong as authored and the
  paletteAllOrNone structure survives any accent; byte-identical passthrough at the home accent,
  achromatic accents (gray slot, neutral cycle) leave the ramp authored, the other
  palettes hold still by brief. The first cut rotated in HSL and the author called
  it "washed in the color" — HSL saturation is hue-anisotropic (2× perceived chroma
  on Orchard's dark ground); the socket-sibling HSV rule is untouched (fixed
  near-hue steps vs a cross-hue rotation — boundary now written into DESIGN.md).
  paletteAllOrNone amended; pinned in `palette.test.ts` § accent-adaptive (chroma-never-inflates
  + structure × all 12 accents); eyeballed via Playwright (redprint
  Blueprint@vermilion, blossom-whisper Orchard@pink, identity shots unchanged).
- **UI-copy register experiment** (author ask; standards override §7 for this work):
  sampled the string corpus twice (stratified `shuf` over catalog / help / socket
  docs / tooltips / settings / dialogs / states) with rewrites shown in chat.
  Verdicts: ASD-STE100 DROPPED (1.5–2× longer, kills catalog density); Google
  developer style is a fit for the chrome register (tooltips, settings, dialogs,
  placeholders, empty states) — biggest real findings: the articles rule ("Don't
  skip articles for brevity") bites the house fragment tooltips, `example.com` for
  example URLs, third person for software behavior vs imperative for user commands.
  The guide is fetched (curl + browser UA; WebFetch fabricates) and kept as
  `docs/google-style/` — the ARBITER for word-level calls; a from-memory pass
  missed the articles rule and cited a nonexistent error-message page. SWEEP RUN
  (author go; six Sonnet-medium workflow agents over disjoint file shards):
  ~105 register-only edits in 45 files — semicolons→periods, slash alternatives→
  or/and, articles onto fragments, caps-emphasis lowercased, e.g./via banned,
  wire→connect; catalog/help got the constrained hard-rules pass only. Agent
  skips honored names (multi-item slash chains, formula labels, muted micro-
  labels); orchestrator reverted one agent overreach (Table Info ROWS/COLUMNS
  labels ARE the Excel function names) and hand-swept the statusMessage strings
  in nodes/sink+obsidian that no shard covered. Author flagged the count as low
  — measurement agreed: rounds 2–3 (five more Sonnet-medium agents) took the
  semicolon-splice mass round 1's briefs excluded — catalog 101→6 (the 6 are
  the semicolons.txt series-with-commas exception), help 20→4, socket docs +
  op-meta + solError messages in nodes/ →0 — socket docs joining the Google
  register once STE's claim on them died. ~180 further edits; orchestrator
  hand-closed the cross-file duplicates (excelFunctions/valueKinds singular-
  matrix + overflow messages) and one pre-existing TRIM grammar bug. tsc +
  full vitest green after every round.
- **Dev server starts through a launcher** (author ask): `scripts/dev-up.mjs` spawns
  vite detached, polls until :1420 answers, exits — `/startup` runs it in the
  foreground so the task actually finishes; stop advice is the self-match-proof
  `pkill -f '[v]ite'`.
- **The example menu is grouped** (author ask): every seed JSON declares the three
  menu-only fields — `order`, `label`, `group` — and the documents menu renders group
  sub-heads (`.solenoid-doctitle__group-head`, one visual step under the section head).
  Six groups in a learn-the-app arc: Start here → Tables → Values & units → Modeling →
  Charts & reports → Worked examples; orders in clean per-group bands (0/10, 100s…500s).
  Labels case-normalized to sentence case (LAMBDA keeps its caps). `SEED_GROUPS`
  (`seeds.ts`) partitions the ordered list; `seeds.test.ts` pins label/group/unique-order
  on every seed so nothing regresses into the old unlabeled alphabetical tail.
- **ONE save format** (author order, no back compat): all 23 seeds stamped `v: 2`, and the
  loader opens ONLY `CURRENT_SAVE_VERSION` — `validateSavedGraph` requires a numeric `v`,
  `loadGraph` refuses older/missing (new notice) as well as newer (kept), `graphValidate`
  flags any non-current `v`. The generated seeds' generators
  (`gen-personal-finance-seed.cjs`, `archSeed.ts`) emit the menu fields too;
  `seeds.test.ts` pins every seed at the current version.
- Verified in the live app via Playwright (grouped menu renders with the two-level
  hierarchy; a template click-through loads clean) plus the full vitest suite.
- **Record gallery tiles by masonry** (author: "a better tiling algorithm, look one
  up"): `masonryLayout.ts` runs the CSSWG masonry explainer's `definite-first pack`
  rule (the Pinterest algorithm — native CSS masonry is still flag-gated in
  Chromium) over tracks justified to the measured container (aim 170 / min 140 /
  max 260, never more tracks than cards). `RecordGallery` measures tiles with a
  ResizeObserver and holds first paint until tracks settle. Pinned by
  `masonryLayout.test.ts`; eyeballed in the Display, popup, and Report embed.
  Arch seed re-emitted (new module shifted an import count).
- **Record layout syntax: `*N` spans and `: placeholder` hints** (author asks):
  `Photo*2` widens a cell N columns (expanded before the rect walk, so it
  composes with repetition and shifts later cells); a first colon splits off a
  hint — `Qty: e.g. 40` — shown muted in an EMPTY box (`RecordField.hint`) and
  as the input `placeholder` in the popup Form view (one parser feeds both).
  The record-cards seed's Photo is now 2 wide via the new syntax; the layout
  socket doc teaches both forms; parser pinned in `visual.test.ts`. The layout
  textarea the Record card and Frame Input card each hand-rolled is extracted
  to `RecordLayoutField` (commit semantics stay per-card).
- **Record figure: title + pager on the drawn card** (author bug report): the
  card's move off the node card silently dropped both. The figure now draws the
  explicit options title (series-chart convention; popup/Report strip it — the
  doubled-title latent in both is gone), and `recordNav.ts` puts the row pager
  on drawn cards in the Display and chart popup (single-inlet upstream walk to
  the steppable Record; wired Row still wins and hides the arrows).
- **Mobile Inspector under the header** (author bug report): the full-width
  mobile sheet kept the desktop dock's z 90 + side shadow, painting over the app
  bar's popovers (they cap at the header's z 6) and shadowing the bar. Mobile
  sheet now z 5, shadowless; align pill joins the open-sheet hide list;
  `layout-chrome.md` updated.
- **Record Options socket documented in the Inspector** (author ask, then cut down
  by author): the entry prints the syntax directly — `title=Parts;fontsize=12`,
  the only two keys a record figure reads.
- **Competitor dive round 3 — display surfaces around Record** (author steer: UI,
  not data processing): verified patterns from Airtable (gallery grouping, grid
  group summary bars, expanded-record prev/next, attachment preview) and Notion
  (side/center peek, list view); nine UI candidates appended to the deferrals
  steal entry (top fits: List as a fourth Record op per oneRecordNode, grouped gallery
  sections, lane summary line, image lightbox, popup pager, peek dock).
  Calendar figure listed but flagged under the author's Gantt "not now" ruling.
- **Competitor dive round 2 — Solenoid-wide** (author widened scope): surveyed the
  Alteryx-pattern incumbents (KNIME/Alteryx, @RISK/Crystal Ball, Mathcad,
  Quantrix/Causal, Stella/Vensim, Power Query) + canvas donors (n8n, Blender,
  marimo/Observable) against `out-of-scope.md`, decisions, v2.0 bundles, and the
  CODE. Nine verified-absent candidates parked in `deferrals.md` ▸ "Solenoid-wide
  steal map" (top fits: column profiling in the table popup; pin-a-node's-output;
  mute/bypass; distribution fitting + correlated MC; simulation trajectory
  capture; constrained optimizer). Confirmed already ours: scenarios/data-table/
  goal-seek/simulation run modes, unpivot, stale dots, isolate, Tornado.
  Sources: KNIME/Alteryx docs+comparisons, Lumivero @RISK, PTC Mathcad, Quantrix
  blog, n8n docs (pin data/partial exec), Blender manual (mute/viewer), marimo
  dataflow docs, MS Power Query docs (profiling/folding indicators).
- **Record-family competitor dive** (author ask): Airtable/Grist/Notion/Baserow/
  NocoDB/SeaTable/Coda card+gallery+board features surveyed; the steal list is
  parked in `deferrals.md` ▸ "Record family steals" (best fit: gallery-click →
  row pick; cover image; title row; size presets; lane counts/collapse; color-by
  flagged conditionalFormatting-adjacent). Sources: Airtable gallery/kanban help, Grist widget-card +
  record-cards docs (raw GitHub), Notion gallery help, Baserow/NocoDB view docs.
