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

**A — correctness & parity (engine/formula, fully test-pinnable)**
- [ ] **A3 (remainder) — the popup grid's keyboard path** (the largest "zero learning
  curve" gap; the sort / export / `− Row` items landed 2026-08-23: sort ranks the WHOLE
  dataset and renders its top 1,000; Copy / Export / read-only CSV view emit every row in the
  visual order; the editable CSV view stays source-order because it parses back into the
  grid). AUTHOR EYEBALL: open a >1,000-row frame popup, sort a column, confirm the top rows
  and that Copy CSV carries all rows.
- [ ] **A4 (remainder) — retire the XLOOKUP `rawInputs` bypass** (deferrals: with typed
  frame→cube the bypass is unneeded; the frame + cube lookup paths could collapse to one).
- [ ] **A5 Node-by-node sweep**, per family, value-semantics + description truth (below).
- [ ] **A6 Editing-surface kernel, bug slice first**: `installNodeDragGuard` from
  `areaPresets.ts` into BOTH `nodecreated` pipes (the dead drill-in finger pan, below) with its
  tap-to-select companions; pinned in `surfaceParity.test.ts`; verified by headless CDP touch
  emulation (agent-run, not author-watched). Phases A–C of the kernel follow as pure refactor.

**B0 — the Python/R gap (author ask 2026-08-23) — Tiers 1 + 2 LANDED; what remains**
- [ ] `python-r-gap.md` open items: ODE integrate (RK4 over an Expression), 2-D histogram for
  the Heatmap, `str_wrap` (text → lines), STL (loess decomposition). Tier 3 stays recorded as
  out of character.

**B — engine features promoted from deferrals (autonomous-friendly, node+formula+tests)**
- [ ] **B6 Table-popup per-column summary footer** (sum/avg/min/max/count via `forAggregate`)
  + **column profiling** (valid/error/empty bar, distinct/min/max/mean) — display over frame
  data; small UI, no devtools loop.
- [ ] **B7 Tidy options**: expose direction / density / width-cap (Coffman-Graham layerBound)
  on the Tidy call as a small options pill; ELK runs headless so layout is unit-testable;
  the cable-readability question stays for the author's eye.
- [ ] **B8 Cube-aware Unnest (peel one level)**; **Timesavers remainder** (Split Name,
  duration trio, list reducers); **XLOOKUP frame+cube path collapse** once A4 lands.
- [ ] **B9 Lazy-handle-on-cable** (retire the `collect()` bridge) — last, biggest.

**C — hygiene**: evict the three archived docs still cited by code (below); deferral review.

## Polish sweeps (the 1.3 working mode — thorough, small-scope, one seam at a time)

- [ ] **Architecture map v2 — WAIT FOR THE AUTHOR'S SPEC.** The old map (Subsystem
  cards + import cables, generator chain, coverage guards) is deleted. The author
  will describe the replacement precisely; build nothing toward it until then.

- [ ] **Node-by-node sweep** — walk the catalog one node at a time: null/error/empty
  inputs handled per `value-semantics.md`; collapsed card reads right; description
  matches actual behavior; tooltips/labels per DESIGN §7. Record per-family findings
  in the session digest; fix small, file anything big.
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
- [ ] **Window min/max/close controls missing (desktop)** — `tauri-plugin-decorum`
  `create_overlay_titlebar()` not rendering. Ruled out: the accent border. Needs a
  live devtools look or a decorum/tauri version check; fallback = native OS
  decorations. Regression, cause unknown.
- [ ] **#7 Conduits sometimes unselectable/unmovable except via the Navigator** —
  intermittent, no repro; suspected z-order/hit-area or group-membership sync.
- [ ] **A finger pan is DEAD inside a drill-in — no node has a drag guard there.**
  Author-reported as "major flickering" panning/pinching the sudoku solver (44-node
  subgraph, `runMode: simulation`) on mobile; unpacking the SAME nodes onto the main
  canvas makes it stop. `patchDragGuard` (`Canvas.tsx:591-631`) is installed per node
  from Canvas's `nodecreated` pipe, and its touch branch — an unselected node is
  drag-transparent so the press falls through to a PAN — is what makes finger-panning
  work at all. The drill-in's editor pipe (`CompositeEditorOverlay.tsx`) installs
  error guards only, so rete's stock drag captures the pointer and stops propagation:
  the area never sees the press. MEASURED (headless CDP, touch-emulated, identical
  gesture on identical content): main canvas pans (cam 358,381 → 258,306, 0 nodes
  moved); drill-in does nothing at all (cam unchanged, 0 nodes moved). Worst in the
  mid-zoom band only because that is where cards tile most of the viewport, so nearly
  every press lands on one. FIX = the first real slice of the editing-surface kernel
  (`deferrals.md`): extract `installNodeDragGuard(area, editor, opts)` into
  `areaPresets.ts` and install from both `nodecreated` pipes — lock guard and
  pen/non-primary-button guard port as-is, the group edge-band branch goes behind an
  optional predicate (groups don't exist in a drill-in). Must bring the companions or
  a card becomes unselectable by touch: tap-to-select on `pointerup` plus the
  `gestureMultiRef` check that stops a pinch from selecting. Pin in
  `surfaceParity.test.ts`. NOT the choppy-zoom BAND and not raster — see the digest
  for the eliminated set; don't retread it.
- [ ] **Pinch-zoom on a real Mac trackpad** — should work via `e.ctrlKey` wheel;
  verify on hardware. NOTE: `rete-area-plugin` 2.2.1 fixed exactly this upstream
  (normalize wheel delta for touchpad pinch, their #31) — but `CappedZoom.wheel`
  REPLACES their handler, so the fix cannot reach us while we override it. Either
  delete our `wheel` and tune `intensity`, or keep our curve and fix it ourselves.
- [ ] **Settle the OS-dropdown rule** (needs a device/emulated CDP) — the "native
  `<select>` needs a pointerdown swallow" claim has no recorded incident and the
  mobile path suggests it may not hold; 21 sites held on precaution. If false, they
  join the `stopDragStart` sweep; if true, record the repro. LEAD:
  `simpleNodesOrder` MOVES the picked node in the DOM tree (their own docstring),
  and re-parenting a subtree is a mechanism that WOULD kill an open `<select>` —
  see the `zIndexNodesOrder` item under Dependency updates.
- [ ] **Choppy zoom BAND — run the T1–T8 plan** in dev-notes' open problem. T1 (pin
  the band's `k` via `__solenoidPerf`) and T2 (Performance trace inside vs outside)
  gate the rest — build nothing before those.
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
- **Text Filter ⊂ List Filter** — absorption/delete: `FilterOp` already has
  contains/startsWith/endsWith + Match case; Dropped covers not-contains. The
  `TEXTFILTER` formula name needs a call.
- **TREND ⊂ FORECAST.LINEAR** — widen Forecast's `x` to `numlist` combo (it's a
  per-element operand) and TREND is redundant. Related: LINEST + LOGEST differ only
  in model → model selector.
- **PHI / GAUSS → Distribution forms** — both are standard-normal forms already
  living in the Distributions menu.
- **Smaller pairs**: Select+Drop Columns (keep/remove toggle); Set + Set relation
  (one card, output socket swaps list↔logical per op — Split Frame precedent);
  discount securities (TBill 3 + SecurityDisc 3 + PriceDisc 2 + PriceMat 2, all
  settlement/maturity/basis-shaped); BondPrice + OddCoupon (odd variants = extra
  date params per op); ACCRINT + ACCRINTM; CSV File +
  Parquet File (format from extension) and Write CSV + Write JSON.

## Small builds & calls (still 1.3-sized)

- [ ] **Virtualize the table/cube popups instead of truncating at 1,000 rows**
  (author-raised 2026-08-22, pointing at `react-window`). `TablePopup.tsx` and
  `CubePopup.tsx` both hard-cap at `MAX_VISIBLE_ROWS = 1000` and label it "· first
  1,000"; every cell renders a controlled `<input>` (read-only ones included), so the
  cap is really a DOM-node budget. **The open question is not the library, it's whether
  the popup stays an HTML `<table>` or becomes a real data grid** — that choice picks
  the tool, so answer it first. Decider: does anyone actually hit 1,000 rows in
  practice? Needs a measurement (time a 50k-row frame at a few column counts) and the
  author's read on how big real frames get.

  - **Path A — keep the `<table>`, window it ourselves (~60 lines, no dependency).**
    Render only the visible slice of `<tr>`s, preserve scroll height with one spacer
    `<tr>` above and one below. Sticky `<thead>`, sticky row-number `<th>` and native
    auto-sizing all keep working because the table formatting context is intact. The
    usual blocker — widths jittering as rows scroll in and out — is half-solved:
    `colMinWidths` already measures every NON-text column from the whole dataset
    (`<input>` cells have no intrinsic width), so only text columns auto-size from
    visible content and that same pass extends to them. Cheaper still if the
    measurement says the `<input>` is the cost: drop it on read-only cells first.
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
- [ ] **Settings: Node Packs section** — planned, unbuilt (`Settings.tsx`).
- [ ] **Finish evicting live material from `docs/archive/`** — the routing table is
  clean and machine-checked now, but three archived docs are still cited as current
  by CODE: `formulajs-vs-native-audit.md` (the per-family verdicts `FAMILY_BACKING`
  encodes), `cube-node-scope.md` (`nodes/cube.ts`, `frameLookup.test.ts`),
  `formula-node-parity.md` § Tier 1 (quoted in `formulaNodeParity.test.ts`'s failure
  message). Same split as the divergence catalogue: live half out, finished record
  stays.
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

Changelogs ship INSIDE the rete packages — `npm pack <pkg>@<old>` and `@<new>`,
untar, diff the bundled changelog. Read those, not the GitHub releases (that API
is blocked here for out-of-scope repos).

- [x] **`rete-react-plugin` 2.1.0 → 2.1.2 — LANDED 2026-08-23 (author call: on latest + working
  = fine).** 2.1.2 is exactly `root.render(el)` → `flushSync(() => root.render(el))` in the
  plugin's `mount`, so a node's root is layout-ready when the mount returns (2.1.1 only colors
  rete's stock `<input>`, which we never render — inert). The synchronous flush surfaced a latent
  bug: it runs a mounting component's effects mid-rebuild, and the ONE mount effect that recomputes
  — `ConduitComponent.tsx:209` `useEffect(processGraph, [realLanes])` (audited: every other of the
  ~60 `processGraph` call sites is a user-action handler, never a mount effect) — fired
  `processGraph()` during `addNode`, before the graph was built → `Dataflow2.fetch` threw
  `node is not initialized`. Fixed with a TWO-layer guard, both kept regardless of the plugin:
  (1) `processGraph` single-flight (`_passActive`/`_rerunQueued`, `processReentrancy.test.ts`) —
  a recompute fired mid-pass coalesces into one trailing pass instead of nesting; (2) the Conduit
  mount effect early-returns while `isGraphRebuilding()` (the terminal pass recomputes anyway).
  Clean re-measure: crash gone, cascade collapsed to one pass + a cheap rerun. Costs ~100ms more
  on the first 171-node render (the `flushSync` synchronous-commit tax) — a one-time load cost the
  author accepted for being on latest.
- [ ] **`rete-area-plugin` 2.1.5 → 2.3.2** — own change, needs a selection-test
  pass + a trackpad check. Two behaviour changes reach us: 2.3.1 makes
  `Selector.add` unselect everything EXCEPT the re-picked entity instead of
  `unselectAll()`-then-add (less selection churn → fewer re-renders, interacts
  with selection-on-pointerup); 2.2.x normalizes wheel deltas — the same algorithm
  `CappedZoom.wheel` implements, differently tuned (theirs 8px/line, 24px/page,
  `intensity/8` per px, cap `intensity`; ours 16/400, ×0.0028, cap 0.24). **Rewrite
  the `CappedZoom.wheel` comment on contact** — it now overrides a WORKING
  implementation, not a broken one. `CappedZoom.down` (capture-phase finger count)
  is unaffected.
- [ ] **Evaluate `zIndexNodesOrder` (new in area 2.3.0)** — "relies only on
  z-index. Use this extension when click handlers inside nodes must stay stable",
  vs `simpleNodesOrder` which moves the picked node in the DOM tree. Candidate
  answer to the OS-dropdown rule above. NOT a drop-in: `groupLogic.ts` pins a group
  behind its members BECAUSE stacking follows DOM order, `Canvas.tsx` reasons about
  the picked node landing at the DOM end, and the extension's own ladder (nodes ≥1,
  connections 0) has to be reconciled with ours (standoffs −3 < groups −2 <
  conduits −1 < nodes 0). Its own investigation.
- [x] **`rete-history-plugin` 2.1.1 → 2.2.0 — DON'T bump (checked 2026-08-23).** The
  `dist/` is byte-identical to 2.1.1; the only delta is a new REQUIRED peerDependency on
  `rete-comment-plugin@^2.2.0` (all 2.2.0 features are comment-plugin undo presets, which
  we don't use — our own `commentStore`). Bumping buys nothing and either adds a standing
  unmet-peer warning or pulls a plugin we never import into the tree. Net negative; stay at
  2.1.1.
- [ ] **`vite` 7.3.6 → 8.2.1 WITH `@vitejs/plugin-react` 4.7.0 → 6.0.5** — hard
  coupled (plugin-react 6 declares `vite: ^8.0.0`, no `^7`). Highest-risk bump left,
  and BOTH risks are invisible to `tsc` and vitest, so gate it on a trial build that
  checks two artifacts: (1) `dist/third-party-licenses.txt` present and POPULATED,
  (2) our class names survive in the bundle (`grep dist` for `XMatchNode`,
  `ListIndexNode`). Vite 8 swaps Rollup → **Rolldown** (`rolldown: ~1.2.1`) and
  esbuild → **Oxc** (esbuild demoted to an optional peer; `lightningcss` promoted to
  a direct dep; `build.minify` now `boolean | "oxc" | "terser" | "esbuild"`).
  What that lands on in `vite.config.ts`:
  - **`rollup-plugin-license` runs under Rolldown.** It emits the third-party
    license file we SHIP — compliance, not cosmetics. A build error is fine
    (loud); a silently empty/partial file is the bad outcome.
  - **`esbuild: { keepNames: true }` is deprecated and `keepNames` appears NOWHERE
    in vite 8's types** (`OxcOptions` extends rolldown's transform options, which
    don't carry it). That flag is what keeps `constructor.name` intact for the node
    type hints — so the failure is production-only, silent and user-visible: dev is
    unminified, tests never build, and `release:desktop` ships it. Expect to set
    `build.minify` explicitly — `"esbuild"` keeps the old minifier (still a
    supported optional peer), or `"terser"` + `terserOptions: { keep_classnames:
    true, keep_fnames: true }`.
  NOT blockers (checked): vitest 4.1.8 already allows `vite ^6 || ^7 || ^8`; node
  engines are identical across 7 and 8; every new peer on both packages is optional.
  Downstream: this is the build tool, so the Tauri desktop release rides on it.
- [ ] **`elkjs` 0.8.2 → 0.12.0 — only worth it WITH the Tidy-options work.**
  Verified inert on its own: layout output is byte-identical on both a connected
  and a disconnected graph with our four options, and the full suite passes under
  0.12. It buys no visible change and costs a standing `npm warn ERESOLVE
  overriding peer dependency` — `rete-auto-arrange-plugin@2.0.2` (the LATEST; none
  newer exists) peer-pins `elkjs: ^0.8.2`, i.e. `<0.9.0`, and we reach ELK only
  through that plugin. What it DOES buy is `layered.layerUnzipping.*`, which lays a
  9→1 fan out 3×3 at 929×710 where Coffman-Graham (available today) manages
  929×987 — plus `considerModelOrder.groupModelOrder.*`, `inLayerPredOf/SuccOf`,
  and `topdownLayout` (ELK's native answer to the super-node trick our group Tidy
  hand-rolls). Gotcha for whoever builds it: `layerUnzipping.layerSplit` is a
  PER-NODE option — set on the root it is silently ignored — so Tidy must stamp it
  onto the wide layer's nodes, ~`ceil(sqrt(count))`; 4 on a 9-fan splits 3/2/2/2
  and buys no further height. Also note the license moves EPL-2.0 →
  `EPL-2.0 OR GPL-3.0-or-later`, which changes the shipped
  `third-party-licenses.txt`. Full option survey + the open cable-routing question:
  `deferrals.md` "Tidy options".
- [ ] **The rest of the outdated set, still unwalked** — majors: `marked` 14→18,
  `katex` 0.17→0.18. Plus ~16 in-range patches. Core `rete` 2.0.6 is already current.
  (`@formulajs/formulajs` 4.6.0→4.6.1 LANDED 2026-08-23: the diff is exactly a new `TAKE`
  — which we already own via `registerInternal`, so upstream's buggy one never runs — and a
  real `SUMIFS` fix that coerces text-formatted sum-range numbers, correct-and-inert against
  our typed columns. Full suite green.)

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
