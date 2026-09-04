# The Format Model (FC function model) — v1.1 WS-A1

One coherent definition of how a Format Controller decides what to render, replacing
the per-style ad-hoc logic (`applyFormatStyle`'s hand-written switch with precision
duplicated per case, and the popup's scattered `isDate`/`isText` gating). This is the
spec the code implements (`formatModel.ts` + `formatAnnotationStore.ts`); the FC popup
lights/hides controls off it, and A2's visual redesign renders THIS control matrix.

## The pipeline

A displayed value is produced by four stages, in this order, each driven by one axis
of `FormatAnnotation`:

```
value ──▶ 1 TYPE GATE ──▶ 2 STYLE (scale-divide, then precision+grouping) ──▶ 3 UNIT AFFIX ──▶ 3b NEGATIVE WRAP ──▶ 4 TEXT ATTRS
```

1. **Type gate.** The FC's adopted socket type maps to a **format family**
   (`familyOf`). The family selects which controls exist at all (the truth table
   below). A control outside the FAMILY is HIDDEN in the popup and INERT in
   resolution — never disabled-but-visible, never silently applied. (The one
   sanctioned disabled-but-visible control is WITHIN a family: the unit dropdown
   under a lock state, below — locked is a fact worth showing, absence is not.)
2. **Style.** The numeric magnitude renders per the format style, with precision
   resolved by ONE shared rule (below) — no per-style private precision logic.
   Dates render via their pattern instead; text/logical skip this stage.
3. **Unit affix.** The unit label wraps the formatted string (prefix for
   currencies, suffix otherwise). Number-family only; a date/text/logical value
   never takes a unit. Orthogonal to style — every number style accepts a unit
   (the unit is a property of the VALUE and a cable constraint, not display sugar).

   **Unit = VALUE-level, format = DISPLAY-level (FC A4, 2026-07-13).** The FC is
   VALUE-MUTATING for the unit: `FormatControllerNode.data()` tags the value's
   `UnitCell` (dimension + the chosen display id) via `applyFcUnit`, whose three
   branches are: a dimensionless number is authored (`5` + km → 5000 m base,
   display km), a commensurable dimensioned value is re-displayed, an
   incommensurable one is a `#UNIT!`. But the FC as a user-facing tool can only
   REACH the authoring branch (firstClassUnits): the re-display branch serves the mirror of
   an inherited unit, never a dropdown pick — re-displaying a dimensioned value
   is Convert's job. Because the unit rides the VALUE (`unitValue.ts`, base-SI +
   `display`), it carries downstream through passthroughs/selectors and DROPS at a
   transform on its own — there is no graph unit-walk.

   **Unit lock states (firstClassUnits — a unit is first-class like the magnitude).** Who
   owns the FC's unit dropdown (`formatController.ts` `data()` lock block):
   - **authored** (`← →`) — the incoming value carries no unit; the FC's pick
     authors it. The only editable state.
   - **forwarding** (`→ →`) — the value arrives already united (set elsewhere in
     the chain); the dropdown MIRRORS it and LOCKS. This FC never re-authors
     over it.
   - **lockedByConvert** (`← ←`) — a downstream Convert's `fromUnit` dictates
     the unit; locked.

   `unitLocked = lockedByConvert || forwarding`; the popup renders the dropdown
   present-but-disabled under a lock (`disabled={node.unitLocked}`) — the value
   HAS a unit, so the control shows it; it just isn't this FC's to change. The rest of this pipeline
   (style / precision / negatives / K-M-B) stays a DISPLAY annotation, and it FLOWS
   DOWNSTREAM through transforms of the same element family, minus the unit, until a
   nearer FC overrides it (rules.md formatFlowsDownstream). So the unit computes and
   clashes honestly; the number format is pure presentation, inherited and overridable.
4. **Text attributes.** Case / bold / italic / size apply as display-only
   transforms (the underlying value is never mutated). Text family only.

Short-circuits before stage 2: `SolError` → red badge, `null` → placeholder,
non-finite number → `String(n)`. These outrank any annotation.

## Format families

`familyOf(socketDataType)`:

| family | socket types (all four rungs per family) |
|---|---|
| `number` | `number`, `list`, `numlist`, `table`, plus `anytable` (numeric cells) |
| `date` | `date`, `datelist`, `datecombo`, `datetable` |
| `text` | `string`, `strlist`, `strcombo`, `strtable` |
| `logical` | `logical`, `logicallist`, `logicalcombo`, `logicaltable` |
| `complex` | `complex`, `complexlist`, `complexcombo`, `complextable` |
| `lambda` | `lambda` — display-only view-as for a flowing LambdaValue |
| `chart` | `chart` — display-only text scale for a flowing chart figure |
| `number` (provisional) | the wildcard rungs — an FC attached to an unresolved passthrough shows number controls until a concrete type flows in and re-adapts it. `trueany` is the FC's own default/reset type, and it is what the FC resolves to against ANY family-less rung: adoption never lands the FC on a family-less rung (the settle routes family resolution through `isWildcardRung`), so every wildcard leaves the FC provisional. NOTE the `familyOf` MAP itself is narrower: it returns `number` only for `any`/`trueany`/`anytable` (pinned in `formatModel.test.ts`) and `none` for `anylist`/`anycombo`/`anydata` — the FC never consults it for those because adoption already refused them |
| `none` | everything else — `frame`, `cube`, `document`: resolved types that genuinely carry no element family (so no controls), as opposed to the wildcard rungs above, which carry no ANSWER yet |

Lists/matrices format PER CELL with the one annotation (the array-semantics model:
`null` and `SolError` cells short-circuit per cell). Frames are `none` in this
model — per-column units/formats are a SEPARATE representation, not a scalar
annotation stretched over a table: `ColumnUnit` on `FrameColumn.unit`
(`unitColumn.ts`), authored by a header spec or the table popup's per-column
format+unit row. A COMPUTED column keeps its authored unit the same way — the
source column's unit tag rides onto the derived column (`nodes/frame.ts`), gated
on the derived cells inferring as `number`: a computed column whose cells come
out non-numeric silently drops its authored unit.

The per-column FORMAT rides `FrameColumn.format` downstream exactly like the unit
(formatFlowsDownstream): the coercion wrapper's OUTPUT step (`coerceInputs.ts`)
stamps every emitted frame with that node's own `frameFormatStore` picks, and the
nearer node's pick overrides what arrived. `frameFormatStore` stays the one
PERSISTED home, keyed by the node that picked — `format` is derived per compute
and never serialized. A column BUILT by a verb carries a source column's format
only where that verb already carries its unit (nest, the Allocator's Allocation);
every other derived column starts blank. In the popup, a column with no entry of
its own reads `—` (inherit) with the arriving format as a muted hint beside it,
and every concrete style — `auto` included — is a real local override that
deletes back to `—` (`columnFormatRow`, `frameFormatStore.ts`).

**Every family's primary style dropdown carries the SAME `—` pick** (`inheritFormat`) —
the number/complex/date format dropdown, the text case dropdown, and the logical show-as
dropdown: with it, the FC carries the display format arriving at `in` through unchanged
(style + precision + advanced tier, or case / show-as) and authors its own unit alone, so
a second FC docked only for a unit no longer resets the style to `auto`
(formatFlowsDownstream). While inheriting, the FC's own dependent rows collapse to the
column row's muted hint — `← Decimal · 3 places` for a number, `← UPPER` / `← Yes / No`
for text / logical (`describeInheritedStyle`, per family, in the column row's words).
`FormatControllerNode.resolveAnnotation(inherited)` does the merge (own `unit`/`customUnit`,
every display axis from upstream); `makeAnnotationResolver.compute` calls it in place of
`annotation()`, so the carried-downstream and box-behind paths agree. The node's `format`
field stays a concrete `FormatStyleId` — `inheritFormat` is the separate flag, and `""` is
the dropdown's inherit value.

## The control truth table

Which controls exist per family (popup rows AND resolution axes):

| control | number | date | text | logical | complex |
|---|---|---|---|---|---|
| number style dropdown | ✔ all styles | — | — | — | ✔ reduced: `auto` / `decimal` / `scientific` |
| precision row (digits + places\|sig figs) | per style, see rule | — | — | — | per style (both components) |
| unit dropdown | ✔ (disabled under a lock state — see the unit lock states above) | — | — | — | ✔ (same) |
| date style dropdown | — | ✔ | — | — | — |
| custom pattern field | when style = `custom` | when style = `date_custom` | — | — | — |
| case (Aa) | — | — | ✔ | — | — |
| bold / italic / size | — | — | ✔ | — | — |
| show-as (logical) | — | — | — | ✔ | — |
| **advanced tier** (behind the chip's expander): | | | | | |
| · 1,000 separator toggle | `decimal` / `integer` / `percent` | — | — | — | — |
| · negative style (−1,234 · (1,234) · red · red parens) | every style but `custom` (the pattern owns its own form) | — | — | — | — |
| · scale (K / M / B) | `decimal` / `integer` only — scaling a percent or a mantissa is nonsense | — | — | — | — |
| · alignment (L / C / R) | — | — | ✔ (box is right-aligned by default) | — | — |
| · render as markdown | — | — | ✔ (inline markdown, sanitized) | — | — |
| · monospace | — | — | ✔ (text is sans by default) | — | — |

The two object families each carry exactly ONE control (not in the matrix above —
they'd be a column of dashes):

| family | control | values |
|---|---|---|
| `lambda` | view-as dropdown (`lambdaView`) | `signature` (default, λ(params)) · `katex` (f(params) = … equation) · `syntax` (highlighted formula) · `mono` (monospace source) |
| `chart` | text scale dropdown (`chartFontScale`) | ×0.8 · ×1 (default) · ×1.25 · ×1.5 · ×2 — multiplies every text size in the figure (axis ticks, title, labels, KPI digits), composing with the value's own `fontsize` option (matplotlib points, 10 = built-in) |

Both are display-only and ride the annotation exactly like `logicalStyle`. The
lambda's SOURCE node keeps its compact signature box regardless (the view-as
applies downstream — Display boxes, Report embeds — not to the authoring card;
a Report embed's default stays KaTeX). The flowing `LambdaValue` already
carries `expr`/`params`/`descriptions`, so every view derives from the value —
nothing extra travels the cable.

Notes:
- **Percent takes a unit** like any other number style. Rendering order is fixed:
  prefix-unit, formatted number (with its `%`), suffix-unit — `$12.3%` is
  expressible but the user chose it; the model doesn't special-case it.
- **Logical "show-as"** is new (`logicalStyle`): `TRUE/FALSE` (default, the Excel
  form) · `1/0` · `Yes/No` · `✓/✗`. Display-only, applied wherever a boolean
  renders through an annotation.
- **Complex** — WIRED END TO END (2026-08-01). `formatCxWithAnnotation` is the
  render half; the popup half (`controlsFor` + `COMPLEX_FORMAT_STYLES` gating the
  dropdown to auto/decimal/scientific, plus the precision and unit rows) was
  already done. Three rules, each forced by a complex having two components and
  one sign structure:
  - **Precision applies to BOTH components** — `3.14 + 2.72i` at 2 places, never
    one formatted and the other trimmed.
  - **The style list is reduced**: percent/fraction/integer/custom and the date
    styles are meaningless on a complex, so they aren't offered — and an
    annotation still carrying one (from before the socket was retyped) falls back
    to `auto` rather than rendering nonsense.
  - **The unit wraps the WHOLE value**: `(3 + 2i) V`, never `3 V + 2i V`.
    Parenthesised only in the two-term form, where `3 + 2i V` would read as the
    unit attaching to the imaginary term alone.
  The advanced tier (grouping/negative/scale) is number-and-text only per
  `controlsFor` and is deliberately not consulted: a complex has no single sign
  to parenthesise and no magnitude to scale. A `Cx` reaches the value box RAW —
  the display layer formats it, so the annotation can act (cards that
  pre-formatted in their own components were exactly why it never could).
  `assembleCx` (cxValue.ts) owns the written form for both formatters.
- **Advanced-tier composition order** (2026-07-05): scale divides the magnitude
  and appends its suffix inside the number (`1.2M`); the unit wraps that
  (`$1.2M`); a paren negative wraps OUTSIDE the unit, Excel accounting style
  (`($1.2M)`). "Red" negative styles keep the minus/parens string form — the red
  is a render-layer color (`annotationRendersNegativeRed`), applied where a
  surface is annotation-aware (the value box); plain-text surfaces (clipboard,
  text form) just carry the string.

## The precision × style resolution rule

One rule, one implementation (the private `formatPrecise` in
`formatAnnotationStore.ts`), consumed by every style that supports precision —
except `scientific`, which computes its own mantissa digit count inline (same
semantics, own arithmetic). `decimalDigits` (`d`) + `decimalMode` (`places` | `sigfigs`):

| style | `places` mode | `sigfigs` mode | precision row shown? |
|---|---|---|---|
| `auto` | — canonical trim (≈6 sig figs), no knobs | — | no |
| `decimal` | exactly `d` fraction digits, grouped | exactly `d` significant digits, grouped | yes |
| `integer` | fixed: 0 fraction digits, grouped | — (mode inert) | no |
| `percent` | ×100, then exactly `d` fraction digits, `%` | ×100, then `d` significant digits, `%` | yes |
| `scientific` | mantissa with `d` fraction digits (`toExponential(d)`) | `d` significant mantissa digits (`toExponential(d−1)`) | yes |
| `fraction` / `fraction_adv` | — internal tolerance/denominator caps own the precision | — | no |
| `custom` | — the pattern owns precision | — | no |
| pack formats | — the pack's `apply` owns everything | — | no |

Clamps: the resolver takes `places` 0–20, `sigfigs` 1–21 — but the FC popup caps
the digits box at 20 in BOTH modes, so 21 significant figures is unreachable from
the control; switching to `sigfigs` bumps 0 → 1.

**Behavior change vs today** (deliberate, per this model): `scientific` previously
ignored precision entirely (hardcoded `toExponential(3)`). It now honors the
precision row (default `d = 2` places → `1.23e+4`). Pre-alpha: tests updated, no
compat shim.

## Where the model is enforced

- `formatModel.ts` — `familyOf`, `controlsFor(family, style)`,
  `precisionApplies(style)`: the single source for both the popup and resolution.
  `formatModel.test.ts` sweeps `familyOf` + `precisionApplies` exhaustively; the
  advanced-tier predicates (`groupingApplies`/`scaleApplies`/`negativeApplies`)
  are only spot-checked behaviorally in `formatAnnotationStore.test.ts` — their
  per-style rows here are UNENFORCED as a table.
- `applyFormatStyle` — style cases delegate precision to the shared resolver
  (`scientific` carries its own inline digit clamp — the one exception).
- `FormatControllerNode.tsx` — renders rows strictly off `controlsFor` (including
  the custom-pattern field, `customPattern`); no inline `isDate`/`isText`/
  `format === "decimal"` gates. The unit dropdown's `disabled` under a lock state
  is the one sanctioned non-`controlsFor` modifier (presence is still the
  family's call; only editability is the lock's).
- Render surfaces — every one asks ONE question, `resolveDisplayAnnotation(nodeId,
  socketKey?)` (`valueDisplayFormat.ts`: direct FC ?? carried `outAnnotation` ??
  trailing-FC `downstreamAnnotation`, on the owning editor): `ValueDisplay` (any card,
  scalars and list cells), `InlineOutputRows` (per socket), `DisplayNode` + `TableDisplay`
  (matrix cells), `inlineRefDisplay` (Note/Report refs), `CableInspector`, `PinLayer`,
  the collapsed-group readouts. Booleans route through `applyLogicalStyle`, text through
  `applyTextCase`, numbers through `formatNumberWithAnnotation` (the single entry); a
  `UnitCell` under an annotation whose `unit` is `none` keeps the CELL's own display unit
  (`annotationForValue`) — the annotation supplies the style, the value owns the unit.
  Frames/cubes and the table popup grid stay per-column (a separate representation).
  Pinned by `valueDisplayAnnotation.test.ts`.

## Non-goals (this spec deliberately excludes)

- **The FC visual redesign** — A2 renders this matrix; the matrix doesn't dictate
  pixels.
- **Number styles for logical/text** (e.g. formatting `1/0` coerced from TRUE) —
  the type gate is strict; Cast first if you want number formatting.
- **Locale switching** — everything uses the host locale via `toLocaleString`, as
  today.
