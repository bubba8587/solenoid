// The ported payload figures; the canvas originals they were compared against are gone, so both columns now draw the TanStack figure.
// Contour and Vector Field: the canvas figures beside their TanStack ports.
import { createRoot } from "react-dom/client";
import "../../src/App.css";
import "../../src/graph/components/nodeCard.css";
import { initAppTheme } from "../../src/graph/appTheme";
import * as Old from "../../src/graph/components/charts/fieldFigures";
import * as New from "../../src/graph/components/charts/fieldFigures";

initAppTheme();
const W = 260, H = 180;
const range = (n: number, a: number, b: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

const xs1 = range(25, -3, 3), ys1 = range(20, -2, 2);
const peaks = { kind: "contour", xs: xs1, ys: ys1, levels: 8,
  z: ys1.map((y) => xs1.map((x) => 3 * Math.exp(-(x * x + y * y)) - 2 * Math.exp(-((x - 1.5) ** 2 + (y - 1) ** 2) * 2) + 0.3 * x)) } as never;
const xs2 = [0, 1, 2, 4, 8, 16], ys2 = [10, 7, 5, 4];
const holes = { kind: "contour", xs: xs2, ys: ys2, levels: 5,
  z: [[1, 2, 3, 4, 5, 6], [2, null, 4, 5, 6, 7], [3, 4, 5, 6, 7, 8], [4, 5, 6, null, 8, 9]] } as never;
const xs3 = range(80, 0, 100), ys3 = range(60, 0, 60);
const big = { kind: "contour", xs: xs3, ys: ys3, levels: 12,
  z: ys3.map((y) => xs3.map((x) => Math.sin(x / 9) * Math.cos(y / 7) * 100 + x)) } as never;

const grid = (n: number, m: number, f: (x: number, y: number) => [number | null, number | null]) => {
  const u: (number | null)[][] = [], v: (number | null)[][] = [];
  for (let iy = 0; iy < n; iy++) { u.push([]); v.push([]); for (let ix = 0; ix < m; ix++) { const [a, b] = f(ix - (m - 1) / 2, (n - 1) / 2 - iy); u[iy].push(a); v[iy].push(b); } }
  return { kind: "quiver", u, v } as never;
};
const swirl = grid(9, 12, (x, y) => [-y, x]);
const gaps = grid(6, 8, (x, y) => (Math.abs(x) < 1 && Math.abs(y) < 1.5 ? [null, null] : [x * 0.3 + 1, y]));
const dense = grid(30, 40, (x, y) => [Math.sin(y / 4), Math.cos(x / 5)]);

const cases: [string, (L: typeof New) => React.ReactNode][] = [
  ["contour peaks", (L) => <L.ContourView payload={peaks} options={{ xlabel: "x", ylabel: "y" }} width={W} height={H} />],
  ["contour holes, uneven axes, cmap", (L) => <L.ContourView payload={holes} options={{ cmap: "viridis" }} width={W} height={H} />],
  ["contour 80x60, center 0", (L) => <L.ContourView payload={big} options={{ center: 0 }} width={W} height={H} />],
  ["quiver swirl", (L) => <L.QuiverView payload={swirl} options={{}} width={W} height={H} />],
  ["quiver gaps", (L) => <L.QuiverView payload={gaps} options={{ cmap: "plasma" }} width={W} height={H} />],
  ["quiver 40x30", (L) => <L.QuiverView payload={dense} options={{}} width={W} height={H} />],
];

function App() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "max-content max-content", gap: 12 }}>
      {cases.map(([name, f]) => (
        <div key={name} className="pair" style={{ gridColumn: "1 / 3" }}>
          <div className="t">{name}</div>
          <div className="row">
            <div className="cell"><span>canvas</span>{f(Old as unknown as typeof New)}</div>
            <div className="cell"><span>tanstack</span>{f(New)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
