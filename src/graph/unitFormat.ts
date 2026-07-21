// Standalone unit-suffix rendering, intentionally kept out of the node-graph
// unit wiring (units proper are owned by the Format Controller / Convert). The
// Display node renders whatever suffix is set on it; it offers no dropdown to
// pick one.

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
