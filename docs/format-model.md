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
   below). A control outside the family is HIDDEN in the popup and INERT in
   resolution — never disabled-but-visible, never silently applied.
2. **Style.** The numeric magnitude renders per the format style, with precision
   resolved by ONE shared rule (below) — no per-style private precision logic.
   Dates render via their pattern instead; text/logical skip this stage.
3. **Unit affix.** The unit label wraps the formatted string (prefix for
   currencies, suffix otherwise). Number-family only; a date/text/logical value
   never takes a unit. Orthogonal to style — every number style accepts a unit
   (the unit is a property of the VALUE and a cable constraint, not display sugar).
4. **Text attributes.** Case / bold / italic / size apply as display-only
   transforms (the underlying value is never mutated). Text family only.

Short-circuits before stage 2: `SolError` → red badge, `null` → placeholder,
non-finite number → `String(n)`. These outrank any annotation.

## Format families

`familyOf(socketDataType)`:

| family | socket types |
|---|---|
| `number` | `number`, `list`, `combo`, `matrix`, `anytable` (numeric cells) |
| `date` | `date`, `datelist` |
| `text` | `string`, `strlist` |
| `logical` | `logical`, `logicallist`, `logicalcombo`, `logicaltable` |
| `complex` | `complex`, `complexlist` |
| `number` (provisional) | `any` — an FC docked to an unresolved passthrough shows number controls until a concrete type flows in and re-adapts it |
| `none` | everything else (`frame`, `cube`, `chart`, `lambda`, …) |

Lists/matrices format PER CELL with the one annotation (the array-semantics model:
`null` and `SolError` cells short-circuit per cell). Frames are `none` in this
model — per-column units/formats are v1.1 A4 (units by dimensionality), a separate
representation, not a scalar annotation stretched over a table.

## The control truth table

Which controls exist per family (popup rows AND resolution axes):

| control | number | date | text | logical | complex |
|---|---|---|---|---|---|
| number style dropdown | ✔ all styles | — | — | — | ✔ reduced: `auto` / `decimal` / `scientific` |
| precision row (digits + places\|sig figs) | per style, see rule | — | — | — | per style (both components) |
| unit dropdown | ✔ | — | — | — | ✔ |
| date style dropdown | — | ✔ | — | — | — |
| custom pattern field | when style = `custom` | when style = `date_custom` | — | — | — |
| case (Aa) | — | — | ✔ | — | — |
| bold / italic / size | — | — | ✔ | — | — |
| show-as (logical) | — | — | — | ✔ | — |
| **advanced tier** (behind the chip's expander): | | | | | |
| · 1,000 separator toggle | `decimal` / `integer` / `percent` | — | — | — | — |
| · negative style (−1,234 · (1,234) · red · red parens) | every style but `custom` (the pattern owns its own form) | — | — | — | — |
| · scale (K / M / B) | `decimal` / `integer` only — scaling a percent or a mantissa is nonsense | — | — | — | — |

Notes:
- **Percent takes a unit** like any other number style. Rendering order is fixed:
  prefix-unit, formatted number (with its `%`), suffix-unit — `$12.3%` is
  expressible but the user chose it; the model doesn't special-case it.
- **Logical "show-as"** is new (`logicalStyle`): `TRUE/FALSE` (default, the Excel
  form) · `1/0` · `Yes/No` · `✓/✗`. Display-only, applied wherever a boolean
  renders through an annotation.
- **Complex** applies the precision rule to BOTH components (`3.14+2.72i` at
  2 places). Percent/fraction/integer are meaningless on a complex value → not
  offered. (Implementation may lag the spec here; the popup must still gate to the
  reduced style list from day one.)
- **Advanced-tier composition order** (2026-07-05): scale divides the magnitude
  and appends its suffix inside the number (`1.2M`); the unit wraps that
  (`$1.2M`); a paren negative wraps OUTSIDE the unit, Excel accounting style
  (`($1.2M)`). "Red" negative styles keep the minus/parens string form — the red
  is a render-layer color (`annotationRendersNegativeRed`), applied where a
  surface is annotation-aware (the value box); plain-text surfaces (clipboard,
  text form) just carry the string.

## The precision × style resolution rule

One rule, one implementation (`resolvePrecision`), consumed by every style that
supports precision. `decimalDigits` (`d`) + `decimalMode` (`places` | `sigfigs`):

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

Clamps (unchanged): `places` → 0–20, `sigfigs` → 1–21; switching to `sigfigs`
bumps 0 → 1.

**Behavior change vs today** (deliberate, per this model): `scientific` previously
ignored precision entirely (hardcoded `toExponential(3)`). It now honors the
precision row (default `d = 2` places → `1.23e+4`). Pre-alpha: tests updated, no
compat shim.

## Where the model is enforced

- `formatModel.ts` — `familyOf`, `controlsFor(family, style)`,
  `precisionApplies(style)`: the single source for both the popup and resolution.
- `applyFormatStyle` — style cases delegate precision to the shared resolver;
  no case carries private digit logic.
- `FormatControllerNode.tsx` — renders rows strictly off `controlsFor`; no inline
  `isDate`/`isText`/`format === "decimal"` gates.
- Render surfaces (`ValueDisplay`, `DisplayNode`, `CableInspector`,
  `inlineRefDisplay`, Report embeds) — booleans route through
  `applyLogicalStyle` when an annotation is present; numbers keep routing through
  `formatNumberWithAnnotation` (already the single entry).

## Non-goals (this spec deliberately excludes)

- **Per-column / per-element units** — A4's representation problem.
- **The FC visual redesign** — A2 renders this matrix; the matrix doesn't dictate
  pixels.
- **Number styles for logical/text** (e.g. formatting `1/0` coerced from TRUE) —
  the type gate is strict; Cast first if you want number formatting.
- **Locale switching** — everything uses the host locale via `toLocaleString`, as
  today.
