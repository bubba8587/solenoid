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


### SESSION DIGEST (2026-07-27b — the formula surface stops drifting: D19 ratchet, alias gate, Tier 1)

Picked up the D19 parity program (author call: "#2 is the important one"). Built in the order the
plan doc mandates — **ratchet first, so the gap lists are pinned before they move.**

**What landed**
1. **The measurement moved into `formulaNodeParity.ts`**, shared by the report script and the new
   `formulaNodeParity.test.ts`. Deliberate: a report that computes the gap differently from the
   test is how a ratchet silently stops ratcheting.
2. **The ratchet pins both gaps BOTH ways** — a new gap fails CI, and a *closed* gap must be
   deleted from the pin. Subset-only (as originally specced) lets the pin rot into fiction.
3. **`LEGACY_ALIASES` — D10 now applies to formulas** (D19 decision 1). 93 names: superseded Excel
   spellings (NORMDIST, TDIST, CRITBINOM, FORECAST…) and Formula.js spellings that were never Excel
   (CEILINGMATH, MODESNGL, RANKEQ, STDEVS, TDISTRT). Each returns `#NAME?` naming the current
   function, and drops out of autocomplete + range routing. Replaces the four hand-written
   VLOOKUP-era stubs.
4. **Tier 1: 28 registrations** — TEXTSPLIT/TEXTAFTER/TEXTBEFORE/ENCODEURL/REGEX*, FORECAST.LINEAR,
   and the 20-name bond block (PRICE/YIELD/DURATION/MDURATION/COUP*/ACCRINTM/INTRATE/RECEIVED/
   YIELDDISC/PRICEMAT/YIELDMAT/VDB/ODD*). Scope was only what **FX lacks**: `FAMILY_BACKING.finance`
   already ruled the closed-form functions it *has* stay on Formula.js, so DISC and COUPDAYS were
   left alone — registering them would have been an unrecorded backing flip.

**Numbers:** gap A (Excel-named node, name not dispatchable) 47 → 19; gap C (dispatchable, no node,
no decision) 102 → 0; leaves formula-callable 276 → 302.

**The structural point, which is the whole program:** every registration calls the NODE'S OWN
compute. Where a node's `data()` held the logic, it moved to a pure module both surfaces import —
`textOps.ts`, `financeOps.ts`, `mathUtils.linearFit`. Both new modules exist as separate files for
the same reason: `text.ts` and `finance.ts` already import `excelFunctions`, so pulling helpers the
other way would cycle *and* drag rete into the headless formula path. `mathUtils.ts` was already
this pattern. Writing the op twice is exactly how the surfaces drifted; `formulaTier1.test.ts`
asserts node == formula per function rather than trusting it.

**Two real bugs the ratchet surfaced on its first run:**
- **`fxLookup` couldn't walk through a FUNCTION**, only an object — but the name walk descends into
  both. Formula.js hangs `.MATH`/`.PRECISE`/`.INTL`/`.TEST` off a callable parent (`FX.CEILING` is
  the CEILING function *and* the home of CEILING.MATH), so **ten current-Excel names autocompleted
  in the formula editor and then threw "Unknown function" when called**: CEILING.MATH,
  CEILING.PRECISE, FLOOR.MATH, FLOOR.PRECISE, GAMMALN.PRECISE, SKEW.P, T.TEST, NETWORKDAYS.INTL,
  WORKDAY.INTL, BINOM.DIST.RANGE. Autocomplete and dispatch have to walk the same way.
- **Formula.js's internal `utils.*` namespace** (`utils.symbols.ADD`, `utils.date.serialToDate`) was
  being advertised as callable Excel functions.

**Gotcha worth keeping:** a blocked name must short-circuit at the CALL SITE, before arguments are
shaped. The redirect stub ignores its args, so letting a list arg reach the broadcaster mapped the
stub element-wise and returned a *list* of identical `#NAME?`s. Dropping blocked names from
RANGE_FUNCTIONS (as the plan said) is what exposed this — the two changes belong together.

**Left open, deliberately, not half-built:** the pack seam (D19 decision 4) needs
`FORMULA_FUNCTION_NAMES`/autocomplete to become pack-sensitive — they're built once at load, so a
pack-registered name would advertise while its pack is disabled. Nothing shipped here depends on
it. Tier 3 and Tier 4 unchanged; gap A's remaining 19 are D2-capped and ride on the Tier 4 call.

### Wired-null no longer resurrects the typed literal (2026-07-27b)

Top item on the 1.3 bug list, and a live wrong-answer bug: `inputs.x?.[0] ?? this.
literals.x` swallows a WIRED null into the literal, so a blank flowing down a cable
silently became whatever value sat in the node's own box. UPPER with a blank in and
"abc" typed in its field returned `"ABC"`.

Fixed on the OPERAND half — `text.ts`'s `strVal` plus every numeric operand in
`text.ts`/`date.ts` (LEFT/MID/RIGHT counts, REPT times, CHAR code, FIXED decimals,
DATE y/m/d, TIME h/m/s, EDATE months, WORKDAY days) now route through `readInput`.
No downstream change was needed: `broadcast`/`broadcastCells` already accept a null
arg and short-circuit missing per cell, so the plumbing was waiting on the readers.

**The contract has two halves and both are pinned** (`nodes/wiredNull.test.ts`): a
CONNECTED cable wins even when its value is null, and only an UNWIRED slot falls back
to the literal. Tests come in pairs for that reason — a fix that propagated
unconditionally would break every node's typed default just as badly as the bug it
replaced. Verified the tests actually FAIL against the old reader rather than passing
vacuously.

**Deliberately NOT swept: the MODE selectors** — `strScalar` (delimiter / separator /
filter pattern) and `basis` / `return_type` / `weekend_code`. A wired blank there is
genuinely ambiguous: "the mode is unknown, so the answer is unknown" (propagate, per
P6) versus "nothing supplied, use the default" (Excel's reading of an omitted optional
argument). An operand blank has no such ambiguity, which is why that half could go
ahead alone. Noted at both sites so it doesn't read as an oversight; the same question
governs the ~144-site sweep, so it wants deciding once.

### All 98 op-selector families classified (2026-07-27b)

Finished the declarations behind the op-kind edge. **73 operation / 25 argument**, and
`nodeOps.test.ts` now FAILS on any node with an op dropdown that has no declaration —
which is what makes the visual honest: a neutral selector can only mean "argument" once
every family is classified, because an undeclared one renders neutral too. The check
caught a family I'd missed (ResistorCode) on its first run.

**Kind-only declarations.** 77 of the 98 declare `kind` and nothing else — no ops list.
The type enforces the pairing (`ops` implies `create`), so a declaration either lists
its ops AND can build them, or lists neither. Kind-only leaves the menu completely
alone, which is correct for the ~48 families already listed op-by-op (nothing hidden =
nothing to list) and deliberate for the DATA pickers, where a search row per value
would bury the menu it was meant to help. It does leave the ~30 collapsed families
without search rows — backlogged with the exact list.

**Classifying is a JUDGEMENT with several partial signals — no single test.** I got this
wrong twice in one session, in the same way both times: took whichever criterion the
author had most recently articulated and promoted it to a decision procedure. First
"would you search the Add menu for it", which put the distributions' cdf/pdf on the
argument side because Excel models it as a `cumulative` flag; then the sharper dataflow
question ("could this be the RESULT of a chain, or does the user always pick it?"),
which I applied mechanically to flip eighteen families at once. Author: *"all the
criteria are partial rules… you can use your judgement based on the rules."*

The signals now recorded in `nodeOps.ts`, none decisive: would the user pick it or could
it arrive computed; would they search for it by name; is it meaningless without its
host; is it already an Excel function. They mostly agree — the interesting families are
where they don't. An ELEMENT symbol is both picked by hand and searchable, yet it is
plainly data that can come from a column and a row per element would bury the menu, so
it stays an argument. A RESISTOR band count is never computed, yet "4-band decode" isn't
a different operation from "5-band", so it stays an argument too.

**Final: 90 operation / 8 argument.** Arguments are the aggregator a host verb runs
(GroupBy, GroupByFrame, Pivot, CubeRollup) and the data-driven pickers (element symbol,
Antoine substance, pipe material, resistor band count). The distribution forms, chart
types, E-series and physics constants are operations: picked, never computed, and
searched for by name.

**Edge tuned to 2px** at an 85% accent mix, paid for out of the padding (1px border with
4px/8px becomes 2px with 3px/7px) so an operation selector occupies exactly the same box
as a neutral one and nothing reflows when a family is reclassified.

### Op-selector kind, made visible (2026-07-27b)

An op dropdown either picks between distinct OPERATIONS or sets an ARGUMENT of one
operation (`kind` in `nodeOps.ts`). Author wanted that visible.

**Tried an accent FILL first; author called it back — "DESIGN.md was right, these
accents are actually too much."** Landed on an accent EDGE over the normal neutral
field instead. Worth keeping as a data point: the fill objection DESIGN.md states
("the accent should never carry large fills") held up on a real screen, not just on
paper.

**The conflict the edge had to dodge:** a full-strength accent border already means
FOCUS on this exact control (`.solenoid-node__op-select:focus`). A resting accent
border would have made focus invisible. Resolved by INTENSITY, not a second hue —
resting takes the accent mixed 62% toward `--border`, focus keeps the pure accent.
Width stays 1px, so nothing reflows and the control keeps its footprint (the author
offered padding compensation; it turned out not to be needed).

**The tagging seam:** `NodeCard` stamps `data-op-kind` on the card root, so one CSS
rule covers every op selector instead of sixty components threading a prop. Resolved
by `instanceof`, not a constructor-NAME match — the latter works in dev and breaks
silently under minification. The attribute is ABSENT (not `"argument"`) for a family
not yet declared, so an undeclared node can't assert something false about itself.

**Inks got baked while the fill was live, and the baking stayed** (it's what the value
popups already needed): `contrastInk` is now cached, with every palette slot baked for
BOTH themes on each recompute — `themeAccent` darkens in light mode, so a slot near the
0.62 luminance threshold lands on opposite sides in the two themes.

**The kind test, sharpened by the author:** *is the variant a distinct thing you would
search the Add menu for?* "Column chart" and "Sankey" are, so Chart selects OPERATIONS
despite storing the value as a mode. GroupBy's "avg" is not. **How the value is stored
does not decide this; how a user looks for it does.** 17 operation / 3 argument so far;
78 of 98 families still undeclared.

### Multi-op nodes: the `{ }` marker + the exposure flag (2026-07-27b)

Author direction: a dropdown on a card is a NAVIGATION convenience for closely-related
work — each op is still its own thing, and they're normally also listed individually in
the Add menu. `scripts/op-exposure.ts` found the ones that aren't. `nodeOps.ts` is now
the one place that declares, per family, what ops it has and how they surface.

**Three independent axes, which is what makes the flag a one-word change:**
- `expose` — `"collapsed"` (the DEFAULT, per author call) or `"leaves"`. Collapsed
  leaves the tree alone; flipping to `leaves` generates a leaf per hidden op as a
  sibling of the host. No catalog edit either way.
- `kind` — `"operation"` (stands alone as a name → earns its own formula name under
  D19 2(a)) vs `"argument"` (meaningless without its host → the family takes one
  formula name and the op rides in as an argument). Author's correction: GroupBy's
  avg/min/max are ARGUMENTS, not operations. Does not affect the menu at all.
- `mark` — the subjective per-node opt-out. Default derived.

**The marker is `{ }` (with the space).** Ruled out: `▶` is already the menu's
"category that expands", so a triangle would promise navigation that doesn't happen;
`()` collides with formula syntax, and that collision just got worse — after Tier 1,
node names really are callable, so `Reverse()` would be ambiguous about whether the
parens mean "has hidden ops" or "you can call this".

**Marked is DERIVED, never declared** — a leaf shows `{ }` iff it has ops with no leaf
of their own. It cannot claim something the menu contradicts. `mark: false` opts out of
the glyph only (used on `GCD / LCM` and `ISEVEN / ISODD`, whose labels already name both
ops); the ops stay searchable regardless.

**Search rows are generated at SEARCH time, not inserted into the tree.** "Chart:
Column" is findable and builds the card already set to that op, but the tree is
untouched — so the parity ratchet, the copy lint and the socket filter don't start
counting them as extra nodes. Verified: catalog leaves stayed 646, parity stayed
302/646. Net effect is 20 marked leaves and 66 new searchable ops, zero leaves moved.

**Result:** 648 tree leaves (unchanged), 18 marked + 2 opted out, 66 op rows in search.

The one hand-written fact is `leafOps` (which ops already have their own entry, for the
partially-exposed families) — `nodeOps.test.ts` machine-checks it against the real
catalog, so it can't go stale.

### D19 decision 2(a) RESOLVED + the absent-pack boundary (2026-07-27b)

**2(a) — per-op names, uniformly; the name is the node's LABEL despaced, not the class
hint.** The deciding argument is this app's own editor, not taste: a string-literal op is
invisible to it (no autocomplete, no unknown-name highlight, no signature hint), so
`SETOP("unoin", a, b)` fails at runtime where `SETUNOIN(a, b)` is flagged as you type.
Confirmed twice over — the Tier 3 sketch already said "SETEQ/SETDIFF-style", and the node
LABEL already changes per op (the card reads ARGMIN, never ARGMINMAX). Labels are already
names for three of the four families (WAVG/WVAR/WSTDEV, ARGMIN/ARGMAX, Rolling SUM →
ROLLINGSUM); only SetOp needs invented names, its labels being prose.

**The pack seam's guarantee covers DEACTIVATED, not ABSENT — author caught this.** The
"resolution is global" phrasing oversold it. A `PackFormula.impl` is a JS function
shipping inside the pack, so a pack removed from the packs folder has nothing to call; it
sits on the custom-LOGIC side of the line `pack-architecture.md` already draws, not the
pre-set-formula (data) side that survives its pack being off. The seam handles
present-but-off, which is what it was built for, and is re-runnable so a folder reload
works (`loadCustomPacks()` is still a stub, so nothing calls it yet).

The unsolved piece is DIAGNOSIS, and it is narrower than the existing placeholder plan:
placeholders degrade a missing pack NODE, but a pack function called from a hand-typed
Expression is NOT a pack node, so nothing degrades it and the error never names the pack
that would provide it. Filed under the backlog's "Pack distribution" item, which already
owns the saved-file pack record that would make naming it possible.

**Process note:** several doc edits in the two preceding sessions silently no-opped —
`str.replace()` with no assertion, against text that had already moved. The parity doc
still claimed the work was "GREENLIT but not started" after it had shipped. Assert every
scripted doc replacement; a doc that quietly fails to update is worse than one never
touched, because the next reader trusts it.

### The pack → formula seam (same session, 2026-07-27b)

D19 decision 4, built as `formulaExtensions.ts` — deliberately the direct sibling of
`fcExtensions.ts`, which already solved the same problem for FC units.

**The asymmetry is the design, and it is not symmetric on purpose:**
- **Resolution is GLOBAL** — every known pack's functions register at startup, active or
  not. A formula pack node serializes as a plain ExpressionNode and reloads with its pack
  switched off (the `pack-architecture.md` guarantee), so the functions its formula calls
  have to keep answering. A deactivated pack that turned saved documents into `#NAME?`
  would be a data-loss bug, not tidiness.
- **Advertising is ACTIVE-ONLY** — highlighting and autocomplete offer a pack's names only
  while it's on, so an off pack doesn't teach a name the Add menu isn't showing.

**The actual blocker was smaller than the plan implied.** `FORMULA_FUNCTION_NAMES` was a
load-time snapshot; packs register after load, so it could never see them. Now
`formulaFunctionNames()`, memoized against a registry generation counter bumped by
`registerInternal`, with `advertisedFunctionNames()` as the editor-facing subset (memoized
against `packsStore.version()` — highlighting runs per keystroke).

**Two bugs found by writing the test, both real beyond the test:**
- `initPackFormulas()` wasn't re-runnable. The collision check asked "does this already
  resolve?", which is true of its OWN previous registrations — so a second run rejected
  every name it had just registered. Fixed with a core-name snapshot taken on the first
  call, before any pack registers.
- A removed pack's functions lingered as ghosts, since `registerInternal` had no inverse.
  Added `unregisterInternal`, and init now withdraws the previous run's registrations
  first. Only pack registrations are revocable; the core's run once at load.

A pack may not claim a core name, a blocked legacy spelling (no reviving NORMDIST), or
another pack's name — all three throw at startup, where it's obvious, rather than changing
what SUM means three screens later.

**Tier 3 naming, settled by inspection while here:** D19 decision 2's rule yields clean
bare names off the existing classes (`ReverseNode` → REVERSE, `SetRelationNode` →
SETRELATION, `NthElementNode` → NTHELEMENT). Only 2(a) is open — the multi-op families
(SetOp, ArgMinMax, Rolling, Weighted) choosing op-as-argument vs per-op names. Recorded in
the parity doc; recommendation is to decide per family, not globally.

### SESSION DIGEST (2026-07-27 — socket shades onto one HSV axis; the copy rules got teeth)

**Pinch-zoom died over most of a node card, and had for a long time.** Root cause, read out of
`rete-area-plugin`'s `zoom.ts` rather than guessed: stock `Zoom` counts fingers from a
**bubble-phase** `pointerdown` on the container, and `Zoom.move` is a `.map` over pointers it
already holds — never an upsert. So a finger swallowed anywhere below the container is invisible
to the zoom handler for the WHOLE gesture, with no recovery: two fingers, one counted, no zoom.
That made all ~180 `onPointerDown={(e) => e.stopPropagation()}` sites pinch-blockers, which is
why the bug read as random — whether pinch worked depended on which pixel finger 1 landed on.
Worst surfaces: FC (21 sites), the connection nodes (9), every inline field.

This was diagnosed **once before**, on 2026-07-04, and fixed only for the lasso; the general class
survived because that fix was per-call-site. Fixed positionally this time — `CappedZoom` re-seats
the count into **capture phase**, so no call site can break a pinch and none has to remember not
to. The bubble half is kept on purpose: pan/node-drag stay vetoable, so a control that wants the
pointer still suppresses them. **Pinch = capture, pan = bubble** is now the stated invariant
(`subsystem-invariants.md`). Two traps in the override: registering capture *without* removing the
bubble one double-pushes every contact (`isTranslating()` true on ONE finger), and stock `destroy`
removes without the capture flag, so it leaks the listener on every drill-in open/close.

**`pointerGesture.ts` (new)** — a window-capture module singleton, the one answer to "what gesture
is in flight", readable by rete's Zoom instance, the Canvas pipe and the lasso without threading a
ref. `isPinching()` = **≥2 touch contacts**, and everything now reads that instead of counting raw
pointers — a mouse or a stylus in contact is not half a pinch. **No palm rejection** (author call,
same session): this is a precise editor, nobody rests a palm on a node graph, so a pen is handled
only as a PRECISE pointer — never counted toward a pinch, and keeps select-and-drag in one motion
like a mouse. Pen barrel/eraser no longer grabs a node drag. Revisit only if a drawing-style
surface ever lands, and with contact geometry rather than a pen-active flag. 10 tests, incl. the
phase assertions (a bubble regression fails loudly).

**Pinch also SELECTED whatever finger 1 landed on** (author-reported after the capture fix).
rete picks on pointerdown because the drag depends on it, so at that instant the gesture is
genuinely unclassifiable. Deferred rather than corrected: an unselected node is now
drag-transparent to TOUCH, so the press falls through to a pan and selection happens on pointerup
only if the gesture stayed one finger and didn't move. Rollback (snapshot + restore on the second
finger) was built first and rejected by the author — it flashes for however long the fingers are
apart, and correcting a wrong state reads as a glitch where never entering it reads as nothing
happening. The model already existed for phones; it's now keyed on **pointer type, not device
class** (`tapTouchRef`), since "this press might become a pinch" is true of any touchscreen. Mouse
and pen keep select-and-drag in one motion; a SELECTED node still drags on the first touch. Cost:
a tablet now needs tap-then-drag to move an unselected node, as a phone always has.

**Tablet** needed nothing beyond the capture fix, and that's the finding: `IS_MOBILE` is false
there (iPadOS ships a desktop UA), so a tablet runs the desktop model — nodes aren't
drag-transparent, and two-finger pan is its canvas gesture. Before this it could only pan over
empty canvas. `stopDragStart`'s `!IS_MOBILE` gate is therefore correct as written, not a gap.

**Sweep: 60 raw sites → `stopDragStart`** across 35 node-card files. Now purely about the
ONE-finger question (pan vs. element) — pinch is safe regardless. Deliberately NOT swept: chrome
outside the rete container (can't affect a canvas gesture), drag-interactive controls, `<textarea>`
(owns its scroll/selection), and native-popup controls. That last group I first reverted on the
strength of CLAUDE.md's OS-dropdown rule, then checked: **that rule is widely cited but has no
recorded originating incident**, and the mobile path suggests it may not hold (form controls are
already excluded from tap-to-select; `patchDragGuard` bails before any pick; mobile opens the
picker on tap-completion, not pointerdown). Left swallowing anyway — the upside is near zero and a
broken pick is real — but it is now labelled **precaution, not mechanism** in CLAUDE.md and
`coarse.ts`. Settling it needs browser automation, not reading.

**Socket colors: every transform is HSV now** (`palette.ts`). `socketArrayShade` was an RGB
multiply (already equivalent to a value scale, so a free conversion); `socketMatrixShade` was HSL
and was NOT — its `L ×0.86` traded against saturation per hue, landing as V ×0.89 on saturated
gold but S ×1.26 on duller sky. Its replacement (h −11°, S ×1.18, V ×0.92) is that transform's
real HSV effect averaged over every built-in palette's matrix slots, so swapping spaces did not
move the depth. **Do not reintroduce an RGB multiply or an HSL step here.** Three knobs turned,
all named constants: `ARRAY_VALUE_SCALE` 0.85, `MATRIX_HUE_SHIFT` −11, `LIGHT_VALUE_DROP` 0.045
(that last is GLOBAL — `themeAccent` also feeds node accents, groups, notes, minimap,
`--sol-error`). Rings track automatically, being a fixed step off their own fill.

**Reference overlay → Socket Types rewritten** from `docs/socket-reference.md`. Two false claims
died: "any node that takes a Frame takes a Cube" (backwards — `cube` reaches only `cube`/`trueany`;
the FRAME widens into a cube), and `any` described as pass-anything (it is the rank-0 wildcard;
`trueany` is the one). **Never name color HUES in app copy** — they are false under
Colorblind-safe / Solarized / Equinox; shape and relative shade are palette-safe.

**"Zero learning curve from Excel" is a mandate for MECHANISMS, not prose** (author ruling, now in
the CLAUDE.md bullet that caused the misread). The overlay's tab docs cover only what normal usage
cannot make obvious — the socket lattice, unit flow. **If a legend, tooltip, glyph or control
already carries it, the text must not restate it.** Caught live: `data-types.md` had a nine-row
shape table rendered directly between `SocketLegendRows` (which draws all nine with labeled hover
tips) and `DimensionalityFlow` (which already states the rank rules). Cut.

**`uiCopy.test.ts` machine-checks the decidable part of DESIGN.md §7 + the Captain-Obvious rule**
over help markdown, every catalog label/description, tooltips (literal AND the static segments of
template titles), aria-labels, placeholders and seed-graph prose. Rules were selected by ONE
criterion — **zero false positives on the corpus as written**; anything that would flag legitimate
prose was dropped, not softened to a warning. Each rule pins the real string that motivated it
plus the counterexamples a sloppier version would flag, so neither direction can regress.

**The register rulings** (author, in order of how much they cost to relearn):
- **A control's own action verb is correct copy** — "Cycle Number / Text / Date / Boolean", "Open
  the Problems panel", "Drill in", "Rename". Fixing a `gesture-narration` hit means deleting
  "Click to ", **not** the verb after it. An earlier pass deleted whole clauses and flattened
  eight controls into bare nouns.
- **A plain mouse gesture is never documentation** — obvious to anyone with a mouse. A NON-default
  button (`right-click`) or a modifier (`Shift-drag`, `Ctrl+G`) is an unguessable binding and
  stays. That is why Grid Painter says "(right-click erases to blank)".
- **Node descriptions are third person**, the register Excel's own reference uses. 116 converted;
  17 openers left alone because they are noun phrases ("Sum of squares", "Sample variance (n−1)",
  "Set operations on two lists") that conjugation would wreck.
- **Upstream/downstream suggestions are OUT of node strings.** If a node's expected neighbours
  need surfacing, that is a UI affordance to build, not prose. An input CONTRACT is different and
  survives, reworded: "each row of a 2-column frame (label, value) is one rectangle".
- **Wire-or-type is true of every literal input**, so saying it describes nothing about the node.
- **American spelling**, shipped copy and internal prose alike.

**Genre decides whether a string may instruct at all** — four different answers, so the lint has
three scoping mechanisms (`where`, `GENRE_FREE`, the gesture pattern's button/modifier split):
a **tooltip** must not instruct; a **control label** names its action; **long-form help** may teach
an unguessable binding; a **demo document** (seed graph) exists to be poked at, so "Drag any slider
and the pivots recompute" is the document doing its job. Seed prose is held to `GENRE_FREE` only.

**Traps hit live, all four worth remembering:**
1. A repo-wide prose sweep **rewrites the rule that defines the sweep** — the British-spelling
   regex became `colors?|grays?|centers?`, a rule flagging the CORRECT spellings, and DESIGN.md's
   "color, not colour" became "color, not color". The lint's vocabulary and specimens are the one
   place British spellings must survive.
2. The same sweep rewrote **`Cancelled`, an exported symbol of `rete-engine`**, breaking an
   import. Only `tsc` caught it. A prose sweep over `.ts` will eventually hit a real identifier.
3. `colou?rs?` **matches the American spelling too**. Spell out `colours?`.
4. **`personal-finance.json` is GENERATED** (`scripts/gen-personal-finance-seed.cjs`);
   `pfSeedCheck.test.ts` enforces an exact re-emit. Edit the generator, not the artifact. The
   other 19 seeds are hand-authored.

**Still unenforced, needing a prose sweep first:** §7's em-dash ban (95 uses across help+catalog)
and no-trailing-parenthetical (113). Both are flagged as pending in DESIGN.md rather than left
looking honored. Internal prose (comments, `docs/`) was spelling-normalized — 691 replacements —
not because the lint governs it but because internal copy is in-context whenever new copy is
written, so its habits leak into the output.

**INDEX over a Frame passes the COLUMN's type through** (author: "after all the work that's been
done to harmonize this domain, I'm astounded that that's still not in place"). The 07-25 amendment
that made INDEX adopt stopped at `comboOfType("frame") === null` → placeholder. That reads the
SOCKET, and a frame's family isn't there — it's per COLUMN, and INDEX *names the column*. Fixed
where the fact lives: `PassthroughSpec.project` now takes a `ProjectContext` — `shapeOf(inputKey)`
(the static frame `Shape` on that input) + `wired(inputKey)` — handed to it by the adoption pass
from `makeFrameShapeResolver`, the same walk behind the Cable Inspector's shape row. One resolver
per `reconcileTrueAnyTypes` call, built OUTSIDE the fixpoint loop: a static shape depends on
topology + literals only, nothing the passes mutate, so its memo survives all 32 passes.
INDEX's frame arm mirrors `data()` exactly — blank/0 Column → the whole row, still a `frame`;
Column = c → `comboOfFamily(shape.columns[c-1].type)`. `trueany` survives only where the answer
genuinely is: a WIRED Column (the cable beats the literal in `data()`, and this walk can't know
it), an unknown upstream shape (CSV / Web Source), a `dynamic` shape (a pivot's data-driven
columns SHIFT the ones after them, so a positional index into the known prefix is not
trustworthy), an out-of-range index, or a cube cell (heterogeneous *within* a column).

**Two accents, and the nearest one wins** (author: "the header accent and app accents really
don't mix well"). A node card and a value popup both carry `--node-accent` on their header; the
app accent is the user's theme pick. Wherever they met on one surface — a Save button, a focus
ring, a drop target — the app accent was winning by default and reading as a mistake. Everything
inside an accent-bearing surface now resolves `var(--node-accent, var(--accent))`, which also
means app-level chrome (command palette, Settings, Navigator, the accentless dialogs) needs no
special-casing: no host node, so the fallback already gives it the app accent. Recorded in
DESIGN.md as the **Nearest-Accent Rule**.
The blocker was INK, not hue: `--accent-ink` is computed once from the app accent (appTheme), so
filling a button with a node accent gave it text picked for a different colour — dark ink on
Frame Violet. `popupCardVars` (PopupShell) derives `--node-accent-ink` alongside the accent and
every popup routes through it, so the pair can't drift; a hardcoded `#fff` on the Pivot Done
button went with it. Deliberately left app-accent: the comment badge (a fixed colour is what
makes commented nodes findable — tinting it per node camouflages it against its own card) and
Note markdown links (content, not chrome).

**Visual-only column sort in the value popups** (`columnSort.tsx`, shared by TablePopup and
CubePopup). A view control, not a transform: it reorders rendered rows and touches nothing else,
so Copy / CSV / Save / the node's value are byte-identical and the graph never recomputes — the
real sorts are the Sort / Sort Frame verbs. Click a header chevron to cycle asc → desc → none.
Three things that are load-bearing, not incidental:
- **`sortedOrder` returns SOURCE row indices**, so the body maps `order.map((srcRow) => …)` and
  hands `srcRow` to every edit, draft and row number. That is the whole reason the editable
  frame/matrix grids stay correct under a sort — you type into the row you're looking at. Row
  numbers stay the row's real position (a filtered spreadsheet doesn't renumber either).
- **The sort key comes from the RAW grid, never the rendered text.** A date column displays as
  `20-Mar-2026` but is stored as a serial; sorting the string would order it alphabetically.
- **Reset is keyed on which grid is on screen** (the popup state; a cube's drill level), applied
  during render rather than in an effect — an effect renders the new grid once in the old grid's
  order first. A column index means nothing across two different tables.
A list in Column mode had no header row at all; it now gets one labelled `A`, matching what Row
mode already labels its columns (author offered "list" or "A"). **Row mode has no sort** — it
lays each element out as its own column of a single row, so ordering one column would order one
cell; those headers stay inert (no cursor, no indicator).
**The trigger is the whole header cell, and nothing is drawn until a column is sorted** (author,
same session — the first pass had a resting double-chevron button on every column). So the
chevron is an INDICATOR, not a control: `pointer-events: none`, present only for the sorted
column, in the surface's accent. The cursor is the entire affordance. It stays absolutely
positioned on the header's right edge with a translucent scrim — black in dark theme as
authored, white in light, where a dark chip with a dark glyph is the same collision — and now
reserves NO width at all, so an unsorted grid measures exactly as it did before the feature.
The one thing this shape needs care with: anything interactive INSIDE a sortable header has to
stop propagation or it re-sorts the table as you use it. That's the frame editor's column-name
field and its type toggle (`stopSortTrigger`).
**FRAME headers are the exception, for a mobile reason:** the name field fills the cell, so
there's no dependable margin left to tap on a phone. There the chevron is always drawn — muted
double chevron while unsorted, since it's an affordance not state — and is itself the control,
with the header reserving room for it so a full-width name input can't slide under it. Every
other header keeps the invisible-until-sorted shape.

**Multi-column sort, Excel's add-a-level model** (author). Keys accumulate; priority is the
order they were ADDED, not the order they were touched. Category then Name → Category then
Name; clear Category → just Name; add Category back and it lands at the END, so it's Name then
Category. A column changing DIRECTION keeps its place; only clearing and re-adding moves it.
`nextSort(sort, col)` is the whole rule as a pure step, which is what the tests exercise — the
hook is a `useState` over it, so there's no second copy of the cycle to drift. `sortedOrder`
consults keys in order and the first that separates two rows decides; blanks stay last per key
and, when both rows are blank on a key, the next key gets its turn.
No priority NUMERALS in the headers — Excel doesn't show them either, and the chevron pad has
no room. If a 3+ key sort ever gets confusing in practice that's the first thing to add.

**The other half — a socket type can now be derived from static CONFIG, not just wiring.** That
was a new class of trigger: every derived-type settle hung off a connection event, and a literal
edit fires none. Three literal-commit paths now call `reconcileTypesAfterEdit` (fcReconcile):
`InlineInputs` set/setStr (INDEX's own Row/Column *and* every frame verb's `stringLiterals`
config, which is what the shape walk reads), `useNodeField` (the op/how dropdowns — a Group By
aggregate decides a column's type), and the Frame Input source editor. It runs the settle and
pays the full FC reconcile ONLY when a type actually moved, so the overwhelmingly common
"a literal changed a number" edit costs one pure socket walk.

### SESSION DIGEST (2026-07-25h — the consolidation's parking lot: three real bugs)
The three "found but unsolved" items from the audit. All three turned out to be genuine
bugs, and two of them were filed more mildly than they deserved. Full record archived at
`archive/type-resolution-consolidation.md`.
- **Bug B — frame SHAPE didn't survive a passthrough.** `frameShapeResolver` was the one
  walk that never read the `passthrough()` declaration: `compute()` is an `instanceof`
  chain over the frame VERB classes, so anything else fell to `null`. Confirmed before
  fixing (`Frame Input → X → Sort Frame` for X ∈ {Display, Conduit lane, IF}: the source
  resolved, all three routes lost it, taking every downstream verb with them). It reads the
  declaration now; Conduit lanes are named explicitly since a Conduit declares no spec.
  Deliberately still its OWN walk — it propagates FORWARD from literal sources and resolves
  column names/types ahead of running, so folding it in would be a merge for its own sake.
- **Bug C was filed as "no known bug, but nothing forces them to agree" — it WAS a bug.**
  Sweeping every (base, type) pair showed `adoptTypeForBase` and `projectTypeToBase`
  disagree on CONNECTABLE pairs: a family-less wire was returned verbatim, so a `trueany`
  cable landing on a Concat-Lists row turned that row INTO a `trueany` port, which then
  **accepted a frame or a lambda**. That is exactly what `AdoptiveSocket`'s doc comment
  promises can't happen. Family-less now keeps the BASE; a property test pins that the two
  agree for every legally-connectable type. NOT merged into one function — they still
  differ outside that domain deliberately (an adoptive OUTPUT projects a rank-crossing
  reshape DOWN, which no input connection can ask for).
- **The disagreeing-selector question was the WRONG QUESTION.** A data-aware display is
  unavailable in both directions: reading `selected()` at render re-adds the second
  resolver item 5 deleted, and making ADOPTION data-aware would make a selector's output
  type flip per recompute — so a downstream cable's legality would depend on the data.
  And when branches genuinely disagree there's nothing to recover. **The motivating case
  wasn't a selector at all:** `IFERROR(aDate, NA())` lost its date formatting because
  **NA() declared a `number` output** while emitting a tagged `#N/A` SolError — a
  type-neutral SOURCE voting a type it doesn't have. NA is `trueany` now (non-voting in
  `agreeTypes`, connects anywhere, hollow-ring dot).
  **Rule worth keeping: when a selector's `agree` says unknown, suspect a BRANCH declaring
  a type it doesn't have before suspecting the selector.**
- tsc clean; suite 3173 green. The plan doc is archived as an anti-relapse record.

### SESSION DIGEST (2026-07-25g — the type-resolution consolidation, items 1–5)
Author: *"it seems like our systems have become very convoluted."* A read-only audit
followed, then five work items done individually. The map, target state and remaining
parking lot live in `docs/type-resolution-plan.md` — read that, not this, to continue.
- **The finding, and the reason it was hard to see:** nothing here was a bad line of code.
  FOUR OR FIVE subsystems each independently answered *"what type does this output carry?"*
  and had drifted apart. That drift is invisible from any single `data()`, which is why the
  two bugs that prompted the audit each took a long trace through nodes that were all
  individually correct. **Diagnosis rule worth keeping: when a shape or type looks wrong,
  read `coerceInputs` and the resolvers BEFORE reading any node's `data()`.**
- **1 — the display walk now uses adoption's rule.** `displayedType` hand-rolled its own
  resolution (first non-wildcard incoming connection wins). It ignored `combine`, so an
  `IF` over a date and a number rendered the NUMBER as `20-Mar-2026` — a wrong value on
  screen, verified live. It also couldn't tell a value branch from a side input, so an
  Expect's wired `min` could set the display type of the box showing `in`. `agree` moved to
  `passthrough.ts` as `agreeTypes`: one combine rule, not two.
- **2 — dead exports** (`staticTrueAnyIn`, `anyListOut`, `anyTableOut`), which orphaned the
  `anyListSocket` singleton. The `anylist` TYPE is alive (19 adoptive ports); the shared
  non-adoptive INSTANCE was left behind by the 2026-07-15 migration and was a trap —
  building a port from it silently opts that port out of adoption.
- **3 — the `anycombo` rung** (author approved; the audit had undersold it as a subtraction
  when it is a TRADE — a socket type for a flag). It retired `noWidenInputs`, where a node
  overrode what its own socket said about rank, and `anyOut`, where Regex drew a scalar
  CIRCLE on a port that spills lists. Glyph: a gray split square whose lower half is the
  fill's `-ring` shade, because the gray family distinguishes rungs by SHAPE and a
  [gray, gray] split would have been indistinguishable from `anylist`.
- **4 — one coercion rule.** A `trueany`-based adoptive coerced on its ADOPTED type while
  every other adoptive coerced on its BASE; the comment called it "established pre-existing
  behavior". It made a node's runtime input SHAPE depend on what was wired upstream. Safe
  to remove because the adopted type IS the upstream's, so it was coercing a value to the
  type it already had — identity in every correct case, and a silent laundering of the
  mismatch when a producer's declared type and runtime value disagreed. Removing it also
  fixed another YEAR-class bug: with `datelist` adopted, a scalar into INDEX became
  `[scalar]`, so `INDEX([all])` returned a list of one.
- **5 — the walk is DELETED.** `displayedType` reads the socket; adoption writes it. The
  precondition is machine-checked now (`passthroughOutputMutable.test.ts`): a passthrough
  whose output is a WILDCARD must carry a MutableSocket, or `reconcileOnce` computes the
  type and silently throws it away. The catalog sweep found exactly one concrete
  passthrough output — Fill/Coalesce, numeric throughout, declaring `passthrough()` purely
  for UNITS — so the invariant is "wildcard ⇒ mutable", not "always mutable".
- **Two process lessons.** (a) Deleting redundant machinery is how you find the tests that
  were quietly depending on it: three display tests, one PRE-EXISTING, never ran
  `settleWildcardTypes` and so tested the walk rather than the shipped path — the same
  smell the List Input audit recorded for `wrapNodeData`. (b) The guards earned their keep:
  tsc proved two new `accepts()` branches unreachable, and `formatModel.test.ts`'s
  exhaustive `Record<SocketDataType, …>` FORCED an explicit FC-family decision for the new
  rung instead of letting it default silently.
- Walks 5 → 4; the remaining three resolve different things (route, annotation, column
  shape). Parking lot: Bug B (`frameShapeResolver` never reads `passthrough()`), Bug C (the
  two projection helpers can disagree), and what a DISAGREEING selector should display.
- tsc clean; suite 3163 green.

### SESSION DIGEST (2026-07-25f — a one-element list IS the scalar, at a combo rung)
Reported: `List Input [Date]` with ONE entry, straight into YEAR, emitted a LIST of one
year. Author's reading, which was right: "combo socket mutates single value down into
Scalar — that's what the combo socket is supposed to do; if I didn't want that I'd use the
strict-list socket."
- **The inconsistency was ours, and it predates the combo sweep.** `toScalar` (coerce.ts)
  has ALWAYS collapsed a one-element list for the numeric SCALAR rung — so the COMBO, the
  rung that generalizes the scalar, was the STRICTER of the two. The lattice already
  permits `combo→scalar` on the grounds that "a combo can be a scalar" and sockets.ts
  called that a runtime-accepted risk; nothing made the promise true.
- `collapseSingleton` in coerceInputs now applies at every rung whose declared rank can be
  0: all five combos plus the scalar rungs (`string`/`date`/`complex`/`logical` — `number`
  already had it via `toScalar`). One place, uniform.
- **A strict list socket keeps its list**, which is the whole difference between the rungs,
  and re-widens a scalar on the way in — so the round trip through a collapse is lossless
  (`LENGTH([7])` is 1, `LENGTH(7)` is 1). List Input still SOURCES a list; the collapse is
  a consumer-side reading.
- **The complex trap:** a complex value is itself `[re, im]`, so the test is on the OUTER
  length only — `[[1,2]]` (a one-element complex list) collapses, `[1,2]` (one complex
  number) does not, or a scalar would be torn in half. Same shape test as
  `broadcastComplex`. Pinned by a test.
- Diagnosis note for next time: DatePart, INDEX, TODAY, Conduit, Get Column and XLOOKUP
  were each verified scalar-correct in isolation BEFORE looking at the boundary — the bug
  was never in a node, it was in what the socket does with the value on the way in. When a
  shape looks wrong, check `coerceInputs` before reading any `data()`.
- tsc clean; suite 3151 green.

### SESSION DIGEST (2026-07-25e — the type comes from the SOCKET: INDEX adopts, chips stop sniffing)
Author, on the combo sweep's tail: "every non-scalar value has a forced type already
associated with it, there's no good reason to re-read cells." Two long-standing places
were inferring a container's element family from its CELLS instead of its socket, and one
node was refusing to declare a family it actually knew.
- **INDEX adopts now** (D18 AMENDED). It was static `trueany` on the grounds that its
  result "varies per row" — true for a CUBE cell (may hold a nested frame/cube) and a
  FRAME cell (heterogeneous columns at a runtime index), false for everything else: a
  list/matrix is HOMOGENEOUS, so the socket fixes the family whichever cell you pull. The
  cost was real — a date out of a date list lost its date-ness (`isDateType` reads the
  socket, so it rendered a raw serial) and the output dot stayed a hollow ring while the
  INPUT dot colored. INDEX now declares a `passthrough()` on `list`: it FORWARDS a value
  out of its container, which is exactly what that declaration means, and one declaration
  drives type adoption, unit flow, the display walk and the Conduit trace together.
- **The rank is what varies, not the family** — so the spec grew a `project` hook and
  INDEX maps the container type to its family's COMBO. `datelist` in → `datecombo` out,
  which feeds a `date` scalar input AND a `datelist` input (combo→scalar is a lattice
  edge). A verbatim passthrough would have emitted `datelist` and REFUSED the scalar
  input the extracted cell belongs in. `comboOfType` returns null for frame/cube, where
  the placeholder correctly stands. Declaring INDEX a passthrough did NOT disturb units:
  its manual `tagFrameCellUnit`/`matrixUnitOf` handling and the whole unit/cube/error
  suite stayed green.
- **Chips stopped reading cells.** New `nodeOutputElemFamily(nodeId, outKey?)` resolves
  the declared family through the same passthrough/conduit walk `nodeOutputIsDate` used —
  that predicate is now just this `=== "date"`, so they can't diverge. Fixed by it:
  (1) `ValueDisplay` passed `elem` for dates ONLY, so every other family fell back to
  ArrayChip's cell scan — and that scan skips nulls, so a list with NO valid entry left
  has nothing to vote and returns undefined, which renders as the NUMERIC default. That's
  the reported Bool-List-Input bug: the SegToggle forces socket and values correctly (swept
  typed and wired, it never leaks a number), but the box tinted numeric once the valid
  entries ran out. (2) `cellTypeOf` read the FIRST cell and could only answer
  number|string though TablePopup's CellType has all four — so a boolean list could NEVER
  open as `logical`, and a leading null made a text list open numeric.
- **The same first-cell sniff was duplicated in PinLayer and CableInspector** (picking the
  popup accent) — both had the node id and output key in hand the whole time. Replaced
  with the resolver plus one shared `arrayAccentFor(family, twoD)`; Filter's Dropped and
  Split Frame's Matrix/Headers chips now pass their family too. Every first-cell sniff in
  the components is gone; the cell scan survives ONLY as ArrayChip's fallback for a
  genuine wildcard output, a set INDEX's adoption just shrank.
- tsc clean; suite 3146 green.

### SESSION DIGEST (2026-07-25d — combo sockets swept across ALL FIVE element families)
The combo rung (scalar-or-list, the bicolor split square) has existed for all five element
families since 2026-06-10, but only the NUMBER one was ever applied — `numListIn` appears 104
times while `strComboIn`/`dateComboIn` had zero real node uses and `datecombo` showed up only as
Cast's output. Three passes closed that, one family each; **the sweep is now COMPLETE**, so a
combo rung with no node uses is a bug rather than a gap.
- **Date first** (`3d4b066`): nine nodes (DatePart, WeekInfo, DateDiff, DateAdd, DATEDIF,
  WORKDAY, NETWORKDAYS, DATE, TIME) declare `datecombo`/`numlist` and broadcast. No new machinery
  — a date serial IS a number, so `broadcast()`/`broadcastErr()` applied as-is.
- **Then text**, which needed a broadcaster: `broadcast` is typed to numbers, but a text op's
  operands are MIXED (LEFT takes the text AND a count) and its result is often a different family
  than its input (LEN: string → number, EXACT: string → boolean). New **`broadcastCells`**
  (shared.ts) is the same ragged-zip + per-cell error/missing contract with the element type
  opened up, overloaded by ARITY (1–4) so each call site keeps precise per-operand types. Element
  types are constrained to `string | number | boolean` because the list check is `Array.isArray`
  — **that's exactly why the COMPLEX family can't use it** (a complex value is itself `[re, im]`,
  indistinguishable from a list of them), so complex is the one family still un-swept and will
  need its own broadcaster. `BroadcastResult` is now just `CellResult<number>`.
- Seventeen text nodes broadcast: UPPER-family, LEN, LEFT/MID/RIGHT, FIND/SEARCH, SUBSTITUTE,
  REPLACE, REPT, CHAR/CODE, TEXTAFTER/BEFORE, EXACT, NUMBERVALUE, ENCODEURL/DECODEURL,
  ROMAN/ARABIC, FIXED, DOLLAR, Reverse Text, Spell Number.
- **The criterion both passes used** (now written into node-coverage.md's input-dimensionality
  rule, which contradicted itself on this): is the input an element-wise OPERAND or a MODE? A
  per-element numeric count IS an operand — `LEFT.n`, `MID.start`/`len`, `REPLACE.num_chars`,
  `FIXED.decimals` are combos, because `=LEFT(A1:A10,B1:B10)` is a real Excel formula. A value
  describing ONE operation over the whole input stays scalar: NUMBERVALUE's separators, Text
  Filter's pattern, WEEKDAY's `return_type`, YEARFRAC's `basis`, WORKDAY's `weekend_code`.
- **Deliberately left alone**: CONCAT/TEXTJOIN REDUCE a set to one string (Excel's CONCAT
  FLATTENS an array rather than spilling, so broadcasting would diverge from Excel, not match it);
  TEXTSPLIT and Text Filter are already 1-D → 1-D and broadcasting either needs a rank-2 result
  the lattice has no 1-D→2-D edge for; Regex stays on the wildcard ladder because its element type
  depends on the op (D18 — no untyped combo rung); Text Input/Promo are literal sources.
- **`TextMap` ("UPPER (list)") deleted.** It existed only because Text Transform was scalar-only;
  with a `strcombo` input, wiring a list into UPPER *is* TextMap. Old saves load it as a
  Placeholder. Also dropped from the Timesavers pack's reclassification tags.
- **The pass surfaced a real lattice gap.** Making EXACT broadcast means a `logicalcombo` output,
  and `logicalcombo → number` was BLOCKED while `logical → number` flowed — so the change would
  have broken a cable. Root cause: the combo→scalar exception was bolted onto the within-family
  derivation only, while the `logical↔number` bridge was derived from rank alone. Both now share
  one **`dimFlows(dOut, dIn)`** predicate in sockets.ts, and the machine-checked sweep applies the
  same predicate on both sides so they can't drift apart again. This also un-blocks the
  pre-existing Comparison/IS.TEST `logicalcombo` outputs into numeric inputs. Purely additive —
  no edge was removed.
- One inline-editor edit was load-bearing: `isStr` in `inlineInput.tsx` matched `"string"` only,
  so every retyped text input would have silently lost its typeable field. `isNumber` already
  matched `number || numlist` — the combo case just hadn't come up for text.
- **Complex last, and it needed its OWN broadcaster** (in `complex.ts`, not shared.ts — the
  knowledge is family-specific). A complex value IS an array (`[re, im]`), so the `Array.isArray`
  list-test every other broadcaster uses can't tell a scalar from a list of them. Two mechanisms
  handle it: (1) an EXACT shape test — a scalar `Cx` is a 2-tuple of NUMBERS, so any other array
  is a list, which correctly reads the empty list and a list whose FIRST cell is a null/SolError
  (a "first element is an array" test would have got both wrong); (2) per-operand TAGS
  (`cxOp()`/`numOp()`) at each call site, because one genuine collision survives the shape test —
  a REAL operand's two-element list `[1, 2]` is byte-identical to a scalar complex. IMPOWER is the
  only node that mixes kinds, so it's the only place that could bite, and it's pinned by a test.
  The tags carry the element type too, so `fn`'s parameters infer per position with no casts.
  Deliberately NO `guardFinite`: the complex ops have their own non-finite conventions (IMDIV by
  zero → `[NaN, NaN]`, which formats as "NaN"), and classifying those would change established
  scalar behavior rather than widen it.
- `formatCxValue` gained the list branch, so all five complex value boxes render a broadcast list
  for free — **the list check has to come FIRST there**, since a scalar Cx is itself an array.
  Quadratic Roots' component stopped calling `formatCx` directly and routes through it.
- Six complex nodes: COMPLEX, IM Unpack (its four numeric outputs each broadcast independently
  over the same operand), the 16 IM unary ops, the 4 IM binary ops, IMPOWER, Quadratic Roots
  (a list of quadratics → two parallel root lists; `a = 0` is a per-cell `#DOMAIN!` now).
- The new `complex.test.ts` deliberately includes a `wrapNodeData` case: `coerceInputs` has an
  explicit `complexlist` branch that wraps a lone value, and `complexcombo` must pass through
  UNTOUCHED or a scalar would arrive singleton-wrapped. (Per the List Input lesson — a node test
  that skips `wrapNodeData` isn't testing what ships.)
- tsc clean; suite 3140 green (3117 → +10 text, +13 complex).

### SESSION DIGEST (2026-07-25c — VSTACK/HSTACK passthrough; the List Input audit)
- **List Input was wrong in every SegToggle position, and a sweep is what found it.** Testing all
  four element types against the same inputs (wired list / wired null / wired error / typed text)
  made the pattern obvious in a way that reading one path never would. Four bugs, one root cause
  each:
  - **Two parsers, split by element type.** `list.ts`'s `parseCsvList` (naive `split(",")`) was
    DEAD for three of four types: `coerceInputs` injects `parseListLiteral`'s result for any
    `TYPEABLE_LIST` socket (strlist/datelist/logicallist) *before* `data()` runs, so only Number
    mode ever reached it — `numlist` isn't in that set. So RFC-4180 quoting worked in Text mode
    and not in Number mode, and each mode had its own unparseable-cell policy (Number dropped,
    Date emitted NaN, Logical coerced to FALSE). Now one parser: `parseCsvList` delegates to
    `parseListLiteral`, which grew a `numlist` branch. **`TYPEABLE_LIST` deliberately did NOT
    grow one** — adding `numlist` would make every numeric list input in the app typeable in
    place and force a `stringLiterals` declaration on all of them (machine-checked), a blast
    radius far beyond this node.
  - **Unparseable typed cell → first-class `null` in all four modes.** Dropping shifts every
    position after it (silently re-indexing against a parallel list); NaN is worse than either,
    since it reads as a number and slips past every `isMissing`/`isSolError` guard downstream.
  - **A wired `null` was dropped AND resurrected the row's typed text** (`wired != null` — the
    `??`-swallowing bug `readInput` exists to prevent: a blank flowing in became whatever number
    sat in the box). Now `readInput` semantics: a CONNECTED cable wins even when null.
  - **A per-cell `SolError` was swallowed** — an upstream `#DIV/0!` vanished from the list
    instead of propagating. Both null and SolError now ride through any typed list, per the
    value model.
- **A green test was pinning the dead parser.** `list.test.ts`'s logical case called `data({})`
  directly (no `wrapNodeData`), so it exercised the unreachable path and passed while production
  returned something else entirely (`false` for junk, not "dropped"). Worth remembering as a test
  SMELL: a node test that skips `wrapNodeData` isn't testing what ships. Its intent — the friendly
  `yes/no/y/n/t/f` spellings — was real and is preserved, but as `parseBoolText` local to the
  typed-text parser rather than widened into `coerceLogical`, which would change how every WIRED
  value coerces.
- **The List chip tinted GREEN (text) for a date list.** `ValueDisplay` runs
  `dateFormatDisplay` FIRST, so by the time the chip is built a date list is a list of
  STRINGS — it lands on the `listIsString` branch, and that branch was the one place that
  didn't pass ArrayChip's `elem` override (the numeric branch already did). The chip then
  sniffed the cells and read "text". Fixed by resolving `nodeOutputIsDate` once and passing
  it on both branches. General lesson for value boxes: anything DERIVED from the formatted
  value is sniffing a display artifact — the socket family is the truth, and `elem` exists
  precisely because a date serial is indistinguishable from a number by value.
- **Fifth bug, found by sweeping what can CONNECT rather than what data() does: a wired element
  was FILTERED, not converted.** `isElemKind` kept only `typeof v === <the row's type>` and
  discarded the rest, so the SAME value behaved differently typed vs wired — `01-Jan-2026` typed
  into a Date row parses to a serial, wired in it was thrown away. The sharp edge is the WILDCARD
  ladder: `any`/`anylist`/`trueany` are ACCEPTED by every row socket (correctly — that's what the
  ladder means) but carry whatever value flowed in, so a Display/Conduit/INDEX carrying a number
  wired into a Text row silently emptied the list — no cable rejected, no error, just nothing.
  Fixed by CONVERTING instead (`coerceElem`), which is the right model anyway: List Input is a
  typed literal SOURCE whose job is "emit a list of type T", so a wired element gets the same
  treatment as the typed text beside it. Unconvertible → `null`, consistent with the text policy.
  Note `applyListType` already drops ill-typed input cables when the SegToggle flips, so the
  toggle path was covered — it was the wildcard path that had no guard at all.

### VSTACK/HSTACK join the passthrough set (same session)
- **The backlog's "passthrough annotation opt-in" sub-item was mostly STALE** — Concat Lists,
  Interleave, TOCOL/TOROW and WRAPROWS/WRAPCOLS all already declare `passthrough()` (and are
  covered in `trueAnyAdopt.test.ts`); the doc claim in node-coverage and the backlog outlived the
  code. Reconciled both. The one genuine gap was the 2-D rung of the append ladder: **VSTACK and
  HSTACK** (`StackNodeBase`) had neither a declaration nor an adoptive output, so a strtable
  stacked on a strtable decayed to a neutral `anytable` downstream while its 1-D sibling Concat
  Lists kept the type. Now `agree` over `valueInputKeys()` + `adoptiveTableOut`, the exact Concat
  Lists shape — and because an `anytable` input lifts a wired list to the table rank, a list row
  and a table row agree on the same element family.
- **A passthrough decl alone would have been WRONG here, and the reason generalizes.** Declaring
  passthrough makes coerceInputs keep `UnitCell` tags on the named inputs — correct for a 1-D
  op (per-element list units, D20) but not for the stackers, whose rows accept a LIST that widens
  into a matrix ROW: the tags would ride INTO the matrix, and a matrix carries ONE whole-grid
  Symbol tag, never per-cell `UnitCell`s. So the stackers take WRAPROWS' route instead —
  `unitAware = true` (which wins over the passthrough keep-tags branch, so the two compose) plus
  a `demoteUnitCells` reduction per input: `matrixCellsFromList` → bare as-typed magnitudes + the
  one unit the cells share, re-tagged with `withMatrixUnit`. An already-bare matrix passes
  through untouched, so `sharedMatrixUnit` sees one uniform story and a km LIST stacked on a km
  GRID now agrees instead of silently stripping. The rule for the next rank-crossing node:
  passthrough is about TYPE and format; crossing a unit granularity needs `unitAware` too.
- Pinned in all three registers rather than one: the declaration shape + extensible-row re-read
  (`passthroughSystem.test.ts`), the end-to-end socket adoption incl. the disagree/unwired
  reverts (`trueAnyAdopt.test.ts`), and the unit lift through the real coercion boundary
  (`matrixUnitPolicy.test.ts`, whose `carry-if-uniform` policy previously only exercised
  already-tagged grids).

### SESSION DIGEST (2026-07-25b — zoom-band diagnosis; mobile-only settings; AI palette shell)
- **Choppy zoom band** — the session's main finding, written up as its own OPEN PROBLEM above
  (symptom, three things ruled out, instrumentation, the T1–T8 plan). Not repeated here. Landed
  alongside it: `zoomSettle.ts` (the settle window, previously duplicated in `Canvas.tsx` and
  `HtmlCanvasLayer.tsx`, now one constant with a `window.__zoomSettle` override so it can be
  re-A/B'd on a deployed preview), and `fpsProbe` now tags every sampled frame with the camera
  scale, reporting the worst frame's `k` and the `k` range covered — there was previously no
  console handle for the live transform, which is what T1 needs.
- **Renderer-alternatives question (no code).** If DOM and HIC both became unacceptable: native is
  strictly dominated (~126k LOC of app logic is TypeScript against 3.2k of Rust; it kills the web
  target and still requires the same card port on top). A hand-drawn card toolkit is tractable for
  the ~169/322 components on `nodeKit` and codegen-able off `nodeCatalog.ts`, but its real cost is
  structural, not labour: the design system moves from CSS into imperative draw code, and the
  0.5px/1px fidelity bar has to be met against a DOM reference the author A/Bs it with. The
  deciding question is whether such a renderer would REPLACE the DOM path or sit beside it forever
  — a permanent second implementation of every card is the expensive outcome, and free effort makes
  it worse, not better. Not recorded as a decision; nothing was chosen.
- **`disabledOnMobile` on a settings-schema field** — a three-consumer contract, not a style: the
  Settings row grays with a reason, `buildSettingToggles` drops the "Toggle …" command so the
  palette isn't a back door, and the feature ignores the stored value. Marked on
  `commandPaletteAlwaysOn` (docking wants a bottom strip mobile doesn't have — the palette is
  top-anchored there because the keyboard owns the bottom half) and `minimapPosition` (the minimap
  isn't rendered on mobile at all). `Canvas.tsx` ignores a `commandPaletteAlwaysOn` carried into
  mobile from a desktop session in the same localStorage. `settingsStore.test.ts` pins the marked
  set, so adding the flag elsewhere fails until every consumer is updated.
- **AI command palette — UI SHELL ONLY.** `aiKey.ts` (`AI_PROVIDER` + `aiConnected()`) over the
  existing `apiKeyStore`; a Settings ▸ AI section stores the key. A stored key reveals a sparkle in
  the palette that flips it to an accent-filled prompt box (`--accent` + `--accent-ink`, command
  results suppressed so Enter can't mean two things). Nothing calls a service — submitting is
  deliberately inert with the TODO at the send site, rather than faking a reply. Accent-filling the
  palette is a deliberate, narrow exception to the Quiet Accent Rule (which permits a colored
  surface that communicates STATE): the primary action is rerouted. Flesh-out decisions are
  enumerated in the backlog item, not here.

### SESSION DIGEST (2026-07-25 — cables see through Conduits: inspector + run selection)
A Conduit is wiring, not computation, so a single cable is a SEGMENT of a longer run.
Both cable-legibility surfaces now work on the run instead of the segment.
- **`conduitPath` (`conduitTrace.ts`, unit-tested)** — the run a cable belongs to: climb
  lanes upstream to the real producer, then fan out downstream FROM THAT ORIGIN to every
  real consumer, collecting the segment ids and the Conduits crossed. Walking downstream
  from the *clicked* cable instead of the origin was the trap: a fan-out branch would
  hide its siblings and two segments of one run would resolve differently.
- **Cable inspector** now reports the run's ends — From = origin producer (its value,
  FC annotation and frame shape too, instead of the opaque Conduit lane), one To row per
  terminal input, and a quiet `Via` row naming the Conduits in between. It also accepts a
  whole-run multi-selection (previously any multi-select showed nothing); the ribbon bail
  now only applies to a lone ribbon cable, since a run's ends are resolved.
- **Double-click a cable selects its whole run** — the entire path highlights, and Delete
  takes all of it. Detected from `e.detail >= 2` inside `onClick`, because the canvas
  swallows native `dblclick` in capture phase to kill rete's zoom-on-dblclick, so React
  never sees a synthetic double-click here. Ctrl/Cmd double-click adds the run to the
  selection; a cable with no Conduit either side is its own run and double-click leaves
  the first click's selection alone rather than toggling it off.

### SESSION DIGEST (2026-07-23 — GPU renderer: WICG API re-research + perf/sync build)
Author complaint: html-in-canvas mode feels worse than DOM on mobile. Re-researched the
API itself (primary sources), then built the fixes the drift implies.
- **API status (2026-07):** origin trial Chrome 148–150, Android DevTrial since 138; the
  rename (drawElement→drawElementImage / texElementImage2D, old names dead past M145) is
  final and we're on the new names; **`ElementImage` is spec-final as
  `{width,height,close()}` — NOT an ImageBitmapSource**, so the 2026-07-16
  `createImageBitmap(refImg)` rejection is permanent spec behavior, not build drift; the
  privacy update strips subpixel-AA/system-color content with no opt-out (a fidelity
  floor, not a bug — `live` mode stays the crisp escape hatch); spec paint model: canvas
  children are snapshotted just BEFORE the `paint` event, and drawElementImage outside a
  paint handler draws the PREVIOUS snapshot.
- **Engine perf (htmlCanvasRenderer):** double paint-listener fix (`onpaint` +
  addEventListener registered the same handler twice → two full draws per paint on API
  builds); paint frames re-read the live camera at paint time (`setTransformSource`);
  any frame that must call drawElementImage routes through requestPaint (in-paint =
  current snapshot); the paint handler draws cached mips when possible (was an
  unconditional live re-raster of every visible node); the paint-raster fallback
  shelf-packs each batch into ONE atlas region → ONE canvas read-back per paint instead
  of one per node (the expensive pattern on mobile GPUs), per-node textures cropped
  bitmap→bitmap (`rasterAtlas.ts`, pure + tested).
- **DOM-trails-canvas pan fix (getElementTransform):** the engine now reports the
  PRESENTED camera — from the WICG sync matrix (drawElementImage's return /
  getElementTransform, plausibility-gated against bookkeeping) — and during a gesture
  the layer steers the holder onto that frame, restoring rete's byte-identical
  serialization on settle (`domSync.ts`, pure + tested). Coarse pointers additionally
  get per-element `willChange` promotion for small DOM-only elements (≤1024 CSS px; the
  holder-wide promotion stays disabled there — texture-limit corruption), so conduits
  stop trailing during pans.
- `__hcProbe()` reports getElementTransform's location + identity mapping. Stale
  API-status comments reconciled (htmlCanvasSupport, Settings copy, decisions D6).

### SESSION DIGEST (2026-07-22d — post-1.2 reorient: backlog → 1.3, deferrals.md born)
v1.2.0 tagged and released; docs/planning reoriented around 1.3 (author directive: all
deferred/for-later work collapses into ONE review item; the queue focuses on bugs +
decided-unbuilt work).
- **`docs/deferrals.md` created** — every deferred/parked/author-gated item gathered in
  one reviewable list (author-decision gates, author-present polish, parked bugs,
  only-if-triggered, parked features). `backlog.md` rewritten as the 1.3 queue: bugs &
  verifications, the author's 2026-07-16 punt list (iFrame/embed, Data Feed widening,
  drill-in nav/lasso/group tools, doc-level FC defaults), the decided-unbuilt build
  queue, packs, ONE **Deferral review** item pointing at deferrals.md (same sitting:
  ratify `out-of-scope.md`), and the 1.3 release tail. CLAUDE.md + docs/README.md maps
  updated.
- **Full-docs sweep vs code (subagent-assisted) — reconciled the stale claims:** the
  Reference data-model chapter SHIPPED (`help/data-model.md` covers lattice/wildcards/
  list-is-a-row/unit granularity — backlog item deleted); composite-workbench seed HAS
  scenarios + data-table cards (item deleted); Nest/Unnest shipped (`cube-node-scope.md`
  marked [done], unified-XLOOKUP contradiction fixed); `#OVERFLOW!` shipped + toured
  (value-semantics now says 15 codes); pack-architecture "4 of 5 run modes" → full set;
  format-model per-column-units non-goal dropped (A4 shipped); node-coverage FC "under
  active redesign" dropped; docs/README "1.2 tag pending" cleared.
- **Real gaps promoted into the queue** (found by the sweep, previously un-backlogged):
  extend targeted recompute to topology changes (D8 follow-through); trueany adoption
  absent in drill-in composites; `readInput` sweep beyond scalar.ts; passthrough opt-in
  for Concat/Interleave/TOCOL/WRAP; FC complex-family spec-lag verify; pack-architecture
  prerequisites folded into the distribution item. D10's residual formula-surface
  violation (pre-2010 stats family via Formula.js) noted inside the parity-program item.
- `release-notes-features.md` reset to the 1.3 shell (1.2 list shipped; git history
  keeps it, per the 1.1 precedent). Dev-notes 07-20 digests swept to the archive.

### SESSION DIGEST (2026-07-22c — tablet zoom corruption: holder GPU-layer promotion)
Author report: zooming on the tablet drew GREEN SQUARES / broken raster, in BOTH render
modes. That's Chrome's raster-tile allocation failure — a promoted compositor layer
sized holder-bounds × zoom × dpr exhausts mobile GPU tile memory. Two promotion sites
were keyed on the UI mode (IS_MOBILE) instead of the GPU class, so a tablet (desktop
UI, mobile-class GPU) took the desktop branch:
- **DOM mode** (`Canvas.tsx` `onZoomActivity`): the desktop pinch promotes the WHOLE
  holder (`will-change: transform`) for the gesture — the code's own comment already
  documented that mobile GPUs can't take this. Gate flipped `IS_MOBILE` → `IS_COARSE`;
  touch devices zoom un-layered (a touch choppier, stable).
- **Canvas/GPU mode** (`HtmlCanvasLayer.tsx` `enterGesture`): promoted the holder on
  EVERY gesture with no device gate at all. Now `if (!IS_COARSE)`; the conduit may
  trail a frame mid-gesture on touch — corruption is worse.
Rule of thumb recorded in both comments: promotion decisions key on the DEVICE
(IS_COARSE), interaction decisions on the UI mode (IS_MOBILE).

### SESSION DIGEST (2026-07-22b — tablet mode: dvh viewport + fullscreen on the desktop pill)
Author report from tablet Chrome: desktop UI (correct — tablet UA is non-mobile), but the
bottom chrome (status bar, minimap, navigator) sat below the usable screen, and the zoom
pill lost the mobile view's Fullscreen button. See layout-chrome.md "Tablets" section.
- **`.solenoid-app` → `100dvh` app-wide** (`App.css`, `100vh` fallback): the dvh fix was
  gated on `html.is-mobile`, but a tablet runs the DESKTOP stack in the same toolbar-
  bearing mobile browser — 100vh (layout viewport) overshot the visual viewport by the
  URL-bar height, sinking every bottom-anchored descendant. mobile.css's own override
  removed (redundant now).
- **`vh`+`dvh` pairs on tall overlays** (FR panel, Report window, Settings/Shortcuts/help,
  table/pivot popups, add menu, palette, drill-in controls): dvh ≤ vh always, no-op on
  desktop browsers. Keep the pair for new tall overlays.
- **Fullscreen button gates on `IS_COARSE`, not `IS_MOBILE`** (`NavMenu.tsx`): any
  touch-primary device gets it (no F11 key); mouse desktops keep F11/browser-native.

### SESSION DIGEST (2026-07-22 — Query node: Manual refresh run mode + Composite preset)
Author idea, ratified as D22: the Power Query analogue reuses the Composite + drill-in.
- **`"manual"` run mode** (`nodes/composite.ts`): one `runPass`, but `isHeavyMode()` is
  unconditionally true — the existing arm-and-run hold gives Power Query's refresh model
  for free (upstream ticks → stale dot; the button — relabelled **Refresh** with a
  refresh-cw glyph in this mode — re-runs). `requestSolve(insideOnly)` deliberately drops
  `insideOnly` in manual mode: frame ports have no numeric seeds, so a drill-in Refresh
  always re-runs on the real wired inputs.
- **Query catalog entry** (`nodeCatalog.ts`, paired with Composite; `type: "query"`): the
  same `CompositeNode` pre-seeded — exposed **Table** marker wired to a **Result** marker,
  manual mode. Saves/loads as a plain CompositeNode; no new class, no new persistence.
- **Add paths hydrate now** (Canvas menu `handleMenuSelect`, `addNodeByCatalogType`
  (duck-typed — catalogUtils imports no node classes), drill-in add menu): a pre-seeded
  entry ships a pending internal snapshot, which previously only load/paste/unpack/open
  hydrated. No-op for every other node.
- Tests: manual-hold semantics + insideOnly override + Query preset hydration/round-trip
  in `composite.test.ts` ("manual refresh mode" / "Query catalog preset" describes).

### SESSION DIGEST (2026-07-21 — zoom, Tidy/FC bugs, KaTeX loop, scroll-lag, socket rings)
Targeted UI/UX fixes from an eyeball-driven bug sweep:
- **Zoom pill buttons** (`NavMenu.tsx`): `ZOOM_STEP` 1.08 → 1.4 so a click crosses noticeably more range;
  wheel/pinch stay fine-grained.
- **Tidy widened an FC host every click** (`tidyArrange.ts`): the docked-FC footprint restore captured
  `measuredBox().w` — an `offsetWidth` (border-box, INCLUDES the 1px border) — and re-stamped it via
  `area.resize` as `style.width` on the CONTENT-box `.solenoid-node` card, so each Tidy grew the host (and
  any group autofitting around it) by the border width. Repro: `num → Display + Format Controller`. Fix:
  the pin-drop loop now clears the inline WIDTH too (it only cleared height before), re-applying a
  `nodeSizeStore` manual width where one exists. Regression: `tidyDisplayFcWidth.test.ts` (a content-box
  fake area; fails pre-fix, stable across 3 Tidies after).
- **KaTeX "flashing" render loop** (`formulaFit.ts`): the `useFormulaFit` ResizeObserver recorded the
  PRE-fit box size, but `fit()` changes the box size (fontSize scales the content of a content-driven box),
  so every self-induced reflow read as an external change → infinite refit, box ping-ponging natural↔scaled.
  Only bit with `useHeight` + a content-driven box (the formula field). Fix: compare against the SETTLED
  post-fit size with a 1px tolerance, so only a genuine external resize refits.
- **Scroll-lag on backdrop-filtered overlays** (Settings, then swept): a panel with a full-screen
  `backdrop-filter` + an inner `overflow:auto` scroller re-rasterizes the frosted blur every scroll frame, so
  the controls lag. Fix (same as the Navigator list did long ago): give the scroll container its own
  compositor layer — `transform: translateZ(0); contain: paint`. Applied to `.solenoid-settings__body`,
  `.solenoid-helpdlg__panel`, `.solenoid-shortcuts__panel`, `.table-popup__grid-scroll`, `.conn-dialog__menu`.
  The other backdrop-filter users (TopBar/StatusBar/NavMenu/MobileControls/conduit toolbar/align bar/banner)
  have no inner scroller — left alone.
- **Group Tidy crept the box down/right on repeat clicks — a docked FC's sub-pixel dock** (`fcDocking.ts`):
  the group Tidy button runs the within-group arrange then `autofitGroupBox`, which wraps every member incl. a
  docked FC. `computeDockedCanvasPos` placed the FC via a SCREEN round-trip (getSocketScreenCenter →
  screenToCanvas ÷ zoom), landing it on sub-pixels — it docked a hair right + up, and, being a fractional edge
  that shifts with the host, it made the FC the box's moving extreme edge, so repeat Tidies chased it and the
  group crept. Repro: creep only with a docked FC as the lowest/rightmost edge; undocked, none. Fix: round the
  dock position to whole canvas px — snaps out the visible misalignment and makes the FC a stable edge the box
  can wrap without drift. (An autofit-skips-docked-FCs attempt and a 1px-hysteresis attempt were both rejected:
  the skip let the FC poke outside the box, and the hysteresis was defeated by the arrange step's box-grow.)
- **Socket glyph border contrast made consistent** (`palette.ts` / `appTheme.ts` / `SocketComponent` /
  `SocketLegend`): the ring was a single fixed translucent black (`--socket-ring`), so its visible contrast
  drifted with fill lightness — crisp on the light scalar dots, faint on the dark array/matrix/frame ones.
  New `socketRingShade` (a fixed HSV value-drop, `RING_VALUE_DROP = 0.23` — the tuning knob) computes a
  per-fill `--sock-*-ring`; each glyph points its `--socket-ring` at the ring matching its own fill, so every
  border darkens its fill by the same step. The Cube was drawing its seams with its OWN `color-mix` (why it
  read darker than the rest) — now it uses the shared `--socket-ring` too, so it aligns. The global
  `--socket-ring` stays as the fallback for untyped sockets.

### SESSION DIGEST (2026-07-21 — the big docs/comments cleanup)
Author directive: aggressive prune/rewrite of all supporting docs + code comments so they
reflect what SHIPPED and constrain future work, without fossilized one-time approvals.
- **dev-notes** swept to this shape (open problems + latest window); **backlog** rewritten as a
  terse open-only queue (landed items deleted, duplicates merged, §3a Data-Feed scope inlined).
- **CLAUDE.md rewritten rules-first**: the What's-working/Still-to-build changelogs became a
  capability map + standing constraints; every trap/invariant/alias/UX rule kept.
- **decisions.md**: D14/D16/D17/D18/D20 compressed to ruling+guard+reversal; stale claims fixed
  (calcModeStore tested, date-parser UTC landed, VLOOKUP formula-blocking shipped).
- **Archive triage**: deleted 12 spent docs + all 11 built v2.0 bundles (git history keeps
  them); condensed 12 more to their load-bearing core (scope-features 2028→159 keeping the
  #NN index + #23/#35 sketches); release-plan/1.2-plan/v2.0-05 archived; archive README is
  now the single archive index (architecture.md's doc table lists live docs only).
- **Comment sweep** (src, src-tauri, scripts, help): history narration → current facts;
  relapse-guards kept. Real staleness fixed: SocketComponent + help still described the
  pre-F-glyph Frame socket; help/notes.md claimed units "don't multiply out" (A4 shipped) and
  images "don't survive reload" (desktop bundling shipped). DESIGN.md gained the logical
  purple family + F-glyph/trueany-ring in the socket vocabulary.
- **Notes for later (ambiguities deliberately left):** `inlineInput.tsx` "numeric lists keep
  their single-number field for now" — unconfirmed settled-vs-pending; `nodeHitIndex.ts` stays
  an unwired Phase-2/3 foundation (claim verified true); `out-of-scope.md` still says DRAFT —
  author could ratify; two thin unbuilt ideas from deleted bundles (auto-doc-on-Groups #50,
  engineering-calc/BOM seeds #15/#16) were let lapse into git history rather than backlogged.
- tsc clean, vitest 3057 green before and after.


## Older entries archived

Swept verbatim to [`archive/dev-notes-history.md`](archive/dev-notes-history.md)
(latest sweep: everything through 2026-07-20e, on 2026-07-22). `git log` is the
per-commit record.
