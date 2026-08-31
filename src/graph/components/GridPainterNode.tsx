import { useRef, useState, type CSSProperties } from "react";
import type { GridPainterNode as GridPainterNodeType } from "../rete-nodes";
import { parsePaintGrid, paintGridToText } from "../nodes/control";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineNumberField } from "./inlineInput";
import { processGraph } from "../process";
// The Grid Painter's well: left-drag paints the brush value into cells,
// right-drag (or Alt-drag) erases back to blank (null).

const WELL_W = 208;
const MAX_WELL_H = 160;

const wellStyle = (rows: number, cols: number, cell: number): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: `repeat(${cols}, ${cell}px)`,
  gridTemplateRows: `repeat(${rows}, ${cell}px)`,
  gap: 1,
  width: cols * cell + (cols - 1),
  margin: "2px auto",
  touchAction: "none",
  cursor: "crosshair",
});

export function GridPainterComponent({ data, emit }: NodeProps<GridPainterNodeType>) {
  const rows = Math.max(1, Math.round(data.literals.rows ?? 6));
  const cols = Math.max(1, Math.round(data.literals.cols ?? 8));
  const [grid, setGrid] = useState<(number | null)[][]>(() => parsePaintGrid(data.tableText, rows, cols));
  const live = useRef(grid);
  const mode = useRef<"paint" | "erase" | null>(null);
  const wellRef = useRef<HTMLDivElement>(null);

  if (live.current.length !== rows || (live.current[0]?.length ?? 0) !== cols) {
    live.current = parsePaintGrid(paintGridToText(live.current), rows, cols);
  }

  const cell = Math.max(6, Math.min(22, Math.floor(Math.min(WELL_W / cols, MAX_WELL_H / rows))));

  const cellAt = (clientX: number, clientY: number): [number, number] | null => {
    const r = wellRef.current?.getBoundingClientRect();
    if (!r) return null;
    const c = Math.floor(((clientX - r.left) / r.width) * cols);
    const rr = Math.floor(((clientY - r.top) / r.height) * rows);
    if (rr < 0 || rr >= rows || c < 0 || c >= cols) return null;
    return [rr, c];
  };

  const apply = (clientX: number, clientY: number) => {
    const at = cellAt(clientX, clientY);
    if (!at || !mode.current) return;
    const [r, c] = at;
    const v = mode.current === "paint" ? (data.literals.brush ?? 1) : null;
    if (live.current[r][c] === v) return;
    const next = live.current.map((row) => [...row]);
    next[r][c] = v;
    live.current = next;
    setGrid(next);
  };

  const commit = () => {
    if (!mode.current) return;
    mode.current = null;
    data.tableText = paintGridToText(live.current);
    void processGraph(data.id);
  };

  const setLit = (key: "rows" | "cols" | "brush") => (v: number) => {
    data.literals[key] = v;
    if (key !== "brush") {
      live.current = parsePaintGrid(paintGridToText(live.current),
        Math.max(1, Math.round(key === "rows" ? v : data.literals.rows ?? 6)),
        Math.max(1, Math.round(key === "cols" ? v : data.literals.cols ?? 8)));
      setGrid(live.current);
      data.tableText = paintGridToText(live.current);
    }
    void processGraph(data.id);
  };

  // Tint by |value| relative to the grid's own max.
  let maxAbs = 0;
  for (const row of grid) for (const v of row) if (v != null) maxAbs = Math.max(maxAbs, Math.abs(v));

  return (
    <NodeShell node={data} emit={emit}>
      <div
        ref={wellRef}
        style={wellStyle(rows, cols, cell)}
        onPointerDown={(e) => {
          e.stopPropagation();
          if (e.button !== 0 && e.button !== 2) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          mode.current = e.button === 2 || e.altKey ? "erase" : "paint";
          apply(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => { if (e.buttons !== 0) apply(e.clientX, e.clientY); }}
        onPointerUp={commit}
        onPointerCancel={commit}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        {grid.flatMap((row, r) =>
          row.map((v, c) => (
            <div
              key={`${r}:${c}`}
              style={{
                background: "var(--surface-sunken)",
                borderRadius: 2,
                position: "relative",
              }}
            >
              {v != null && (
                <div
                  style={{
                    position: "absolute", inset: 0, borderRadius: 2,
                    background: "var(--accent)",
                    opacity: maxAbs > 0 ? 0.25 + 0.75 * (Math.abs(v) / maxAbs) : 1,
                  }}
                />
              )}
            </div>
          )),
        )}
      </div>
      <div className="solenoid-node__io-row" style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span className="solenoid-node__io-label" style={{ flex: "0 0 auto" }}>Rows</span>
        <InlineNumberField value={rows} onChange={(v) => setLit("rows")(v ?? 6)} />
        <span className="solenoid-node__io-label" style={{ flex: "0 0 auto" }}>Cols</span>
        <InlineNumberField value={cols} onChange={(v) => setLit("cols")(v ?? 8)} />
      </div>
      <div className="solenoid-node__io-row" style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span className="solenoid-node__io-label" style={{ flex: "0 0 auto" }}>Brush</span>
        <InlineNumberField value={data.literals.brush ?? 1} onChange={(v) => setLit("brush")(v ?? 1)} />
      </div>
      {/* The value box the default-centered output socket anchors to. */}
      <div className="solenoid-node__display-value solenoid-node__display-value--empty">
        {rows}×{cols}
      </div>
    </NodeShell>
  );
}
