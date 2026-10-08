// [[B14]] oneDesignSystem (DESIGN.md § Quiet Accent)
import { useSeriesColors } from "./chartCore";
import "./CategoryChip.css";

/** The shared chart palette slot at `index` (first-appearance order, categoryColor.ts), so a value is the same color in a column and a chart.
 *  Tinted like a card's header band (`--header-tint` toward `--surface`, ink at `--mix-ink`), opaque and borderless. */
export function CategoryChip({ value, index }: { value: string; index: number }) {
  const palette = useSeriesColors();
  const hue = palette[index % palette.length] ?? palette[0];
  return (
    <span
      className="solenoid-category-chip"
      title={value}
      style={{
        background: `color-mix(in srgb, ${hue} var(--header-tint), var(--surface))`,
        color: `color-mix(in srgb, ${hue} var(--mix-ink, 55%), var(--text))`,
      }}
    >
      {value === "" ? "—" : value}
    </span>
  );
}
