// The ported payload figures; the canvas originals they were compared against are gone, so both columns now draw the TanStack figure.
// Old canvas heat figures beside their TanStack ports.
import { createRoot } from "react-dom/client";
import "../../src/App.css";
import "../../src/graph/components/nodeCard.css";
import { initAppTheme } from "../../src/graph/appTheme";
import * as Old from "../../src/graph/components/charts/heatFigures";
import * as New from "../../src/graph/components/charts/heatFigures";
import type { ChartOptions } from "../../src/graph/nodes/chartOptions";

initAppTheme();
const W = 260, H = 180;
const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const small = { kind: "heatmap", rows: days, cols: ["9am", "10am", "11am", "12pm", "1pm", "2pm"],
  z: days.map((_, r) => Array.from({ length: 6 }, (_, c) => (r === 2 && c === 3 ? null : Math.round(10 + 20 * Math.sin(r + c / 2) + c * 3)))) } as const;
const centered = { kind: "heatmap", rows: Array.from({ length: 8 }, (_, i) => `r${i + 1}`), cols: Array.from({ length: 10 }, (_, i) => `column ${i + 1}`),
  z: Array.from({ length: 8 }, (_, r) => Array.from({ length: 10 }, (_, c) => Math.sin(r / 2) * Math.cos(c / 3) * 4)) } as const;
const N = 120;
const big = { kind: "heatmap", rows: Array.from({ length: N }, (_, i) => String(i + 1)), cols: Array.from({ length: N }, (_, i) => String(i + 1)),
  z: Array.from({ length: N }, (_, r) => Array.from({ length: N }, (_, c) => ((r * c) % 17 === 0 ? null : Math.sin(r / 9) + Math.cos(c / 7)))), totalRows: 900 } as const;
const BASE = 46000;
const yearDays: number[] = [], yearVals: number[] = [];
for (let d = 0; d < 365; d++) if (d % 11 !== 3) { yearDays.push(BASE + d); yearVals.push(Math.round(20 + 15 * Math.sin(d / 20) + (d % 7) * 2)); }
const shortDays = Array.from({ length: 60 }, (_, i) => BASE + i), shortVals = shortDays.map((_, i) => Math.round(10 * Math.sin(i / 5)));
const longDays: number[] = [], longVals: number[] = [];
for (let d = 0; d < 1100; d++) { longDays.push(BASE + d); longVals.push((d * 37) % 100); }

const cases: { name: string; kind: "heat" | "cal"; payload: unknown; o: ChartOptions }[] = [
  { name: "heatmap small, a null", kind: "heat", payload: small, o: {} },
  { name: "heatmap center=0 RdBu, lower, auto, labels, fmt", kind: "heat", payload: centered, o: { center: 0, cmap: "RdBu", origin: "lower", aspect: "auto", xlabel: "Column", ylabel: "Row", fmt: ".1f", annot: true } as ChartOptions },
  { name: "heatmap 120x120 viridis, cut", kind: "heat", payload: big, o: { cmap: "viridis" } as ChartOptions },
  { name: "calendar a year, gaps", kind: "cal", payload: { kind: "calheat", days: yearDays, values: yearVals }, o: {} },
  { name: "calendar 60 days magma center", kind: "cal", payload: { kind: "calheat", days: shortDays, values: shortVals }, o: { cmap: "magma", center: 0 } as ChartOptions },
  { name: "calendar 3 years, cbar off", kind: "cal", payload: { kind: "calheat", days: longDays, values: longVals }, o: { cbar: false } as ChartOptions },
];

function App() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "max-content max-content", gap: 14 }}>
      {cases.map((k, i) => {
        const O = k.kind === "heat" ? Old.HeatmapView : Old.CalHeatView;
        const Nw = k.kind === "heat" ? New.HeatmapView : New.CalHeatView;
        return (
          <div key={i} style={{ gridColumn: "1 / span 2", display: "flex", gap: 12 }} className="pair">
            <div><div className="t">old: {k.name}</div><div style={{ width: W, height: H }}><O payload={k.payload as never} options={k.o} width={W} height={H} /></div></div>
            <div><div className="t">new</div><div style={{ width: W, height: H }} data-new><Nw payload={k.payload as never} options={k.o} width={W} height={H} /></div></div>
          </div>
        );
      })}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
