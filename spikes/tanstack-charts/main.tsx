import { createRoot } from "react-dom/client";
import "../../src/App.css";
import { ChartView, XYView, TornadoBars } from "../../src/graph/components/chartRender";
import { useChartColors, useSeriesColors } from "../../src/graph/components/chartCore";
import { resolveColor } from "../../src/graph/palette";
import { TsChartView, TsScatter, TsTornado, type Shape } from "./tanstackRender";

const N = Number(new URLSearchParams(location.search).get("n") ?? 24);
const series = Array.from({ length: N }, (_, i) => ({ i, v: Math.round(50 + 30 * Math.sin(i / 3) + 10 * Math.cos(i * 1.7)) }));
const pieSeries = [40, 25, 15, 12, 8].map((v, i) => ({ i, v }));
const xyPts = Array.from({ length: 60 }, (_, k) => ({ x: k % 30, y: (k % 30) * (k < 30 ? 1.2 : 0.7) + 8 * Math.sin(k), s: k < 30 ? "a" : "b" }));
const tornado = [
  { label: "Rate", offset: 80, range: 40, rising: true },
  { label: "Volume", offset: 90, range: 25, rising: false },
  { label: "Cost", offset: 95, range: 12, rising: true },
  { label: "Tax", offset: 98, range: 5, rising: false },
];
const W = 260, H = 160;

function Pair({ title, a, b }: { title: string; a: React.ReactNode; b: React.ReactNode }) {
  return (
    <div className="pair">
      <div className="t">{title}</div>
      <div className="row"><div className="cell"><span>Recharts</span>{a}</div><div className="cell"><span>TanStack</span>{b}</div></div>
    </div>
  );
}

function App() {
  const { grid, axis, viz } = useChartColors();
  const pal = useSeriesColors();
  const shapes: Shape[] = ["line", "area", "column", "bar", "pie"];
  const mk = (s: string) => ({ name: s, line: "none", marker: true, points: xyPts.filter((p) => p.s === s).map((p) => ({ x: p.x, y: p.y })) });
  const xyPayload = { kind: "xy", series: [mk("a"), mk("b")], names: {} } as never;
  return (
    <div className="grid">
      {shapes.map((op) => (
        <Pair key={op} title={op}
          a={<ChartView op={op} series={op === "pie" ? pieSeries : series} width={W} height={H} axes />}
          b={<TsChartView op={op} series={op === "pie" ? pieSeries : series} width={W} height={H} axes color={viz} palette={pal} />} />
      ))}
      <Pair title="sparkline (no axes)"
        a={<ChartView op="line" series={series} width={W} height={40} axes={false} />}
        b={<TsChartView op="line" series={series} width={W} height={40} axes={false} color={viz} palette={pal} />} />
      <Pair title="scatter" a={<XYView payload={xyPayload} width={W} height={H} />} b={<TsScatter points={xyPts} width={W} height={H} palette={pal} />} />
      <Pair title="tornado" a={<TornadoBars data={tornado} grid={grid} axis={axis} />} b={<TsTornado data={tornado} rising="var(--sol-error)" falling={resolveColor("blue")} />} />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
