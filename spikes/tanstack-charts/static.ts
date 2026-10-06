import { createChartScene } from "@tanstack/charts";
import { renderChartSvg } from "@tanstack/charts/svg";
import { defineFigure } from "./tanstackRender";
const series = Array.from({ length: 24 }, (_, i) => ({ i, v: 50 + 30 * Math.sin(i / 3) }));
for (const op of ["line", "column", "pie"] as const) {
  const t = performance.now();
  const svg = renderChartSvg(createChartScene(defineFigure(op, series, true, "#f5b914", ["#3b82f6", "#f5b914", "#14b8a6"]), { width: 260, height: 160 }), { ariaLabel: op });
  console.log(op, typeof document, svg.length, "chars", (performance.now() - t).toFixed(1), "ms", svg.slice(0, 90));
}
