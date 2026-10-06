// The ported payload figures; the canvas originals they were compared against are gone, so both columns now draw the TanStack figure.
// Old canvas vs new TanStack: Waterfall, Candlestick, Boxplot.
import { createRoot } from "react-dom/client";
import "../../src/App.css";
import "../../src/graph/components/nodeCard.css";
import { initAppTheme } from "../../src/graph/appTheme";
import * as Old from "../../src/graph/components/charts/statFigures";
import * as New from "../../src/graph/components/charts/statFigures";

initAppTheme();
const ONLY = new URLSearchParams(location.search).get("only");
const W = 260, H = 180;
const wf = (names: string[], values: (number | null)[], total = true) => ({ kind: "waterfall", names, values, total }) as const;
const waterfalls = [
  wf(["Start", "Sales", "Refunds", "Costs", "Tax"], [100, 45, -20, -60, -15]),
  wf(["Jan", "Feb", "Mar", "Apr", "May"], [30, null, -12, 25, null]),
  wf(Array.from({ length: 40 }, (_, i) => `M${i}`), Array.from({ length: 40 }, (_, i) => Math.round(20 * Math.sin(i / 3) + (i % 7) - 3))),
];
let px = 100;
const big = Array.from({ length: 300 }, (_, i) => {
  const o = px; const c = o + Math.sin(i * 1.7) * 3 + 0.1; const h = Math.max(o, c) + 1.5; const l = Math.min(o, c) - 1.5; px = c;
  return { o, h, l, c, d: `D${i + 1}` };
});
const cd = (rows: { o: number | null; h: number | null; l: number | null; c: number | null; d: string }[]) => ({
  kind: "candle", labels: rows.map((r) => r.d), open: rows.map((r) => r.o), high: rows.map((r) => r.h), low: rows.map((r) => r.l), close: rows.map((r) => r.c),
}) as const;
const candles = [
  cd([{ o: 10, h: 14, l: 9, c: 13, d: "Mon" }, { o: 13, h: 15, l: 11, c: 12, d: "Tue" }, { o: 12, h: 12.5, l: 10, c: 12, d: "Wed" }, { o: 12, h: 16, l: 11.5, c: 15.5, d: "Thu" }, { o: 15.5, h: 17, l: 13, c: 14, d: "Fri" }]),
  cd([{ o: 10, h: 14, l: 9, c: 13, d: "a" }, { o: null, h: 15, l: 11, c: 12, d: "b" }, { o: 12, h: 9, l: 10, c: 12, d: "c" }, { o: 12, h: 16, l: 11.5, c: 30, d: "d" }, { o: 14, h: 17, l: 13, c: 16, d: "e" }]),
  cd(big),
];
const bx = (name: string, lo: number, q1: number, med: number, q3: number, hi: number, outliers: number[] = []) => ({ name, lo, q1, med, q3, hi, outliers });
const boxes = [
  { kind: "boxplot", boxes: [bx("Alpha", 2, 5, 7, 9, 12, [20, 22]), bx("Beta", 4, 6, 6.5, 8, 10), bx("Gamma", 1, 3, 5, 6, 9, [-4])] } as const,
  { kind: "boxplot", boxes: [bx("", 10, 14, 15, 17, 21, [2, 30, 31])] } as const,
  { kind: "boxplot", boxes: Array.from({ length: 14 }, (_, i) => bx(`Group ${i + 1}`, i, i + 2, i + 3, i + 4.5, i + 7, i % 3 ? [] : [i + 12])) } as const,
];
const Pair = ({ t, old, now }: { t: string; old: React.ReactNode; now: React.ReactNode }) => (
  <div className="pair"><div className="t">{t}</div><div className="row"><div className="cell"><span>canvas</span>{old}</div><div className="cell"><span>tanstack</span>{now}</div></div></div>
);
function App() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(1, max-content)", gap: 10 }}>
      {(!ONLY || ONLY === "w") && waterfalls.map((p, k) => <Pair key={`w${k}`} t={`Waterfall ${k}`} old={<Old.WaterfallView payload={p as never} width={W} height={H} />} now={<New.WaterfallView payload={p as never} width={W} height={H} />} />)}
      {(!ONLY || ONLY === "c") && candles.map((p, k) => <Pair key={`c${k}`} t={`Candle ${k}`} old={<Old.CandleView payload={p as never} width={W} height={H} />} now={<New.CandleView payload={p as never} width={W} height={H} />} />)}
      {(!ONLY || ONLY === "b") && boxes.map((p, k) => <Pair key={`b${k}`} t={`Boxplot ${k}`} old={<Old.BoxplotView payload={p as never} width={W} height={H} />} now={<New.BoxplotView payload={p as never} width={W} height={H} />} />)}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
