// Socket glyph classification for the Pixi renderer — mirrors SocketComponent's
// dataType → shape rules (circle scalar / square list / split combo / grid 2-D /
// hexagon cube), so GPU sockets read like the DOM ones. Pure (colours are
// resolved from CSS vars by the snapshot); only the SHAPE decision lives here.

export type GlyphKind = "circle" | "square" | "split" | "grid" | "hex";

const LIST_TYPES = new Set(["list", "strlist", "datelist", "complexlist", "logicallist"]);
const TABLE_TYPES = new Set(["table", "frame", "strtable", "datetable", "complextable", "logicaltable", "anytable"]);

/** Combo (scalar|list) types → their [scalar, list] dataType pair, so the caller
 *  can resolve the two colours of the bicolor split square. */
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
  if (dataType === "cube") return "hex";
  return "circle"; // number/string/date/complex/logical/lambda/any
}
