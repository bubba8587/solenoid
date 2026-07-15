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
  **(b)/(a) REMAINING (the deeper algebra pass — a focused slice next):** element-wise scalar-algebra
  on the tag (scale a km matrix → km; matrix±matrix same-unit → same, mismatch → #UNIT!), MMULT mul
  dims, MDETERM/MINVERSE strip; the rank-changing TOCOL/TOROW + WRAPROWS/WRAPCOLS are part of (a) the
  list↔matrix widening edge (a matrix tag must CONVERT to per-cell list units and back, not plain
  carry) — plus `coerce.ts` widening and (e) the `unitLattice` sweep. No `matrix.ts`/`TablePopup`
  collision risk for other agents right now; A1 owns these.
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
  ⚠️ **Note for Lead, not a landed bug:** `tsc` is currently red, but only in your UNCOMMITTED
  WIP (`ArrayChip.tsx`, `matrixReshape.test.ts`, `composite.ts`, `copyPaste.ts`, `list.ts`) —
  didn't touch it, your active files. Standing by for the commit queue / next task.
