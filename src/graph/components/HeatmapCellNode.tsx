import type { HeatmapCellNode as HeatmapCellNodeType } from "../rete-nodes";
import { NodeShell, PortSockets, type NodeProps } from "./nodeKit";
import { formatScalar } from "./format";

// A 3-stop cool→warm scale (blue → pale yellow → red), the familiar
// conditional-formatting color ramp.
const STOPS: [number, number, number][] = [
  [44, 123, 182],   // blue
  [255, 255, 191],  // pale yellow
  [215, 25, 28],    // red
];

function rampColor(t: number): string {
  const c = Math.min(1, Math.max(0, t));
  const seg = c <= 0.5 ? 0 : 1;
  const local = c <= 0.5 ? c / 0.5 : (c - 0.5) / 0.5;
  const a = STOPS[seg];
  const b = STOPS[seg + 1];
  const mix = (i: number) => Math.round(a[i] + (b[i] - a[i]) * local);
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
}

// Choose a readable text color against the swatch (perceived luminance).
function textOn(rgb: string): string {
  const m = /(\d+), (\d+), (\d+)/.exec(rgb);
  if (!m) return "#000";
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#1a1a1a" : "#fff";
}

const W = 218; // fills the wide card minus body padding

export function HeatmapCellComponent({ data, emit }: NodeProps<HeatmapCellNodeType>) {
  const table = data.cachedResult;
  const rows = Array.isArray(table) ? table : null;
  const cols = rows ? rows.reduce((m, r) => Math.max(m, r.length), 0) : 0;

  // Data range across all finite cells; a flat table collapses to a single hue.
  let min = Infinity, max = -Infinity;
  if (rows) {
    for (const row of rows) for (const v of row) {
      if (typeof v === "number" && Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
    }
  }
  const span = max - min;
  const finite = Number.isFinite(min);
  // Show the number inside the cell only when there's room.
  const showText = cols > 0 && cols <= 8 && (rows?.length ?? 0) <= 10;
  const cellH = Math.max(16, Math.min(34, Math.round(140 / Math.max(1, rows?.length ?? 1))));

  return (
    <NodeShell node={data} emit={emit} collapsible={false} leading={<PortSockets node={data} emit={emit} side="input" />}>
      {!rows || cols === 0 || !finite ? (
        <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, width: W, marginTop: 2 }}>
          {rows.map((row, r) => (
            <div key={r} style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 2 }}>
              {Array.from({ length: cols }, (_, c) => {
                const v = row[c];
                const has = typeof v === "number" && Number.isFinite(v);
                const t = has && span !== 0 ? (v - min) / span : 0.5;
                const color = has ? rampColor(t) : "var(--border-subtle)";
                return (
                  <div
                    key={c}
                    title={has ? formatScalar(v) : ""}
                    style={{
                      height: cellH,
                      borderRadius: 3,
                      background: color,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      color: has ? textOn(color) : "var(--text-dim, #888)",
                      overflow: "hidden",
                    }}
                  >
                    {showText && has ? formatScalar(v) : ""}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </NodeShell>
  );
}
