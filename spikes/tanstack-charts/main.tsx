// Every chartRender figure, for eyeballing the TanStack renderers; window.svgOf renders a chart value off-screen.
import { createRoot } from "react-dom/client";
import "../../src/App.css";
import "../../src/graph/components/nodeCard.css";
import { initAppTheme } from "../../src/graph/appTheme";
import * as TS from "../../src/graph/components/chartRender";
import { chartValueSvg } from "../../src/graph/components/chartSvgOffscreen";
import { useChartColors } from "../../src/graph/components/chartCore";

initAppTheme();
const W = 240, H = 170;
const s = (vals: number[]) => vals.map((v, i) => ({ i, v }));
const sales = s([30, 45, 20, 55, 40, 62, 38]);
const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const wave = s(Array.from({ length: 40 }, (_, i) => Math.round(50 + 30 * Math.sin(i / 4))));
const parts = s([40, 25, 15, 12, 8]);
const partLabels = ["Housing", "Food", "Travel", "Fun", "Other"];
const multi = [
  { name: "North", values: [12, 19, 14, 22, 25] },
  { name: "South", values: [8, 11, 17, 15, 21] },
  { name: "West", values: [5, 9, 7, 12, 10] },
];
const qs = ["Q1", "Q2", "Q3", "Q4", "Q5"];
const radarSeries = [{ name: "A", values: [8, 6, 9, 5, 7] }, { name: "B", values: [5, 9, 6, 8, 4] }];
const radarLabels = ["Speed", "Power", "Range", "Cost", "Comfort"];
const overlay = { kind: "overlay", labels: qs, series: [
  { name: "Revenue", kind: "column", values: [12, 19, 14, 22, 25] },
  { name: "Target", kind: "line", values: [15, 15, 18, 20, 22], marker: true },
] } as never;
const curve = Array.from({ length: 41 }, (_, k) => { const t = (k / 40) * 2 * Math.PI; return { x: Math.sin(2 * t), y: Math.sin(3 * t), c: t }; });
const xyScatter = { kind: "xy", names: { x: "x", y: "y" }, series: [
  { name: "A", line: "none", marker: true, points: Array.from({ length: 25 }, (_, k) => ({ x: k, y: k * 1.2 + 6 * Math.sin(k) })) },
  { name: "B", line: "none", marker: true, points: Array.from({ length: 25 }, (_, k) => ({ x: k, y: k * 0.7 + 5 * Math.cos(k) })) },
] } as never;
const xyRamp = { kind: "xy", names: { x: "x", y: "y", c: "t" }, series: [
  { name: "Lissajous", line: "solid", marker: true, cRange: [0, 2 * Math.PI], points: curve },
] } as never;
const bubbles = { kind: "xy", names: { x: "x", y: "y", s: "size" }, series: [
  { name: "P", line: "none", marker: true, sRange: [1, 30], points: [{ x: 1, y: 3, s: 5 }, { x: 3, y: 7, s: 30 }, { x: 5, y: 4, s: 12 }, { x: 7, y: 8, s: 20 }, { x: 9, y: 2, s: 1 }] },
] } as never;
const tornado = [
  { label: "Rate", offset: 80, range: 40, rising: true, outLow: 80, outHigh: 120 },
  { label: "Volume", offset: 90, range: 25, rising: false, outLow: 115, outHigh: 90 },
  { label: "Cost", offset: 95, range: 12, rising: true, outLow: 95, outHigh: 107 },
  { label: "Tax", offset: 98, range: 5, rising: false, outLow: 103, outHigh: 98 },
];

let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
const cloudPts = (cx: number, cy: number, n: number) => Array.from({ length: n }, () => ({ x: cx + gauss() * 2, y: cy + gauss() * 1.5 }));
const cloud = (bin: "hexbin" | "density") => ({ kind: "xy", names: { x: "x", y: "y" }, bin, series: [
  { name: "A", line: "none", marker: true, points: cloudPts(4, 5, 400) },
  { name: "B", line: "none", marker: true, points: cloudPts(9, 8, 300) },
] }) as never;
type Lib = typeof TS;
const figures: [string, (L: Lib, g: { grid: string; axis: string }) => React.ReactNode][] = [
  ["column + labels", (L) => <L.ChartView op="column" series={sales} labels={labels} width={W} height={H} axes opts={{ title: "Weekly sales", ylabel: "units" }} />],
  ["bar", (L) => <L.ChartView op="bar" series={sales} labels={labels} width={W} height={H} axes />],
  ["line (40 pts)", (L) => <L.ChartView op="line" series={wave} width={W} height={H} axes opts={{ xlabel: "step" }} />],
  ["area", (L) => <L.ChartView op="area" series={sales} labels={labels} width={W} height={H} axes />],
  ["sparkline", (L) => <L.ChartView op="line" series={wave} width={W} height={50} axes={false} />],
  ["win/loss", (L) => <L.ChartView op="column" series={s([1, -1, 1, 1, 0, -1, 1, -1])} width={W} height={50} axes={false} signColors={{ pos: "#3fb950", neg: "#f85149" }} />],
  ["pie outside", (L) => <L.ChartView op="pie" series={parts} labels={partLabels} width={W} height={H} axes />],
  ["pie inside", (L) => <L.ChartView op="pie" series={parts} labels={partLabels} width={W} height={H} axes opts={{ pielabels: "inside" }} />],
  ["radar", (L) => <L.ChartView op="radar" series={s([8, 6, 9, 5, 7])} labels={radarLabels} width={W} height={H} axes />],
  ["radial", (L) => <L.ChartView op="radialbar" series={parts} labels={partLabels} width={W} height={H} axes />],
  ["funnel", (L) => <L.ChartView op="funnel" series={s([100, 70, 45, 30, 12])} width={W} height={H} axes />],
  ["multi line", (L) => <L.MultiSeriesView op="line" series={multi} labels={qs} width={W} height={H} axes />],
  ["multi area", (L) => <L.MultiSeriesView op="area" series={multi} labels={qs} width={W} height={H} axes />],
  ["multi column", (L) => <L.MultiSeriesView op="column" series={multi} labels={qs} width={W} height={H} axes />],
  ["multi bar", (L) => <L.MultiSeriesView op="bar" series={multi} labels={qs} width={W} height={H} axes />],
  ["multi radar", (L) => <L.MultiSeriesView op="radar" series={radarSeries} labels={radarLabels} width={W} height={H} axes />],
  ["merge plots", (L) => <L.OverlayView payload={overlay} width={W} height={H} />],
  ["scatter", (L) => <L.XYView payload={xyScatter} width={W} height={H} />],
  ["xy ramp line", (L) => <L.XYView payload={xyRamp} width={W} height={H} opts={{ aspect: "equal" }} />],
  ["bubble", (L) => <L.XYView payload={bubbles} width={W} height={H} />],
  ["treemap", (L) => <L.TreemapView names={partLabels} values={[40, 25, 15, 12, 8]} width={W} height={H} />],
  ["sankey", (L) => <L.SankeyView sources={["Salary", "Salary", "Salary", "Bonus"]} targets={["Housing", "Food", "Savings", "Savings"]} values={[40, 20, 25, 10]} width={W} height={H} />],
  ["gauge", (L) => <div style={{ position: "relative", width: 120, height: 60, overflow: "hidden" }}><L.GaugeArc pct={72} track="#3a3f45" size={120} /></div>],
  ["stacked column", (L) => <L.MultiSeriesView op="column" series={multi} labels={qs} width={W} height={H} axes opts={{ stacked: "on" }} />],
  ["100% bar", (L) => <L.MultiSeriesView op="bar" series={multi} labels={qs} width={W} height={H} axes opts={{ stacked: "percent" }} />],
  ["stacked area", (L) => <L.MultiSeriesView op="area" series={multi} labels={qs} width={W} height={H} axes opts={{ stacked: "on" }} />],
  ["step line", (L) => <L.ChartView op="line" series={sales} labels={labels} width={W} height={H} axes opts={{ drawstyle: "steps" }} />],
  ["lollipop", (L) => <L.ChartView op="lollipop" series={sales} labels={labels} width={W} height={H} axes />],
  ["donut", (L) => <L.ChartView op="pie" series={parts} labels={partLabels} width={W} height={H} axes opts={{ hole: 0.55, pielabels: "inside" }} />],
  ["rose", (L) => <L.ChartView op="rose" series={parts} labels={partLabels} width={W} height={H} axes />],
  ["hexbin", (L) => <L.XYView payload={cloud("hexbin")} width={W} height={H} />],
  ["density", (L) => <L.XYView payload={cloud("density")} width={W} height={H} />],
  ["tornado", (L, g) => <L.TornadoBars data={tornado} grid={g.grid} axis={g.axis} />],
];

function App() {
  const g = useChartColors();
  const q = new URLSearchParams(location.search); const only = q.get("only"); const from = Number(q.get("from") ?? 0);
  return (
    <div className="grid">
      {figures.slice(from).filter(([t]) => !only || t.includes(only)).map(([title, f]) => (
        <div className="pair" key={title}>
          <div className="t">{title}</div>
          <div className="row"><div className="cell">{f(TS, g)}</div></div>
        </div>
      ))}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
(window as unknown as { svgOf: typeof chartValueSvg }).svgOf = chartValueSvg;
