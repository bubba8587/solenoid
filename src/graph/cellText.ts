// [[C127]] pivotView
import { isSolError } from "./errorValue";
import { formatNumberWithAnnotation, isDateStyle, type FormatAnnotation } from "./formatAnnotationStore";
import type { FrameCell, FrameColType } from "./frame";

/** A frame cell as the Grid shows it with no pick of its own: in the column's format pick, a date as a date. */
export function defaultCellText(type: FrameColType, cell: FrameCell, format?: FormatAnnotation): string {
  if (cell == null) return "";
  if (isSolError(cell)) return cell.code;
  if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE";
  if (typeof cell === "number" && (type === "number" || type === "date")) {
    const ann: FormatAnnotation = format ?? { format: "auto", unit: "none" };
    const style = type === "date" ? (isDateStyle(ann.format) ? ann.format : "date_dmy") : isDateStyle(ann.format) ? "auto" : ann.format;
    return formatNumberWithAnnotation(cell, { ...ann, format: style, unit: "none" });
  }
  return String(cell);
}
