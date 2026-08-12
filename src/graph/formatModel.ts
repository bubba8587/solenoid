import { type SocketDataType, elementFamilyOf, isWildcardType } from "./sockets";
import { type FormatStyleId, type FormatStyle } from "./formatAnnotationStore";

export type FormatFamily = "number" | "date" | "text" | "logical" | "complex" | "lambda" | "chart" | "none";

/** The format family of an FC's adopted socket type; a wildcard is provisionally
 *  NUMBER until a concrete type flows in and fcReconcile re-adapts. */
export function familyOf(dt: SocketDataType): FormatFamily {
  if (isWildcardType(dt)) return "number";
  if (dt === "anytable") return "number";
  if (dt === "lambda") return "lambda";
  if (dt === "chart") return "chart";
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

/** Does this style take the precision row? The others own their precision
 *  internally. */
export function precisionApplies(style: FormatStyleId): boolean {
  return style === "decimal" || style === "percent" || style === "scientific";
}

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

/** Which popup controls exist for a family + style; a false control is HIDDEN and
 *  INERT — never disabled-but-visible, never silently applied. */
export type FcControls = {
  numberStyle: boolean;  // the full number-style dropdown
  complexStyle: boolean; // the reduced complex style list instead
  precision: boolean;    // digits + places/sigfigs row
  unit: boolean;         // unit dropdown (number-family + complex)
  customPattern: boolean; // the free-pattern field (number `custom` / date `date_custom`)
  dateStyle: boolean;    // the date-style dropdown
  text: boolean;         // case + bold/italic/size
  logical: boolean;      // the show-as dropdown (TRUE/FALSE · 1/0 · Yes/No · ✓/✗)
  lambda: boolean;       // the view-as dropdown (signature · KaTeX · highlighted · monospace)
  chart: boolean;        // the chart text-scale dropdown
  advanced: boolean;     // the expandable advanced tier exists (number family)
};

export function controlsFor(family: FormatFamily, style: FormatStyleId): FcControls {
  const numeric = family === "number" || family === "complex";
  return {
    numberStyle:  family === "number",
    complexStyle: family === "complex",
    precision:    numeric && precisionApplies(style),
    unit:         numeric,
    customPattern: (family === "number" && style === "custom") ||
                   (family === "date" && style === "date_custom"),
    dateStyle:    family === "date",
    text:         family === "text",
    logical:      family === "logical",
    lambda:       family === "lambda",
    chart:        family === "chart",
    advanced:     (family === "number" &&
      (groupingApplies(style) || scaleApplies(style) || negativeApplies(style)))
      || family === "text",
  };
}
