// `.obsidian/types.json` — Obsidian's vault-wide property-type registry — parsed into
// the shared TypeHint vocabulary (typing source #2, below mdbase, above the guesser).
// Pure JSON; graph/DOM-free.
import { type TypeHint, type TypeMap } from "./vaultTypes";

/** Obsidian's type name → a parsing hint. Unknown names return null (fall through). */
function hintFor(t: string): TypeHint | null {
  switch (t) {
    case "text":     return { kind: "string" };
    case "number":   return { kind: "number" };
    case "checkbox": return { kind: "logical" };
    case "date":     return { kind: "date" };
    case "datetime": return { kind: "date" };
    // Obsidian writes lists as "multitext"; "list" is accepted as a synonym.
    case "multitext":
    case "list":     return { kind: "list", elem: "string" };
    case "tags":
    case "aliases":  return { kind: "list", elem: "string" };
    default:         return null;
  }
}

/** Parse `.obsidian/types.json` text into per-key hints. A malformed body → {}. */
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
