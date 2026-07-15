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
- **Quick fix:** the Source toggle shouldn't hide the +Row/−Row/+Col/−Col buttons in table/frame
  popups. Confirmed in code: `TablePopup.tsx`'s dim-controls row is gated
  `editable && view === "grid" && !formattedPreview` (~line 708) — flipping to Formatted preview
  (`formattedPreview = literalSource && displayMode === "formatted"`) hides them for no reason
  tied to editability. Drop the `!formattedPreview` clause (or whatever the real gate should be).
- **Redesign (bigger, separate from the quick fix):** move the add-row/add-column buttons OFF the
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

- **S1 — Agent 1 (Lead) — LANDED** (`3d049ca6`, push held). Per-column frame format persists
  (`frameFormatStore` + persistence + textForm sidecar; popup writes/seeds; FrameDisplay reads).
  tsc clean, 2791 green. Follow-up left: Report embeds (`inlineRefDisplay`) don't key off the
  referenced frame node's id yet. **Agent 1 taking S3 next.**
- **S3 — Agent 1 (Lead) — FOUNDATION LANDED** (`0e5e5ae1`, push held). Representation DECIDED:
  symbol-tagged `ColumnUnit` on the matrix array (`unitValue.ts` `matrixUnitOf`/`withMatrixUnit`/
  `carryMatrixUnit`); `applyFcUnit` tags a numeric matrix. Tests pin it. tsc clean, 2793 green.
  Representation recorded in `decisions.md` D20. REMAINING threading (a units-capable agent CAN
  take pieces — coordinate here to avoid `matrix.ts`/`TablePopup` collisions with Agent 1):
  (a) widening edge (uniform tagged list → matrix carries; mixed strips) — `coerce.ts`/`coerceInputs`;
  (b) op rules in `matrix.ts` (element-wise scalar-algebra on the tag, MMULT mul dims, transpose/
  reshape/TAKE/DROP carry, MDETERM/MINVERSE strip); (c) Table Input taggable-unit UI (node field +
  popup unit dropdown made taggable for a matrix + derive `withMatrixUnit`); (d) chip/popup DISPLAY
  the unit; (e) `unitLattice` sweep. **Clean milestone reached — handing (a)–(e) OFF** (units-capable
  agent or A1 next session). For (c): the whitelist already has `"unit"`, so a Table Input `unit`
  field persists via `INIT_FIELD_ORDER` — but confirm the constructor init accepts it on load; the
  popup matrix bar already renders a unit dropdown gated on `unitTaggable`, needs an `onSaveMatrixUnit`
  callback on `TablePopupState`. **Git hygiene ack (re Agent 2):** my bad — will stage explicit paths,
  never `-A`, in this parallel session. **Queue item 2 (type-switch stale format) TOUCHES S1:**
  `frameFormatStore` keys by column NAME, so a number→date type change leaves a stale numeric format;
  fix = clear the store entry (or reset to the type default) when a column/table type flips.
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
- **Agent 3 — LANDED** (`faa2c528`, push held). Unmount collapsed viz nodes' live figures:
  Chart/Histogram/Sankey/Treemap now gate their figure on `!collapsed` (Treemap/Sankey gained
  `collapseStore` subscriptions to do it). tsc clean, 2791 green.
- **Agent 3 — eyeballed this session's changes for bugs, found one real one — 🚨 for A1/S3
  before threading further:** `applyFcUnit`'s matrix branch (`unitBridge.ts:134`) calls
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
  specificity. tsc clean, 2797 green. Standing by for the commit queue / next task.
