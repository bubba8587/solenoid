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

### SESSION DIGEST (2026-08-19b — Decision family sweep: contributions, ties, seed)
- **Decision family sweep** (author: "the Decision matrix Node and seed could be a lot
  better") **→ D38.** Breakdown columns are now SIGNED contributions summing to the
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
  D35 structure survives any accent; byte-identical passthrough at the home accent,
  achromatic accents (gray slot, neutral cycle) leave the ramp authored, the other
  palettes hold still by brief. The first cut rotated in HSL and the author called
  it "washed in the color" — HSL saturation is hue-anisotropic (2× perceived chroma
  on Orchard's dark ground); the socket-sibling HSV rule is untouched (fixed
  near-hue steps vs a cross-hue rotation — boundary now written into DESIGN.md).
  D35 amended; pinned in `palette.test.ts` § accent-adaptive (chroma-never-inflates
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
  steal entry (top fits: List as a fourth Record op per D37, grouped gallery
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
  flagged D4-adjacent). Sources: Airtable gallery/kanban help, Grist widget-card +
  record-cards docs (raw GitHub), Notion gallery help, Baserow/NocoDB view docs.
