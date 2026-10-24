// [[C17]] shareImpl
import { PALETTE } from "../palette";

// ─── Sparkline picture ([[D82]] sparklineCell) ───────────────────────────────

export type SparklineOp = "line" | "column" | "winloss";
/** The palette slots a sparkline paints in. The picture carries their Default palette hexes; a display repaints them in the active palette. */
export const SPARK_SLOTS = { line: "gold", pos: "green", neg: "vermilion" } as const;
const SPARK_COLOR = { line: PALETTE.gold, pos: PALETTE.green, neg: PALETTE.vermilion } as const;
const SPARK_MARK = "class='sol-spark'";
const SPARK_HEX_RE = new RegExp(`%23(${Object.values(SPARK_COLOR).map((h) => h.slice(1)).join("|")})`, "gi");

/** A sparkline picture repainted in `colors` (hexes by slot); any other picture comes back as it is. */
export function repaintSparkline(src: string, colors: Record<keyof typeof SPARK_SLOTS, string>): string {
  if (!src.startsWith("data:image/svg+xml,") || !src.includes(SPARK_MARK)) return src;
  const bySlot = new Map(Object.entries(SPARK_COLOR).map(([k, h]) => [h.slice(1).toLowerCase(), colors[k as keyof typeof SPARK_SLOTS]]));
  return src.replace(SPARK_HEX_RE, (m, hex: string) => (bySlot.get(hex.toLowerCase()) ?? m).replace("#", "%23"));
}
