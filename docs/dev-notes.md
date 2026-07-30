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


### Note markdown reads the note's accent, not the app's (2026-07-30i)

`.solenoid-note__rendered.sol-md` inherited the shared doc styles wholesale, so
the note body's links took `--accent` (the APP accent) and its code / tables /
rules took the neutral chrome tokens — while every other part of the card
(border, header, chevron, title, fields separator, grip) is drawn from
`--note-color`. That's the Nearest-Accent Rule: inside a surface carrying its
own accent, the surface's wins, or a gold link sits inside a violet note as two
unrelated hues on one small card.

Note-scoped overrides in `NoteNode.css` now mix the structural marks off
`--note-color`: headings 40% toward `--text-bright`, links 72%, code/pre/kbd/th
fills 14% over `--surface-sunken`, hairlines (code + table edges, the h2
underline, `hr`) 30–45% over `--border`. Prose (p / li / strong) and the
blockquote are untouched — the quote's 3px left rule stays neutral because a
colored one is the banned accent stripe.

CSS-only, and reactive for free: the mixes resolve `--note-color`, which
`NoteComponent` writes inline from `themeAccent ∘ resolveColor` and re-renders
on both a swatch pick (`pick` → `area.update`) and any palette/theme change (it
subscribes to `appThemeStore`, which `appTheme` re-notifies from
`paletteStore.subscribe`). The Import-from-Obsidian card renders the same
classes over its own `--note-color`, so it picked this up unchanged. Percentages
are the tuning knob.

### Column source reads "Data"; the seed drops its gratuitous @ (2026-07-30h)

Three author copy/idiom corrections, no mechanism change.

1. The TablePopup per-column source select's first option is **Data**, not
   "Typed" — it sits directly under the type-cycle glyph (Number/Text/Date/
   Boolean), so "Typed" read as a second, contradictory type control. The
   value is still `""`; only the label moved.
2. `computed-columns.json`'s Margin rule is now `LAMBDA(revenue, revenue *
   0.25)` — a declared param that binds to the column BY NAME — instead of a
   zero-param λ reading `@revenue`. Both compute; the param form is what
   you'd actually write, and it drops the inert `revenue` capture socket the
   @-name grew (the 2026-07-30 "the λ owns its names" ruling).
3. Same seed, the CC verb reads `scaled = revenue * @scale`. A bare column
   name in a row formula ALREADY resolves to this row's cell
   (`computedColumnCore` binds it `{kind:"col"}` and indexes per row), so
   `@revenue` was noise. `@scale` stays and is load-bearing: `scale` names no
   column, and only the @-path reads a wired row-aligned list element per row
   (a plain variable would be a row-invariant side value).

The seed's notes said "a plain name reads the column of that name and `@name`
reads *this row's* cell", which is simply wrong — both are this row's cell.
Rewritten to the real distinction: @ is how you reach a name that ISN'T a
column. Re-verified through the headless runner, values unchanged (margin
90/140/135/100, scaled 360/1120/1620/1600).

### FC complex verification: popup done, render half unwired (2026-07-29d)

The backlog's "verify FC complex styles against the format-model truth table"
item: verified. The POPUP half is correctly implemented (`controlsFor` +
`COMPLEX_FORMAT_STYLES` gate to auto/decimal/scientific; precision + unit rows
show; advanced tier correctly absent). The RENDER half is NOT wired at all —
the complex cards pre-format to strings inside `data()` (`formatCxValue`,
fixed 4-digit trim), so a docked FC's annotation never reaches a complex
value on any surface. format-model.md's vague "may lag" warning replaced with
this precise status; the build (annotation-aware formatCx + routing the value
boxes/chips/Display) is a visual change and sits in the backlog for an
author-eyeball loop.

### D25: no per-cell formulas, ever (2026-07-31e)

Author ruling, verbatim intent: grid-cell formula typing is "too Excel" —
"100% unbreakably consistent columns are a must." The backlog idea dies
(deleted, not deferred); recorded as D25 (the D10 class: eliminated stays
eliminated) and stamped into the design doc. A column's definition lives
on the COLUMN — one Formula or λ for all rows — on every surface, forever.

### Computed columns: copy/CSV/sort read the derived values (2026-07-31d)

The popup's working grid holds "" for computed columns (no raw text), so
Copy / Copy-as-Markdown / Export CSV emitted BLANKS for them and the
visual sort had no keys. `rawAt` now substitutes the derived values (raw
string form: TRUE/FALSE, error codes) into the shown window and the sort
keys; `grid` stays the edit/save truth (computed cells are read-only, and
Save drops their cells regardless).

### Live commit: the formula applies on blur (2026-07-31c)

Author: "the typed formula column must update on blur." The popup's source
model was popup-local until Save; now it WRITES THROUGH live via a new
`onCommitSource` on the popup contract (Frame Input implements: set
frameText → reconcileTypesAfterEdit → targeted processGraph → hand back
the fresh derived cells + types). Triggers: a Formula input's blur/Enter
(draft-local per keystroke, Escape reverts to the last committed text —
the app-wide commit rule, with an escape flag so the revert's blur can't
commit the stale closure draft); a COMPLETE source pick (Data or a λ —
Formula waits for its expr); and a computed column's unit pick (its tag
rides the derived value, so it can't wait for Save). The popup overrides
its opening snapshot with the returned cells/types (`liveComputed`), so
the result shows in place; Save stays the closing no-op re-commit.

### Format + unit selectors work on computed columns (2026-07-31b)

Author ask. Three seams closed: (1) Frame Input's compute path now carries
the source column's `unit` onto the rebuilt computed column (number-typed,
deriveFrame's exact rule) — it used to DROP the tag, so the popup's unit
dropdown saved a choice that never reached the value; (2) FrameChip passes
the DERIVED type for computed columns, so the format row shows the right
selector family for what the cells actually are; (3) computed cells render
their raw derived VALUES through `controlledCell` — the same per-column
format+unit path literal cells use — instead of pre-formatted strings that
bypassed the controls (`computedCells` is now `Cell[][]`). Unit-ride pin in
computedColumn.test.ts (60).

### Bracket references replace col()/at() (2026-07-31a)

The author: "why not the [] bracket syntax." Right — brackets are what an
Excel-tables user types; col()/at() were the cheap path. Both functions are
DELETED (registrations, meta, signatures); the grammar gained structured
references: `[Unit Price]` = the whole column, `@[Unit Price]` = this row,
and Excel's own `[@Name]` / `[@[Name]]` spellings parse too. New
colref/rowref tokens + a `wholecol` AST node (evalAst → readWholeColumn;
tex/numeric/equation/unitDim walks; tsc exhaustiveness found them);
collectRowRefs feeds the topo from both; atColNames filters λ captures to
identifier @names (a bracketed name can never be a variable). Highlighting
colors a whole bracket ref as one fx-var token. Dynamic col(expr) names
lost their spelling — accepted (Get Column territory). D24 amended in
place; seed/catalog/docs re-spelled.

### D24: Excel table semantics — bare = whole column, @ = this row (2026-07-30h)

The author's late-day concern — "filter column A by this row's B needs
whole references mixed with @" — exposed that the whole column was
UNSPELLABLE (bare names read this-row) and inconsistent (bare SIDE values
already meant whole), with a silent trap (`revenue / SUM(revenue)` = 1.0
per row). Ruling: **the Excel version** — recorded as D24, built same
turn:
- Bare column name (inline exprs) = the WHOLE column as a list; `@name` =
  this row. `@revenue / SUM(revenue)` and `SUMIFS(amt, cat, @cat)` work
  verbatim. A bare column in scalar position is a LOUD per-row #SHAPE!
  whose message points at @ — the old trap's silent 1.0 is dead.
- λ PARAMS stay row-bound (the λ's explicit per-row interface); picker
  bindings follow the same split (expr var → whole target, λ param → row).
- Unspellable names use Excel's BRACKET syntax (amended same day — the
  first cut shipped `col()`/`at()` functions, the author asked "why not the
  [] bracket syntax", both functions deleted): `[Unit Price]` = the whole
  column, `@[Unit Price]` = this row, and Excel's own `[@Name]` /
  `[@[Name]]` spellings parse too. New tokenizer colref/rowref tokens + a
  `wholecol` AST node (all four walks; tsc exhaustiveness); both feed the
  topo (collectRowRefs); neither grows λ captures (atColNames filters to
  identifier @names). Dynamic col(expr) names lost their spelling —
  accepted, that's Get Column territory.
- Inside a λ body a bare free name is still a capture (the definition owns
  its names); whole-column reads there are `[name]`.
- Core: bindings split by spec kind (`wholecol` passes the same values
  array every row); the row context grew `whole()`; the per-row error
  pre-check now applies to ROW-bound cells only (errors inside a whole
  column flow into aggregates).
Rewrote: the seed (share column = the D24 headline; @-exprs), catalog
copy, placeholders, signatures, 23 pins + 2 new (59 in
computedColumn.test.ts). decisions.md D24 has the full record.

### Backlog claim stale: topology recompute IS targeted (2026-07-30g)

The queued "extend targeted recompute to topology changes (D8 follow-
through)" was already BUILT — audit finding 40, landed `35fe709` (the 1.2
cycle): the Canvas `connectioncreated/removed` settle runs
`processGraph(cable.target, …, { topology: true })` — the target's
downstream closure only, plus the loop-cache refresh (the one global a
cable change touches); bulk ops settle once via `withGraphRebuild`;
`processTargeted.test.ts` guards the closure≡reset equivalence. Backlog
line deleted; D8's "cost accepted: full recompute on connect/disconnect"
clause corrected (it recorded the pre-landing state).

### Ops lists: the AggOp table + the Percentile trio (2026-07-30f, amended same day)

The searchability gap's easy half — with one AUTHOR RULING mid-flight:
**aggregators are ARGS, not ops, and are NOT searchable.** The first cut
gave Pivot/CubeRollup/GroupByFrame searchable op rows ("Group By: MEDIAN");
the author struck that, and it took the 1-D Group Lists' pre-existing rows
with it — all four aggregator hosts are now kind-only `argument`
declarations, and `op-exposure.ts` skips argument-kind families outright
(their variants are parameters, never exposure gaps; this also
retires its GroupByFrame→GROUP_BY_OP_META mis-join for good).

What stands: `AGG_OP_META` (nodes/frame.ts) is the ONE AggOp table — the
Group By / Cube Rollup card dropdowns and the Pivot editor's per-value
selector derive from it (`pivotOnly` keeps PERCENTOF to the pivot editor,
since only the pivot assembly computes the relative total set), replacing
two drifted hand lists. And Percentile/Quartile/Percentrank declare
inc/exc with PERCENTILE.INC-style search names — those ARE Excel functions
(operation-kind; the names already dispatch via Formula.js, FX-4 sweep
green). Remaining in the backlog item: the 17 distributions
(leaf-vs-search question).

### Small-queue pass: release-notes reconcile + INDEX-cube slices (2026-07-30e)

Two small items while the author is away. (1) `release-notes-features.md`
reconciled against the 188 commits since v1.2.0 — three slide headliners
now (computed columns; matrix formulas & LAMBDA + the full parity closure;
Query) plus a body list (element-wise families, frame-verb redirects,
popup column sort, op-exposure search, corpus-verified engine parity,
touch fixes, socket/copy polish). (2) INDEX over a CUBE types its
whole-axis slices: `cubeProjection` — any BLANK unwired axis ⇒ `cube`
(data() keeps nested cells whole; one blank axis guarantees a cube
whatever the other says), Row AND Column both given (or wired) ⇒ the
placeholder (a single cell is genuinely unknowable). Backlog line
deleted; pins in trueAnyAdopt + passthroughSystem (the old "cube is
unknowable" pin updated — it now depends on the axis literals).

### Identity-stable computed frames — mitigation (a) built (2026-07-30d)

The scale assessment's cheap rung, landed: an unchanged pass now returns
the SAME objects end to end, so `_sourceCache` (identity-keyed) keeps its
Polars handle across full recomputes instead of re-uploading computed
frames every pass. Three memos, each keyed on what actually shapes the
value: **LambdaNode** (expr + params + captured values by Object.is +
descriptions) returns the same `LambdaValue`; **Frame Input's computed
path** (`_computedFrom`: frameText + per-λ input identities); **the CC
node** (`_lastKey`: input frame identity + λ identity + expr/addAs/name/
after + bindings JSON + side values by Object.is). The chain composes: a
stable λ makes the Frame Input stable makes downstream identity checks
hold; any upstream that mints fresh objects just misses harmlessly (a verb
ref's collect is per-pass — the CC-after-verbs case still re-collects,
that's rung (b)'s territory). Errors are never memoized. 2 pins (57).

### Computed-column scale: measured envelope + a quadratic killed (2026-07-30c)

Benchmarked `computeColumnCells` (tsx, this container — relative numbers are
what matter): the interpreted row loop runs **~0.4–0.9 M rows/s per
computed column** (simple arithmetic ~0.9M, a ROUND() call ~0.4M; λ vs
inline expr is a wash; column count is irrelevant — the row context is
Map-indexed). Envelope: 10k rows ≈ 15–25ms/column, 100k ≈ 100–225ms, 1M ≈
1.1–2.4s. Columns stack linearly.

Killed while measuring: **the @-list read was QUADRATIC** — `at()` ran its
matrix-scan + length validation (O(list)) on every row, so a 100k-row
`@scale` read cost 3.9s (and 1M extrapolated to ~6.5 min). The verdict is
now memoized per name (row-invariant by contract): 213ms at 100k, 2.4s at
1M — linear.

The REAL scale costs are architectural, not the loop (assessment, nothing
built): (1) the CC node is a **materialization barrier** on desktop — verbs
chain lazily in Polars, but coerceInputs collects the ref for every other
node, so Filter → CC → Sort = full download + JS loop + re-upload; (2) the
re-upload repeats every pass because `_sourceCache` keys by FrameValue
IDENTITY and the CC node (and Frame Input's computed path, deliberately)
emit a fresh object per data(). Mitigation ladder if heavy-data computed
columns become real: (a) memoize CC output by input-identity + config so
the handle cache holds across passes; (b) transpile the expr subset to a
Polars `with_columns` verb (JS oracle stays the λ/fallback path — the
frameVerbs seam); (c) compile the interpreted evaluator (web-only gain once
b exists).

### The computed-columns seed + the sideVars load fix (2026-07-30b)

`seedGraphs/computed-columns.json` ("Computed Columns & @", order 18, author
request): one canvas touring the whole surface — a Frame Input whose
`revenue` is a Formula column (`price * qty`) and `margin` a λ column bound
to a wired ZERO-param λ reading `@revenue` (intra-table topo on display),
then the CC verb node adding `scaled = @revenue * @scale` with the scale
LIST wired to the @-grown side port. Verified by the headless runner, not
just the seed sweep: margin 90/140/135/100, scaled 360/1120/1620/1600.

Prerequisite fix the seed exposed: **CC side sockets now persist**
(`sideVars` joined INIT_FIELD_ORDER; the constructor regrows the sockets,
the Expression pattern). Before, a saved cable into a side socket DROPPED on
reload — connections restore before the first data() would have re-derived
the socket. The reconcile still owns growth/pruning after load. Pinned in
computedColumn.test.ts (55).

### @ over side values + binding pickers (2026-07-30a)

Two Computed Column moves, author-directed.

**@ reads row-aligned side LISTS, not just columns.** The author's shape:
`λ(qty, price) → qty * price * @scale` where `scale` is a 5-row list, not a
column. Resolution chain in the core's row context (shared by `@` and
`col()`): the column → the `row`/`rows` builtins → the DEFINITION's own
environment → the surface's SIDE value — a list must line up with the
frame's rows (mismatch → per-row #SHAPE! naming both counts; a matrix
refuses), a scalar reads the same every row. **Where the port grows
(author-corrected same day): the definition owns its names.** A λ's `@name`
grows a CAPTURE socket on the Lambda card (`atColNames` joins `_rebuild`'s
free-variable set; the first cut routed λ @-misses to the CC node's side
ports and the author overruled it — "@ swallowing them left no place to wire
the value"). Columns/builtins win over the capture at row-eval, so a table
λ's `@price` still computes with zero wiring and its unwired capture is
inert; `@row`/`@rows` capture nothing. The eval seam: `readRowCell` takes an
env-fallback the `atcol` case supplies, and a captured list is row-indexed
(length-checked) like any @-read. The CC node's side ports serve its OWN
inline expr's @-misses (rowRefs, filtered by a wired λ's `captured`); COL()
reaches columns + side ports but never captures (its impl has no env — @ is
the capture-reaching form). Side sockets widened `anyIn` → `anyDataIn`
(rank ≤ 2, the Expression variable socket) so lists can actually wire in —
which also makes the core's long-stated "a whole list for SUM(...)"
side-value contract reachable. Behavior flip pinned: `col("nope")` on the CC
node now grows a side port reading its default (like any unknown name)
instead of erroring; the per-row `#REF! No column` case stays on the
port-less Frame Input sources.

**Binding pickers.** Explicit variable/param → column bindings
(`bindings: Record<string,string>`, persisted via a bespoke extras block —
live-vars-only + sorted keys, the varDescriptions pattern). The core's
`alias` opt: a bound name is ALWAYS a column read (stale target → #REF!
naming both ends, never a silent fallback); a bound would-be side var loses
its socket. Card UI: one `field-row` per variable (auto | column names),
shown once a frame is wired, fed by the transient `sourceColumns`/`defVars`
stash (Pivot's pattern). 9 pins (54 total in computedColumn.test.ts).

### Surface slice 2 SHIPS: the Formula column source + the chip's ƒ (2026-07-29p)

The pure-text rung of the column-source ladder, per the ratified design:
- **`FrameSourceColumn.expr`** — an inline row-wise formula on the column
  itself, riding `frameText` (serialize/parse; blank exprs dropped). A
  `lambda` binding wins when both are set (the wired, reusable definition,
  mirroring the CC node's λ-over-expr precedence); removing the λ socket
  falls the column back to its expr.
- **Frame Input's topo loop generalizes** to computed = λ OR expr: deps for
  an expr column are its variables + `rowRefNames` (so `@`-only formulas
  order correctly); a non-parsing expr fills the column with #VALUE!; a
  variable naming no column is a per-row `#REF! No column "x"` (Formula
  columns have no side inputs — that's the CC node's/λ-captures' job).
  Compiled evaluators cache per expr text across data() calls.
- **TablePopup (C2)**: the source select now reads Typed | Formula | λ… and
  renders for EVERY literal-source frame editor (it no longer waits for a λ
  socket to exist); picking Formula opens an =-prefixed formula row under the
  header — one definition per column, popup-local until Save. Type-cycle
  hides on computed columns either way.
- **The chip's ƒ** (C2's glyph): a Frame Input chip with computed columns
  reads `[3×4 Frame ƒ]`, title counting them — the at-a-glance mark that part
  of the table is defined, not typed.
7 pins (45 total in computedColumn.test.ts). C4 (the author eyeball of the
computed-cell look + formula row) is the surface's only open item; the tail
(binding pickers, per-column format on the CC node) stays in the backlog.

### The @ operator: this-row reads, Excel's [@Price] as @price (2026-07-29o)

Author proposal, built: `@price` is Excel's table this-row reference, and it
makes the ZERO-PARAM λ the natural row formula — `λ() → @price * @qty`
computes a column with no param↔column binding ceremony at all. Mechanics:
- **AST**: a first-class `atcol` node (identifier names only; extractVariables
  skips it, so `@price` never grows a socket or a λ capture). Tokenizer takes
  `@`; the parser reads `@name` in primary position; KaTeX renders `@name`
  literally; the equation/unit/step-trace walks each carry the case (tsc's
  exhaustiveness found all four).
- **The dynamic row context** (computedColumnCore): the core pushes a
  current-row accessor around EVERY evaluation — the inline expr and a wired
  λ's body alike — and `readRowCell` resolves against the stack top. This
  replaced the env-injected col accessor, which also FIXES col() inside λ
  bodies (it only worked in inline exprs before). Outside any row context, @
  and COL answer a targeted #REF! ("read the current row…"), never a typo's
  #NAME?.
- **COL is now a REGISTERED native** (`EXCEL_IMPL_META`, returns any,
  arity 1) — the spelled-out @ for names an identifier can't
  (`col("Unit Price")`, `col(2024)`), dispatching case-insensitively,
  advertised + hinted like any function.
- **Topo integration**: `rowRefNames(expr)` collects `@name` + col(<literal>)
  reads, and Frame Input's dependency sort unions them with the λ's params —
  a zero-param λ reading `@revenue` still orders after the revenue column
  (and cycles through @ still refuse).
- Highlighting: `@name` colors as the variable it behaves as (fx-var).
6 pins (38 total in computedColumn.test.ts).

### Surface slice 1 SHIPS: Frame Input λ columns (2026-07-29n)

The ratified design's first slice, end to end:
- **Model**: `FrameSourceColumn.lambda?` (the λ input key defining the
  column) rides `frameText` (serializer + parser); a computed column's raw
  cells are empty — the raw-text guarantee is now a per-column fact.
- **Node**: `FrameInputNode.lambdaKeys` (persisted via INIT_FIELD_ORDER) +
  addable `lambdaIn` sockets (`addValueInput`/`removeValueInput`, the
  ExtensibleInputs contract — removing a λ row unbinds its columns back to
  Typed). data() computes λ columns via the SHARED core in TOPO order (a
  computed column can reference another; declaration order is irrelevant), a
  cycle refuses per column with #REF! naming the members, an unwired λ leaves
  its column blank, an unbound λ param errors per row pointing at captures.
  Computed frames skip the identity cache (λ results change without a text
  edit). inferColumn supplies TYPE only — its constructed column would mangle
  per-row SolErrors (caught by the pins).
- **UI**: the card grows the λ input group (ExtensibleInputs, new `minRows=0`
  — an optional group's last row can go; `lambda` joined the wire-only row
  types); the TablePopup's editable header gains the per-column SOURCE select
  (Typed | λ…, rendered only when the host has λ inputs), computed cells
  render read-only in a quiet frame-violet tint from the derived frame
  (`computedCells` threaded chip→popup), the type-cycle hides on computed
  columns (type is inferred), Save writes `lambda` back through
  buildSourceColumns. C4 (the computed-cell look) awaits the author eyeball.
5 slice pins (32 total in computedColumn.test.ts). Slice 2 next: the Formula
source (popup editing) + the card-chip glyph.

### The computed-column SURFACE: design bundle + shared core (2026-07-29m)

The author raised the altitude: computed columns should live PER-COLUMN in
Frame Input too ("maybe frame input grows addable lambda sockets… columns
pick from inputs"), with the full ladder — trivial math as text, reusable
math as a λ, arbitrary logic as a node subgraph injected back — because
"a very large percentage of Excel work is table computed columns, we can't
half-ass this UIUX surface." Two deliverables:
- **`v2.0/19-computed-column-surface.md`** — the design: every editable-table
  column has a SOURCE (Typed | Formula | λ | Wired list); Frame Input grows
  extensible λ/list input groups; intra-table references evaluate in topo
  order with per-column #REF! on cycles (in slice 1, not later); the wired-
  list source is the node-built injection path (upstream data only — feeding
  a table's own output back is a graph cycle and refuses as one); the CC verb
  node stays as the mid-pipeline form. Crux decisions C1–C4 wait on the
  author (λ sockets individually-addable vs a lambda-list type; where Formula
  text is edited; Frame from Lists' fate; computed-cell rendering).
- **`computedColumnCore.ts`** — the row-eval rules extracted to ONE module
  (binding precedence, row/rows, col(), the per-row contract) so the CC node
  and the coming Frame Input sources cannot disagree; the node now only
  supplies its ports. 27 pins (kitchen-sink round added: IF/UPPER/TEXT
  chains, a λ erroring one row, col()+column+row+side in one formula).

### Computed Column v3 — col() for unspellable names, rows, placement (2026-07-29l)

The author's next two catches, closed:
- **Columns a variable can't spell** — a "2024" year column, "Unit Price".
  The `col` accessor: `col("Unit Price")`, `col(2024)` (a numeric literal
  coerces to the NAME, never a positional index — deliberately unlike
  requireColumn's `^\d+$` fallback). Mechanically an env LAMBDA injected per
  row and resolved by the evaluator's higher-order call path (the 2026-07-28
  `f(x)` machinery), so `col` never parses as a variable and never grows a
  side socket; one closure serves every row via a cursor. An absent name is a
  per-row #REF! cell. This also un-blocks the picker item's worst case —
  pickers are now purely a comfort, not the only path.
- **`rows`** — total row count builtin (`row / rows` = position fraction);
  shadowed by a real column like `row` is.
- **Placement** — the `After` input (socket + literal): blank appends at the
  end; a column name inserts the NEW column right after it; a REPLACED column
  keeps its position regardless (replacement detected by column count, not by
  re-parsing the unit header); a missing anchor is #REF!. `after` joins the
  reserved input names.
Six more pins (24 total in computedColumn.test.ts); catalog copy teaches
row/rows/col().

### Computed Column v2 — the author's "it's missing a ton" round (2026-07-29k)

Four holes the v1 shipped with, all closed:
- **Side inputs** (the Expression idiom restored): a variable naming no column
  becomes an input SOCKET (`anyIn`), row-invariant, with an inline literal
  default (0). Grows/shrinks from data() via the reconcile-in-a-microtask
  pattern (Expression's result-rank swap); a column appearing with the same
  name takes the variable over and drops the socket's cables. A wired LIST
  side input is legal — `price / SUM(prices)` is percent-of-total in ONE node,
  totals wired the graph-native way.
- **`row`** — the 1-based row number as a builtin variable; a column named
  `row` shadows it (user data outranks convenience). Reserved input names
  (frame/name/fn) refuse with #REF!.
- **Output type control** (`addAs`: Auto/Number/Text/Date/Boolean, persisted —
  the field name reuses Add Column's): Auto infers; Date is the case inference
  cannot reach (a serial is indistinguishable from a number). `start + 7` can
  finally BE a date column.
- **λ side params**: a λ param naming no column becomes a side input too, so a
  generic λ(v, rate) applies to any frame — the reusability story v1 promised
  and didn't deliver.
Two sweeps corrected the build again (PERSIST-9: sideVars classified
transient-derived; VAL-12: the addAs OpSelect marked `arg`). 18 pins. Still
open in the UX tail: pickers (non-identifier columns stay unreachable by
typed name — the one v1 hole that needs UI, not mechanics).

### Computed Column lands — the row-wise formula verb (2026-07-29j)

The design-first backlog item built, to the author's three directions (frames
stay pure data; the computation is a graph citizen; reuse the existing
surfaces). `ComputedColumnNode` (nodes/frame.ts, beside Add Column): frame +
name + optional λ in, frame out. The math comes from the inline `expr`
(variables ARE column names — resolved by exact name, #REF! naming a miss) or
a wired LambdaValue (params bind to columns the same way; the λ wins over the
expr — it's the deliberate, reusable definition, and its capture sockets carry
side parameters). Per-row contract: an error cell in a bound column propagates
to that row (first in binding order); a NULL FLOWS INTO the formula (a formula
is not an element-wise op — ISBLANK/IF can see it); NaN → #DOMAIN!, a
list-shaped result → #SHAPE! (one value per row); output type inferred
(inferColumn), `Name (unit)` headers tag units via addColumn, name collisions
replace in place. Eager like Add Column/XLOOKUP/Pivot (not in
LAZY_FRAME_NODES — a JS formula has no Polars op). Editing routes through the
shared FormulaPopup (new ComputedColumnNode arm); the card is
FormulaField + FrameDisplay. Two sweeps caught the first draft (worked as
designed): VAL-10 rejected a per-cell isUnitCell strip (frame cells are plain
— D20, units live on the column; deleted), uiCopy rejected a
"wire a λ" instruction in the catalog description (reworded). 14 pins in
nodes/computedColumn.test.ts. The frame-verb refusal message now ends
"…or a Computed Column for row math", and COMPUTEDCOLUMN itself joined
FRAME_SURFACE_NAMES (the derivation ratchet demanded it). UX tail
(binding pickers, output-column format controls, grid typing) → backlog.

## Older entries archived

Swept verbatim to [`archive/dev-notes-history.md`](archive/dev-notes-history.md)
(latest sweep: through 2026-07-29i on 2026-07-30 — the pre-computed-column-arc
sessions). `git log` is the per-commit record.
