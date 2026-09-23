// [[C25]] firstClassUnits
// Standalone unit-suffix rendering, outside the unit wiring, which the Format Controller and Convert own.

export type UnitSuffix = "none" | "deg" | "rad" | "percent";

export const UNIT_SUFFIX_LABELS: Record<UnitSuffix, string> = {
  none:    "—",
  deg:     "°",
  rad:     "rad",
  percent: "%",
};

export function formatWithUnit(n: number, suffix: UnitSuffix): string {
  const num = Number.isInteger(n) ? n.toString() : n.toFixed(4);
  switch (suffix) {
    case "deg":     return `${num}°`;
    case "rad":     return `${num} rad`;
    case "percent": return `${num}%`;
    default:        return num;
  }
}
