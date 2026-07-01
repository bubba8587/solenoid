// Standalone unit-suffix rendering. Intentionally unconnected from the
// node graph wiring so the future Unit (Transformer) add-on node can
// own/drive it. The Display node renders whatever suffix is set on it,
// but no longer offers a dropdown to choose one — that responsibility
// moves to the add-on.

export type UnitSuffix = "none" | "deg" | "rad" | "percent";

export const UNIT_SUFFIX_LABELS: Record<UnitSuffix, string> = {
  none:    "—",
  deg:     "°",
  rad:     "rad",
  percent: "%",
};

/** Format a number with an optional unit suffix appended. */
export function formatWithUnit(n: number, suffix: UnitSuffix): string {
  const num = Number.isInteger(n) ? n.toString() : n.toFixed(4);
  switch (suffix) {
    case "deg":     return `${num}°`;
    case "rad":     return `${num} rad`;
    case "percent": return `${num}%`;
    default:        return num;
  }
}
