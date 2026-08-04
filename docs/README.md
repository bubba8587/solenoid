# Docs index

Solenoid's `docs/` folder — the WORKING set only. `CLAUDE.md` (repo root) is always
loaded and is the source of truth for standing rules; this index maps everything
else. Finished docs (shipped plans, resolved scoping, point-in-time research, the
dev-notes per-item history) live in `archive/` — see `archive/README.md`.

## Start here (new agent, in this order)

1. **`../CLAUDE.md`** — standing rules, architecture notes, the non-obvious traps.
2. **`glossary.md`** — the invented vocabulary (Conduit, Standoff, FrameRef, unit
   flow…). Read before the deep-dive docs or their terms won't parse.
3. **`architecture.md`** — the file map: where things live.
4. **`rules.md`** — the NORMATIVE spec: what must remain true, and the test that
   enforces each rule. Sockets, formula surface + naming, value handling — the
   architecture that can't be checked by looking at the app.
5. **`decisions.md`** — the big WHYs and what would reverse them; read before
   proposing anything that touches a settled call.

## Reference (read the relevant section before touching a subsystem)

- **`subsystem-invariants.md`** — the "don't break this" mechanics (cable routing,
  group push, standoffs, tidy, error values, unit flow, alerts, addressable model,
  autosave, drill-in lifecycle).
- **`layout-chrome.md`** — the on-screen chrome map (bars, overlays, offsets,
  z-index ladder). Read before adding or moving any bar/overlay.
- **`format-model.md`** — the FC function model: the render pipeline, the
  per-family control truth table (mirrored in `formatModel.ts`), the precision
  rule. Read before touching FC controls/resolution.
- **`socket-reference.md`** — all 30 socket variants in plain English: what each
  carries, its glyph/color, what connects in, what is blocked, what it reaches,
  and what the coercion boundary does on arrival. Generated lists — regenerate
  with `scripts/socket-inventory.ts`.
- **`value-semantics.md`** — null / NaN / Infinity / SolError semantics per
  computation context, plus **"Reading an input"**: the spec for what a node
  does with a WIRED blank vs its typed literal. Target that section when
  writing a new node. All shipped.
- **`node-coverage.md`** — the node inventory + the arity/labeled-slots rules;
  `nodeCatalog.ts` is the real source of truth.
- **`cube-node-scope.md`** — the Cube model + node set + drill-in.
- **`pack-architecture.md`** — the lean-core + packs design (framework BUILT;
  this is the authoring guide + rationale).
- **`excel-toolbar-supplementals.md`** — the non-function half of Excel parity
  (ribbon-by-ribbon verdicts). Function-gap research: `archive/excel-pain-points.md`.
- **`formula-node-parity.md`** — the D19 parity program record (audit, tiers,
  the open Tier 4).
- **`pack-composite-plans.md`** — queued composite-shaped pack nodes.
- **`release-notes-features.md`** — the curated selling list / What's-New source.
- **`grid-system.md`** — the (unbuilt) soft-grid design spec; parked in
  `deferrals.md`.
- **`out-of-scope.md`** — the standing NO list.
- **`code-comments.md`** — the comment policy (D30): comments are the last-resort
  home for knowledge; the cut rules and the homes hierarchy. Read before writing
  (or reviewing) comment prose.

## Work queue (forward-looking — verify against code; these rot)

- **`backlog.md`** — OPEN items only; **the single source of truth for tasks.**
  Landed items get DELETED (git + digests are the record). Oriented around 1.3
  (v1.2.0 shipped 2026-07-22); the release tail lives here too.
- **`deferrals.md`** — everything the author has deferred/parked/author-gated,
  in one reviewable list; the backlog carries a single Deferral-review item
  pointing at it. Nothing there is scheduled until that review promotes it.
- **`2.0-plan.md`** — the author-present flagships (Excel `.xlsx` transpiler, D2, D4;
  FC A4 units already shipped), the release view over `v2.0/`.
- **`v2.0/`** — the live plan bundles: 08 Excel transpiler, 10 decision sensitivity,
  12 uncertain/money, 16 widget nodes. Built bundles are archived (05 units →
  `archive/units-format-controller.md`; 17 matrix formulas, 18 parity corpus,
  19 computed-column surface → `archive/`); see `v2.0/README.md`.
- **`dev-notes.md`** — session DIGESTS + open problems only; per-item history in
  `archive/dev-notes-history.md`.
- Shipped release views are archived: `archive/release-plan-1.1.md` (the 1.1 cut),
  `archive/1.2-plan.md` (the 1.2 build queue, executed).

## Process

- **`agent-coordination.md`** — parallel-agent scratchpad (dormant in solo sessions).

---

## Code → spec routing (grep your file here before editing)

The per-FILE version of the cheat-sheet below. Files listed here carry ZERO comment
pointers by design (D30) — this table IS the pointer. Editing a listed file without
reading its docs is how recorded negative results get retried and settled rulings
relapse.

| Code | Governing docs |
|---|---|
| `zoomSettle.ts`, renderer gesture/settle handling | `dev-notes.md` § choppy zoom BAND; `subsystem-invariants.md` § Renderer gesture GPU layers |
| `groupCollapse.ts` | `subsystem-invariants.md` § Group collapse — the retain rule |
| `equationSolve.ts` | `subsystem-invariants.md` § Equation solver |
| `semanticZoomStore.ts` | `subsystem-invariants.md` § Semantic zoom gate |
| `rasterAtlas.ts`, `htmlCanvasRenderer.ts` (clone/read-back paths) | `subsystem-invariants.md` § HTML-in-Canvas raster atlas |
| `mathUtils.ts` `fillBorderedGrid` | `subsystem-invariants.md` § Bordered-grid fill |
| `excelFunctions.ts` overrides / dispatch walk | `formula-node-parity.md` § Formula.js divergence catalogue |
| `applyOp` scalar operators (`excelFormula.ts`) | `value-semantics.md` § Scalar operators (P6) |
| `stringOrder.ts` | D32 (byte order, not locale) |
| `nodes/matrix.ts` Table Input parse, `TablePopup.tsx` | D31 (raw text is the stored truth) |
| `palette.ts` socket-color siblings | `../DESIGN.md` § Tertiary (Typed Socket Palette) |
| `cablePaths.ts`, `ribbonCable.ts` | `subsystem-invariants.md` § Cable routing |
| `groupPushCore.ts`, group expand/collapse | `subsystem-invariants.md` § Group expand push |
| `standoffSolver.ts`, `standoffs.ts` | `subsystem-invariants.md` § Standoffs |
| `tidyArrange.ts` (ELK) | `subsystem-invariants.md` § Auto-arrange |
| `errorValue.ts`, `valueKinds.ts` | `value-semantics.md`; `subsystem-invariants.md` § Error values |
| `fcReconcile.ts`, in-place socket retype | `subsystem-invariants.md` § Type propagation |
| `unitFlow.ts`, `unitBridge.ts`, `unitValue.ts`, `coerceInputs.ts` | `subsystem-invariants.md` § Unit flow; D20, D26 |
| `formatModel.ts`, `formatController.ts`, FC controls | `format-model.md` |
| `alertStore.ts` | `subsystem-invariants.md` § Alert node + HUD |
| `nodeNameStore.ts`, `textForm.ts` | `subsystem-invariants.md` § Addressable model |
| `documentStore.ts`, `documentStoreCore.ts` | `subsystem-invariants.md` § Per-doc autosave |
| `persistence.ts` (load gate, literal maps) | `subsystem-invariants.md` § Inline literal maps |
| `CompositeEditorOverlay.tsx`, drill-in lifecycle | `subsystem-invariants.md` § Composite drill-in |
| `sockets.ts`, `accepts()`, `trueAnyAdopt.ts` | `subsystem-invariants.md` § Socket lattice; `socket-reference.md`; D17 |
| `excelFunctions.ts`, `excelFormula.ts`, Expression/LAMBDA | `formula-node-parity.md`; `rules.md` FX rules; D24 |
| `computedColumnCore.ts` | D24, D25; `rules.md` FX-13 |
| `frameVerbs.ts`, `frameBackend.ts`, `frame.ts` | `glossary.md` (FrameRef); D1, D5; cargo parity tests |
| `nodeOps.ts` (op declarations) | D29 (aggregators are arguments); `node-coverage.md` |
| `nodeCatalog.ts` | `node-coverage.md`; D10 (eliminated functions stay eliminated) |
| any `.css`, any visual change | `../DESIGN.md` |
| any bar/overlay position or z-index | `layout-chrome.md` |
| `ConduitComponent.tsx`, conduit faces/lanes | `subsystem-invariants.md` § Conduit perpendicular-face sign |

## Task → docs cheat-sheet

- **Adding/changing a node:** `node-coverage.md` + `glossary.md`; `nodeCatalog.ts`
  is the source of truth (Add menu + Function Reference generate from it).
- **Choosing a socket type for a port, or "why won't this cable connect?":**
  `socket-reference.md` (the per-variant tables) + subsystem-invariants "Socket
  lattice".
- **Touching the FC / formats / units:** `format-model.md` + subsystem-invariants
  "Unit flow" + decisions D20 (units granularity).
- **Touching frames/the engine:** `glossary.md` + `decisions.md` D1/D5 + the
  `frameVerbs.ts` oracle and cargo parity tests.
- **A visual/UI change:** `../DESIGN.md` (the design-system rulebook) first, always.
- **Proposing a feature or scope change:** `out-of-scope.md` + `decisions.md` +
  `v2.0/README.md` (verdict-pending + ruled-out lists) — most of the idea space
  has already been walked and ruled; don't re-litigate.
- **Wrapping up a session:** the reconcile ritual in `CLAUDE.md` — extend the
  session digest (sweep digested ones to the archive), DELETE landed backlog
  lines, archive any doc whose job finished, update this index if the set changed.
