// Compact cube preview — column names + up to 3×3 cells (nested values shown as a
// short token), then a chip. Mirrors FrameDisplay so the collapse-to-chip CSS
// applies unchanged. The result box of every cube-producing node.
import { CubeChip } from "./CubeChip";
import { cubeRowCount, isCubeValue, type CubeValue } from "../frame";
import { cubeCellToken } from "./cubeCell";
import { isSolError, type SolError } from "../errorValue";
import { errorTip } from "./ErrorChip";
import { flyToNode } from "../flyToNode";

export function CubeDisplay({ cube, label, full }: {
  cube: CubeValue | SolError | null;
  label?: string;
  /** Render every column/row (the Display node, whose card grows to fit). Default
   *  is the compact 3×3 preview. MUST switch tableLayout to `auto` when full — a
   *  width:100% `fixed` table inside the Display's `width:max-content` card is a
   *  runaway-sizing loop (the node stretched infinitely). Mirrors FrameDisplay. */
  full?: boolean;
}) {
  if (isSolError(cube)) {
    return (
      <div
        className={`solenoid-node__display-value solenoid-node__display-value--error${cube.origin ? " sol-error-chip--clickable" : ""}`}
        title={errorTip(cube)}
        onClick={cube.origin ? () => flyToNode(cube.origin!.nodeId) : undefined}
      >
        {cube.code}
      </div>
    );
  }
  if (!cube || !isCubeValue(cube) || cube.columns.length === 0) {
    return <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;
  }
  const rows = cubeRowCount(cube);
  // Cap rendered rows even when "full" — a Display card stays small (100), not a browser.
  const maxR = full ? Math.min(rows, 100) : Math.min(rows, 3);
  const maxC = full ? cube.columns.length : Math.min(cube.columns.length, 3);
  const extraCols = !full && cube.columns.length > maxC;

  return (
    <div className="solenoid-node__display-value solenoid-table-display" style={{ padding: "4px 8px", userSelect: "text" }}>
      <table className="solenoid-table-display__grid" style={{ borderCollapse: "collapse", width: "100%", tableLayout: full ? "auto" : "fixed" }}>
        <thead>
          <tr>
            {cube.columns.slice(0, maxC).map((c, j) => (
              <th key={j} title={c.name} style={{ padding: full ? "2px 8px" : "1px 4px", textAlign: "left", fontSize: full ? 13 : 11, fontWeight: 600, color: "var(--node-accent, var(--text-dim))", borderRight: "1px solid var(--border)", whiteSpace: "nowrap", ...(full ? {} : { overflow: "hidden", textOverflow: "ellipsis" }) }}>
                {c.name}
              </th>
            ))}
            {extraCols && <th style={{ fontSize: 10, color: "var(--text-muted)", width: 14 }}>…</th>}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: maxR }, (_, i) => (
            <tr key={i}>
              {cube.columns.slice(0, maxC).map((c, j) => (
                <td key={j} style={{ padding: full ? "2px 8px" : "1px 4px", textAlign: "left", fontSize: full ? 12 : 11, fontFamily: "var(--font-mono)", color: "var(--text)", borderRight: "1px solid var(--border)", whiteSpace: "nowrap", ...(full ? {} : { overflow: "hidden", textOverflow: "ellipsis" }) }}>
                  {cubeCellToken(c.cells[i] ?? null)}
                </td>
              ))}
              {extraCols && <td style={{ color: "var(--text-muted)", fontSize: 10 }}>…</td>}
            </tr>
          ))}
          {rows > maxR && (
            <tr>
              <td colSpan={maxC + (extraCols ? 1 : 0)} style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 10 }}>…</td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="solenoid-table-display__chip" style={{ display: "flex", justifyContent: "flex-end", marginTop: 3 }}>
        <CubeChip value={cube} label={label} size="sm" />
      </div>
    </div>
  );
}
