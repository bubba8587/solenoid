// [[B14]] oneDesignSystem (DESIGN.md § Quiet Accent)
import { useSeriesColors } from "./chartCore";
import "./CategoryChip.css";

/** A categorical color chip: the shared chart palette slot at `index` (first-appearance
 *  order, categoryColor.ts), so a value is the same color in a column and in a chart's
 *  series. Wash and ink per DESIGN.md § Quiet Accent. */
export function CategoryChip({ value, index }: { value: string; index: number }) {
  const palette = useSeriesColors();
  const hue = palette[index % palette.length] ?? palette[0];
  return (
    <span
      className="solenoid-category-chip"
      title={value}
      style={{
        background: `color-mix(in srgb, ${hue} 16%, transparent)`,
        color: `color-mix(in srgb, ${hue} 62%, var(--text))`,
      }}
    >
      {value === "" ? "—" : value}
    </span>
  );
}
