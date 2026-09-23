// [[C42]] htmlInCanvasRenderer

export type GlyphKind = "circle" | "square" | "split" | "grid" | "frame" | "hex" | "ring" | "hollowSquare";

const LIST_TYPES = new Set(["list", "strlist", "datelist", "complexlist", "logicallist", "anylist"]);
const TABLE_TYPES = new Set(["table", "strtable", "datetable", "complextable", "logicaltable", "anytable"]);

export const COMBO_PAIRS: Record<string, [string, string]> = {
  numlist: ["number", "list"],
  strcombo: ["string", "strlist"],
  datecombo: ["date", "datelist"],
  complexcombo: ["complex", "complexlist"],
  logicalcombo: ["logical", "logicallist"],
};

export function socketGlyphKind(dataType: string | undefined): GlyphKind {
  if (!dataType) return "circle";
  if (COMBO_PAIRS[dataType]) return "split";
  if (LIST_TYPES.has(dataType)) return "square";
  if (TABLE_TYPES.has(dataType)) return "grid";
  if (dataType === "frame") return "frame"; // sheet-with-header
  if (dataType === "cube") return "hex";
  if (dataType === "trueany") return "ring"; // hollow: border only, no fill
  if (dataType === "anydata") return "hollowSquare"; // any rank ≤ 2: hollow square
  return "circle"; // number/string/date/complex/logical/lambda/any
}
