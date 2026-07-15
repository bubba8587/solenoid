import { useEffect, useState } from "react";
import type { InterpolateNode as InterpolateNodeType, InterpolateMode } from "../rete-nodes";
import { INTERPOLATE_MODE_META } from "../rete-nodes";
import { processGraph } from "../process";
import { getActiveEditor, getActiveArea } from "../activeGraph";
import { InlineInputs } from "./inlineInput";
import { NodeShell, type NodeProps } from "./nodeKit";
import { ResultDisplay } from "./ResultDisplay";
import { TableDisplay } from "./TableDisplay";
import { SegToggle } from "./SegToggle";
import { isSolError, type SolError } from "../errorValue";

const MODE_OPTIONS = (Object.keys(INTERPOLATE_MODE_META) as InterpolateMode[]).map((m) => ({
  value: m,
  label: INTERPOLATE_MODE_META[m].label,
  title: INTERPOLATE_MODE_META[m].title,
}));

/**
 * Switch the node between its two modes. LIST and GRID are different operations
 * with different socket sets, so this rebuilds the whole I/O set — dropping every
 * cable on the node first (removeInput/removeOutput is unsafe while a cable still
 * references the socket, and a list cable can't feed the grid's table anyway).
 * Mirrors applyEquationChange's drop-cables-then-reconcile shape.
 */
export async function applyInterpolateMode(node: InterpolateNodeType, mode: InterpolateMode): Promise<void> {
  if (node.mode === mode) return;
  node.mode = mode;

  const editor = getActiveEditor(); // active graph: works inside a composite drill-in too
  const area = getActiveArea();
  if (editor) {
    const conns = editor.getConnections().filter((c) => c.target === node.id || c.source === node.id);
    for (const c of conns) await editor.removeConnection(c.id);
  }
  node._rebuildSockets();

  if (area) await area.update("node", node.id);
  await processGraph();
}

export function InterpolateComponent({ data, emit }: NodeProps<InterpolateNodeType>) {
  // Local mirror so the toggle re-renders immediately; the change handler swaps the
  // socket set (see applyInterpolateMode).
  const [mode, setMode] = useState<InterpolateMode>(data.mode);
  useEffect(() => { setMode(data.mode); }, [data.mode]);
  const [forecast, setForecast] = useState(data.forecast);
  useEffect(() => { setForecast(data.forecast); }, [data.forecast]);

  return (
    <NodeShell node={data} emit={emit}>
      <SegToggle
        value={mode}
        options={MODE_OPTIONS}
        onChange={(next) => { setMode(next); void applyInterpolateMode(data, next); }}
      />
      {mode === "grid" && (
        <div style={{ marginTop: 2 }}>
          <div style={{ fontSize: 11, fontStyle: "italic", color: "var(--text-dim)" }}>Bilinear interpolation</div>
          <label
            style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text)", marginTop: 2, cursor: "pointer" }}
            title="Also linearly extrapolate cells BEYOND the data range (continue the trend), not just interpolate the interior"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={forecast}
              onChange={(e) => { setForecast(e.target.checked); data.forecast = e.target.checked; void processGraph(data.id); }}
            />
            Forecast edges
          </label>
        </div>
      )}
      <InlineInputs node={data} emit={emit} />
      {data.mode === "grid"
        ? <TableDisplay table={isSolError(data.cachedResult) ? (data.cachedResult as SolError) : (data.cachedResult as (number | null)[][] | null)} label={data.label} />
        : <ResultDisplay value={data.cachedResult} label={data.label} />}
    </NodeShell>
  );
}
