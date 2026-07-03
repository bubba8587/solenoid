# Bundle 05 — Format Controller function model → units-by-dimensionality (the flagship)

> **PROGRESS (2026-07-03).**
> - **Phase C — DONE (already fixed before this bundle resumed).** `Canvas.tsx`'s
>   `nodecreated` `dockSelf()` call IS guarded (`n instanceof FormatControllerNode &&
>   !isGraphRebuilding()`, currently ~line 2369), matching its sibling branches;
>   `groupPush.ts translatePushed` handles docked nodes on push/group-move. The doc
>   below predates that fix — no work needed.
> - **Phase D — FOUNDATION LANDED.** `src/graph/dimension.ts` (+ `dimension.test.ts`,
>   19 tests) is the pure dimensional-algebra core: exponent-vector units + SI scale +
>   affine offset, the ×/÷/^ algebra (5 m ÷ 1 s = m/s, mass·accel → N), commensurability,
>   conversion (incl. C/F/K), a unit-expression parser, and derived-unit formatting.
>   `#UNIT!` added to `errorValue.ts`. The **Convert node now sources its math from
>   dimension.ts** (one source of truth; all 22 original convert tests still pass) — the
>   core is proven load-bearing, not dead infra.
> - **STILL GATED on Phase A (the FC function model / `docs/format-model.md` truth table,
>   author sign-off pending):** Phase D steps 1(value-model)/5(delete unitFlow)/6/7 —
>   units riding per-element through lists (author decided **tagged cells**, since a list
>   is a row and must allow mixed units) / per-column through frames, re-expressing the
>   FC lock/carry/break on the new layer, the Expression/LAMBDA dimensional pass, and the
>   aggregator/socket-lattice work. These consume the core above; do them once the truth
>   table is signed off. Phases A & B (FC model + visual redesign) also await it.


**Source:** `future-directions.md` "smaller swaps" (units-as-dimensional-algebra,
VERDICT: IN and EXPANDED), merged with `v1.1-plan.md` WS-A. **Depends on:** nothing
structurally, but do this FIRST among UI-heavy work. **Feeds:** bundle 14's conditional-
formatting item (must not overlap this bundle's territory), bundle 15's engineering seat.

This is the largest bundle — treat it as its own milestone with four internal phases.
**Do not skip ahead to Phase D before Phase A lands** — the units work is explicitly
gated on the function model.

---

## Phase A — The function model (spec first, then code)

**Exact current state to replace:**

`src/graph/formatAnnotationStore.ts` (542 lines):
- `FormatStyle` union (lines 8-29): `auto | decimal | integer | percent | fraction |
  fraction_adv | scientific | custom | date_dmy | date_iso | date_us | date_long |
  date_med | date_dow | time_24 | time_12 | datetime | date_custom`.
  `FormatStyleId = FormatStyle | (string & {})` (line 34, for pack formats).
- `FORMAT_STYLE_LABELS` (36-55), `FORMAT_STYLE_GROUPS` (57-63, `General/Number/Percent/
  Custom`), `DATE_FORMAT_STYLES` (66-69), `DATE_STYLE_PATTERNS` (71-81), `isDateStyle()`
  (83-85).
- `DecimalMode = "places" | "sigfigs"` (line 87).
- `applyFormatStyle(n, style, customPattern?, decimalDigits=2, decimalMode="places")`
  (90-128): a hand-written `switch(style)` — `decimal` (sig-figs vs places via
  `toLocaleString`), `percent` (×100, same digit logic + `%`), `integer`
  (`Math.round().toLocaleString()`), `fraction`→`toFraction`, `fraction_adv`→
  `toFractionAdvanced`, `scientific`→`n.toExponential(3)`, `custom`→`applyCustomPattern`,
  default → pack-format lookup (`_packFormats.get(style)`) else `autoFormat(n)`.
- `UnitGroup` (232-244); `UnitAnnotation {id,label,group,prefix?}` (246-251);
  `UNIT_ANNOTATIONS` array (253-312, angle/length/mass/temperature/time/area/volume/
  speed/data/currency/custom — all single scalar labels, no dimensional data today).
- `TextCase = "none"|"upper"|"lower"|"proper"` (401).
- **`FormatAnnotation` exact fields (403-416):**
  ```ts
  export type FormatAnnotation = {
    format: FormatStyleId;
    customPattern?: string;
    unit: string;
    customUnit?: string;
    textCase?: TextCase;
    bold?: boolean;
    italic?: boolean;
    textScale?: number;
    decimalDigits?: number;
    decimalMode?: DecimalMode;
  };
  ```
- Store: `formatAnnotationStore` (444-484: `set/get/getForNode/delete/subscribe/version/
  snapshot`, keyed by `${nodeId}::${socketKey}`, per-node index `_byNode`).
  `formatMismatchStore` (496-509). `formatNumberWithAnnotation` (513-531),
  `formatWithAnnotation` (534-542).

`src/graph/components/FormatControllerNode.tsx` (480 lines):
- Gating flags exactly at lines 230-233: `const dt = node.socketDataType; const isDate =
  isDateType(dt); const isText = dt === "string" || dt === "strlist"; const
  showFormatCustom = format === "custom" || format === "date_custom";`
- Renders three hand-written JSX branches on `isText ? … : isDate ? … : …` (lines
  267-449) — text case/bold/italic/size; date single dropdown; number format+unit
  stacked rows.
- Inline seg-toggle duplicate (NOT using the shared `SegToggle`) at lines 389-406
  (`solenoid-fc__seg`/`solenoid-fc__segbtn`), paired with
  `FormatControllerNode.css:76-95`.
- Unit arrow logic at lines 240-245 (`unitLeft`/`unitRight` based on
  `node.lockedByConvert`/`node.forwarding`/`hasUnit`).
- `syncNode()` (117-127) refreshes EVERY FC node in the editor
  (`if (n instanceof FormatControllerNode) n.refreshAnnotation(editor)`), then
  `processGraph()`.

**NEEDS AUTHOR INPUT (still open):** the truth table itself — which controls apply per
value-type (number/date/text/logical), plus the precision × style resolution rule
(sig-figs on percent/scientific/fraction). Write this into a NEW `docs/format-model.md`
(confirmed not to exist yet) and get author sign-off before touching code.

**Build (after sign-off):**
1. Refactor `FormatAnnotation` resolution (`formatAnnotationStore.ts:90-128`) to the
   single model, replacing the hand-written switch.
2. Replace the inline `isText`/`isDate` gating (`FormatControllerNode.tsx:230-233`,
   267-449) with the model's control matrix.

## Phase B — Visual/layout redesign + SegToggle unification

**Exact current state:** `src/graph/components/SegToggle.tsx` (32 lines):
```ts
export function SegToggle<T extends string>({ value, onChange, options }: {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<{ value: T; label: string; title?: string }>;
})
```
Renders `.solenoid-seg`/`.solenoid-segbtn`, `--on` class on match, stops pointer/mouse-
down (per the "native popups need stopPropagation" rule in CLAUDE.md). Existing usages
to copy: `CastNode.tsx:9,47-51`; `ChartNode.tsx:6,48`; `SparklineNode.tsx:3,23`.

**Build:**
1. Layout redesign of the FC's places/sig-figs/units panel, rendering Phase A's control
   matrix. **Read `DESIGN.md` first** (no accent stripe, Quiet Accent Rule, no faux-3D).
2. Route the FC's places/sig-figs toggle through `SegToggle`, retiring the inline
   `.solenoid-fc__seg` variant (`FormatControllerNode.tsx:389-406`,
   `FormatControllerNode.css:76-95`).

## Phase C — Docked-FC movement audit + the mis-dock bug

**Exact current state — the bug, `src/graph/Canvas.tsx`:**
- `DOCK_SNAP_PX = 34` at line 210 (comment at 209 confirms "screen px" — zoom-unaware);
  `findDockTarget` (215-244) does the screen-distance snap math.
- The actual bug, lines 2275-2277:
  ```ts
  if (ctx.type === "nodecreated") {
    const n = ctx.data as object;
    if (n instanceof FormatControllerNode) n.dockSelf(editor);   // ← NO isGraphRebuilding() guard
    if (n instanceof GroupNode) { ... }
    else if (!isGraphRebuilding()) { ... }                        // line 2279 IS guarded
  ```
- Sibling branches that already have the guard: `noderemoved` → `forgetNode`
  (line 2319, `if (!isGraphRebuilding())`), group-membership resync (2326), and the
  `connectioncreated/connectionremoved` sweep (2345, `reconcileFcTypes`).
- The correct, deliberate post-remap call already exists: `persistence.ts:436-438` — after
  remapped connections are recreated, `for (const node of created) { if (node instanceof
  FormatControllerNode) node.dockSelf(editor); }`. **The bug is that `Canvas.tsx:2277`'s
  live `nodecreated` pipe ALSO fires `dockSelf()`, during a rebuild, before `hostNodeId`
  remap is done** — snapping to whatever stale/wrong socket geometry exists at that
  instant. `FormatControllerNode.dockSelf` itself (`nodes/formatController.ts:141-155`)
  has no rebuild guard — the guard must be added at each call site, starting with
  `Canvas.tsx:2277`.

**Movement-op coverage:** `groupPush.ts:74-88`'s `translatePushed` already handles docked
nodes correctly on push/group-move:
```ts
function translatePushed(editor, area, id, dx, dy) {
  ...
  void area.translate(id, { x: p.x + dx, y: p.y + dy });
  const node = editor.getNode(id);
  if (node instanceof GroupNode) { moveGroupMembers(editor, area, node, dx, dy); }
  else { for (const d of dockedNodeStore.getDockedTo(id)) { ... void area.translate(d.id, ...) } } // 83-86
}
```
The doc's original claim that push/expand/collapse lack rigor should be RE-VERIFIED
against this code before assuming work is needed — `translatePushed` already looks
correct for the direct-translate case. Audit whether tidy/autofit's footprint-reservation
logic is what's actually missing on this path, not basic translation.

**Build:**
1. Guard `Canvas.tsx:2277`'s `dockSelf()` call with `!isGraphRebuilding()`, matching the
   sibling branches at 2279/2319/2326/2345.
2. Re-audit push/expand/collapse against `translatePushed` (above) — confirm what's
   actually missing (likely footprint-reservation parity with the tidy path, not basic
   translation) before writing new code.

## Phase D — Units by dimensionality (own milestone; design-first)

**Exact current state:**
- Unit is a single scalar per socket/value: `FormatAnnotation.unit: string`
  (`formatAnnotationStore.ts:409`).
- `src/graph/unitFlow.ts` (289 lines) — **full scope to replace, DELETED not extended per
  the VERDICT:**
  - Duck-typed detectors: `isConvert` (39-42, `fromUnit`+`toUnit` strings), `isFc`
    (43-46, `unit`+`format`), `isPassthrough` (49-52, `passesUnitThrough===true` or
    `unitPassInputs` fn), `isPurePassthrough` (56-58), `valuePassKeys` (60-63),
    `selectedKey` (67-70), `hasAnnotation` (72-74).
  - `combineUnits`/`combineAnnotations` (78-91).
  - `UnitResolver` type (93-98) + `makeUnitResolver(editor)` (106-158, memoized +
    cycle-guarded): Convert→`toUnit`, FC→forward `inUnit` else author `n.unit`,
    passthrough→selector or `combineUnits` or first-input, else `"none"`.
  - `AnnotationResolver` type (160-172) + `makeAnnotationResolver(editor)` (183-268):
    pre-indexed `byTarget`/`bySource` maps (187-198); `inAnnotation` (200-205);
    `outAnnotation` (222-232, memoized); `downstreamAnnotation` (241-265, forward walk
    through pure passthroughs looking for an FC ahead, stops at first transform/
    selector/Convert).
  - `sharedAnnotationResolver(editor)` (280-289) — per-microtask cached singleton
    (a perf-audit finding).
  - Consumed by `formatController.ts:3,227` (`makeUnitResolver` in `refreshAnnotation`)
    — **the replacement must give the FC a way to resolve inbound/outbound unit+
    annotation without this file existing.**
- `FrameColumn.unit?: UnitSuffix` — `src/graph/frame.ts:37-38` (NOT `nodes/frame.ts`,
  which has no `.unit` at all), importing `UnitSuffix` from `unitFormat.ts:7`
  (`"none"|"deg"|"rad"|"percent"` — a legacy non-dimensional scalar, explicitly decoupled
  from graph wiring per `unitFormat.ts:1-5`). `buildFrame(matrix, names)`
  (`frame.ts:101-110`) **confirmed never sets `.unit`** — the only writer is a row-slice
  helper (`frame.ts:553-559`) that only copies a preexisting unit, never originates one.
  Genuinely vestigial.
- `src/graph/valueKinds.ts` — the per-cell tag pattern to mirror for per-element units:
  `Missing = null` (21-25), `isLogical`/`coerceLogical` (29-65), Kleene 3-valued logic
  (74-90), and the aggregator chokepoint `forAggregate(values): AggregatePrep` (99-109 —
  errors propagate, `null` filtered). **A per-element unit tag should ride inside list
  cells the same way**, with its own chokepoint function every list-consuming node calls.
- **Seed exists**: `src/graph/seedGraphs/unit-flow.json` — 5 labeled lanes (A: lock once
  → carries downstream through 2 Displays; B: reaches upstream too; C: a ×100 transform
  breaks the unit; D: Convert forwards the new unit to a locked/greyed FC; E: an IF
  selector keeps the unit through the chosen branch). **This is the acceptance test** —
  it must still pass after `unitFlow.ts` is deleted and replaced.
- `docs/format-model.md` confirmed NOT to exist — create fresh (shared with Phase A).

**The expanded scope (author, 2026-07-02 — supersedes the narrower v1.1-plan.md A4
framing): full dimensional algebra.** True unit calculation: 5 m ÷ 1 s = 5 m/s.

**NEEDS AUTHOR INPUT before build:** the per-cell/per-column unit representation — a
parallel unit array alongside values, or a tagged cell? Decide before writing the value
model; drives the save-format change (pre-alpha — no migration, just update seeds).

**Build (after the representation decision):**
1. **Representation:** exponent vector over base dimensions (length, mass, time, etc.) +
   scale factor. Matrix stays unit-AGNOSTIC always. List carries units PER ELEMENT
   (mirror `valueKinds.ts`'s per-cell pattern). Frame carries units PER COLUMN.
2. **Algebra:** × adds exponents, ÷ subtracts, +/− requires a match, powers scale,
   cancellation is free. Derived-unit display (m/s, N, W) is formatting over the vector.
3. **Expression/LAMBDA**: a second dimensional interpretation over the formula AST
   (`excelFormula.ts`'s `Ast` type, lines 20-28) — operators by the algebra, catalog
   functions by per-function dimensional signature.
4. **New error `#UNIT!`** — follows the existing `SolError` pattern
   (`errorValue.ts:70-75`), same as bundle 04's origin tag extends it.
5. **`unitFlow.ts` is DELETED.** Re-express the v0.9 lock/carry/break semantics on the
   new type layer, verified against the Unit Flow seed's 5 lanes.
6. **FC assigns units to string-list header keys** — locks Build Frame/Add Column's
   resulting column. Use the worked example already in the seed lanes as the acceptance
   demo.
7. Aggregators: SUM over mixed units → convert or `#TYPE!`.
8. Socket lattice: units become the finer-grained sibling of the element-family
   separation, machine-checked via a `sockets.ts`-lattice-style full-sweep test (see
   bundle 02's parity-test convention, and `socketConnect.test.ts`'s existing full-sweep
   pattern at line 192, used elsewhere in this plan set for the object-socket family).

## Exit criteria

One FC model resolves precision × style × unit × value-type per the written truth table
in `docs/format-model.md`; the FC panel is redesigned on `SegToggle`; the mis-dock bug is
fixed (`Canvas.tsx:2277` guarded) and push/expand/collapse are re-verified against
`translatePushed`; a unit rides per-element through a list and per-column through a
frame with true dimensional algebra (`#UNIT!` on mismatch); the Unit Flow seed's 5 lanes
still pass after `unitFlow.ts` is deleted and replaced.
