# Bundle 05 — Format Controller function model → units-by-dimensionality (the flagship)

**Source:** `future-directions.md` "smaller swaps" (units-as-dimensional-algebra,
VERDICT: IN and EXPANDED), merged with `v1.1-plan.md` WS-A (already-approved, detailed
plan — this bundle folds A1-A4 in rather than duplicating). **Depends on:** nothing
structurally, but do this FIRST among UI-heavy work — author: "unit carrying and data-type
segregation are some of the biggest value adds of this project." **Feeds:** bundle 14's
conditional-formatting item (must NOT overlap this bundle's text-format/unit territory),
bundle 15's engineering-calc-seat vertical (units-as-values is its winning card).

This is the single largest bundle in the set — treat it as its own milestone with two
internal phases, exactly as `v1.1-plan.md` already scoped (v1.1-α: function model +
redesign; v1.1-β: units-by-dimensionality). Do not skip ahead to units before the
function model lands — the units work is explicitly gated on it.

## Phase A — The function model (spec first, then code)

**What exists:** `applyFormatStyle` is a hand-written `switch(style)` with precision
logic duplicated per case (`formatAnnotationStore.ts:90-128`); the FC popup gates
controls with scattered inline flags (`isDate`/`isText`, style-string comparisons) at
`FormatControllerNode.tsx:230-233`/`:371`. No unified model exists.

**NEEDS AUTHOR INPUT (already flagged in v1.1-plan.md, still open):** the spec itself —
a truth table of which controls apply per value-type (number/date/text/logical), plus
the precision × style resolution rule (sig-figs on percent/scientific/fraction). Write
this into `docs/format-model.md` (or a `subsystem-invariants.md` section) and get author
sign-off before touching code — this is a design deliverable, not a coding task.

**Build (after the spec is signed off):**
1. Refactor `FormatAnnotation` resolution to the single model.
2. FC popup lights/no-ops controls per incoming type, driven by the model, not by
   scattered inline flags.

## Phase B — Visual/layout redesign + SegToggle unification

**What exists:** `SegToggle` (`SegToggle.tsx:9`) is already used by Cast/Chart/
ColorPicker/Frame/Sparkline; the FC still renders its own inline variant
(`FormatControllerNode.tsx:389-406`, `FormatControllerNode.css:76-95`).

**Build:**
1. Layout redesign of the FC's places/sig-figs/units panel, rendering Phase A's control
   matrix. **Read `DESIGN.md` first** — no accent stripe, Quiet Accent Rule, no faux-3D.
2. Route the FC's places/sig-figs toggle (and any new toggles) through `SegToggle`,
   retiring the inline `.solenoid-fc__seg` variant.

## Phase C — Docked-FC movement audit

**What exists:** drag, group-move, and tidy/autofit already handle docked FCs correctly
(`repositionDockedTo`, `groupPush.ts:83-86`, `Canvas.tsx:1544`/`1680-1696`/`1877`). Push/
expand/collapse ride the generic `shiftBox` translate without the same footprint-
reservation rigor.

**Build:** bring push/expand/collapse to the same rigor tidy already has. Also fix the
known bug in the same surface: FCs mis-dock to a frontmatter Note on load/switch
(`DOCK_SNAP_PX=34` is screen-px not zoom-aware, `Canvas.tsx:210`; `nodecreated` calls
`dockSelf()` unconditionally before persistence remaps `hostNodeId` — guard with
`!isGraphRebuilding()` like sibling branches already do). This bug lives on the exact
surface this phase touches — fix it here, not as a separate ticket.

## Phase D — Units by dimensionality (own milestone; design-first)

**What exists:** unit is a single scalar per socket/value today (`FormatAnnotation.unit:
string`); `unitFlow.ts` walks the graph both directions on every redraw to resolve it. A
vestigial `FrameColumn.unit?` slot exists (`frame.ts:37-38`) but is never written.

**The expanded scope (author, 2026-07-02 — this supersedes the narrower v1.1-plan.md A4
framing): full dimensional algebra, not just carrying a unit through the type system.**
True unit *calculation*: 5 m ÷ 1 s = 5 m/s.

**NEEDS AUTHOR INPUT before build (open decision already flagged, still unresolved):**
the per-cell/per-column unit representation — a parallel unit array alongside values, or
a tagged cell? Decide before writing the value model; it drives the save-format change
this phase causes (pre-alpha — no migration, just update seeds).

**Build (after the representation decision):**
1. **Representation:** exponent vector over base dimensions (length, mass, time, etc.)
   + a scale factor. Matrix stays unit-AGNOSTIC always (pure numbers). List carries units
   PER ELEMENT (a list is conceptually a row — `[3 km, 5 mi, 2 km]`, same pattern as the
   array-semantics model's per-cell `null`/`SolError`, see `valueKinds.ts`). Frame carries
   units PER COLUMN.
2. **Algebra:** operators compose dimensions (× adds exponents, ÷ subtracts, +/− requires
   a match, powers scale, cancellation is free). Derived-unit display (m/s, N, W) is
   formatting over the vector, not a stored string.
3. **Expression/LAMBDA:** a SECOND, dimensional interpretation over the formula AST —
   operators by the algebra, catalog functions by per-function dimensional signatures
   (SUM preserves, SIN requires dimensionless, SQRT halves the exponent vector).
   Unsigned/unlisted functions break the unit loudly.
4. **New error:** `#UNIT!` for dimensional mismatch — follows the existing tagged-`SolError`
   pattern, not a new error mechanism.
5. **`unitFlow.ts` is DELETED, not extended** (explicit VERDICT) — the walker goes away
   once units live in the type layer; re-express the v0.9 FC lock/carry/break semantics
   on the new type layer without regression. The **Unit Flow seed is the acceptance
   test** — it must still demo lock + downstream carry + upstream multi-hop + selector
   carry-through after the rewrite.
6. **FC assigns units to STRING-LIST elements used as header keys** — an FC puts a unit
   on a header string; Build Frame/Add Column locks each resulting column to its header's
   unit. Worked target UX already specified in `v1.1-plan.md` A4 — reuse it as the
   acceptance demo (`[id, Item, Revenue ($0.00)]` header → `[5,6,7]` → `[$5.00,$6.00,$7.00]`,
   FC on the resulting column locked).
7. Aggregators: SUM over mixed units → convert or `#TYPE!` (same discipline as element-
   family separation already enforces).
8. Socket lattice: units become the finer-grained sibling of the element-family
   separation — machine-checked the same way (`socketConnect.test.ts` full-sweep pattern).

## Exit criteria

One FC model resolves precision × style × unit × value-type per a written truth table;
the FC panel is redesigned on `SegToggle`; docked FCs survive every movement op
(push/expand/collapse included) and the mis-dock bug is fixed; a unit rides per-element
through a list and per-column through a frame with true dimensional algebra (`#UNIT!` on
mismatch); the Unit Flow seed still passes after `unitFlow.ts` is deleted and replaced.
