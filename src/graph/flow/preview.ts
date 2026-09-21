// [[C43]] oneFlowSurface, [[B10]] reactFlowView, [[D45]] maxRankMatrix
// Crude value previews for the generic fallback card (SolFlowNode); the real
// display pipeline lives in the node components.
import { isSolError } from "../errorValue";
import { isFrameRef } from "../frameBackend";

function num(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const a = Math.abs(n);
  if (a !== 0 && (a >= 1e9 || a < 1e-4)) return n.toExponential(3);
  return String(Math.round(n * 1e6) / 1e6);
}

export function previewValue(v: unknown): string {
  if (v === undefined) return "";
  if (v === null) return "∅";
  if (isSolError(v)) return (v as { code?: string }).code ?? "#ERROR";
  if (typeof v === "number") return num(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return v.length > 40 ? `${v.slice(0, 40)}…` : v;
  if (isFrameRef(v)) return "Frame (lazy)";
  if (Array.isArray(v)) {
    if (v.length > 0 && Array.isArray(v[0])) return `${v.length}×${(v[0] as unknown[]).length} Table`;
    const head = v.slice(0, 4).map(previewValue).join(", ");
    return v.length > 4 ? `[${head}, … ${v.length}]` : `[${head}]`;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    // Containers spell their shape the way the chips do: rows × cols (× depth) Name.
    if (o.__frame && Array.isArray(o.columns)) {
      const cols = o.columns as { values?: unknown[] }[];
      return `${cols[0]?.values?.length ?? 0}×${cols.length} Frame`;
    }
    if (o.__cube && Array.isArray(o.columns)) {
      const cols = o.columns as { cells?: unknown[] }[];
      return `${cols[0]?.cells?.length ?? 0}×${cols.length}×${(o.depth as number) ?? 1} Cube`;
    }
    if (o.__cx) return `${num(o.re as number)}${(o.im as number) < 0 ? "" : "+"}${num(o.im as number)}i`;
    return `{${Object.keys(o).slice(0, 3).join(", ")}}`;
  }
  return String(v);
}
