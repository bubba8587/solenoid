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

### SESSION DIGEST (2026-08-11c — Architecture map overlay landed (spec-map steps 2–4))
- **View ▸ Architecture map ships** (`SpecMapView.tsx` + `SpecMapView.css` +
  `specMapStore.ts`, mounted in `App.tsx`, launched from `menuModel.ts` so the palette
  command comes free): the enforcement web drawn as a three-layer SVG graph in the
  Reference overlay's band — rule domains (left cards) → every cited test suite
  (middle rows; an edge IS an `Enforced by:` line) → the architecture.md module group
  the suite's home module is tabled under (right cards; stem match incl. companion
  `nameCell`s). A suite with no right edge is honest signal: its module isn't in an
  architecture TABLE (nodes/, packs/, the prose sections) — do not "fix" that by
  fuzzy-matching; a bipartite domain→group cut was tried first and connected only
  35/74 rules, which is why the suite layer exists. Hover previews / click sticks a
  2-hop neighborhood (accent = state); a detail strip shows the selection's rules,
  suites, or module files with tooltips (grade, MUST text, roles). Both docs arrive
  `?raw` and parse through `specMap.ts` — derived at build, HMR in dev, nothing
  hand-kept. Enforcement status is the panel's only standing color; `specMapStore`
  sanctioned under STORE-1 (transient open flag). Backlog item deleted;
  `architecture.md` App-chrome section records the cluster.

### SESSION DIGEST (2026-08-11b — spec-map view, step 1: the derivation layer)
- **User-requested feature, split into steps (limited-usage session did step 1 only;
  steps 2–4 are in the backlog under "Spec-map view")**: a live visual map of the
  rules/architecture, launchable from the View menu. Step 1 landed the parser:
  `specMap.ts` (pure, rete-free) turns `docs/rules.md` into domains → rules (id, title,
  provenance grade, MUST text, enforcement status from the summary table — the doc's
  own SSOT for it — plus cited `*.test.ts` files) and `docs/architecture.md`'s 2- and
  3-column module tables into concern groups; `testCitationIndex()` inverts rules →
  suites. `specMap.test.ts` pins it against the REAL docs using their own declared
  totals ("<N> rules.", the enforcement-summary counts) as the oracle, same as
  `rules.test.ts`. Prose-only architecture sections (App chrome, node layers, Tauri)
  carry no tables and are deliberately absent from the model.

### SESSION DIGEST (2026-08-11a — the formula surface: hints, INDEX, XLOOKUP/XMATCH; TS7)
- **Every autocomplete hint now agrees with its impl's declared arity**, pinned by
  a new sweep in `formulaSignatures.test.ts` that runs through `signatureFor()` so
  curated, pack-declared, and synthesized hints are all held to one grammar
  (unbracketed = required = arity min; `[x]` optional; honest `…` tail; LAMBDA the
  one special form). Found by an audit of the 2026-08-10 signature work — the new
  entries were clean; the failures were all OLDER: XLOOKUP promised a `[match_mode]`
  the impl never had, XMATCH's hint/arity claimed args the exact-only registration
  ignores (arity now [2,2] with the node's match modes noted), the REGEX* family
  hinted a nonexistent `[flags]` instead of the real Excel-documented optionals,
  five min-1 variadics overstated `x2` as required, and seven pack signatures used
  a private `property (default)` notation — normalized to `[property (default)]`.
  Backlog: XMATCH/XLOOKUP formula-vs-node match-mode gap recorded (INDEX genus).
- **XLOOKUP/XMATCH formulas now run the node's match kernel** (`xmatchIndex` in
  `listOps.ts`, extracted from `XMatchNode`): full match-mode family (0/1/-1) plus
  `search_mode` (1/-1, exact-scan direction = which duplicate wins); wildcard (2)
  and binary search (±2) refuse with #VALUE!. Arities [3,6]/[2,4], hints match.
  Kernel skips null/error key cells — also fixes the node's old null-coerces-to-0
  comparison in approximate modes.
- **`third-party-licenses.txt` now lists every SHIPPED version** — ten packages
  resolve at two versions (mermaid nests its own marked/katex/d3-*), and
  `rollup-plugin-license` keys by package NAME by default, so the file named
  `marked 16.4.2` / `katex 0.16.47` — versions we don't ship. `thirdParty.
  multipleVersions: true` keys by `name@version`; 85 → 93 entries. Same project +
  license in every pair, so this was attribution accuracy, not a compliance hole.
- **`marked` 14.1.4 → 18.0.9** — four majors, ZERO output change: the rendered
  HTML is byte-identical across all 511 catalog descriptions, the four
  `help/*.md` docs, and 15 GFM edge cases (tables, task lists, `breaks:true`
  soft-wraps, raw HTML, script injection, escaped table pipes). All six call sites
  use one narrow API (`marked.parse(md, {async:false, gfm:true, breaks:true})`),
  and the 15→18 churn was in the extension/tokenizer surface plus options removed
  back in v5–v7 — none of which we touch; DOMPurify sanitizes downstream either
  way. Half the weight (928KB → 468KB unpacked). tsc + suite + build green.
- **TypeScript 5.8.3 → 7.0.2 (the native/Go compiler).** `tsc --noEmit` over the
  839-file source: ~19–21.7 s → ~2.5–3.9 s (**~8×**); `npm run build`'s typecheck
  leg likewise. The package now pulls a per-platform native binary
  (`@typescript/typescript-<os>-<arch>`) as an optional dep — 2 packages total.
  Migration cost was two lines: TS7's new TS2882 rejects a side-effect import of a
  package with no type declarations, which hit the two BARE `@fontsource-variable/*`
  imports in `main.tsx` (their explicit `…/wght-italic.css` siblings were already
  fine); naming `…/index.css` fixes both and makes the four font imports
  consistent. Verified: both typecheck paths, full vitest, `npm run build`, and all
  four Atkinson faces (2 families × upright/italic) still in the built CSS. No
  TypeScript-API consumers in the tree, which is the usual native-port hazard.
- **XMatch node gains the search-mode toggle** (First/Last SegToggle, the frame
  XLOOKUP's control for the same argument) — closing the mirror-image gap the
  formula work opened. Binary ±2 stays omitted on every surface (author call):
  over a materialized column it finds the row a linear scan already finds.

### SESSION DIGEST (2026-08-10b — op-vs-arg harmonized across its three consequences)
- **The author's spec, now recorded in D29:** "having op" is ONE property with three
  consequences — the ops are genuine top-level formula functions, they get the accent
  and the top-of-body slot, and they are searchable. An argument is a parameter inside
  a top-level function. Three switches existed; they are one now.
- **`list-running` is an ARGUMENT; the formula surface is `RUNNING(op, list, [window])`.**
  The per-op family (RUNNINGSUM…RUNNINGSTDEV, signatures + registerInternal loop + the
  `fx` claims on `RUNNING_OP_META`) is gone and pinned dead by a resolution test; the
  aggregator arrives as a validated string argument instead (#VALUE! names the legal
  set), window omitted = cumulative, window given = Last N, blank window = blank.
  `SORT(list, index, order)` was the in-repo precedent all along — an argument-kind
  family (`list-sort`) whose host is ONE function carrying the selector as a parameter.
  Parity holds with zero special-casing: despace("Running") = RUNNING, so the leaf is
  covered by the ordinary label rule.
- **Why that took FIVE rounds, recorded because the failure mode recurred mid-fix.**
  (1) The classification was applied as a RENDERING flag — flip `kind`, keep the
  formula names — and the survivors were documented as a feature, citing D29's "kind
  and menu are separate axes", a Distribution line that does not apply. (2) Those
  preserved names were then measured and used as EVIDENCE that Running must be an
  operation — an artifact of mistake 1 argued against the instruction that produced
  it. (3) Given the spec verbatim, "argument" was over-rotated into "no formula surface
  at all" and the whole family was DELETED — reading half the definition ("not a
  top-level function") and dropping the other half ("a parameter INSIDE one"). The
  standing rule: when a classification changes, enumerate everything it governs and
  derive each consequence FROM THE DEFINITION — neither the smallest edit that clears
  the visible symptom, nor the largest that clears the quoted noun.
- **The other two disagreements are gone.** `headers` (promote/demote) and `text-filter`
  (contains/starts-with/…) were `argument` yet generated a searchable row per op —
  argument on the card, operation in the menu. Their ops are parameter values with no
  formula name (`contains` despacing onto the real CONTAINS function is the coincidence
  D29 warns about), so they dropped `ops`/`create`. No discoverability lost: Headers
  already carried "promote demote first row" in its leaf `keywords`, and Text Filter
  gained the equivalent. That is D29's own reopen clause — aliases on the host.
- Pinned by `nodeOps.test.ts` § "op-vs-arg is harmonized": an argument-kind family
  declares no op rows. Only the ARGUMENT half is asserted; the operation half (every op
  callable) belongs to the parity program and has tracked gaps (DATEDIF is 3/8), so
  testing it here would just duplicate a backlog as a red test.
- Correction to something claimed earlier in this session: `kind` is NOT styling-only.
  `formulaNodeParity.ts` reads it too (`decl?.kind === "operation" ? decl.ops : …`), so
  it already gated consequences 1 and 2 together before this pass.
- **`SegToggle` is now registered in the op/arg system** (author call; the styling
  question is deliberately NOT part of this). It takes the same `arg` prop `OpSelect`
  does, and VAL-12's source scan reads BOTH tags. This closed a real hole rather than
  tidying: a card carries its op picker as a dropdown OR a segmented toggle, and while
  the scan watched only the dropdown, a family could bind its op to `mode` in a toggle
  and be invisible to both halves of VAL-12 — the coverage check skips a node whose
  `inst.op` is undefined, so nothing would have demanded a declaration. That is the
  PadNode.dir defect through the unwatched door. 30 of 33 sites are arguments and now
  say so; the 3 that bind `op` (Sparkline chart type, Surface view, resistor band
  count) stay bare. Verified the scan bites by removing one `arg` and watching it fail.
  A THIRD picker component reopens the hole and no test can notice — `PICKERS` is a
  hand-maintained roster, noted as such at the constant and in rules.md.
- `rules.test.ts` caught the doc drift for free: rules.md quotes enforcing test names
  verbatim, so renaming the test to "every non-arg op picker binds `op`" failed until
  VAL-12's enforcement paragraph was updated.
- **Then the look followed the declaration** (author call): a SegToggle is functionally
  a dropdown in a different shape, so it now takes the SAME two rules on the SAME two
  conditions as `OpSelect` — `order: -1` to the top of the body when it is the family's
  op picker, and the accent only when the card is ALSO `kind: "operation"`. Argument
  toggles went neutral: resting `--surface-sunken`, selected `--surface-raised`, no
  color injection. The selected step had to move BOTH states — the old resting fill was
  `--border-subtle`, and a neutral selected fill of `--surface-raised` is invisible
  against it in dark (#2a2a2a vs #262626). Op toggles keep today's colors byte for byte
  via an override in `nodeCard.css` beside the OpSelect rules; the base rule in
  `SegToggle.css` is the neutral one, so specificity settles it in either import order.
- **Correction, author-flagged twice.** This first shipped described as "two independent
  conditions" with the resistor as the case proving it. Both halves were wrong. The
  resistor is not a curiosity — "binds `op`, declared `argument`" is the standard shape
  for 13 of the 15 argument-kind families (Group By, Cube Rollup, Group By frame,
  Running, Text Filter, Headers, Alert, Color Blend, Pipe Roughness, Antoine, Pivot,
  Drop Blank Rows), so singling it out invented a rule from a case that was never
  special. And they are not two axes.
- **op-vs-arg now has ONE home: `kind` on the NODE_OPS declaration.** The control-level
  `arg` answers a different question — "am I the family's picker at all?" — and saying
  it there was never a second vote; the field NAME only lets NODE_OPS attach. Enforced
  by a new companion scan: a control bound to the node's own `op` may not also carry
  `arg`. **It found two live contradictions on the first run** — `SortNode` and
  `DropBlankRows` were asserting "argument" at both levels. Dropping the redundant
  `arg` moves those two pickers to the top of their card bodies like every other family
  picker; they stay neutral, since their `kind` says argument. A per-row `c.op` on a
  criterion stays legal: that is a different object's `op`, and those genuinely are not
  the family's picker.
- Worth keeping: the ambiguity was IN THE PROP DOC. `arg`'s comment said "a selector
  that is NOT the family's op selector" and then listed the accent as a consumer, which
  reads as if it also declares argument-ness. Both prop docs now say what `arg` does
  not mean, not just what it does.
- Free check from the chrome-ramp work: neutral selection needs `--surface-sunken` and
  `--surface-raised` to be a visible step apart in every palette, which is exactly the
  "hover fill steps toward the ink" invariant `palette.test.ts` already pins.

### SESSION DIGEST (2026-08-10 — DATEVALUE + TIMEVALUE merged; the Parse card's layout)
- **One `DateTimeValueNode` (`date.ts`) replaces DateValueNode + TimeValueNode**
  — same single Text input, the op picks whole-day vs time-of-day and retypes
  the output in place (date ↔ number), Workdays' pattern: the component calls
  `retypeOutputCables` and `area.update` before mirroring the field. Parsing
  split into `parseDateOnly` / `parseTimeOfDay` helpers, unchanged behavior.
  Both Add-menu leaves stay (`date-value` / `time-value`, so the nodeExcel keys
  and per-op `describeNode` tooltips are untouched) and now sit as a pair inside
  the Parse category.
- **The layout bug was the socket label.** `.solenoid-node__io-label` is
  `flex: 0 0 auto`, so "Date text (e.g. \"2026-06-15\")" claimed the whole
  180px row and squeezed the inline text field to nothing. Both rows are now
  plain "Text"; the formats live in the catalog description the header tooltip
  already shows. Height 135 → 170 for the added selector (DatePart's shape).
  Worth a sweep: any other single-row card carrying an example inside its label.

### SESSION DIGEST (2026-08-09d — node-combining round 1: eight merges landed)
- **The author approved a candidate list and round 1 shipped whole** (D36; the
  full ranked survey + the parked set live in `docs/backlog.md` "Node-combining
  parked"). Eight merges, one commit each, suite green throughout: Hypothesis
  Test (`stats.ts`, Z/T×3/F/chisq — shared a/b keys so two-sample switches keep
  cables), Rank & Percentile (`stats.ts`, ten ops; the .EXC search rows kept
  their per-family hosts via three pair declarations sharing one leafOps list),
  Series (`list.ts`, Range/SEQUENCE/LinSpace; Start shared, Stop/End distinct
  deliberately — exclusive vs inclusive; unset-literal contracts preserved),
  ListTakeDrop (`list.ts`, dir argument like the table sibling), Workdays
  (`date.ts`, the one merge that retypes its OUTPUT in place — component calls
  `retypeOutputCables`, Split Frame's pattern), Depreciation+VDB (`finance.ts`,
  per-op spec table replaced the "(SYD/DDB only)" qualifier rows), NPV/IRR
  absorb XNPV/XIRR (`finance.ts`, Periodic/Dated SegToggle, `mode` field;
  dated prep deduped into `datedPrep`), Surface+Contour (`visual.ts`, 3-D/Flat
  SegToggle; payload kinds unchanged so renderers untouched).
- **Recurring mechanics that worked** (beyond CLAUDE.md's list): keep the OLD
  leaf types so nodeExcel keys, Reference parity flags and search stay put; keep
  shared input keys across ops so switches preserve cables and relabel in place;
  seed literals per-op but only DECLARED defaults (Range's Stop and SEQUENCE's
  Start/Step stay unset across switches); flat ops beat a second axis at small
  combo counts (per-op hover via describeNode keys on `${ctor}::${op}`).
- **Collateral**: seeds re-typed (SeriesNode; + the personal-finance generator),
  socketReference's class-count floor lowered to 260 (a did-the-sweep-run guard,
  not a census). SequenceNode had been falling through to the math kind; the
  merged SeriesNode gives it the list accent.

### SESSION DIGEST (2026-08-09c — Orchard palette; palettes can author the neutral chrome)
- **Palettes can now replace the whole neutral ramp** (D35). Started as canvas bg +
  dots only; the author called it immediately — a cream canvas under blue-gray cards,
  borders and ink reads as a mistake, so the ground can't move alone. `BUILTIN_CHROME`
  in `palette.ts` maps each palette to a per-mode `ChromeRamp` of 13 keys (canvas,
  dots, window, 3 surfaces, 3 borders, 4 inks). PARALLEL to the slot map, not more
  slots: nothing stores a neutral on a node and `resolveColor` never returns one.
- **The other ~40 neutral tokens derive** rather than being enumerated. App.css's
  var() chains carry most (`--btn-bg` → `--surface-sunken`); `chromeCssVars` mixes the
  literal-valued rest (panel/overlay fills, overlay border, btn hover, gauge track,
  selected cable, wordmark, light shadows). **The mix steps were calibrated by running
  the DEFAULT ramp through them and comparing to App.css's hand-tuned literals** —
  that's how `--overlay-border` and `--gauge-track` got caught overshooting (0.18→0.08
  and 0.6→0.35). Redo that comparison to retune; don't nudge until one palette looks
  right. Dark mode deliberately derives no shadows or wordmark (black is right on a
  dark ground; the wordmark tracks the accent), so those four stay cleared.
- `appTheme.apply` writes every chrome var from `paletteStore.chrome()[mode]` and
  REMOVES the ones the palette doesn't produce — an inline property beats App.css's
  ramps, so a skip (rather than a clear) would strand cream chrome under Default. A
  partial ramp writes what it has and derives nothing. A doc pin picks the chrome too;
  doc `overrides` stay slot-only. Report palette unchanged (exports don't draw chrome).
- **Orchard**, lifted from the Pear design system (`bubba8587/pear` DESIGN.md).
  Seven slots are Pear tokens verbatim (honey-bright/honey, pear-bright/pear-fill,
  blossom-fill, danger, quiet); Pear ships NO cool hue at all, so teal/sky/blue/
  violet/purple are blended into its gaps at its own S/V band — the same technique
  Solarized already uses for the accents it doesn't ship. The chrome is Pear's neutral
  ramps, mapped by ROLE not position: Pear sinks its fields, Solenoid's light theme
  makes the field the brightest layer (DESIGN.md §2), so Pear white → sunken, surface →
  surface, surface-sunken → raised.
- **The custom palette gained the ramp too**, surfaced in the editor (the app palette
  picker still shows colors only). Wells edit the LIVE theme's ramp — the two modes
  can't be judged at once, and the other is carried untouched through Save. Always
  COMPLETE, seeded from `DEFAULT_CHROME` (a hand-held mirror of App.css, since a test
  can't read a stylesheet), so picking Custom starts pixel-identical. Own LS key;
  "Load template" reseeds the ramp, so loading a chromeless one CLEARS authored chrome.
  The editor's sample scopes the drafted vars as inline custom properties on its own
  wrapper, so the real node/group/note CSS inside resolves against the DRAFT while the
  modal around it keeps the live theme.
- **Then every palette got chrome** (author call, same session). `Default` alone stays
  chromeless — it IS App.css. Muted lifts off near-black onto a soft charcoal (its brief
  is a calmer canvas); Colorblind-safe goes fully achromatic and a step crisper so the
  Okabe–Ito hues carry the entire type signal; **Solarized adopts its own base03…base3
  ladder**, which the palette had been ignoring while using only the accents; Equinox
  drops the blue cast Default's light ramp carries, which is a hue it has otherwise
  renounced. All-or-nothing per palette: a partial ramp derives nothing, so half a ramp
  is worse than none.
- **"Appropriate" got machine-checked rather than eyeballed** (`palette.test.ts` §
  chrome ramp structure): canvas darker than card, dot/canvas contrast in 1.1–2.2, field
  brightest in light and a recess in dark, hover fill toward the ink, border tiers
  stepping outward, ink tiers stepping down. Every rule is a claim DESIGN.md §2 already
  makes, and the App.css baseline is held to the same bar — a rule Default fails is a
  wrong rule, not a failing palette. It paid immediately, catching Orchard's muted ink
  below AA on its own card an hour after that shipped.
- **CONTRAST then got scoped back to `Default` + `Colorblind-safe`** (D35 amendment,
  author ruling). The AA sweep had been applied to every palette, and the cost showed
  up as infidelity: Solarized's card had been moved base02→base03 and its muted tiers
  invented, because Solarized sits near 3:1 BY DESIGN and no arrangement of its eight
  base tones fits four AA tiers on base02. Reverted — Solarized is now its canonical
  role assignment (background / background highlight / emphasized / primary /
  secondary, both modes), and Orchard's two muted inks are Pear's own again. The
  STRUCTURE rules still cover every palette; only the 4.5:1 check is scoped, via
  `AA_PALETTES` in the test, with a guard asserting the guaranteed set is actually
  present. Lesson worth keeping: a global quality bar applied to opt-in aesthetic
  artifacts converts them into averages of themselves.
- **Blueprint** (new, seventh): a cyanotype drafting table. Picked because the canvas
  already draws a 24px dot grid — on a prussian ground that grid stops being decoration
  and reads as drafting paper, which no other palette does anything with. Slots are
  colored pencils on that paper (chalky mid-value pigments that survive both grounds);
  chrome is the two ways the drawing was historically reproduced — dark is the cyanotype
  (white on prussian), light is the whiteprint (blue linework on cool paper). Cool end
  to end on purpose, so it and Orchard aren't the same idea twice. Clears AA in both
  modes without being required to.

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
