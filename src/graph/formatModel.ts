// [[C94]] formatFamilyGates
import { type SocketDataType, elementFamilyOf, isWildcardType } from "./sockets";
import { type FormatStyleId, type FormatStyle } from "./formatAnnotationStore";

export type FormatFamily = "number" | "date" | "text" | "logical" | "complex" | "lambda" | "chart" | "none";

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

export const COMPLEX_FORMAT_STYLES: FormatStyle[] = ["auto", "decimal", "scientific"];

export function precisionApplies(style: FormatStyleId): boolean {
  return style === "decimal" || style === "percent" || style === "scientific";
}

export function groupingApplies(style: FormatStyleId): boolean {
  return style === "decimal" || style === "integer" || style === "percent";
}

export function scaleApplies(style: FormatStyleId): boolean {
  return style === "decimal" || style === "integer";
}

export function negativeApplies(style: FormatStyleId): boolean {
  return style !== "custom";
}

export type FcControls = {
  numberStyle: boolean;
  complexStyle: boolean;
  precision: boolean;
  unit: boolean;
  customPattern: boolean;
  dateStyle: boolean;
  text: boolean;
  logical: boolean;
  lambda: boolean;
  chart: boolean;
  advanced: boolean;
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
