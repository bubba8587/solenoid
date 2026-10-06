// The ported payload figures; the canvas originals they were compared against are gone, so both columns now draw the TanStack figure.
import { createRoot } from "react-dom/client";
import "../../src/App.css";
import "../../src/graph/components/nodeCard.css";
import { initAppTheme } from "../../src/graph/appTheme";
import { WaffleView as Old } from "../../src/graph/components/charts/waffleFigure";
import { WaffleView as New } from "../../src/graph/components/charts/waffleFigure";
import { useSeriesColors } from "../../src/graph/components/chartCore";
import type { ProportionPayload } from "../../src/graph/chartValue";

initAppTheme();
const W = 260, H = 180;
const P = (names: string[], values: number[]): ProportionPayload => ({ kind: "proportion", layout: "waffle", names, values });
const cases: [string, ProportionPayload][] = [
  ["categories", P(["Housing", "Food", "Travel", "Entertainment and leisure", "Other"], [40, 25, 15, 12, 8])],
  ["single share 0.37", P(["Done"], [0.37])],
  ["nulls/negatives, no names", P(["", "", ""], [NaN, 5, -3])],
  ["many (20)", P(Array.from({ length: 20 }, (_, i) => `c${i}`), Array.from({ length: 20 }, (_, i) => i + 1))],
];
function App() {
  const colors = useSeriesColors();
  return <div className="grid" data-x="" style={{ gridTemplateColumns: "max-content" }}>
    {cases.map(([t, p]) => <div className="pair" key={t}><div className="t">{t}</div><div className="row">
      <div className="cell"><span>old</span><Old payload={p} width={W} height={H} colors={colors} /></div>
      <div className="cell"><span>new</span><New payload={p} width={W} height={H} colors={colors} /></div>
    </div></div>)}
  </div>;
}
createRoot(document.getElementById("root")!).render(<App />);
