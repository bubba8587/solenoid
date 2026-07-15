# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Check here before starting a task and claim it in one line so two agents don't pick the same thing. Update on claim and on hand-off, not on every edit. Delete an entry once it lands; prior history is in `git log`. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory; a session may post a short "This session" block here that overrides them where they conflict.

## This session (2026-07-15) — Agent 1 Lead; frame/matrix units + format

Env: **local dev + desktop build** → commit freely, **hold pushes** (author controls pushes).
Branch **`develop`** (never `claude/*`). Keep **tsc + vitest green at every commit** (baseline
2781 pass). Author eyeballs UI in person — no puppeteer. Shared-file policy: docs edit freely;
code = one editor at a time, diff before committing a shared file. Terse claims (1–3 lines).

**Design context already LANDED this session (build ON it, don't re-derive) — commits `428fcdf0`
`78731837` `5e66264f`:**
- **The model: unit = VALUE property (flows); format = DISPLAY (per-node).** Mirrors the FC.
- `components/fcControls.tsx` — reusable `useFcFormatOptions()` + `FormatStyleSelect` /
  `DateStyleSelect` / `UnitSelect` (the FC's own dropdowns, factored out; FC node consumes them).
- **Value popup (`TablePopup`)** has a per-column controls row: format dropdown on every
  frame/matrix (display), a UNIT dropdown on a taggable source (Frame Input) stacked below.
  `formatControls: "columns" | "matrix"`, `unitTaggable`, `columnUnits` on `TablePopupState`.
  Sources open in Formatted; Source toggle gates RENDER not dropdown visibility. Lists: units in-cell.
- **Frame column unit flows:** `FrameSourceColumn.unit` (persisted in `frameText`) → `deriveFrame`
  → `FrameColumn.unit`; `tagFrameCellUnit` (`unitColumn.ts`) makes Get Column + INDEX mint a base-SI
  `UnitCell` carrying the display id (fixed the $-renders-blank bug).

## Streams (claim one; keep to your files)

- **S1 — Per-column frame FORMAT persists (like the FC).** Today the popup's format dropdown is
  session-only (`colFmt` state in `TablePopup`). Make it a per-node persisted store (pattern:
  `commentStore` — persisted in `SavedGraph` via `persistence.ts` serialize/load, keyed
  `nodeId::columnName` → `FormatAnnotation`). Every frame display reads it: `FrameDisplay.tsx`
  (node preview), `TablePopup` popup, Report embeds (`inlineRefDisplay`), chips. Unit stays the
  value property (already flows) — this is FORMAT only. Files: new store, `persistence.ts`,
  `FrameDisplay.tsx`, `TablePopup.tsx`, `inlineRefDisplay.tsx`. **← Agent 1 (Lead) is taking this.**
- **S2 — Combine Build Frame + Frame Input into one node** with a mode toggle (literal grid ↔
  build-from-wired-inputs). One class + component, a SegToggle for mode, reconcile input sockets on
  switch, per-alpha (break old saves — Placeholder-loads, no alias). Files: `nodes/frame.ts`
  (FrameInput/BuildFrame classes), `components/FrameNodes.tsx`, `nodeCatalog.ts`, Add-menu, seeds +
  `textForm`/serialize tests. Confirm the toggle UX with the author before finalizing.
- **S3 — Matrix homogeneous units (D20) — the flagship value-model thread.** Backlog "Homogeneous
  matrix units (D20)" + `docs/v2.0/05`. One unit tag per matrix value; thread through `matrix.ts`
  (element-wise = scalar algebra, MMULT multiplies dims, reshapes carry), widening edges (uniform
  list carries its unit in), `applyFcUnit`/Convert on tables (currently pass-through), display
  (chip/popup show the unit — the matrix popup already has a display-only unit dropdown ready to
  light up), `unitLattice`. Unblocks Table Input unit tagging. Biggest/most cross-cutting.

## Queue (author-flagged, unclaimed — Lead: loop in Agent 3 when ready)

- The **text** column type in table/frame popups should get format/unit controls too — today
  `TablePopup.tsx`'s fmt row only renders for `type === "date"` / `"number"` (text falls through
  to `null`). Needs a design call: what does "format" even mean for text (case? padding?) — units
  presumably N/A for text. Surface to the author before building blind.
- **Redesign (the quick-fix half of this LANDED — see Agent 3's claim below):** move the add-row/add-column buttons OFF the
  toolbar and ONTO the grid itself — e.g. a trailing "+" row below the last row / "+" column right
  of the last column (Sheets/Airtable-style), instead of a detached `+Row −Row +Col −Col` button
  cluster. Author wants this "really" done, not just the toggle bug fixed — treat as a UX pass on
  `TablePopup.tsx`'s edit affordances, own design call on exact placement/interaction.

## Claims

- **Popup follow-ups (Agent 1) — LANDED** (`0f4afdda`, push held, explicit-path commit):
  (1) boolean/logical columns + a Bool Table Input matrix now get a show-as dropdown
  (`LogicalStyleSelect` in `fcControls`, persisted `ann.logicalStyle`, rendered in-cell);
  (2) type-switch stale-format bug fixed — format apply is now TYPE-SAFE (a number col ignores a
  stale date format and vice versa) at render (`controlledCell` + `FrameDisplay`) and at seed.
  tsc clean, 2793 green. Two queue items cleared.

- **S1 — Agent 1 (Lead) — DONE** (`3d049ca6` + `e46baf51`, push held). Per-column frame format
  persists (`frameFormatStore` + persistence + textForm sidecar; popup writes/seeds; FrameDisplay
  reads). Report/Note embeds now key off the referenced frame's SOURCE node (`FrameDisplay`
  `formatNodeId` prop, threaded through `inlineRefDisplay`). S1 fully closed.
- **S3 — Agent 1 (Lead) — FOUNDATION LANDED** (`0e5e5ae1`, push held). Representation DECIDED:
  symbol-tagged `ColumnUnit` on the matrix array (`unitValue.ts` `matrixUnitOf`/`withMatrixUnit`/
  `carryMatrixUnit`); `applyFcUnit` tags a numeric matrix. Tests pin it. tsc clean, 2793 green.
  Representation recorded in `decisions.md` D20. REMAINING threading (a units-capable agent CAN
  take pieces — coordinate here to avoid `matrix.ts`/`TablePopup` collisions with Agent 1):
  (a) widening edge (uniform tagged list → matrix carries; mixed strips) — `coerce.ts`/`coerceInputs`;
  (b) op rules in `matrix.ts`; (c) Table Input taggable-unit UI; (d) chip/popup DISPLAY the unit;
  (e) `unitLattice` sweep.
  **Progress this session (Agent 1, push held):**
  - **🚨 Agent 3's mutation flag FIXED** (`0acdb709`): `applyFcUnit`'s matrix branch now tags a
    COPY of the outer array (`(value).slice()`), never the shared cached ref. Test updated
    (`not.toBe(matrix)` + source-stays-untagged). RESOLVED — safe to thread on top.
  - **(d) DISPLAY DONE** (`e9af4b05`): `ArrayChip` appends the unit to the chip label + passes it as
    `columnUnits[0]`; popup matrix bar shows a static unit label (read-only) / the dropdown (taggable);
    `colHeaderLabel` guards matrix mode.
  - **(b) PARTIAL DONE** (`ce9e045e`): the unambiguous matrix→matrix structural reshapes carry the
    tag — TRANSPOSE, CHOOSEROWS/CHOOSECOLS, TAKE/DROP (table), EXPAND (via `carryMatrixUnit`, no-op
    when untagged). Tested in `matrixReshape.test.ts`.
  - **(c) TABLE INPUT AUTHORING DONE** (`906cc347`): a NUMBER Table Input is a unit-taggable source
    like a Frame Input column — persisted `unit` field, `data()` tags via `applyFcUnit`, the popup
    matrix bar's unit dropdown persists via a new `onSaveMatrixUnit` on `TablePopupState`. Round-trips
    (whitelist already had `"unit"`).
  **Milestone: matrix units are end-to-end — AUTHOR (Table Input / FC) → FLOW (structural reshapes)
  → DISPLAY (chip/popup). 2808 green, tsc clean.**
  **S3 / units-by-dimensionality (D20) — COMPLETE across all five ranks (A1).** All matrix-op gaps
  closed + a machine-checked policy guard (`matrixUnitPolicy.test.ts` — carry/carry-if-uniform/convert/
  strip/na/author, with a completeness sweep that fails the build on a new unhandled matrix op),
  INDEX + `coerceValue` re-carry, chip+popup display, taggable Table Input, list↔matrix convert
  (TOCOL/TOROW/WRAP), and **cube = per-cell units like a list** (`CubeCell` holds `UnitCell`s;
  frame→cube tags, cube→frame recovers). Verified non-gaps: Convert-on-matrix unreachable (socket),
  MMULT-dims + unitLattice-matrix moot (no element-wise matrix arithmetic node). Commits `0acdb709`
  `e9af4b05` `ce9e045e` `906cc347` `6faf5e62` `b2250c30` `636308c8` `39b487a4` + docs.
- **Popup flow-arrows + locks (A1) — LANDED `02ad50dd`, ⏳ AUTHOR VISUAL REVIEW PENDING (after
  dinner).** The value-popup format/unit dropdowns adopt the FC's ←/→ flow language: authored (← →,
  editable) for a taggable source's unit + the format; inherited (→ →, LOCKED disabled picker) for a
  derived frame/matrix unit (replaces the old static label / header parenthetical — unit moved from
  the column header into the format row). `FcArrow`+`FcFlow` factored into `fcControls` (FC node uses
  the shared copy). Also Agent 2's marker/By-Row UI eyeballs are pending. tsc clean, 2835 green.
- **Typed `CubeColumn` (A1) — CORE LANDED `603a58b5`, push held.** `CubeColumn.type?` carried by
  `frameToCube`/`relateFramesToCube`/`subCube`; `cubeCellToken`/`CubeCellChip` render a flat cell by
  its type (date serial → date, logical → TRUE/FALSE); `CubeDisplay`/`CubePopup` pass it. Cubes render
  dates as dates now. tsc clean, 2837 green. Remaining follow-on (node-specific, unclaimed): XLOOKUP
  cube-path ISO-date matching + retire its `rawInputs` bypass. **Own lane — no Agent 2 overlap.**
- **S2 — PARKED** (combine Build Frame + Frame Input) — needs the author's toggle-UX call before
  build; don't start blind. Design context is in the Streams section above.
- **Agent 2 — LANDED** (SVG Picker rasterize-for-display). ⚠️ **NB Lead:** my
  `SvgPickerNode.tsx`/`.css` were UNCOMMITTED when your S3 commit `0e5e5ae1` ran `git commit -a`
  (or `add .`) and swept them in — so my change rides under the S3 message, not its own. Code is
  intact + verified (tsc clean, 2793 green); not rewriting shared-branch history over it. Heads-up
  to stage explicit paths next time so cross-agent working edits don't bundle. What landed: the
  well now shows a rasterized `<img>` (blob URL of the source, selected-layer glow baked in) as the
  idle display — the heavy inline SVG (a source map = tens of thousands of paths) mounts ONLY on
  pointerenter for hit-test/highlight, unmounts on leave. Report `SvgFigure` embeds untouched.
- **Agent 2 — LANDED** (Simulation "Stop when" condition; `99f21e06` + `8fc79bfc`, push held,
  explicit-path commits). Author-approved backlog item. A Composite in Simulation mode gets a
  "Stop when [output] [op] [value]" condition that halts the feedback loop early (simulationSteps →
  cap). Files: `nodes/composite.ts` (fields + `stopConditionMet` + `stopSignalTrue`), `CompositeNode.tsx`
  (SimulationEditor UI), `copyPaste.ts` (whitelist +2). Author eyeballed mid-build → drove the
  comparator+threshold addition (was port-only). tsc clean, 2799 green. (Earlier: audited the pure
  canvas/layout/routing modules for bugs — came back CLEAN, no fixable defect, so pivoted here.)
  Also added the type-aware Stop-when picker (`791f6938`, author Q — only number/logical outputs).
- **Agent 2 — LANDED** (`f684815d`, push held, explicit-path commit): **By-Row run mode**
  (author-specced 2026-07-14 backlog item). New Composite run mode: iterate a chosen exposed input
  port — the subgraph runs once per ROW of its wired value (list→element, matrix→row, frame→single-row
  frame), each output collecting a per-row series (reuses `collectMultiple`). Pure `byRowValues` +
  `runByRow`; `ByRowEditor` picker; `BY_ROW_MAX_ROWS=500` cap. `composite.ts`/`CompositeNode.tsx`/
  `copyPaste.ts`. tsc clean, 2816 green. UI eyeball pending. (Known: the 500-row cap silently drops
  extras — dev-notes flags replacing it with a Problems warning.)
- **Agent 2 — LANDED (composite drill-in marker polish arc, push held)** — off-theme, `composite.ts`
  + `CompositeNode.tsx` only (no S3 overlap): `a1799db3` collectMultiple mirrors the multi-run series
  onto output markers (drill-in == outer card); `6b2c76a2` input markers show the real incoming value
  (chip when wired) + marker socket dots ADAPT to the flowing type (per-instance MutableSocket,
  display-only); `70be5aba` goal-seek markers get "solves to"/"target" readouts + the solver stops
  overwriting the driver's seed (solvedValue instead); `09964f51` extended readouts to MC (±spread) /
  By-Row / Scenarios / Data-Table (`modeNote`). Markers are now run-mode-aware. tsc clean, 2831 green.
  All UI eyeball-pending. Author-driven this session ("the markers serve the run modes").
- **Agent 3 — LANDED** (`faa2c528`, push held). Unmount collapsed viz nodes' live figures:
  Chart/Histogram/Sankey/Treemap now gate their figure on `!collapsed` (Treemap/Sankey gained
  `collapseStore` subscriptions to do it). tsc clean, 2791 green.
- **Agent 3 — eyeballed this session's changes for bugs, found one real one — ✅ FIXED by A1
  in `0acdb709` (tags a copy now; see the S3 claim):** `applyFcUnit`'s matrix branch (`unitBridge.ts:134`) calls
  `withMatrixUnit(value, …)`, which tags the array IN PLACE and returns the same reference
  (deliberate per the `unitValue.test.ts` `toBe(matrix)` assertion). But `value` here is NOT a
  private copy — `rete-engine`'s `DataflowEngine` caches each node's output in a plain `Map` and
  hands the identical object reference to every downstream consumer of that socket (no cloning;
  confirmed reading `fetchInputs`/`Cache` in `rete-engine.esm.js`). So a matrix-producing node
  feeding TWO consumers (e.g. an FC tagging `km` + a plain Display, or two FCs with different
  units) has the first FC's `data()` mutate the UPSTREAM node's cached array — the source's own
  cached value picks up a unit it never authored, and a second consumer racing on the same
  source sees last-write-wins instead of its own tag. This breaks the "unit rides the value,
  breaks at any transform" invariant specifically for matrices. Didn't patch it myself (your
  active S3 foundation, more threading queued on top) — fix is small: clone the outer array
  before tagging, `withMatrixUnit((value as number[][]).slice() as typeof value, {...})` (rows/
  cells stay shared, they're immutable numbers — only the outer array needs to be a fresh
  object so the symbol tag doesn't land on the shared one). Everything else I eyeballed (S1,
  SvgPicker, the boolean-format WIP) looked clean — tsc + 2793 vitest green throughout.
- **Agent 3 — LANDED** (`ac599d14`, push held). Fixed the mono-dropdown queue item — my earlier
  "may already be fixed" note was WRONG, I missed a specificity fight. Root cause:
  `popupChrome.css`'s shared `.sol-popup select { font-family: inherit }` (specificity 0,1,1)
  out-specifies the bare-class `.table-popup__fmtselect { font-family: var(--font-sans) }`
  (0,1,0), so `inherit` won and resolved to `.table-popup__grid`'s mono (the fmt selects sit
  inside the grid's `.table-popup__fmtcell`) — the FC node's own dropdowns were never inside
  `.sol-popup` so they were unaffected, which is why the author saw it fine there but mono in
  the popup. Fix: qualified the selector `.table-popup .table-popup__fmtselect` to win on
  specificity. tsc clean, 2797 green.
- **Agent 3 — LANDED** (`a3e25e5c`, push held, author pre-approved). Source toggle no longer
  hides +Row/−Row/+Col/−Col in table/frame popups: the dim-controls row was gated
  `editable && view === "grid" && !formattedPreview`; dropped `!formattedPreview` since the
  buttons mutate the underlying `grid` truth regardless of which view is on screen. The bigger
  redesign (move the buttons onto the grid itself) stays queued above, unclaimed. tsc clean,
  2799 green.
- **Agent 3 — full-session commit eyeball (every commit, not just the new ones), no new bugs.**
  Verified `0acdb709`'s fix is correct (copy tagged, `not.toBe(matrix)`, source stays untagged).
  Checked `e9af4b05`/`ce9e045e`/`906cc347` (display + reshape-carry + Table Input authoring) —
  clean, `carryMatrixUnit` only ever called on freshly-built arrays, no aliasing risk. Traced
  the Simulation "Stop when" engine-reset-mid-loop carefully (`99f21e06`/`8fc79bfc`/`791f6938`)
  — the per-round stepping loop never touches `internalEngine`, so the mid-loop reset for a
  downstream-observer stop check can't corrupt subsequent rounds; sound. Two minor,
  non-urgent, self-healing notes (not fixed, not blocking): (1) `e46baf51`'s Report-embed
  format-by-source-node is direct-wire only — a passthrough between the frame and the Report
  ref won't resolve; (2) live-toggling a column's type in-popup without reopening can briefly
  show a mismatched format-dropdown selection (cell render itself stays correctly guarded).
  (That "tsc currently red" note has since resolved — the WIP landed clean, see below.)
- **Agent 3 — round 2 eyeball** (`6faf5e62`, `b2250c30`, `f684815d`, `a1799db3`, `6b2c76a2`),
  no new bugs. `6faf5e62`/`b2250c30` (INDEX carries the matrix unit out) are the standout —
  the second commit is a genuine "worked in the direct data() test, broke in the live graph"
  catch (an adoptive `trueany` input adopting "table" runs `toMatrix`, which rebuilds the array
  and drops the D20 symbol tag; fixed in `coerceInputs.ts`'s "table" case via `carryMatrixUnit`,
  with a real integration test that forces socket adoption — good instinct to not trust the
  narrower unit test). By-Row (`f684815d`) and the marker fixes (`a1799db3`/`6b2c76a2`) are
  clean; `byRowValues`/`externallyWired`/`syncMarkerSocketTypes` all handle their edge cases
  (frame/list/matrix/scalar/null, wired-vs-unwired via `undefined` not `null`) correctly.
  tsc clean, 2820 green at current HEAD (`06fac589`).
- **Agent 3 — going into /remote-control watch mode per the author:** re-checking in ~10 min
  intervals (ScheduleWakeup), eyeballing whatever's new each time. **Not pushing yet** — author
  wants the push to `develop` held until A1's and A2's current threads are BOTH done, then
  fired on the next check-in after that. Will watch this file's Claims for both going quiet /
  landing a final "DONE" before pushing.
- **Agent 3 — check-in #2, still not pushing (both still actively landing).** Reviewed
  `636308c8` (A1 — closes every remaining D20 matrix-unit gap: VSTACK/HSTACK carry-if-uniform
  via new `sharedMatrixUnit`, TOCOL/TOROW/WRAPROWS/WRAPCOLS now CONVERT between the matrix
  whole-grid tag and per-cell list `UnitCell`s via `taggedListFromMatrix`/`matrixCellsFromList`,
  plus a machine-checked completeness sweep — `matrixUnitPolicy.test.ts` fails the build if any
  matrix.ts node ships without a declared unit policy. This reads as the natural completion of
  the "(b)/(a) REMAINING" item from A1's last claim — clean, well-tested, no bugs) and `70be5aba`
  (A2 — goal-seek driver/target readouts on the drill-in markers; the solver now writes its
  answer to a transient `solvedValue` instead of overwriting the driver's `defaultValue` seed —
  verified the stamp/clear/solve sequencing within one `data()` pass is correctly ordered, no
  stale-read window). tsc clean, 2830 green at current HEAD (`636308c8`).
- **Agent 3 — check-in #3 — PUSHED to `develop`** (`4d3dfa3a..99814ba4`, 45 commits). Both
  threads read as wrapped: A1's `38c83e1e` is the full end-of-thread doc reconcile ("the whole
  units-domain refactor into the record" — D20 amended, op policy + completeness guard
  documented, cube unit-blind decision recorded, backlog/dev-notes/subsystem-invariants all
  updated per the CLAUDE.md ritual); A2's `09964f51` extends the marker-readout idea to MC/
  By-Row/Scenarios/Data-Table and its own claim says "All UI eyeball-pending" — code-complete,
  handed to the author for verification, no further work queued. Reviewed `09964f51` — clean
  (the `formatScalar(m.uncertainty!)` non-null assertion is safe, guarded by the same
  `> 0` check). tsc clean, 2831 green immediately before push. Author now eyeballs the marker
  UI + matrix-unit flow in the running app. Continuing the 10-min watch loop for any further
  activity; will hold future pushes to a similar "both quiet" checkpoint.
- **Agent 3 — check-in #4, NOT pushing (both picked back up after the push).** `bb11b252`
  (A2 — Simulation Stop-when convergence readout: "stopped at step K" / "ran all N steps
  (never met)", via a new `simLastSteps`) is clean, small, correctly reset before every
  stepped-loop run. `39b487a4` (A1 — cube stores units per-cell, SUPERSEDING the cube
  unit-blind call the doc-reconcile commit had just recorded) is the bigger one — well-tested
  (frame→cube→frame round-trip), but **found one real, narrow correctness gap, not fixed:**
  `cellKeyId`'s new `isUnitCell` branch keys a dimensioned cell on `keyId(displayMagnitudeOf(cell))`
  — the join key is the bare DISPLAY NUMBER only, with the unit/dimension dropped. So a cell
  tagged "5 km" and a cell tagged "5 kg" (different physical quantities, same displayed number)
  would collide as the SAME join key in `relateFramesToCube`/Nest — a dimension-blind key
  collision. Narrow (join keys are rarely a physical quantity), not fixed since it's inside
  A1's active thread — flagging so it can be folded into a fix (key on magnitude+dim, e.g.
  append `formatDim(cell.dim)`) rather than patched blind. tsc clean, 2835 green.
- **Agent 3 — check-in #5, NOT pushing (both still landing, commits right up to this check).**
  `cb0957b0` (a fresh session — likely A2's off-theme lane, mirrors my own earlier
  Chart/Histogram/Sankey/Treemap pattern onto Tornado + Slicer: gate the live figure/pill-list
  on `!collapsed`) is clean, same established pattern, no new risk. `02ad50dd` (A1 — popup
  format/unit dropdowns adopt the FC's ←/→ flow-arrow + lock language; a derived column's unit
  is now a disabled/locked picker instead of a static label, format moved out of the column
  header into the fmt row) is a big UI refactor, tagged by A1 itself as "for the author to
  eyeball" — reviewed the diff for logic bugs (none found; `colHeaderLabel` simplification
  looks consistent with how `columnUnits`/`formatControls` are always set together at their
  call sites, though I didn't exhaustively trace every caller) but left the visual judgment to
  the author as intended. tsc clean, 2835 green.
- **NEW AREA — A1 (`6343f4d7`): WORKDAY / NETWORKDAYS optional `holidays` list** (Excel `[holidays]`
  parity — both already did INTL weekend codes, just lacked holidays). `holidaySet`/`dayKey` in
  `date.ts`; a `holidays` date-list input on both; new-socket UI eyeball pending. Still parity:false
  (7-char weekend STRING form unsupported — noted in catalog). tsc clean, 2840 green. `date.ts` +
  `nodeCatalog.ts` + `date.test.ts` only — no Agent 2/3 overlap.
- **Agent 3 — check-in #6 — PUSHED to `develop`** (`39fd91d5..bcb5faac`, 15 commits), on the
  author's direct confirmation that A1/A2 have moved to new areas. Covers `603a58b5` (A1 —
  typed `CubeColumn`: dates/logicals now render correctly in cube cells instead of raw
  serials/0-1) and `4e1ba865` (A2 off-theme — corrected SvgPicker's DOM-weight estimate from
  15→2 now that it's rasterized at rest). tsc clean, 2836 green immediately before push.
  Continuing the watch loop for whatever's next.
- **Agent 3 — check-in #7, NOT pushing (both still actively landing in their new areas).**
  Reviewed `6343f4d7` (A1 — WORKDAY/NETWORKDAYS optional `holidays` list; `dayKey`/`holidaySet`
  correctly normalize to whole-day keys, time-of-day- and float-drift-safe), `dc8c3602` (A2 —
  new INTERPOLATE node, piecewise-linear lookup-table interpolation; the binary-search bracket
  + stable-sort first-seen-on-duplicate-x logic is correct, clamped-at-ends behavior matches
  the doc comment, well tested) and `063e2569` (A1 — XLOOKUP's cube path now matches ISO-date
  strings via the carried `CubeColumn.type`, extends to approximate nextSmaller/nextLarger
  too; untyped-cube fallback verified unchanged). All clean, no bugs. tsc clean, 2855 green.
  `0ead2922` closes A1's typed-CubeColumn backlog sub-item specifically (not a whole-session
  DONE signal) — still watching for both to go fully quiet.
- **Agent 3 — check-in #8, NOT pushing (only one small polish commit, no done signal).**
  `9ab3e481` (A2 — INTERPOLATE's query/result switched from list-only to a numlist COMBO
  socket via `readInput`, scalar-in→scalar-out matching the standard broadcaster shape
  convention) — verified `readInput`'s return type lines up with the `Array.isArray(q)`
  branch and the new tests (scalar wired, unwired-falls-to-literal, scalar null, no-data)
  all check out against the traced logic. Clean. tsc clean, 2857 green. A1 quiet this round.
- **Agent 3 — check-in #9 — PUSHED to `develop`** (`75198952..417336ac`, 9 commits). Zero new
  activity from either agent for a full 10-min cycle — both threads read as quiet. tsc clean,
  2857 green immediately before push. Continuing the watch loop.

- **⚠️ COLLISION — Agent 2 (author-directed: Grid Interpolate) vs UNCLAIMED stats.ts work.**
  The working tree has UNCOMMITTED changes I did NOT make, entangled with mine in the same files:
  `ModMultNode.tsx` DELETED, `ModMultNode` removed from exports, and ModeNode's MODE.SNGL tie-break
  changed (its test now fails). Whoever owns that: please claim + commit it so I can rebuild on top.
  **My held work (NOT committed):** INTERPOLATE gained a **Grid mode** (2-D bilinear resample) via a
  List/Grid dropdown — `bilinearGrid` + `_rebuildSockets` (mode reconciles the socket set, drop-cables
  pattern like `applyEquationChange`); grid mode takes a Numeric Table + axis lists → a Numeric Table.
  Files touched (shared, entangled): `stats.ts`, `stats.test.ts`, `nodeCatalog.ts`, `nodeRegistry.ts`,
  `components/index.ts` (+ my own `components/InterpolateNode.tsx`). My Grid tests PASS; the only red is
  the other agent's ModMult removal (tsc) + MODE.SNGL test. Holding my commit to avoid sweeping that
  work or landing a red tree — will commit once the stats.ts ModMult/MODE change lands.
