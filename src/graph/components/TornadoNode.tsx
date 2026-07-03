import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import type { TornadoNode as TornadoNodeType } from "../rete-nodes";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { useChartColors } from "./chartView";
import { runTornado } from "../tornadoRun";
import { processGraph } from "../process";

const RISING = "#e0524d";
const FALLING = "#4c8bf5";

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
        <BarChart
          width={260}
          height={Math.max(70, results.length * 22 + 16)}
          data={normalized}
          layout="vertical"
          margin={{ top: 2, right: 10, bottom: 2, left: 2 }}
        >
          <CartesianGrid stroke={grid} horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 9, fill: axis }} tickLine={false} />
          <YAxis type="category" dataKey="label" width={72} tick={{ fontSize: 9, fill: axis }} tickLine={false} />
          <Tooltip isAnimationActive={false} />
          <Bar dataKey="offset" stackId="tornado" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="range" stackId="tornado" isAnimationActive={false}>
            {normalized.map((d, i) => <Cell key={i} fill={d.rising ? RISING : FALLING} />)}
          </Bar>
        </BarChart>
      )}
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
