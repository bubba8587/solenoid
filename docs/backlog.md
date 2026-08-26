# Solenoid — Backlog (1.3)

**OPEN items only, kept terse.** When an item lands, DELETE its line — git history and
the dev-notes digests are the record. **The 1.3 pivot (author, 2026-08-07):** the app
ships as 1.3 basically as-is; this queue is bugs, small patches, and thorough
small-scope polish sweeps ONLY. Everything feature-shaped moved to `deferrals.md`
"Pushed to 1.4/2.0". Ruled-out ideas: `out-of-scope.md`; settled rationale:
`decisions.md`.

---

## Execution queue (2026-08-23, ordered — author opened the scope past 1.3 polish)

Author direction 2026-08-23: plan and run the next tranche autonomously; NOTHING that
needs the author watching browser devtools / a device (those items stay below, untouched).
Promoted from `deferrals.md` where an entry was engine/logic work that was never really
parked. Each item: build, pin with tests, one digest line, delete the line here.

**B — engine features promoted from deferrals (autonomous-friendly, node+formula+tests)**
- [ ] **Lazy handles, tail** — Slicer goes lazy: DONE (A2, 7c34d874). Remaining (A1's, then delete `docs/plans/lazy-handle-on-cable`): out-of-scope separate calls — Rust store as `LazyFrame` plans (makes an intermediate flush free; breaks the eager-independent-frames drop rule), `WireOp::pivot`.

**C — hygiene**: deferral review.

## Polish sweeps (the 1.3 working mode — thorough, small-scope, one seam at a time)

- **Per-card CSS conversion (DOM count is the constrained resource; author 2026-08-25, "for later").**
  **Step 1 census DONE (A2, 2026-08-25 — `scripts/card-css-census.mjs` + `window.__solenoidCardCensus`;
  see the dev-notes FINDING).** 687 card types, 59% paint-only, but most of that is structural
  (io-rows, card skeleton) or the deliberate CardFrame SVG (must stay SVG). The one high-leverage
  step-2 target is the **socket-dot ring (2,221 elements)**; smaller clean wins are the corner
  badge/lock and the section divider. Step 2 (author's "for later"), paint-only → pseudo-elements /
  backgrounds / masks; paint-only STATE → custom properties + `:has()` / container queries instead of
  className branching. Sockets may be CSS-positioned too (CLAUDE.md, verified: only a `transform`
  inside `__content` misreports an endpoint). Charts/popups won't move (recharts + `<input>` grids).
- [ ] **Architecture map v2 — WAIT FOR THE AUTHOR'S SPEC.** The old map (Subsystem
  cards + import cables, generator chain, coverage guards) is deleted. The author
  will describe the replacement precisely; build nothing toward it until then.

- [ ] **Finance absolute-value verification (real Excel needed).** The bond/coupon
  family has NO oracle — Formula.js implements almost none of it. `financeInvariants.test.ts`
  now pins the round-trips/identities (PRICE↔YIELD, PRICEMAT↔YIELDMAT, ODD* pairs,
  COUP* day-count, DURATION/MDURATION, VDB total/additivity), which catch structural
  bugs but NOT a consistently-wrong absolute value. Want golden real-Excel values for:
  COUP*, ODDF/ODDL, ACCRINT/ACCRINTM, VDB. Already confirmed absolute: PRICE/YIELD
  + DURATION (Microsoft examples), TBILLYIELD/TBILLEQ + PRICEMAT (real Excel). Worth
  one real-Excel check: Microsoft's MDURATION example (1-Jan-2008 → 1-Jan-2016, 8%,
  9%, semiannual, basis 1) publishes 5.7355689 where we and a hand-worked textbook
  Macaulay both give 5.7356698 — and our DURATION matches Microsoft's own DURATION
  example to 8 digits, so the doc value looks like a typo.

## Bugs & verifications

- [ ] **Editing a node header blacks out the app (tablet)** — author-reported
  2026-08-01, NOT REPRODUCED (headless coarse-pointer sweep over 107+ headers,
  5 seeds, clean). The app now has error boundaries (app + per node) — next
  occurrence prints a copyable message; get that text and this is a 5-minute fix.
- [ ] **#7 Conduits sometimes unselectable/unmovable except via the Navigator** —
  intermittent, no repro; suspected z-order/hit-area or group-membership sync.
- [ ] **AI palette verification tail** — first real-key end-to-end (`ANTHROPIC_API_KEY=…
  npm run ai-prompt`), palette on the preview (author eyeball), Tidy on an all-at-0,0
  generated graph, one desktop CSP smoke test. (Known + accepted: Apply drops undo
  history — autosave keeps the pre-apply doc.)
- [ ] **OUTSIDE REVIEW WANTED: number→text semantics of the text predicates** —
  author defers to a reviewer. Today: text predicates on number/date columns compare
  the JS display string (oracle `String(cell)`; engine mirrors via hand-written
  `js_number_string` — the own-it-forever liability under review). Alternatives:
  (a) status quo; (b) `#TYPE!` + require Cast (most lattice-consistent, deletes the
  Rust formatter); (c) app-format strings (rejected-by-default). Verdict lands as a
  VAL rule + corpus cases.

## Node-combining parked (round 1 LANDED 2026-08-09, nodeCombiningRound1 — review these with the author)

- **Paired-list aggregate** (SUMPRODUCT + SUMX2MY2/SUMX2PY2/SUMXMY2 + CORREL +
  COVARIANCE.P/.S + WAVG/WSTDEV/WVAR — 4 classes, 10 ops, all two parallel
  lists → number; the two-list Aggregate) — author: wait.
- **Payment breakdown 2×2** (IPMT/PPMT + CUMIPMT/CUMPRINC: op Interest/Principal ×
  window one-period/period-range; CUMIPMT over [k,k] = IPMT) — author unfamiliar
  with the family; explain before deciding.
- **Smaller pairs**: Set + Set relation → ONE SetNode, DONE (A2, 8d77cf7f, output socket
  swaps list↔logical per op). Remaining:
  discount securities (TBill 3 + SecurityDisc 3 + PriceDisc 2 + PriceMat 2, all
  settlement/maturity/basis-shaped, A2 next); BondPrice + OddCoupon (odd variants = extra
  date params per op); ACCRINT + ACCRINTM.

## Small builds & calls (still 1.3-sized)

- [ ] **Virtualize the table/cube popups instead of truncating at 1,000 rows**
  (author-raised 2026-08-22, pointing at `react-window`). `TablePopup.tsx` and
  `CubePopup.tsx` both hard-cap at `MAX_VISIBLE_ROWS = 1000` and label it "· first
  1,000"; every cell renders a controlled `<input>` (read-only ones included), so the
  cap is really a DOM-node budget. **The open question is not the library, it's whether
  the popup stays an HTML `<table>` or becomes a real data grid** — that choice picks
  the tool, so answer it first. Decider: does anyone actually hit 1,000 rows in
  practice? and the author's read on how big real frames get.

  **Measured 2026-08-24** (`scripts/table-popup-probe.mjs`, 1000-row cap × 3/10/30 cols,
  Edge): every cell was an `<input>` (read-only ones included) and the `<input>` is ~2.5×
  the DOM cost of plain text. Wide frames are the cost — 30-col open ~260 ms, keystroke
  (full re-render, cells un-memoized) ~290 ms; 10-col ~90/~98 ms; 3-col fine (~34 ms).
  **The read-only-cell win already LANDED** (see the dev-notes FINDING): read-only + computed
  cells now render plain-text `<div>`s, ~50% off every read-only popup (30-col open 260→132 ms).
  What's left for THIS item is virtualization for wide EDITABLE frames — Path A vs Path B,
  still the author's call.

  - **Path A — keep the `<table>`, window it ourselves (~60 lines, no dependency).**
    Render only the visible slice of `<tr>`s, preserve scroll height with one spacer
    `<tr>` above and one below. Sticky `<thead>`, sticky row-number `<th>` and native
    auto-sizing all keep working because the table formatting context is intact. The
    usual blocker — widths jittering as rows scroll in and out — is half-solved:
    `colMinWidths` already measures every NON-text column from the whole dataset
    (`<input>` cells have no intrinsic width), so only text columns auto-size from
    visible content and that same pass extends to them. (Dropping the `<input>` on
    read-only cells — the cheap half — already landed 2026-08-24.)
  - **Path B — rebuild the grid as divs and use `react-window` as its engine**
    (v2.3.0, MIT, zero deps, React 19 peer). Buys what a `<table>` cannot: horizontal
    virtualization for wide frames, resizable/reorderable columns, frozen columns, no
    row cap at all. Costs a rewrite of the ~240-line grid render plus a sticky-chrome
    layer — react-window does windowing ONLY, so the header and row-number column are
    rendered outside the virtualized area with scroll synced off `onScroll` (header
    scroll-sync jitter is the standard bug here), and all column sizing becomes ours.
    Editing needs care: controlled `<input>`s unmount mid-edit when scrolled, and props
    identity churn re-renders every cell (upstream names the prop `cellPropsUnstable`).

  **Settled, so nobody retreads it: react-window cannot wrap the EXISTING `<table>`.**
  Read the 2.3.0 dist — `Grid` builds each row as a hardcoded `se("div", {role:"row"})`
  (`tagName` reaches only the outer element), both `Grid` and `List` hand children
  `position:"absolute"` + `transform`, and `List`'s total-height spacer is a hardcoded
  `<div>`. Any of the three alone ends the table's column model. Path B is a rewrite,
  not an adoption.

  Either path: sort order, an open edit scrolling out of view, Copy CSV / Export
  (must stay whole-dataset, never the visible slice) and the form view's record pager
  all need checking.

- [ ] **AUTHOR CALL — mode-selector inputs on a wired blank**: `text.ts` / `date.ts`
  selector inputs fall back to the literal on a wired blank, diverging from
  value-semantics' "mode selector propagates" row. Decide; reconcile table or code.
- [ ] **Formula surface is open-by-default (the systemic follow-up).** The 2-D dead-name
  set is resolved (COLUMNS/ROWS + HSTACK/VSTACK/CHOOSECOLS/CHOOSEROWS owned sharing their
  node kernels; the D* family eliminated like VLOOKUP). What remains is the ROOT cause: the
  formula surface is defined by SUBTRACTION from Formula.js's full export (~445 names
  advertised via `FX_FUNCTION_NAMES`, 377 with declared meta), so any undeclared FX name
  that takes an array still broadcasts into a #VALUE! array or throws — correctness is a
  treadmill of discovering breakage. The fix: an FX-backed name reaching the matrix gate
  with an array arg and no declared handling should short-circuit to a clean SolError, never
  broadcast/throw; longer term, flip the surface to an allowlist (a name exists iff declared)
  and delete the fallthrough. Larger than 1.3 polish — raise with the author before starting.

### XMATCH / XLOOKUP are narrower than they advertise (2026-08-11 analysis)

Excel's `lookup_array` is 1-D but ORIENTATION-FREE — a single row or a single
column; a true grid is `#VALUE!`. Ours takes a vertical list only, and the
advertised surface says otherwise: the hint reads exactly like Excel's signature
and `nodeExcel.ts`'s note lists only the mode limits. Three separable defects:

- [x] **Orientation — LANDED 2026-08-23 (A4).** `XLOOKUP` / `XMATCH` declare `matrixArgs`
  and guard each slot themselves: a 1×N or N×1 matrix lookup/return array flattens (Excel's
  orientation-free 1-D), a grid is `#VALUE!`, a length mismatch between the two arrays is
  `#VALUE!`, and a MATRIX lookup value stays a loud `#SHAPE!` — the regressions the blunt
  2026-08-21 `matrixArgs` flip caused are each pinned in `excelFunctions.test.ts`.
- [x] **An ARRAY `lookup_value` SPILLS — DONE (2026-08-23, author-approved).** Excel returns
  one result per element. Both the `XLOOKUP`/`XMATCH` FORMULA registrations (`pick`,
  `excelFunctions.ts`) AND the **XMATCH NODE** now spill a LIST needle to a rank-1 result list —
  the node shares the same `xmatchIndex` kernel, so its sockets were swapped to match: `value`
  `any`→`anycombo`, output `number`→`numlist` (the `combo→scalar` lattice exception keeps existing
  downstream scalar wires legal; INDEX/`ListIndexNode` is the precedent). Pinned in
  `excelFunctions.test.ts` "SPILLS" and `errorValue.test.ts` "XMATCH node SPILLS". Replaced the
  day's interim loud `#VALUE!`, which replaced the original quiet `#N/A` lie. **The XLOOKUP NODE
  spills too** (author-asked, 2026-08-23): its `lookup` socket `string`→`strcombo`, and `data()`
  maps a matched cell over a LIST of lookup values (`matchOne`) — one match each, `#N/A`/if-not-found
  per element. Its frame+column-names SHAPE stays (the recorded "Build Frame first" decision); only
  the lookup-value axis gained rank. Pinned in `errorValue.test.ts` "XLOOKUP node SPILLS". One
  surface nuance (the app-wide combo convention, not a lookup drift): a SINGLETON lookup list
  collapses to a scalar on the node (`collapseSingleton`), where the formula keeps a 1-element array.
  **And the matching KERNEL is now shared (2026-08-23):** `lookupFrameRowIndex`/`lookupCubeRowIndex`
  no longer re-implement the scan — they parse the lookup string to a typed needle (`lookupNeedle`)
  and delegate to the formula's `xmatchIndex`, so node and formula can't drift. Agreement pinned in
  `frameLookup.test.ts` "shares the XMATCH formula kernel"; behavior-preserving (full lookup corpus
  green); no Rust mirror to sync. Still deferred to the general mechanism: a 1×N/N×1 MATRIX lookup
  value (the orientation item — still `#SHAPE!`) and per-argument spill for OTHER functions
  (wholeArrayArgs/prepByShape), which subsumes the formula `pick`.
- **NOT a frame/cube input** (asked + declined 2026-08-11). XLOOKUP needs a
  container to guarantee its TWO columns line up ("Build Frame two aligned lists
  first"); XMATCH reads one column and returns a position, so it has no alignment
  problem, and Get Column → XMATCH already is frame-XMATCH with column typing
  intact. Adding it would duplicate a working composition and force a column-name
  input onto a node that needs none.

## Dependency updates (walking them one at a time; TypeScript 7 landed 2026-08-11a)

Current state (2026-08-26): the walkable set is on latest in-range (`react` 19.2.8,
`vitest` 4.1.11, `vite` 8, etc. — git has the walk); the rete RENDER packages and
`styled-components` were removed outright by the React Flow cutover (rete core
2.0.6 + rete-engine + elkjs 0.12 + `@xyflow/react` remain). Remaining major:
`@anthropic-ai/sdk` 0.120 (skipped). The `.npmrc` `legacy-peer-deps` workaround is
REMOVED — the old elkjs-vs-rete-auto-arrange peer conflict left with the plugin
(clean `npm install` dry-run verified).

## Architecture spec (`docs/rules.md`)

- [ ] **The author ARR pass — READY (author-present).** Walk every rule and
  authorize as permanent; the rule index + marking procedure are in place.
- [ ] **Spec-promotion remainder** — read-as is coercion-not-assertion
  (`applyGetColumnReadAs` pins it); promote if config-driven coercions grow.
- [ ] **Enforcement tail (low value)** — socketBox12 partial (un-greppable visual half),
  oneResolvePredicate unenforced (recorded un-greppable).

## Release tail (author-run)

- [ ] **Deferral review (author-present)** — walk `deferrals.md` (now incl. the
  Pushed-to-1.4/2.0 section) and ratify/amend `out-of-scope.md` (still DRAFT).
- [ ] **Keep `release-notes-features.md` current** — the 1.3 selling list.
- [ ] **Cut 1.3**: desktop-gated checks (cargo on Windows, path-stripped
  `release:desktop`, exe smoke), bump 1.3.0, merge → `main`, tag `v1.3.0`.
