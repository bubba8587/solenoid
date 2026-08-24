# B7 — Tidy options: direction / density / width cap

**Goal.** Three persisted Tidy knobs — direction (Right / Down), density (Compact / Normal /
Airy), width cap (Off / 2 / 3 / 4 per layer via Coffman-Graham) — read at layout time by
BOTH Tidy implementations (main canvas and composite drill-in), exposed in Settings ▸ Canvas
and in a small popover off the top-bar Tidy button. ELK runs headless, so every knob is
pinned by a layout test. The cable-readability question (a 3×3 fan through OUR router)
stays for the author's eye.

**Read first.** `docs/subsystem-invariants.md` § Auto-arrange / Tidy; `docs/layout-chrome.md`
(top bar row, z-order); `DESIGN.md` §5 "Navigation / Toolbars" (`DESIGN.md:258-259`) and
the op-picker scope of `SegToggle` (`DESIGN.md:235-247` — SegToggle is a CARD control; chrome
reuses its shape, not the component); `docs/code-comments.md`.

**Backlog lines when done:** delete "B7" in the Execution queue; in the `elkjs 0.8.2 →
0.12.0` dependency item, replace the dangling `deferrals.md "Tidy options"` pointer
(`backlog.md:310`) with "survey: git show 11709841^:docs/deferrals.md lines 123-160". Do
NOT bump elkjs here (layerUnzipping is the 0.12 follow-on; it stays its own item).

## Where it is

- Everything is `src/graph/tidyArrange.ts`. The ELK call `:359-367` passes exactly two
  options (`nodeNodeBetweenLayers "55"`, `nodeNode "38"`); `elk.algorithm`,
  `hierarchyHandling`, `edgeRouting` come from the plugin's root defaults
  (`node_modules/rete-auto-arrange-plugin/rete-auto-arrange-plugin.esm.js:701-707`, caller
  options spread last). `elk.direction` is never set (ELK resolves UNDEFINED → RIGHT).
- Port preset `symmetricPortPreset()` `:40-52`: hardcodes `EAST`/`WEST`; reads
  `settingsStore.get("tidyAlign")` at `:46` — that is the precedent for reading a setting
  at layout time. Consumers: `:69`, `src/graph/tidyArrangeGroups.test.ts:124`, and a
  hand-copied duplicate in `src/graph/components/CompositeEditorOverlay.tsx:530-538`.
- Anchor rule `:323-345` keeps LEFT edge + vertical CENTER; shift applied `:400-416`.
- Group super-node proxy `:277-291`, standoff leader `:157-188`/`:264-276`, conduit port
  filter `:293-312`; the standoff settle runs last `:482-498`.
- Drill-in Tidy: `CompositeEditorOverlay.tsx:524-547`, `mount.arrange.layout()` at `:542`
  with NO options (not even the spacings).
- Invocation: `TopBar.tsx:90` (button, `.solenoid-topbar__group--layout`),
  `canvasKeyboard.ts:213`, `menuModel.ts:105`, `GroupNode.tsx:310-313`; indirection
  `process.ts:65-84`.
- Settings precedent: `settingsStore.ts:11-12` (field), `:42` (default), `:84-92` (schema
  entry, `type: "segment"`, Canvas section `:78`); rendered by `SegmentRow`
  `src/graph/Settings.tsx:74-100`. Persistence is automatic.
- Tests: `src/graph/layoutTidyIntegration.test.ts` (drives elkjs directly; its `APP_OPTS`
  `:26-32` has DRIFTED — sets `elk.direction` the app never sets, omits the plugin
  defaults); `src/graph/tidyArrangeGroups.test.ts` (real `makeArrangeFn` + real ELK,
  headless; idempotence test `:269` is the guard to re-run per setting);
  `tidyDisplayFcWidth.test.ts`.
- ELK 0.8.2 (verified in `node_modules/elkjs/lib/elk-worker.js`): `elk.direction`
  RIGHT/DOWN/LEFT/UP; `elk.layered.layering.strategy` incl. `COFFMAN_GRAHAM`;
  `elk.layered.layering.coffmanGraham.layerBound` (INT, target PARENTS = root options,
  default Integer.MAX = unbounded, and DEPENDS on strategy = COFFMAN_GRAHAM — inert
  otherwise). Pass numbers as strings.

## Design (decided)

- Settings fields: `tidyDirection: "right" | "down"` (default right), `tidyDensity:
  "compact" | "normal" | "airy"` (default normal), `tidyWidthCap: 0 | 2 | 3 | 4` (default 0
  = off). Three `segment` schema rows in the Canvas section next to `tidyAlign`.
- One exported pure function in `tidyArrange.ts`:
  `export function tidyLayoutOptions(s: { direction, density, widthCap }): Record<string,string>`
  → `{ "elk.direction": RIGHT|DOWN, "elk.layered.spacing.nodeNodeBetweenLayers": …,
  "elk.spacing.nodeNode": …, [+ "elk.layered.layering.strategy": "COFFMAN_GRAHAM",
  "elk.layered.layering.coffmanGraham.layerBound": String(cap) when cap > 0] }`.
  Density: compact 36/24, normal 55/38 (today's), airy 80/56. Both ELK call sites use it
  (the drill-in finally gets the spacings — note in the digest as a behaviour change).
- `symmetricPortPreset(direction)` becomes a factory: RIGHT → EAST/WEST as today; DOWN →
  outputs SOUTH, inputs NORTH. Delete the inline copy in `CompositeEditorOverlay.tsx` and
  import the factory.
- Anchor rule under DOWN: keep TOP edge + horizontal CENTER (the transpose of today's
  rule), so tidy→autofit stays a fixed point in both directions. Same for the within-group
  clamp at `:403-409` (clamp against the box's left interior edge instead of the header).
- Popover: a `.solenoid-tidy-options` popover anchored under the Tidy button, opened by a
  small chevron/second button beside it in `.solenoid-topbar__group--layout` (NOT a new
  bar; NOT selection-gated). Three rows using the SAME markup as Settings' `SegmentRow`
  (radiogroup + `--on`), overlay chrome tokens per DESIGN §5 (opaque `--surface`,
  `--overlay-border`, overlay shadow), radius 999 pill buttons, neutral, no accent. Escape /
  clickaway closes (`useEscapeToClose` precedent, `components/useEscapeToClose.ts`).
  Register its z-slot and offset in `docs/layout-chrome.md` (it is an overlay; the sync
  map is the point of that doc). Copy: labels only ("Direction", "Density", "Width cap";
  options "Right / Down", "Compact / Normal / Airy", "Off / 2 / 3 / 4") — no sentences.
  Tooltip on the opener: "Tidy options". Run `uiCopy.test.ts`.
- Mobile/tablet: the popover is fine on a tablet (desktop chrome); on a phone the top bar
  is different — check `TopBar.tsx` for the `is-tablet`/mobile branches and don't add the
  opener where the Tidy button itself isn't shown.

## Steps

1. `tidyLayoutOptions` + tests first: `layoutTidyIntegration.test.ts` imports it (delete
   `APP_OPTS`), asserts the exact option map for each density/cap/direction combination,
   and adds a 9→1 fan fixture: cap 3 → exactly 3 distinct x-columns (RIGHT) / 3 distinct
   y-rows (DOWN) among the 9; cap off → 1. Plus no-overlap on each.
2. Settings fields + schema rows (`settingsStore.test.ts` precedent `:38-39`, `:152-172`).
3. Preset factory + both call sites + delete the drill-in copy. `tidyArrangeGroups.test.ts`
   `:124` passes the direction explicitly.
4. Anchor rule transpose. Extend `tidyArrangeGroups.test.ts`: run the idempotence test
   (`:269`) and the two-groups test (`:345`) under DOWN and under cap 3; they must hold
   within the same 1px tolerance.
5. Popover + layout-chrome row. `tsc`; `tidyArrangeGroups`, `tidyDisplayFcWidth`,
   `layoutTidyIntegration`, `settingsStore`, `uiCopy`, `layoutInvariants`; full suite.
6. Docs: subsystem-invariants § Auto-arrange gets one sentence per knob (what it maps to
   in ELK and the anchor transpose); backlog lines as above; digest.

## Done when

- Tests above green; full suite + `tsc` green; committed in ≥2 commits (engine first,
  chrome second).
- Author eyeball list at http://localhost:1420: Settings ▸ Canvas shows the three rows;
  the Tidy popover opens/closes and matches the Settings values; a 9→1 fan with cap 3 lays
  out 3×3 — and THIS is the open question: do the cables through our router read as a
  block or as spaghetti? Report what you see; do not touch `cablePaths.ts`.
