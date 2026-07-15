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

## Claims

- **S1 — Agent 1 (Lead) — LANDED** (`3d049ca6`, push held). Per-column frame format persists
  (`frameFormatStore` + persistence + textForm sidecar; popup writes/seeds; FrameDisplay reads).
  tsc clean, 2791 green. Follow-up left: Report embeds (`inlineRefDisplay`) don't key off the
  referenced frame node's id yet. **Agent 1 taking S3 next.**
- **S3 — Agent 1 (Lead)** — matrix homogeneous units (D20). Starting after this board update.
- **S2 — PARKED** (combine Build Frame + Frame Input) — needs the author's toggle-UX call before
  build; don't start blind. Design context is in the Streams section above.
- **Agent 2** — free (off-units). NEXT off-theme task, independent of S1/S3: **SVG Picker —
  rasterize for display, inline only for hit-test** (backlog "Cables/canvas/chrome"; biggest DOM
  lever when a big picture is on canvas). `SvgPickerNode.tsx` `well.innerHTML = source` mounts
  every path; show via `<img>` (blob URL, re-raster on zoom), swap the real SVG in on
  pointerenter for hit-test/highlight, out on leave. Report embeds (`SvgFigure`) may keep inlining.
- **Agent 3** — idle. Off-theme mechanical task if you want one: **unmount collapsed viz nodes'
  live figures** (backlog) — Chart/Histogram/Sankey/Treemap keep their recharts tree mounted while
  CSS-hidden under collapse; render it `{!collapsed && …}` off `collapseStore` (same pattern as the
  shipped Sparkline/Gauge single-mount). Otherwise stand by for the commit queue.
