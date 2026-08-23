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
