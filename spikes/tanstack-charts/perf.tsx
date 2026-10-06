import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "../../src/App.css";
import { ChartView } from "../../src/graph/components/chartRender";
import { TsChartView } from "./tanstackRender";

const q = new URLSearchParams(location.search);
const lib = q.get("lib") ?? "rc";
const CHARTS = Number(q.get("charts") ?? 36), PTS = Number(q.get("pts") ?? 250);
const data = Array.from({ length: CHARTS }, (_, c) => Array.from({ length: PTS }, (_, i) => ({ i, v: Math.sin(i / 7 + c) * 40 + Math.random() * 10 })));
const pal = ["#3b82f6"];

function Grid({ w }: { w: number }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
    {data.map((s, k) => lib === "rc"
      ? <ChartView key={k} op="line" series={s} width={w} height={140} axes />
      : <TsChartView key={k} op="line" series={s} width={w} height={140} axes color="#f5b914" palette={pal} />)}
  </div>;
}
const root = createRoot(document.getElementById("root")!);
const t0 = performance.now();
flushSync(() => root.render(<Grid w={240} />));
document.body.offsetHeight;
const mount = performance.now() - t0;
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const times: number[] = [];
for (let k = 0; k < 10; k++) {
  const t = performance.now();
  flushSync(() => root.render(<Grid w={240 + (k % 2 ? 1 : 0)} />));
  document.body.offsetHeight;
  times.push(performance.now() - t);
}
times.sort((a, b) => a - b);
(window as any).RESULT = { lib, mount: Math.round(mount), rerenderMedian: Math.round(times[5]), nodes: document.querySelectorAll("#root *").length };
