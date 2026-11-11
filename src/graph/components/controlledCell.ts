// [[C118]] formatTravelsWithValue, [[E9]] errorsKeepOrigin
import type { Cell } from "../tablePopupStore";
import { isSolError } from "../errorValue";
import { coerceFrameCell } from "../frame";
import { formatNumberWithAnnotation, isDateStyle, applyLogicalStyle, applyTextCase, type FormatAnnotation, type FormatStyleId } from "../formatAnnotationStore";

/** A cell as the popup's Formatted view writes it: raw text coerced by its column type, then put through the column's format. A value the type reads as an error shows its code. */
export function controlledCellText(
  raw: Cell | undefined,
  type: "number" | "string" | "date" | "logical",
  ann: FormatAnnotation,
  numberUnit: () => Pick<FormatAnnotation, "unit" | "customUnit">,
  dateOrder = "",
): string {
  if (raw === null || raw === undefined || raw === "") return "";
  if (isSolError(raw)) return raw.code;
  if (type === "logical" || typeof raw === "boolean") {
    const b = typeof raw === "boolean" ? raw : coerceFrameCell("logical", String(raw));
    return typeof b === "boolean" ? applyLogicalStyle(b, ann.logicalStyle) : b === null ? "" : "NaN";
  }
  const v: Cell = typeof raw === "string" && (type === "number" || type === "date")
    ? coerceFrameCell(type, raw, dateOrder)
    : raw;
  if (v === null) return "";
  if (isSolError(v)) return v.code;
  if (typeof v === "number" && type === "date") {
    const fmt: FormatStyleId = isDateStyle(ann.format) ? ann.format : "date_dmy";
    return formatNumberWithAnnotation(v, { ...ann, format: fmt, unit: "none" });
  }
  if (typeof v === "number" && type === "number") {
    const fmt: FormatStyleId = isDateStyle(ann.format) ? "auto" : ann.format;
    return formatNumberWithAnnotation(v, { ...ann, format: fmt, ...numberUnit() });
  }
  if (type === "string") return applyTextCase(String(v), ann.textCase);
  return String(v);
}
