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

### SESSION DIGEST (2026-08-09b — ONE Distribution node; Running vocabulary pass)
- **ALL distributions are now ONE node** (author call, D34; an intermediate commit
  merged only the dist/inv pairs before the author clarified the intent). `nodes/
  distribution.ts` holds `DIST_SPECS` (14 distributions: label, forms, first-input
  key, params, compute kernel) and one `DistributionNode`: `op` = the distribution
  (VAL-12 family selector; palette rows "Distribution: Weibull (WEIBULL.DIST)"),
  arg-tagged `form` = CDF/PDF/PMF/tails/inverse ("form" added to INIT_FIELD_ORDER).
  An inverse form swaps the first input to Probability; a distribution switch swaps
  params; both prune departing cables first (SSOT-9). Forms carry across switches by
  meaning (PDF↔PMF, inverse variants → Inverse, else the spec default). The 14 dist
  classes + 23 per-node components are gone (old saves placeholder, D3); nodeExcel
  claims all ~30 Excel names on the one "distribution" type; kind "argument" so no
  formula names are claimed. BINOM.INV gained broadcast semantics (was scalar-only).
  Binomial Range stays separate (two-input range shape). Formula surface untouched.
- **Distribution is a plain OPERATION family; the accent follows for free** (author
  caught this in two passes: first that the selector wasn't accented, then that the
  `opNamesTheCard` flag added to fix it was a bolt-on). The real resolution: each
  distribution op claims its primary EXCEL spelling as its formula name via the
  existing `fx` mechanism (normal → NORM.DIST, gamma → GAMMA.DIST, derived from
  `DIST_SPECS[op].excel`), so the names are real, dispatchable, and dotted — the
  op-Gamma vs GAMMA(x) despace collision that had pushed the family to
  argument-kind can't occur. `kind: "operation"` → the accent comes through the
  normal `data-op-kind` path; the flag and its `opKindForNode` branch are deleted.
  Also ratcheted earlier in the session: RUNNING_OP_META joined the declared-fx
  uniqueness guard, and the `fx` doc comment states both declared-name cases.
- **Running vocabulary pass** (author): toggle option "All so far" renamed
  "Cumulative"; op labels lost the "Running " prefix (bare SUM/AVERAGE/...). The
  formula names keep the family word via per-op `fx` in `RUNNING_OP_META`
  (FX-4-checked), since despaced bare labels would collide with the Aggregate leaves.

### SESSION DIGEST (2026-08-09 — Cumulative + Rolling merged into one Running node)
- **Author call: the two nodes were too similar to stay separate.** One `RunningNode`
  (`list-running`, card "Running") replaces both; a `SegToggle` at the top of the card
  picks the window: **"Cumulative"** (grows from the start; the old Cumulative node) or
  **"Last N"** (slides; the old Rolling, showing the Window size input only in that
  mode). Vocabulary unified on ONE concept — an aggregate per element over its window —
  so the op set is the union across both modes: sum/avg/min/max/median/product/stdev,
  labeled bare (SUM, AVERAGE, ...): the card title carries the family word, and the
  formula names re-attach it (RUNNING + despaced op label).
- **Semantics unified on the per-window reducer policy** (null skipped, all-null window
  0 for sum else null, error poisons the windows containing it). Two deliberate edge
  changes from old Cumulative: a leading-null prefix now answers 0 for sum (was null),
  and non-finite values are skipped (were accumulated). The grow mode streams O(n)
  (Welford for stdev, binary-insert for median) and is pinned equal to the slide path
  at window = length (`list.test.ts`).
- **Formula surface follows** (D19 label-derived names): one RUNNING* family with the
  window as an OPTIONAL second arg (omitted = grow, blank = blank); ROLLING* names
  deleted, RUNNINGAVG→RUNNINGAVERAGE, +RUNNINGMEDIAN/RUNNINGSTDEV/window-arg forms.
- Mode switch prunes the window cable via `dropInputCables` before removing the socket
  (SSOT-9); `mode` rides the existing init persistence. Old saves with
  Cumulative/Rolling nodes load as Placeholders (pre-alpha, no shims). Timesavers pack
  no longer claims the rolling-* leaves; Running is core (as Cumulative was).

## Older entries archived

Swept verbatim to [`archive/dev-notes-history.md`](archive/dev-notes-history.md)
(latest sweep 2026-08-09: through the 2026-08-07 window — the 1.3 pivot and
docs cutdown, polish sweeps, frame-hint v3). `git log` is the per-commit
record.
