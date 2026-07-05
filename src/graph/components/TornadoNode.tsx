import { useState } from "react";
import type { TornadoNode as TornadoNodeType } from "../rete-nodes";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { useChartColors, TornadoBars } from "./chartView";
import { runTornado } from "../tornadoRun";
import { processGraph } from "../process";

// The watched value only makes sense wired (Tornado perturbs UPSTREAM of it) —
// no literal field.
const TORNADO_CABLE_ONLY = new Set(["value"]);

export function TornadoComponent({ data, emit }: NodeProps<TornadoNodeType>) {
  const [busy, setBusy] = useState(false);
  const { grid, axis } = useChartColors();

  async function onRun() {
    setBusy(true);
    try {
      data.results = await runTornado(data);
    } finally {
      setBusy(false);
      void processGraph(data.id);
    }
  }

  const results = data.results ?? [];
  const chartData = results.map((r) => {
    const start = Math.min(r.low, r.high);
    const end = Math.max(r.low, r.high);
    return { label: r.label, offset: start, range: end - start, rising: r.high >= r.low };
  });
  const minOffset = chartData.length ? Math.min(...chartData.map((d) => d.offset)) : 0;
  // recharts stacks from 0, so the "offset" segment must start at the SAME floor
  // for every row (an invisible spacer bar), with `range` the visible swing.
  const normalized = chartData.map((d) => ({ ...d, offset: d.offset - minOffset }));

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} keys={["value"]} cableOnlyKeys={TORNADO_CABLE_ONLY} />
      <button
        type="button"
        className="solenoid-node__inline-input"
        disabled={busy}
        style={{ width: "100%", cursor: busy ? "default" : "pointer", textAlign: "center", opacity: busy ? 0.6 : 1 }}
        onClick={onRun}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {busy ? "Running…" : "Run sensitivity"}
      </button>
      {results.length === 0 ? (
        <div className="solenoid-node__text-empty" style={{ padding: "6px 2px" }}>
          {busy ? "perturbing upstream inputs…" : "no upstream Number/Slider inputs found yet"}
        </div>
      ) : (
        <TornadoBars data={normalized} grid={grid} axis={axis} />
      )}
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
