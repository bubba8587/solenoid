// [[C100]] chartIsAValue
export const UNTITLED_FIGURES: ReadonlySet<string> = new Set(["kpi", "scale", "proportion", "sankey", "waterfall", "candle", "boxplot", "calheat", "gantt"]);

export const SELF_TITLED_FIGURES: ReadonlySet<string> = new Set(["column", "bar", "line", "area", "scatter", "pie", "radar", "radialbar", "funnel", "composed", "bubble", "histogram", "record"]);

export const titleHeight = (fs: number) => Math.ceil(16 * fs);

export function ChartTitle({ text, fs }: { text: string; fs: number }) {
  const h = titleHeight(fs);
  return (
    <div style={{ height: h, lineHeight: `${h}px`, textAlign: "center", fontSize: 11 * fs, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {text}
    </div>
  );
}
