// The FC function model (docs/format-model.md) — the SINGLE source for which
// format controls exist per adopted socket type, and which styles take the
// precision row. The FC popup renders rows strictly off `controlsFor`;
// resolution (applyFormatStyle & friends) enforces the same gates. Keep this
// file in lockstep with the spec's truth table — it IS the truth table.

import { type SocketDataType, elementFamilyOf } from "./sockets";
import { type FormatStyleId, type FormatStyle } from "./formatAnnotationStore";

export type FormatFamily = "number" | "date" | "text" | "logical" | "complex" | "none";

/**
 * The format family of an FC's adopted socket type. `any` (an FC docked to an
 * unresolved passthrough) is provisionally NUMBER — the common case — until a
 * concrete type flows in and fcReconcile re-adapts. `anytable` formats its
 * numeric cells. Frames/cubes are `none`: per-column units/formats are the A4
 * representation problem, not a scalar annotation stretched over a table.
 */
export function familyOf(dt: SocketDataType): FormatFamily {
  if (dt === "any") return "number";
  if (dt === "anytable") return "number";
  switch (elementFamilyOf(dt)) {
    case "number":  return "number";
    case "string":  return "text";
    case "date":    return "date";
    case "logical": return "logical";
    case "complex": return "complex";
    default:        return "none";
  }
}

/** The styles offered on a COMPLEX socket — percent/fraction/integer are
 *  meaningless on a complex value (spec truth table). */
export const COMPLEX_FORMAT_STYLES: FormatStyle[] = ["auto", "decimal", "scientific"];

/** Does this style take the precision row (digits + places|sig figs)?
 *  ONE list — decimal, percent, scientific — per the resolution rule.
 *  auto/integer/fraction/custom/pack formats own their precision internally. */
export function precisionApplies(style: FormatStyleId): boolean {
  return style === "decimal" || style === "percent" || style === "scientific";
}

// ── The advanced tier (the FC chip expands to show it) ──
// Number family: grouping / negative / scale, each per-style gated below (same
// never-disabled-but-visible rule). Text family: alignment / markdown / mono,
// always available (no per-style gate) — see controlsFor.

/** Thousands-separator toggle: grouped locale styles only (scientific has no
 *  grouping; fraction/custom/auto own their own text). */
export function groupingApplies(style: FormatStyleId): boolean {
  return style === "decimal" || style === "integer" || style === "percent";
}

/** Scale (show in thousands/millions/billions): plain magnitude styles only —
 *  scaling a percent or a mantissa is nonsense. */
export function scaleApplies(style: FormatStyleId): boolean {
  return style === "decimal" || style === "integer";
}

/** Negative-number style (minus / parentheses / red): any numeric style. */
export function negativeApplies(style: FormatStyleId): boolean {
  return style !== "custom"; // a custom pattern owns its own negative form
}

/** Which popup controls exist for a family (+ the current style, for the
 *  precision row). A control that is false is HIDDEN and INERT — never
 *  disabled-but-visible, never silently applied. */
export type FcControls = {
  numberStyle: boolean;  // the full number-style dropdown
  complexStyle: boolean; // the reduced complex style list instead
  precision: boolean;    // digits + places/sigfigs row
  unit: boolean;         // unit dropdown (number-family + complex)
  dateStyle: boolean;    // the date-style dropdown
  text: boolean;         // case + bold/italic/size
  logical: boolean;      // the show-as dropdown (TRUE/FALSE · 1/0 · Yes/No · ✓/✗)
  advanced: boolean;     // the expandable advanced tier exists (number family)
};

export function controlsFor(family: FormatFamily, style: FormatStyleId): FcControls {
  const numeric = family === "number" || family === "complex";
  return {
    numberStyle:  family === "number",
    complexStyle: family === "complex",
    precision:    numeric && precisionApplies(style),
    unit:         numeric,
    dateStyle:    family === "date",
    text:         family === "text",
    logical:      family === "logical",
    // The advanced tier exists for numbers (grouping/negative/scale, per style)
    // and for text (alignment / markdown / monospace — always available).
    advanced:     (family === "number" &&
      (groupingApplies(style) || scaleApplies(style) || negativeApplies(style)))
      || family === "text",
  };
}
