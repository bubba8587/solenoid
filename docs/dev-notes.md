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

### Backlog claim FALSE: drill-ins DO adopt — pinned, line deleted (2026-07-29e)

The "trueany adoption runs on the MAIN editor only — drill-in composites don't
adopt" backlog line was stale when written (2026-07-22): `settleInternalTypes`
has run `settleWildcardTypes(this.internalEditor)` on every live drill-in
connection change since 2026-07-18 (35fe709). Verified behaviorally — a new
composite.test.ts case ("an INTERNAL trueany node adopts on a live drill-in
wire") wires a Display inside a composite's internal editor and watches both
rings adopt `number` and revert on disconnect. Line deleted per the reconcile
rule; the test keeps it true.

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
column. Resolution chain in the core's row accessor (shared by `@` and
`col()`): the column → the `row`/`rows` builtins → the surface's SIDE value —
a list must line up with the frame's rows (mismatch → per-row #SHAPE! naming
both counts; a matrix refuses), a scalar reads the same every row. The port
grows on the **CC node**, not the Lambda node: `rowRefs` (rowRefNames) joins
the side-var machinery, so an @name matching no column grows a side socket
exactly like an unknown variable — the list is zipped to THIS frame's rows,
so its port belongs on the table-side node, and the λ stays frame-agnostic
(zero-ceremony `captured: []` is preserved; captures deliberately do NOT
reach @). Side sockets widened `anyIn` → `anyDataIn` (rank ≤ 2, the
Expression variable socket) so lists can actually wire in — which also makes
the core's long-stated "a whole list for SUM(...)" side-value contract
reachable. Behavior flip pinned: `col("nope")` on the CC node now grows a
side port reading its default (like any unknown name) instead of erroring;
the per-row `#REF! No column` case stays on the port-less Frame Input
sources. Frame Input λ columns word the miss per path (the captures hint
only for param binding — captures don't reach @).

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

### Frame verbs: recognized-but-refused in formulas (2026-07-29i)

D23 keeps frames out of formulas, but the Add menu TEACHES the verb names — so
a typed JOIN(...) read as a typo's #NAME?, indistinguishable from a
misspelling. Now: `FRAME_SURFACE_NAMES` (excelFunctions.ts, beside
LEGACY_ALIASES — deliberately distinct: a legacy spelling is a WRONG name with
a right substitute, these are RIGHT names whose data type can't flow here).
33 names (all Tables & Frames leaves' typeable despaced labels + PIVOTBY).
Behavior: dispatch short-circuits to #TYPE! "Frames don't flow through
formulas — use the X node" (shared by Expression AND Equation — equations
compile through the same evaluator); the editor colors the token in the frame
socket violet (`fx-frame`, `var(--sock-frame)` — color conveys type, distinct
from the typo red); the hint bar shows "frame verb — use the X node"
(signatureFor); autocomplete never offers them. SSOT gate:
frameSurfaceNames.test.ts derives the set from the catalog BOTH ways (a new
frame verb can't ship outside the map; the map can't shadow a dispatchable
name, a legacy alias, or a ghost label). When Computed Column ships, the
message should grow the "or a Computed Column" arm (noted on its backlog
item). VISUAL half (the violet token) awaits the author's eyeball.

### Pack formulas: the 19 custom-logic nodes are formula-callable (2026-07-29h)

The D19 pack workstream closed: all 19 custom-logic pack nodes register as
PackFormulas (21 functions — Sunrise/Sunset splits into SUNRISE, SUNSET,
DAYLENGTH), the first real users of the formulaExtensions seam. Names follow
D19 2(a) (despaced label) where the label allows; punctuated labels declare a
leaf-level `fx` in the catalog entry ("Friction Factor (Colebrook)" →
COLEBROOK), a new NodeCatalogEntry field the parity measurement reads like an
op's `fx`, one level up. Mechanics: every impl delegates to the SAME core its
node calls — inline data() logic was extracted into shared exported helpers
(parallelCombine, awgWire, emSpectrum, hrZonesMatrix + hrZonesDomainOk,
isInMask, tallyPairs, standardAtmosphere, colebrookFriction) so the two
surfaces cannot drift; packs mint selector errors via solError/isSolError
re-exported through packShared (the one core error seam, keeping the pack
import rule). PackFormula grew `rank`/`listArgs` passthrough into
EXCEL_IMPL_META so ISIN/TALLY/TRIANGLESOLVER/HEARTRATEZONES ride the whole-arg
and rank machinery instead of broadcasting into garbage. Frame-out nodes
project to rank-legal shapes: HEARTRATEZONES → five [low, high] rows (matrix),
TALLY → the counts list (first-seen distinct order). Pins: a
`pack formula functions (D19 decision 4)` describe in each pack's vitest file
via the new `evalPackFormula` test-kit helper. The parity script AND ratchet
now run initPackFormulas() first (matching app startup): 548/645 leaves
formula-callable, packs 167/167 — the backlog item's pack half is deleted.

### The aggregate guard reaches the engine — last parity gap closed (2026-07-29g)

The corpus-discovered gap (desktop emitted inf/NaN cells where web shows
#OVERFLOW!/#DOMAIN!) is closed: `guard_agg_expr` wraps every numeric/date
aggregate in the group-by plan with the oracle's exact B-1b order (NaN input →
#DOMAIN! up front; NaN result → #DOMAIN!; ±inf result from all-finite inputs →
#OVERFLOW!; a wired infinity passes through; empty-group identities and null
results untouched). Representation: a Polars column can't hold a SolError, so
the two verdicts ride as RESERVED QUIET-NaN BIT PATTERNS — inside the engine a
marked cell behaves as NaN (which is what the oracle's error cells get where
it matters: the sort tail, comparison drops, key masking), and `num_to_json`
decodes the exact bits to `{"__err": code}` at the download boundary, the form
`decodeWireCell` has been ready for since B-1b. The corpus now PINS the guard
cross-engine: expect frames may carry `{"__err"}` (both runners normalize
error cells to that one form and compare by code), five hand-named guard cases
in groupBy.json, and the fuzz generator emits single-verb guard cases instead
of skipping them (six seeds clean). Pipeline cases with error cells at any
step still skip — mid-chain error semantics stay the oracle's (a marked cell
that flows into ANOTHER aggregation re-guards to #DOMAIN! rather than
propagating the original code; recorded approximation). Upload is unchanged:
error cells still degrade to null (input-error propagation stays pinned
oracle-side in frameVerbs.test.ts). FX-12's boundary paragraph updated.

### Fuzz round 4 (fused op chains): six finds, both engines AND the oracle (2026-07-29f)

The backlog's "fuzz next territory" landed: a `pipeline` corpus verb —
`op: {kind: "pipeline", ops: [WireOp…]}` over the "in" frame. The oracle (and
the JS runner) applies the ops SEQUENTIALLY; the cargo runner hands the list to
`apply_ops`, which fuses them into ONE lazy Polars plan — so these cases pin
the fusion seam (predicate pushdown, group-by-mid-chain) no single-op case
sees. `pipeline.json` holds 11 hand-named chains (report chain, rename→select,
empty-ops identity, error-mid-chain surfaces its code…); the fuzz generator
grew per-verb op MAKERS so each chained op is built against the intermediate
frame (column-aware chains), 2–5 ops, error cells mid-chain skip the case (the
FX-12 wire boundary). ~28k cases over 35 seeds; six real divergences, all
fixed + pinned, final 12 seeds clean:

- **Polars median interpolates** (`lo + 0.5*(hi−lo)`, loses ~1e-6 when the
  even pair spans magnitudes) vs the oracle's midpoint `(lo+hi)/2` →
  `median_expr` UDF mirroring the oracle (like variance/mode).
- **Descending sort REVERSED an all-null column** — Polars' all-equal-keys
  fast path ignores maintain_order (chains manufacture the degenerate column:
  stdev of single-row groups). `lazy_sort` now rides a row index as the
  explicit ascending tiebreak key — order is part of the sort contract now.
- **The outer join's anti TAIL joined on RAW keys** — Polars matches NaN==NaN,
  so NaN-keyed right rows "matched" and vanished; now masked like every path.
- **Text predicates read serde's float form, not JS display**: 2^53 fell out
  of num_to_json's i64 window and read "9007199254740992.0" (endsWith "0"
  matched); non-finite cells read "" instead of "NaN"/"Infinity". New
  `js_number_string` (ECMA Number::toString over Rust's `{:e}` shortest
  digits) now backs `cell_display` + `json_str`.
- **min/max over a logical column — BOTH sides wrong differently**: the oracle
  emitted 1/0 numbers in a logical-typed column, the engine left the Float64
  agg uncast under a logical label. Both now return booleans.
- **-0 breaks the corpus tautology**: JSON can't write -0, so an oracle
  -0 (product crossing zero) failed replay under toEqual's Object.is. The JS
  runner's dump now compares sign-of-zero-blind, matching the wire, the Rust
  runner's f64 ==, and every user surface.

Follow-up (author call, same day): whether text predicates on number columns
SHOULD compare JS display strings at all — the spec `js_number_string`
implements — is flagged for an OUTSIDE reviewer (backlog, "Bugs &
verifications"); the author explicitly declined to adjudicate it. Behavior is
corpus-pinned either way, so the review can land as a spec change without
archaeology.

### Fuzz round 3 (widened pools): three deeper finds, incl. the WIRE itself (2026-07-29c)

Widened the generator (17-digit doubles, denormals, 2^53+1, fractional/negative
date serials, unicode/whitespace strings, bigger frames) and ran four fresh
seeds — 2,880 cases. Three finds, the first one striking:
1. **serde_json's default float parse is LOSSY** — a 17-digit double crossing
   the IPC could land one ulp off (32594.794185575094 → …098), so the engine
   computed on subtly different data than the oracle. `float_roundtrip` feature
   now on in src-tauri/Cargo.toml; the wire round-trips doubles exactly.
2. **The logical bridge was missing from the engine's filter-value coercion for
   number/bool values** — `eq 12` on a logical column matched nothing desktop
   (12 ≠ 1) but every TRUE row on web (coerceLogical: nonzero → 1). Folded now.
3. **Polars swaps an inner join's build/probe sides by size and maintain_order
   LOSES** — a right side larger than the left made inner joins emit
   right-driven row order. Equality joins now row-index BOTH sides and sort the
   joined result into the contract explicitly (maintain_order dropped — the
   sort is the guarantee).
All four seeds fully green after; three permanent corpus cases pinned (114).

### The corpus fuzz sweep: seven more real divergences, all fixed (2026-07-29b)

`scripts/fuzz-frame-verbs.ts` (new, kept): seeded generator that writes random
corpus cases — oracle-computed expectations, wire format, `fuzz-*.json` beside
the hand fixtures — so cargo becomes the divergence hunt. 480 cases per run;
usage in the script header; fuzz files are TRANSIENT (generate → run → delete),
each find lands as a permanent hand-named case instead (11 added; corpus now
110). Two seeds run (480 + 600 cases) found EIGHT real defects across both engines:
1. **Sorting by a logical column PANICKED the engine** (Polars bool sort has no
   nulls-last) — sort now keys logical as 0/1 and floats with NaN nulled, which
   also fixed NaN-desc tailing. (`lazy_sort` key exprs)
2. **The oracle's `forAggregate` admitted text cells** — sum CONCATENATED
   ("0"+"b"→"0b"), min/max compared lexically by accident. Numeric-only now
   (engine already skipped): sum 0 / product 1 / min-max null over text.
3. **Equality-join keys**: the oracle's B-1a bucket matched NaN to −∞; Polars
   matched inf==inf. Both now: non-finite keys never match (like null). The
   engine joins on TEMP masked key columns with coalesce done EXPLICITLY —
   which also fixed 4. **the right-join coalesce naming maze** (a right key
   named like an unrelated LEFT column coalesced the WRONG column — audit
   finding 4's last corner, live).
5. **groupBy keys**: engine grouped inf/−inf/NaN separately; oracle buckets all
   non-finite as one group, null its own (B-1a). Engine now groups on derived
   key exprs (masked value + non-finite flag) with `first()` key output.
6. **Polars' asof kernel retired** (`verb_join_asof` is now a hand-rolled
   mirror of the oracle's binary search): its `allow_eq` default silently
   excluded EXACT key ties, `nearest` tie-breaks forward (oracle: backward),
   and non-finite keys mismatched. Three kernel quirks, one small function.
7. **mode over a group of non-finite values** answered null engine-side (an
   old is_finite filter in the UDF; also -0/0 now share a count bucket like
   JS ===). 8. **Spec clarifications, both sides**: mismatched join key types refuse
   `#TYPE!` (was silent-empty web / `#ERROR!` desktop); mixed-type unpivot
   value columns refuse `#TYPE!` (was silent nulls desktop); a null comparison
   value matches no rows in text predicates (oracle stringified it to "null",
   engine to ""). Variance/stdev now run the oracle's sequential two-pass in a
   GroupWise UDF — Polars' own var() drifts in the last digits at large means
   (date serials), and byte parity is the corpus contract.

### The parity corpus LANDS end to end — FX-12 promoted (2026-07-29)

Bundle 18 steps 1v–4 in one session; `18-parity-corpus.md` → archive. The
first-ever cargo run of `corpus_cases` (cold Polars build, GTK libs
apt-installed) compiled clean and immediately earned its keep — **three real
divergences the hand-mirrored pairs had never caught, each fixed engine-side**:
1. An unknown groupBy agg op computed a silent null column while the oracle
   refuses `#NAME?` — `require_agg_ops` now validates the wire's free-string op
   names (`percentof` stays a null column on both sides).
2. Polars totally orders floats (NaN greater than everything), so a NaN cell
   PASSED `gt`/`gte` engine-side; the oracle fails NaN on every comparison but
   `neq`. `comparison_filter_expr` masks NaN out of the two divergent ops.
3. OUTER join row order was never pinned engine-side: Polars' Full join tails
   unmatched LEFT rows, the oracle keeps left rows in order and appends
   unmatched RIGHT rows. `verb_join` now builds outer as that composition
   (left join + right-anti tail in the head's schema).

Migration is COMPLETE, unary and binary both: 99 corpus cases across 13
fixture files; every hand-mirrored Rust+JS verb pair deleted (engine/tests.rs
1373→680 lines, incl. the dead `#[cfg(test)]` verb wrappers; frameVerbs.test.ts
keeps only ORACLE-ONLY semantics, marked as such — per-cell SolError behavior,
the aggregate non-finite guard, the B-1a key-literal pin, XLOOKUP's
lookupFrameCell which has no engine command). Runner upgrades: `expect` frames
decode `__nf` (NaN compares equal under toEqual), a corpus-wide input-mutation
check replaced every per-verb "does not mutate" test, binary verbs dispatch by
name (join reads frames left/right with the op parsed as PRODUCTION
WireJoinOpts; append names inputs, op carries order), and pivot is an
`ORACLE_ONLY_VERBS` entry whose exemption self-destructs (cargo asserts the
engine still can't parse the op). The completeness whitelist is deleted —
fixtures must cover `FRAME_OP_KINDS` + `BINARY_VERBS` exactly. Promoted as
**FX-12** (70 rules, 67 enforced).

**Corpus-discovered gap, left open (backlog):** the aggregate non-finite guard
(#OVERFLOW!/#DOMAIN! on groupBy sums, B-1b) exists ONLY oracle-side — the
engine emits inf/NaN cells there, so desktop diverges live on overflow.

Same sitting, rules.md was prepared for the author's hand-authorization pass
(the stated end state: every rule read and marked permanent by the author):
- **Rule index** — a 70-row ID→title checklist at the top, machine-checked
  against the actual headings by rules.test.ts (a stale/missing row fails).
- **The authorization procedure written down** (PROV section): read → mark the
  heading [ARR] + add the ID to AUTHOR_MARKED_ARR in rules.test.ts, both in the
  SAME author-marked change; amend-then-mark; reject = delete or regrade.
- **Readability restructure of the six densest MUSTs** (SOCK-9, VAL-19, FX-12,
  PERSIST-4/6/10) — multi-clause paragraphs into scannable clause lists,
  meaning-preserving. Plus a glossary pointer in the header, the stray VAL-14/15
  divider removed, FX-12's archived-bundle path fixed, SSOT-5's enforcement note
  updated to the narrowed reading-job state.

Same sitting, the violations queue worked to its residual:
- **EFFECT-1 closed** (known-violation 2, exactly as prescribed): a
  string/comment/template-aware brace-matched sweep over every data() body in
  nodes/+packs (313, floor-asserted) refuses the write APIs and `this.run(` in
  any file touching one (the live-connection Imports' fetching run() stays
  legitimate), with a stays-honest pin on the API-name list. 68 enforced /
  1 partial (SOCK-8) / 1 unenforced (SOCK-6).
- **The semantic half narrowed to its residual** (known-violation 1):
  rules.test.ts now machine-checks every quoted citation — the suite-name →
  "test name" arrow form, 57 of them — as a whitespace-collapsed substring of
  the cited suite; its first run caught two drifted quotes (both name-drift,
  not enforcement loss). The 19 bare-file-cited rules were then read end to
  end: every cited suite genuinely enforces its rule (checked against each
  MUST: SSOT-6's shared-metric import, VAL-18's both halves, PERSIST-3's
  deep-freeze walk, ENGINE-2's transition matrix, etc.). Residual: future
  bare-file citations — prefer the quoted form, which buys the machine check.

### Two spec lints + the unary fixture set completes (2026-07-28kk)

The in-scope remainder after the audit, all three landed:

**SSOT-5 made mechanical** — rules.test.ts now walks every `### <ID>` section
and fails any rule without an `*Enforced by:*` line; the meta-rule that "every
rule labels its enforcement" is itself enforced. Flipped to enforced in the
summary table (66 enforced / 2 partial / 1 unenforced).

**SOCK-8's greppable half** — sourceInvariants.test.ts pins socket.css's
deterministic 12×12 block (`display: block`, `var(--socket-size, 12px)`,
`line-height: 0`), greps the tree for any reborn `INPUT_ROW_TOP`-style
constant, and refuses `transform: translate` in NodeSocket.tsx (offsetTop
ignores transforms — rete would misreport the endpoint). The rendering half
(measured-row correctness) stays unenforceable by grep; noted on the rule.

**Corpus fixtures for all 8 remaining unary verbs** — select/drop/rename/
head/filterMulti/groupBy/unpivot/pivot, authored from oracle probes (40 cases
total across 11 files). `NOT_YET_MIGRATED` is EMPTY for unary verbs; the
completeness ratchet now holds FRAME_OP_KINDS ⊆ fixtures outright. Probing
found a real wound: the wire carries agg `op` as a free string, and an
unknown name ("mean" for "avg") fell off the switch to a fabricated silent
null column — it now REFUSES whole-verb with a thrown #NAME? (a bad op name
is a request error like a missing column's #REF!, not a per-cell data error).
Pinned as a groupBy expectError case. Pivot probe also corrected the spec's
field names on contact: `rowFields/colFields/values/funcs`, not rows/columns.
The cargo handoff (backlog) is unchanged — pairs still await verification +
deletion; FX-12 promotes only when cargo agrees.

### The scope audit: Equation currency + the lambda deviations close (2026-07-28jj)

The author asked "sure there's nothing left?" — and the audit found four real
items I'd waved off. All landed:

**Equation currency** — the Equation runs dimEval too, and `$5 = €5` HELD (the
`=` compares sides whose dims agree; no operator inside either side ever sees
both codes). Codes now thread through the Equation's dim checks, and the
equals compares the sides' RESULT codes via the new `dimEvalWithCode` — the
one caller whose top level is itself a combination. `$5 = €5` → #UNIT!.

**Eta-lambdas** (`MAP(x, SQRT)`) — a bare dispatchable name in a lambda slot
(host fn args + APPLY args) eta-expands via `etaOrEval` to a LambdaValue
marked `eta`; the hosts call an eta wrapper with their MEANINGFUL arity only
(`etaFn` — a raw SQRT must never receive MAP's (v, v2, v3, row, col) tuple,
which was exactly why this was recorded as a deviation rather than built).
Variables/params shadow; unknown names still refuse.

**IIFE + curried + higher-order application** — a new `apply` AST node
(postfix `(…)` on any primary): `LAMBDA(x, x+1)(5)`, chained `f(2)(3)`, and a
call whose NAME is a lambda-valued binding (`LAMBDA(f, f(9))(SQRT)`). Declared
arity is checked; applying a non-lambda refuses. Every Ast walker learned the
node (tex, collectNames, dimEval → indeterminate, equationSolve, the dormant
step-trace walk).

**The garbage class, closed for lambdas too** — a lambda leaking into an
operator (`f + 1`) used to concatenate "[object Object]"; applyOp now refuses
with #TYPE! like the Cx guard.

The recorded formula-language deviations list is EMPTY. Pins in
formulaLambda.test.ts + unitCurrencyPolicy.test.ts.

### The Expression two-currency gap closes — codes ride the dim pass (2026-07-28ii)

The last recorded formula-surface wrong answer. The numeric evaluator computes
on stripped magnitudes and can't see display codes, so `$5 + 5€` answered 10 in
an Expression while the node-side arithmeticCell refused (VAL-19). The fix
rides the existing DIMENSIONAL pass: `unitDimExpr` gains an optional `CodeEnv`
(variable → currency code), the internal walk carries `{dim, code}` operands,
and every OPERATOR refuses a code mismatch with the same #UNIT! — including
×/÷, which would fabricate an exchange rate. The code carries by
arithmeticCell's display-carry rule (only while the result stays in the coded
operand's dimension); an uncoded computed currency adopts leniently; a
dimEval #UNIT! already overrides the numeric result in expression.ts, so the
wrong 10 becomes the right refusal with no new plumbing. Codes DROP at
function calls — the recorded limitation (a formula's SUM over two coded
inputs still combines; the node-side aggregators refuse), noted in VAL-19.
Pins live in unitCurrencyPolicy.test.ts ("the formula surface").

### Parity corpus step 1 BUILT — the loop exists end to end (2026-07-28hh)

The bundle's step 1, same day as the design. `FRAME_OP_KINDS` in frameVerbs.ts
is compile-time exhaustive (an unlisted FrameOp kind fails tsc via an
Exclude-to-never check); `fixtures/frame-verbs/{sort,distinct,filter}.json`
hold 15 wire-shaped cases including #REF! expectError rows, null-cell edges,
and case-sensitivity toggles; `frameVerbCorpus.test.ts` globs them through
`applyVerb` with structural compare + the completeness ratchet (fixtures ∪
NOT_YET_MIGRATED whitelist must equal FRAME_OP_KINDS exactly, no overlap);
`corpus_cases` in engine/tests.rs walks the same directory through the
PRODUCTION deserializers (WireFrame/WireOp → apply_ops → dump, numeric-aware
compare, IpcError codes read via their serde form).

Design correction while building: the doc's invented "__Infinity" sentinel
died on contact with the code — the wire ALREADY has a non-finite convention
(`{"__nf": "inf"|"-inf"|"nan"}`, spoken by frameBackend + engine.rs since
2026-07-02). The corpus uses that, per its own format-is-the-wire rule.

The JS side is green (suite 3655). The cargo runner is written but UNVERIFIED
here: the Tauri lib link needs the GTK dev libs (apt-installed now), and the
cold Polars compile was skipped by author call — `cargo test corpus_cases`
in src-tauri is the one pending verification. Then step 2: migrate the ~30
hand-mirrored pairs verb by verb, shrinking the whitelist.

### The parity corpus is DESIGNED — the queue's last item, decision-complete (2026-07-28gg)

`v2.0/18-parity-corpus.md`. The one design decision that matters: **the corpus
format IS the wire format** — a fixture is a recorded IPC payload (frames as
the engine deserializes them, ops in the `WireOp` tagged shape, which is
`FrameOp`'s union by construction), so both runners read fixtures with their
PRODUCTION deserializers and no third representation exists to drift. Two
runners (a vitest glob; a cargo test walking the same dir via
CARGO_MANIFEST_DIR), a DERIVED verb inventory (`FRAME_OP_KINDS` pinned against
the dispatch switch — SSOT-4), non-finite values via the already-pinned
`["#", null]` convention plus an `"__Infinity"` sentinel for real ∞ inputs,
and a verb-by-verb migration off the ~30 hand-mirrored test pairs behind a
shrinking whitelist. Promotes as FX-12 when the whitelist empties. Build order
in the doc; the build itself is the queue's one remaining (and largest) item.

### PERSIST-10: width/height ownership pinned — the last small residue (2026-07-28ff)

The observer owns `node.width/height` at runtime (measured px every layout,
read by the minimap + cable geometry); they persist for every node, but only
the SIZE-OWNER classes re-consume the init — the probe found ten: note, image,
svg, import-obsidian, composite, query, group, report, presentation,
session-history. Display's grip is the third channel (nodeSizeStore, its own
persisted `sn.size` — verified, no bug). The pin probes the whole catalog with
`{width: 777, height: 555}` and compares against the declared set BOTH ways: a
new adopter must declare (is the size a user gesture?), and an owner that
stops re-consuming fails as "the user's drag resets on reload". Rule
PERSIST-10; 69 rules, 65 enforced.

With this, the spec-promotion queue holds ONE item: the backend parity corpus.

### PERSIST-9: the transient-field triage — 169 fields, one real bug (2026-07-28ee)

The queue's one-sitting item. The fixed-point sweep (PERSIST-1) proves
whitelisted fields round-trip but is BLIND to a field the whitelist never
captured — both sides omit it identically, so the test passes while the user's
setting silently resets. The triage closes the blindness: every own field of
every catalog node is now classified — persisted (whitelist / literal maps /
extractInit's bespoke extras), pattern-transient (`cached*` derived display,
`_*` private runtime), or in a ~70-entry DELIBERATELY_TRANSIENT map grouped by
mechanism (derived-from-expr, per-pass recompute, FC reconcile state, VAL-17
roll state, EFFECT-1 disarm, async fetch state, drill-in markers re-stamped by
the host composite, socket instances, class declarations).

**The one real bug in 169 fields: `asofDirection`.** The as-of join's
user-facing direction dropdown — constructor took it, the component edited it,
the whitelist never captured it, so every save/reload/paste reset it to
"backward". Exactly invisible to PERSIST-1. Whitelisted + pinned. Everything
else checked out (chartOptions derives from a persisted input; composite run
CONFIGS ride bespoke extras while run STATE stays transient; AngleDial's
`step` is a constructor-only knob with no UI; FC lock state re-derives per
reconcile pass; goalTarget is re-stamped from the host's persisted goalSeek).

Rule PERSIST-9; 68 rules, 64 enforced. The spec-promotion queue's mechanical
half is now EMPTY — what remains is the backend parity corpus (the one large
build) and the small residue (width/height ownership; read-as stays deferred
by design).

### STORE-1: the node-store registry completes — five unregistered stores, one visible bug (2026-07-28dd)

The queue said two stores were unregistered; the census found FIVE, plus two
decayed hand-wirings:

**Newly registered** — formatAnnotationStore (grew removeForNode via its _byNode
index + clearNodes, which leaves the pack format/unit REGISTRATIONS alone),
dockedNodeStore (forget covers both roles: the docked FC's own entry AND every
FC docked to a deleted host), compositeStaleStore, standoffs (had the methods,
wired ad hoc), and isolateStore — whose miss was a VISIBLE bug, not a leak:
nothing exited isolate on a document load, so switching documents while
isolated left the old graph's ids in the focus set and dimmed the ENTIRE new
graph (every regenerated id a non-member). Registry forget also drops a deleted
node from the focus set, exiting when it empties.

**Hand-wirings deleted** — Canvas.tsx called standoffStore.removeForNode
UNCONDITIONALLY in noderemoved (paying the per-node scan during rebuilds that
the registry's isGraphRebuilding skip exists to avoid); persistence hand-listed
four stores' clear() calls beside forgetAllNodes(). Those four
(nodeSize/collapse/pin/nodeName) now register forgetAll like the rest and the
hand-list is one registry call.

**The sweep** (sourceInvariants "STORE-1"): every top-level `*Store*.ts` either
references registerNodeForget or sits in a sanctioned map with the reason it
holds no per-node state (34 entries — doc-level, settings, dialog/overlay
state, single-transient-id popup stores); every registrant must also register
the bulk reset; the sanctioned list is honesty-checked. New STORE domain,
rule STORE-1; 67 rules, 63 enforced.

### VAL-20: the last bare-NaN producer — the RANGE branch classifies (2026-07-28cc)

The completeness pair's other half. The producer sweep ran as a probe battery:
the KERNELS came back clean (listOps/matrixOps/mathUtils each carry a recorded
convention — quiet null, tagged error, IMDIV's cx(NaN, NaN)), and the leak was
one branch: the formula evaluator's RANGE dispatch returned results raw where
broadcastCall has always classified. Nine whole-sample calls leaked bare NaN —
STDEV/VAR of one value, CORREL of a constant, SLOPE of constant xs, RSQ, SKEW
below n=3, KURT below n=4, GEOMEAN of a negative, Z.TEST of a constant — each
rendering as an EMPTY cell and computing onward as more NaN, the least visible
wrong answer in the model.

One guard closes all nine: the range branch now routes a numeric result
through guardFinite, feeding the flattened arg cells to the ∞-input rule so
SUM over a first-class ∞ still answers ∞. tTestP's deliberate quiet-null
stays a null (carve-out pinned). The battery is `rangeRouting.test.ts` →
"a range RESULT classifies non-finite". Promoted as VAL-20; 66 rules, 62
enforced. The VAL completeness pair is fully closed.

### VAL-19: currency is guarded in EVERY combinator — four live wrong answers die (2026-07-28bb)

The completeness queue's currency half. Probing before building found the worst
split possible: unitValue's currency-aware arithmetic combinators
(add/sub/mul/div/powUnits) were DEAD CODE — no caller anywhere — and also STALE
(they lacked the 2026-07-16 adoption-scaling call), while the LIVE path
(`arithmeticCell`, inlined in scalar.ts) had the adoption call but NO currency
check. Live wrong answers, all pinned then fixed: **$5 + 5€ = $10**,
**$5 − 5€ = $0**, **$5 mod 5€ = $0**, and **$10 ÷ 5€ = 2:1** — that last one
mints a pure RATIO, i.e. a fabricated exchange rate.

The consolidation (SSOT-1 applied to an algebra): `arithmeticCell` moved
rete-free into unitValue.ts (scalar.ts re-exports; the op union moved with it),
the dead combinators deleted, and the `currencyMismatch` guard placed UP FRONT
in the one implementation where no op can miss it — ×/÷/quotient refuse too
(division across codes IS an FX claim). Same-code ÷ still mints its honest
ratio; an uncoded computed currency cell still adopts leniently. One stale pin
surfaced in the port: the dead divUnits returned a BARE 5 on cancellation where
the live rule mints 5:1 — the test had been guarding the wrong behavior.

`unitCurrencyPolicy.test.ts` is the matrixUnitPolicy-shaped sweep: a per-op
policy table with an every-ArithmeticOp completeness check, the non-arithmetic
combinators (compareUnits / forAggregateUnits, already currency-aware), and a
combinator-surface check so a new `*Units` export fails until it registers.
New rule VAL-19; 65 rules, 61 enforced. Known gap recorded: the Expression
surface strips tags to magnitudes, so a two-currency formula can still combine
them — the formula surface has no per-cell display id to check (backlog knows).

### SSOT-9: the input-cable pruning loop unifies — eleven copies, one helper (2026-07-28aa)

The spec-promotion queue's top refactor. `components/cablePrune.ts` is now THE
loop: `dropInputCables(nodeId, keys | predicate)` — snapshot the connection
list, filter to the node's departing target inputs, await each removal (undo
entries), through the ACTIVE editor (drill-ins edit their own graph). The
queue recorded six copies; the sweep found ELEVEN: Alert (mode keep-set
complement), Chart (matrix↔list swap), DateDiff (basis), Filter/CableSwitch/
ExtensibleInputs (row delete), SumIfs/BuildFrame/PairedExtensibleInputs (pair
delete), Expression + LAMBDA variable removal (expressionEdit), Add Column
read-as (frameEdit). The drifted detail the unification fixed in passing: four
of them iterated the LIVE connection list while awaiting removals.

Kept direct, each sanctioned with its reason in the new source sweep
(sourceInvariants "no component hand-rolls an input-cable pruning loop"):
ConnectionDialog (one user-selected cable), CompositeEditorOverlay
(cross-graph port sync with a user-facing tally), Interpolate (variant switch
prunes BOTH directions), ListInput (type-compat filter via canConnect),
ReportOverlay (deliberately the MAIN editor), Equation (a variable owns an
output socket too), RendererSpike (dev harness). New rule SSOT-9 records the
contract; 64 rules, 60 enforced.

### Spec tranche 2: ENGINE domain + the queue's promotable half (2026-07-28z)

Ten more rules from the remainder queue — rules.md is **63 rules, 59/1/3**:

**New builds**: SOCK-10 (an adopting port OWNS its socket instance — two
instances of every catalog class, no shared MutableSocket; the Input Switch
shared-valueSocket incident, and the survey found ZERO live offenders — pure
ratchet); SOCK-11 (a `trueany` output implies passthrough() — catalog walk;
the six undeclared classes are all principled and sanctioned with reasons:
FC/Conduit/composite-boundary resolve their own types, NA/XLOOKUP are
genuinely unknowable); PERSIST-8 (every documentStore verb that swaps the
canvas calls captureCurrent + guards isGraphRebuilding — method-body scan;
restore/remove/reloadCurrent sanctioned with their reasons).

**Pure promotions over existing pins**: SOCK-12 (relay transparency — conduit
trace + frame shape through passthroughs, "Bug B"); ENGINE-1..3 (a new domain:
targeted pass ≡ full pass incl. #CIRC! SCC seeding; the calc-mode gate is the
only pass-skipper; a live-data refresh never enters a rebuild scope); VAL-18
(positional access filters errors per cell, aggregation propagates whole);
FX-11 (vendored-engine divergences owned + TRIPWIRED — the bidirectional pin
pattern from formulaDivergence.test); PERSIST-7 (unknown types round-trip
losslessly through Placeholder, loud #REF! while it lasts).

**Triage note recorded**: the store-registry gap (formatAnnotationStore /
standoffs register no forgetters) is a bounded LEAK, not corruption — rete ids
regenerate per load and never collide — so it stays queued as hygiene rather
than promoted as a wrong-answer rule. The queue's remaining items are the
mode-keys pruning refactor, the two VAL completeness sweeps, the backend
parity corpus (the largest build), the transient-field triage, and
width/height ownership. Suite 3601 → 3605.

### Deploy fix: the unopened CSS comment + a postcss gate (2026-07-28y)

Seven hours of Vercel deploys were red: `07a117a` (15:07, the op-selector
session) added a doc paragraph to nodeCard.css whose opening `/*` was lost —
its own `*/` survived — so the prose sat bare in the stylesheet and postcss
read `SUMIFS'` as an unclosed string. Nothing local checks CSS syntax (tsc
ignores it, vitest env is node, the dev server tolerates more than the prod
pipeline), so the suite stayed green the whole time. Fixed by restoring the
comment, and `cssSyntax.test.ts` now runs postcss.parse — the SAME parser the
build uses — over every stylesheet under src/ (pixi excluded), verified to
reproduce the exact deploy error against the broken state. Production build
run locally end-to-end before pushing.

### The spec-promotion sweep, tranche 1: PERSIST + EFFECT domains (2026-07-28x)

The author-queued sweep ran as three parallel surveys (folklore docs, the test
suite, code conventions) and converged hard on one theme: THE SAVE PATH was the
largest cluster of load-bearing, test-pinned invariants with no normative home.
Tranche 1 promotes nine rules — rules.md is **53 rules, 49/1/3**:

**PERSIST-1..6** (new domain): extractInit fixed point + JSON-plain (the new
JSON sweep closes the seam where a Map-valued config passes the live-object
fixed point while the FILE empties it); the text form is the narrow waist
(new scan: every SavedGraph interface field must appear in BOTH writeTextForm
and readTextForm — the comments/reportPalette data-loss class); documentStoreCore
immutability (new deep-freeze walk over every exported transform — identity IS
the persist signal, so an in-place mutation is an edit that silently never
saves); slot rotation + seq-first-key (new tests — freshness is a prefix regex,
so a payload with another key first silently resurrects the older write);
persistence binds MAIN never the active surface (activeGraph.test's CARDINAL,
promoted); class names are load-bearing (new keepNames config scan + catalog
ctor-name uniqueness walk — `constructor.name` is the save's `type` field and
the registry is first-wins, so a collision reconstructs the loser as the
winner with no placeholder).

**EFFECT-1..2** (new domain): a sink acts only from Run and always loads
disarmed (new catalog-wide quantifier: no class persists `enabled`, none
constructs armed — generalizing the two per-class pins); outward effects are
edge-triggered and rebuild-suppressed (new scan: fireAlert ⇒ isGraphRebuilding).
**VAL-17**: volatile data() freezes on getRecalcGen (new scan; all four
existing volatile files already complied).

**Found and FIXED by the sweep**: the composite paths installed
installErrorGuards BEFORE addNode — guard wrapped INSIDE coercion, inverted
from Canvas's pipe order, so a coercion ShapeError escaped both wrappers
(degrading a per-node #SHAPE! to a whole-card #ERROR!). Four sites moved to
after addNode; VAL-3 gained the ordering clause and records the incident. Also
fixed: the subsystem doc claimed the Number picker authors units (stale — the
node has no unit field; CLAUDE.md's "FC/Convert only" is the truth), plus the
matching unitBridge comment.

The unpromoted candidate remainder (SOCK socket-ownership/passthrough-decl/
mode-keys, an ENGINE domain, guardFinite/currency completeness, the
Polars↔JS-oracle parity corpus, store-registry completeness) is recorded as
the backlog's remainder queue. Suite 3588 → 3600; rules.test's prefix
alternation learned PERSIST|EFFECT.

### CONTAINS made honest: any-element membership, logical answer (2026-07-28w)

Author called for a review; the issues were exactly the visible kind. The node
was numeric-only (`listIn` + `numIn`) while its own kernel was already
type-generic — `containsValue` keys by `setKey`, and the VAL-8 complex fix was
written FOR it — so you couldn't ask whether a string list contains "foo"
while every membership sibling (Is In, Set, Tally) takes `anyListIn`. And it
answered `numOut("0 / 1")`, a pre-logical-migration relic, while Is In (the
same question per-element) answers TRUE/FALSE. Fixed: `anyListIn` list +
adoptive `anyIn` needle + `logicalOut`; kernel returns boolean (FX-1 — the
formula CONTAINS follows, meta `returns: "logical"`); blank-needle → null
(Kleene unknown) unchanged. The component's "✓ found" render override went
with it — booleans hit the isLogical branch before any override, which also
exposed Comparison's `1/0` render prop as dead code (removed).

### ONE date-difference family — the Datedif/DateDiff split dies (2026-07-28u/v)

The arc: the author caught `DateIfNode` misreading DATEDIF ("Date If" leaked as
the Navigator's `DateIf_1`); the first fix renamed it `DatedifNode` — which put
`Datedif_1` beside `DateDiff_1`, and the author then asked the right question:
why are there TWO date-difference nodes at all? My "the merge needs the
deferred variant-switch socket work" objection was WRONG — deferrals.md scopes
that item to PACK variant dropdowns and Interpolate's LIST↔GRID already
rebuilds socket sets live — so the split was history, not design, and the
merge landed one commit after the rename (the Datedif class lived one commit).

**The merged DateDiffNode**: eight ops — the day-count functions (DAYS,
DAYS360, YEARFRAC) plus DATEDIF's units flattened to first-class ops
(Whole years / Whole months / Months ignoring years / Days ignoring months /
Days ignoring years; grouped in the dropdown). DATEDIF "D" was deleted as a
duplicate of DAYS (the math-fn `round` precedent); the formula surface still
dispatches all six unit strings via Formula.js, unchanged. Reversed-range
semantics stay per-op: DAYS signed, DATEDIF ops null. The `basis` input exists
ONLY while the op uses it (`syncBasisInput` — the Interpolate pattern narrowed
to one socket; the component drops a basis cable before switching away). The
NODE_OPS decl moved its host to the DATEDIF leaf so hidden units search as
"DATEDIF: Whole months"; leafOps = days/days360/yearfrac/years. An old save's
DateIfNode OR DatedifNode loads as a Placeholder; DateDiffNode saves load
unchanged (old op keys still valid).

**rules.md ripple**: VAL-12's recorded borderline (DATEDIF's `unit` — op
dropdown by mechanism, argument by semantics) is DISSOLVED, not settled — the
units are now genuine ops. The rule text says so.

**Backlog gains the spec-promotion sweep** (author queue): walk code + tests
for invariants worth promoting into rules.md — comment/folklore rules, tests
that pin meaning no rule states, conventions nothing enforces.

### The partial set hits zero: VAL-10 / VAL-12 / VAL-14 completeness (2026-07-28t)

The last three partially-enforced rules flip to enforced; the spec's summary is
**41 enforced / 0 partial / 3 unenforced** — the partial set is empty for the
first time. Known violations 4 → 1 (only the rules.test semantic half remains).

**VAL-10** (`sourceInvariants.test.ts`) — a source scan over `nodes/` + `packs/`:
any file calling a per-cell algebra identifier (isUnitCell / dimOf / magnitudeOf
/ the *Units combinators / broadcastUnit / anyDimensioned) must declare
`unitAware = true`, with one sanctioned entry (shared.ts, the helper library)
and the honesty test that keeps it sanctioned only while true. The matrix-unit
family is deliberately OUTSIDE the consuming set — a D20 matrix unit tags the
outer array of a bare-number grid and survives the unit-blind strip, so a
unit-blind reshape carrying it (stats.ts) is correct, not a violation. Scan
found zero offenders; the value is the ratchet.

**VAL-12's blindness** closed where the field is still visible: the component
source. A brace-aware scan parses every `<OpSelect>` tag (props hold arrow
functions, so naive `[^>]*` dies on `=>`); each must bind `op` — directly,
a per-row `.op` config field, or via `useNodeField(…, "op")` — or carry the
`arg` prop, now the machine-readable "not the family op selector" declaration.
That contract surfaced 20 unmarked argument/config/data-pick dropdowns (TVM's
payment timing — CumPmt/IpmtPpmt already had `arg`, TVM had missed the same
sweep; XMATCH match mode, FIXED no-commas, TEXTJOIN ignore-empty, Datedif's
`unit` — the recorded borderline, settled as argument-by-semantics; ByAxis's
BYROW/BYCOL axis, resistor band picks, Slicer column, run-mode/target/format
configs, the frame-filter condition rows). All sit on neutral cards, so the
`arg` additions are visually inert today — they encode semantics + feed the
scan.

**VAL-14's only-if** (`catalogRegistry.test.ts`) — every class declaring
`literals`/`stringLiterals` must have a registered component whose source
(Function.toString) shows an editing surface (InlineInputs / ExtensibleInputs /
a direct map reference), so a hand-authored save can't restore a value onto a
card that can never show it. First run listed 13 candidates; all 13 verified
real editors once the heuristic learned the bespoke surfaces — the miss was the
`stringLiterals` SPELLING (capital L, so `/literals/` didn't match) and the
ExtensibleInputs/Paired family. Negative-tested (stripping one `arg` fails the
VAL-12 scan by name; the VAL-14 detector demonstrably fired pre-widening).

Suite 3583 → 3587, tsc clean.

### FX-4's full sweep — and the two live wounds it caught first run (2026-07-28s)

The last mechanical partial: the naming-side injectivity sweep covered catalog
leaves and three hand-listed `fx` tables. The full version derives from NODE_OPS
(every OPERATION-kind op's `fx` ?? despaced label), checks pairwise across
families and against leaves with a leaf-IDENTITY escape (a leaf that constructs
the family at that op IS the op, not a clash), and one reasoned exemption
(chart/sparkline share a figure-STYLE vocabulary — LINE/COLUMN — and never
register formula names). Argument-kind ops take no names; kind-only families
surface ops AS leaves, already swept by leaf uniqueness — two tests, both
surfaces. FX-4 → fully enforced; summary now **38 / 3 / 3**.

First run caught two real wounds the partial sweep had been blind to:

**Text Filter's `Contains` claimed CONTAINS** — the list-membership function.
Fixed by RECLASSIFYING the family operation → argument: the ops are a filter
CONDITION ("keep strings that…"), meaningless without the host, exactly Frame
Filter's condition parameter. That turned the recorded "per-op naming pass" into
one registration: **TEXTFILTER(strings, pattern, [condition])**, same kernel as
the node (`filterTextList` extracted to textOps.ts), condition spellings the op
keys with spaces/hyphens tolerated, blank → "contains". The Text Filter leaf is
CLOSED.

**The math-fn `round` op claimed ROUND while being a different thing** — a 1-arg
integer round whose leaf despaced to a name that dispatches the 2-arg Excel
ROUND, which REFUSES one argument (`ROUND(3.7)` → #VALUE!). The op duplicated
RoundN at digits 0 (whose literal default IS 0), so per the pre-alpha
delete-don't-preserve rule the op and its leaf are gone; the Excel half-rule pin
moved to RoundN. An old save's math-round loads as a Placeholder.

Parity: **non-pack 381/478** (TEXTFILTER +1 covered; the deleted leaf −1 from
both sides — it had been counted "covered" by a dispatch that refused its
semantics, so the old number was flattering). Every REGISTRABLE named leaf is
now closed; the non-pack remainder is entirely sources/sinks/UI/frames-cubes +
Image/SVG/Promo. Suite 3581 → 3583.

### Enforcement tranche: three rules flip to enforced, VAL-12 closes (2026-07-28r)

The author waved off packs, so the next-highest-value item was the spec's own
"partially enforced six" (rules.md's stated highest-value gap). Four moves:

**`sourceInvariants.test.ts`** — a new home for grep-shaped completeness checks,
same discipline as formulaPathIsReteFree: static scans over the real source, so a
NEW offender fails CI naming the rule. Two scans: SOCK-7 completeness (every file
that retypes a socket in place — `.socket =` / `.setType(` / `.dataType =` — must
reference a reconciler; a SANCTIONED map with per-file reasons covers the central
adoption machinery, and a second test keeps that list honest by re-verifying each
entry still exists and still retypes) and VAL-13 (no component source calls
`.data(`). Both found ZERO offenders — the codebase was already clean; the value
is the ratchet.

**SOCK-5's "never persists" pinned** — adopt onto a Display, `extractInit`, assert
the adopted type is absent from the init and a reconstructed node starts hollow
(`trueany`). The save records init fields, never sockets, so this is the exact
leak surface.

**VAL-12 closed** — Alert and ColorBlend, the last two `mode` misnames, renamed to
`op` (nodes, components, tests; `op` was already in the persistence whitelist).
The coverage check immediately demanded declarations — the machinery working as
designed — so both got argument-kind entries in NODE_OPS (a trigger condition and
a blend formula are parameters, not searchable operations).

**SOCK-6 honestly recorded un-greppable** — the survey found every wildcard-literal
comparison outside sockets.ts is a RENDERING classifier (glyph shape, combo
drawing, wire-only rows), not a semantic untyped-check; a mechanical scan can't
separate them. The rule's Enforced-by line now says so instead of promising a
grep that would never work.

Enforcement summary moves 34/6/4 → **37 enforced / 4 partial / 3 unenforced**;
known violations 8 → 5. Remaining partials: FX-4 naming sweep, VAL-10 unitAware
completeness, VAL-12 blindness, VAL-14 only-if.

### The regression quartet owned — the broadcast-garbage class closes (2026-07-28q)

TREND/GROWTH/LINEST/LOGEST were the last array-RETURNING names still broadcast
(rangeRouting's DEFERRED): a 1-D list mapped the call element-wise into a
plausible-looking garbage list, the same silent class as T.TEST. Same fix shape
as every D23 tranche:

**Kernels shared** — `linearFitR2` (LINEST's slope/intercept/R² in one pass) and
`expFit` (y = b·mˣ via least squares in log space) join `linearFit` in
mathUtils; the Trend/Linest/Logest nodes' inline math collapsed onto them
(three near-identical SSxy/SSxx loops deleted from stats.ts).

**Four listArgs registrations** running those kernels (FX-1; GROWTH has no node
— it's TREND's exponential sibling on the same kernels). Pair prep is
`pairPresent` (error propagates, null pair drops, ragged truncates). Excel's
optional arguments, which node sockets can't express, work on the formula
surface: xs omitted/blank → 1..n, TREND/GROWTH's new_xs omitted/blank → the
known xs. Excel's trailing const/stats args are NOT taken: LINEST answers
[slope, intercept, r²] (the node's three outputs as a list; degenerate → null),
LOGEST [m, b] (y ≤ 0 → the node's quiet empty).

rangeRouting.test.ts's DEFERRED block became the quartet's owned pins
(node-equality + shape + value model). rules.md known-violation 7 DELETED —
the array-returning broadcast class is now fully closed; the backlog paragraph
about it reconciled the same way. Suite 3572 → 3577.

### The complex tranche: IM* owned over tagged Cx, operators typed (2026-07-28p)

The build the D23 amendment queued, landed. Four moves:

**Kernels extracted rete-free** — cxAdd…cxCsch, cxPow, cxLog10/2 moved from
`nodes/complex.ts` into `cxValue.ts` (the family's rete-free home, per the
listOps pattern), plus two new ones: `parseCx` (Excel's "a+bi"/"bi"/"a" grammar,
`i` or `j`, tolerant of formatCx's spaced output so the two round-trip) and
`quadraticRoots` (shared by the node and the registration).

**27 registrations** — the 25 IM* names + COMPLEX + QUADRATICROOTS, each running
the node's kernel (FX-1, node-equality-tested per op in `formulaComplex.test.ts`).
Arguments coerce IN from Excel's representations (tagged Cx, real number, text
form — invalid text #VALUE!, logicals #TYPE!); results are always tagged Cx.
IMSUM/IMPRODUCT are variadic folds; element-wise like the nodes, so they
broadcast over complex lists via broadcastCall with the per-cell contract.
IMARGUMENT(0) is 0 (the node's atan2), not Excel's #DIV/0! — FX-1 sides with the
node. `FAMILY_BACKING.complex` flipped verify → internal (the tagged currency IS
the difference that matters).

**Operators answer typed, never garbage** — `applyCxOp` routes a Cx operand
before numeric coercion: arithmetic and ordering → #TYPE! naming the IM* family
(was "[object Object]1"); `=`/`<>` structural within the family, type-strict
FALSE against anything else (the 5 = "5" rule); `&` renders through formatCx
(like logicals render TRUE/FALSE); unary minus and percent guard the same way.
No second cross-family bridge: the lattice's one bridge stays logical↔number.

**FX-9 grew a per-element half** — a Cx reaches a dispatch only through a
declared `cxArgs` registration (the matrixArgs pattern). Exempt: NULL_INSPECTING
value-passers (IF hands a complex branch through, predicates answer honestly)
and whole-list natives (REVERSE of a complex list is a legitimate shape op —
blocking it would have REGRESSED working behavior; their numeric members coerce
a Cx like any other non-number). SUM/SQRT/TEXTJOIN over a Cx now refuse with
#TYPE! instead of silently NaN-ing.

Non-pack parity 380 → **381/479** (Quadratic Roots was the leaf riding this);
remaining named leaves: Text Filter + Image/SVG/Promo. Suite 3552 → 3572.
Stale known-violation 7 in rules.md reconciled while there (only the regression
quartet TREND/GROWTH/LINEST/LOGEST is still unrouted).

### D23 amended: the complex exclusion was false, and unenforced (2026-07-28o)

The author caught it directly: "didn't we just fix complex to let it be in?" —
and yes. D23's "matrices-only: frames, cubes AND COMPLEX stay out" carried
complex on reasons that only ever applied to frames/cubes (verb-engine
competition, FrameRef economics, no-Excel-semantics — Excel HAS complex
semantics, the IM* family). Complex's real blocker was the [re,im]/2-list
ambiguity, which VAL-15 deleted the same morning. I wrote the exclusion anyway —
the exact carried-forward-constraint failure the provenance system exists for.

Verified live before amending: the exclusion is not even enforced. anydata
accepts the complex family, so tagged Cx values flow into Expression variables
TODAY; `x + 1` with a complex x concatenates "[object Object]1"; and IMSUM
dispatches through Formula.js on TEXT complexes ("3+4i" → "4+6i") while
answering #VALUE! on our tagged form — two representations of one type across
the two surfaces, the FX-1 drift in the flesh.

D23 carries a same-day amendment narrowing the exclusion to frames/cubes;
complex-in-formulas is now an open BUILD in the backlog (extract the complex
kernels rete-free, own IM* over tagged Cx + accept the text form, operators on
a Cx answer #TYPE!). Quadratic Roots' gap leaf rides on it.

### The remainder audit: false deliberations dissolved by measurement (2026-07-28n)

The author challenged the 289-leaf "deliberate" remainder; the audit found one
false blanket and one measurement artifact, and fixing the MEASUREMENT dissolved
most of the gap without registering anything:

- **Preset-formula leaves detected mechanically.** A locked ExpressionNode with
  its expr baked in (the timesaver pattern — and, it turns out, 148 of the 167
  pack leaves) has its own expr as its formula equivalent, typeable today. The
  walk now instantiates each leaf and checks `.locked && .expr` (SSOT-3 —
  derived, no hand-kept list). My "pack parity moot" blanket was HALF-true: true
  for these 148, false for the 19 custom-logic nodes now named in the backlog as
  the real pack workstream (PackFormulas through the existing seam).
- **The language's own leaves** (the four operator nodes, Comparison,
  Expression/Equation) counted as gaps — their equivalent is the language
  itself. A small named set, author-reviewed.
- **Eight genuine stragglers registered**: REVERSETEXT and SPELLNUMBER (their
  custom kernels moved to textOps — FX-2), DECODEURL (the existing decode half),
  LOG2 (matching the node's quiet-null on x ≤ 0, per FX-1, not an invented
  #DOMAIN!), HYPOTENUSE, and the Kleene trio XNOR/NAND/NOR (variadic,
  coerceLogical per operand, null poisons XNOR / flows by Kleene in NAND/NOR).

Non-pack: 380/479 — the remainder is sources/sinks/UI/endpoint plus five named
leaves each with a stated reason. Packs: 148/167, remainder = the 19
custom-logic nodes. The lesson is the audit's own thesis again: most of the
"gap" was the measurement not understanding the system, not missing work.

### The registry stops accepting silent collisions (2026-07-28m)

registerInternal was "idempotent-overwrite" — Map.set, so two modules claiming
one formula name was a lottery decided by import order, with the loser silently
dead. After a week that added ~120 registrations across five tranches, that was
the next collision waiting. It now THROWS on a duplicate live name (FX-4's
registry half, complementing the naming-side injectivity sweep); pack-revocable
names may return after unregisterInternal, which is the rebuild path.

The guard immediately caught a test-suite hack: excelFunctions.test "cleaned up"
its ABS test double by registering `undefined` as the impl — registering a hole
instead of unregistering. Cleanup is now unregisterInternal, and the guard has
its own pin (throw on duplicate, allow re-registration after withdrawal).

### D23 step 3, the lambda tranche: gap A reaches ZERO (2026-07-28l)

LAMBDA is now the evaluator's one SPECIAL FORM — handled before the generic
evaluate-args-then-dispatch path, because its parameters are unbound names and
its body waits for arguments. It constructs the SAME tagged LambdaValue the
LAMBDA node emits (extracted to `lambdaValue.ts`, rete-free, the cxValue
pattern), so a formula lambda and a wired lambda are one currency and one
evaluation core (FX-1). An unapplied lambda at the top level answers a typed
#VALUE! (Excel shows #CALC!) rather than leaking the object into the graph.

The seven hosts registered against that currency: MAP (the node's exact
(value, value2, value3, row, col) positional binding, 1–3 arrays), BYROW/BYCOL
(whole row/column as a list), REDUCE/SCAN ((acc, value, step) row-major; a cell
error stops the fold), MAKEARRAY ((row, col) 1-based, n×1 reads as a list,
MAX_GENERATED at the boundary), GROUPBY (first-seen groups, setKey-keyed, lambda
per group's value list, [key, result] rows — the Group Lists node's two outputs
side by side). formulaLambda.test.ts pins node-equality host by host, plus
SCAN(0,x,add) ≡ RUNNINGSUM(x) — the old gap-A alias made literal.

**EXCEL_NAMED_GAP is []** — every Excel name a node carries now dispatches.
357/646 leaves callable. The ratchet's empty-list comment says what a
reappearance means: a new node shipped without its registration.

Recorded deviations (backlog): eta-lambdas (bare SUM as a function argument) and
immediately-invoked lambdas (call-on-call in the parser) are not supported;
GROUPBY is the (keys, values, lambda) three-arg form, not Excel's full
field-spec signature.

### D23 step 3, tranche 2: the array-returning core (2026-07-28k)

UNIQUE, SORT, SORTBY, FILTER, TAKE, DROP, MODE.MULT, FREQUENCY, RANDARRAY.
349/646; gap A is 8 — entirely the function-argument family now (LAMBDA/MAP/
BYROW/BYCOL/MAKEARRAY/REDUCE + SCAN/GROUPBY), one tranche, a language feature.

Again the urgent half was the OLD names: UNIQUE, SORT, MODE.MULT, FREQUENCY and
DROP were dispatchable through Formula.js and broadcasting — UNIQUE([3,1,3,2])
answered a column of singletons, SORT a list of empty objects. Owned now, same
displacement as MMULT.

Kernel extractions came with two small honesty wins: UniqueNode's dedupe keyed a
raw Set by IDENTITY (harmless only because its socket is numeric — the VAL-8
letter now holds via setKey), and TAKE/DROP's signed count slice is ONE kernel
(takeSlice/dropSlice) under the two 1-D nodes, the 2-D node's per-axis slice,
and the formula — the 1-D and 2-D nodes previously disagreed about 0
(empty vs identity); each card keeps its own 0-guard, the kernel is shared.

One honest FX-1 note: FILTER's node (List Filter) is condition-ROW configured —
a different MECHANISM from Excel's computed boolean mask, so node-equality
doesn't apply term-for-term; the test pins the mask semantics directly and says
so. SORT is 1-D scoped (sort_index must be 1/omitted); ragged FILTER masks are
#SHAPE! rather than null-padded — a mask that doesn't cover the data is a user
error, not missing data. RANDARRAY is volatile per the SHUFFLE precedent, full
Excel signature (rows/cols/min/max/integer), MAX_GENERATED at the boundary.

rangeRouting's DEFERRED is down to TREND/GROWTH/LINEST/LOGEST — the regression
quartet, real fitting math, its own tranche when the kernels exist.

### The provenance audit: every rule graded, one stale claim caught (2026-07-28j)

All 43 non-PROV rules now carry a grade on their heading, and rules.test.ts
enforces completeness (every heading has exactly one of [ARR]/[INFERRED]/
[DEFAULT]) — so a future rule can't land ungraded any more than a future ARR can
be minted by an agent.

The grading itself was the audit: INFERRED requires a CONCRETE incident, named in
the rule's Origin, and 38 rules have one. The DEFAULT set — the rules held up by
nothing but agent judgment — is exactly five: SOCK-3 (derived lattice edits),
SOCK-6 (the wildcard predicate), FX-10 (one broadcast engine), VAL-13 (components
never call data()), VAL-14 (literal-map iff). Named in the PROV section as the
thinnest ice: first candidates for either an enforcing incident or deletion.
Notably VAL-13 and the OS-dropdown folklore in CLAUDE.md are the same epistemic
class — widely cited, no recorded incident — and now the doc says so out loud.

decisions.md gets the PROV reading at its head: nothing in the log is
author-ruled, INCLUDING verbatim quotes — a quote is evidence with the weight of
its reasoning, not a standing order; the reversal conditions are the honest
interface for reopening. This is the sentence that retires "the author said" as
a trump card, which is what the author's 99%-assumptions note asked for.

Caught during the walk (the audit paying rent immediately): rangeRouting.test's
DEFERRED list still called TRANSPOSE "unrouted" after the matrix tranche owned
it — the pin still PASSED (ownership isn't RANGE membership, so the assertion
held while its meaning rotted). The exact silent-staleness class the spec
fights, inside the spec's own test. Fixed, with the post-D23 note that ownership
at rank 2 (FX-9), not range routing, is now the right shape for the other nine.

### PROV: the provenance constitution — one ARR, by author ruling (2026-07-28i)

The author issued the spec system's first genuinely author-ruled rule, and it is
about ruling itself. PROV-1: a rule is author-ruled (ARR) if and only if the
author, in a specific session, has read the rules doc and marked the rule
THEMSELVES. Nothing else confers ARR — including things the author said in the
past. As of its creation, every other rule in the document is explicitly NOT
author-ruled, whatever its history; the agent was permitted to mark PROV-1 ARR
and no others.

Implemented as a new PROV section in rules.md: three provenance grades (ARR /
INFERRED / DEFAULT — a past author statement is EVIDENCE for reasoning, never
authority), PROV-1 marked [ARR], and a consequences paragraph downgrading every
"author-gated"/"author ruling" reading in the document to INFERRED. 44 rules.

The enforcement is the point: rules.test.ts gained the ARR-uniqueness guard —
exactly one [ARR] mark may exist and it must sit on PROV-1, with the literal
barred from hiding in prose. The agent cannot promote a rule to ARR without that
test failing; promotion happens by the author editing the file, moving the
guard's expected set in the same author-marked change. The rule that limits the
agent's authority is the first one the agent physically cannot break alone.

Standing implication for the audit (next turn's likely work): every recorded
"permanently", every "author-gated", every deference in decisions.md now reads
as the agent's inference. The per-rule provenance marks land with that audit.

### D23 step 3, tranche 1: the matrix core owns its names (2026-07-28h)

TRANSPOSE, MMULT, MUNIT, MDETERM, MINVERSE, WRAPROWS, WRAPCOLS, TOCOL, TOROW,
SEQUENCE — kernels extracted to `nodes/matrixOps.ts` (rete-free, FX-2), both
surfaces call them (FX-1), `formulaMatrix.test.ts` pins node-equals-formula
including the ERROR taxonomy (#TYPE!/#VALUE!/#SHAPE!/#DIV/0!). 344/646; gap A
down to 12; the ratchet caught its own seven stale pins.

The urgent part wasn't the new names — it was the three OLD ones. MMULT,
TRANSPOSE and MUNIT were already dispatchable through Formula.js, and step 2's
lift meant a wired matrix reached them ELEMENT-WISE: MMULT answered the Hadamard
grid of [object Object]s under the correct name. Ownership displaced that
(pinned: "ownership displaced the broadcast garbage"). This ordering lesson is
general — lifting a cap turns every already-dispatchable array name into a
potential silent-garbage source until it's owned or routed.

Blanks per VAL-1: Excel-style optional args arrive as blanks (`SEQUENCE(4,, 10,
5)`), so the tranche names joined NULLABLE_SCALARS_OK and each registration
decides blank-by-blank — a missing REQUIRED arg propagates null (the node
agrees), an omitted OPTIONAL one takes its default. WRAPROWS/WRAPCOLS carry
Excel's pad_with, defaulting to D15's #N/A. SEQUENCE's 1-arg form IS the
Sequence node (shared `sequenceList`); cols>1 wraps the same arithmetic
row-major with the shared MAX_GENERATED overflow.

Remaining tranches recorded in the backlog: the array-returning six
(FILTER/SORTBY/GROUPBY/RANDARRAY/SCAN/table-TAKE), then the LAMBDA family
(compilePositional at rank 2 — a language feature, last).

### D23 build step 2: the anydata rung — matrices reach formulas (2026-07-28g)

Spec-first, per the author's standing instruction: SOCK-9 (the rung), FX-9
(containment), FX-10 (one broadcast engine, table = test) and VAL-16 (the rank
grammar) went into rules.md BEFORE the code, and rules.test.ts caught the one
forward reference (SOCK-9 citing expressionMatrix.test.ts before it existed).
43 rules, 33 enforced.

The lift itself: `anydata` — element-agnostic rank ≤ 2, the rung between
`anycombo` (refuses the matrices D23 admits) and `trueany` (admits the frames and
cubes D23 excludes). Expression VARIABLES are anydata; the #SHAPE! matrix block in
expression.ts is deleted; a wired matrix computes by the broadcast table.

The RESULT socket is deliberately NOT anydata: it keeps its `resultAs` FAMILY (the
thing FCs key on — familyOf(anydata) is "none") and reconciles its RANK to the
computed value, swapping combo ↔ matrix rung through retypeOutputCables — the
standard SOCK-7 machinery, value-driven via a post-compute microtask so it never
runs inside data(). An error result leaves the socket where the last real value
put it. Headless runs skip the swap and just flow the value.

Everything downstream of the lattice edit was found by the existing machinery,
which is the spec system paying rent: the full sweep passed derivation untouched;
socketReference.test.ts flagged every stale connection list (regenerated
mechanically — the patcher must keep "all N variants other than…" shorthands on
one line, readSet parses them single-line), the glyph table, the FC-family table,
the gray-wildcards pin, and the variant count (31 now). The legend gains a
split-grid glyph (anycombo's split square + the matrix cross); units flow per D20
(envDim flattens a matrix — one homogeneous unit).

Still capped until step 3: the registrations (TRANSPOSE, SEQUENCE, the LAMBDA
family, matrix math) — a matrix can now reach a formula and every element-wise op
and aggregate works over it, but the 19 gap-A names still #NAME?.

### D23: the cap lifts — matrices in formulas (decision + build step 1) (2026-07-28f)

**The author decided Tier 4 with the packet on the table: YES, matrices-only.**
Recorded as D23 (criteria, bound rules, reversal conditions); the deferral entry is
gone; the packet is now the build spec and says so.

Build step 1 — the engine understands rank 2 before any socket admits it:
- `mapCells` in excelFormula.ts implements the eleven-row table ONCE, and every
  element-wise surface routes through it: operators (broadcast2 is now a shim),
  unary, percent, and broadcastCall. Shape (alignment, singleton-axis broadcast,
  null pad) lives there; each caller keeps its own per-cell semantics.
- `broadcastRules.test.ts` transcribes the table row by row (SSOT-6: the doc table
  and the test are one data). Aggregates flatten row-major, so SUM/AVERAGE/MAX over
  a matrix work with their 1-D null/error prep unchanged.
- Containment: a matrix reaches a dispatch whole ONLY through a declared
  `matrixArgs` registration (none yet). A 1-D whole-list native answers #SHAPE!
  honestly; positional lookups #SHAPE! until their 2-D forms are registered;
  Formula.js never sees rank 2 (element-wise broadcasting hands it scalars only).
  `ExcelRank` gains the reserved "matrix" spelling.

**Found while building: the evaluator was violating P3, and a test was pinning the
violation.** P3 rules "length-1 still broadcasts"; the zip padded `[5]+[1,2,3]` to
`[6,null,null]`, and excelFormula.test.ts asserted exactly that under the P3 label.
B11 closes it — the singleton broadcasts to `[6,7,8]` — and the pin now points the
right way with the history in a comment.

No user-visible change yet: the connect-time gate and the Expression #SHAPE! block
still stand, so no matrix can reach a formula from the canvas. Next: step 2 (the
`anydata` rung + the Expression lift), then step 3 (registrations in tranches).

### The Tier 4 decision packet exists (2026-07-28e)

`v2.0/17-matrix-formulas.md` — the two artifacts the recorded Tier 4 plan requires
before the author-present decision session, written immediately after the VAL-15
rebrand cleared the recorded shape-branding blocker.

Part 1 shows the branded-value/type-pass D2 feared is no longer needed: with every
special scalar tagged, `Array.isArray` at two depths IS the complete rank test, and
the two residual questions (orientation, empty `[]`) are conventions the lattice
already answered, not mechanisms. It also fixes the containment line: Formula.js
never sees a matrix — rank-2 dispatch requires a declared registration, permanently.

Part 2 is the broadcast table, eleven rows written to be transcribed into
`broadcastRules.test.ts` as a literal. The PAD question the first draft posed as
open turned out to be ALREADY ANSWERED, twice, and better than either blanket
option: P3 (2026-06-22) rules element-wise ragged ops pad with null ("the missing
tail is literally missing data" — built, pinned by broadcastContract.test), and
D15 (2026-07-09) rules shape CONSTRUCTION pads with #N/A per cell like Excel
(VSTACK/HSTACK/WRAPROWS/WRAPCOLS, cost accepted on record). Split by operation
kind, not rank — and it carries into formulas for free, because the construction
functions arrive as FX-1 shared impls whose #N/A padding rides inside the
implementation; the broadcaster's null rule never touches them. The packet is now
sub-decision-free. Part 3 is the yes-path build order and the no-path cleanup.

### Complex is a tagged object; VAL-15 (2026-07-28d)

Author authorized the Tier 4 prep sequence; step 1 is this rebrand. `Cx` is now
`{ __cx, re, im }` (`cxValue.ts`, rete-free beside errorValue) instead of a bare
`[re, im]` array — the last bare-array scalar in the value model, and the sole reason
"a cell may be an array" was ever true. New rule VAL-15 records it; `Array.isArray`
now means exactly "1-D list" everywhere.

What the ambiguity had been costing, all deleted rather than worked around:
- complex.ts's broadcaster needed an EXACT shape sniff (2-tuple-of-numbers) plus
  call-site tagging because `[1,2]` as a real list was indistinguishable from one
  complex. The tags stay (they carry per-operand element types); the sniff is `isCx`.
- Cast threaded a `cx` boolean from the SOURCE SOCKET through castOne — and passed
  `false` on the list path, so a cell of a complex list could never cast correctly.
  Self-identifying now; the flag is gone and the list path just works. `sourceKind`
  survives only for date-vs-number, the one genuinely untagged ambiguity left.
- coerceInputs carried outer-length special cases for complexlist/anylist ("can't
  disambiguate from a 2-list here"); both now take the generic path, and a lone
  complex correctly wraps to a singleton at strict list inputs — under the tuple it
  slipped through as a fake 2-list.
- setKey's canonicalization narrows from "any array" to exactly `isCx`.
- `ArrayChip.is2D` sniffs `Array.isArray(v[0])`, so a complexlist reaching a generic
  chip had rendered as a 2-column TABLE, silently. Tagged, it reads as the 1-D list
  it is; `formatListCell` renders a Cx cell as "a+bi".

This is also the Tier 4 shape-branding prerequisite: the recorded blocker ("a complex
[re,im] is indistinguishable from a 2-list") is gone, so the residual ambiguity
landscape for a matrix formula path is orientation only. No save-format impact —
complex values never persist (no complex literals; computed values aren't saved).

### SESSION DIGEST (2026-07-28c — the adversarial review walk over the post-1.2 work)

Author instruction: walk the post-1.2 commits newest→oldest assuming everything is wrong;
review, fix, push. Seven parallel review agents covered HEAD..cde8a8c by topic (rules.md,
formula surface, wired-null sweep, nodeOps, popups, copy pass, type-resolution) plus one
over the 07-22..25 tail. Six fix batches landed; suite grew 3433 → ~3500, all green.

**Wrong answers found live and fixed (the headline set):**
- `triBool` read a coerced boolean with `x !== 0`, so every WIRED FALSE in the Boolean
  family computed TRUE — AND(false, true) was TRUE, NOT(false) FALSE. Invisible because
  typed literals bypass coercion and the Kleene tests called bare `data()`. Now pinned
  through wrapNodeData.
- CHISQ.TEST corrupted upstream cached arrays IN PLACE (Formula.js mutates its args;
  prepRangeArgs returned them by reference). Range args now cloned at the FX boundary.
- F.TEST answered the variance ratio and T.TEST ignored tails/type entirely under the
  same names as correct nodes; PROB's null range cells coerced to 0. All three now share
  the node impls via mathUtils (tTestP/fTestP/probBetween).
- The wired-null sweep's own misses: Alert fired against the card's bound on a wired
  blank; Head/Join/Regex/OddCoupon guards not scoped to the active op; the column-LIST
  references (`?? []`) returned the UNFILTERED frame for a wired blank; Regex stringified
  null/SolError cells; XIRR reported an upstream error as #CONV!; IFS/SWITCH matched
  unset rows on null; Histogram/SevenSeg/Contour clobbered typed literals with wired
  values. The ratchet regex now catches `||`, line breaks and trailing comments — and
  immediately caught three more live swallows.
- Tier-3 registrations fabricated answers on blank scalars (Number(null)=0: ROLLINGSUM
  window-1, CONTAINS "found" a blank); RUNNING*/DIFF/NORMALIZE/ARGMAX were null/error
  blind ("0[object Object]"); SERIESSUM's pooled null-drop shifted coefficient powers;
  INTERPOLATE fabricated an x=0 point; RANGE silently truncated at 1000 on BOTH surfaces
  (now #OVERFLOW!/#DOMAIN!); REGEX* read JS flag strings where Excel's args were
  documented; TINV/TDIST redirected to the wrong-shaped T.INV/T.DIST.
- Sockets: `any`/`anycombo` bases adopted a `trueany` wire verbatim (SWITCH row became
  accept-anything — Bug C only half-fixed); the agree vote conflated unwired with
  wired-unknowable, so IF(cond, XLOOKUP…, date) typed as date (the fa3565a bug back
  through another door) — three-state vote now: unwired no-vote, wired trueany VETOES,
  NA() abstains via `errorOnlyOutput`; `anycombo` output couldn't reach an `any` input
  (Regex→SWITCH cables silently refused AND silently dropped on load); combo/auto
  Result socket was the `any` lying dot.
- Popups: editable cells committed per keystroke (sorted rows moved under the caret —
  now draft-commit like everything else); stale sort keys re-attached to new columns;
  header text-selection drags fired sorts; the mixed-type comparator was intransitive
  (−2 sorted after −1 next to "-1a"-style strings).
- Copy: the lint's collector couldn't see ternary/template titles (ArrayChip's
  "Click to view" — the highest-traffic tooltip — survived the purge), stems-only
  spelling ("penalises", "kilometres" shipped), LinSpace's description said the node
  COUNTS values, Comparison's claimed 1/0 after the logical migration, Report claimed
  charts embed as objects. Collector + rules widened; strings fixed.

**Structural: rules.md made true.** financeOps/excelFunctions were NOT rete-free (via
nodes/date.ts and nodes/convert.ts) — extracted `dateSerial.ts` + `convertUnits.ts`, and
FX-2 is now ENFORCED by `formulaPathIsReteFree.test.ts` (import-graph walk). FX-3's 53
undeclared registrations declared + the registered→declared test; FX-7's blocklist swept
whole (redirect/advertise/routing); VAL-8 was ALREADY pinned (doc corrected); VAL-12's
five misnamed op fields renamed + declared (IFERROR/IFNA now searchable); `rules.test.ts`
pins the mechanical half of the doc itself. Summary now 28/6/4.

**nodeOps:** generated op rows no longer inherit the `{ }` marker; the operation accent
edge skips secondary ARGUMENT selects (OpSelect `arg` prop — SUMIFS comparators, payment
timing); Chart/Sparkline/Regex/GroupBy dropdowns now derive from their OP_META tables
(Chart's groups moved INTO the meta); the parity metric's ops-rule is operation-kind
only (Group Lists no longer counts "callable" via SUM label collisions).

**Reviewed-sound (no action):** CappedZoom/pointerGesture (read directly), the
extraction fidelity of listOps/textOps/financeOps, LEGACY_ALIASES mechanics, SHUFFLE's
volatility split, the a657a58 tap-select ordering, seed loadability, 324b665's derived
family list, socket-shade HSV math, contrastInk baking, c133823's reconcile coverage.

### The label-less op families get their OP_META tables (2026-07-28b)

Closes the last of the op-selector items. Comparison, IS.TEST, Cumulative, GCD/LCM and
RoundN kept their per-op labels in their React component's `OPS` array, so `nodeOps.ts`
transcribed them by hand to build the Add-menu search rows.

**It had already drifted, which is the whole argument for the item.** The IS.TEST card
says ISBOOLEAN; search offered ISLOGICAL. You could read a name off a card and fail to
find it in the menu — the one failure mode the collapsed-family design is supposed to
make impossible ("nothing is undiscoverable just because it's folded up"). IsEvenOdd was
the same bug from the other side: `PARITY_OP_META` existed and nodeOps consumed it, but
the component still hand-wrote ISEVEN/ISODD beside it. The table existing is not the
invariant; both surfaces reading it is.

**Where the two roles genuinely differ, the table carries both** rather than one label
being copied and edited. Comparison gets a `symbol` field: the dropdown reads
"≥  Greater or equal" because on the card the glyph is the faster read, while a search
row wants the name alone. That absorbed `COMPARISON_SYMBOLS`, which was exported for
exactly this purpose and had zero callers.

Two dropdowns lose a gloss, and that was a copy call, not a mechanical one. Cumulative
went from "CUMSUM: running sum" to "Running SUM" — it matches the sibling Rolling family
and reads as the pair it is (Rolling is a sliding window, Running is everything so far),
and CUMSUM was never an Excel name. GCD/LCM go bare like every other Excel-name family;
the expansion is already in the catalog description, which is what the tooltip shows.

**The Set families keep hand-written name lists and are now the only two.** Their meta
labels are dropdown PROSE ("Union: in A or B"), which composes into "Set: Union: in A or
B" as a search row and stops discriminating between siblings — the bug that made
searching "symmetric" surface Union. Everywhere else `satisfies Record<XOp, …>` now makes
tsc prove the list is complete; for these two nothing did, so a new set operation could
reach the card while staying invisible to search. `nodeOps.test.ts` pins both directions
(the lists cover the meta exactly, and never take the prose as a name) plus the ISBOOLEAN
case itself.

Worth knowing for the remaining exposure item: `scripts/op-exposure.ts` matches a family
to its table by op KEYS, so these five reported as bare op lists with no coverage figure.
Its "no op table matched" bucket drops 18 → 13, and the remainder is genuinely config
selectors and the DATA pickers that should stay kind-only. Its GroupByFrame line is a
MIS-match to watch: that node is typed `AggOp` (13 ops, `frameVerbs.ts`), which has no
meta table, so the heuristic pins it to the 5-op `GROUP_BY_OP_META` off the shared `sum`
default. Pivot and CubeRollup are the same `AggOp` and show up ambiguous. The backlog
already says that table needs identifying first — this is what that looks like from the
audit side.

## Older entries archived

Swept verbatim to [`archive/dev-notes-history.md`](archive/dev-notes-history.md)
(latest sweep: everything through 2026-07-27b, on 2026-07-28). `git log` is the
per-commit record.
