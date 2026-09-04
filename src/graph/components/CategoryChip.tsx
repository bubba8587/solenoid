import { useSeriesColors } from "./chartCore";
import "./CategoryChip.css";

/** A categorical color chip for a string value (the Chip text style, B2.2). The hue is
 *  the shared chart palette slot at `index` (first-appearance order — see categoryColor.ts),
 *  so the same value is the same color anywhere in a column and agrees with a chart's series
 *  colors. DESIGN Quiet Accent: the fill is a translucent wash (the sanctioned chip recipe,
 *  ~16% toward transparent) that composites over either theme; the ink is the hue pulled
 *  toward --text so it stays legible. Flat — no shadow. */
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
