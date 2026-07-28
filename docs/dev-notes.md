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
