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

### SESSION DIGEST (2026-08-05 — subpixel purge: border seam + note-ring overhang SOLVED)
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
- Eyeball list: stroke crispness at zoom 1 (SVG strokes aren't pixel-snapped the way CSS
  borders were — slight softness on fractional card positions is expected, matching the
  cables); collapsed cards; light theme; grouped members; iso endpoints; palette sample;
  selected notes/reports/presentations at fractional sizes; op-selector-on-top across a
  few families (math, frame verbs, dates, packs).

### D30 comment cutdown: policy, routing table, ~5,900 comment lines removed (2026-08-04a)

The comment-minimalism pass, author-driven over several rule-building turns. **Policy:**
`docs/code-comments.md` (D30) — comments are the LAST-RESORT home; deletion is the
default outcome; homes hierarchy code > tests > specs/decisions/dev-notes > commits >
comments; test files exempt for now. **Routing:** `docs/README.md` gained the
"Code → spec routing" table (file → governing doc; routed files carry zero comment
pointers by design — the table IS the pointer). **The sweep:** 12 Opus agents over all
651 non-test source files (pixi excluded, deprecated); ~5,900 comment-ish lines
removed (22.1k → ~15.3k line comments + block trimming), `tsc` + full vitest green
after every batch. **Promotions** (knowledge that existed ONLY in comments, now in
docs): D29 (aggregators are arguments + the operation-vs-argument framework), D31
(Table Input raw-text truth), D32 (string byte order); new subsystem-invariants
sections (Group collapse retain rule, Equation solver, Renderer gesture GPU layers,
Semantic zoom gate, HIC raster atlas + clone-position, Bordered-grid fill); the
Formula.js divergence catalogue + P6 scalar-operator table into parity/value-semantics
docs; palette HSV sibling derivation into DESIGN.md; the Add-menu ~12-row pane budget
into node-coverage; tablet-bar deliberate omissions into layout-chrome; 6 latent
TODOs into the backlog (incl. one OPEN AUTHOR CALL: mode-selector inputs on a wired
blank diverge from value-semantics' propagate rule). One stale deferral (UNIQUE/SORT
range functions) verified already-executed and dropped. Agents' uncertain keeps are
flagged in the workflow outputs; nothing was deleted that lives nowhere else.

**Round 2 — the compression pass + the spec split (same session).** An author audit
found the sweep under-cut four classes (rationale essays, scope headers on routed
files, narration one-liners, banners); the policy gained the **blast-radius test**
(comment vs spec) and **compression rules** (one-sentence keepers; 2-line header
cap; zero scope prose on routed files; banners only ~400+ lines). A second 12-agent
pass removed ~8,400 more lines → **9.5k line comments** (22.1k at start, −57%).
`docs/renderer-performance.md` extracted as the first NEW domain spec (the four
renderer sections subsystem-invariants briefly held, + domSync, WICG spec-drift,
REF=1, the engage gate, the quality-drop negative result). Compression promotions
landed in: subsystem-invariants (Live connections cache+refresh + the FRED WAF UA,
Socket position bookkeeping, Graph load/teardown perf, drill-in breadcrumb stack +
activeGraph seam, camera targets across collapsed groups, ribbon bead-phase,
fillBorderedGrid algorithm + WIDEN=4, equation-solver root-closest-to-zero — fixing
an inaccuracy in the round-1 wording), node-coverage (multi-op expose/kind
taxonomy), layout-chrome (tablet-bar omissions, LABEL_MAX_HEIGHT derivation), and
the backlog (By-Row cap warning, lazy-handle collect(), WebGPU cable follow-ups).

### D27 + the AI prerequisite layer: strict reader, grounding spec, headless loop (2026-08-01f)

Author reversed the #7/#19 NL/AI ruled-OUT (recorded as **D27**: the AI layer is IN,
marketing stays minimal, the cage framing is the design rule). Then the backlog's
prerequisite layer was built:
- **`graphValidate.ts`** — the strict validating reader over the text form / SavedGraph.
  Contract: every condition the permissive loader silently repairs (unknown type →
  Placeholder, refused cable → dropped in rebuild, unknown init key → ignored, inline
  literal on a non-declaring class → dropped, sidecar ref to a missing name → lost)
  is an ERROR with a repair-grade, line-anchored message + nearest-name suggestion;
  what's legal-but-suspect (a dependency cycle → #CIRC!) is a WARNING — the
  null-and-logical seed ships a deliberate cycle, which is what forced the split.
  Init keys are judged against the CONSTRUCTED INSTANCE, not the static whitelist
  alone — extractInit also emits literals-spread keys (Slider min/max/step),
  extensible row keys (`valueKeys`), and composite fields, and every such key comes
  from the instance. Cable checks reuse `canConnect` (the live guard's own check);
  empty socket records (a Composite pre-hydrate) skip key checks rather than
  false-positive. Seeds sweep-tested clean both as JSON and through the text form
  (`graphValidate.test.ts`).
- **`npm run validate-graph <file>`** — the gate as a CLI (text form or JSON).
- **`npm run ai-grounding [-- --out f]`** — the model-facing spec, GENERATED from
  `buildCatalog(false)` + live instances (the Add-menu/Function-Reference move):
  grammar, socket lattice + type table, init whitelist, all ~315 classes with
  sockets, inline-literal keys, and op variants. Deprecated (hidden) leaves excluded.
- **`run-graph` accepts the text form** and gates both formats on the validator
  (`--force` overrides) — generate → validate → run works headlessly end to end.
- `textForm.ts`: `parseNodeLine` exported (the validator's per-line grammar pass
  reports EVERY malformed line; the reader still throws on the first).
Open before wiring the palette send site: the edit-granularity call and the
cold-graph Tidy check (backlog).

### AI demo mode + added-node reveal (2026-08-01j)

Two author asks: a fake-AI demo and animated AI additions.
- **`aiDemo.ts`** — type `demo` in Settings ▸ AI instead of a key and the palette
  runs against a canned local model, offline. The fake sits at the TRANSPORT seam
  (`makeDemoFetch` answers like the Messages API), so the production pipeline —
  fence extraction, strict validator, canonicalization, diff, Apply — runs
  unchanged; only the reply is canned. Behavior: a STAGED BUILD (sales frame +
  computed Revenue → regional totals via Group By → column chart), each stage
  appended to the RIGHT of whatever the document holds under Demo* names, so
  repeated prompt → Apply rounds grow the graph; a question-shaped prompt gets a
  computed summary of the current document instead; after stage 3, prose "done".
  `aiDemo.test.ts` executes the finished build headlessly to the real numbers
  (North 3250 / South 2402.5) and proves user content survives untouched.
- **`aiReveal.ts`** — an applied AI edit now animates ONLY its additions: the
  palette diffs node names before/after, maps them through `getLastLoadIdMap` to
  the fresh live ids, and stamps a class on each rete node holder; the keyframes
  (fade + 6px rise, 90ms stagger, `backwards` fill) run on the holder's CHILD so
  rete's translate positioning is untouched (and socket measurement reads offset
  boxes, transform-blind). Kept nodes stay put. Honors prefers-reduced-motion at
  both layers; the class self-removes after the last node settles.
- Settings note names the demo key. Real-key applies get the same reveal.

### Validator depth: op vocabularies, composite recursion — and a live seed bug (2026-08-01i)

The blind-hardening pass after the wiring:
- **`opVocab.ts`** — per-class `op=` vocabulary derived once (NODE_OPS families +
  every catalog leaf's constructed op + builder `hiddenOps` + the dropdown-only
  aggregate families via `AGG_OP_META`/`GROUP_BY_OP_META`, compile-complete).
  Shared by the validator and the grounding spec (Group By and kin now list their
  op tokens; before, a model had only description prose).
- **`graphValidate.ts`** — two new checks: an op OUTSIDE a known vocabulary of 2+
  (an unknown op constructs fine and then miscomputes — the reduce switch just
  never matches); and RECURSION into `init.internal`, so a generated composite's
  subgraph is held to the same standard (internal rete ids skip the name check).
- **Whole-catalog sweep test** — every Add-menu leaf, saved exactly as its factory
  constructs it, validates clean. This is the license to enforce the new checks.
- **It immediately caught a shipped bug**: `live-market-data.json` had
  `AggregateNode op="average"` ("Average since 2015") — not a `ReduceOp` token
  (`avg` is), so the reduce switch matched nothing and the card showed a wrong
  value. Seed fixed to `avg`.
- **`scripts/ai-prompt.ts`** (`npm run ai-prompt -- "<prompt>" [doc.txt] [--out]`) —
  the palette's EXACT loop from a terminal (same aiService), for the first
  real-key end-to-end without the UI. Needs ANTHROPIC_API_KEY; unrunnable in the
  container (no key), guards tested.
- **Authoring round 2** (blind, spec-only): join + computed column + XLOOKUP +
  chart doc converged; two stumbles were both spec-answerable (D24 `@Col`
  row-cell semantics; the output column name is `str:name`, not `addAs`) — noted
  as prompt-quality intel, no spec change needed.
- Palette CSS reconciled to real tokens (status hues as DESIGN literals — no
  app-wide status vars exist; buttons on the `--btn-*` set so both themes hold).

### The AI palette send site goes live: Anthropic, full authoring (2026-08-01h)

Author calls: Anthropic only · full authoring as the first scope · Vercel-preview
verification. The palette's inert TODO is now the working loop:
- **`aiGrounding.ts`** — the spec emitter moved from the script into src (the script
  is a thin CLI shell; output byte-identical). The app builds the system prompt from
  it at runtime, cached per session so the provider prompt-cache prefix stays stable.
- **`aiService.ts`** — official `@anthropic-ai/sdk` (browser opt-in; the key is the
  user's own from Settings ▸ AI), `claude-opus-5`, `max_tokens` 16000, server-side
  refusal fallback (`fallbacks: "default"`). Protocol: prose answer OR a full
  replacement text form in a ```solenoid fence; the fence is validator-gated
  (`graphValidate`), hard issues go back as repair rounds (≤2), the accepted rewrite
  is canonicalized through readTextForm→writeTextForm so the diff shows semantic
  changes only. Typed-error mapping to plain messages. Injectable fetch; the test
  file drives every branch against a fake transport (`aiService.test.ts`).
- **`textDiff.ts`** — pure LCS line diff for the approval view (`textDiff.test.ts`).
- **`CommandPalette.tsx`** — Enter in AI mode submits; result panel above the field
  (neutral overlay surface — the accent stays on the input marking the mode): busy /
  answer / error / diff-with-Cancel+Apply. Apply parses the validated text and rides
  `loadGraph` (the file-open path; undo history drops, recorded in the backlog).
  Escape steps out of a result before it closes the palette.
- **`Settings.tsx`** — the AI key row names Anthropic; stale "no requests are sent
  yet" copy corrected.
- **Tauri CSP** gains `https://api.anthropic.com` in connect-src (untested on a
  desktop build — backlogged).
tsc + vitest green (3916); `npm run build` clean for the preview.

### The authoring loop proven; the spec fixed where it failed; D28 (2026-08-01g)

Acted as the model in the backlog-prescribed prototype: authored three docs from
`ai-grounding` output alone (TVM mortgage — correct −2528.27 after wiring fv=0,
which the spec's "any four wired" prose did cover; frame filter+group-by; Expression
`pv*(1+r)^n` broadcast over a list), validating and running each headlessly. Every
failure was a SPEC gap, and each got a mechanical generator fix:
- **`- init:` per class** from `extractInit(defaultInstance)` keys (how a model
  learns TextInput's `value` or FrameInput's `frameText` exist), width/height
  filtered as geometry noise.
- **Op vocabularies**: NODE_OPS registry by ctor where declared; catalog-leaf
  variants otherwise; leaf `hiddenOps` appended (ops with no menu leaf). Residual:
  an op dropdown living only in a component (GroupBy's agg select) still isn't
  enumerated — its tokens ride the description prose only.
- **"Structured init payloads" section**: `frameText` = JSON `[{name, type
  (number|string|date|logical), values[]}]`; `condConfig` = row-index-keyed
  `{op, matchCase}` with the full FilterOp list (a `Record<FilterOp, string>` in the
  generator so tsc enforces completeness); row-literal convention (`str:v0="1, 2"`).
- **Empty-default inline maps** (List Input, Filter rows) now emit
  `inline: str: (input-row keys)` instead of silence.
**D28 recorded**: whole-doc text-form rewrite is the AI edit granularity —
validator-gated, approval = old→new diff; no edit-op layer (reversal conditions:
docs outgrowing whole-doc regeneration, or #35's MCP tools shipping).

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

### Tablet portrait: the bar wraps, and the envelope becomes measured (2026-08-01e)

Two device-test findings from the author, fixed together.

**1. Select mode panned AND lassoed.** `Canvas.tsx`'s effect that disables
rete's area Drag while select mode is on was gated `if (!IS_MOBILE) return`.
A tablet is not IS_MOBILE, so it kept its pan handler: one finger did both.
Now gated on `IS_COARSE` — the real condition is "a touch device where select
mode is reachable", and the tablet reaches it from the top bar. Desktop stays
excluded on purpose (shift-lasso blocks the pan per-gesture). The Navigator
had the identical bug from the identical cause — its accumulate test was
`IS_MOBILE && touchSelectStore.get()`, so select mode did nothing in the
outline on the one device with no keyboard to Ctrl-click with. Also IS_COARSE
now; its plain-click branch stays IS_MOBILE (that one is about double-click,
which a tablet shares with desktop).

**2. The bar doesn't fit in portrait** → it wraps below 1100px: fill the
line, push the overflow to the next one. The pinned trio is **theme ·
Reference · Settings**; "palette" in the original request meant the THEME
control, not the command palette, which is ordinary wrapping content.

Three wrong attempts before this landed, all worth not repeating:
- **`order` rules, unscoped.** A landscape tablet fits on one row and needs
  no help, but got reordered anyway — Reference/Settings shoved into the
  middle, edit clusters pinned right. Scoped to the narrow case.
- **A flexible spacer to hold the gap.** `__art` has `min-width:0`, so in a
  WRAPPING container it collapses to zero and the line just fills; the pinned
  trio ended up beside the wordmark.
- **A forced break element** (`flex-basis:100%`, zero height). This is the one
  the author caught: it ends the line whether or not more would have fit, so
  the bar broke after the layout pills with usable width left over. That is a
  two-row split, not a wrap.

What actually works: the trio leaves the flow (`position:absolute`, top-right)
and the bar reserves its column with `padding-right`. Everything else wraps
normally against the narrower line — no orders, no break, no spacer. Measured
in Chromium at 768/800/1024/1280; at 1024 row 1 correctly takes `cable` and
the palette too, and only `sel/grp/del` wraps.

**The wrap forced the envelope fix, and that's the durable part.** Six
top-anchored overlays hard-coded an offset derived from the same 66px header
(nav 80, Navigator 80, banner 80, align 76, HUD 124, report dock 66) — the
exact hand-keyed duplication `layout-chrome.md` was started for, and which it
deferred as "a cross-cutting refactor, do it author-present". A wrapped bar
makes the height CONDITIONAL — two rows in portrait, one in landscape, the
wrap point depending on the viewport — so the number stopped being writable
down at all and the deferral stopped being viable. `Header.tsx` now measures
itself with a ResizeObserver and publishes `--chrome-top` on `:root`; all six
derive from it, each keeping a static fallback so the first paint is right
before the observer fires. Mobile's overrides are untouched (they carry
safe-area insets and win later in the cascade). Pinned in
`touchActions.test.ts`. The bottom edge is the same shape of problem and is
now backlogged.

### Tablet: the top bar grows the touch actions (2026-08-01d)

Author request. A tablet fell between the two chromes: `IS_MOBILE` is
`IS_COARSE && IS_MOBILE_UA` and iPadOS ships a desktop UA deliberately, so
`MobileControls` never mounts — and a tablet user had NO touch target for
delete, group, select-mode, undo/redo or the palette. They're in the top bar
now (`TabletActions.tsx`), gated on `html.is-tablet` from the new derived
`IS_TABLET = IS_COARSE && !IS_MOBILE` (never sniffed at a call site, so a
device can't be both or neither — pinned).

**The height does not change, and that was the design constraint.** The bar
stays 44px inside the 66px header envelope because four overlays clear that
envelope with hand-keyed offsets (nav pill 80, align pill 76, HUD 124, report
dock 66) — growing the bar would have pushed its bottom edge under all four
at once, which is the exact recurring bug `layout-chrome.md` exists for. The
controls are ordinary 28px pill buttons in the existing row; the touch target
widens to 44px via a pseudo-element, so the laid-out pill height stays 30px
like every other pill in the bar.

Per the instruction to reuse the mobile bar exactly, the shared pieces moved
to `touchActions.tsx` — handlers, the selection poll, and the glyphs — and
`MobileControls` now consumes them too. Undo/redo/group still dispatch the
same synthetic keydowns Canvas already handles, so neither bar owns a private
path into the editor. The drift risk is silent (redraw a glyph in one bar and
both still compile and render), so `touchActions.test.ts` greps both files:
every shared symbol imported, no local re-declaration, and no inlined glyph
except the bottom bar's Add FAB, which the top bar deliberately doesn't carry.
Mutation-checked — inlining one glyph fails it.

Not carried over: the Add FAB (the bar has its own Add, and the canvas has
double-tap) and the raised accent treatment, which is a thumb-reach
accommodation for a phone's bottom edge and up here would just be a loud
button against the Quiet Accent Rule.

### FC annotations reach complex values — and a Display bug falls out (2026-08-01c)

The popup half had gated correctly since 2026-07-29; the annotation just had
nothing to act on, because the complex cards pre-formatted to a fixed string
in their own components. Fixed at the layer that owns formatting: a `Cx` now
rides RAW into the value box (`DisplayValue`/`OutputRowValue` carry it), and
`ValueDisplay` resolves it right after the annotation, before the rest of the
pipeline — so every downstream branch (box, chip, clipboard) keeps working
unchanged while finally honouring the FC. `formatCxValue` is deleted, not
kept as a shim.

`assembleCx` (cxValue.ts) now owns the WRITTEN FORM — "a + bi", the elided
unit coefficient, the dropped zero term — and both `formatCx` (default trim)
and the new `formatCxWithAnnotation` come through it, so they can't drift
into two spellings. The three complex-specific rules, each forced by two
components and one sign structure: style falls back to `auto` outside
`COMPLEX_FORMAT_STYLES` (an annotation can still carry `percent` from before
a retype); **precision applies to BOTH components** (the visible defect —
one formatted, one trimmed); and the unit wraps the WHOLE value, "(3 + 2i) V",
parenthesised only in the two-term form. The advanced tier is deliberately
not consulted — a complex has no single sign to parenthesise, no magnitude
to scale.

**Bug found on the way:** a complex wired into a **Display** rendered
`[object Object]`. The Display's fallthrough casts its value to
`number | string | …` and hands it to a number formatter whose backstop is
`String(v)` — which is `"[object Object]"` for a tagged Cx. Verified against
the old path before fixing. The same normalization fixes it, because it runs
before the component's own `render`.

Also queued from this work: `InlineOutputRows` resolves no annotation for ANY
type, so an FC on a multi-output card (Quadratic Roots, Equation, Regression)
doesn't reach its rows. Not complex-specific, not a regression — backlog.

### The distributions tranche closes the ops-list program (2026-08-01b)

Author ruling, asked directly: the right-tail forms stay **SEARCH ROWS, not
leaves** — a row per form would triple the Distributions section and bury it,
the same failure mode as the data pickers. So all 17 distribution families
went from kind-only to declaring their ops, which generates a search row per
form. The Add-menu tree is unchanged (pinned).

**FX-4 decided the `kind`, and it overruled the signal the module doc had
recorded.** That doc argued cdf/pdf were *operations* ("nobody computes
whether they want a probability density"), and by the pick-it-by-hand test
that's right. But an operation-kind op claims a formula name derived from its
label, and the forms don't have 17 families' worth of distinct names — Excel
models cdf/pdf as a `cumulative` ARGUMENT on one function, so "CDF"/"PDF"
collide across every family at once and with the leaves' own names. The full
FX-4 sweep caught it the moment the ops were declared. They're argument-kind:
the family takes one formula name, the form rides in as an argument, exactly
like the Excel signature. Nothing was traded away — `kind` and the menu are
separate axes, so the search rows are unaffected. The classification doc now
carries "does it have its own NAME?" as the signal that can overrule the
others, with this as the worked example.

Search quality got the same treatment as the ruling implies: since search IS
the discoverability mechanism now, the form labels are declared rather than
inherited (the SET_OPS precedent). The metas disagreed across families —
T.DIST said "RT" where CHISQ.DIST said "Right-tail" — so a query for one
form ranked another's row first. They now read the same everywhere
("Right-tail (RT)", "Two-tail (2T)"), and "right tail" ranks all four RT rows
first. Pinned: every form has a row, no family grew a leaf, and the natural
query ranks the right rows.

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
