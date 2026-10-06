// [[C100]] chartIsAValue, [[D98]] tanstackDrawsCharts
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { ChartFigure } from "./chartView";
import { figureSvgString, largestFigureSvg } from "../canvasCapture";
import type { ChartValue } from "../chartValue";

export const OFFSCREEN_W = 480;
export const OFFSCREEN_H = 300;

/** A chart value drawn off the canvas, through the same figure the canvas draws, as export SVG; null when it draws no SVG. */
export async function chartValueSvg(value: ChartValue, width = OFFSCREEN_W, height = OFFSCREEN_H): Promise<string | null> {
  await import("./chartRender");
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;height:${height}px;pointer-events:none;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<ChartFigure value={value} width={width} height={height} />));
    for (let k = 0; k < 30 && !host.querySelector("svg.ts-chart"); k++) await new Promise((r) => requestAnimationFrame(r));
    const svg = largestFigureSvg(host);
    return svg ? figureSvgString(svg, host) : null;
  } finally {
    root.unmount();
    host.remove();
  }
}
