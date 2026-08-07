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

### SESSION DIGEST (2026-08-07 — the 1.3 pivot: docs cutdown, backlog re-triage)
- **Author pivot: 1.3 ships basically as-is.** The coming weeks are bugs, patches, and
  thorough small-scope polish sweeps (node-by-node passes); everything feature-shaped
  is pushed to 1.4/2.0. Backlog rewritten to that shape (polish sweeps + bugs + small
  builds + release tail); the moved items live in `deferrals.md` "Pushed to 1.4/2.0".
- **Docs cutdown** (author: historical logs and verbose pattern-matching trip agents
  up). `decisions.md` rewritten 803→253 lines to the relapse-guard format — what
  stands / where / reopen-if per entry, IDs and the genuine relapse-guard lists kept,
  ADR narrative (when/cost/amendment chains) dropped to git. Dev-notes swept 968→232
  (sessions 2026-07-30a–08-04a to the archive). Archived whole: `formula-node-parity.md`
  (program complete, 548/548; the divergence catalogue stays the routed reference from
  archive), `cube-node-scope.md`, `excel-toolbar-supplementals.md` — all citations
  repointed. CLAUDE.md: stale claims fixed (rule count dropped, layout-chrome now names
  the measured envelopes, decisions format), capability map halved. Two stale deferrals
  reconciled out (∞ glyph, chrome-envelope hoist — both shipped 2026-08-05).
- **Cutdown pass 2:** CLAUDE.md's subsystem deep-dive index compressed back to actual
  one-liners (the detail lives in subsystem-invariants; entries had regrown to
  paragraphs). subsystem-invariants § Pointer gestures de-duplicated (census + palm
  rejection were each explained twice). architecture.md docs table reconciled (archive
  rows out, three missing docs in, stale counts dropped). pack-architecture's
  proposal-era tail ("none of this is built yet" / "if this ever gets picked up")
  replaced with the current state: Placeholder shipped, provenance record parked with
  pack distribution, eager registration deliberate.
- **Cutdown pass 3 (reconcile sweep over the unread set):** out-of-scope's stale
  claims fixed (Expression cap now cites D23's rank ≤ 2; publish-as-form noted as
  ruled OUT); glossary's autosave entry updated to the per-doc two-slot model;
  v2.0/README + value-semantics pointers repointed post-pivot; rules.md "Known
  violations" compressed to the one live item (the closed-history paragraph → git);
  release-notes-features caught up on the 2026-08 arc — AI palette added as a
  headliner, body lines for the one-paint card frame (the known-issues seam entry
  retired), frame-input EXAMPLE hints, error boundaries, and the touch-polish batch.
- **The posture is now IN CLAUDE.md** (pass 4): a "Current phase — 1.3 polish" section
  (small-scope sweeps only; parked work stays parked even when a sweep tempts) and the
  cutdown's standing rule under Doc maintenance ("write OUTCOMES, not narratives" —
  one home per fact, deletion as the default for history). Both were only in
  backlog/digest before, which a quick session never loads.
- **Pass 5 (structural):** (1) **The Quiet Accent Rule RESCOPED** (author: "not really
  that true") — the "never decoration" absolute was contradicted by the app (wordmark,
  accent window border, note/group tints, palettes, flow beads/`cableFlourishStore`,
  the two choreographed reveals, the planned art slot). DESIGN.md §1/§2 now say: chrome
  color conveys type/state; decoration lives in named homes (brand / user-authored /
  opt-in flourishes); NEW decoration is an author call, never an agent default.
  CLAUDE.md's citation updated to match. (2) **`docs/mental-model.md`** — the missing
  onboarding story (two React worlds, the compute path commit→processGraph→wrappers→
  data()→render, derived types, the FrameBackend seam, display pipeline, save/load);
  now step 2 of the Start-here order. (3) **`docsPointers.test.ts`** — pointer hygiene
  is machine-checked (140 assertions): live docs all indexed, no dead `.md` citation
  anywhere, archive index complete, routing-table code files exist. Its first run
  caught two live dead pointers (rules.md → the archived 17-matrix-formulas path;
  CLAUDE.md's root-unresolvable dev-notes-history shorthand) — the drift class the
  cutdown fixed by hand is now a CI failure.
- **Fine-print sweep, round 1 (2026-08-08 — the case family):** scanned all catalog
  descriptions for behavioral claims (45 leaves, 8 clusters). Finding: **Text Filter
  was OFF the D12 line** — case-sensitive raw `includes` while its two sibling
  filters fold case and D12 rules every comparison insensitive; `filterTextList` now
  folds (both surfaces — the node and TEXTFILTER share the kernel), description
  updated. **`caseContract.test.ts`** pins the whole D12 line in one place: `=`/`<>`
  insensitive, EXACT sensitive, frame Filter ops ± matchCase, Text Filter, join/
  group/distinct identity-sensitive, Replace Values (case-sensitive whole-cell,
  numeric match, substring strings-only, blanks/errors untouched). Replace Values'
  description claims all verified true against `replaceValues`. Sort nulls/errors-
  last already double-pinned. Remaining clusters recorded in the backlog item. — subpixel purge: border seam + note-ring overhang SOLVED)
- **The parked seam bug (2026-07-05 "UNSOLVED") is fixed** via the previously-untried
  lead: the card's whole painted frame — 1px body border, 2px header accent cap, and the
  header/body divider — now renders as ONE SVG overlay (`CardFrame` in `NodeCard.tsx`;
  geometry lives entirely in `nodeCard.css` via SVG-2 geometry properties), so all three
  strokes rasterize in a single pass and cannot round apart under the canvas zoom
  transform. Pixel-measuring the author's zoomed phone screenshots confirmed the failure
  was NOT device-pixel snapping: the 1px and 2px borders painted with a ~0.29 CSS-px
  outer-edge offset and different width rounding (0.86px vs 2.0px) — separately-painted
  strokes can't be made to coincide, so width/margin tweaks were dead ends by principle.
- Mechanics: the card + header keep transparent borders at the ORIGINAL widths (layout,
  offsets, socket math untouched — only the paint moved). `--header-h` is now published
  unconditionally (shared `useHeaderHeightVar`, fractional via `borderBoxSize`); the frame
  is TWO sibling svg viewports — an abs-pos svg is a replaced element that keeps its
  intrinsic 300×150 unless explicitly sized (first deploy shipped exactly that bug), and
  the second viewport is CSS-sized to `--header-h` so its overflow clip ends the cap +
  divider at the seam. All hover/light-theme/grouped border-COLOR rules now set the
  frame's `stroke`. The FC opts out (`frameless` — its single-stroke accent ring has no
  seam and stays a real border). The isolate endpoints and the palette-editor sample card
  carry `CardFrame` too (`--frame-outset`, being their own positioning contexts).
- Follow-up (author-eyeballed halo): the header's TINT painted to its border box and the
  div-rasterized bg edge poked a subpixel past the SVG strokes → `background-clip:
  padding-box` + 1px of bottom padding traded for a transparent bottom border tucks the
  tint fully under cap + divider (same header height, verified in headless Chromium).
- **Note-family selection-ring overhang (OPEN PROBLEM 2026-07-16) also SOLVED**: the
  `inset:-2px` `::after` ring duplicated the card's own 2px/radius-8 border geometry on a
  second box that rounded independently. The ring is now the card's OWN border, recolored
  on `--selected` (Note / Presentation / Report) — same painted stroke, nothing to
  misalign. SvgPicker/SessionHistory/Image keep their `::after` rings (different anatomy:
  2px ring over a 1px border, never showed the bug) — port the recolor treatment if the
  overhang ever appears there.
- **Op-selector resting edge stepped down to the 60%-toward-border accent mix** (the
  existing quiet-emphasis shade, same as `.solenoid-pres__step--active`). Author-walked:
  85% too close to the focus color, the header-band tint too subtle; 60% is the
  in-between step already in the system. Focus keeps the pure accent.
- **Accent-mix ladder formalized** (author-invited): named rungs as App.css vars —
  `--mix-hairline` 30 / `--mix-edge` 45 / `--mix-emphasis` 60 (toward border),
  `--mix-ink` 55 (toward text), `--mix-glow` 28 (toward transparent), `--mix-ring` +
  `--ring-into` (70%/#fff dark, 80%/#000 light, themed) — rule written into DESIGN.md §2
  ("The Accent-Mix Ladder"); all exact-recipe sites migrated. TWO reclassifications with
  visible deltas (eyeball): note-family/group/svgpick/history/image glows 22%→28% (the
  DESIGN-documented glow), and their LIGHT-theme rings 68%→80% (the nodeCard nerf, now
  uniform — 7 per-family light overrides deleted). Washes (12–22% transparent fills) left
  loose, documented as such.
- **Op selectors now render at the TOP of the card body** (author order), above the input
  rows: one flex-order rule in `nodeCard.css` (`.solenoid-node__body >
  .solenoid-node__op-select:not([data-op-arg]) { order: -1 }`) hoists every current and
  future node's operation selector; component JSX keeps its natural order, argument
  selectors stay in their rows. Requires the op select to be a DIRECT body child — a
  source scan found ONE wrapped case (ColorBlend's padding div, unwrapped). Socket rows
  measure offsetTop after layout, so cable endpoints follow the visual order.
- **Small-things batch (author-picked from the 1.3 design sweep):** (1) Infinity renders
  as the `∞` glyph (`format.ts`, scalar + list previews; value-semantics row → shipped).
  (2) The last two asymmetric icons optically centered by the archived 2026-06-20
  centroid measurements (lock viewBox +0.7y, sparkle +0.7x/−1y) — deferrals item
  cleared, author eyeball on preview. (3) Cube popup gained the TablePopup overflow
  trio (Copy CSV / Copy as Markdown / Export CSV…) — serializes the CURRENT drill
  level, all rows, source order, nested containers as their chip tokens. (4) **SOCK-14**:
  frame-input labels follow the column-role grammar (`Role + Role`, plain noun when no
  expectation, no shape parentheticals; λ-table exception) — enforced in
  `sourceInvariants.test.ts`; "Series (2-D)" → "Series", "Date + O H L C" → "Date + OHLC"
  (73 rules). (5) **`--chrome-bottom` hoisted** to mirror `--chrome-top`:
  `chromeBottom.ts` takes the max of the registered status bar + mobile action bar
  heights (safe-area rides inside the measurement); 13 bottom-anchored offsets across 10
  files now derive; mobile overrides keep winning the cascade with measured bases —
  `layout-chrome.md` reconciled.
- **Frame-input EXAMPLE hints** (author-directed, design delegated): hovering a
  column-expecting frame input's socket pops a compact mini-table of example data
  (3–5 rows) beside the socket — the worked example to SOCK-14's terse role label.
  Mechanics: a node class declares `static frameHints` keyed by input key (the
  literals-style declare-on-the-class shape; survives minification), `NodeSocket`
  resolves it per render (hover-intent 300ms, `hover: hover` media only, native type
  tooltip suppressed on hinted sockets), `frameHintStore` + `FrameHintLayer` (app root,
  z 120, fixed screen-space, flips right at the viewport edge, hides on leave / press /
  wheel). Styled on overlay chrome framed in the FRAME socket hue via the ladder rungs;
  dates format through `formatFrameCell` (app default format). Ten hints authored:
  Chart, Treemap, Sankey, Waterfall, Waffle, Candlestick, Calendar, Boxplot, Decision
  Matrix, Sensitivity. Playwright-verified against the live dev server (position, flip,
  date formatting, hide-on-leave, both themes). Author-walked twice same session: v2 is
  EXTREMELY mini (8px mono micro-grid) in the FRAME CHIP's language (translucent
  `--sock-frame` card, TablePopup's tinted column-name recipe), no example tag; TOUCH
  gets tap-to-show (pointerup on the dot; next tap / 4s dismisses — desktop-stack
  hover unchanged). **SOCK-15 (74 rules)**: the label↔hint pair is an enforced
  contract — every role-chain-labeled frame input MUST declare a hint whose column
  names match the label's roles (OHLC expands), `frameHint.test.ts` sweeps the catalog
  (existence + name match + 3–5 rectangular typed rows).
- **Touch-gesture spec formalized** (`docs/touch-gestures.md`, author-ordered after TWO
  phantom-gesture incidents in one session: layout-chrome's fictional "canvas double-tap
  add", then the real long-press-add going unfound because it rides the browser's native
  long-press → `contextmenu` with no greppable name). The doc is the normative gesture
  inventory per device config + the standing invariants (pinch capture / pan bubble,
  selection gating, the container-wide dblclick swallow). Two findings recorded in it:
  NOTHING can double-click/double-tap inside the canvas (the swallow is
  `stopImmediatePropagation` in capture — `NodeCard`'s square-collapse `onDoubleClick`
  is a DEAD PATH; the chevron is the only re-expand control, and its reveal now
  includes `--selected` explicitly so touch doesn't lean on tap-hover emulation —
  author caught the earlier "no touch re-expand" overclaim), and the marquee/lasso
  trigger is deliberately left unrecorded pending verification.
  layout-chrome's add-path note corrected to name long-press; CLAUDE.md points at the
  inventory. Mobile frame-hint tap fixed en route: the DOT scales with the canvas
  transform (2px at overview zoom — untappable), so on touch the whole socket ROW
  triggers the hint (verified on emulated Pixel 7, `html.is-mobile` gating active).
- **Mobile cable-draw jump FIXED (author-confirmed)** — `seatAreaPointerInCapture`
  (`areaPresets.ts`): `area.pointer` (the picked ghost cable's free end) updated only from
  BUBBLE pointerdown, which a socket press stops; desktop hover masked it, touch has no
  hover. Position bookkeeping now re-seats in CAPTURE like the pinch count (main canvas +
  drill-in). Emulated-Pixel probes of the other suspect stores (`CappedZoom.pointers`,
  the pointer census) came back strand-free across pick/drop/pinch/long-press flows.
- **Node descriptions reach touch** (author-directed A+E): (A) the node context menu —
  long-press's existing home — is now HEADED by the catalog one-liner (`describeNode`,
  the header tooltip's text) as a 9px muted width-capped blurb, so mobile and desktop
  right-click both get it without hover. (E) the Function Reference SEARCHED
  descriptions but never RENDERED them (no column) — a row with one now tap/click
  expands a full-width 10px description line beneath it (dense table stays dense;
  the add-node button stops propagation so it doesn't toggle).
- **Context menus clamp to the viewport** (`menuClamp.ts`, shared by all four:
  node/socket/cable/standoff-link): a layout-effect measures the menu and pins it
  inside 8px side margins and above `--chrome-bottom`, so a long-press near a screen
  edge (the blurb made the node menu taller) never runs offscreen or under a bar.
- **Description-length outlier trim** (author-directed distribution pass): scanned all
  catalog/pack `description:` strings — n=648, mean 100, σ76, max 556 — and rewrote the
  35 outliers beyond mean+2σ (~250 chars) tighter, keeping the load-bearing semantics
  and every Excel / Power Query equivalence. Max is now 447 (Expression, irreducibly
  the formula-surface explainer), p99 389→297.
- Eyeball list: stroke crispness at zoom 1 (SVG strokes aren't pixel-snapped the way CSS
  borders were — slight softness on fractional card positions is expected, matching the
  cables); collapsed cards; light theme; grouped members; iso endpoints; palette sample;
  selected notes/reports/presentations at fractional sizes; op-selector-on-top across a
  few families (math, frame verbs, dates, packs); lock + sparkle icon centering; bottom
  chrome positions (minimap/legend/palette/toasts, desktop AND a phone — the mobile
  lifts now derive from the measured bar); the frame-input example hints on a real
  mouse (hover feel, delay, sizing) AND phone (row tap). Hint v3 (author-walked): the
  TablePopup grid in MINIATURE (corner + row numbers + sunken heads + gridlines,
  solid panel) — the chip-tint card looked nothing like the frame popup; the ROW tap
  is the INTENTIONAL touch trigger (the dot's own tap can't work: cable pick captures
  the pointer), the dot's dead touch handler removed.


## Older entries archived

Swept verbatim to [`archive/dev-notes-history.md`](archive/dev-notes-history.md)
(latest sweep 2026-08-07: through session 2026-08-04a — the AI palette arc,
tablet bars, computed-column tail, D30 comment cutdown). `git log` is the
per-commit record.
