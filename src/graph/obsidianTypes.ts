// [[B1]] obsidianBet
import { type TypeHint, type TypeMap } from "./vaultTypes";

function hintFor(t: string): TypeHint | null {
  switch (t) {
    case "text":     return { kind: "string" };
    case "number":   return { kind: "number" };
    case "checkbox": return { kind: "logical" };
    case "date":     return { kind: "date" };
    case "datetime": return { kind: "date" };
    case "multitext":
    case "list":     return { kind: "list", elem: "string" };
    case "tags":
    case "aliases":  return { kind: "list", elem: "string" };
    case "solenoid-list":        return { kind: "list", elem: "number" };
    case "solenoid-strlist":
    case "solenoid-complexlist": return { kind: "list", elem: "string" };
    case "solenoid-datelist":    return { kind: "list", elem: "date" };
    case "solenoid-logicallist": return { kind: "list", elem: "logical" };
    case "solenoid-frame":
    case "solenoid-cube":        return { kind: "frame" };
    case "solenoid-complex":     return { kind: "string" };
    case "solenoid-table":       return { kind: "matrix", elem: "number" };
    case "solenoid-strtable":
    case "solenoid-complextable": return { kind: "matrix", elem: "string" };
    case "solenoid-datetable":   return { kind: "matrix", elem: "date" };
    case "solenoid-logicaltable": return { kind: "matrix", elem: "logical" };
    default:         return null;
  }
}

export function parseObsidianTypes(text: string): TypeMap {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return {}; }
  const types = (data as { types?: unknown } | null)?.types;
  if (!types || typeof types !== "object") return {};
  const out: TypeMap = {};
  for (const [key, value] of Object.entries(types as Record<string, unknown>)) {
    const hint = typeof value === "string" ? hintFor(value) : null;
    if (hint) out[key] = hint;
  }
  return out;
}
