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

### Two audit findings built out: FC family resolution + INTERPOLATE grid (2026-08-01a)

Cashing the two items the harmonization sweep left actionable.

**The `isWildcardType` question, settled with a repro.** It WAS a real
inconsistency, two lines to reproduce: an FC wired OUT-only into an
Expression variable adopted `anydata` → `familyOf` none → NO controls,
while the same FC into a Display (`trueany`) showed the provisional number
set. Same intent, two answers, decided purely by which family-less rung the
consumer declared. The fix keeps the two questions apart: `isWildcardType`
stays the RANKLESS test (`any`/`trueany`) because rank-sensitive checks must
keep treating `anylist` &c. as a real dimensional constraint; family
resolution gets `isWildcardRung` (all six family-less rungs), used at the
FC's four resolution sites plus the docked-to-an-input read that had no
guard at all. `frame`/`cube`/`lambda`/`chart`/`document` are unaffected —
no element family, but genuinely resolved types with their own FC treatment.
Pinned both ways in `fcReconcile.test.ts`.

**INTERPOLATE grid mode is callable in a formula.** D23 lifted the cap that
parked it; the registration now dispatches the node's two MODES on the first
argument's RANK — a matrix runs the bilinear fill (`INTERPOLATE(table)`, an
optional second argument being grid mode's Forecast flag), rank ≤ 1 keeps
the 3-arg list form. One node, one name (FX-4). The move it forced is the
interesting part: `fillBorderedGrid` lived in `nodes/stats.ts`, which imports
rete AND `excelFunctions` — so sharing it would have been both an FX-2
violation and an import cycle. The kernel moved to `mathUtils.ts` where the
other shared kernels live, which is what FX-1 has always implied for a
two-surface kernel. Five pins in `formulaMatrix.test.ts`, all node-equality.
Parity counts unchanged (INTERPOLATE already counted via list mode) — this
closed a capability gap, not a counting gap.

### Docs-harmonization sweep: six audits, five reconcile tranches (2026-07-31i)

Author put the session on specs/docs duty ("the internal docs are yours").
Six parallel audits (glossary, socket-reference, format-model +
value-semantics, architecture + node-coverage, rules.md, the planning set)
diffed every internal doc against the code; findings verified by hand and
reconciled in five pushed tranches. The pattern behind most of it: the
D23–D26 run updated the code and the *adjacent* doc but missed the other
copies. Highlights beyond copy-fixes:
- **rules.md grew FX-13** (D24 resolution law) **and SOCK-13**
  (settle-before-dock); VAL-9 now carries the whole D26 model; **72 rules**.
- **A real SSOT-9 violation found and fixed**: Computed Column's side-socket
  reconcile was the twelfth hand-rolled cable-prune copy, in a node class the
  components-only sweep couldn't see — now `dropInputCables`, and the scan
  walks `nodes/` + `packs/` too.
- **A live wrong hint**: the formula syntax hint still called square brackets
  non-syntax (pre-D24) and outranked the paren-balance check; now only an
  UNBALANCED bracket is diagnosed.
- **The spec's own promise made true**: the custom-pattern field was the one
  FC control gated inline in the popup rather than in `formatModel.ts` —
  added `FcControls.customPattern`.
- **socketConnect's independent sweep gained `anydata`** — the D23 rung was
  absent from its `EVERY` array (only checked transitively before).
- Planning set: bundles 17 + 19 archived (v2.0 now 4 live), the 2026-07-29
  digests swept to history, parity backlog re-derived from the script
  (548 of 548 in-scope leaves), Data Feed baseline corrected (Stooq is dead),
  D2/D19-4/D24-Where fixed in decisions.md.
- Late tranches: SSOT-8 converted to a direct quantifier pin (the extracted
  `excelCoverage`; the live catalog can't distinguish some/every while gap A
  is empty); the four stale Stooq mentions swept incl. a user-facing Settings
  string; subsystem-invariants reconciled — its "Conduit perpendicular-face
  sign" section described a DELETED Manifold rule (no flip exists: −x in,
  +x out, rotated), the lattice edge-list gained the missing wildcard rungs +
  cube-as-supremum, unit authorship/branch facts corrected, a new SSOT-9
  pruning section added; dead `columnDisplayValue` deleted (base-SI premise,
  no callers); the `isWildcardType` two-of-six-rungs question is a backlog
  item needing a repro.

### Docked FC false Frame type on reload: settle before dock (2026-07-31h)

Author repro on the same chain as -f: reload the doc and the docked FC
"deloads", reading a false Frame type; re-docking by hand restored it.
Root cause was load ORDER in `persistence.ts` `rebuildGraph`: the FC dock
loop (`dockSelf` → `adaptTypeFromConnections`, which resolves the HOST
socket) ran BEFORE `settleWildcardTypes`, so INDEX's projected wildcard
output still read as its upstream's raw "frame" when the FC adopted —
and nothing re-adapts after the settle. Manual re-docking repaired it
because that re-ran the adapt post-settle. Fix: rebuild tail is now
composite hydrate → settleWildcardTypes → dock loop → syncUnitArrows →
refreshAnnotation, with an ORDER MATTERS comment naming the bug.
`fcDockReload.test.ts` pins both halves: the old order yields "frame"
(the mechanism — if that half ever passes with "numlist", the ordering
constraint can be relaxed), the fixed order yields "numlist" plus a
locked usd FC after the first compute.

### Stale shape-cap copy swept off the formula surfaces (2026-07-31g)

Author caught the formula POPUP still teaching the pre-D23 cap ("scalar /
1-D only, a matrix returns #SHAPE!"). Swept the class: the popup's engine
note now states the D23/D24 boundary (scalars + lists + matrices +
complex in; MAP/BYROW/REDUCE apply λs; frames out — verbs are nodes, and
in a computed column @name is this row, a bare name the whole column);
help/notes.md "where the edges are" likewise; and the Expression catalog
description dropped TWO dead claims — the 1-D cap AND "Formula.js …
can differ from the matching node" (false since the Tier-3 registry
unification: one shared impl, node-equality-tested). Equation's "numbers
and 1-D lists" line verified still TRUE (numListIn) and kept.

### FC forwarding LOCKS: an inherited unit is set elsewhere (2026-07-31f)

Author repro: computed column's unit → INDEX pulls a cell → FC inherits
the unit but the dropdown stayed editable; expected locked. The A2
forwarding state was DELIBERATELY unlocked ("a user pick still wins —
re-display"); the ruling flips it: an incoming `UnitCell` now mirrors the
inherited unit into the dropdown unconditionally (a stale pick must not
sit under a locked dropdown) and sets `unitLocked` — the FC never
re-authors over an upstream unit; Convert is the re-display tool. Also
closed C4 (author eyeballed the computed-cell look: fine). Pins updated
(unitCoercion fc2/fcAfterConvert now expect locked) + the author's exact
INDEX repro pinned; the STALE subsystem-invariants claim that the lock
states were "inert, always false" reconciled to the live three-state
model. Suite 3838. The author then supplied the load-bearing WHY, recorded
as **D26**: the unit is first-class like the magnitude — "you wouldn't just
let its magnitude be overwritten; a unit change is in reality affecting the
magnitude, comparatively" — so only the algebra (Convert) may change a
value's unit, ever.

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

## Older entries archived

Swept verbatim to [`archive/dev-notes-history.md`](archive/dev-notes-history.md)
(latest sweep: through 2026-07-29p on 2026-07-31 — the computed-column build
arc j–p plus the 29d verification note, whose open half lives in the backlog).
`git log` is the per-commit record.
