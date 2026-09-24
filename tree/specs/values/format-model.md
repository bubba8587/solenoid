---
aliases: ["Format model"]
tags: [spec, values]
---
<!-- [[C94]] formatFamilyGates, [[C25]] firstClassUnits, [[D40]] unitOnValue, [[D41]] formatFlowsDownstream, [[D47]] noMixCurrencies, [[C44]] dateSerials, [[C79]] packActivationIsPresentation -->

# Spec: Format model

Serves [[C94]] formatFamilyGates, with the unit rules of [[C25]] firstClassUnits and [[D40]] unitOnValue and the downstream carry of [[D41]] formatFlowsDownstream. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

A **Format Controller** (FC) is the small card that docks on a socket and decides how the value there is displayed: its style, precision, negatives, scale, text attributes and unit. This file is the model it follows. `formatModel.ts` says which controls exist for which value; `formatAnnotationStore.ts` renders a number under a format and stores what each FC has set; `nodes/formatController.ts` is the FC card itself. The FC popup shows and hides its controls from the same model, so what renders and what the popup offers can't disagree. How a format travels along the cables is [[unit-flow]].

## The pipeline

A displayed value goes through these stages, in order, each driven by one part of the `FormatAnnotation`:

```
value ──▶ 1 type gate ──▶ 2 style (scale-divide, then precision + grouping) ──▶ 3 unit affix ──▶ 3b negative wrap ──▶ 4 text attributes
```

1. **Type gate.** The FC's adopted socket type maps to a **format family** (`familyOf`), and the family decides which controls exist at all (the truth table below). A control outside the family is hidden in the popup and inert when the format resolves: never disabled but visible, and never silently applied. The one sanctioned disabled-but-visible control is inside a family: the unit dropdown under a lock state (below). Locked is a fact worth showing; absent is not.
2. **Style.** The number renders in the chosen style, with precision set by one shared rule (below) and no precision logic private to a style. Dates render through their pattern instead; text and logical values skip this stage.
3. **Unit affix.** The unit label wraps the formatted string: a prefix for currencies, a suffix otherwise. Only the number and complex families take a unit; a date, text or logical value never does. The unit is independent of style, so every number style accepts one.
   - **3b. Negative wrap.** A parenthesized negative style wraps outside the unit.
4. **Text attributes.** Case, bold, italic and size apply to text only, as display transforms; the value itself is never changed.

Three cases short-circuit before stage 2 and outrank any annotation: a `SolError` shows the red badge, `null` shows the placeholder, and a non-finite number shows `String(n)`.

### The unit is value-level; the format is display-level

For the unit, the FC changes the value: `FormatControllerNode.data()` tags the value's `UnitCell` through `applyFcUnit` ([[D40]] unitOnValue). As a user-facing tool, though, the FC can set a unit only on a value that has none ([[C25]] firstClassUnits); re-displaying a value that already has a dimension is Convert's job. Because the unit rides the value, it carries through passthroughs and selectors and drops at a transform on its own. The branches of `applyFcUnit` and the three lock states are in [[unit-flow]]:

| Lock state | Marker | Meaning |
|---|---|---|
| authored | `← →` | this FC set the unit |
| `forwarding` | `→ →` | the incoming value already has a unit, which the dropdown mirrors |
| `lockedByConvert` | `← ←` | a Convert this FC feeds dictates the unit |

`unitLocked = lockedByConvert || forwarding`. Under a lock the popup shows the unit dropdown present but disabled (`disabled={node.unitLocked}`): the value has a unit, so the control shows it, but it isn't this FC's to change.

Everything else in the pipeline (style, precision, negatives, K / M / B) stays a display annotation. It flows downstream through the transforms a node declares meaning-preserving (add and subtract, a mean, a rounding; not multiply, count or a rate), minus the unit, until a nearer FC overrides it ([[D41]] formatFlowsDownstream). So the unit computes and clashes honestly, while the number format is pure presentation, inherited and overridable.

## Format families

`familyOf(socketDataType)`:

| Family | Socket types |
|---|---|
| `number` | `number`, `list`, `numlist`, `table`, plus `anytable` (numeric cells) |
| `date` | `date`, `datelist`, `datecombo`, `datetable` |
| `text` | `string`, `strlist`, `strcombo`, `strtable` |
| `logical` | `logical`, `logicallist`, `logicalcombo`, `logicaltable` |
| `complex` | `complex`, `complexlist`, `complexcombo`, `complextable` |
| `lambda` | `lambda`: a display-only view-as for a flowing `LambdaValue` |
| `chart` | `chart`: a display-only text scale for a flowing chart figure |
| `number`, provisionally | the wildcard rungs (below) |
| `none` | everything else: `frame`, `cube`, `document`, resolved types that carry no element family and so get no controls |

**The wildcard rungs.** An FC attached to an unresolved passthrough shows number controls until a concrete type flows in and `fcReconcile` re-adapts it. `trueany` is the FC's own default and reset type, and it is what the FC resolves to against any family-less rung: adoption never lands an FC on a family-less rung (the settle resolves families through `isWildcardRung`), so every wildcard leaves the FC provisional. The `familyOf` map itself is narrower: it answers `number` only for `any`, `trueany` and `anytable` (pinned in `formatModel.test.ts`) and `none` for `anylist`, `anycombo` and `anydata`. The FC never asks it about those, because adoption has already refused them.

**Lists and matrices** format per cell with the one annotation, and `null` and `SolError` cells short-circuit per cell ([[C24]] arraySemantics).

**Frames** are `none` in this model. A Frame's per-column unit and format are a separate representation, not a scalar annotation stretched over a table:

- The unit is a `ColumnUnit` on `FrameColumn.unit` (`unitColumn.ts`), authored by a header spec or the table popup's per-column format and unit row. A computed column keeps its source column's unit the same way (`nodes/frame.ts`), but only when the derived cells infer as `number`; a computed column whose cells come out non-numeric drops the unit silently.
- The format rides `FrameColumn.format` downstream exactly like the unit ([[D41]] formatFlowsDownstream). The coercion wrapper's output step (`coerceInputs.ts`) stamps every emitted Frame with that node's own `frameFormatStore` picks, and the nearer node's pick overrides what arrived. `frameFormatStore` is the one saved home, keyed by the node that picked; `format` is worked out on every compute and never saved.
- A column a verb builds carries a source column's format only where that verb already carries its unit (nest, the Allocator's Allocation); every other derived column starts blank.
- In the popup, a column with no entry of its own reads `—` (inherit), with the arriving format as a muted hint beside it. Every concrete style, `auto` included, is a real local override that deletes back to `—` (`columnFormatRow`, `frameFormatStore.ts`).
- A **Cube** column carries the same optional `format` (`CubeColumn.format`), which the cube renderers read like the Frame path (`formatFrameCell`'s `format` argument, threaded through `cubeCell.tsx` from `CubeDisplay` and `CubePopup`). A producing verb may author one: the Schedule verb stamps the app's datetime pattern (`DD-MMM-YYYY HH:mm`) on its Start, Finish, Early and Late date columns in Minutes mode, so a `13:00` start shows its clock time; Days mode leaves them blank. Like the nest and Allocator carry, this is a verb authoring a fresh format.

## Inheriting the format (`—`)

Every family's primary style dropdown has the same `—` pick (`inheritFormat`): the number, complex and date format dropdown, the text case dropdown and the logical show-as dropdown. With it, the FC carries the display format arriving at `in` through unchanged (style, precision and the advanced tier, or case, or show-as) and authors only its unit. So a second FC docked only to set a unit doesn't reset the style to `auto` ([[D41]] formatFlowsDownstream).

- While inheriting, the FC's own dependent rows collapse to the column row's muted hint: `← Decimal · 3 places` for a number, `← UPPER` or `← Yes / No` for text or logical (`describeInheritedStyle`, per family, in the column row's words). The hint text comes from one function, `describeAnnotation(ann, type)` in `frameFormatStore.ts`, which both the frame column-format row and the FC's inherit hint call (`FormatControllerNode.describeInheritedStyle` delegates to it), so the two never drift. It reads the logical show-as label for a logical column, `Chip` or the text-case label for a string column, and for a number the style label plus `· <n> place(s)` or `· <n> sig fig(s)` when precision applies (default 2).
- `FormatControllerNode.resolveAnnotation(inherited)` does the merge: the FC's own `unit` and `customUnit`, every display axis from upstream. `makeAnnotationResolver.compute` calls it in place of `annotation()`, so the carried-downstream and box-behind paths agree.
- The node's `format` field stays a concrete `FormatStyleId`; `inheritFormat` is a separate flag, and `""` is the dropdown's inherit value. The inherited annotation (`inheritedAnnotation`) is recomputed on every `refreshAnnotation` and never saved.

## The control truth table

Which controls exist per family, both as popup rows and as resolution axes (`controlsFor(family, style)`):

| Control | number | date | text | logical | complex |
|---|---|---|---|---|---|
| number style dropdown | ✔ all styles | — | — | — | ✔ reduced: `auto`, `decimal`, `scientific` |
| precision row (digits, and places or sig figs) | per style, see the rule | — | — | — | per style, both components |
| unit dropdown | ✔ (disabled under a lock state) | — | — | — | ✔ (the same) |
| date style dropdown | — | ✔ | — | — | — |
| custom pattern field | when style is `custom` | when style is `date_custom` | — | — | — |
| case (Aa) | — | — | ✔ | — | — |
| bold, italic, size | — | — | ✔ | — | — |
| show-as | — | — | — | ✔ | — |
| **advanced tier** (behind the chip's expander): | | | | | |
| · 1,000 separator toggle | `decimal`, `integer`, `percent` | — | — | — | — |
| · negative style (−1,234 · (1,234) · red · red parens) | every style but `custom`, whose pattern owns its negative form | — | — | — | — |
| · scale (K / M / B) | `decimal` and `integer` only; scaling a percent or a mantissa is nonsense | — | — | — | — |
| · alignment (L / C / R) | — | — | ✔ (the box is right-aligned by default) | — | — |
| · render as markdown | — | — | ✔ (inline markdown, sanitized) | — | — |
| · monospace | — | — | ✔ (text is sans by default) | — | — |

The text case dropdown's **Chip** value colors each distinct string by category, with the shared chart palette and one `CategoryChip`, keyed by first appearance in source row order. It shares the text style dropdown, so it excludes a case pick. The on-canvas grid, read-only popups and an editable popup cell all render the pill; an editable cell shows the pill while unfocused and swaps to the raw text on focus, and Source mode keeps raw text throughout.

The two object families each carry exactly one control:

| Family | Control | Values |
|---|---|---|
| `lambda` | view-as dropdown (`lambdaView`) | `signature` (default, λ(params)) · `katex` (the f(params) = … equation) · `syntax` (the highlighted formula) · `mono` (monospace source) |
| `chart` | text scale dropdown (`chartFontScale`) | ×0.8 · ×1 (default) · ×1.25 · ×1.5 · ×2; multiplies every text size in the figure (axis ticks, title, labels, KPI digits), composing with the value's own `fontsize` option (matplotlib points, 10 = built-in) |

Both are display-only and ride the annotation like `logicalStyle`. The lambda's source node keeps its compact signature box regardless: view-as applies downstream (Display boxes, Report embeds), not on the authoring card, and a Report embed's default stays KaTeX. The flowing `LambdaValue` already carries `expr`, `params` and `descriptions`, so every view derives from the value and nothing extra travels the cable.

## Styles

`FormatStyle` is the built-in set; `FormatStyleId` also accepts a pack format's id.

| Style | Renders | Notes |
|---|---|---|
| `auto` | canonical trim | `extremeSci` (`format.ts`) forces scientific for extreme magnitudes; an integer prints as is; anything else is `toPrecision(6)` with trailing zeros dropped |
| `decimal` | `d` places or `d` significant figures, grouped | |
| `integer` | `1,235` | rounded, grouped |
| `percent` | ×100, then `d` places or significant figures, then `%` | |
| `fraction` | `1/3`, `2 1/4` | the best rational with denominator at most 99, by continued-fraction convergents; shown only when it matches within 1e-9, else `auto` |
| `fraction_adv` | `π/2`, `3π/2`, `e/4` | a rational multiple (denominator at most 36) of π, e, √2, √3, √5, φ or π², within a relative 1e-6 (so `1.570796` reads as π/2); the smallest denominator wins; otherwise `fraction` |
| `scientific` | `1.23e+4` | see the precision rule |
| `custom` | a minimal Excel-style pattern | `0`, `#`, `.` and `,`: the digits after `.` set the fraction digits and a `,` turns on grouping; the default pattern is `0.00` |
| `date_dmy` | `03-Jun-2026` | `DD-MMM-YYYY`, the app default ([[C44]] dateSerials) |
| `date_iso` | `2026-06-03` | `YYYY-MM-DD` |
| `date_us` | `6/3/2026` | `M/D/YYYY` |
| `date_long` | `June 3, 2026` | `MMMM D, YYYY` |
| `date_med` | `Jun 3, 2026` | `MMM D, YYYY` |
| `date_dow` | `Wed, Jun 3, 2026` | `DDD, MMM D, YYYY` |
| `time_24` | `14:30` | `HH:mm` |
| `time_12` | `2:30 PM` | `h:mm A` |
| `datetime` | `2026-06-03 14:30` | `YYYY-MM-DD HH:mm` |
| `date_custom` | the FC's `customPattern` | `DD-MMM-YYYY` when blank |

The number dropdown groups the styles as General (`auto`), Number (`decimal`, `integer`, `fraction`, `fraction_adv`, `scientific`), Percent and Custom. Currency is a unit, not a style ([[D47]] noMixCurrencies). A date style renders the value as a date serial through `formatDateSerial`, with no unit; `dateAnnotationPattern` gives the pattern, and the Frame and Cube cell renderers read it so a column's `format` changes its date cells.

A style id that is not built in is looked up among the **pack formats**, whose `apply` owns the whole rendering; an unknown id falls back to `auto`. Pack units and formats register for every known pack, active or not ([[C79]] packActivationIsPresentation); `fcExtensions.ts` filters the dropdowns to active packs. `registerPackFormats` takes an id, a label, an optional dropdown group (default "Pack") and `apply`.

### Rendering order

`formatNumberWithAnnotation(n, ann)` is the one entry for a number:

1. A non-finite number is `String(n)`; a date style renders as a date and stops.
2. Scale divides the magnitude (only where `scaleApplies`), and a parenthesized negative style (only where `negativeApplies`) takes the absolute value.
3. The style formats the magnitude, with grouping on unless `groupingApplies` and `grouping` is `false`; the scale suffix (`K`, `M`, `B`) follows inside the number (`1.2M`).
4. The unit wraps that: a prefix unit before (`$1.2M`), any other after, and a custom unit's text after.
5. A parenthesized negative wraps outside the unit, Excel accounting style (`($1.2M)`).

The red negative styles keep the minus or parentheses in the string: red is a color the render layer adds (`annotationRendersNegativeRed`) where a surface is annotation-aware, such as the value box. Plain-text surfaces (the clipboard, the text form) carry just the string. Percent takes a unit like any other style, in the fixed order prefix unit, number with its `%`, suffix unit; `$12.3%` is expressible if the user chooses it, and the model doesn't special-case it.

### Logical and text

- **Show-as** (`logicalStyle`, `applyLogicalStyle`): `TRUE/FALSE` (default, the Excel form) · `1/0` · `Yes/No` · `✓/✗`, applied wherever a boolean renders through an annotation.
- **Case** (`applyTextCase`): as-is, UPPER, lower or Proper. `textScale` multiplies the font size (1 is normal).

### Complex

`formatCxWithAnnotation` is the render half, and `controlsFor` with `COMPLEX_FORMAT_STYLES` gates the popup. Three rules follow from a complex number having two components and one sign structure:

- **Precision applies to both components**: `3.14 + 2.72i` at 2 places, never one formatted and the other trimmed. Under `auto` each component keeps the plain trim (an integer as is, otherwise four decimals with trailing zeros dropped); the FC annotates rather than overrides.
- **The style list is reduced.** Percent, fraction, integer, custom and the date styles mean nothing on a complex, so they aren't offered, and an annotation that still carries one (it can survive a socket retype) falls back to `auto`.
- **The unit wraps the whole value**: `(3 + 2i) V`, never `3 V + 2i V`, and `3 + 2i V` would read as the unit on the imaginary term alone. A prefix unit still leads, as on the number path.

The advanced tier is not consulted: a complex has no single sign to parenthesize and no magnitude to scale. A `Cx` reaches the value box raw and the display layer formats it, which is what lets the annotation act. `assembleCx` (`cxValue.ts`) owns the written form, and its `bothParts` flag splits two forms. The **display form** always shows both components (`0 + 4i`, `23 + 0i`), through `formatCxDisplay` and `formatCxWithAnnotation`, in the value box, chips, readouts and the clipboard, so a unit always wraps a two-term value. The **Excel and coercion form** (`formatCx`, the `&` operator, cast to text, the `IM*` functions) drops a zero component (`23`, `4i`) for Excel parity and round-trips with `parseCx`.

## The precision rule

One rule and one implementation, the private `formatPrecise` in `formatAnnotationStore.ts`, used by every style that takes precision. The exception is `scientific`, which works out its own mantissa digits inline with the same meaning. The inputs are `decimalDigits` (`d`) and `decimalMode` (`places` or `sigfigs`):

| Style | `places` | `sigfigs` | Precision row shown? |
|---|---|---|---|
| `auto` | the canonical trim, no knobs | — | no |
| `decimal` | exactly `d` fraction digits, grouped | exactly `d` significant digits, grouped | yes |
| `integer` | fixed: 0 fraction digits, grouped | — (the mode is inert) | no |
| `percent` | ×100, then exactly `d` fraction digits, `%` | ×100, then `d` significant digits, `%` | yes |
| `scientific` | a mantissa with `d` fraction digits (`toExponential(d)`) | `d` significant mantissa digits (`toExponential(d − 1)`) | yes |
| `fraction`, `fraction_adv` | their own tolerance and denominator caps | — | no |
| `custom` | the pattern owns precision | — | no |
| pack formats | the pack's `apply` owns everything | — | no |

The resolver clamps `places` to 0–20 and `sigfigs` to 1–21, but the FC popup caps the digits box at 20 in both modes, so 21 significant figures is unreachable from the control; switching to `sigfigs` bumps 0 to 1. The default is `d = 2` places, so `scientific` shows `1.23e+4`.

## Units on the FC

`UNIT_ANNOTATIONS` is the FC's unit list, each with an id, a display label (`" km"`, `"°"`, `"$"`), a group and, for currencies, `prefix`. The groups are angle (°, rad, grad), length (m, km, cm, mm, in `"`, ft `'`, mi), mass (kg, g, mg, lb, oz), temperature (°C, °F, K), time (s, ms, min, hr, day), area (m², km², ha, ft², ac), volume (m³, L, mL, gal), speed (m/s, km/h, mph), data (B, KB, MB, GB, TB), currency ($, €, £, ¥) and custom, plus `none`. A pack can add units (`registerPackUnits`, into an existing group or a new one with its own `groupLabel`).

- `unitById` falls back to `none` for an unknown id; `isFcUnit` says whether an id is an FC unit, which is how Convert's units map onto FC units.
- `unitsCompatible(a, b)` is true when either side is `none` or custom, or both share a group. `formatMismatchStore` holds the FCs in a "unit mismatch" state (cabled to a socket annotated with an incompatible unit group); the canvas connection pipe writes it.

## The annotation store

`formatAnnotationStore` holds each FC's annotation, keyed `nodeId::socketKey`, with a per-node index because every value box calls `getForNode` on every render. A node carries at most one FC, so `getForNode` answers the annotation on any of its sockets. `clearNodes` resets node state but leaves the pack unit and format registrations, which are extensions, not node state. The store registers its forgetters with the node-store registry ([[stores#The rules]]).

## The FC card (`nodes/formatController.ts`)

- **Type.** `adaptTypeFromConnections` adopts the concrete type the FC is attached to: for a docked FC, the host's output type resolved upstream through wildcard passthroughs (`concreteTypeOfOutput`, cycle-guarded) or the host input's own type; for a free FC, the first concrete type on the cable into `in` or the socket its `out` feeds; otherwise `trueany`. It mirrors the type onto both of its own sockets, which it owns ([[socket-lattice#Each port owns its socket instance]]), and returns `false` without re-rendering when nothing changed.
- **The pick survives a retype.** Changing the type never touches `format`. `effectiveFormat()` is the style that applies: on a wildcard the pick stands; a date socket under a non-date style shows `date_dmy` (otherwise a raw serial); a non-date socket under a date style shows `auto`. A saved pick outside the family is inert, not reset ([[C94]] formatFamilyGates). A value typed only at run time, such as a Script output, passes through a wildcard and then its construction-time family before its real type arrives, and re-defaulting on each hop destroyed a saved date style. `formatModel.test.ts` checks the whole `SocketDataType` union against the family table.
- **Where the annotation lands.** `refreshAnnotation` writes the annotation onto the box feeding the FC's `in`, and only there. It exists only while `in` is connected, so breaking the cable reverts the upstream display; docking is positional only, and the wiring decides everything. The FC tracks the sockets it wrote and deletes any it no longer annotates. `annotatedSocket()` is the first of them, for the mismatch check.
- **Convert ahead.** `refreshAnnotation` also walks forward from the FC, up to 32 hops through pure passthroughs, to a node with string `fromUnit` and `toUnit` (a Convert), and records its from-unit as `dictatedFromUnit`; this is the one graph fact `data()` can't see.
- **`data()`** reads the first `UnitCell` in the value (a scalar, or a 1-D list's cells). The inherited unit is that cell's `display`, or the FC id matching its base unit. A dictated unit fills the dropdown only when it is `none`, so an authored unit stands and a real clash surfaces as the Convert's error ([[C25]] firstClassUnits). Then `lockedByConvert` is a dictated unit equal to the FC's, `forwarding` is a unit-bearing value without that, and while forwarding the FC's unit mirrors the inherited one unconditionally, since a stale pick under a locked dropdown would read as a re-author in `applyFcUnit`. The output is `applyFcUnit(value, unit, customUnit)`. The FC is `unitAware`, because it re-displays and clash-checks the incoming tags.
- **Docking.** `dockSelf` runs once after `editor.addNode`, since it needs the id Rete assigns, then adapts and refreshes. `undock` deletes the FC's annotations and its dock. `releaseDock` forgets the dock's identity but keeps the annotation, and must clear `hostNodeId`, or a load-time `dockSelf` would resurrect the dock from the saved stale id. `width` and `height` start as estimates (116 × 64) that the card's resize observer corrects after first paint.
- **The card** (`FormatControllerNode.tsx`). The FC card has no header and paints its own single-stroke accent ring instead of the shared card frame (`frameless`); a unit mismatch shows as a `!` corner badge. When docked, the FC socket that meets the host's sits exactly on it, so only the host's dot shows. Every style row keeps the fixed back and forward arrows (the format applies behind and travels forward), and the `—` pick adds the muted upstream-style hint below the dropdown. The advanced tier sits with the format cluster, above the unit row, because formats re-format freely downstream while units lock, and the two must not interleave; the expander row closes the format cluster. An empty or invalid digits box falls back to 1, and switching to sig figs bumps 0 to 1. Any pick that changes the card's height (the style's row count, chip or inherit, the advanced tier, a view that resizes the host box) re-centers a docked FC on its host after layout.

## Where the model is enforced

- `formatModel.ts`: `familyOf`, `controlsFor(family, style)` and `precisionApplies(style)` are the single source for both the popup and resolution. `formatModel.test.ts` sweeps `familyOf` and `precisionApplies` exhaustively. The advanced-tier predicates (`groupingApplies`, `scaleApplies`, `negativeApplies`) are only spot-checked in `formatAnnotationStore.test.ts`, so their per-style rows above are not enforced as a table.
- `applyFormatStyle`: each style case hands precision to the shared resolver, with `scientific`'s inline digit clamp the one exception.
- `FormatControllerNode.tsx` renders rows strictly from `controlsFor`, the custom pattern field (`customPattern`) included, with no inline `isDate`, `isText` or `format === "decimal"` gates. The unit dropdown's `disabled` under a lock is the one sanctioned modifier outside `controlsFor`: presence is still the family's call, and only editability is the lock's.
- Every render surface asks one question, `resolveDisplayAnnotation(nodeId, socketKey?)` (`valueDisplayFormat.ts`: the direct FC, else the carried `outAnnotation`, else the trailing FC's `downstreamAnnotation`, on the owning editor). The surfaces are `ValueDisplay` (any card, scalars and list cells), `InlineOutputRows` (per socket), `DisplayNode` and `TableDisplay` (matrix cells), `inlineRefDisplay` (Note and Report refs), `CableInspector`, `PinLayer` and the collapsed-group readouts. Booleans go through `applyLogicalStyle`, text through `applyTextCase` and numbers through `formatNumberWithAnnotation`. A `UnitCell` under an annotation whose `unit` is `none` keeps the cell's own display unit (`annotationForValue`): the annotation supplies the style and the value owns the unit. Frames, Cubes and the table popup grid stay per column. Pinned by `valueDisplayAnnotation.test.ts`.
- `resolveDisplayAnnotation`'s optional `socketKey` names which output of a multi-box card to ask about; without it, each output is asked in declaration order. A value renders as a date only when its node's output socket declares a date type (`nodeOutputElemFamily`), never from the shape of its cells.
- Without an FC, `dateFormatDisplay` turns a date output's serials into text: date only, or date and time when the serial carries a time fraction (`NOW()`). It works cell by cell: an error cell keeps its `#CODE!`, a blank stays blank, a non-finite serial shows blank, and text or logical cells pass through. With an FC docked it does nothing, because the FC formats dates itself.
- In a list shown as text, a missing cell prints `null` and an error cell its code. An inline output row shows at most three cells and then `…`, and a missing value shows `—`.
- Without an FC, a `UnitCell` renders as "magnitude unit" in its authored display unit; with one, as the magnitude in the FC's unit when the two are commensurable.

## Out of scope

- **The FC's visual design.** The FC card renders this matrix; the matrix doesn't dictate pixels.
- **Number styles for logical or text values**, such as formatting the `1/0` a TRUE coerces to. The type gate is strict; Cast first to get number formatting.
- **Locale switching.** Everything uses the host locale through `toLocaleString`.
