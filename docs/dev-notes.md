# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-05 — free-drawn cables)

**Drawn cables landed** (author-ordered): free-drawn annotation curves, point by point, through
the wired cables' three drawers, with their own shape / ends / width / head size / color and a
per-point 45° angle dial. Spec: `subsystem-invariants.md` § Drawn cables; term: `glossary.md`.

- Two rulings: the dial steps 45° only (a 15° step was proposed and refused); the mobile action
  bar gets NO draw button (one shipped and was removed). Reach is the Cable group toggle,
  Insert → Draw a cable / the palette, and `D`.
- Fixed after review: handle drags panned on touch (RF's d3 pan listens to native events, so
  the grabbable parts carry `nopan`); the stroke ran under the head to the tip (it now stops at
  the base); drawing recorded no undo entry, so Ctrl+Z deleted the cable with no redo (edits go
  through `commitDrawn` → autosave + history); finishing left the tool armed, so the next click
  on the new cable placed a point (it now disarms and selects the cable).
- **Touch resize grips resized one step and stopped** (pre-existing, every card surface):
  RF's `NodeResizeControl` rebinds its d3 drag whenever a callback prop changes identity,
  and `FlowResizeGrip` passed per-render arrows; each resize step re-rendered the card and the
  rebind dropped the touch gesture (a mouse's move listener lives on the window and survived).
  The wrapper now keeps stable callbacks behind a ref. The grip is also in `flowTouchPan`'s
  control list, so an UNSELECTED card's grip resizes on touch as socket.css promises.
- **Popup and text-field grips died a few px into a touch drag** (pre-existing): neither carried
  `touch-action: none`, so the browser reclaimed the finger for scrolling and fired
  `pointercancel`. Both now set it and take pointer capture.
- Open, pre-existing: an undo that lands on the load baseline re-records "Moved 2 nodes" from
  the post-load settle and truncates the redo stack.

### SESSION DIGEST (2026-09-04c — three agents in worktrees; the finance merges land)

Three Opus agents (Han = Lead on `develop`, Chewie and Lando on their own branches in git
worktrees, merged by Han); the author remote, one docs point per turn.

**The 1.4 cut walk (author, one item per turn, from the phone).** Track A: A1 pin, A2 mute, A4
cone brush DEFERRED; A0 badge pass dropped with them; A3 peek PROMOTED as a hover peek (landed);
A6 Optimize run mode IN but LATER (author's go). Track B: B1 trimmed + landed (gallery size
presets, indented List view, `#field` title row, clamp; cover image / hide-empty / grouped lanes
out); B2 both halves PROMOTED + landed (constrained entry; Chip style on the popup column row AND
the FC — enum column type stays 2.0); B3 trimmed + landed (frozen header via the popup menu with
the summary-footer row leaving Settings; record arrow-key nav; lightbox + chip hover out); B4 =
the column picker, landed (card-side format/unit out, λ view-as deferred). Track C: C1 widget
nodes + C2 network permission PROMOTED (C2 landed; Geocode landed; Weather in flight; the four
sub-calls default to the plan's recommendations); C4 embed deferred; C5 landed. Track D: D1
Option A withdrawn on step-0 findings (Option B = the author session); D2 payment breakdown
PROMOTED (in flight), paired-list aggregate still waits; D4 = incremental improvements only, no
big change to the error surface; D7 cube popup controls deferred (the author questions typed cube
columns), mixed-unit trig IN (open); D8 deferred (sockets untouched). **The walk stopped at D9**
(AI palette re-enable) — resume there: D9, D10, D12, D13, Track E (E1, E3), Track F (F1, F2, F4),
Track H, G. Every ruling is in the `1.4-plan.md` table's Call column; promoted items are backlog
lines; deferred ones sit in `deferrals.md`.

**Geocode / Weather could not be wired to each other (socketRows, fixed 2026-09-04).** Both
widget cards rendered a bare `NodeShell`, which lays out OUTPUT dots only and gives an unrowed
socket no `top` — so Geocode's `lat`/`lon`/`timezone`/`label` stacked on one pixel and Weather's
declared `lat`/`lon` inputs drew no dot at all. Both now follow the widget pattern the Astro
cards set: `hideOutputSockets` + `InlineInputs` for the wireable inputs (Geocode's Place is a
string socket row, Weather's Lat/Lon are number rows with their typed fallbacks) +
`InlineOutputRows` for the labelled outputs, with `daily` on its own `MeasuredSocketRow` showing
its day count. `WeatherNode.cached` is public so the Now rows can read it; Geocode takes the wide
card (`--geocode`, matching Weather) because an IANA zone and a full match label overrun 180px.
New rule socketRows + `socketRowCoverage.test.ts` closes the completeness half — it walks the
catalog, pairs each class to its component through `nodeRegistry`, and fails any side carrying
2+ sockets with no measured row. **Author eyeball:** add both, type a place, drag Geocode's Lat
and Lon into Weather's — the Now/Condition/Daily rows fill.

**The three finance merges, released by the author's Set-card verdict.** Discount Security
(TBILLEQ/TBILLPRICE/TBILLYIELD, DISC/PRICEDISC/YIELDDISC/INTRATE/RECEIVED, PRICEMAT/YIELDMAT),
Accrued Interest (ACCRINT / ACCRINTM as a Periodic / At-maturity toggle, the Irr precedent) and
Bond Pricing (PRICE/YIELD + the four ODD* ops). Each card's sockets follow a per-op key table
after the shared settlement/maturity pair; the switch prunes departing cables first
(onePrunePath), keeps shared inputs' cables and literals, and reorders sockets per the new
op. One mechanism for all three: `keysDroppedBy` + `reshapeInputs` (`finance.ts` § Spec-table
op cards) and `makeSpecOpComponent` (`components/specOpNode.tsx`). Side effects: PriceDisc and
BondPrice no longer show a dead price socket beside their yield; the odd-coupon date is two
sockets (`firstcoupon` / `lastinterest`) because they are different facts; the T-bill and
ACCRINT math moved to `financeOps` as kernels (`tbill`, `accrint`). Ten + two + six catalog
leaves collapsed to three, each carrying its Excel equivalents in `nodeExcel`; old saves of the
merged types load as Placeholders (noBackCompat). **Author eyeball:** Finance > Other has
Discount Security + Accrued Interest, Finance > Bonds has Bond Pricing; switch ops and watch
the sockets reshape with the shared ones keeping their cables.

**The FC `—` inherit pick (Lando, landed 7f904f54 + 11950fe0).** Every family's primary style
dropdown gets a leading `—` ("Inherit the upstream format"): the FC carries the upstream display
cluster through and authors its unit alone, so a 2nd FC docked only for a unit no longer resets
the style to Auto. `inheritFormat` flag + `FormatControllerNode.resolveAnnotation`, which
`makeAnnotationResolver` calls in place of `annotation()`. Enforced in `unitFlowAnnotation.test.ts`;
spec in rules.md formatFlowsDownstream + format-model.md. **Author eyeball:** dock two FCs, set
the 2nd's style to `—` + a unit → upstream style survives, muted `← Decimal · 3 places` hint shows.

**F5 — memory heap-snapshot investigation (Lando; `scripts/heap-probe.mjs`, CDP on a worktree dev
server).** Finding: **no product memory leak; the "high memory for a light app" is mostly a
DEV-build artifact.** The light seed's real footprint is ~20MB.

| getting-started | JS heap | DOM nodes | listeners |
|---|---|---|---|
| dev (`vite`, :5199) | 49.1 MB | 2733 | 1932 |
| prod (`vite build` + preview) | **20.1 MB** | 2575 | 1918 |

Same DOM/listeners; the ~29 MB dev gap is unminified source + per-module `code` objects + React
19 dev perf-track marks. Other findings:
- **No teardown/rebuild leak.** 5× full reload (Ctrl+Shift+L) of chart-showcase: heap 67.6→68.3 MB,
  DOM flat 5315, listeners flat 8095, snapshot detached-DOM = **0 MB**. Node clones / HIC atlas /
  React Flow internals all release on teardown.
- **Per-doc tabs are bounded**, not a leak. Seeding a doc 5× (5 library tabs): +1.3 MB total
  (~0.25 MB/tab = the serialized `SavedGraph` JSON), DOM/listeners flat — only the current doc
  renders; background docs keep no DOM/listeners resident.
- **Where the bytes are** (chart-showcase snapshot, ~140 MB incl. shared): `ExternalStringData`
  66 + `string` 26 + `code` 18 = ~110 MB (78%) is the dev bundle's source/code; `FiberNode` 1.9,
  `Object` 4.1, arrays 7 are the modest runtime. `PerformanceMeasure` grew 3.3→5.7 MB across
  reloads = React/Vite dev perf-track entries (no `performance.measure` in src), dev-only.
- **DOM at scale** is frame/table cards, not node count: personal-finance is 14.5k DOM at 82 MB.
  The `onlyRenderVisibleElements` virtualization lever stays the 2.0 canvas-at-scale item; the
  table/cube popup already caps at 1000 rows.

Proposal for the author (no code changed): the app is memory-clean — measure prod, not dev, if a
real number is wanted. Nothing here is a contained fix; F5's output is this finding.

**E2 — compositeToolbarReroute audit + close (Lando).** Walked every top-toolbar / menu-bar /
mobile-bar / keyboard verb with a drill-in open. Already correct via the seam: keyboard (the
drill-in installs its own instance over its refs, MAIN stands down), undo/redo (per-surface
history), Tidy/Cleanup and select/unselect/Ctrl+A (`swapArrangeSlots` / `swapSelectionSlots`
already swap them), add-node placement + copy/paste + isolate (`getActiveEditor/View`), Navigator
+ Minimap + fit/zoom (`getActiveView`), the Delete KEY (RF per-surface `onBeforeDelete`). The ONE
genuine gap: the keyboard-less **delete button** (mobile / tablet `MobileControls` /
`TabletActions` → `canvasCommands.deleteSelected()`) went to MAIN because the drill-in swapped
selection + arrange but not delete. Fixed by adding `swapDeleteSlot` and having the drill-in swap
`deleteSelected` → its own level (restored on unmount) — the existing pattern, not a rebuild.
Pinned by `canvasCommandsSwap.test.ts`. Known limitation logged (backlog § Composites): docked FCs
inside a drill-in don't recenter (`repositionDockedTo` is a no-op) — component reflow, out of E2's
verb scope. `compositeToolbarReroute` flagship closed (2.0-plan) + its decisions pointer; E2 marked
done in the 1.4 table.

**Author ruling (2026-09-04c) on the FC `—` pick with nothing upstream:** it falls back to the FC's own
style, and that is correct — the FC's DEFAULT is Auto (a real pick), the frame column row's default
is blank (inherit); the two defaults work together. Not a bug; don't reopen.

**B1 (trimmed) — Record gallery size preset + List view (Lando).** Two lifts on the one Record
node (`nodes/visual.ts` + `chartCards.tsx`): (a) a `cardsize=s|m|l` OPTIONS key (default m) read
in `data()` and carried on `RecordPayload.size`, scaling the gallery track band only (S 130/110/190
· M 170/140/260 · L 230/190/340); card/board/list ignore it. (b) a fourth `RecordOp` "list" — one
indented outline block per record, the title field on its own line and the trailing fields as
"label: value" rows beneath, drawn text-only with per-line ellipsis. WHICH field is the title lives
behind ONE seam, `titleIndexFor(fields)` in `chartValue.ts` (today the first field; the per-card
`#field` title-row marker plugs in there and every view follows). List reuses the gallery row build
(cap `RECORD_CARD_CAP`, no row/by socket). Catalog description + `cardsize` socketDoc updated. Pinned
by `recordViews.test.ts`. Then title row + wrap/clamp (author promoted both back IN 2026-09-04c):
a `#name` layout marker (one parser change in `parseRecordLayout`) flags a field `isTitle`, drawn
big + label-less in every view; `titleIndexFor` reads the flag and still falls back to field[0].
A `clamp=on` option line-clamps long gallery-tile values to 3 lines (the popup shows the whole
card). Pinned by `recordViews.test.ts`. Still OUT of the trim: cover image, hide-empty, grouped
gallery / lane summaries. Follow-through (Done line): the record-cards seed gained four exhibits
(List view, a `#`-marked title, `cardsize=s`, `clamp=on`), each a group with its Note inside off
the shared Parts frame (a new long Notes column feeds the clamp exhibit), re-baked with
`tune-seeds.mjs` (given a `URL`/`CHROME` env so a worktree tunes its own edited seeds against its
own dev server); catalog description + `#`/`cardsize`/`clamp` socketDocs carry the four lifts.

**B2.1 — constrained entry (Lando).** Editing a TEXT cell in the table popup (grid or Form view)
now offers the column's distinct existing values as a `<datalist>`; anything new still types.
The list is a pure helper `distinctColumnValues(cells, isExcluded?)` in `frameVerbs.ts` (first-seen
order, blanks + error codes excluded), fed from the grid text and gated to `string` columns only
(logical/date/number keep their own entry). No new commit path — a datalist pick populates the
same `<input>`, so it commits on Enter/blur exactly like a keystroke; no `FormatAnnotation` field.
Pinned by `constrainedEntry.test.ts` (the distinct list; a suggestion coerces identically to a
typed value). Renders one `<datalist>` per text column in the active view's scroll container.

**B3 — table popup polish (Lando, two commits).** (1) The always-on sticky header + row-number
first column became a toggle: `settingsStore.tablePopupFrozen` (default on, persisted, NOT in the
Settings panel), flipped from `PopupOverflowMenu` beside the summary-footer item; an `--unfrozen`
class reverts the sticky cells to static. Same commit removed the "Table popup summary footer"
row from the Settings panel — popup chrome is set in the popup (the author's rule). (2) A Record
CARD popup now pages with ←/→ (the on-screen prev/next by keyboard): `ChartPopup` binds the arrows
to the existing `stepRecordRow`/`recordNavTarget` (recordNav.ts, same path the Display pager uses),
swapping the fresh chart into the popup snapshot without closing; `canvasKeyboard` already stands
down under the `.sol-popup-overlay` (modalGuard), so the arrows reach only the popup. Pinned by
`recordNav.test.ts` (the pager gate: card + >1 row + unwired Row, else none).

**C2 — per-document network permission (Lando).** A FOREIGN document (opened / imported) fetches
nothing until the user allows it — the sinkRunButtonOnly mirror. Model: `importAsDocument` stamps
`meta.foreign` at adoption; the grant is `meta.networkAllowed`, both persisted in the sidecar and
held per-open-doc by `docMetaStore`. Own docs (template/blank/saveAs) carry no `foreign` → never
gated. Gate: `connectionStore.networkAllowed()` = own || `settingsStore.alwaysAllowNetwork` || the
per-doc grant; the connection fetch triggers (`WebSourceNode.data`, the import `fetchParsed`) call
`requestNetwork(id)` BEFORE `fetchText` — blocked → status `"gated"`, zero network. The first gated
recompute pushes ONE sticky notice ("connects to N services. Allow?") with an **Allow** action
(`noticeStore` gained an optional `NoticeAction`); after dismissal the way back is the connection
card's hollow "Waiting for permission" dot and Settings ▸ Data ("Network for this document" + Allow,
plus the global "Always allow network"). Allow → `docMetaStore.setNetworkAllowed(true)` (persists) +
`refreshAllConnections`. LocalFile (disk) is not network → not gated. Pinned by
`connectionStore.test.ts` (own never gated, foreign gated until allowed, always-allow bypass).

**C1 widget nodes — Geocode (Lando, first of the bundle).** Place name → lat / lon / IANA timezone /
label, via Open-Meteo geocoding (keyless, CORS-open). Reuses the WebSource fetch pattern verbatim
(sync data() + one background fetch per place through connectionStore, so it rides the C2 gate for
free) — `geocodeProvider.ts` is the pure, fixture-tested parse. Ambiguity is a per-node pick stored
by the match's LABEL (indexes swap cities when the API reorders on refresh), default = top match.
Files: provider + `GeocodeNode` (connection.ts) + `GeocodeComponent` (ConnectionNodes) + catalog
(Connections) + registry; `pickedLabel` serialized, `matches` transient. Pinned by
`geocodeProvider.test.ts`. Next: Weather (consumes it; brings the garden-watering seed), then
Holidays, TZ/QR, FX last (FX recorded IN for the bundle per Han).

**D1 — formula-surface allowlist: Option A DROPPED on step-0 findings (Chewie).** Option A
(one guard before `broadcastCall`: an undeclared FX name refuses ARRAY args) was greenlit on
the proposal's premise that only "a handful" of undeclared names broadcast fine. Step 0
refutes it. Method: enumerate `FX_FUNCTION_NAMES` minus (declared `EXCEL_IMPL_META` ∪ internal ∪
legacy-alias ∪ frame-verb ∪ node-verb ∪ eliminated ∪ non-resolving), then classify each
survivor by evaluating `NAME(x)` with `x=[1,2,3]` through `compileEvaluator`. Of **174**
undeclared names: **127 broadcast a CLEAN element-wise array today** — the guard would refuse
every one (`COS({1,2,3})` → SolError instead of three cosines), a large regression of correct
behaviour, not a handful. 33 are `RANGE_FUNCTIONS` (SUM etc.) that never reach the guard. Only
14 error on the one-arg probe, and that set is arity-contaminated (multi-arg fns flagged only
because the probe passed a single arg). The genuinely broadcast-WRONG set can't be separated
mechanically — arity confounds any uniform probe — and that separation IS the Option B
per-name audit. **Author's call (via Han, 2026-09-04c): Option A does NOT ship; Option B (D1b)
is the path, author-present.** No code landed; the proposal keeps its top note pointing here.

- **IMPROVE (the Option B starting set — 14, VERIFY each before declaring):** ACOTH, CLEAN,
  CODE, CONFIDENCE.NORM, CONFIDENCE.T, ERROR.TYPE, IPMT, ISPMT, NPER, PDURATION, PEARSON, PMT,
  PPMT, UNICODE. Caveat: these merely errored on a ONE-arg list probe. PMT/IPMT/PPMT/NPER/
  PDURATION/ISPMT are multi-arg financials that almost certainly broadcast fine with real args
  (probe artifact, not a real hole); CLEAN/CODE/UNICODE/CONFIDENCE.*/PEARSON/ERROR.TYPE/ACOTH
  are the names actually worth an author look. So the real hole is a handful — but a DIFFERENT
  handful than the surface count implied, and only the audit tells which.
- **REGRESS (127 — broadcast correctly today, Option A would wrongly refuse):** ACCRINT, ACOT,
  ARABIC, ASINH, ATAN, BASE, BESSELI, BESSELJ, BESSELK, BESSELY, BIN2DEC, BIN2HEX, BIN2OCT,
  BINOM.DIST.RANGE, BITAND, BITLSHIFT, BITOR, BITRSHIFT, BITXOR, CEILING, CEILING.MATH, CHAR,
  COMBIN, COMBINA, COS, COSH, COT, COTH, COUPDAYS, CSC, CSCH, CUMIPMT, CUMPRINC, DB, DDB,
  DEC2BIN, DEC2HEX, DEC2OCT, DECIMAL, DEGREES, DELTA, DISC, DOLLARDE, DOLLARFR, EFFECT, ERF,
  ERFC, EVEN, EXP, FACT, FACTDOUBLE, FALSE, FIXED, FLOOR, FLOOR.MATH, FV, FVSCHEDULE, GAMMA,
  GAMMALN, GAMMALN.PRECISE, GAUSS, GCD, GESTEP, HEX2BIN, HEX2DEC, HEX2OCT, IFERROR, IFNA, IFS,
  INT, ISBLANK, ISERR, ISERROR, ISEVEN, ISLOGICAL, ISNA, ISNONTEXT, ISNUMBER, ISODD, ISTEXT,
  LCM, LOG, MROUND, MULTINOMIAL, N, NA, NOMINAL, NOT, OCT2BIN, OCT2DEC, OCT2HEX, ODD,
  PERCENTRANK.EXC, PERCENTRANK.INC, PERMUT, PERMUTATIONA, PHI, PI, POWER, PRICEDISC, PV,
  RADIANS, RAND, RANDBETWEEN, RATE, ROMAN, ROUNDDOWN, ROUNDUP, RRI, SEC, SECH, SIGN, SIN, SINH,
  SLN, SWITCH, SYD, T, TAN, TANH, TBILLEQ, TBILLPRICE, TBILLYIELD, TRUE, TRUNC, TYPE, UNICHAR.
  (IFERROR/IFNA/IFS/SWITCH/NA/TRUE/FALSE/IS* land here as probe quirks — control/predicate
  names, not broadcast math; they too resolve their own way. The audit sorts them.)
- **RANGE_FUNCTIONS (33 — never reach the guard, handled at the range gate; for completeness):**
  AND, AVERAGEIF, AVERAGEIFS, CHISQ.TEST, COUNT, COUNTA, COUNTBLANK, COUNTIF, COUNTIFS, MAX,
  MAXA, MAXIFS, MIN, MINA, MINIFS, NPV, OR, PRODUCT, SERIESSUM, STDEVA, STDEVPA, SUM, SUMIFS,
  SUMPRODUCT, SUMSQ, SUMX2MY2, SUMX2PY2, SUMXMY2, VARA, VARPA, XNPV, XOR, Z.TEST.
